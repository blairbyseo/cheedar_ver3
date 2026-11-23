"""식단 사진 메타데이터 처리 — EXIF 제거(strip_image_metadata)와 촬영 시각 정리(clean_taken_at)."""
import io
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from PIL import Image

from app.services.record_dates import KST, clean_taken_at
from app.services.uploads import strip_image_metadata

GPS_IFD = 0x8825
EXIF_IFD = 0x8769
ORIENTATION = 0x0112
DATETIME_ORIGINAL = 0x9003


def _jpeg_with_exif(size=(40, 20), orientation=6) -> bytes:
    """GPS·촬영시각·회전 정보가 들어 있는 JPEG."""
    img = Image.new("RGB", size, (200, 30, 30))
    exif = Image.Exif()
    exif[ORIENTATION] = orientation
    exif[0x010F] = "TestPhoneMaker"
    exif.get_ifd(EXIF_IFD)[DATETIME_ORIGINAL] = "2026:11:22 19:12:05"
    exif.get_ifd(GPS_IFD)[1] = "N"
    exif.get_ifd(GPS_IFD)[2] = (37.0, 33.0, 59.0)
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_fixture_really_has_gps():
    exif = Image.open(io.BytesIO(_jpeg_with_exif())).getexif()
    assert exif.get_ifd(GPS_IFD)
    assert exif[ORIENTATION] == 6


def test_jpeg_exif_removed():
    raw = _jpeg_with_exif()
    cleaned = strip_image_metadata(raw, "image/jpeg")
    img = Image.open(io.BytesIO(cleaned))
    assert img.format == "JPEG"
    exif = img.getexif()
    assert len(exif) == 0
    assert not exif.get_ifd(GPS_IFD)
    assert not exif.get_ifd(EXIF_IFD)
    assert b"TestPhoneMaker" not in cleaned
    assert b"2026:11:22" not in cleaned


def test_orientation_applied_before_removal():
    # Orientation 6 = 시계 방향 90도 회전해서 보여야 함 → 가로 40x20 이 세로 20x40 으로.
    cleaned = strip_image_metadata(_jpeg_with_exif(size=(40, 20), orientation=6), "image/jpeg")
    assert Image.open(io.BytesIO(cleaned)).size == (20, 40)


def test_png_text_and_exif_removed():
    from PIL.PngImagePlugin import PngInfo

    img = Image.new("RGBA", (10, 10), (0, 255, 0, 128))
    info = PngInfo()
    info.add_text("Comment", "secret-location-note")
    exif = Image.Exif()
    exif[0x010F] = "TestPhoneMaker"
    out = io.BytesIO()
    img.save(out, format="PNG", pnginfo=info, exif=exif)
    assert b"secret-location-note" in out.getvalue()

    cleaned = strip_image_metadata(out.getvalue(), "image/png")
    result = Image.open(io.BytesIO(cleaned))
    assert result.format == "PNG"
    assert result.mode == "RGBA"  # 투명도 유지
    assert b"secret-location-note" not in cleaned
    assert b"TestPhoneMaker" not in cleaned


def test_webp_exif_removed():
    img = Image.new("RGB", (10, 10), (0, 0, 255))
    exif = Image.Exif()
    exif[0x010F] = "TestPhoneMaker"
    out = io.BytesIO()
    img.save(out, format="WEBP", exif=exif)
    cleaned = strip_image_metadata(out.getvalue(), "image/webp")
    assert Image.open(io.BytesIO(cleaned)).format == "WEBP"
    assert b"TestPhoneMaker" not in cleaned


def test_unreadable_file_rejected():
    with pytest.raises(HTTPException) as exc:
        strip_image_metadata(b"this is not an image", "image/jpeg")
    assert exc.value.status_code == 400


# --- clean_taken_at ---------------------------------------------------------


def test_taken_at_none_stays_none():
    assert clean_taken_at(None) is None


def test_taken_at_naive_kept_as_wall_clock():
    assert clean_taken_at(datetime(2026, 11, 22, 19, 12, 5)) == datetime(2026, 11, 22, 19, 12, 5)


def test_taken_at_aware_converted_to_kst_wall_clock():
    utc = datetime(2026, 11, 22, 10, 12, 5, tzinfo=timezone.utc)
    assert clean_taken_at(utc) == datetime(2026, 11, 22, 19, 12, 5)


def test_taken_at_implausible_dropped():
    assert clean_taken_at(datetime(1970, 1, 1, 0, 0, 0)) is None
    future = datetime.now(KST).replace(tzinfo=None) + timedelta(days=3)
    assert clean_taken_at(future) is None


# --- API: 촬영 시각 저장·조회 -------------------------------------------------


@pytest.fixture
def api(monkeypatch):
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.core.database import Base, get_db
    from app.core.deps import get_current_admin, get_current_user
    from app.main import app
    from app.models.user import User

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    # SQLite 는 JSONB 를 모른다 — 식단 저장·포인트 적립에 필요 없는 JSONB 테이블은 건너뛴다.
    from sqlalchemy.dialects.postgresql import JSONB

    tables = [
        t
        for t in Base.metadata.tables.values()
        if not any(isinstance(c.type, JSONB) for c in t.columns)
    ]
    Base.metadata.create_all(engine, tables=tables)
    with sessionmaker(bind=engine)() as session:
        user = User(user_id="a", password_hash="x")
        session.add(user)
        session.commit()
        app.dependency_overrides[get_db] = lambda: session
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_current_admin] = lambda: user
        try:
            yield TestClient(app), user
        finally:
            app.dependency_overrides.clear()


def _today_stamp(hour=12, minute=40):
    now = datetime.now(KST)
    return now.replace(hour=hour, minute=minute, second=10, microsecond=0, tzinfo=None)


def test_taken_at_saved_and_returned_to_user_and_admin(api):
    client, user = api
    stamp = _today_stamp().isoformat()
    res = client.post(
        "/api/meals",
        json={"meal_type": "lunch", "menu": "제육볶음", "image_path": "https://x/meals/a.jpg", "taken_at": stamp},
    )
    assert res.status_code == 201, res.text
    assert res.json()["taken_at"] == stamp

    listed = client.get("/api/meals").json()
    assert listed[0]["taken_at"] == stamp

    admin = client.get(f"/api/admin/users/{user.id}/meals").json()
    assert admin[0]["taken_at"] == stamp


def test_taken_at_optional_and_bad_value_does_not_block_save(api):
    client, _ = api
    res = client.post("/api/meals", json={"meal_type": "snack", "menu": "사과"})
    assert res.status_code == 201
    assert res.json()["taken_at"] is None

    res = client.post(
        "/api/meals",
        json={"meal_type": "snack", "menu": "배", "taken_at": "1970-01-01T00:00:00"},
    )
    assert res.status_code == 201
    assert res.json()["taken_at"] is None


def test_edit_does_not_erase_taken_at(api):
    client, _ = api
    stamp = _today_stamp(8, 5).isoformat()
    meal = client.post(
        "/api/meals", json={"meal_type": "breakfast", "menu": "토스트", "taken_at": stamp}
    ).json()
    res = client.patch(f"/api/meals/{meal['id']}", json={"menu": "토스트와 우유", "taken_at": None})
    assert res.status_code == 200
    assert res.json()["menu"] == "토스트와 우유"
    assert res.json()["taken_at"] == stamp

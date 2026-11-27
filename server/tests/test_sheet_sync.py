"""구글시트 동기화 주소(/api/sheet-sync) 테스트."""
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import app
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.user import User

TOKEN = "t" * 40


class _FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 11, 27, 3, 0, tzinfo=timezone.utc).astimezone(tz)


@pytest.fixture
def ctx(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[User.__table__, DailySteps.__table__, DailySleep.__table__]
    )
    monkeypatch.setattr(get_settings(), "sheet_sync_token", TOKEN)
    monkeypatch.setattr("app.routers.sheet_sync.datetime", _FixedDatetime)
    Session = sessionmaker(bind=engine)
    with Session() as s:
        a = User(user_id="alice", nickname="앨리스", email="a@example.com", password_hash="x", xp=50)
        b = User(user_id="bob", password_hash="x", xp=300)
        gone = User(
            user_id="deleted#3", password_hash=None, xp=999,
            deleted_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
        )
        s.add_all([a, b, gone])
        s.commit()
        s.add_all(
            [
                DailySteps(user_id=a.id, day=date(2026, 11, 26), steps=4000, source="phone_sensor"),
                DailySteps(user_id=a.id, day=date(2026, 11, 27), steps=6000, source="phone_sensor"),
                DailySleep(
                    user_id=a.id, day=date(2026, 11, 27), asleep_minutes=420,
                    bed_start=datetime(2026, 11, 26, 14, 30, tzinfo=timezone.utc),  # KST 23:30
                    wake_end=datetime(2026, 11, 26, 21, 30, tzinfo=timezone.utc),  # KST 06:30
                    source="phone_mic",
                ),
                DailySleep(
                    user_id=a.id, day=date(2026, 11, 26), asleep_minutes=120,
                    bed_start=datetime(2026, 11, 25, 16, 30, tzinfo=timezone.utc),  # KST 01:30
                    wake_end=datetime(2026, 11, 25, 18, 30, tzinfo=timezone.utc),  # KST 03:30
                    source="phone_mic",
                ),
                DailySteps(user_id=gone.id, day=date(2026, 11, 27), steps=1, source="phone_sensor"),
            ]
        )
        s.commit()
        app.dependency_overrides[get_db] = lambda: s
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.clear()


def test_requires_token(ctx):
    assert ctx.get("/api/sheet-sync").status_code == 401
    assert ctx.get("/api/sheet-sync", headers={"X-Sync-Token": "wrong"}).status_code == 401


def test_disabled_when_token_not_configured(ctx, monkeypatch):
    monkeypatch.setattr(get_settings(), "sheet_sync_token", None)
    assert ctx.get("/api/sheet-sync", headers={"X-Sync-Token": TOKEN}).status_code == 404


def test_returns_two_sheets(ctx):
    data = ctx.get("/api/sheet-sync", headers={"X-Sync-Token": TOKEN}).json()

    # 참여율: XP 높은 순, 탈퇴 회원 제외, 이메일 없음
    assert data["participation"][0] == ["아이디", "닉네임 (카카오아이디)", "XP (참여율 높은 순)"]
    assert data["participation"][1:] == [["bob", "", 300], ["alice", "앨리스", 50]]
    assert "a@example.com" not in str(data)

    header, *rows = data["health"]
    assert len(rows) == 1  # 건강 기록 있는 회원만, 탈퇴 회원 제외
    row = dict(zip(header, rows[0]))
    assert row["아이디"] == "alice"
    assert row["최근 걸음수"] == 6000
    assert row["걸음 기록일수(180일)"] == 2
    assert row["평균 걸음수(180일)"] == 5000
    assert row["수면시간(분)"] == 420
    assert row["수면시간"] == "7시간 0분"
    assert row["잠든 시각"] == "2026-11-26 23:30"
    assert row["일어난 시각"] == "2026-11-27 06:30"
    assert row["걸음 출처"] == "폰 센서"
    assert row["수면 출처"] == "폰 마이크"
    # 23:30 과 01:30 의 평균은 자정을 넘어 00:30
    assert row["평균 잠든 시각(30일)"] == "00:30"
    assert row["평균 일어난 시각(30일)"] == "05:00"
    assert row["이상 수면 기록 수(180일, 3시간 미만·12시간 초과)"] == 1
    assert all(len(r) == len(header) for r in rows)

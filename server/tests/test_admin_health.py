"""관리자 건강 데이터 조회(/api/admin/users/{id}/health · 대시보드 수신 현황) 테스트."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import get_current_admin
from app.main import app
from app.models.chat import ChatMessage
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.meal import Meal
from app.models.points import PointHistory
from app.models.safety import SafetyEvent
from app.models.user import User

TODAY = date(2026, 11, 9)


class _FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 11, 9, 10, 0, tzinfo=tz or timezone.utc)


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            DailySteps.__table__,
            DailySleep.__table__,
            Meal.__table__,
            ChatMessage.__table__,
            PointHistory.__table__,
            SafetyEvent.__table__,
        ],
    )
    Session = sessionmaker(bind=engine)
    with Session() as session:
        a = User(user_id="a", password_hash="x")
        b = User(user_id="b", password_hash="x")
        session.add_all([a, b])
        session.commit()
        yield session, a, b


@pytest.fixture
def client(db_session, monkeypatch):
    session, a, _ = db_session
    monkeypatch.setattr("app.routers.admin.datetime", _FixedDatetime)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_admin] = lambda: a
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _sleep(user, day, minutes, source="phone_mic"):
    return DailySleep(
        user_id=user.id,
        day=day,
        asleep_minutes=minutes,
        bed_start=datetime(2026, 11, 8, 15, 0, tzinfo=timezone.utc),
        wake_end=datetime(2026, 11, 8, 22, 0, tzinfo=timezone.utc),
        source=source,
    )


def test_user_health_fills_missing_days(client, db_session):
    session, a, _ = db_session
    session.add_all(
        [
            _sleep(a, TODAY, 420),
            _sleep(a, TODAY - timedelta(days=2), 360, source="health_connect"),
            DailySteps(user_id=a.id, day=TODAY, steps=3000, source="phone_sensor"),
            DailySteps(user_id=a.id, day=TODAY - timedelta(days=1), steps=5000, source="phone_sensor"),
            DailySteps(user_id=a.id, day=TODAY - timedelta(days=10), steps=9999),  # 범위 밖
        ]
    )
    session.commit()

    res = client.get(f"/api/admin/users/{a.id}/health?days=7")
    assert res.status_code == 200
    body = res.json()

    assert [d["day"] for d in body["days"]][:3] == ["2026-11-09", "2026-11-08", "2026-11-07"]
    assert len(body["days"]) == 7
    today_row, yday_row, d2_row = body["days"][:3]
    assert today_row["steps"] == 3000 and today_row["asleep_minutes"] == 420
    assert today_row["sleep_source"] == "phone_mic"
    assert yday_row["steps"] == 5000 and yday_row["asleep_minutes"] is None
    assert d2_row["steps"] is None and d2_row["sleep_source"] == "health_connect"

    assert body["steps_days"] == 2 and body["sleep_days"] == 2
    assert body["avg_steps"] == 4000 and body["avg_asleep_minutes"] == 390
    assert body["last_synced_at"] is not None


def test_user_health_empty_and_404(client, db_session):
    _, _, b = db_session
    body = client.get(f"/api/admin/users/{b.id}/health").json()
    assert len(body["days"]) == 30
    assert body["sleep_days"] == 0 and body["avg_steps"] is None and body["last_synced_at"] is None
    assert client.get("/api/admin/users/9999/health").status_code == 404


def test_dashboard_health_counts(client, db_session):
    session, a, b = db_session
    session.add_all(
        [
            _sleep(a, TODAY, 420),
            _sleep(a, TODAY - timedelta(days=1), 400),
            _sleep(b, TODAY - timedelta(days=3), 380),
            _sleep(b, TODAY - timedelta(days=8), 380),  # 7일 밖
            DailySteps(user_id=b.id, day=TODAY, steps=100),
        ]
    )
    session.commit()

    body = client.get("/api/admin/stats/dashboard").json()
    assert body["sleep_last_night_users"] == 1
    assert body["sleep_users_7d"] == 2
    assert body["steps_today_users"] == 1
    assert body["steps_users_7d"] == 1


def test_user_list_and_csv_include_latest_sleep(client, db_session):
    session, a, b = db_session
    session.add_all(
        [
            _sleep(a, TODAY - timedelta(days=1), 390),
            _sleep(a, TODAY, 435),
            DailySteps(user_id=a.id, day=TODAY - timedelta(days=1), steps=4567),
        ]
    )
    session.commit()

    response = client.get("/api/admin/users")
    assert response.status_code == 200
    users = {item["user_id"]: item for item in response.json()["items"]}
    assert users["a"]["last_sleep_day"] == "2026-11-09"
    assert users["a"]["last_asleep_minutes"] == 435
    assert users["a"]["last_steps_day"] == "2026-11-08"
    assert users["a"]["last_steps"] == 4567
    assert users["b"]["last_sleep_day"] is None
    assert users["b"]["last_asleep_minutes"] is None
    assert users["b"]["last_steps_day"] is None
    assert users["b"]["last_steps"] is None

    csv_response = client.get("/api/admin/users/export")
    assert csv_response.status_code == 200
    csv_content = csv_response.content.decode("utf-8-sig")
    assert "최근 걸음일,최근 걸음수,최근 수면일(기상일 기준),최근 수면시간" in csv_content
    assert "2026-11-08,4567,2026-11-09,7시간 15분" in csv_content


def test_health_overview_daily_and_users(client, db_session):
    session, a, b = db_session
    deleted = User(user_id="gone", password_hash="x", deleted_at=datetime(2026, 11, 1, tzinfo=timezone.utc))
    session.add(deleted)
    session.commit()
    session.add_all(
        [
            _sleep(a, TODAY, 420),                                   # phone_mic
            _sleep(b, TODAY, 100, source="health_connect"),          # 이상값(3시간 미만)
            _sleep(a, TODAY - timedelta(days=1), 400),
            DailySteps(user_id=a.id, day=TODAY, steps=3000, source="phone_sensor"),
            DailySteps(user_id=b.id, day=TODAY, steps=5000, source="health_connect"),
            DailySteps(user_id=b.id, day=TODAY - timedelta(days=5), steps=1000, source="health_connect"),
            DailySteps(user_id=deleted.id, day=TODAY, steps=1, source="phone_sensor"),
        ]
    )
    session.commit()

    res = client.get("/api/admin/health/overview?days=7")
    assert res.status_code == 200
    body = res.json()
    assert body["today"] == "2026-11-09"
    assert len(body["daily"]) == 7

    t = body["daily"][0]
    assert t["day"] == "2026-11-09"
    assert t["steps_users"] == 3  # 탈퇴 회원 기록도 '수신'은 된 것이라 집계엔 포함
    assert t["steps_by_source"] == {"phone_sensor": 2, "health_connect": 1}
    assert t["sleep_users"] == 2
    assert t["sleep_by_source"] == {"phone_mic": 1, "health_connect": 1}
    assert t["avg_asleep_minutes"] == 260
    assert t["odd_sleep_count"] == 1
    empty = body["daily"][2]
    assert empty["steps_users"] == 0 and empty["avg_steps"] is None

    users = {u["user_id"]: u for u in body["users"]}
    assert set(users) == {"a", "b"}  # 탈퇴 회원은 목록에서 제외
    assert users["a"]["last_sleep_day"] == "2026-11-09"
    assert users["a"]["last_steps_source"] == "phone_sensor"
    assert users["a"]["sleep_days_7d"] == 2 and users["a"]["steps_days_7d"] == 1
    assert users["b"]["steps_days_7d"] == 2


def test_health_overview_stale_user_first(client, db_session):
    session, a, b = db_session
    session.add_all(
        [
            DailySteps(user_id=a.id, day=TODAY - timedelta(days=20), steps=10),
            DailySteps(user_id=b.id, day=TODAY, steps=10),
        ]
    )
    session.commit()
    body = client.get("/api/admin/health/overview").json()
    assert [u["user_id"] for u in body["users"]] == ["a", "b"]
    assert body["users"][0]["last_steps_day"] == "2026-10-20"
    assert body["users"][0]["steps_days_7d"] == 0


def test_sleep_detail_metrics_in_admin_views(client, db_session):
    """소리 수면 측정 추가 지표(2026-11-27)가 회원 상세·건강 데이터 수면 탭 응답에 실린다."""
    session, a, b = db_session
    detail = dict(
        deep_minutes=80, light_minutes=250, rem_minutes=60, awake_minutes=20, awakenings=2,
        sleep_efficiency=90, breathing_rate=14.0, breathing_detected_pct=70,
        apnea_count=1, hypopnea_count=3,
    )
    s1 = _sleep(a, TODAY, 390)
    for k, v in detail.items():
        setattr(s1, k, v)
    s2 = _sleep(b, TODAY, 400)
    s2.sleep_efficiency, s2.breathing_rate, s2.apnea_count = 80, 16.0, 2
    old = _sleep(b, TODAY - timedelta(days=1), 380, source="health_connect")  # 지표 없음
    session.add_all([s1, s2, old])
    session.commit()

    day0 = client.get(f"/api/admin/users/{a.id}/health?days=3").json()["days"][0]
    assert {k: day0[k] for k in detail} == detail

    body = client.get("/api/admin/health/overview?days=3").json()
    today_row, yday_row = body["daily"][0], body["daily"][1]
    assert today_row["sleep_detail_users"] == 2
    assert today_row["avg_sleep_efficiency"] == 85
    assert today_row["avg_breathing_rate"] == 15.0
    assert today_row["apnea_total"] == 3
    assert yday_row["sleep_detail_users"] == 0 and yday_row["avg_sleep_efficiency"] is None

    users = {u["user_id"]: u for u in body["users"]}
    assert users["a"]["last_sleep_efficiency"] == 90
    assert users["a"]["last_rem_minutes"] == 60
    assert users["a"]["last_asleep_minutes"] == 390
    assert users["b"]["last_deep_minutes"] is None

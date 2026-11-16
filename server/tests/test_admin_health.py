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

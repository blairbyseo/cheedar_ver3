"""수면 수신(/api/health/sleep) · 맥락 변환(sleep_context) 단위 테스트."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import get_current_user
from app.main import app
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.user import User
from app.services import sleep_context


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[User.__table__, DailySteps.__table__, DailySleep.__table__]
    )
    Session = sessionmaker(bind=engine)
    with Session() as session:
        user = User(user_id="sleeper", password_hash="x")
        session.add(user)
        session.commit()
        session.refresh(user)
        yield session, user


@pytest.fixture
def client(db_session):
    session, user = db_session
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_sleep_sync_upserts_and_status(client, db_session, monkeypatch):
    session, user = db_session
    monkeypatch.setattr("app.routers.health.kst_today", lambda: date(2026, 10, 19))

    res = client.post(
        "/api/health/sleep",
        json={
            "nights": [
                {
                    "day": "2026-10-19",
                    "asleep_minutes": 390,
                    "bed_start": "2026-10-18T14:40:00Z",
                    "wake_end": "2026-10-18T22:05:00Z",
                },
                {"day": "2026-10-18", "asleep_minutes": 420},
            ]
        },
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"saved": 2, "latest_day": "2026-10-19"}

    # 같은 밤을 다시 올리면 덮어쓴다
    client.post("/api/health/sleep", json={"nights": [{"day": "2026-10-19", "asleep_minutes": 400}]})
    rows = {r.day: r.asleep_minutes for r in session.query(DailySleep).filter_by(user_id=user.id)}
    assert rows == {date(2026, 10, 18): 420, date(2026, 10, 19): 400}

    status = client.get("/api/health/status").json()
    assert status["sleep_latest_day"] == "2026-10-19"
    assert status["sleep_latest_minutes"] == 400
    assert status["latest_day"] is None  # 걸음수는 아직 없음


def test_fmt_minutes():
    assert sleep_context.fmt_minutes(390) == "6시간 30분"
    assert sleep_context.fmt_minutes(420) == "7시간"
    assert sleep_context.fmt_minutes(45) == "45분"


def test_sleep_context_rules(db_session, monkeypatch):
    session, user = db_session
    today = date(2026, 10, 19)
    monkeypatch.setattr(sleep_context, "kst_today", lambda: today)

    assert sleep_context.build_sleep_context(session, user.id) == ""

    # 오늘 아침 390분, 어제 아침 30분(조각 — 평균 제외), 그제 450분
    for i, minutes in enumerate([390, 30, 450]):
        session.add(DailySleep(user_id=user.id, day=today - timedelta(days=i), asleep_minutes=minutes))
    session.commit()

    text = sleep_context.build_sleep_context(session, user.id)
    assert "어젯밤(오늘 2026-10-19 기상) 약 6시간 30분 잠" in text
    assert "밤 평균 약 7시간 30분" in text  # 30분짜리는 빠지고 450 만
    assert "칼로리" in text  # 금기 문구

    assert sleep_context.recent_avg_sleep_minutes(session, user.id) == 420  # (390+450)/2
    assert sleep_context.weekly_avg_sleep_minutes(session, user.id, date(2026, 10, 12)) == 450
    assert sleep_context.weekly_avg_sleep_minutes(session, user.id, date(2026, 10, 19)) == 390


def test_sleep_context_ignores_stale(db_session, monkeypatch):
    session, user = db_session
    monkeypatch.setattr(sleep_context, "kst_today", lambda: date(2026, 10, 19))
    session.add(DailySleep(user_id=user.id, day=date(2026, 10, 10), asleep_minutes=480))
    session.commit()
    assert sleep_context.build_sleep_context(session, user.id) == ""

"""홈 인삿말(health_greeting) — 시간대별 우선순위·고위험군 게이트·오래된 데이터 무시."""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.user import User
from app.services import health_greeting

TODAY = date(2026, 10, 26)


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(health_greeting, "kst_today", lambda: TODAY)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[User.__table__, DailySteps.__table__, DailySleep.__table__]
    )
    Session = sessionmaker(bind=engine)
    with Session() as session:
        user = User(user_id="greeter", password_hash="x")
        session.add(user)
        session.commit()
        session.refresh(user)
        yield session, user


def _steps(session, user, day, steps):
    session.add(DailySteps(user_id=user.id, day=day, steps=steps, source="test"))
    session.commit()


def _sleep(session, user, day, minutes):
    session.add(DailySleep(user_id=user.id, day=day, asleep_minutes=minutes, source="test"))
    session.commit()


def test_no_data_returns_none(db):
    session, user = db
    assert health_greeting.build_home_greeting(session, user.id, hour=9) is None


def test_morning_prefers_last_night_sleep(db):
    session, user = db
    _sleep(session, user, TODAY, 420)
    _steps(session, user, TODAY - timedelta(days=1), 8120)
    text = health_greeting.build_home_greeting(session, user.id, hour=8)
    assert text.startswith("어젯밤 7시간쯤 주무셨네요")


def test_morning_falls_back_to_yesterday_steps(db):
    session, user = db
    _steps(session, user, TODAY - timedelta(days=1), 8120)
    text = health_greeting.build_home_greeting(session, user.id, hour=8)
    assert "어제 8,120걸음" in text


def test_afternoon_prefers_today_steps_then_sleep(db):
    session, user = db
    _sleep(session, user, TODAY, 395)
    assert health_greeting.build_home_greeting(session, user.id, hour=14).startswith("어젯밤")
    _steps(session, user, TODAY, 3410)
    assert "오늘 지금까지 3,410걸음" in health_greeting.build_home_greeting(
        session, user.id, hour=14
    )


def test_high_risk_never_gets_steps_but_gets_sleep(db):
    session, user = db
    _steps(session, user, TODAY, 3410)
    assert health_greeting.build_home_greeting(session, user.id, hour=14, high_risk=True) is None
    _sleep(session, user, TODAY, 420)
    text = health_greeting.build_home_greeting(session, user.id, hour=14, high_risk=True)
    assert "걸음" not in text and "어젯밤" in text


def test_stale_or_tiny_data_is_ignored(db):
    session, user = db
    _sleep(session, user, TODAY - timedelta(days=1), 420)  # 어제 아침 기상 = 그젯밤
    _steps(session, user, TODAY - timedelta(days=2), 9000)
    assert health_greeting.build_home_greeting(session, user.id, hour=8) is None
    _sleep(session, user, TODAY, 30)  # 너무 짧은 밤 — 부정확할 수 있음
    assert health_greeting.build_home_greeting(session, user.id, hour=8) is None


def test_greeting_text_has_no_evaluation_words(db):
    session, user = db
    _sleep(session, user, TODAY, 300)
    _steps(session, user, TODAY, 200)
    for hour in (8, 14, 20):
        text = health_greeting.build_home_greeting(session, user.id, hour=hour)
        for word in ("부족", "충분", "많", "적게", "목표", "칼로리"):
            assert word not in text

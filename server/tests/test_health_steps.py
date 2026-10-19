"""걸음수 수신(/api/health/steps) · 맥락 변환(steps_context) 단위 테스트.

SQLite 메모리 DB 에 users + daily_steps 두 테이블만 만들어 돌린다(외부 의존 없음).
"""
from datetime import date, timedelta

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
from app.services import steps_context


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
        user = User(user_id="tester", password_hash="x")
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


def test_sync_upserts_same_day(client, db_session, monkeypatch):
    session, user = db_session
    today = date(2026, 10, 19)
    monkeypatch.setattr("app.routers.health.kst_today", lambda: today)

    body = {
        "source": "health_connect",
        "days": [
            {"day": "2026-10-18", "steps": 5000},
            {"day": "2026-10-19", "steps": 1200},
        ],
    }
    res = client.post("/api/health/steps", json=body)
    assert res.status_code == 200, res.text
    assert res.json() == {"saved": 2, "latest_day": "2026-10-19"}

    # 같은 날을 다시 올리면 행이 늘지 않고 값만 바뀐다(폰이 정답).
    body["days"] = [{"day": "2026-10-19", "steps": 6543}]
    res = client.post("/api/health/steps", json=body)
    assert res.json()["saved"] == 1
    rows = {r.day: r.steps for r in session.query(DailySteps).filter_by(user_id=user.id)}
    assert rows == {date(2026, 10, 18): 5000, date(2026, 10, 19): 6543}

    status = client.get("/api/health/status").json()
    assert status["latest_day"] == "2026-10-19"
    assert status["latest_steps"] == 6543


def test_sync_drops_out_of_range_days(client, monkeypatch):
    monkeypatch.setattr("app.routers.health.kst_today", lambda: date(2026, 10, 19))
    res = client.post(
        "/api/health/steps",
        json={"days": [{"day": "2025-01-01", "steps": 10}, {"day": "2026-12-25", "steps": 10}]},
    )
    assert res.json() == {"saved": 0, "latest_day": None}


def test_steps_context_rules(db_session, monkeypatch):
    session, user = db_session
    today = date(2026, 10, 19)
    monkeypatch.setattr(steps_context, "kst_today", lambda: today)

    # 기록 없음 → 빈 문자열(웹/권한 거절 사용자와 동일)
    assert steps_context.build_steps_context(session, user.id) == ""

    for i, steps in enumerate([8000, 0, 6000, 4000]):
        session.add(DailySteps(user_id=user.id, day=today - timedelta(days=i), steps=steps))
    session.commit()

    text = steps_context.build_steps_context(session, user.id)
    assert "오늘(2026-10-19) 지금까지 약 8,000걸음" in text
    # 0걸음(아직 못 센 날)은 평균에서 빠진다 → (6000+4000)/2
    assert "일평균 약 5,000걸음" in text
    assert "칼로리" in text  # 금기 문구가 함께 간다

    # 섭식 고위험군에게는 숫자를 주지 않는다
    assert steps_context.build_steps_context(session, user.id, high_risk=True) == ""
    assert steps_context.recent_avg_steps(session, user.id) == 5000
    assert steps_context.weekly_avg_steps(session, user.id, date(2026, 10, 12)) == 5000  # 10/16~18
    assert steps_context.weekly_avg_steps(session, user.id, date(2026, 10, 19)) == 8000


def test_steps_context_ignores_stale_sync(db_session, monkeypatch):
    session, user = db_session
    monkeypatch.setattr(steps_context, "kst_today", lambda: date(2026, 10, 19))
    session.add(DailySteps(user_id=user.id, day=date(2026, 10, 10), steps=9000))
    session.commit()
    # 마지막 동기화가 3일보다 오래됐으면 옛 숫자로 말하지 않는다
    assert steps_context.build_steps_context(session, user.id) == ""

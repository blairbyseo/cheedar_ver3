"""관리자 회원 탈퇴(POST /api/admin/users/{id}/withdraw) 테스트."""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import get_current_admin
from app.main import app
from app.models.chat import ChatMessage
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.meal import Meal, MealType
from app.models.points import PointHistory
from app.models.user import User


@pytest.fixture
def ctx(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Meal.__table__,
            DailySteps.__table__,
            DailySleep.__table__,
            ChatMessage.__table__,
            PointHistory.__table__,
        ],
    )
    deleted_files: list[str] = []
    monkeypatch.setattr(
        "app.services.account.delete_meal_image", lambda p: deleted_files.append(p)
    )
    monkeypatch.setattr("app.services.account.delete_profile_image", lambda p: None)
    monkeypatch.setattr("app.services.account.apple_service.revoke_token", lambda t: None)

    Session = sessionmaker(bind=engine)
    with Session() as session:
        admin = User(user_id="admin", password_hash="x", is_admin=True)
        target = User(
            user_id="sleepy", password_hash="x", nickname="잠꾸러기", email="s@example.com"
        )
        session.add_all([admin, target])
        session.commit()
        session.add_all(
            [
                Meal(
                    user_id=target.id,
                    meal_type=MealType("breakfast"),
                    eaten_on=date(2026, 11, 1),
                    calories=500,
                    image_path="/uploads/meal.jpg",
                ),
                DailySteps(user_id=target.id, day=date(2026, 11, 1), steps=1000, source="phone_sensor"),
            ]
        )
        session.commit()

        app.dependency_overrides[get_db] = lambda: session
        app.dependency_overrides[get_current_admin] = lambda: admin
        try:
            yield TestClient(app), session, admin, target, deleted_files
        finally:
            app.dependency_overrides.clear()


def test_admin_withdraw_anonymizes_user(ctx):
    client, session, _, target, deleted_files = ctx

    r = client.post(f"/api/admin/users/{target.id}/withdraw")
    assert r.status_code == 204

    session.refresh(target)
    assert target.user_id == f"deleted#{target.id}"
    assert target.deleted_at is not None
    assert target.nickname is None and target.email is None and target.password_hash is None
    # 식단 기록(영양수치)은 남고 사진만 끊긴다
    meal = session.execute(select(Meal).where(Meal.user_id == target.id)).scalar_one()
    assert meal.calories == 500 and meal.image_path is None
    assert deleted_files == ["/uploads/meal.jpg"]
    # 건강 데이터는 지워진다
    assert session.execute(select(DailySteps).where(DailySteps.user_id == target.id)).first() is None

    detail = client.get(f"/api/admin/users/{target.id}").json()
    assert detail["deleted_at"] is not None


def test_admin_withdraw_twice_conflicts(ctx):
    client, _, _, target, _ = ctx
    assert client.post(f"/api/admin/users/{target.id}/withdraw").status_code == 204
    assert client.post(f"/api/admin/users/{target.id}/withdraw").status_code == 409


def test_admin_cannot_withdraw_self(ctx):
    client, session, admin, _, _ = ctx
    r = client.post(f"/api/admin/users/{admin.id}/withdraw")
    assert r.status_code == 400
    session.refresh(admin)
    assert admin.deleted_at is None


def test_admin_withdraw_unknown_user(ctx):
    client, *_ = ctx
    assert client.post("/api/admin/users/9999/withdraw").status_code == 404

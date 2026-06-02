from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_admin
from app.models.chat import ChatMessage
from app.models.meal import Meal
from app.models.points import PointHistory
from app.models.user import User
from app.schemas.admin import (
    AdminUserDetail,
    AdminUserListItem,
    AdminUserListResponse,
    DashboardStats,
)
from app.schemas.chat import ChatMessageOut
from app.schemas.meal import MealOut
from app.schemas.points import PointHistoryItem

# 모든 엔드포인트가 get_current_admin 으로 보호된다 — 관리자가 아니면 403.
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)],
)

# '오늘'을 한국 시간 기준으로 묶기 위한 타임존 (points 라우터와 동일 기준).
KST = timezone(timedelta(hours=9))


# -- 대시보드 ---------------------------------------------------------------

@router.get("/stats/dashboard", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    """상단 요약 카드용 숫자들을 한 번에 모아 돌려준다."""
    today = datetime.now(KST).date()

    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    admin_count = db.scalar(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    ) or 0
    today_meals = db.scalar(
        select(func.count()).select_from(Meal).where(Meal.eaten_on == today)
    ) or 0
    total_chat_messages = db.scalar(
        select(func.count()).select_from(ChatMessage)
    ) or 0
    total_points_awarded = db.scalar(
        select(func.coalesce(func.sum(PointHistory.amount), 0))
    ) or 0

    return DashboardStats(
        total_users=total_users,
        admin_count=admin_count,
        today_meals=today_meals,
        total_chat_messages=total_chat_messages,
        total_points_awarded=total_points_awarded,
    )


# -- 회원 목록 / 검색 -------------------------------------------------------

@router.get("/users", response_model=AdminUserListResponse)
def list_users(
    q: str | None = Query(default=None, description="아이디/닉네임/이메일 부분검색"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> AdminUserListResponse:
    """회원 목록 — 검색어(q)와 페이지네이션 지원. 최신 가입순."""
    filters = []
    if q:
        like = f"%{q.strip()}%"
        filters.append(
            or_(
                User.user_id.ilike(like),
                User.nickname.ilike(like),
                User.email.ilike(like),
            )
        )

    total = db.scalar(
        select(func.count()).select_from(User).where(*filters)
    ) or 0

    # 회원별 식단 수를 한 번의 쿼리로 함께 가져온다 (N+1 방지).
    meal_count = func.count(Meal.id).label("meal_count")
    stmt = (
        select(User, meal_count)
        .outerjoin(Meal, Meal.user_id == User.id)
        .where(*filters)
        .group_by(User.id)
        .order_by(User.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    rows = db.execute(stmt).all()

    items = [
        AdminUserListItem(
            id=user.id,
            user_id=user.user_id,
            nickname=user.nickname,
            email=user.email,
            xp=user.xp,
            cp=user.cp,
            is_admin=user.is_admin,
            meal_count=cnt,
            created_at=user.created_at,
        )
        for user, cnt in rows
    ]

    return AdminUserListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


# -- 회원 상세 -------------------------------------------------------------

def _get_user_or_404(user_id: int, db: Session) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.get("/users/{user_id}", response_model=AdminUserDetail)
def get_user(user_id: int, db: Session = Depends(get_db)) -> AdminUserDetail:
    user = _get_user_or_404(user_id, db)

    meal_count = db.scalar(
        select(func.count()).select_from(Meal).where(Meal.user_id == user_id)
    ) or 0
    chat_count = db.scalar(
        select(func.count())
        .select_from(ChatMessage)
        .where(ChatMessage.user_id == user_id)
    ) or 0
    points_total = db.scalar(
        select(func.coalesce(func.sum(PointHistory.amount), 0)).where(
            PointHistory.user_id == user_id
        )
    ) or 0

    return AdminUserDetail(
        id=user.id,
        user_id=user.user_id,
        nickname=user.nickname,
        email=user.email,
        profile_image_path=user.profile_image_path,
        age=user.age,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        xp=user.xp,
        cp=user.cp,
        is_admin=user.is_admin,
        created_at=user.created_at,
        meal_count=meal_count,
        chat_count=chat_count,
        points_total=points_total,
    )


@router.get("/users/{user_id}/meals", response_model=list[MealOut])
def get_user_meals(
    user_id: int,
    date_from: DateType | None = Query(default=None, alias="from"),
    date_to: DateType | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
) -> list[Meal]:
    """특정 회원의 식단 기록 — 최신순. from/to 로 날짜 범위 필터."""
    _get_user_or_404(user_id, db)
    stmt = select(Meal).where(Meal.user_id == user_id)
    if date_from:
        stmt = stmt.where(Meal.eaten_on >= date_from)
    if date_to:
        stmt = stmt.where(Meal.eaten_on <= date_to)
    stmt = stmt.order_by(Meal.eaten_on.desc(), Meal.created_at.desc())
    return list(db.execute(stmt).scalars())


@router.get("/users/{user_id}/chat-messages", response_model=list[ChatMessageOut])
def get_user_chat(
    user_id: int,
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[ChatMessage]:
    """특정 회원의 채팅 내역 — 오래된 순(읽기 좋게). 최근 limit개."""
    _get_user_or_404(user_id, db)
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.id.desc())
        .limit(limit)
    )
    rows = list(db.execute(stmt).scalars())
    rows.reverse()
    return rows


@router.get("/users/{user_id}/points", response_model=list[PointHistoryItem])
def get_user_points(
    user_id: int,
    db: Session = Depends(get_db),
) -> list[PointHistory]:
    """특정 회원의 포인트 적립 내역 — 최신순."""
    _get_user_or_404(user_id, db)
    stmt = (
        select(PointHistory)
        .where(PointHistory.user_id == user_id)
        .order_by(PointHistory.id.desc())
    )
    return list(db.execute(stmt).scalars())

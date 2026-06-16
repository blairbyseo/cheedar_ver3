from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.points import PointHistory
from app.models.user import User
from app.schemas.points import (
    PointHistoryItem,
    PointRuleOut,
    PointSummary,
    RankingEntry,
    RankingResponse,
)
from app.services.points import (
    POINT_RULES,
    WEEK_GOAL_DAYS,
    level_for_xp,
    meal_dates_in_week,
)

router = APIRouter(prefix="/api/points", tags=["points"])

# 한국 시간 — 적립 시각(UTC 저장)을 '오늘/이번 주'로 묶을 때 기준.
KST = timezone(timedelta(hours=9))

RANKING_LIMIT = 100
RECENT_HISTORY_LIMIT = 10


@router.get("/me", response_model=PointSummary)
def my_points(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PointSummary:
    """현재 로그인한 환자의 XP/CP 현황 — 홈·포인트 화면이 함께 쓴다."""
    level, progress = level_for_xp(current_user.xp)

    history = list(
        db.execute(
            select(PointHistory)
            .where(PointHistory.user_id == current_user.id)
            .order_by(PointHistory.id.desc())
        ).scalars()
    )

    today = datetime.now(KST).date()
    this_week = today.isocalendar()[:2]
    # 이번 주에 식단을 기록한 날짜들 — 개수(week_record_days)와
    # 요일 체크 표시(week_record_weekdays)에 함께 쓴다.
    week_dates = meal_dates_in_week(db, current_user.id, today)
    earned_today = sum(
        h.amount
        for h in history
        if h.created_at.astimezone(KST).date() == today
    )
    earned_this_week = sum(
        h.amount
        for h in history
        if h.created_at.astimezone(KST).date().isocalendar()[:2] == this_week
    )

    return PointSummary(
        user_id=current_user.user_id,
        xp=current_user.xp,
        cp=current_user.cp,
        level=level,
        level_progress=progress,
        earned_today=earned_today,
        earned_this_week=earned_this_week,
        week_record_days=len(week_dates),
        # date.weekday(): 월=0 … 일=6 — 프론트 days 배열 순서와 그대로 맞는다.
        week_record_weekdays=sorted(d.weekday() for d in week_dates),
        week_goal_days=WEEK_GOAL_DAYS,
        rules=[PointRuleOut(**r) for r in POINT_RULES],
        recent_history=[
            PointHistoryItem.model_validate(h)
            for h in history[:RECENT_HISTORY_LIMIT]
        ],
    )


@router.get("/ranking", response_model=RankingResponse)
def ranking(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RankingResponse:
    """전체 환자를 XP 내림차순으로 정렬한 랭킹 (상위 100명).

    랭킹 기준은 CP 가 아니라 XP — XP 는 누적값이라 '꾸준함'을 반영한다.
    동점일 때는 먼저 가입한(=id 가 작은) 환자가 위로 간다.
    """
    rows = db.execute(
        select(User.id, User.user_id, User.xp, User.profile_image_path)
        .order_by(User.xp.desc(), User.id.asc())
        .limit(RANKING_LIMIT)
    ).all()

    top = [
        RankingEntry(
            rank=i + 1,
            user_id=row.user_id,
            xp=row.xp,
            level=level_for_xp(row.xp)[0],
            is_me=(row.id == current_user.id),
            profile_image_path=row.profile_image_path,
        )
        for i, row in enumerate(rows)
    ]

    # 내가 상위 100위 안에 있으면 그 항목을, 아니면 순위를 따로 계산해 채운다.
    me = next((e for e in top if e.is_me), None)
    if me is None:
        higher = db.execute(
            select(func.count())
            .select_from(User)
            .where(User.xp > current_user.xp)
        ).scalar_one()
        me = RankingEntry(
            rank=higher + 1,
            user_id=current_user.user_id,
            xp=current_user.xp,
            level=level_for_xp(current_user.xp)[0],
            is_me=True,
            profile_image_path=current_user.profile_image_path,
        )

    return RankingResponse(me=me, top=top)

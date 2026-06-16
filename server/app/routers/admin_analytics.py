"""관리자 분석 API (대시보드 차트용).

Cheddar_Team_26 의 admin_analytics.py 를 현재 스택(SQLAlchemy + 현재 모델)으로
옮긴 것. 4개 차트를 위한 집계 쿼리를 제공한다.

- activity-weekly : 주간 활동 통계(날짜별 활성 이용자/기록 수)
- record-frequency: 기록 빈도(daily | element | time)
- page-time       : 페이지별 소요 시간(PageTimeLog 집계, percentile_cont)
- user-flow       : 사용자 동선 Sankey 엣지(UserFlowLog 집계)

원본과의 차이(현재 모델 한계):
- 체중 로그 테이블이 없어 활동/기록 집계에서 체중은 제외(식단 Meal + 운동
  ExerciseLog 만 사용).
- Meal 에는 '건너뜀' 개념이 없어 요소별 통계에서 식사 skipped 는 항상 0.
- created_at 이 timezone-aware(UTC 저장)라, 시간대별 집계는 KST 로 변환한다.

모든 엔드포인트는 get_current_admin 으로 보호된다.
"""

from __future__ import annotations

from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_admin
from app.models.exercise import ExerciseLog
from app.models.meal import Meal, MealType
from app.models.telemetry import PageTimeLog, UserFlowLog
from app.schemas.analytics import (
    ActivityDailyItem,
    ActivityWeeklyResponse,
    PageTimeStatsItem,
    PageTimeStatsResponse,
    RecordFrequencyElementItem,
    RecordFrequencyResponse,
    RecordFrequencyTimeItem,
    UserFlowEdge,
    UserFlowResponse,
)

router = APIRouter(
    prefix="/api/admin/analytics",
    tags=["admin-analytics"],
    dependencies=[Depends(get_current_admin)],
)

DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
KST = timezone(timedelta(hours=9))

# 요소별 통계에서 한글 라벨 ↔ Meal.meal_type 매핑.
MEAL_LABELS: list[tuple[str, MealType]] = [
    ("아침", MealType.breakfast),
    ("점심", MealType.lunch),
    ("저녁", MealType.dinner),
    ("간식", MealType.snack),
]


def _resolve_range(
    from_date: DateType | None, to_date: DateType | None
) -> tuple[DateType, DateType]:
    """from/to 미지정 시 최근 7일(오늘 포함)로 채우고, 뒤집혔으면 교정."""
    today = datetime.now(KST).date()
    start = from_date or (today - timedelta(days=6))
    end = to_date or today
    if start > end:
        start, end = end, start
    return start, end


def _day_activity(db: Session, day: DateType) -> ActivityDailyItem:
    """특정 날짜의 활성 이용자 수와 기록 수(식단+운동)를 계산."""
    meal_user_ids = set(
        db.execute(select(Meal.user_id).where(Meal.eaten_on == day)).scalars().all()
    )
    exercise_user_ids = set(
        db.execute(
            select(ExerciseLog.user_id).where(ExerciseLog.done_on == day)
        ).scalars().all()
    )
    unique_users = len(meal_user_ids | exercise_user_ids)

    meal_count = db.scalar(
        select(func.count(Meal.id)).where(Meal.eaten_on == day)
    ) or 0
    exercise_count = db.scalar(
        select(func.count(ExerciseLog.id)).where(ExerciseLog.done_on == day)
    ) or 0

    day_name = DAY_NAMES[(day.weekday() + 1) % 7]
    return ActivityDailyItem(
        name=day_name, users=unique_users, records=meal_count + exercise_count
    )


def _daily_items(db: Session, start: DateType, end: DateType) -> list[ActivityDailyItem]:
    items: list[ActivityDailyItem] = []
    current = start
    while current <= end:
        items.append(_day_activity(db, current))
        current += timedelta(days=1)
    return items


@router.get("/activity-weekly", response_model=ActivityWeeklyResponse)
def get_activity_weekly(
    from_date: DateType | None = Query(None, alias="from"),
    to_date: DateType | None = Query(None, alias="to"),
    db: Session = Depends(get_db),
) -> ActivityWeeklyResponse:
    """주간 활동 통계: 날짜별 활성 이용자 수/기록 수. 미지정 시 최근 7일."""
    start, end = _resolve_range(from_date, to_date)
    return ActivityWeeklyResponse(items=_daily_items(db, start, end))


@router.get("/record-frequency", response_model=RecordFrequencyResponse)
def get_record_frequency(
    breakdown: str = Query("daily", description="daily | element | time"),
    from_date: DateType | None = Query(None, alias="from"),
    to_date: DateType | None = Query(None, alias="to"),
    db: Session = Depends(get_db),
) -> RecordFrequencyResponse:
    """기록 빈도 통계. breakdown: daily(날짜별)/element(요소별)/time(시간대별)."""
    start, end = _resolve_range(from_date, to_date)

    if breakdown == "daily":
        return RecordFrequencyResponse(daily=_daily_items(db, start, end))

    if breakdown == "element":
        element_items: list[RecordFrequencyElementItem] = []
        # 식사 4종 — Meal 에는 건너뜀 개념이 없어 skipped=0.
        for label, meal_type in MEAL_LABELS:
            recorded = db.scalar(
                select(func.count(Meal.id)).where(
                    Meal.meal_type == meal_type,
                    Meal.eaten_on >= start,
                    Meal.eaten_on <= end,
                )
            ) or 0
            element_items.append(
                RecordFrequencyElementItem(name=label, recorded=recorded, skipped=0)
            )
        # 운동 — ExerciseLog 는 is_skipped 가 있어 기록/건너뜀 구분 가능.
        ex_recorded = db.scalar(
            select(func.count(ExerciseLog.id)).where(
                ExerciseLog.done_on >= start,
                ExerciseLog.done_on <= end,
                ExerciseLog.is_skipped.is_(False),
            )
        ) or 0
        ex_skipped = db.scalar(
            select(func.count(ExerciseLog.id)).where(
                ExerciseLog.done_on >= start,
                ExerciseLog.done_on <= end,
                ExerciseLog.is_skipped.is_(True),
            )
        ) or 0
        element_items.append(
            RecordFrequencyElementItem(name="운동", recorded=ex_recorded, skipped=ex_skipped)
        )
        return RecordFrequencyResponse(element=element_items)

    if breakdown == "time":
        hour_counts: dict[int, int] = {h: 0 for h in range(24)}
        # 식단 created_at + 운동 created_at 을 KST 시(hour)로 버킷팅.
        for created_col, date_col in [
            (Meal.created_at, Meal.eaten_on),
            (ExerciseLog.created_at, ExerciseLog.done_on),
        ]:
            timestamps = db.execute(
                select(created_col).where(date_col >= start, date_col <= end)
            ).scalars().all()
            for created_at in timestamps:
                if created_at is None:
                    continue
                # tz-aware(UTC)면 KST 로, naive 면 그대로 hour 사용.
                local = created_at.astimezone(KST) if created_at.tzinfo else created_at
                hour_counts[local.hour] = hour_counts.get(local.hour, 0) + 1

        time_items = [
            RecordFrequencyTimeItem(name=f"{h:02d}시", records=hour_counts[h])
            for h in range(24)
        ]
        return RecordFrequencyResponse(time=time_items)

    return RecordFrequencyResponse()


def _datetime_bounds(
    start: DateType, end: DateType
) -> tuple[datetime, datetime]:
    """[start, end] 날짜를 반열린 datetime 구간 [start_dt, end_dt) 로."""
    start_dt = datetime.combine(start, datetime.min.time())
    end_dt = datetime.combine(end, datetime.min.time()) + timedelta(days=1)
    return start_dt, end_dt


@router.get("/page-time", response_model=PageTimeStatsResponse)
def get_page_time_stats(
    from_date: DateType | None = Query(None, alias="from"),
    to_date: DateType | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> PageTimeStatsResponse:
    """페이지 경로별 소요시간 집계(평균/중앙값/백분위수). PageTimeLog 기반."""
    statement = (
        select(
            PageTimeLog.page_path.label("page_path"),
            func.count(PageTimeLog.id).label("page_views"),
            func.sum(PageTimeLog.time_spent_seconds).label("total_time"),
            func.avg(PageTimeLog.time_spent_seconds).label("avg_time"),
            func.percentile_cont(0.5).within_group(PageTimeLog.time_spent_seconds).label("p50"),
            func.percentile_cont(0.9).within_group(PageTimeLog.time_spent_seconds).label("p90"),
            func.percentile_cont(0.95).within_group(PageTimeLog.time_spent_seconds).label("p95"),
        )
        .where(PageTimeLog.metric_type == "sample")
        .group_by(PageTimeLog.page_path)
        .order_by(func.sum(PageTimeLog.time_spent_seconds).desc())
        .limit(limit)
    )

    if from_date is not None or to_date is not None:
        start, end = _resolve_range(from_date, to_date)
        start_dt, end_dt = _datetime_bounds(start, end)
        statement = statement.where(
            PageTimeLog.created_at >= start_dt, PageTimeLog.created_at < end_dt
        )

    rows = db.execute(statement).all()
    items = [
        PageTimeStatsItem(
            name=row.page_path,
            avgTime=float(row.avg_time or 0.0),
            medianTime=float(row.p50 or 0.0),
            p50=float(row.p50 or 0.0),
            p90=float(row.p90 or 0.0),
            p95=float(row.p95 or 0.0),
            totalTime=float(row.total_time or 0.0),
            pageViews=int(row.page_views or 0),
        )
        for row in rows
    ]
    return PageTimeStatsResponse(items=items)


@router.get("/user-flow", response_model=UserFlowResponse)
def get_user_flow_edges(
    from_date: DateType | None = Query(None, alias="from"),
    to_date: DateType | None = Query(None, alias="to"),
    limit: int = Query(200, ge=1, le=2000),
    db: Session = Depends(get_db),
) -> UserFlowResponse:
    """사용자 동선 엣지(from_page -> to_page) 집계. Sankey 차트용."""
    statement = (
        select(
            UserFlowLog.from_page.label("from_page"),
            UserFlowLog.to_page.label("to_page"),
            func.count(UserFlowLog.id).label("transition_count"),
        )
        .group_by(UserFlowLog.from_page, UserFlowLog.to_page)
        .order_by(func.count(UserFlowLog.id).desc())
        .limit(limit)
    )

    if from_date is not None or to_date is not None:
        start, end = _resolve_range(from_date, to_date)
        start_dt, end_dt = _datetime_bounds(start, end)
        statement = statement.where(
            UserFlowLog.created_at >= start_dt, UserFlowLog.created_at < end_dt
        )

    rows = db.execute(statement).all()
    edges = [
        UserFlowEdge.model_validate(
            {"from": row.from_page, "to": row.to_page, "value": int(row.transition_count or 0)}
        )
        for row in rows
        if row.from_page and row.to_page
    ]
    return UserFlowResponse(edges=edges)

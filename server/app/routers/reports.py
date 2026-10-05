"""주간 리포트용 집계 API.

옛 웹(Cheddar_Team_26)은 4주 비교 그래프를 위해 28일 x (식단+운동) 를
하루씩 따로 조회했다. 여기서는 서버가 한 번에 주 단위로 집계해 돌려준다.
주간 리포트 상단의 AI 한마디(weekly-feedback)도 같은 집계를 재료로 쓴다.
"""
import json
from collections import defaultdict
from datetime import date as DateType
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.exercise import ExerciseLog
from app.models.meal import Meal, MealType
from app.models.user import User
from app.models.weekly_feedback import WeeklyFeedback
from app.services.openai_client import weekly_feedback_text
from app.services.record_dates import kst_today
from app.services.survey_context import build_survey_context

router = APIRouter(prefix="/api/reports", tags=["reports"])

_MAIN_MEALS = {MealType.breakfast, MealType.lunch, MealType.dinner}


class WeekStat(BaseModel):
    week_start: DateType  # 그 주 월요일
    weeks_ago: int  # 0 = 이번 주
    recorded_days: int  # 식단을 하나라도 기록한 날
    three_meal_days: int  # 아침·점심·저녁을 모두 기록한 날
    exercise_days: int  # 운동을 기록한 날('안 함' 제외)
    snack_count: int  # 간식 기록 횟수
    avg_calories: int  # 칼로리가 기록된 날 기준 일평균 섭취 칼로리


class _WeekDetail(WeekStat):
    """AI 한마디 재료용 — 끼니별로 기록한 날 수까지."""

    breakfast_days: int
    lunch_days: int
    dinner_days: int


class WeeklyFeedbackOut(BaseModel):
    week_start: DateType
    message: str


def _has_exercise(log: ExerciseLog) -> bool:
    """'안 함'이 아니고 운동 항목이 하나 이상인 기록인지 (주간 리포트 화면과 같은 기준)."""
    if log.is_skipped or not log.items:
        return False
    try:
        return len(json.loads(log.items)) > 0
    except (json.JSONDecodeError, TypeError):
        return False


def _week_details(db: Session, user_id: int, weeks: int) -> list[_WeekDetail]:
    """최근 N주(이번 주 포함, 월~일)를 오래된 주 → 이번 주 순으로 집계."""
    today = kst_today()
    this_monday = today - timedelta(days=today.weekday())
    first_monday = this_monday - timedelta(weeks=weeks - 1)
    end = this_monday + timedelta(days=6)

    meals = db.execute(
        select(Meal.eaten_on, Meal.meal_type, Meal.calories).where(
            Meal.user_id == user_id,
            Meal.eaten_on >= first_monday,
            Meal.eaten_on <= end,
        )
    ).all()
    exercise_logs = db.execute(
        select(ExerciseLog).where(
            ExerciseLog.user_id == user_id,
            ExerciseLog.done_on >= first_monday,
            ExerciseLog.done_on <= end,
        )
    ).scalars()

    types_by_day: dict[DateType, set[MealType]] = defaultdict(set)
    kcal_by_day: dict[DateType, int] = defaultdict(int)
    snacks_by_day: dict[DateType, int] = defaultdict(int)
    for eaten_on, meal_type, calories in meals:
        types_by_day[eaten_on].add(meal_type)
        kcal_by_day[eaten_on] += calories or 0
        if meal_type == MealType.snack:
            snacks_by_day[eaten_on] += 1
    exercise_days = {log.done_on for log in exercise_logs if _has_exercise(log)}

    details: list[_WeekDetail] = []
    for i in range(weeks):
        monday = first_monday + timedelta(weeks=i)
        days = [monday + timedelta(days=d) for d in range(7)]
        day_types = [types_by_day.get(d, set()) for d in days]
        kcal_days = [kcal_by_day[d] for d in days if kcal_by_day.get(d, 0) > 0]
        details.append(
            _WeekDetail(
                week_start=monday,
                weeks_ago=weeks - 1 - i,
                recorded_days=sum(1 for t in day_types if t),
                three_meal_days=sum(1 for t in day_types if _MAIN_MEALS.issubset(t)),
                exercise_days=sum(1 for d in days if d in exercise_days),
                snack_count=sum(snacks_by_day.get(d, 0) for d in days),
                avg_calories=round(sum(kcal_days) / len(kcal_days)) if kcal_days else 0,
                breakfast_days=sum(1 for t in day_types if MealType.breakfast in t),
                lunch_days=sum(1 for t in day_types if MealType.lunch in t),
                dinner_days=sum(1 for t in day_types if MealType.dinner in t),
            )
        )
    return details


@router.get("/weekly-compare", response_model=list[WeekStat])
def weekly_compare(
    weeks: int = Query(default=4, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WeekStat]:
    """최근 N주(이번 주 포함, 월~일)의 기록 현황. 오래된 주 → 이번 주 순."""
    return [
        WeekStat(**d.model_dump(include=set(WeekStat.model_fields)))
        for d in _week_details(db, current_user.id, weeks)
    ]


# -- 주간 AI 한마디 ------------------------------------------------------------

# 기록이 하나도 없는 주 — AI 를 부르지 않고 이 문구를 쓴다(탓하지 않기).
_EMPTY_WEEK_MESSAGE = (
    "이번 주는 아직 기록이 없어요. 오늘 한 끼만 가볍게 남겨볼까요? 체다가 같이 볼게요 🧀"
)
# AI 비활성/실패 시 기본 문구 — 저장하지 않아 다음에 다시 시도한다.
_FALLBACK_MESSAGE = (
    "이번 주도 기록을 남겨줘서 고마워요. 다음 주에도 지금처럼 한 끼씩 함께 채워가요!"
)


def _summary_for_ai(this_week: _WeekDetail, last_week: _WeekDetail, today: DateType) -> str:
    """AI 에 넘길 요약. 칼로리 수치는 일부러 넣지 않는다(평가 문구 방지)."""
    days_so_far = (today - this_week.week_start).days + 1
    return (
        f"[이번 주 — 월요일부터 오늘까지 {days_so_far}일]\n"
        f"- 식단을 기록한 날: {this_week.recorded_days}일\n"
        f"- 아침 기록한 날: {this_week.breakfast_days}일, 점심: {this_week.lunch_days}일, "
        f"저녁: {this_week.dinner_days}일\n"
        f"- 세 끼를 모두 기록한 날: {this_week.three_meal_days}일\n"
        f"- 운동을 기록한 날: {this_week.exercise_days}일\n"
        f"[지난 주 — 7일]\n"
        f"- 식단을 기록한 날: {last_week.recorded_days}일\n"
        f"- 세 끼를 모두 기록한 날: {last_week.three_meal_days}일\n"
        f"- 운동을 기록한 날: {last_week.exercise_days}일"
    )


@router.get("/weekly-feedback", response_model=WeeklyFeedbackOut)
def weekly_feedback(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WeeklyFeedbackOut:
    """이번 주 기록에 대한 체다의 한마디. (user, 주) 당 하루 한 번만 AI 로 만든다."""
    today = kst_today()
    last_week, this_week = _week_details(db, current_user.id, 2)

    if this_week.recorded_days == 0 and this_week.exercise_days == 0:
        return WeeklyFeedbackOut(week_start=this_week.week_start, message=_EMPTY_WEEK_MESSAGE)

    cached = db.execute(
        select(WeeklyFeedback).where(
            WeeklyFeedback.user_id == current_user.id,
            WeeklyFeedback.week_start == this_week.week_start,
        )
    ).scalar_one_or_none()
    if cached and cached.generated_on == today:
        return WeeklyFeedbackOut(week_start=cached.week_start, message=cached.message)

    message = weekly_feedback_text(
        _summary_for_ai(this_week, last_week, today),
        build_survey_context(db, current_user.id) or None,
    )
    if not message:
        return WeeklyFeedbackOut(week_start=this_week.week_start, message=_FALLBACK_MESSAGE)

    if cached:
        cached.message = message
        cached.generated_on = today
    else:
        db.add(
            WeeklyFeedback(
                user_id=current_user.id,
                week_start=this_week.week_start,
                generated_on=today,
                message=message,
            )
        )
    db.commit()
    return WeeklyFeedbackOut(week_start=this_week.week_start, message=message)

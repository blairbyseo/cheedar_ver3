import json
from datetime import date as DateType
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.exercise import ExerciseLog
from app.models.user import User
from app.schemas.exercise import (
    ExerciseAnalyzeRequest,
    ExerciseAnalyzeResponse,
    ExerciseItemOutput,
    ExerciseLogCreate,
    ExerciseLogOut,
)
from app.services.exercise import estimate_met, item_calories
from app.services.points import award_points_for_exercise

router = APIRouter(prefix="/api/exercise", tags=["exercise"])
settings = get_settings()


def _weight_kg(user: User) -> float:
    """회원가입 때 입력한 체중을 쓰고, 없으면 기본값으로 폴백."""
    weight = getattr(user, "weight_kg", None)
    return float(weight) if weight else float(settings.default_weight_kg)


def _row_to_out(row: ExerciseLog) -> ExerciseLogOut:
    items: list[ExerciseItemOutput] = []
    if row.items:
        try:
            parsed = json.loads(row.items)
            items = [
                ExerciseItemOutput(**it) for it in parsed if isinstance(it, dict)
            ]
        except (json.JSONDecodeError, ValueError, TypeError):
            items = []
    return ExerciseLogOut(
        id=row.id,
        done_on=row.done_on,
        is_skipped=row.is_skipped,
        calories_burned=row.calories_burned,
        items=items,
    )


@router.post("", response_model=ExerciseLogOut)
def upsert_exercise(
    payload: ExerciseLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExerciseLogOut:
    """하루치 운동 기록을 저장/갱신한다 (UPSERT by user+date).

    - items 가 비어 있고 is_skipped=False 면 400.
    - 각 item 의 calories_burned 는 서버에서 MET×체중×시간×강도계수로 재계산.
    """
    if not payload.is_skipped and not payload.items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "items_required")

    done_on = payload.done_on or datetime.now().date()
    weight = _weight_kg(current_user)

    output_items: list[ExerciseItemOutput] = []
    total_calories = 0.0
    if not payload.is_skipped:
        for item in payload.items:
            kcal = item_calories(item, weight)
            total_calories += kcal
            output_items.append(
                ExerciseItemOutput(
                    exercise_name=item.exercise_name,
                    met=item.met,
                    duration_hours=item.duration_hours,
                    duration_minutes=item.duration_minutes,
                    intensity=item.intensity,
                    calories_burned=kcal,
                )
            )

    items_json = (
        json.dumps([o.model_dump() for o in output_items], ensure_ascii=False)
        if output_items
        else None
    )
    calories_total = 0.0 if payload.is_skipped else round(total_calories, 1)

    existing = db.execute(
        select(ExerciseLog).where(
            ExerciseLog.user_id == current_user.id,
            ExerciseLog.done_on == done_on,
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = ExerciseLog(
            user_id=current_user.id,
            done_on=done_on,
            is_skipped=payload.is_skipped,
            calories_burned=calories_total,
            items=items_json,
        )
        db.add(existing)
    else:
        existing.is_skipped = payload.is_skipped
        existing.calories_burned = calories_total
        existing.items = items_json

    # flush 로 운동 행을 먼저 반영한다 — 주간 보너스 집계
    # (count_exercise_days_in_week) 가 방금 저장한 날까지 포함해서 세도록.
    # 운동 저장과 XP/CP 적립을 한 트랜잭션으로 함께 커밋한다.
    db.flush()
    award_points_for_exercise(db, current_user, existing)
    db.commit()
    db.refresh(existing)
    return _row_to_out(existing)


@router.get("", response_model=list[ExerciseLogOut])
def list_exercise(
    on: DateType | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ExerciseLogOut]:
    """운동 기록 조회. `on` 지정 시 그 날짜만(보통 0~1건)."""
    stmt = select(ExerciseLog).where(ExerciseLog.user_id == current_user.id)
    if on:
        stmt = stmt.where(ExerciseLog.done_on == on)
    stmt = stmt.order_by(ExerciseLog.done_on.desc())
    return [_row_to_out(row) for row in db.execute(stmt).scalars()]


@router.post("/analyze", response_model=ExerciseAnalyzeResponse)
def analyze_exercise(
    payload: ExerciseAnalyzeRequest,
    _: User = Depends(get_current_user),
) -> ExerciseAnalyzeResponse:
    """사전 MET DB에 없는 운동명의 MET 을 AI로 추정한다."""
    result = estimate_met(payload.exercise_name)
    return ExerciseAnalyzeResponse(**result)

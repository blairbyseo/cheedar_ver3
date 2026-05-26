from datetime import date as DateType
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.meal import Meal, MealType
from app.models.user import User
from app.schemas.meal import (
    AIAnalysisResult,
    DailyStatusItem,
    DailyStatusResponse,
    MealCreate,
    MealOut,
    MealUpdate,
)
from app.services.openai_client import analyze_meal_image
from app.services.points import award_points_for_meal
from app.services.uploads import save_meal_image

router = APIRouter(prefix="/api/meals", tags=["meals"])


# -- AI analysis ------------------------------------------------------------

@router.post("/analyze", response_model=AIAnalysisResult)
def analyze_image(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
) -> AIAnalysisResult:
    abs_path, public_url = save_meal_image(file)
    result = analyze_meal_image(Path(abs_path))
    return AIAnalysisResult(image_path=public_url, **result)


# -- CRUD -------------------------------------------------------------------

@router.post("", response_model=MealOut, status_code=status.HTTP_201_CREATED)
def create_meal(
    payload: MealCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Meal:
    meal = Meal(
        user_id=current_user.id,
        meal_type=payload.meal_type,
        eaten_on=payload.eaten_on or datetime.now().date(),
        menu=payload.menu,
        calories=payload.calories,
        protein_g=payload.protein_g,
        carbs_g=payload.carbs_g,
        fat_g=payload.fat_g,
        image_path=payload.image_path,
        ai_summary=payload.ai_summary,
        ai_comment=payload.ai_comment,
    )
    db.add(meal)
    # flush 로 meal.id 를 먼저 확보한다 — 포인트 적립이 meal.id 를 중복 방지
    # 키로 쓰기 때문. 식단 저장과 XP/CP 적립을 한 트랜잭션으로 함께 커밋한다.
    db.flush()
    award_points_for_meal(db, current_user, meal)
    db.commit()
    db.refresh(meal)
    return meal


@router.get("", response_model=list[MealOut])
def list_meals(
    on: DateType | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Meal]:
    stmt = select(Meal).where(Meal.user_id == current_user.id)
    if on:
        stmt = stmt.where(Meal.eaten_on == on)
    stmt = stmt.order_by(Meal.eaten_on.desc(), Meal.created_at.desc())
    return list(db.execute(stmt).scalars())


@router.get("/today/status", response_model=DailyStatusResponse)
def today_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DailyStatusResponse:
    today = datetime.now().date()
    stmt = select(Meal.meal_type).where(
        Meal.user_id == current_user.id, Meal.eaten_on == today
    )
    done_types = {row for row in db.execute(stmt).scalars()}

    items = [
        DailyStatusItem(
            meal_type=t,
            state="done" if t in done_types else "missing",
        )
        for t in MealType
    ]
    return DailyStatusResponse(
        date=today,
        recorded_count=len(done_types),
        total=len(items),
        items=items,
    )


def _get_owned_meal(
    meal_id: int, db: Session, current_user: User
) -> Meal:
    meal = db.get(Meal, meal_id)
    if not meal or meal.user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meal not found")
    return meal


@router.get("/{meal_id}", response_model=MealOut)
def get_meal(
    meal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Meal:
    return _get_owned_meal(meal_id, db, current_user)


@router.patch("/{meal_id}", response_model=MealOut)
def update_meal(
    meal_id: int,
    payload: MealUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Meal:
    meal = _get_owned_meal(meal_id, db, current_user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(meal, field, value)
    db.commit()
    db.refresh(meal)
    return meal


@router.delete("/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(
    meal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    meal = _get_owned_meal(meal_id, db, current_user)
    db.delete(meal)
    db.commit()

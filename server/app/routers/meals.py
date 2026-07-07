import json
import uuid
from datetime import date as DateType
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.meal import Meal, MealType
from app.models.user import User
from app.schemas.meal import (
    AIAnalysisResult,
    AnalyzeItemRequest,
    AnalyzeItemResponse,
    ApplyDeltaRequest,
    ApplyDeltaResponse,
    DailyStatusItem,
    DailyStatusResponse,
    MealCreate,
    MealItem,
    MealOut,
    MealUpdate,
)
from app.services.openai_client import (
    analyze_meal_image,
    analyze_single_item,
    apply_delta_to_items,
)
from app.services.points import award_points_for_meal
from app.services.uploads import save_meal_image

router = APIRouter(prefix="/api/meals", tags=["meals"])


# -- AI analysis ------------------------------------------------------------


def _sanitize_items(raw_items: object) -> list[MealItem]:
    """LLM 이 준 items 배열을 방어적으로 정규화한다.

    - 이름 없는 항목 제거
    - quantity None/음수 → 1.0
    - unit 비어있으면 "개" (프론트 드롭다운 유효값 보장)
    """
    items: list[MealItem] = []
    if not isinstance(raw_items, list):
        return items
    for x in raw_items:
        if not isinstance(x, dict):
            continue
        name = str(x.get("name") or "").strip()
        if not name:
            continue

        q_raw = x.get("quantity")
        try:
            q = float(q_raw) if q_raw is not None else 1.0
        except (TypeError, ValueError):
            q = 1.0
        if q < 0.1:
            q = 1.0

        unit = str(x.get("unit")).strip() if x.get("unit") else ""
        if not unit:
            unit = "개"

        items.append(
            MealItem(
                name=name,
                calories=x.get("calories"),
                carbs=x.get("carbs"),
                protein=x.get("protein"),
                fat=x.get("fat"),
                quantity=q,
                unit=unit,
                is_ingredient=x.get("is_ingredient"),
            )
        )
    return items


@router.post("/analyze", response_model=AIAnalysisResult)
def analyze_image(
    file: UploadFile | None = File(default=None),
    meal_time: str = Form(default=""),
    description: str = Form(default=""),
    _: User = Depends(get_current_user),
) -> AIAnalysisResult:
    if file is None and not (description or "").strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "사진이나 설명 중 하나는 필요해요."
        )

    public_url: str | None = None
    abs_path: Path | None = None
    if file is not None:
        saved_path, public_url = save_meal_image(file)
        abs_path = Path(saved_path)

    data = analyze_meal_image(
        abs_path, meal_time=meal_time, description=description or ""
    )
    items = _sanitize_items(data.get("items"))
    return AIAnalysisResult(
        analysis_id=str(uuid.uuid4()),
        image_path=public_url,
        items=items,
        suggested_description=data.get("suggested_description"),
        calories=data.get("calories"),
        carbs=data.get("carbs"),
        protein=data.get("protein"),
        fat=data.get("fat"),
        foods=[i.name for i in items],
        confidence=data.get("confidence"),
        notes=data.get("notes"),
    )


@router.post("/analyze-item", response_model=AnalyzeItemResponse)
def analyze_item(
    payload: AnalyzeItemRequest,
    _: User = Depends(get_current_user),
) -> AnalyzeItemResponse:
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "음식 이름이 필요해요.")

    quantity = payload.quantity if payload.quantity and payload.quantity > 0 else 1.0
    unit = (payload.unit or "").strip() or "개"

    data = analyze_single_item(name, quantity, unit)

    def _num(v: object) -> float | None:
        if v is None:
            return None
        try:
            n = float(v)
            return n if n >= 0 else None
        except (TypeError, ValueError):
            return None

    return AnalyzeItemResponse(
        calories=_num(data.get("calories")),
        carbs=_num(data.get("carbs")),
        protein=_num(data.get("protein")),
        fat=_num(data.get("fat")),
        notes=data.get("notes"),
    )


@router.post("/apply-delta", response_model=ApplyDeltaResponse)
def apply_delta(
    payload: ApplyDeltaRequest,
    _: User = Depends(get_current_user),
) -> ApplyDeltaResponse:
    delta = (payload.delta_text or "").strip()
    if not delta:
        return ApplyDeltaResponse(items=payload.items, notes=None)

    data = apply_delta_to_items(
        [it.model_dump() for it in payload.items], delta
    )
    new_items = _sanitize_items(data.get("items"))
    # 파싱 실패로 비었는데 원본이 있었으면 원본 유지 (데이터 소실 방지)
    if not new_items and payload.items:
        return ApplyDeltaResponse(
            items=payload.items,
            notes="수정사항 반영이 안정적으로 완료되지 않아 기존 상태를 유지했어요. 다시 시도해주세요.",
        )
    return ApplyDeltaResponse(items=new_items, notes=data.get("notes"))


# -- CRUD -------------------------------------------------------------------

@router.post("", response_model=MealOut, status_code=status.HTTP_201_CREATED)
def create_meal(
    payload: MealCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Meal:
    items_json = (
        json.dumps([it.model_dump() for it in payload.items], ensure_ascii=False)
        if payload.items
        else None
    )
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
        ai_notes=payload.ai_notes,
        ai_confidence=payload.ai_confidence,
        items=items_json,
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

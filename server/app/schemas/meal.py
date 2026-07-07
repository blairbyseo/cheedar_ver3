from datetime import date as DateType
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.meal import MealType


class MealItem(BaseModel):
    """분석된 음식 항목 하나. (Cheddar_Team_26 DietAnalyzeItem 이식)

    영양소 필드는 항목 단위 명칭(carbs/protein/fat)을 쓴다. 식사 전체 합계는
    Meal 의 calories/protein_g/carbs_g/fat_g 컬럼에 별도로 저장된다.
    """

    name: str
    calories: float | None = None
    carbs: float | None = None
    protein: float | None = None
    fat: float | None = None
    quantity: float | None = None
    unit: str | None = None
    is_ingredient: bool | None = None


class MealCreate(BaseModel):
    meal_type: MealType
    eaten_on: DateType | None = None  # default to today server-side
    menu: str | None = Field(default=None, max_length=120)
    calories: int | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    image_path: str | None = None
    ai_summary: str | None = None
    ai_comment: str | None = None
    ai_notes: str | None = None
    ai_confidence: float | None = None
    items: list[MealItem] | None = None  # AI 분석 항목들 (DB엔 JSON 문자열로 저장)


class MealUpdate(BaseModel):
    meal_type: MealType | None = None
    menu: str | None = Field(default=None, max_length=120)
    calories: int | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    image_path: str | None = None
    ai_summary: str | None = None
    ai_comment: str | None = None


class MealOut(BaseModel):
    id: int
    meal_type: MealType
    eaten_on: DateType
    menu: str | None
    calories: int | None
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None
    image_path: str | None
    ai_summary: str | None
    ai_comment: str | None
    ai_notes: str | None = None
    ai_confidence: float | None = None
    items: str | None = None  # 항목 JSON 문자열 (프론트에서 JSON.parse)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DailyStatusItem(BaseModel):
    meal_type: MealType
    state: str  # "done" | "missing" | "upcoming"


class DailyStatusResponse(BaseModel):
    date: DateType
    recorded_count: int
    total: int
    items: list[DailyStatusItem]


class AIAnalysisResult(BaseModel):
    """/api/meals/analyze 응답 — 음식 항목별 분석 결과."""

    analysis_id: str  # 매 분석마다 서버 생성 (편집 세션 식별용, 저장은 안 함)
    image_path: str | None = None
    items: list[MealItem] = []
    suggested_description: str | None = None
    calories: float | None = None
    carbs: float | None = None
    protein: float | None = None
    fat: float | None = None
    foods: list[str] = []
    confidence: float | None = None
    notes: str | None = None


class AnalyzeItemRequest(BaseModel):
    """단일 음식 항목 영양소 재추정 요청."""

    name: str
    quantity: float | None = None
    unit: str | None = None


class AnalyzeItemResponse(BaseModel):
    calories: float | None = None
    carbs: float | None = None
    protein: float | None = None
    fat: float | None = None
    notes: str | None = None


class ApplyDeltaRequest(BaseModel):
    """저장된 항목에 자연어 수정지시를 적용하는 요청."""

    items: list[MealItem]
    delta_text: str = Field(..., max_length=2000)


class ApplyDeltaResponse(BaseModel):
    items: list[MealItem]
    notes: str | None = None

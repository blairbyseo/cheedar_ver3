from datetime import date as DateType
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.meal import MealType


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
    summary: str
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    comment: str
    image_path: str

from datetime import datetime

from pydantic import BaseModel, Field


class EmotionLogCreate(BaseModel):
    score: int = Field(
        ..., ge=1, le=10, description="1=너무 나쁨 ~ 10=너무 좋음 (10단계 기분 점수)"
    )
    emotion_label: str = Field(..., max_length=40)
    note: str | None = Field(default=None, max_length=500)


class EmotionLogOut(BaseModel):
    id: int
    occurred_at: datetime
    emotion_label: str
    score: int
    note: str | None = None

    class Config:
        from_attributes = True


class TodayStatusOut(BaseModel):
    has_logged_today: bool

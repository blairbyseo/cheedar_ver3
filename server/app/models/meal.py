import enum
from datetime import date as DateType
from datetime import datetime

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MealType(str, enum.Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    meal_type: Mapped[MealType] = mapped_column(
        Enum(MealType, name="meal_type"), index=True
    )
    eaten_on: Mapped[DateType] = mapped_column(Date, index=True)
    # 사진 촬영 시각 = 실제 식사 시각의 근사값. 사진(EXIF)에 적힌 기기 현지
    # 벽시계 시각이라 시간대 없이 저장한다. 사진이 없거나 시각 정보가 없는
    # 사진(받은 사진·스크린샷)은 None. 날짜가 eaten_on 과 다를 수 있다
    # (예전에 찍어 둔 사진으로 오늘 식단을 기록한 경우).
    taken_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    menu: Mapped[str | None] = mapped_column(String(120), nullable=True)
    calories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_comment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # AI 분석 부가 정보 (항목별 분석 이식)
    #   ai_notes      : 분석 실패 사유나 수정 반영 메모.
    #   ai_confidence : 전체 인식 자신감 0~1.
    #   items         : 음식 항목 배열의 JSON 문자열 (MealItem[]).
    ai_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    items: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

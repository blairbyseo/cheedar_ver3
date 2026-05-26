import enum
from datetime import date as DateType
from datetime import datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, func
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

    menu: Mapped[str | None] = mapped_column(String(120), nullable=True)
    calories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_comment: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

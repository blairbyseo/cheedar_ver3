from datetime import date as DateType
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExerciseLog(Base):
    """하루치 운동 기록 — 환자·날짜당 한 행(UPSERT).

    식단(Meal)은 끼니마다 한 행이지만, 운동은 Cheddar_Team_26 참고 구현처럼
    `(user, date)` 한 행에 여러 운동을 items(JSON 문자열)로 담는다.
    각 item: {exercise_name, met, duration_hours, duration_minutes,
              intensity, calories_burned}.
    calories_burned 는 그날 전체 소모 칼로리 합계(서버 계산값).
    is_skipped=True 면 "운동 안 함"으로 기록한 날이고 items 는 비어 있다.
    """

    __tablename__ = "exercise_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "done_on", name="uq_exercise_user_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    done_on: Mapped[DateType] = mapped_column(Date, index=True)

    is_skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    calories_burned: Mapped[float | None] = mapped_column(Float, nullable=True)
    items: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON 문자열

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

from datetime import date as DateType
from datetime import datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DailySleep(Base):
    """스마트폰 건강 데이터에서 받은 '하룻밤' 수면 (user, day 당 한 행).

    Health Connect/HealthKit 은 수면을 일별 합계가 아니라 '조각(세션·단계)' 목록으로
    주므로, 앱이 조각을 합쳐 밤 단위로 만들어 올린다(src/health/healthData.js).
    `day` 는 **일어난 날짜**(자정을 넘겨 자므로 잠든 날이 아니라 깬 날 기준).
    `asleep_minutes` 는 중간에 깬 구간을 뺀 실제 수면 분.

    걸음수(DailySteps)와 같은 원칙: 포인트 적립 X, 맥락(채팅·리포트·동기 점검)으로만.
    """

    __tablename__ = "daily_sleep"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_daily_sleep_user_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    day: Mapped[DateType] = mapped_column(Date, index=True)
    asleep_minutes: Mapped[int] = mapped_column(Integer)
    bed_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    wake_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="health_connect")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

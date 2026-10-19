from datetime import date as DateType
from datetime import datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DailySteps(Base):
    """스마트폰 건강 데이터에서 받은 하루 걸음수 (user, day 당 한 행).

    앱(Capacitor)이 Health Connect(안드로이드)/HealthKit(iOS)에서 최근 며칠치
    일별 합계를 읽어 올려 보낸다. 같은 날은 덮어쓴다(폰 쪽이 항상 정답).

    설계 원칙(2026-10-12 결정):
    - 포인트 적립에 쓰지 않는다. 주간 리포트·동기 점검·AI 선인사 맥락으로만 쓴다.
    - 운동/음식 칼로리와 절대 연결하지 않는다(보상행동 유발).
    - 데이터가 없어도(웹·권한 거절) 모든 기능이 그대로 동작해야 한다.
    """

    __tablename__ = "daily_steps"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_daily_steps_user_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    day: Mapped[DateType] = mapped_column(Date, index=True)
    steps: Mapped[int] = mapped_column(Integer)
    # 어디서 온 숫자인지 — "health_connect" | "healthkit". 나중에 출처별 품질 비교용.
    source: Mapped[str] = mapped_column(String(32), default="health_connect")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

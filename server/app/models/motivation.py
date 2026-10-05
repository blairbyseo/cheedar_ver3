from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MotivationCheck(Base):
    """주 1회 동기 점검 기록 (time-series).

    설문 B-2 의 readiness ruler 중 두 축을 주기적으로 다시 묻는다.
      importance  : 식습관·생활을 바꾸는 게 얼마나 중요한지 (0~10, 설문 B-2-1)
      confidence  : 바꿀 수 있다는 자신감 (0~10, 설문 B-2-2)
    weight_kg 은 같은 창에서 선택 입력. 섭식 고위험군에게는 묻지 않는다.
    """

    __tablename__ = "motivation_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    importance: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[int] = mapped_column(Integer)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

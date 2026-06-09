"""위험 감지 이벤트(SafetyEvent) — 관리자 위험 모니터링용.

Cheddar_Team_26 의 SafetyEvent 를 이 프로젝트 스타일로 옮긴 최소 버전.
출처는 두 가지를 모두 허용한다:
  - 챗봇 메시지(message_id 채워짐) — 추후 챗 위험 감지 연동용.
  - 설문 응답(message_id=None, detected_category 가 "survey_" 로 시작) —
    지금 이식하는 설문 채점에서 위험 플래그가 떴을 때 적재된다.
"""
import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RiskLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


_risk_enum = Enum(
    RiskLevel,
    name="risk_level",
    values_callable=lambda obj: [e.value for e in obj],
)


class SafetyEvent(Base):
    """위험 감지 이벤트 한 건.

    - risk_level: 심각도(low~critical).
    - detected_category: 출처/유형 키(예: "survey_suicide_acute").
    - description: 운영자 추적용 메모(예: "survey_response_id=12; flag=...").
    - status / is_resolved: 관리자 화면 처리 상태.
    """

    __tablename__ = "safety_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # 챗봇 메시지 출처일 때만 채워진다. 설문 출처면 None.
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True
    )
    risk_level: Mapped[RiskLevel] = mapped_column(_risk_enum, nullable=False)
    detected_category: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-100
    ai_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'unresolved'")
    )  # unresolved | reviewing | resolved
    is_resolved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EmotionLog(Base):
    """하루치 감정 체크인 기록 (time-series).

    Cheddar_Team_26 참고 구현의 daily check-in 을 이식한 것. 사용자가 하루 1회
    채팅 진입 시 1~10 슬라이더로 현재 기분을 남기면 한 행이 쌓인다.
    `occurred_at` 은 사용자가 기분을 남긴 시각(이벤트 시각), `created_at` 은 행
    생성 시각. 보통 둘이 같지만 의미를 구분해 둔다.

    score 는 1(너무 나쁨)~10(너무 좋음). emotion_label 은 그 점수에 대응하는
    한글 라벨("좋음" 등) 스냅샷이다. 채팅 개인화에서 점수(숫자)는 노출하지 않고
    라벨/뉘앙스만 응답 톤에 반영한다(emotion_context 참고).
    """

    __tablename__ = "emotion_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    emotion_label: Mapped[str] = mapped_column(String(40))
    score: Mapped[int] = mapped_column(Integer, default=5)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

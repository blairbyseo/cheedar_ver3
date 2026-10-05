from datetime import date as DateType
from datetime import datetime

from sqlalchemy import Date, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class WeeklyFeedback(Base):
    """주간 리포트 상단의 AI 한마디 캐시.

    (user, 주) 당 한 행. 화면을 열 때마다 AI 를 부르지 않도록, 그날 처음
    열 때 한 번 만들어 저장하고 같은 날에는 저장된 문구를 그대로 보여준다.
    날짜가 바뀌면(generated_on < 오늘) 그 주의 최신 기록으로 다시 만든다.
    """

    __tablename__ = "weekly_feedbacks"
    __table_args__ = (UniqueConstraint("user_id", "week_start"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    week_start: Mapped[DateType] = mapped_column(Date)  # 그 주 월요일
    generated_on: Mapped[DateType] = mapped_column(Date)  # 문구를 만든 날(KST)
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

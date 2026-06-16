from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PageTimeLog(Base):
    """사용자 앱이 보내는 '페이지 체류시간' 원시 샘플 1건.

    관리자 분석(페이지별 소요 시간)에서 평균/중앙값/백분위수로 집계된다.
    Cheddar_Team_26 의 PageTimeLog 를 현재 스택(SQLAlchemy)으로 옮긴 것.
    metric_type 은 향후 확장 여지를 위해 두되, 집계는 'sample' 만 사용한다.
    """

    __tablename__ = "page_time_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    page_path: Mapped[str] = mapped_column(String(255), index=True)
    time_spent_seconds: Mapped[float] = mapped_column(Float)
    metric_type: Mapped[str] = mapped_column(String(20), default="sample")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class UserFlowLog(Base):
    """페이지 전환(from_page -> to_page) 원시 샘플 1건.

    관리자 분석(사용자 동선 Sankey)에서 전환 횟수로 집계된다.
    """

    __tablename__ = "user_flow_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    from_page: Mapped[str] = mapped_column(String(255), index=True)
    to_page: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PointHistory(Base):
    """포인트가 적립된 1건의 기록(원장).

    XP/CP 의 '현재 잔액'은 users 테이블의 xp/cp 컬럼에 합산돼 있고,
    이 표는 '언제·무슨 규칙으로·얼마' 적립됐는지를 한 줄씩 남긴다.
    같은 적립이 중복으로 들어가지 않도록 (user_id, rule, dedup_key) 에
    유니크 제약을 둔다.
    """

    __tablename__ = "point_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # 적립 규칙 키 — services/points.py 의 RULE_* 상수와 동일 (예: "meal-check").
    rule: Mapped[str] = mapped_column(String(20))
    # 이번 적립으로 오른 값 — XP·CP 에 같은 값이 더해진다.
    amount: Mapped[int] = mapped_column(Integer)
    # 화면 표시용 라벨 (예: "아침 기록 완료").
    label: Mapped[str] = mapped_column(String(80))

    # 중복 적립 방지 키 — rule 별로 의미가 다르다:
    #   meal-check  → "meal:{meal_id}"      (식단 1건당 1회)
    #   three-meals → "day:{YYYY-MM-DD}"    (하루 1회)
    #   weekly-goal → "week:{YYYY-Www}"     (한 주 1회)
    #   full-week   → "week:{YYYY-Www}"     (한 주 1회)
    dedup_key: Mapped[str] = mapped_column(String(40))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "rule", "dedup_key", name="uq_point_history_award"
        ),
    )

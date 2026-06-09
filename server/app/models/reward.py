"""보상 지급 신청(RewardClaim) 모델.

'최종 레벨 도달 → 현금 보상' 트랙의 기록 테이블. 실제 송금은 사람(관리자)이
하고, 이 표는 "누가·언제·얼마를 신청했고, 관리자가 처리했는지"만 남긴다.

흐름(2단계):
    사용자가 최종 레벨 도달 → 신청(POST) → status=pending 행 생성
        → 관리자가 목록 확인 → 실제 송금 → status=paid 로 표시

한 사용자는 같은 종류(kind) 보상을 한 번만 신청할 수 있다
(uq_reward_claim_user_kind). 부정 적발 등으로 관리자가 status=rejected 로
둘 수도 있으며, 그 경우에도 같은 종류로 재신청은 막힌다.

amount/level_at_claim/xp_at_claim 은 '신청 시점'의 스냅샷이다 — 나중에
설정값(보상 금액)이나 사용자 XP 가 바뀌어도 신청 당시 값이 그대로 남도록.
"""
import enum
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RewardClaimStatus(str, enum.Enum):
    """보상 신청 처리 상태.

    pending  : 신청됨, 관리자 처리 대기.
    paid     : 관리자가 실제 송금하고 지급완료로 표시.
    rejected : 관리자가 반려(부정 적발 등). 재신청 불가.
    """

    PENDING = "pending"
    PAID = "paid"
    REJECTED = "rejected"


# enum NAME 이 아니라 VALUE("pending" 등)를 DB 에 저장 — 마이그레이션에서 만든
# postgres enum 타입 값과 일치시키기 위함(survey 모델과 동일한 방식).
_status_enum = Enum(
    RewardClaimStatus,
    name="reward_claim_status",
    values_callable=lambda obj: [e.value for e in obj],
)

# 보상 종류 키 — 지금은 '최종 레벨' 하나지만, 나중에 다른 1회성 보상이
# 생기면 같은 표에 kind 만 달리해서 쌓는다. services/rewards.py 와 공유.
KIND_FINAL_LEVEL = "final-level"


class RewardClaim(Base):
    __tablename__ = "reward_claims"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", name="uq_reward_claim_user_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # 보상 종류 — 현재 "final-level" 만. (KIND_* 상수와 동일하게 유지)
    kind: Mapped[str] = mapped_column(String(20))

    # 신청 시점 스냅샷.
    level_at_claim: Mapped[int] = mapped_column(Integer)
    xp_at_claim: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer)  # 지급 예정 현금(원)

    status: Mapped[RewardClaimStatus] = mapped_column(
        _status_enum,
        nullable=False,
        default=RewardClaimStatus.PENDING,
        index=True,
    )

    # 관리자 메모 — 송금 일자/방법, 반려 사유 등 자유 기록.
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 처리한 관리자(누가 지급/반려했는지). 관리자 계정 삭제 시 NULL.
    processed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

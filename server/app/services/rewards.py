"""최종 레벨 현금 보상 — 자격 판정 + 신청 로직.

레벨은 XP 로만 오르므로(services/points.level_for_xp), '최종 레벨 도달'은
순수하게 XP 기반 1회성 업적이다. CP(소비 포인트)와는 무관하다.

핵심 규칙
  - 자격: 현재 레벨 >= settings.final_level (도달자 전원).
  - 신청: 자격이 있고 아직 신청 이력이 없을 때만. 신청하면 pending 행 1개.
  - 한 사용자는 같은 보상을 한 번만 신청(모델의 uq_reward_claim_user_kind).
  - 실제 송금/지급완료 표시는 관리자(routers/admin.py)가 한다.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.reward import KIND_FINAL_LEVEL, RewardClaim, RewardClaimStatus
from app.models.user import User
from app.services.points import level_for_xp


class RewardError(Exception):
    """보상 신청 거절 사유를 코드 문자열로 실어 나르는 예외.

    라우터가 .code 를 그대로 HTTP 에러 detail 로 변환한다
    (not_eligible → 403, already_claimed → 409).
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def current_level(user: User) -> int:
    """사용자의 현재 레벨 — XP 로 계산(진행률은 버린다)."""
    return level_for_xp(user.xp)[0]


def is_eligible(user: User, settings: Settings) -> bool:
    """현재 레벨이 최종 레벨 이상이면 보상 자격 있음."""
    return current_level(user) >= settings.final_level


def get_final_level_claim(db: Session, user: User) -> RewardClaim | None:
    """이 사용자의 최종 레벨 보상 신청 1건(있으면). 없으면 None."""
    return db.execute(
        select(RewardClaim).where(
            RewardClaim.user_id == user.id,
            RewardClaim.kind == KIND_FINAL_LEVEL,
        )
    ).scalar_one_or_none()


def claim_final_level_reward(
    db: Session, user: User, settings: Settings
) -> RewardClaim:
    """최종 레벨 보상을 신청한다(pending 1건 생성).

    거절 사유
      - 자격 미달(현재 레벨 < final_level)  → RewardError("not_eligible")
      - 이미 신청한 이력이 있음             → RewardError("already_claimed")

    동시에 두 번 눌러도 모델의 (user_id, kind) 유니크 제약이 두 번째 INSERT 를
    막는다 — 그 경우 IntegrityError 를 already_claimed 로 변환한다.
    """
    if not is_eligible(user, settings):
        raise RewardError("not_eligible")
    if get_final_level_claim(db, user) is not None:
        raise RewardError("already_claimed")

    claim = RewardClaim(
        user_id=user.id,
        kind=KIND_FINAL_LEVEL,
        level_at_claim=current_level(user),
        xp_at_claim=user.xp,
        amount=settings.final_level_reward_amount,
        status=RewardClaimStatus.PENDING,
    )
    db.add(claim)
    try:
        db.commit()
    except IntegrityError as exc:  # 동시 신청 경합 — 유니크 제약 위반
        db.rollback()
        raise RewardError("already_claimed") from exc
    db.refresh(claim)
    return claim

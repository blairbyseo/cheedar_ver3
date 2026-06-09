"""보상(현금) API 라우터 — 사용자 본인용.

엔드포인트(모두 인증 필요):
  GET  /api/rewards/final-level         최종 레벨 보상 현황(자격·금액·내 신청)
  POST /api/rewards/final-level/claim   보상 신청(자격 있고 미신청일 때만)

실제 송금/지급완료 처리는 관리자 라우터(routers/admin.py)에서 한다.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.rewards import RewardClaimOut, RewardStatusOut
from app.services.rewards import (
    RewardError,
    claim_final_level_reward,
    current_level,
    get_final_level_claim,
    is_eligible,
)

router = APIRouter(prefix="/api/rewards", tags=["rewards"])
settings = get_settings()


@router.get("/final-level", response_model=RewardStatusOut)
def final_level_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RewardStatusOut:
    """최종 레벨 현금 보상 현황 — 화면이 진행도와 버튼 상태를 그릴 때 쓴다."""
    claim = get_final_level_claim(db, current_user)
    return RewardStatusOut(
        final_level=settings.final_level,
        current_level=current_level(current_user),
        eligible=is_eligible(current_user, settings),
        reward_amount=settings.final_level_reward_amount,
        claim=RewardClaimOut.model_validate(claim) if claim else None,
    )


@router.post("/final-level/claim", response_model=RewardClaimOut)
def claim_final_level(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RewardClaimOut:
    """최종 레벨 보상을 신청한다 → pending 1건 생성.

    자격 미달이면 403(not_eligible), 이미 신청했으면 409(already_claimed).
    """
    try:
        claim = claim_final_level_reward(db, current_user, settings)
    except RewardError as exc:
        if exc.code == "not_eligible":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=exc.code
            ) from exc
        # already_claimed
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=exc.code
        ) from exc
    return RewardClaimOut.model_validate(claim)

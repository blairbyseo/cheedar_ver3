"""보상(현금) 관련 응답/요청 스키마.

사용자용(/api/rewards)과 관리자용(/api/admin/reward-claims)을 함께 둔다.
status 는 모델의 RewardClaimStatus enum 을 그대로 노출 — FastAPI 가 JSON 으로
직렬화할 때 값("pending" 등)으로 나간다.
"""
from datetime import datetime

from pydantic import BaseModel

from app.models.reward import RewardClaimStatus


class RewardClaimOut(BaseModel):
    """보상 신청 1건(사용자 본인 화면용)."""

    id: int
    kind: str
    status: RewardClaimStatus
    amount: int             # 지급 예정 현금(원)
    level_at_claim: int     # 신청 당시 레벨
    requested_at: datetime
    processed_at: datetime | None
    admin_note: str | None

    class Config:
        from_attributes = True


class RewardStatusOut(BaseModel):
    """최종 레벨 보상 현황 — 사용자 화면(진행도 + 신청 버튼 상태)용."""

    final_level: int        # 보상 자격이 생기는 목표 레벨
    current_level: int      # 사용자의 현재 레벨
    eligible: bool          # 신청 가능 여부(현재 레벨 >= final_level)
    reward_amount: int      # 보상 금액(원)
    claim: RewardClaimOut | None  # 이미 신청했다면 그 내역, 아니면 null


# ---------- 관리자용 ----------

class AdminRewardClaimItem(BaseModel):
    """관리자 보상 신청 목록 1줄 — 신청자 정보를 함께 담는다."""

    id: int
    user_id: int            # 내부 PK
    user_login_id: str      # 로그인 아이디(User.user_id)
    nickname: str | None
    status: RewardClaimStatus
    amount: int
    level_at_claim: int
    xp_at_claim: int
    requested_at: datetime
    processed_at: datetime | None
    admin_note: str | None


class AdminRewardClaimListResponse(BaseModel):
    items: list[AdminRewardClaimItem]
    total: int
    # 상태별 개수 — 상단 요약 배지(대기 N건 등)용. 키: pending/paid/rejected.
    counts: dict[str, int]


class AdminRewardClaimUpdateRequest(BaseModel):
    """신청 처리 — 지급완료(paid) 또는 반려(rejected)로 전환.

    pending 으로 되돌리는 것은 허용하지 않는다(라우터에서 400).
    """

    status: RewardClaimStatus
    admin_note: str | None = None

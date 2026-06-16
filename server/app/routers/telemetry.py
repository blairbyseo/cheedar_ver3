"""사용자 텔레메트리 수집 API.

사용자 앱이 페이지 체류시간/동선 전환을 보내면 원시 샘플로 저장한다.
관리자 분석(/api/admin/analytics)에서 이 샘플들을 집계한다. fire-and-forget.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.telemetry import PageTimeLog, UserFlowLog
from app.models.user import User
from app.schemas.telemetry import PageTimeSampleCreate, UserFlowSampleCreate

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


@router.post("/page-time")
def create_page_time_sample(
    body: PageTimeSampleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """페이지 체류시간 샘플 1건 저장."""
    db.add(
        PageTimeLog(
            user_id=current_user.id,
            page_path=body.page_path,
            time_spent_seconds=body.time_spent_seconds,
            metric_type="sample",
        )
    )
    db.commit()
    return {"detail": "ok"}


@router.post("/user-flow")
def create_user_flow_sample(
    body: UserFlowSampleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """페이지 전환(from -> to) 샘플 1건 저장."""
    db.add(
        UserFlowLog(
            user_id=current_user.id,
            from_page=body.from_page,
            to_page=body.to_page,
        )
    )
    db.commit()
    return {"detail": "ok"}

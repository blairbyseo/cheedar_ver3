"""문의하기 API (사용자 측).

설정 화면에서 남긴 문의를 저장한다. 관리자 조회/처리는 admin 라우터에 있다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.inquiry import Inquiry
from app.models.user import User
from app.schemas.inquiry import InquiryCreate

# 끝에 슬래시 없는 정확한 경로로 등록 — CloudFront 뒤에서 307 리다이렉트를 피한다.
router = APIRouter(prefix="/api/inquiries", tags=["inquiries"])


@router.post("")
def create_inquiry(
    body: InquiryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """문의 1건 저장. 관리자 화면에서 확인한다."""
    db.add(Inquiry(user_id=current_user.id, content=body.content.strip()))
    db.commit()
    return {"detail": "ok"}

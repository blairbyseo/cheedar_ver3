"""동기 점검 라우터 — 홈 진입 시 주 1회 뜨는 창이 호출.

- GET  /api/motivation/status  : 띄울지(due) + 비교용 지난 점수 + 몸무게 칸 표시 여부
- POST /api/motivation/checkin : 중요도·자신감(0~10) + 선택 몸무게 기록
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services.motivation import checkin_status, record_check

router = APIRouter(prefix="/api/motivation", tags=["motivation"])


class PreviousScores(BaseModel):
    importance: int | None = None
    confidence: int | None = None
    source: str  # "check"(지난 점검) | "survey"(설문 답)


class MotivationStatus(BaseModel):
    due: bool
    show_weight: bool
    previous: PreviousScores | None = None
    last_weight_kg: float | None = None


class MotivationCheckIn(BaseModel):
    importance: int = Field(ge=0, le=10)
    confidence: int = Field(ge=0, le=10)
    weight_kg: float | None = Field(default=None, ge=20, le=300)


class MotivationCheckResult(BaseModel):
    importance: int
    confidence: int
    previous: PreviousScores | None = None


@router.get("/status", response_model=MotivationStatus)
def get_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return checkin_status(db, current_user)


@router.post("/checkin", response_model=MotivationCheckResult)
def post_checkin(
    payload: MotivationCheckIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return record_check(
        db, current_user, payload.importance, payload.confidence, payload.weight_kg
    )

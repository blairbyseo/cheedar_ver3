from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.emotion import EmotionLog
from app.models.user import User
from app.schemas.emotion import EmotionLogCreate, EmotionLogOut, TodayStatusOut
from app.services.emotion_context import has_emotion_logged_today

router = APIRouter(prefix="/api/emotion", tags=["emotion"])


@router.post("/log", response_model=EmotionLogOut)
def create_emotion_log(
    payload: EmotionLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmotionLog:
    """사용자의 현재 기분 1건을 기록한다.

    채팅 진입 시 MoodOpener(1~10 슬라이더)가 하루 1회 호출한다. 기록 직후
    프론트는 /api/chat/opener 를 불러 AI 가 먼저 공감 인사를 건네게 한다.
    """
    log = EmotionLog(
        user_id=current_user.id,
        emotion_label=payload.emotion_label,
        score=payload.score,
        note=payload.note,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/today-status", response_model=TodayStatusOut)
def today_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TodayStatusOut:
    """오늘(KST) 이미 기분을 기록했는지 — MoodOpener 표시 여부 판정용."""
    return TodayStatusOut(
        has_logged_today=has_emotion_logged_today(db, current_user.id)
    )

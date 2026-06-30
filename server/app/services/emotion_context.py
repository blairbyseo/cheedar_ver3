"""채팅에 '오늘의 기분'을 얹어주는 다리.

Cheddar_Team_26 의 daily_checkin 노드를 이 레포(LangGraph 없는 순수 OpenAI
스트리밍)로 이식한 것. 사용자가 하루 1회 남긴 EmotionLog 를 읽어,

- `build_emotion_context()`: 일반 채팅 system 지시 한 줄로 변환(diet/exercise/
  survey_context 와 같은 자리). 신호 없으면 빈 문자열.
- `get_latest_emotion()` / `has_emotion_logged_today()`: 라우터·opener 가 쓰는
  조회 헬퍼.

설계 원칙(survey_context 와 동일 결):
- 점수(숫자) 자체는 사용자에게 노출하지 않는다. 라벨·뉘앙스만 응답 톤에 반영.
- 신호가 없으면(오늘 미기록) 순수 식단·운동 대화가 되도록 빈 문자열.
- 시간 경계는 한국 사용자 기준 — '오늘'은 KST(UTC+9) 자정 경계로 판정한다.
  (컬럼은 timezone-aware 라 survey/service.py 처럼 aware UTC 로 비교한다.)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.emotion import EmotionLog

# 1~10 점수를 응답 톤 조정용 한글 힌트로. (점수 자체는 사용자에게 노출 금지)
_EMOTION_HINT: dict[int, str] = {
    1: "기분이 너무 나쁘다고 했음",
    2: "기분이 매우 나쁘다고 했음",
    3: "기분이 나쁘다고 했음",
    4: "기분이 좀 나쁘다고 했음",
    5: "기분이 그저 그렇다고 했음",
    6: "기분이 괜찮다고 했음",
    7: "기분이 좋다고 했음",
    8: "기분이 꽤 좋다고 했음",
    9: "기분이 정말 좋다고 했음",
    10: "기분이 너무 좋다고 했음",
}

_KST = timezone(timedelta(hours=9))


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _kst_today_start_utc() -> datetime:
    """한국시간 기준 오늘 자정을 UTC aware datetime 으로 반환."""
    kst_now = datetime.now(_KST)
    start_kst = kst_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_kst.astimezone(timezone.utc)


def has_emotion_logged_today(db: Session, user_id: int) -> bool:
    """오늘(KST) 감정을 1건 이상 기록했는지. MoodOpener 표시 여부 판정용."""
    start = _kst_today_start_utc()
    row = db.execute(
        select(EmotionLog.id)
        .where(EmotionLog.user_id == user_id)
        .where(EmotionLog.occurred_at >= start)
        .limit(1)
    ).first()
    return row is not None


def get_latest_emotion(db: Session, user_id: int) -> dict | None:
    """최근 24시간 내 가장 최근 EmotionLog 를 dict 로 반환. 없으면 None(stale)."""
    cutoff = _utcnow() - timedelta(hours=24)
    row = db.execute(
        select(EmotionLog)
        .where(EmotionLog.user_id == user_id)
        .where(EmotionLog.occurred_at >= cutoff)
        .order_by(EmotionLog.occurred_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        return None
    return {"score": row.score, "emotion_label": row.emotion_label}


def build_emotion_context(db: Session, user_id: int) -> str:
    """오늘의 기분을 채팅 system 지시 한 줄로 변환한다.

    최근 24시간 내 기록이 없으면 빈 문자열(순수 식단·운동 대화). 반환 텍스트는
    사용자에게 보여줄 데이터가 아니라 AI 응답 톤 조정용 지침이다.
    """
    emotion = get_latest_emotion(db, user_id)
    if not emotion:
        return ""

    label = emotion.get("emotion_label") or ""
    hint = _EMOTION_HINT.get(emotion.get("score", 0), "")
    return (
        f"[오늘의 기분] 사용자가 오늘 기분을 '{label}'(으)로 남겼다 — {hint}. "
        "기분 점수(숫자)는 절대 입에 올리지 말고, 사용자가 먼저 꺼내지 않으면 "
        "기분 이야기를 억지로 끌어내지도 마라. 다만 그 기분에 어울리도록 답변의 "
        "온도(공감/가벼움)를 자연스럽게 맞춰라."
    )

"""설문 트리거 판단 서비스.

로그인 직후 / `/api/survey/next` 호출 시 어떤 설문을 띄워야 하는지 계산한다.
트리거 주기는 코드에 하드코딩하지 않고 활성 SurveySchema 의
``trigger_interval_days`` 값을 사용한다 — 관리자가 주기를 바꾸면 자동 반영됨.

Cheddar_Team_26 의 SQLModel 버전을 순수 SQLAlchemy 세션 스타일로 옮긴 것.
우리 User.last_survey_at 는 timezone-aware 라, 비교 기준도 UTC aware 로 맞춘다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.survey import SurveySchema
from app.models.user import User

SURVEY_DUE_ONBOARDING = "onboarding"
SURVEY_DUE_RECURRING = "recurring"


def get_active_schema(db: Session) -> SurveySchema | None:
    """현재 활성(is_active=True) 설문 스키마 1개를 반환. 없으면 None."""
    return db.execute(
        select(SurveySchema).where(SurveySchema.is_active.is_(True)).limit(1)
    ).scalar_one_or_none()


def compute_survey_due(db: Session, user: User) -> str | None:
    """주어진 사용자에게 띄울 설문 종류를 결정한다.

    우선순위:
      1) onboarded == False → "onboarding"
      2) last_survey_at + active_schema.trigger_interval_days <= now → "recurring"
      3) 그 외 → None

    활성 스키마가 없으면 항상 None — 관리자가 스키마를 비활성화하면 설문이
    뜨지 않는다(설계상 의도된 kill-switch).
    """
    schema = get_active_schema(db)
    if schema is None:
        return None

    if not user.onboarded:
        return SURVEY_DUE_ONBOARDING

    if user.last_survey_at is None:
        # onboarded=True 인데 last_survey_at 가 비어있는 비정상 케이스 —
        # 다음 주기 트리거를 즉시 띄워주는 게 안전(데이터 회복 차원).
        return SURVEY_DUE_RECURRING

    interval = timedelta(days=int(schema.trigger_interval_days))
    if datetime.now(timezone.utc) >= user.last_survey_at + interval:
        return SURVEY_DUE_RECURRING

    return None

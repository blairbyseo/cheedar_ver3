"""설문 응답 lifecycle 서비스.

라우터는 얇게 유지하고, 모든 비즈니스 로직(prefill, in_progress 재사용,
부분 저장 merge, 제출 시 scoring + SafetyEvent + User 갱신)을 여기 모은다.

Cheddar_Team_26 버전과의 차이:
  - SQLModel.exec → SQLAlchemy db.execute(...).scalar_one_or_none()
  - prefill: 우리 User 는 birth_date/gender/BodyLog 가 없고 age/height_cm/
    weight_kg 를 직접 가진다 → A-1(나이)·B-1(키·몸무게)만 prefill, 성별(A-2)은
    설문에서 직접 입력받음(prefill 안 함).
  - datetime 은 timezone-aware UTC 로 통일(컬럼이 timezone=True).
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.safety import RiskLevel, SafetyEvent
from app.models.survey import (
    SurveyKind,
    SurveyResponse,
    SurveyResponseStatus,
    SurveySchema,
)
from app.models.user import User
from app.services.points import award_points_for_survey

from .recurring import (
    filter_schema_for_recurring,
    merge_carried_forward,
    previous_completed_response,
    recurring_question_ids,
    should_emit_risk_flag,
)
from .scoring import score as run_scoring
from .trigger import (
    SURVEY_DUE_ONBOARDING,
    SURVEY_DUE_RECURRING,
    compute_survey_due,
    get_active_schema,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------- prefill ----------

def build_prefilled_answers(db: Session, user: User) -> dict[str, Any]:
    """회원가입에서 이미 수집한 데이터를 question_id 형식으로 매핑.

    프론트는 이 값을 해당 문항의 초기값으로 채우고, 사용자에게 "맞으면 다음"
    형태로 확인만 받으면 된다(스키마의 ``skippable_if_prefilled``: true).

    우리 User 기준 매핑:
      - A-1 ← user.age
      - B-1 ← {"height": user.height_cm, "weight": user.weight_kg}
      - A-2(성별) 은 User 에 컬럼이 없어 prefill 하지 않는다(설문에서 직접 입력).
    """
    answers: dict[str, Any] = {}

    if user.age is not None:
        answers["A-1"] = user.age

    if user.height_cm is not None and user.weight_kg is not None:
        answers["B-1"] = {
            "height": float(user.height_cm),
            "weight": float(user.weight_kg),
        }

    return answers


# ---------- 응답 lifecycle ----------

def get_or_create_in_progress(
    db: Session, user: User, active_schema: SurveySchema, kind: str
) -> SurveyResponse:
    """진행 중 응답이 있으면 반환, 없으면 새로 만든다.

    같은 schema 의 in_progress 가 여러 개일 수 없도록 가장 최근 한 건만 반환한다.
    """
    existing = db.execute(
        select(SurveyResponse)
        .where(
            SurveyResponse.user_id == user.id,
            SurveyResponse.schema_id == active_schema.id,
            SurveyResponse.status == SurveyResponseStatus.IN_PROGRESS,
        )
        .order_by(SurveyResponse.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    survey_kind = (
        SurveyKind.ONBOARDING if kind == SURVEY_DUE_ONBOARDING else SurveyKind.RECURRING
    )
    response = SurveyResponse(
        user_id=user.id,
        schema_id=active_schema.id,
        kind=survey_kind,
        status=SurveyResponseStatus.IN_PROGRESS,
        answers={},
        derived_flags={},
    )
    db.add(response)
    db.commit()
    db.refresh(response)
    return response


def merge_partial_answers(
    db: Session,
    response: SurveyResponse,
    new_answers: dict[str, Any],
    current_section: str | None,
) -> SurveyResponse:
    """기존 answers 위에 새 응답을 덮어쓰기 머지.

    JSONB 컬럼은 in-place mutate 를 SQLAlchemy 가 감지하지 못하므로,
    deep copy 후 '새 dict 를 재할당' 해서 변경을 확실히 트래킹한다.
    """
    if response.status != SurveyResponseStatus.IN_PROGRESS:
        # 이미 완료/폐기된 응답은 수정 금지
        raise ValueError("response_not_in_progress")

    merged = copy.deepcopy(response.answers or {})
    merged.update(new_answers or {})
    response.answers = merged
    if current_section is not None:
        response.current_section = current_section
    db.add(response)
    db.commit()
    db.refresh(response)
    return response


# ---------- 제출(finalize) ----------

_RISK_FLAG_TO_SAFETY_EVENT: list[tuple[str, str, RiskLevel, frozenset[str]]] = [
    # (flag_key, detected_category, risk_level, 이 플래그를 만드는 문항 id)
    ("suicide_acute", "survey_suicide_acute", RiskLevel.CRITICAL, frozenset({"C-2-3"})),
    ("suicide_screen", "survey_suicide_screen", RiskLevel.HIGH, frozenset({"C-2-1", "C-2-2"})),
    ("purging_flag", "survey_purging", RiskLevel.HIGH, frozenset({"C-10"})),
    ("anorexia_candidate", "survey_anorexia_candidate", RiskLevel.HIGH, frozenset({"C-9-1", "C-10"})),
    ("bed_candidate", "survey_bed_candidate", RiskLevel.MEDIUM, frozenset({"C-11-1", "C-11-2", "C-11-3"})),
    ("psychosis_positive", "survey_psychosis", RiskLevel.HIGH, frozenset({"C-4-1", "C-4-3"})),
    ("mania_positive", "survey_mania", RiskLevel.MEDIUM, frozenset({"C-3-1", "C-3-2"})),
]


def _emit_safety_events(
    db: Session,
    user: User,
    response: SurveyResponse,
    derived: dict[str, Any],
    asked_ids: set[str] | None = None,
) -> list[SafetyEvent]:
    """derived_flags 의 위험 신호를 SafetyEvent 로 적재.

    detected_category 가 "survey_" 로 시작하므로 출처(설문 vs 챗봇)가 구분된다.
    description 에 응답 id 와 양성 flag 키를 넣어 운영자가 추적할 수 있게 한다.

    asked_ids: 이번 설문에서 실제로 물은 문항(재설문일 때만). 주어지면 그 문항에서
        나온 플래그만 적재한다 — 이어받은 옛 응답을 새 위험 이벤트로 다시 올리지 않는다.
    """
    events: list[SafetyEvent] = []
    # suicide_acute 가 있으면 screen 은 중복으로 적재하지 않음
    suppress_screen = bool(derived.get("suicide_acute"))
    for flag_key, category, level, source_ids in _RISK_FLAG_TO_SAFETY_EVENT:
        if not derived.get(flag_key):
            continue
        if not should_emit_risk_flag(source_ids, asked_ids):
            continue
        if flag_key == "suicide_screen" and suppress_screen:
            continue
        event = SafetyEvent(
            user_id=user.id,
            message_id=None,  # 챗봇 메시지가 아니라 설문 응답 출처
            risk_level=level,
            detected_category=category,
            description=f"survey_response_id={response.id}; flag={flag_key}",
            status="unresolved",
            is_resolved=False,
        )
        db.add(event)
        events.append(event)
    return events


def _num_in(value: Any, lo: float, hi: float) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def _apply_profile_answers(user: User, answers: dict[str, Any]) -> None:
    """설문에서 입력한 나이(A-1)·키·몸무게(B-1)를 프로필에도 반영한다.

    카카오 가입자는 회원가입 폼을 거치지 않아 프로필이 비어 있고, 설문에서만
    입력한다. 프로필이 비어 있으면 운동 칼로리를 70kg 가정으로 계산하게 되므로
    여기서 채운다. 범위는 회원가입 검증(schemas/auth.py)과 같다.
    """
    age = _num_in(answers.get("A-1"), 1, 120)
    if age is not None:
        user.age = int(age)
    body = answers.get("B-1")
    if isinstance(body, dict):
        height = _num_in(body.get("height"), 50, 250)
        weight = _num_in(body.get("weight"), 20, 400)
        if height is not None:
            user.height_cm = height
        if weight is not None:
            user.weight_kg = weight


def finalize_submission(
    db: Session, user: User, response: SurveyResponse
) -> SurveyResponse:
    """제출 처리: scoring → derived_flags 저장 → SafetyEvent 적재 → User 갱신.

    호출자(라우터)는 response.user_id == current_user.id 와 status 가
    in_progress 인지 미리 확인할 것.
    """
    if response.status != SurveyResponseStatus.IN_PROGRESS:
        raise ValueError("response_not_in_progress")

    schema = db.get(SurveySchema, response.schema_id)
    if schema is None:
        raise ValueError("schema_not_found")

    scoring_module = (schema.schema_json or {}).get("scoring_module", schema.version)
    context = {
        "user_age": user.age,
        "user_sex": None,  # 우리 User 엔 성별 컬럼이 없음(현재 v3 scoring 은 미사용)
    }

    # 재설문: 묻지 않은 문항을 직전 완료 응답에서 이어받아 전체 스냅샷으로 만든다.
    # 프로필(나이·키·몸무게)에는 이번에 실제로 들어온 값만 반영한다(이어받은 옛 값 제외).
    own_answers = dict(response.answers or {})
    asked_ids: set[str] | None = None
    if response.kind == SurveyKind.RECURRING:
        previous = previous_completed_response(db, user.id, exclude_id=response.id)
        recurring_ids = recurring_question_ids(
            schema.schema_json, schema.version, previous.answers if previous else None
        )
        if recurring_ids is not None:
            response.answers = merge_carried_forward(previous, response.answers or {}, recurring_ids)
            asked_ids = set(recurring_ids)

    derived = run_scoring(scoring_module, response.answers or {}, context)

    now = _utcnow()
    response.derived_flags = derived
    response.status = SurveyResponseStatus.COMPLETED
    response.completed_at = now
    db.add(response)

    user.last_survey_at = now
    if response.kind == SurveyKind.ONBOARDING:
        user.onboarded = True
    _apply_profile_answers(user, own_answers)
    db.add(user)

    _emit_safety_events(db, user, response, derived, asked_ids)

    # 설문 완료 보상 — 같은 트랜잭션 안에서 XP/CP 적립(응답 1건당 1회).
    earned = award_points_for_survey(db, user, response)

    db.commit()
    db.refresh(response)
    # 이번 제출로 새로 적립된 포인트 합계를 응답 객체에 임시로 실어 보낸다
    # (컬럼이 아니라 전송용 임시 속성 — 라우터가 읽어 SurveySubmitResponse 로 내려준다).
    response.points_awarded = sum(e["amount"] for e in earned)
    return response


# 외부 노출용 — 라우터에서 재사용
__all__ = [
    "build_prefilled_answers",
    "compute_survey_due",
    "filter_schema_for_recurring",
    "finalize_submission",
    "previous_completed_response",
    "get_active_schema",
    "get_or_create_in_progress",
    "merge_partial_answers",
    "SURVEY_DUE_ONBOARDING",
    "SURVEY_DUE_RECURRING",
]

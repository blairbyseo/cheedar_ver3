"""재설문(recurring, 2주 주기) 축약 규칙.

온보딩은 전 문항을 묻지만, 2번째부터는 변할 수 있는 문항만 다시 묻는다
(2026-11-09 미팅 요청: A-10, B-2, C-1, C-9, C-10, C-11).

묻지 않은 문항은 직전 완료 응답의 값을 이어받는다(carry-forward). 개인화 엔진과
결과 화면이 "가장 최근 완료 응답" 한 건의 answers/derived_flags 만 읽기 때문에,
재설문 응답이 부분 응답으로 남으면 ADHD·불안·도움받고 싶은 것(F-1) 같은
묻지 않은 축이 통째로 사라진다.

위험 이벤트(SafetyEvent)는 이번에 실제로 물은 문항에서 나온 것만 올린다 —
이어받은 2주 전 응답이 매번 새 위험 이벤트로 다시 올라가면 안 된다.
"""
from __future__ import annotations

import copy
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.survey import SurveyResponse, SurveyResponseStatus

# 스키마 version → 재설문에서 다시 묻는 문항 id.
# 스키마 JSON 에 ``recurring_question_ids`` 가 있으면 그 값이 우선한다(관리자 조정용).
# C-10-h(운동 못 한 날 죄책감)는 미팅에서 제외하기로 해 넣지 않는다.
_DEFAULT_RECURRING_QUESTION_IDS: dict[str, tuple[str, ...]] = {
    "v3": (
        "A-10",
        "B-2-1", "B-2-2", "B-2-3", "B-2-4",
        "C-1-1", "C-1-2",
        "C-9-1",
        "C-10",
        "C-11-1", "C-11-2", "C-11-3",
    ),
}



def _c9_was_present(previous_answers: dict) -> bool:
    try:
        return int(previous_answers.get("C-9-1") or 0) >= 1
    except (TypeError, ValueError):
        return False


def _c10_was_present(previous_answers: dict) -> bool:
    rows = (previous_answers.get("C-10") or {}).get("rows") or {}
    return any(bool((row or {}).get("checked")) for row in rows.values())


# 직전 응답에서 해당했던 사람에게만 다시 묻는 문항(2026-11-09 미팅:
# "전에 있으셨던 분은 C-10 … C-9-1도 1점 이상이면 2주차부터").
# 직전 응답에서 해당이 없었으면 묻지 않고 그 값을 그대로 이어받는다.
_ASK_ONLY_IF_PREVIOUSLY_PRESENT = {
    "C-9-1": _c9_was_present,
    "C-10": _c10_was_present,
}

# answers 안에 이어받기 내역을 남기는 예약 키(문항 id 와 겹치지 않음).
CARRIED_FORWARD_KEY = "_carried_forward"


def recurring_question_ids(
    schema_json: dict | None,
    version: str | None = None,
    previous_answers: dict | None = None,
) -> Optional[list[str]]:
    """재설문 문항 id 목록. 축약 규칙이 없는 스키마면 None(= 전 문항).

    previous_answers: 직전 완료 응답의 answers. 주어지면 C-9-1·C-10 은 직전에
        해당했던 경우에만 포함한다. None(직전 응답 없음)이면 조건 없이 전부 묻는다.
    """
    schema_json = schema_json or {}
    override = schema_json.get("recurring_question_ids")
    if override:
        ids = list(override)
    else:
        key = version or schema_json.get("version")
        default = _DEFAULT_RECURRING_QUESTION_IDS.get(key)
        if not default:
            return None
        ids = list(default)
    if previous_answers is None:
        return ids
    return [
        qid for qid in ids
        if qid not in _ASK_ONLY_IF_PREVIOUSLY_PRESENT
        or _ASK_ONLY_IF_PREVIOUSLY_PRESENT[qid](previous_answers)
    ]


def filter_schema_for_recurring(
    schema_json: dict, version: str | None = None, previous_answers: dict | None = None
) -> dict:
    """재설문용 스키마 사본 — 재설문 문항만 남기고 빈 섹션은 뺀다."""
    ids = recurring_question_ids(schema_json, version, previous_answers)
    if ids is None:
        return schema_json
    keep = set(ids)
    filtered = copy.deepcopy(schema_json)
    sections = []
    for section in filtered.get("sections", []):
        section["questions"] = [q for q in section.get("questions", []) if q.get("id") in keep]
        if section["questions"]:
            sections.append(section)
    filtered["sections"] = sections
    return filtered


def previous_completed_response(
    db: Session, user_id: int, exclude_id: Optional[int] = None
) -> Optional[SurveyResponse]:
    """사용자의 가장 최근 완료 응답(현재 응답 제외)."""
    stmt = (
        select(SurveyResponse)
        .where(
            SurveyResponse.user_id == user_id,
            SurveyResponse.status == SurveyResponseStatus.COMPLETED,
        )
        .order_by(SurveyResponse.completed_at.desc())
    )
    for row in db.execute(stmt).scalars():
        if row.id != exclude_id:
            return row
    return None


def merge_carried_forward(
    previous: Optional[SurveyResponse],
    current_answers: dict[str, Any],
    asked_ids: list[str],
) -> dict[str, Any]:
    """직전 응답 위에 이번 응답을 얹어 전체 스냅샷을 만든다.

    - 이번에 물은 문항은 직전 값을 쓰지 않는다. 분기로 건너뛴 문항
      (예: C-11-1 이 낮아 C-11-2 를 안 물음)에 옛 값이 남으면 이번 응답과
      섞여 잘못된 플래그가 나온다.
    - 이번 answers 에 들어 있는 값(prefill 된 키·몸무게 포함)이 항상 우선.
    - 어떤 문항이 이어받은 값인지 CARRIED_FORWARD_KEY 에 기록한다.
    """
    asked = set(asked_ids)
    current = {k: v for k, v in (current_answers or {}).items() if k != CARRIED_FORWARD_KEY}

    carried: dict[str, Any] = {}
    if previous is not None:
        for qid, value in (previous.answers or {}).items():
            if qid == CARRIED_FORWARD_KEY or qid in asked or qid in current:
                continue
            carried[qid] = copy.deepcopy(value)

    merged = {**carried, **current}
    merged[CARRIED_FORWARD_KEY] = {
        "from_response_id": previous.id if previous is not None else None,
        "asked_question_ids": list(asked_ids),
        "carried_question_ids": sorted(carried),
    }
    return merged


def should_emit_risk_flag(source_ids: frozenset[str], asked_ids: Optional[set[str]]) -> bool:
    """이 위험 플래그를 이번 제출에서 SafetyEvent 로 올릴지.

    asked_ids 가 None 이면 전 문항을 물은 설문(온보딩)이라 항상 올린다.
    재설문이면 플래그를 만든 문항 중 하나라도 이번에 물었을 때만 올린다.
    """
    return asked_ids is None or bool(source_ids & asked_ids)

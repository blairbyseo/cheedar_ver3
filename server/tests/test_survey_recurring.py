"""재설문(2주 주기) 축약 + 이어받기(carry-forward) — 순수 로직 테스트(DB 없음)."""
from types import SimpleNamespace

from app.services.survey.loader import load_schema
from app.services.survey.recurring import (
    CARRIED_FORWARD_KEY,
    filter_schema_for_recurring,
    merge_carried_forward,
    recurring_question_ids,
    should_emit_risk_flag,
)
from app.services.survey.scoring import score

_EXPECTED = [
    "A-10",
    "B-2-1", "B-2-2", "B-2-3", "B-2-4",
    "C-1-1", "C-1-2",
    "C-9-1",
    "C-10",
    "C-11-1", "C-11-2", "C-11-3",
]
_CTX = {"user_age": 16, "user_sex": None}


def _question_ids(schema_json: dict) -> list[str]:
    return [q["id"] for s in schema_json["sections"] for q in s["questions"]]


def test_recurring_schema_keeps_only_requested_questions() -> None:
    full = load_schema("v3")
    filtered = filter_schema_for_recurring(full, "v3")

    assert _question_ids(filtered) == _EXPECTED
    assert [s["id"] for s in filtered["sections"]] == ["A", "B", "C"]
    assert len(_question_ids(full)) > len(_EXPECTED)  # 원본은 그대로
    # 남은 문항의 분기는 남은 문항만 참조해야 한다(빠진 문항을 참조하면 영영 안 뜬다)
    kept = set(_EXPECTED)
    for section in filtered["sections"]:
        for q in section["questions"]:
            conds = [q["show_if"]] if "show_if" in q else []
            conds += q.get("show_if_any", []) + q.get("show_if_all", [])
            for cond in conds:
                assert cond["question_id"] in kept
            assert "show_if_sum" not in q


def test_schema_override_wins() -> None:
    assert recurring_question_ids({"recurring_question_ids": ["A-10"]}, "v3") == ["A-10"]
    assert recurring_question_ids({}, "unknown") is None


def test_c10_wording() -> None:
    c10 = next(
        q for s in load_schema("v3")["sections"] for q in s["questions"] if q["id"] == "C-10"
    )
    assert "한 것이 있나요" in c10["text"]
    assert "한 거" not in c10["text"]


def test_merge_carries_forward_only_unasked() -> None:
    previous = SimpleNamespace(
        id=7,
        answers={
            "A-10": 3,
            "B-1": {"height": 165, "weight": 60},
            "C-1-1": 3, "C-1-2": 3,
            "C-7-1": 2, "C-7-2": 2,
            "C-11-1": 3, "C-11-2": "yes", "C-11-3": "yes",
            "F-1": "sleep",
        },
    )
    current = {"A-10": 8, "C-1-1": 0, "C-1-2": 1, "C-9-1": 0, "C-11-1": 0,
               "B-1": {"height": 166, "weight": 58}}
    merged = merge_carried_forward(previous, current, _EXPECTED)

    assert merged["A-10"] == 8
    # 분기로 안 물은 후속 문항에 옛 "yes" 가 남으면 안 된다
    assert "C-11-2" not in merged and "C-11-3" not in merged
    # 안 물은 문항은 이어받는다 / 이번에 들어온 값(prefill 키·몸무게)이 우선
    assert merged["F-1"] == "sleep" and merged["C-7-1"] == 2
    assert merged["B-1"] == {"height": 166, "weight": 58}

    meta = merged[CARRIED_FORWARD_KEY]
    assert meta["from_response_id"] == 7
    assert meta["asked_question_ids"] == _EXPECTED
    assert meta["carried_question_ids"] == ["C-7-1", "C-7-2", "F-1"]

    flags = score("v3", merged, _CTX)
    assert flags["phq2_sum"] == 1 and flags["depression_positive"] is False
    assert flags["bed_candidate"] is False
    assert flags["anxiety_positive"] is True  # 이어받은 C-7

    # 3번째 설문: 2번째 스냅샷에서 다시 이어받는다(메타 키는 문항으로 취급하지 않음)
    third = merge_carried_forward(SimpleNamespace(id=8, answers=merged), {"A-10": 9}, _EXPECTED)
    assert third["F-1"] == "sleep" and third["A-10"] == 9
    assert third[CARRIED_FORWARD_KEY]["from_response_id"] == 8
    assert CARRIED_FORWARD_KEY not in third[CARRIED_FORWARD_KEY]["carried_question_ids"]


def test_merge_without_previous() -> None:
    merged = merge_carried_forward(None, {"A-10": 5}, _EXPECTED)
    assert merged["A-10"] == 5
    assert merged[CARRIED_FORWARD_KEY]["from_response_id"] is None


def test_stale_risk_flags_are_not_re_raised() -> None:
    asked = set(_EXPECTED)
    # 재설문에서 안 묻는 자살·정신증 문항 → 이어받은 값으로 새 이벤트를 만들지 않는다
    assert should_emit_risk_flag(frozenset({"C-2-1", "C-2-2"}), asked) is False
    assert should_emit_risk_flag(frozenset({"C-4-1", "C-4-3"}), asked) is False
    # 이번에 물은 문항에서 나온 신호는 올린다
    assert should_emit_risk_flag(frozenset({"C-10"}), asked) is True
    assert should_emit_risk_flag(frozenset({"C-11-1", "C-11-2", "C-11-3"}), asked) is True
    # 온보딩(전 문항)은 항상 올린다
    assert should_emit_risk_flag(frozenset({"C-2-3"}), None) is True

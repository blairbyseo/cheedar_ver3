"""v3 설문 응답 → derived_flags 계산.

답안(answers) 은 ``{question_id: value}`` 형태. value 의 모양은 question.type 별로 다름:
  - likert_0_3 / scale_0_10 / numeric: int
  - yes_no: "yes" | "no"
  - single_select / multi_select: option value (str) 또는 [str]
  - free_text: str
  - composite (A-7 등): {sub_field_id: value}
  - bmi (B-1): {"height": float, "weight": float}
  - checklist_with_frequency (C-10): {"rows": {row_id: {"checked": bool, "frequency": int}}}

derived_flags 는 관리자 분석/SafetyEvent 분기에 사용. PHQ-2/GAD 합산값,
positive screen 불리언, 임상 후보(anorexia/BED/purging) 플래그 등을 포함.
"""
from __future__ import annotations

from typing import Any


# ---------- 작은 헬퍼들 ----------

def _get_int(answers: dict, qid: str) -> int | None:
    v = answers.get(qid)
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _yes(answers: dict, qid: str) -> bool:
    return str(answers.get(qid, "")).lower() == "yes"


def _select(answers: dict, qid: str) -> str | None:
    v = answers.get(qid)
    return str(v) if v is not None else None


def _select_in(answers: dict, qid: str, values: set[str]) -> bool:
    v = _select(answers, qid)
    return v in values if v else False


def _sum(answers: dict, qids: list[str]) -> int:
    total = 0
    for q in qids:
        v = _get_int(answers, q)
        if v is not None:
            total += v
    return total


# ---------- BMI ----------

def _classify_bmi(bmi: float, age: int | None) -> tuple[str, str]:
    """(category, percentile_band) 를 반환.

    MVP: 성장도표 LMS 룩업 대신 단순 컷오프 사용. 청소년(age<18) 의
    정확한 percentile 은 KCDC 한국소아청소년 성장도표가 필요 —
    TODO(post-MVP): 성장도표 테이블 추가.
    """
    # Asian-Pacific WHO 컷오프 기준 — 한국 성인 표준에 가까움
    if bmi < 18.5:
        return ("underweight", "<15")
    if bmi < 23.0:
        return ("normal", "15-84")
    if bmi < 25.0:
        # Asian-adjusted overweight (23-24.9)
        return ("overweight", "85-94")
    return ("obese", "≥95")


def _compute_bmi(answers: dict, age: int | None) -> dict[str, Any]:
    raw = answers.get("B-1") or {}
    height_cm = raw.get("height")
    weight_kg = raw.get("weight")
    if not height_cm or not weight_kg:
        return {}
    try:
        h_m = float(height_cm) / 100.0
        w = float(weight_kg)
        bmi = round(w / (h_m * h_m), 1)
    except (TypeError, ValueError, ZeroDivisionError):
        return {}
    category, percentile = _classify_bmi(bmi, age)
    return {
        "bmi": bmi,
        "bmi_category": category,
        "bmi_percentile_band": percentile,
        "bmi_method": "adult_cutoffs_mvp",
    }


# ---------- B-1b 체형 만족도 ----------

def _shape_dissatisfaction(answers: dict, bmi_category: str | None) -> dict[str, Any]:
    flags: dict[str, Any] = {}
    score = _get_int(answers, "B-1b-1")
    if score is None:
        return flags
    flags["body_satisfaction"] = score
    # B-1b-1 ≤3 + BMI 정상/저체중 → 신경성 식욕부진 방향 위험 신호
    if score <= 3 and bmi_category in {"normal", "underweight"}:
        flags["body_dissatisfaction_severe"] = True
    # B-1b-1 8-10 + 과체중/비만 → 인식 괴리 없음(동기 지렛대 어려움)
    if score >= 8 and bmi_category in {"overweight", "obese"}:
        flags["body_perception_aligned"] = True
    return flags


# ---------- B-2 변화 동기 (readiness ruler) ----------

def _readiness(answers: dict) -> dict[str, Any]:
    flags: dict[str, Any] = {}
    importance = _get_int(answers, "B-2-1")
    confidence = _get_int(answers, "B-2-2")
    readiness = _get_int(answers, "B-2-3")
    if importance is None:
        return flags

    flags["importance"] = importance
    if confidence is not None:
        flags["confidence"] = confidence
    if readiness is not None:
        flags["readiness"] = readiness

    if importance <= 3:
        flags["readiness_stage"] = "precontemplation"
    elif importance <= 6:
        flags["readiness_stage"] = "contemplation"
    elif (
        confidence is not None
        and readiness is not None
        and confidence >= 7
        and readiness >= 7
    ):
        flags["readiness_stage"] = "action_ready"
    else:
        flags["readiness_stage"] = "preparation"

    if importance >= 7 and confidence is not None and confidence <= 3:
        flags["self_efficacy_deficit"] = True
    if importance >= 7 and readiness is not None and readiness <= 3:
        flags["will_deficit"] = True
    return flags


# ---------- C 섹션: 동반 정신병리 ----------

def _depression(answers: dict) -> dict[str, Any]:
    s = _sum(answers, ["C-1-1", "C-1-2"])
    return {
        "phq2_sum": s,
        "depression_positive": s >= 3,
    }


def _suicide(answers: dict) -> dict[str, Any]:
    screen = _yes(answers, "C-2-1") or _yes(answers, "C-2-2")
    acute = _yes(answers, "C-2-3")
    return {
        "suicide_screen": screen,
        "suicide_acute": acute,
    }


def _mania(answers: dict) -> dict[str, Any]:
    if not _yes(answers, "C-3-1"):
        return {"mania_positive": False}
    return {
        "mania_positive": _select_in(
            answers, "C-3-2", {"4_plus", "1_week_plus"}
        ),
    }


def _psychosis(answers: dict) -> dict[str, Any]:
    if not _yes(answers, "C-4-1"):
        return {"psychosis_positive": False}
    # 잠들기 직전(입면기 환각) 만 양성이면 제외
    hypnagogic_only = _yes(answers, "C-4-3")
    return {
        "psychosis_positive": not hypnagogic_only,
        "psychosis_hypnagogic_only": hypnagogic_only,
    }


def _panic(answers: dict) -> dict[str, Any]:
    if not _yes(answers, "C-5-1"):
        return {"panic_positive": False}
    # K-SADS 컷오프: 4번 이상 + 걱정 "많이 돼".
    # C-5-2 "거의 매일"/"주 몇 번" 둘 다 4회 이상에 해당.
    freq_ok = _select_in(answers, "C-5-2", {"almost_daily", "weekly"})
    worry = _select(answers, "C-5-3") == "lots"
    return {"panic_positive": freq_ok and worry}


def _social_phobia(answers: dict) -> dict[str, Any]:
    base = _get_int(answers, "C-6-1") or 0
    avoid = _yes(answers, "C-6-2")
    return {"social_phobia_positive": base >= 2 and avoid}


def _gad(answers: dict) -> dict[str, Any]:
    s = _sum(answers, ["C-7-1", "C-7-2"])
    return {"gad_sum": s, "anxiety_positive": s >= 3}


def _ocd(answers: dict) -> dict[str, Any]:
    base = _get_int(answers, "C-8-1") or 0
    interference = _select(answers, "C-8-2")
    return {
        "ocd_positive": base >= 2 and interference in {"some", "lots"},
    }


def _purging_and_exercise(answers: dict) -> dict[str, Any]:
    """C-10 체중감량 행동 분석."""
    raw = answers.get("C-10") or {}
    rows = raw.get("rows") or {}

    def _checked_with_freq(row_id: str) -> bool:
        row = rows.get(row_id) or {}
        if not row.get("checked"):
            return False
        freq = row.get("frequency") or 0
        try:
            return int(freq) >= 1
        except (TypeError, ValueError):
            return False

    tier1_rows = {"a", "b", "c", "d"}
    tier2_rows = {"f", "g"}

    purging = any(_checked_with_freq(r) for r in tier1_rows)
    tier2_positive = any(_checked_with_freq(r) for r in tier2_rows)
    exercise_endorsed = _checked_with_freq("e")
    driven_exercise_score = _get_int(answers, "C-10-h") or 0
    compensatory_exercise = exercise_endorsed and driven_exercise_score >= 2

    return {
        "purging_flag": purging,
        "weight_control_tier2": tier2_positive,
        "compensatory_exercise_flag": compensatory_exercise,
    }


def _anorexia(answers: dict, bmi_flags: dict[str, Any], c10_flags: dict[str, Any]) -> dict[str, Any]:
    fear = _get_int(answers, "C-9-1") or 0
    band = bmi_flags.get("bmi_percentile_band")
    behavior_positive = c10_flags.get("purging_flag") or c10_flags.get("weight_control_tier2")
    bmi_below_15 = band == "<15"
    return {
        "anorexia_candidate": (fear >= 2 and bool(behavior_positive)) or bmi_below_15,
    }


def _bed(answers: dict) -> dict[str, Any]:
    base = _get_int(answers, "C-11-1") or 0
    binge = _yes(answers, "C-11-2")
    distress = _yes(answers, "C-11-3")
    return {"bed_candidate": base >= 2 and binge and distress}


def _adhd(answers: dict) -> dict[str, Any]:
    s = _sum(answers, ["C-12-1", "C-12-2"])
    impairment = _select(answers, "C-12-3")
    return {
        "adhd_sum": s,
        "adhd_positive": s >= 4 and impairment in {"some", "lots"},
    }


def _substance(answers: dict) -> dict[str, Any]:
    smoke = _select(answers, "C-13-1")
    alc = _select(answers, "C-13-2")
    drug = _yes(answers, "C-13-3")
    return {
        "smoking_positive": smoke is not None and smoke != "none",
        "alcohol_positive": alc is not None and alc != "none",
        "drug_positive": drug,
    }


def _ptsd(answers: dict) -> dict[str, Any]:
    return {"ptsd_positive": _yes(answers, "C-14-1")}


# ---------- 진입점 ----------

def score(answers: dict, context: dict) -> dict[str, Any]:
    """answers 와 context(user_age, user_sex) 로 derived_flags 생성.

    context 키:
      - user_age: int | None — A-1 prefill 안 했을 때 정확한 BMI percentile 위해
      - user_sex: "male" | "female" | None
    """
    age = context.get("user_age")

    flags: dict[str, Any] = {}

    bmi_flags = _compute_bmi(answers, age)
    flags.update(bmi_flags)

    flags.update(_shape_dissatisfaction(answers, bmi_flags.get("bmi_category")))
    flags.update(_readiness(answers))

    flags.update(_depression(answers))
    flags.update(_suicide(answers))
    flags.update(_mania(answers))
    flags.update(_psychosis(answers))
    flags.update(_panic(answers))
    flags.update(_social_phobia(answers))
    flags.update(_gad(answers))
    flags.update(_ocd(answers))

    c10_flags = _purging_and_exercise(answers)
    flags.update(c10_flags)
    flags.update(_anorexia(answers, bmi_flags, c10_flags))
    flags.update(_bed(answers))
    flags.update(_adhd(answers))
    flags.update(_substance(answers))
    flags.update(_ptsd(answers))

    return flags

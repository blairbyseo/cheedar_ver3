"""레거시 CSV(cheddar_db_backup_260619) → cheedar_ver3 스키마 변환 규칙.

순수 함수만 담는다(표준 라이브러리 의존) — DB 없이 pytest로 검증한다.
반환 dict에는 id/FK를 넣지 않는다: 대상 DB에 기존 데이터가 있어 레거시 PK를
보존할 수 없으므로, user_id/schema_id/message_id 연결은 ETL이 매핑 dict로 한다.
레거시 timestamp는 naive UTC다(pagetimelog 시간 히스토그램으로 확인:
활동이 UTC 0~15시 = KST 저녁에 집중).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone

MEAL_TIME_MAP = {"아침": "breakfast", "점심": "lunch", "저녁": "dinner", "간식": "snack"}
CHAT_ROLE_MAP = {"USER": "user", "ASSISTANT": "ai"}


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"인식할 수 없는 timestamp: {s!r}")


def parse_date(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def parse_bool(s: str | None) -> bool:
    return (s or "").strip().lower() == "true"


def parse_float(s: str | None) -> float | None:
    return float(s) if s not in (None, "") else None


def parse_int_from_float(s: str | None) -> int | None:
    v = parse_float(s)
    return round(v) if v is not None else None


def age_from_birth(birth_date: str | None, as_of: date) -> int | None:
    if not birth_date:
        return None
    b = date.fromisoformat(birth_date)
    return as_of.year - b.year - ((as_of.month, as_of.day) < (b.month, b.day))


def make_user_id(email: str | None, kakao_id: str | None, legacy_id: int | str, taken: set[str]) -> str:
    """로그인 아이디 생성. 카카오는 kakao_{id}, 이메일은 로컬파트(소문자).

    taken 은 운영 DB의 기존 user_id(소문자) + 이번 실행에서 이미 발급한 것.
    중복이면 레거시 PK를 suffix로 붙인다(실측 충돌: test01 2건).
    """
    if kakao_id:
        base = f"kakao_{kakao_id}"
    else:
        base = (email or "").split("@")[0].lower()
    if not base:
        base = f"user_{legacy_id}"
    candidate = base if base not in taken else f"{base}_{legacy_id}"
    if candidate in taken:
        raise ValueError(f"user_id 중복 해소 실패: {candidate}")
    taken.add(candidate)
    return candidate


def transform_user(row: dict, taken: set[str], as_of: date) -> dict:
    """신규 생성용 users 필드. (기존 계정과 병합되는 경우 ETL이 이 함수를 쓰지 않는다.)"""
    kakao_id = row["kakao_id"] or None
    return {
        "kakao_id": kakao_id,
        "email": row["email"] or None,
        "user_id": make_user_id(row["email"], kakao_id, row["id"], taken),
        "nickname": row["name"] or None,
        # 카카오 가입자는 현재 모델 규약상 password_hash=None (원본은 legacy 스키마에 보존)
        "password_hash": None if kakao_id else (row["password_hash"] or None),
        "age": age_from_birth(row["birth_date"], as_of),
        "height_cm": parse_float(row["height"]),
        "weight_kg": parse_float(row["last_weight"]),
        "is_admin": row["role"] == "admin",
        "onboarded": parse_bool(row["onboarded"]),
        "last_survey_at": parse_ts(row["last_survey_at"]),
        "created_at": parse_ts(row["created_at"]),
    }


def transform_meal(row: dict) -> dict | None:
    """dietlog 1행 → meals. is_skipped 행은 대응 컬럼이 없어 None(미이식)."""
    if parse_bool(row["is_skipped"]):
        return None
    items = row["items"] or None
    if items is not None:
        json.loads(items)  # 유효성 검사 — 깨진 JSON이면 여기서 즉시 실패
    ts = parse_ts(row["created_at"])
    return {
        "meal_type": MEAL_TIME_MAP[row["meal_time"]],
        "eaten_on": parse_date(row["date"]),
        "menu": row["description"] or None,
        "calories": parse_int_from_float(row["calories"]),
        "carbs_g": parse_float(row["carbs"]),
        "protein_g": parse_float(row["protein"]),
        "fat_g": parse_float(row["fat"]),
        "image_path": row["image_url"] or None,
        "items": items,
        "created_at": ts,
        "updated_at": ts,
    }


def transform_chat_message(row: dict) -> dict:
    return {
        "role": CHAT_ROLE_MAP[row["role"]],
        "text": row["content"],
        "created_at": parse_ts(row["created_at"]),
    }


def transform_exercise(row: dict) -> dict:
    is_skipped = parse_bool(row["is_skipped"])
    items = row["items"] or None
    if items is not None:
        json.loads(items)
    elif not is_skipped and row["exercise_type"]:
        # 초기 데이터: items 없이 exercise_type 단일 기록 → 현재 item 구조로 재구성
        items = json.dumps([{
            "exercise_name": row["exercise_type"],
            "met": None,
            "duration_hours": int(row["duration_hours"] or 0),
            "duration_minutes": int(row["duration_minutes"] or 0),
            "intensity": None,
            "calories_burned": parse_float(row["calories_burned"]),
        }], ensure_ascii=False)
    ts = parse_ts(row["created_at"])
    return {
        "done_on": parse_date(row["date"]),
        "is_skipped": is_skipped,
        "calories_burned": parse_float(row["calories_burned"]),
        "items": items,
        "created_at": ts,
        "updated_at": ts,
    }


def transform_emotion(row: dict) -> dict:
    return {
        "occurred_at": parse_ts(row["occurred_at"]),
        "emotion_label": row["emotion_label"],
        "score": int(row["score"]),
        "note": row["note"] or None,
        "created_at": parse_ts(row["created_at"]),
    }


def transform_survey_response(row: dict) -> dict:
    return {
        "kind": row["kind"],
        "status": row["status"],
        "current_section": row["current_section"] or None,
        "answers": json.loads(row["answers"] or "{}"),
        "derived_flags": json.loads(row["derived_flags"] or "{}"),
        "started_at": parse_ts(row["started_at"]),
        "updated_at": parse_ts(row["updated_at"]),
        "completed_at": parse_ts(row["completed_at"]),
    }


def transform_safety(row: dict) -> dict:
    return {
        "risk_level": row["risk_level"].lower(),
        "detected_category": row["detected_category"],
        "description": row["description"] or None,
        "risk_score": parse_int_from_float(row["risk_score"]),
        "ai_score": parse_float(row["ai_score"]),
        "status": row["status"] or "unresolved",
        "is_resolved": parse_bool(row["is_resolved"]),
        "created_at": parse_ts(row["created_at"]),
    }


def transform_page_time(row: dict) -> dict:
    return {
        "page_path": row["page_path"],
        "time_spent_seconds": float(row["time_spent_seconds"]),
        "metric_type": row["metric_type"] or "sample",
        "created_at": parse_ts(row["created_at"]),
    }


def transform_user_flow(row: dict) -> dict:
    return {
        "from_page": row["from_page"],
        "to_page": row["to_page"],
        "created_at": parse_ts(row["created_at"]),
    }

"""운동 칼로리 계산 + 미지정 종목 MET 추정.

Cheddar_Team_26 의 운동 로직을 이 프로젝트(SQLAlchemy + 동기 OpenAI 클라이언트)
스타일로 옮긴 것. 소모 칼로리는 MET × 체중 × 시간 × 강도계수 로 계산한다.
체중은 참고 구현처럼 별도 BodyLog 가 없으면 기본값(settings.default_weight_kg)을 쓴다.
"""
import json
import logging

from openai import OpenAIError

from app.core.config import get_settings
from app.schemas.exercise import ExerciseItemInput

logger = logging.getLogger(__name__)
settings = get_settings()

# 사전 MET(보통 강도 기준). 프론트 utils/exercise.js 의 MET_MAP 과 동기화.
EXERCISE_MET: dict[str, float] = {
    "달리기": 9.8,
    "자전거": 7.5,
    "웨이트 트레이닝": 6.0,
    "수영": 8.0,
    "요가/필라테스": 3.0,
    # 영어 키도 허용
    "running": 9.8,
    "cycling": 7.5,
    "weight": 6.0,
    "swimming": 8.0,
    "yoga": 3.0,
}

MET_ESTIMATE_PROMPT = (
    "너는 운동 활동의 MET(Metabolic Equivalent of Task) 값을 추정하는 도우미다. "
    "ACSM Compendium 범위(1.5~15) 안에서 대표값을 반환한다. 보통 강도 기준. "
    "결과는 반드시 JSON 객체로만 응답한다.\n"
    "규칙: met 은 1.5~15 범위의 숫자(소수 1자리). "
    "normalized_name 은 한국어 단일 명사구(예: 'badminton' → '배드민턴'). "
    "notes 는 필요할 때만 한국어 한 문장, 없으면 null. "
    "운동이 아닌 입력도 가장 비슷한 활동의 MET 로 추정한다.\n"
    '스키마: {"normalized_name": string, "met": number, "notes": string|null}'
)


def intensity_multiplier(intensity: int) -> float:
    """주관적 강도(1-5) → MET 곱셈 계수.

    1: 0.7(아주 편함) / 2: 0.85(편함) / 3: 1.0(보통) / 4: 1.2(힘듦) / 5: 1.4(최대)
    """
    multipliers = {1: 0.7, 2: 0.85, 3: 1.0, 4: 1.2, 5: 1.4}
    # 범위 밖 값(예: 강도 체계가 1-10이던 시절의 옛 기록)은 가까운 쪽으로 보정.
    clamped = max(1, min(5, int(intensity)))
    return multipliers[clamped]


def calc_calories_burned(
    *, met: float, weight_kg: float, duration_hours: float, intensity: int
) -> float:
    """MET × 체중 × 시간(h) × 강도계수 → kcal (소수 1자리)."""
    kcal = (
        float(met)
        * float(weight_kg)
        * float(duration_hours)
        * intensity_multiplier(int(intensity))
    )
    return round(kcal, 1)


def item_calories(item: ExerciseItemInput, weight_kg: float) -> float:
    duration_hours = float(item.duration_hours) + float(item.duration_minutes) / 60.0
    return calc_calories_burned(
        met=item.met,
        weight_kg=weight_kg,
        duration_hours=duration_hours,
        intensity=item.intensity,
    )


def resolve_met(exercise_name: str) -> float | None:
    """사전 MET DB에서 조회. 없으면 None (AI 추정 필요)."""
    key = (exercise_name or "").strip()
    if key in EXERCISE_MET:
        return EXERCISE_MET[key]
    return EXERCISE_MET.get(key.lower())


def estimate_met(exercise_name: str) -> dict:
    """미지정 종목의 MET 을 추정해 {normalized_name, met, notes} 반환.

    analyze_meal_image 와 동일하게, AI 가 꺼져 있거나(.env AI_MOCK_MODE) 키가
    없거나 호출이 실패하면 기본값으로 폴백한다 — 프론트는 항상 쓸 수 있는 형태를 받는다.
    """
    name = (exercise_name or "").strip()
    fallback = {"normalized_name": name or "운동", "met": 5.0, "notes": None}

    if settings.ai_mock_mode or not settings.openai_api_key:
        return fallback

    # 지연 import — openai_client 의 동기 클라이언트 재사용
    from app.services.openai_client import _client, _strip_code_fence

    try:
        resp = _client().chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": MET_ESTIMATE_PROMPT},
                {"role": "user", "content": f"운동명: {name}"},
            ],
            response_format={"type": "json_object"},
        )
        data = json.loads(_strip_code_fence(resp.choices[0].message.content or ""))
    except (OpenAIError, json.JSONDecodeError, KeyError, IndexError) as exc:
        logger.warning("MET estimate failed, using fallback: %s", exc)
        return fallback

    try:
        met = float(data.get("met"))
    except (TypeError, ValueError):
        met = 5.0
    met = max(1.5, min(15.0, met))

    normalized = str(data.get("normalized_name") or name).strip() or name
    notes = data.get("notes")
    if notes is not None and not isinstance(notes, str):
        notes = None

    return {"normalized_name": normalized, "met": round(met, 1), "notes": notes}

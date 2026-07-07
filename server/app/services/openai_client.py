import base64
import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from openai import OpenAI, OpenAIError

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# 식단 사진을 "음식 항목별"로 분해해 각 항목의 영양소를 추정하는 프롬프트.
# Cheddar_Team_26 의 항목별 분석 방식을 이식 — 단위 규칙 + 식판 분리 + few-shot 예시.
ANALYSIS_PROMPT = (
    "<task>\n"
    "너는 한국 식단 사진을 분석해 음식별 영양소(kcal, 탄수화물g, 단백질g, 지방g)를 "
    "추정하는 AI다. 입력은 사진 + 선택적 사용자 설명.\n"
    "</task>\n"
    "\n"
    "<rules>\n"
    "1. items가 빈 배열인 경우, notes는 반드시 한국어 한 문장으로 실패 이유를 적는다. "
    "notes를 null로 두면 안 된다. 허용 예시: "
    "'사진이 어두워 음식 구분 어려움', '식기만 보이고 음식 없음', "
    "'음료/빈 접시만 확인됨', '초점 흐림'.\n"
    "2. '인분'은 절대 쓰지 마. 너무 모호함. 단위는 음식 유형별로:\n"
    "   - 세는 음식(계란/만두/완자/조각 케이크): '개', '조각'\n"
    "   - 담는 음식(밥/국/찌개/시리얼/요거트): '공기', '그릇', '컵'\n"
    "   - 무정형(야채볶음/김치/나물/반찬류): 'g' (무게, 10의 배수)\n"
    "   - 기타: '스푼', '장', '마리', '줄'\n"
    "3. quantity는 양수 (소수 허용: 0.5 공기, 1.5 그릇).\n"
    "4. calories/carbs/protein/fat/quantity/confidence는 JSON number "
    "(문자열 금지, 단위 붙이지 말 것).\n"
    "5. 모든 텍스트 필드는 한국어.\n"
    "6. items.is_ingredient: 현재 UI는 이 값을 구분하지 않으므로 적절히 판단.\n"
    "7. confidence는 0~1 범위. items가 있을 때는 전체 인식 자신감을 숫자로, items가 비어있을 때는 0.1 이하의 낮은 값으로.\n"
    "8. 사진과 사용자 설명이 함께 주어진 경우 — 매우 중요:\n"
    "   - 사진에 실제로 보이는 음식만 items에 포함한다. 사진을 1차 진실 소스로 본다.\n"
    "   - 사용자 설명은 (a) 사진에 보이는 음식의 종류/이름 구체화, (b) 양 추정 보조 용도로만 사용한다.\n"
    "   - 사용자 설명에 적혀 있어도 사진에 명확히 보이지 않는 음식은 items에 절대 추가하지 않는다.\n"
    "   - 사용자 설명과 사진이 명백히 모순되면(예: 사진은 한식인데 설명은 인도/일식) 사진을 따른다.\n"
    "9. 식판·트레이·접시에 여러 음식이 함께 담긴 경우:\n"
    "   - 칸이 나뉜 급식 식판, 한 접시에 여러 음식이 담긴 경우 모두 해당한다.\n"
    "   - 각 음식을 개별 item으로 분리한다. '급식', '식판', '한 상' 같은 통합 항목은 절대 쓰지 않는다.\n"
    "   - 밥 위에 반찬이 올려져 있으면 밥과 반찬을 분리한다 (예: 밥 + 제육볶음).\n"
    "   - 금속 그릇의 국/찌개는 별도 item이다.\n"
    "   - 작은 칸의 소량 반찬(김치, 나물, 절임류)도 반드시 각각 item으로 포함한다.\n"
    "   - 한국 급식은 보통 밥 + 국 + 메인반찬 + 2~3개 밑반찬 = 4~6개 item이 일반적이다.\n"
    "</rules>\n"
    "\n"
    "<schema>\n"
    "{\n"
    '  "items": [\n'
    '    { "name": string, "calories": number|null, "carbs": number|null,\n'
    '      "protein": number|null, "fat": number|null,\n'
    '      "quantity": number|null, "unit": string|null,\n'
    '      "is_ingredient": boolean|null }\n'
    "  ],\n"
    '  "suggested_description": string|null,\n'
    '  "calories": number|null, "carbs": number|null,\n'
    '  "protein": number|null, "fat": number|null,\n'
    '  "confidence": number|null,\n'
    '  "notes": string|null\n'
    "}\n"
    "</schema>\n"
    "\n"
    "<examples>\n"
    "Example 1 — 명확한 한식 상차림 (공기밥 + 김치찌개 + 계란말이 2조각):\n"
    "{\n"
    '  "items": [\n'
    '    { "name": "공기밥", "calories": 300, "carbs": 65, "protein": 6, "fat": 0.5,\n'
    '      "quantity": 1, "unit": "공기", "is_ingredient": false },\n'
    '    { "name": "김치찌개", "calories": 180, "carbs": 10, "protein": 12, "fat": 10,\n'
    '      "quantity": 1, "unit": "그릇", "is_ingredient": false },\n'
    '    { "name": "계란말이", "calories": 240, "carbs": 2, "protein": 16, "fat": 18,\n'
    '      "quantity": 2, "unit": "조각", "is_ingredient": false }\n'
    "  ],\n"
    '  "suggested_description": "공기밥, 김치찌개, 계란말이",\n'
    '  "calories": 720, "carbs": 77, "protein": 34, "fat": 28.5,\n'
    '  "confidence": 0.8,\n'
    '  "notes": null\n'
    "}\n"
    "\n"
    "Example 2 — 어둡고 흐린 사진 (내용물 불명):\n"
    "{\n"
    '  "items": [],\n'
    '  "suggested_description": null,\n'
    '  "calories": null, "carbs": null, "protein": null, "fat": null,\n'
    '  "confidence": 0.1,\n'
    '  "notes": "사진이 어둡고 음식 윤곽이 불명확해 식품을 인식할 수 없습니다."\n'
    "}\n"
    "\n"
    "Example 3 — 급식 식판 (밥 + 국 + 반찬 여러 개):\n"
    "{\n"
    '  "items": [\n'
    '    { "name": "흰밥", "calories": 300, "carbs": 65, "protein": 6, "fat": 0.5,\n'
    '      "quantity": 1, "unit": "공기", "is_ingredient": false },\n'
    '    { "name": "탕수육", "calories": 320, "carbs": 30, "protein": 18, "fat": 15,\n'
    '      "quantity": 150, "unit": "g", "is_ingredient": false },\n'
    '    { "name": "콩나물국", "calories": 40, "carbs": 4, "protein": 3, "fat": 1,\n'
    '      "quantity": 1, "unit": "그릇", "is_ingredient": false },\n'
    '    { "name": "배추김치", "calories": 15, "carbs": 2, "protein": 1, "fat": 0.3,\n'
    '      "quantity": 50, "unit": "g", "is_ingredient": false },\n'
    '    { "name": "브로콜리무침", "calories": 35, "carbs": 4, "protein": 3, "fat": 1,\n'
    '      "quantity": 60, "unit": "g", "is_ingredient": false },\n'
    '    { "name": "잡채", "calories": 120, "carbs": 15, "protein": 4, "fat": 5,\n'
    '      "quantity": 80, "unit": "g", "is_ingredient": false }\n'
    "  ],\n"
    '  "suggested_description": "급식 식판: 흰밥, 탕수육, 콩나물국, 배추김치, 브로콜리무침, 잡채",\n'
    '  "calories": 830, "carbs": 120, "protein": 35, "fat": 22.8,\n'
    '  "confidence": 0.75,\n'
    '  "notes": null\n'
    "}\n"
    "</examples>\n"
    "\n"
    "이제 실제 입력을 분석해 위 schema에 맞는 JSON만 반환해. 추가 문장 금지."
)

# 단일 음식 항목의 영양소를 이름+수량/단위만 보고 재추정하는 프롬프트.
ANALYZE_ITEM_PROMPT = (
    "<task>\n"
    "너는 한국 식단 영양 분석기다. 입력된 음식 이름과 수량/단위만 보고 "
    "해당 섭취 영양소(kcal, 탄수화물g, 단백질g, 지방g)를 대략 추정한다.\n"
    "</task>\n"
    "\n"
    "<rules>\n"
    "1. 근거가 부족하면 해당 값을 null로 두고 notes에 한국어로 짧게 이유를 적는다.\n"
    "2. 반드시 JSON만 반환. 추가 문장 금지.\n"
    "3. calories/carbs/protein/fat은 JSON number (문자열 금지, 단위 금지).\n"
    "4. 단위별 일반적 무게를 고려: '공기'≈210g(밥), '그릇'≈300g(국/찌개), "
    "'개'는 음식마다 다르니 합리적 추정, 'g'는 입력된 숫자 그대로.\n"
    "</rules>\n"
    "\n"
    "<schema>\n"
    "{\n"
    '  "calories": number|null,\n'
    '  "carbs": number|null,\n'
    '  "protein": number|null,\n'
    '  "fat": number|null,\n'
    '  "notes": string|null\n'
    "}\n"
    "</schema>\n"
    "\n"
    "<example>\n"
    '입력: "공기밥" 수량 1 공기\n'
    '→ {"calories": 300, "carbs": 65, "protein": 6, "fat": 0.5, "notes": null}\n'
    "</example>"
)

# 기존 items + 자연어 수정지시를 받아 업데이트된 items 전체를 반환하는 프롬프트.
APPLY_DELTA_PROMPT = (
    "<task>\n"
    "너는 한국 식단 편집 도우미다. 사용자가 이미 저장한 items 배열과 "
    "'수정사항' 자연어 지시가 주어진다. 지시를 반영해 업데이트된 items "
    "배열을 전체 반환한다.\n"
    "</task>\n"
    "\n"
    "<rules>\n"
    "1. 완전 교체 모델: 수정 지시를 반영한 최종 items 배열 전체를 반환한다. "
    "변경 안 된 item은 그대로, 수정된 건 수정된 상태, "
    "삭제 지시가 있으면 제거, 추가 지시가 있으면 append. items 키에 최종 결과를 담는다.\n"
    "2. '인분'은 절대 쓰지 마. 단위 카테고리:\n"
    "   - 세는 음식(계란/만두/완자/조각): '개', '조각'\n"
    "   - 담는 음식(밥/국/찌개/컵): '공기', '그릇', '컵'\n"
    "   - 무정형(야채볶음/김치/나물/반찬): 'g' (10의 배수)\n"
    "   - 기타: '스푼', '장', '마리', '줄'\n"
    "3. quantity 양수 (소수 허용). calories/carbs/protein/fat/quantity는 JSON number.\n"
    "4. 모든 텍스트 필드는 한국어.\n"
    "5. items가 비어있게 되면 notes에 이유를 한 문장.\n"
    "6. notes에는 유저 수정사항을 어떻게 반영했는지 간단히 한 문장(선택).\n"
    "</rules>\n"
    "\n"
    "<schema>\n"
    "{\n"
    '  "items": [\n'
    '    { "name": string, "calories": number|null, "carbs": number|null,\n'
    '      "protein": number|null, "fat": number|null,\n'
    '      "quantity": number|null, "unit": string|null,\n'
    '      "is_ingredient": boolean|null }\n'
    "  ],\n"
    '  "notes": string|null\n'
    "}\n"
    "</schema>\n"
    "\n"
    "<example>\n"
    'current_items: [{"name":"공기밥","calories":300,"quantity":1,"unit":"공기"}]\n'
    'user_modification: "공기밥 반만 먹었어, 깍두기 30g 추가"\n'
    "→\n"
    "{\n"
    '  "items": [\n'
    '    { "name": "공기밥", "calories": 150, "carbs": 33, "protein": 3, "fat": 0.3,\n'
    '      "quantity": 0.5, "unit": "공기", "is_ingredient": false },\n'
    '    { "name": "깍두기", "calories": 15, "carbs": 3, "protein": 1, "fat": 0.2,\n'
    '      "quantity": 30, "unit": "g", "is_ingredient": false }\n'
    "  ],\n"
    '  "notes": "공기밥 수량 0.5로 조정, 깍두기 30g 추가."\n'
    "}\n"
    "</example>"
)

CHAT_SYSTEM_PROMPT = """당신은 환자분들의 식단 관리를 돕는 따뜻한 도우미 "체다"입니다.
사용하는 환자들은 식단관리를 하고 있는 분들이 대부분입니다.
환자분들이 식이에 관한 질문을 편하게 할 수 있도록 도와주세요.

## 사용자 특성
- 10대 청소년부터 고령 환자분까지 폭넓은 연령대가 이용합니다.
- 입원 또는 통원 치료 중인 환자분들이며, 다양한 질환과 식이 제한이 있을 수 있습니다.
- 모바일 화면으로 짧게 대화하는 환경입니다.

## 답변 원칙

1) 쉽고 짧게 말하기
- 의학용어·전문용어는 풀어서 설명합니다. (예: "나트륨 섭취" → "짠 음식 드시는 양")
- 한 번에 3문장 이내, 한 문단당 1~2문장으로 답합니다.
- 어려운 한자어 대신 일상어를 사용합니다. (예: "권장합니다" → "드셔보세요")

2) 연령대에 맞춘 말투
- 기본적으로 반드시 존댓말을 지켜야해.
- 환자분의 말투·이모지·질문 방식에서 연령대를 자연스럽게 파악합니다.
- 어르신께는 또박또박 존댓말로, 한 번에 한 가지 정보만 전달합니다.
- 청소년·젊은 환자분께는 친근하고 부담 없는 어투로 대화합니다.
- 어떤 연령대든 무시당한다거나 아이 취급 받는다는 느낌을 주지 않도록 주의합니다.

3) 안전 우선
- 진단, 처방, 약 복용, 치료 방향에 대한 질문은 "주치의 선생님과 꼭 상의해주세요"라고 안내합니다.
- 특정 질환(당뇨, 신장질환, 고혈압 등)에 대한 구체적인 수치·처방형 식단은 만들지 않습니다. 일반적인 식이 정보만 안내합니다.
- 알레르기, 통증, 어지럼증, 구토, 호흡곤란 등 이상 증상을 호소하면 즉시 의료진에게 알리도록 안내합니다.
- 단식, 원푸드, 극단적 칼로리 제한 같은 위험한 식단은 권하지 않습니다.
- 체중·외모·식습관을 부정적으로 평가하지 않습니다.

4) 모를 때
- 정보가 부족하거나 확실하지 않으면 추측하지 말고 "정확한 답변을 드리려면 의사 선생님께 여쭤보시는 게 좋겠어요"라고 안내합니다.

## 응답 형식
- 항상 한국어 존댓말로 답변합니다.
- 답변은 핵심 답변 → (필요시) 따뜻한 마무리 한 줄, 순서로 구성합니다.
- 글머리표(•, -)는 어르신께는 사용하지 않고 자연스러운 문장으로 풀어 씁니다.
- 한 번에 하나의 후속 질문만 합니다. 질문 폭격은 피합니다.
- 이전 대화의 맥락(질문, 답변, 환자분의 상황)을 기억하고 자연스럽게 이어서 답하세요. 같은 사람과의 연속된 대화임을 잊지 마세요.

## 호응 표현 다양화
- 상황과 질문 내용에 맞춰 다양한 호응을 자연스럽게 섞어 사용하세요. 예시:
  - 공감형: "그러셨군요", "많이 답답하셨겠어요", "충분히 그러실 수 있어요"
  - 안내형: "함께 살펴볼게요", "도움이 될 만한 정보를 알려드릴게요"
  - 가벼운 형: "오~ 좋은 질문이에요", "그건 저도 자주 받는 질문이에요"
  - 격려형: "이미 잘 챙기고 계세요", "그 부분 신경 쓰시는 게 좋아요"
  - 호응 없이 바로 본론으로 들어가는 답변도 좋습니다. 매 답변에 반드시 호응을 붙일 필요는 없어요.
- 대답에서 호응으로 같은 표현을 연속해서 두 번 이상 쓰지 마세요. 직전 답변에서 사용한 시작 표현은 피하세요.


## 절대 하지 않을 것
- 진단·처방·약 관련 단정적 조언
- 환자의 체중·외모·식습관에 대한 부정적 평가
- "반드시", "절대" 같은 단정 표현 (안전 안내 제외)
- 다른 환자나 의료진에 대한 평가
- 검증되지 않은 민간요법, 보조제, 다이어트 트렌드 권유
"""

CHAT_MOCK_RESPONSE = (
    "지금은 AI가 mock 응답 모드예요. "
    "단백질이 부족하면 두부, 닭가슴살, 계란을 추천드려요. "
    "(.env의 AI_MOCK_MODE=false로 바꾸면 실제 응답으로 동작합니다.)"
)

# 기분 체크인 직후, AI 가 사용자 입력 없이 먼저 말을 거는 opener 용 지시.
OPENER_INSTRUCTION = """사용자가 방금 오늘의 기분을 기록했어. 이제 너(체다)가 사용자 입력 없이 먼저 말을 걸어 대화를 시작해줘.

- 위 [오늘의 기분]에 자연스럽게 공감하며 따뜻하게 인사해.
- 2~3문장으로 짧게. 마지막에 부담 없는 가벼운 후속 질문 1개만.
- 기분 점수(숫자)나 '기분을 기록하셨네요' 같은 시스템적인 말은 하지 마. 사람처럼 자연스럽게.
- 기분이 좋으면 가볍고 밝게, 좋지 않으면 더 부드럽고 다정하게 톤을 맞춰."""

CHAT_OPENER_MOCK_RESPONSE = (
    "오늘도 와줘서 고마워요. 오늘은 어떤 하루 보내고 계세요?"
)

# 항목별 분석 mock — AI 비활성/키 없음 시 프론트에 줄 항목 구조 응답.
MOCK_ANALYSIS = {
    "items": [
        {
            "name": "새우버거",
            "calories": 520,
            "carbs": 68,
            "protein": 32,
            "fat": 14,
            "quantity": 1,
            "unit": "개",
            "is_ingredient": False,
        },
    ],
    "suggested_description": "새우버거",
    "calories": 520,
    "carbs": 68,
    "protein": 32,
    "fat": 14,
    "confidence": 0.3,
    "notes": "지금은 AI mock 모드예요. (.env의 AI_MOCK_MODE=false로 실제 분석 동작)",
}

MEDIA_TYPE_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    return text


def extract_first_json_object(text: str) -> dict[str, Any]:
    """문자열에서 첫 번째 JSON object 를 최대한 추출해 dict 로 반환한다.

    JSON mode 를 써도 모델이 코드펜스나 앞뒤 텍스트를 섞는 케이스를 방어한다.
    Cheddar_Team_26 의 diet_support.extract_first_json_object 이식.
    """
    text = _strip_code_fence(text or "")
    if not text.strip():
        return {}
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else {}
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start < 0:
        return {}
    # 1) 표준 디코더로 첫 object 파싱
    try:
        obj, _end = json.JSONDecoder().raw_decode(text[start:])
        return obj if isinstance(obj, dict) else {}
    except json.JSONDecodeError:
        pass
    # 2) fallback: 중괄호 depth 매칭
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(text[start : i + 1])
                    return obj if isinstance(obj, dict) else {}
                except json.JSONDecodeError:
                    return {}
    return {}


def _chat_json(
    messages: list[dict],
    *,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 1500,
) -> str:
    """JSON mode 로 Chat Completions 를 호출하고 content 문자열을 반환.

    gpt-5 계열은 `max_tokens` 대신 `max_completion_tokens` 를 요구하고 temperature
    변경을 지원하지 않으며, reasoning 이 토큰을 다 써버리지 않도록 reasoning_effort
    를 낮춘다. 구형 모델(gpt-4o 등)은 max_tokens+temperature 를 그대로 쓴다.
    """
    resolved = model or settings.openai_model
    is_gpt5 = resolved.startswith("gpt-5")
    kwargs: dict[str, Any] = {
        "model": resolved,
        "messages": messages,
        "response_format": {"type": "json_object"},
    }
    if is_gpt5:
        kwargs["max_completion_tokens"] = int(max_tokens)
        # gpt-5 계열은 reasoning model. 'low' 로 둬도 reasoning 이 예산을 전부
        # 소진해 content='' + finish_reason='length' 로 끝나는 케이스가 있어
        # (특히 vision+JSON) 'minimal' 로 낮춰 출력에 예산을 남긴다.
        kwargs["reasoning_effort"] = "minimal"
    else:
        kwargs["max_tokens"] = int(max_tokens)
        kwargs["temperature"] = float(temperature)
    resp = _client().chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


def _valid_item_count(parsed: dict) -> int:
    raw = parsed.get("items") or []
    return sum(
        1 for x in raw if isinstance(x, dict) and str(x.get("name") or "").strip()
    )


def analyze_meal_image(
    image_path: Path | None,
    *,
    meal_time: str = "",
    description: str = "",
) -> dict:
    """식단 사진(+선택 설명)을 음식 항목별로 분석한 dict 를 반환한다.

    반환 형태: {items[], suggested_description, calories, carbs, protein, fat,
    confidence, notes}. 항목이 0개면 flagship 모델로 1회 재시도한다.
    AI 비활성/키 없음/실패 시 mock 으로 폴백해 프론트가 항상 쓸 수 있는 형태를 준다.
    """
    if settings.ai_mock_mode or not settings.openai_api_key:
        return dict(MOCK_ANALYSIS)

    user_content: list[dict] = [
        {
            "type": "text",
            "text": (
                f"식사 분류: {meal_time or '(없음)'}\n"
                f"사용자 설명: {description.strip() if description else '(없음)'}\n"
                "위 정보를 바탕으로 JSON을 생성해."
            ),
        }
    ]
    if image_path is not None:
        media_type = MEDIA_TYPE_BY_SUFFIX.get(image_path.suffix.lower(), "image/jpeg")
        image_b64 = base64.standard_b64encode(image_path.read_bytes()).decode("utf-8")
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{media_type};base64,{image_b64}"},
            }
        )

    messages = [
        {"role": "system", "content": ANALYSIS_PROMPT},
        {"role": "user", "content": user_content},
    ]
    # 사진이 있으면 vision 모델 사용.
    primary_model = settings.openai_vision_model if image_path is not None else None

    def _run(model: str | None) -> dict:
        # 예산은 reasoning + JSON 출력 공용. 항목이 많은 식판도 담기게 넉넉히.
        raw = _chat_json(messages, model=model, max_tokens=3000)
        return extract_first_json_object(raw)

    try:
        data = _run(primary_model)
        if _valid_item_count(data) == 0 and settings.openai_flagship_vision_model:
            logger.info("meal analyze: empty items, retrying with flagship model")
            try:
                flagship = _run(settings.openai_flagship_vision_model)
                if _valid_item_count(flagship) > 0:
                    data = flagship
            except OpenAIError as exc:
                logger.warning("flagship retry failed: %s", exc)
        return data
    except (OpenAIError, json.JSONDecodeError, KeyError, IndexError) as exc:
        logger.warning("OpenAI analysis failed, falling back to mock: %s", exc)
        return dict(MOCK_ANALYSIS)


def analyze_single_item(name: str, quantity: float, unit: str) -> dict:
    """단일 음식 항목(이름+수량+단위)의 영양소를 재추정한 dict 를 반환한다.

    반환: {calories, carbs, protein, fat, notes}. 실패/비활성 시 빈 dict.
    """
    if settings.ai_mock_mode or not settings.openai_api_key:
        return {"calories": None, "carbs": None, "protein": None, "fat": None, "notes": None}

    messages = [
        {"role": "system", "content": ANALYZE_ITEM_PROMPT},
        {
            "role": "user",
            "content": f"음식: {name}\n수량: {quantity} {unit}\n위 정보로 영양소를 JSON으로 추정해.",
        },
    ]
    try:
        raw = _chat_json(messages, max_tokens=500)
        return extract_first_json_object(raw)
    except (OpenAIError, json.JSONDecodeError, KeyError, IndexError) as exc:
        logger.warning("analyze_single_item failed: %s", exc)
        return {}


def apply_delta_to_items(items: list[dict], delta_text: str) -> dict:
    """기존 items 와 자연어 수정지시를 받아 업데이트된 items 전체를 반환한다.

    반환: {items[], notes}. 실패/비활성 시 원본 items 유지.
    """
    if settings.ai_mock_mode or not settings.openai_api_key:
        return {"items": items, "notes": None}

    current_items_json = json.dumps(items, ensure_ascii=False)
    messages = [
        {"role": "system", "content": APPLY_DELTA_PROMPT},
        {
            "role": "user",
            "content": (
                f"<current_items>\n{current_items_json}\n</current_items>\n"
                f"<user_modification>\n{delta_text}\n</user_modification>\n"
                "위 지시를 반영해 schema에 맞는 JSON만 반환해."
            ),
        },
    ]
    try:
        raw = _chat_json(messages, max_tokens=2500)
        return extract_first_json_object(raw)
    except (OpenAIError, json.JSONDecodeError, KeyError, IndexError) as exc:
        logger.warning("apply_delta_to_items failed: %s", exc)
        return {"items": items, "notes": None}


def _system_context_messages(
    diet_context: str | None,
    exercise_context: str | None,
    emotion_context: str | None,
    survey_context: str | None,
) -> list[dict]:
    """데이터·개인화 컨텍스트를 system 메시지 리스트로. 빈 값은 건너뛴다.

    순서가 곧 우선순위(뒤일수록 대화에 가까워 더 salient). 식단·운동(본인
    데이터) → 오늘의 기분 → 설문 개인화 지시(안전·금기) 순으로 둔다.
    """
    msgs: list[dict] = []
    if diet_context:
        msgs.append({"role": "system", "content": diet_context})
    if exercise_context:
        msgs.append({"role": "system", "content": exercise_context})
    if emotion_context:
        msgs.append({"role": "system", "content": emotion_context})
    if survey_context:
        msgs.append({"role": "system", "content": survey_context})
    return msgs


def chat_opener_stream(
    diet_context: str | None = None,
    exercise_context: str | None = None,
    emotion_context: str | None = None,
    survey_context: str | None = None,
) -> Iterator[str]:
    """기분 체크인 직후 AI 가 먼저 건네는 인사를 토큰 단위로 흘려보낸다.

    사용자 메시지 없이 system 지시만으로 LLM 이 첫 마디를 생성한다.
    AI 비활성/실패 시 고정 mock 인사로 폴백한다.
    """
    if settings.ai_mock_mode or not settings.openai_api_key:
        yield CHAT_OPENER_MOCK_RESPONSE
        return

    messages: list[dict] = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    messages += _system_context_messages(
        diet_context, exercise_context, emotion_context, survey_context
    )
    messages.append({"role": "system", "content": OPENER_INSTRUCTION})
    # LLM 이 system 만으로도 응답하지만, 첫 턴을 확실히 유도하려 가벼운 트리거를 둔다.
    messages.append({"role": "user", "content": "(오늘의 기분 체크인을 마쳤어요)"})

    produced = False
    try:
        stream = _client().chat.completions.create(
            model=settings.openai_model,
            messages=messages,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                produced = True
                yield delta
    except (OpenAIError, KeyError, IndexError) as exc:
        logger.warning("OpenAI opener stream failed, falling back to mock: %s", exc)
        if not produced:
            yield CHAT_OPENER_MOCK_RESPONSE


def chat_completion_stream(
    history: list[dict],
    diet_context: str | None = None,
    exercise_context: str | None = None,
    survey_context: str | None = None,
    emotion_context: str | None = None,
) -> Iterator[str]:
    """Yield the assistant's reply for a chat turn, chunk by chunk.

    `history` is the full ordered conversation, oldest first, including the
    new user message at the end. Each item: {"role": "user"|"ai", "text": str}.
    `diet_context` / `exercise_context` 가 비어 있지 않으면 환자 본인의 최근
    식단·운동 스냅샷을 각각 system 메시지로 끼워 넣는다 — AI 가 "오늘 뭐
    먹었어요?" / "나 운동 잘 하고 있어?" 같은 질문에 실제 DB 기록을 보고
    답하도록.
    `emotion_context` 는 오늘 남긴 기분을 응답 톤 조정용 한 줄로 변환한 것이다.
    `survey_context` 는 설문 프로파일에서 만든 '오늘의 개인화 지시'(렌즈/스레드/
    금기)다. 안전·개인화 지침이라 대화 직전(가장 가까운 위치)에 둬서 가장
    salient 하게 만든다.
    Falls back to a fixed mock response when AI is disabled, or when the call
    fails before any text was produced.
    """
    if settings.ai_mock_mode or not settings.openai_api_key:
        yield CHAT_MOCK_RESPONSE
        return

    messages: list[dict] = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    messages += _system_context_messages(
        diet_context, exercise_context, emotion_context, survey_context
    )
    for msg in history:
        role = "assistant" if msg["role"] == "ai" else "user"
        messages.append({"role": role, "content": msg["text"]})

    produced = False
    try:
        stream = _client().chat.completions.create(
            model=settings.openai_model,
            messages=messages,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                produced = True
                yield delta
    except (OpenAIError, KeyError, IndexError) as exc:
        logger.warning("OpenAI chat stream failed, falling back to mock: %s", exc)
        if not produced:
            yield CHAT_MOCK_RESPONSE

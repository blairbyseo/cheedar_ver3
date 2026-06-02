import base64
import json
import logging
from collections.abc import Iterator
from pathlib import Path

from openai import OpenAI, OpenAIError

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

ANALYSIS_PROMPT = """당신은 식단 사진을 분석해 영양정보를 추정하는 영양 보조 AI입니다.
환자가 업로드한 식사 사진을 보고, 화면에 보이는 **모든 음식 항목(주식, 국/찌개, 반찬, 음료, 디저트 포함)**을 빠짐없이 식별하고 각각의 양을 추정한 뒤, **전체를 합산한 1회 식사 영양정보**를 산출하세요.

[분석 절차]
1. 사진 속 모든 음식을 식별합니다. 한식의 경우 밥, 국/찌개, 메인 반찬, 밑반찬(김치, 나물 등)을 각각 별개 항목으로 인식합니다.
2. 각 음식의 1인분 양(g 또는 ml)을 그릇 크기, 음식의 두께/높이, 일반적인 한국 가정·식당 1인분 기준으로 추정합니다.
3. 각 항목별 칼로리·탄수화물·단백질·지방을 추정한 뒤 모두 더해 식사 전체 합계를 구합니다.
4. 보이지 않거나 가려진 부분은 합리적으로 가정하되, 과도하게 추정하지 않습니다.
5. 음식이 아니거나 식별이 불가능한 경우 calories/protein_g/carbs_g/fat_g 를 0 으로 설정하고 summary 에 그 이유를 적습니다.

[출력 형식 — 반드시 아래 JSON 스키마만 출력. 코드블록, 설명, 추가 텍스트 금지]
{
  "summary": "식별된 음식들을 자연스러운 한 문장으로 (예: '쌀밥, 김치찌개, 시금치나물, 배추김치로 구성된 한식 백반으로 보여요')",
  "calories": 정수(kcal, 모든 음식 합계),
  "protein_g": 숫자(g, 소수점 한 자리까지 허용),
  "carbs_g": 숫자(g, 소수점 한 자리까지 허용),
  "fat_g": 숫자(g, 소수점 한 자리까지 허용),
  "comment": "한 줄로 식사에 대한 영양 조언 (예: '나트륨이 높을 수 있으니 국물은 절반만 드시는 게 좋아요')"
}

[작성 규칙]
- summary: 누락 없이 보이는 음식을 모두 언급하되 한 문장으로 자연스럽게.
- 숫자 필드: 반드시 숫자 타입. 단위 문자열, 범위 표현("300~400"), null 금지. 추정이 어렵더라도 단일 숫자로 제시.
- comment: 한 문장(40자 내외). 환자에게 도움이 되는 실용적 조언. 진단·처방·단정 표현 금지. "~로 보여요", "~좋아요" 같은 부드러운 어투 사용.
- 전체 응답은 위 JSON 객체 하나로만 끝낼 것. 다른 텍스트를 절대 덧붙이지 마세요.
"""

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

MOCK_RESPONSE = {
    "summary": "새우버거로 추정돼요",
    "calories": 520,
    "protein_g": 32.0,
    "carbs_g": 68.0,
    "fat_g": 14.0,
    "comment": "단백질은 충분하지만 나트륨 섭취는 조금 주의해보세요",
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


def analyze_meal_image(image_path: Path) -> dict:
    """Return analysis dict matching MOCK_RESPONSE shape.

    Falls back to mock when AI_MOCK_MODE is on, OpenAI key is missing, or the
    request raises. The frontend always gets a usable shape.
    """
    if settings.ai_mock_mode or not settings.openai_api_key:
        return dict(MOCK_RESPONSE)

    media_type = MEDIA_TYPE_BY_SUFFIX.get(image_path.suffix.lower(), "image/jpeg")
    image_b64 = base64.standard_b64encode(image_path.read_bytes()).decode("utf-8")
    data_url = f"data:{media_type};base64,{image_b64}"

    try:
        resp = _client().chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ANALYSIS_PROMPT},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            response_format={"type": "json_object"},
        )
        text = _strip_code_fence(resp.choices[0].message.content or "")
        return json.loads(text)
    except (OpenAIError, json.JSONDecodeError, KeyError, IndexError) as exc:
        logger.warning("OpenAI analysis failed, falling back to mock: %s", exc)
        return dict(MOCK_RESPONSE)


def chat_completion_stream(
    history: list[dict],
    diet_context: str | None = None,
) -> Iterator[str]:
    """Yield the assistant's reply for a chat turn, chunk by chunk.

    `history` is the full ordered conversation, oldest first, including the
    new user message at the end. Each item: {"role": "user"|"ai", "text": str}.
    `diet_context` 가 비어 있지 않으면 환자 본인의 최근 식단 스냅샷을 두 번째
    system 메시지로 끼워 넣는다 — AI 가 "오늘 뭐 먹었어요?" 같은 질문에 실제
    DB 기록을 보고 답하도록.
    Falls back to a fixed mock response when AI is disabled, or when the call
    fails before any text was produced.
    """
    if settings.ai_mock_mode or not settings.openai_api_key:
        yield CHAT_MOCK_RESPONSE
        return

    messages: list[dict] = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    if diet_context:
        messages.append({"role": "system", "content": diet_context})
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

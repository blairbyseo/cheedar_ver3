"""채팅 호출 시 AI 에게 함께 보여줄 '동적 지시 프롬프트' 빌더.

`cheddar_data_activation_design_v3` 설계서의 핵심인 "엔진↔채팅 다리" 구현.
설문 derived_flags(= L1 차원 프로파일의 출발점)를 읽어, 그 환자에게 어떤
개입 모듈을 켜야 하는지(L2) 판단하고, 그것을 채팅 한 덩어리의 system 지시로
수렴시킨다: 적용 렌즈 1개 + 추가 스레드 0~2개 + 🚫 금기 + 트라우마 오버레이.

diet_context / exercise_context 와 같은 자리에 끼우지만 성격이 다르다:
- 식단·운동은 환자 본인 데이터(보여줘도 됨)지만,
- 이 컨텍스트는 자살·섭식 같은 민감 신호라 점수·진단명을 노출하지 않고
  "어떻게 대하라"는 행동 지침으로만 변환한다.

설계 원칙
- '홈베이스 유지': 채팅의 본업은 여전히 식단·운동 대화. 개인화는 그 위에
  렌즈 1 + 스레드 0~2 만 얹는다(과하게 임상봇이 되지 않기).
- '균형 다이얼': 신호가 없으면 빈 문자열(순수 식단 대화), 신호가 크면
  렌즈·스레드를 켠다.
- '위험은 관리자': 자살·정신증·purging 등 고위험은 채팅이 위기 상담을 하지
  않는다. 채팅은 비판단·따뜻한 톤만 유지하고, 위험 신호 자체는 SafetyEvent
  로 적재되어 관리자(감독 전문의) 화면으로 간다.
- LLM 호출 없이 flags 매핑만으로 결정적으로 만든다.
- 가장 최근 '완료(COMPLETED)' 설문 1건의 derived_flags 만 사용한다.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.survey import SurveyResponse, SurveyResponseStatus


def _latest_completed_flags(db: Session, user_id: int) -> dict:
    """사용자의 가장 최근 완료 설문의 derived_flags 를 반환. 없으면 빈 dict."""
    row = db.execute(
        select(SurveyResponse)
        .where(
            SurveyResponse.user_id == user_id,
            SurveyResponse.status == SurveyResponseStatus.COMPLETED,
        )
        .order_by(SurveyResponse.completed_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        return {}
    return row.derived_flags or {}


class _Profile:
    """flags 에서 뽑아낸 개입 프로파일. 렌즈/스레드/금기/톤을 누적한다."""

    def __init__(self) -> None:
        # 적용 렌즈 후보 (우선순위 높은 1개만 최종 사용)
        self.lens_candidates: list[tuple[int, str]] = []
        # 추가 스레드 후보 (우선순위로 최대 2개 사용)
        self.thread_candidates: list[tuple[int, str]] = []
        # 🚫 금기 (중복 제거하며 누적)
        self.forbidden: list[str] = []
        # 톤 오버레이 (트라우마 등 전 모듈 공통)
        self.tone_overlays: list[str] = []
        # M-Engage 준비도 지시 (항상 1줄)
        self.engage_line: str | None = None

    def add_lens(self, priority: int, text: str) -> None:
        self.lens_candidates.append((priority, text))

    def add_thread(self, priority: int, text: str) -> None:
        self.thread_candidates.append((priority, text))

    def forbid(self, *items: str) -> None:
        for it in items:
            if it not in self.forbidden:
                self.forbidden.append(it)

    def overlay(self, text: str) -> None:
        if text not in self.tone_overlays:
            self.tone_overlays.append(text)

    @property
    def has_signal(self) -> bool:
        return bool(
            self.lens_candidates
            or self.thread_candidates
            or self.forbidden
            or self.tone_overlays
            or self.engage_line
        )


def _flag(flags: dict, key: str) -> bool:
    return bool(flags.get(key))


def _build_profile(flags: dict) -> _Profile:
    """derived_flags → 활성 모듈 → 렌즈/스레드/금기/톤 누적.

    우선순위 숫자가 작을수록 먼저(렌즈 1개 / 스레드 2개 선택 시 정렬 기준).
    섭식 안전이 식단 앱에서 가장 치명적이라 가장 높은 우선순위를 둔다.
    """
    p = _Profile()

    # ---- 섭식 관련 신호 묶음 --------------------------------------
    eating_high = _flag(flags, "purging_flag") or _flag(flags, "anorexia_candidate")
    eating_any = (
        eating_high
        or _flag(flags, "bed_candidate")
        or _flag(flags, "weight_control_tier2")
        or _flag(flags, "compensatory_exercise_flag")
        or _flag(flags, "body_dissatisfaction_severe")
    )

    # ===== M-RegulateEating / 섭식 안전 (최우선) ====================
    if eating_any:
        if _flag(flags, "bed_candidate") or _flag(flags, "purging_flag"):
            # 폭식 CBT-E 렌즈: 목표는 체중이 아니라 폭식 줄이기
            p.add_lens(
                1,
                "폭식·섭식 조절 렌즈(M-RegulateEating): 폭식은 의지 문제가 아니라 "
                "굶거나 스트레스 받은 몸의 자연스러운 반응임을 전제하라. 식단 이야기를 "
                "할 때 목표는 '체중'이 아니라 '규칙적으로 먹어 폭식을 줄이는 것'이다. "
                "굶기를 권하지 말고, 한 번 많이 먹었어도 다음 끼니만 평소대로 가면 된다고 안내하라.",
            )
        else:
            p.add_lens(
                1,
                "비판단 식사 렌즈(M-Nourish): 식단 사진/기록에 칼로리·체중을 빼고 "
                "비판단적으로 반응하라. 몸이 보내는 배고픔 신호는 믿어도 된다는 태도를 유지하라.",
            )
        # 섭식군 공통 금기
        p.forbid(
            "칼로리·체중 목표 제시나 수치 언급",
            "체중이 줄었거나 적게 먹은 것을 칭찬하기",
            "체형·외모·식습관에 대한 평가나 전후 비교",
            "'좋은 음식/나쁜 음식' 이분법",
        )
        if eating_high:
            # purging/anorexia → 체중 언급 자체 차단 (악화 위험)
            p.forbid("체중 주제는 아예 꺼내지 말 것(환자가 먼저 물어도 비판단으로 돌리고 관리자 상담 권유)")

    # ===== M-Move (보상운동 안전) ==================================
    # Phase 1(설문 전용)에서는 '운동 주 0~1회' 같은 활성 신호가 없어 긍정 의미부여
    # 스레드는 켜지 않는다(그건 운동 로그 기반 L3 영역). 여기선 위험군 금기만 담당.
    if _flag(flags, "compensatory_exercise_flag") or _flag(flags, "anorexia_candidate"):
        p.forbid("운동량을 늘리도록 독려하기(보상운동 위험군)")

    # ===== M-Activate (우울 → 행동활성화 BA) =======================
    if _flag(flags, "depression_positive"):
        p.add_lens(
            2,
            "행동활성화 렌즈(M-Activate): 무기력은 게으름이 아니라 우울의 '증상'임을 "
            "전제하라(다그치지 말 것). 운동·활동 기록을 기분과 연결해 '활동하면 기분이 "
            "따라온다'는 순서로 아주 작은 활동부터 제안하라.",
        )
        p.add_thread(
            3,
            "활동-기분 스레드: 최근 한 일과 그때 기분을 같이 돌아보게 하고, 즐거움·뿌듯함 "
            "있는 작은 활동 1개를 '언제까지' 정도로 구체적으로 제안하라(크게 잡아 실패시키지 않기).",
        )

    # ===== M-Anxiety ===============================================
    if _flag(flags, "anxiety_positive") or _flag(flags, "panic_positive"):
        p.add_thread(
            4,
            "불안 스레드(M-Anxiety, 가볍게만): 불안이 식이·수면·활동을 흔드는 지점만 "
            "가볍게 다뤄라. '불안할 때 먹는 걸로 푸는 느낌이 있는지' 정서적 섭식을 부드럽게 "
            "연결하고, 필요하면 1분 호흡을 권하라. 본격 노출치료는 하지 마라(전문의 영역).",
        )
        p.overlay(
            "식사·생활 규칙은 '반드시'가 아니라 '~해볼래?' 같은 유연한 언어로 제안하라"
            "(경직된 규칙은 불안을 악화시킨다)."
        )
        p.forbid("사회적 노출 강권, 부정확한 호흡 지시")

    # ===== M-Structure (ADHD) ======================================
    if _flag(flags, "adhd_positive"):
        p.add_thread(
            5,
            "구조화 스레드(M-Structure): 의지보다 구조다. 시간 고정 알림('12시, 점심!'), "
            "'미리 정하기'(편의점 가기 전 살 것 정하기), 한 직후 즉각 인정을 활용하라. "
            "먼 보상('장기적으로 건강해지자')은 통하지 않으니 지금 한 일을 바로 칭찬하라.",
        )
        p.forbid("먼 보상으로 동기부여하기, 앱이 약물 효과를 평가/조정하기")

    # ===== TIC (트라우마 정보기반 오버레이 — 전 모듈 공통) ==========
    if _flag(flags, "ptsd_positive"):
        p.overlay(
            "트라우마 정보기반(TIC): 통제적·처벌적 언어를 쓰지 말고 항상 선택권·자율성을 "
            "보장하라('정하는 건 너야'). 과식·폭식은 의지 실패가 아니라 정서적 고통의 자가 "
            "대처일 수 있으니, 행동 제한보다 감정 트리거에 초점을 두고 급격한 제한·실패 강조를 "
            "피하라(재외상화 위험)."
        )
        p.forbid("급격한 칼로리 제한, 처벌적 framing, 통제적 언어")

    # ===== M-Engage (동기강화면담) =================================
    # MI의 기본 철학(끌어내기·비판단)은 메인 시스템 프롬프트가 이미 깔고 있으므로,
    # 여기서는 기본 동작이 '틀리는' 단계 — 관심 전(precontemplation) — 의 가드레일만
    # 추가한다. contemplation/action_ready 는 별도 블록 없이 기본 톤으로 둔다.
    if flags.get("readiness_stage") == "precontemplation":
        p.engage_line = (
            "동기강화면담(M-Engage): 아직 변화에 관심 전 단계다. 목표·식단표·지시·겁주기를 "
            "하지 말고, 가치·관심사만 가볍게 물어라('요즘 제일 신경 쓰이는 거 하나만 말해줄래?'). "
            "설득이 아니라 끌어내기다 — 조언 충동을 누르고, '귀찮아'엔 맞서지 말고 흘려보내라."
        )
        p.forbid("관심 전 환자에게 목표·식단표·지시·겁주기")

    return p


def _render(p: _Profile) -> str:
    """프로파일을 채팅 system 지시 한 덩어리로 렌더링한다."""
    lines: list[str] = [
        "[오늘의 개인화 지시 — 사용자에게 보여주는 정보가 아니라 너(체다)의 응답 방식 지침이다]",
        "채팅의 본업은 여전히 식단·운동 대화다. 아래는 그 위에 얹을 개인화 지시이며, "
        "한 번에 렌즈 1개 + 스레드 0~2개만 적용하고 임상 상담봇처럼 굴지 마라.",
    ]

    if p.engage_line:
        lines.append(f"· 기본 태도: {p.engage_line}")

    # 렌즈: 우선순위 최상위 1개만
    if p.lens_candidates:
        _, lens = sorted(p.lens_candidates, key=lambda x: x[0])[0]
        lines.append(f"· 적용 렌즈(1개): {lens}")

    # 스레드: 우선순위로 최대 2개
    if p.thread_candidates:
        threads = [t for _, t in sorted(p.thread_candidates, key=lambda x: x[0])[:2]]
        for t in threads:
            lines.append(f"· 추가 스레드: {t}")

    if p.tone_overlays:
        for o in p.tone_overlays:
            lines.append(f"· 말투 오버레이: {o}")

    if p.forbidden:
        joined = "; ".join(p.forbidden)
        lines.append(f"· 🚫 금기(반드시 지킬 것): {joined}")

    lines.append(
        "위 신호나 설문 결과 자체를 사용자에게 먼저 언급하지 마라. 진단명으로 낙인찍지 말고"
        "('너는 우울증/섭식장애야' 식 단정 금지), 오직 너의 말투·해석·안내 방향에만 반영하라. "
        "심각한 위기(자살 등)는 네가 직접 상담하지 말고 비판단·따뜻한 태도를 유지하라(전문 개입은 관리자 영역)."
    )
    return "\n".join(lines)


def build_survey_context(db: Session, user_id: int) -> str:
    """환자의 최근 설문 프로파일을 AI 행동 지침(한국어 텍스트)으로 변환한다.

    반환값은 사용자에게 보여줄 데이터가 아니라 AI 의 응답 태도를 조정하기 위한
    system 지침이다. 활성화할 모듈이 하나도 없으면(무난한 날) 빈 문자열을 반환해
    순수 식단·운동 대화가 되게 한다.
    """
    flags = _latest_completed_flags(db, user_id)
    if not flags:
        return ""

    profile = _build_profile(flags)
    if not profile.has_signal:
        return ""

    return _render(profile)

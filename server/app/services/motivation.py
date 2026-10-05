"""주 1회 동기 점검 — 설문 B-2(readiness ruler)의 중요도·자신감을 다시 묻는다.

옛 웹(Cheddar_Team_26)의 동기 체크인(채팅 팝업, 1~9, 3일 주기)을 바꿔 이식:
- 0~10점(설문 B-2 와 같은 척도) 두 축: 중요도(B-2-1), 자신감(B-2-2)
- 홈 진입 시 주 1회. 마지막 점검(없으면 설문 완료) 후 7일이 지나면 띄운다.
- 비교 기준: 직전 점검. 첫 점검이면 설문 때 답한 점수.
- 몸무게는 같은 창에서 선택 입력 — 섭식 고위험군(거식·구토 신호)에게는 묻지 않는다.
- 최근 점검 결과를 채팅 지침으로 넘긴다(점수 낭독 X, 대하는 방식에만 반영).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.motivation import MotivationCheck
from app.models.survey import SurveyResponse, SurveyResponseStatus
from app.models.user import User

CHECK_INTERVAL_DAYS = 7
# 채팅에 반영하는 점검 결과의 유효 기간 — 너무 오래된 점수로 대하지 않기.
CONTEXT_MAX_AGE_DAYS = 30


def _latest_survey(db: Session, user_id: int) -> SurveyResponse | None:
    return db.execute(
        select(SurveyResponse)
        .where(
            SurveyResponse.user_id == user_id,
            SurveyResponse.status == SurveyResponseStatus.COMPLETED,
        )
        .order_by(SurveyResponse.completed_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _last_checks(db: Session, user_id: int, n: int) -> list[MotivationCheck]:
    return list(
        db.execute(
            select(MotivationCheck)
            .where(MotivationCheck.user_id == user_id)
            .order_by(MotivationCheck.created_at.desc())
            .limit(n)
        ).scalars()
    )


def _to_score(v: object) -> int | None:
    try:
        n = int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return n if 0 <= n <= 10 else None


def _survey_baseline(survey: SurveyResponse | None) -> dict | None:
    """설문 때 답한 중요도·자신감. 둘 다 없으면 None."""
    if survey is None:
        return None
    answers = survey.answers or {}
    importance = _to_score(answers.get("B-2-1"))
    confidence = _to_score(answers.get("B-2-2"))
    if importance is None and confidence is None:
        return None
    return {"importance": importance, "confidence": confidence, "source": "survey"}


def eating_high_risk(survey: SurveyResponse | None) -> bool:
    """거식·구토 신호 — 채팅이 체중 주제 자체를 막는 군과 같은 기준(survey_context)."""
    flags = (survey.derived_flags or {}) if survey else {}
    return bool(flags.get("purging_flag") or flags.get("anorexia_candidate"))


def _previous(last: MotivationCheck | None, survey: SurveyResponse | None) -> dict | None:
    if last is not None:
        return {
            "importance": last.importance,
            "confidence": last.confidence,
            "source": "check",
        }
    return _survey_baseline(survey)


def checkin_status(db: Session, user: User) -> dict:
    survey = _latest_survey(db, user.id)
    last = next(iter(_last_checks(db, user.id, 1)), None)
    show_weight = not eating_high_risk(survey)

    due = False
    if survey is not None and survey.completed_at is not None:
        ref = last.created_at if last else survey.completed_at
        due = datetime.now(timezone.utc) - ref >= timedelta(days=CHECK_INTERVAL_DAYS)

    last_weight = None
    if show_weight:
        last_weight = (last.weight_kg if last and last.weight_kg else None) or user.weight_kg
    return {
        "due": due,
        "show_weight": show_weight,
        "previous": _previous(last, survey),
        "last_weight_kg": last_weight,
    }


def record_check(
    db: Session,
    user: User,
    importance: int,
    confidence: int,
    weight_kg: float | None,
) -> dict:
    survey = _latest_survey(db, user.id)
    last = next(iter(_last_checks(db, user.id, 1)), None)
    previous = _previous(last, survey)

    # 고위험군은 화면에서 칸을 숨기지만, 서버에서도 저장하지 않는다.
    if eating_high_risk(survey):
        weight_kg = None

    check = MotivationCheck(
        user_id=user.id,
        importance=importance,
        confidence=confidence,
        weight_kg=weight_kg,
    )
    db.add(check)
    if weight_kg is not None:
        # 운동 칼로리 계산 등에 쓰는 현재 몸무게도 갱신한다.
        user.weight_kg = weight_kg
    db.commit()
    return {
        "importance": importance,
        "confidence": confidence,
        "previous": previous,
    }


def build_motivation_context(db: Session, user_id: int) -> str:
    """최근 동기 점검 → 채팅 응답 방식 지침. 최근 점검이 없으면 빈 문자열.

    (설문만 있고 점검 전이면 설문 준비도는 이미 survey_context 가 다룬다.)
    몸무게는 넘기지 않는다.
    """
    checks = _last_checks(db, user_id, 2)
    if not checks:
        return ""
    latest = checks[0]
    age = datetime.now(timezone.utc) - latest.created_at
    if age > timedelta(days=CONTEXT_MAX_AGE_DAYS):
        return ""
    prev = (
        {"importance": checks[1].importance, "confidence": checks[1].confidence}
        if len(checks) > 1
        else _survey_baseline(_latest_survey(db, user_id))
    )

    imp, conf = latest.importance, latest.confidence

    def _with_prev(key: str, now: int) -> str:
        before = prev.get(key) if prev else None
        return f"{now}/10 (이전 {before})" if before is not None else f"{now}/10"

    lines = [
        f"[동기 점검] 사용자가 {age.days}일 전 스스로 매긴 변화 동기 — "
        f"바꾸는 게 중요한 정도 {_with_prev('importance', imp)}, "
        f"할 수 있다는 자신감 {_with_prev('confidence', conf)}.",
    ]
    if imp <= 3:
        lines.append(
            "아직 변화가 크게 중요하지 않은 상태입니다. 설득하거나 목표를 제시하지 말고, "
            "관심사를 가볍게 물어보세요."
        )
    elif imp >= 7 and conf <= 4:
        lines.append(
            "바꾸고 싶은 마음은 큰데 자신감이 낮습니다. 큰 목표 대신 꼭 해낼 수 있는 아주 작은 "
            "행동을 정보로 알려 주고, 이미 해낸 일을 짚어 자신감을 북돋워 주세요."
        )
    if prev:
        drops = [
            k for k, now in (("importance", imp), ("confidence", conf))
            if prev.get(k) is not None and now <= prev[k] - 2
        ]
        rises = [
            k for k, now in (("importance", imp), ("confidence", conf))
            if prev.get(k) is not None and now >= prev[k] + 2
        ]
        if drops:
            lines.append(
                "지난번보다 낮아졌습니다. 탓하지 말고, 요즘 힘든 점이 있는지 부드럽게 살펴 주세요."
            )
        elif rises:
            lines.append("지난번보다 올라왔습니다. 그 변화를 자연스럽게 인정해 주세요.")
    lines.append(
        "점수를 먼저 말하지 말고 대하는 방식에만 반영하세요. 사용자가 동기 점검 이야기를 "
        "먼저 꺼내면 그때는 함께 이야기해도 됩니다."
    )
    return "\n".join(lines)

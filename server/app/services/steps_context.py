"""스마트폰 걸음수(DailySteps)를 맥락으로 바꾸는 헬퍼.

2026-10-12 결정에 따라 걸음수는 **포인트 적립에 쓰지 않고** 아래 3곳에만 반영한다.
  1. 채팅·AI 선인사(opener)  → `build_steps_context()` (system 지시 한 덩어리)
  2. 주간 리포트 AI 한마디     → `weekly_avg_steps()`
  3. 주 1회 동기 점검 창       → `recent_avg_steps()`

공통 원칙
- 섭식 고위험군(`eating_high_risk`: 거식·구토 신호)에게는 걸음 숫자를 강조하지
  않는다 → 채팅 맥락은 빈 문자열, 동기 점검 창에도 숫자를 내려주지 않는다.
- 걸음수를 운동 칼로리·음식과 절대 연결하지 않는다(보상행동 유발). AI 지시문에
  이 금기를 명시한다.
- 데이터가 없으면 빈 문자열/None — 웹·권한 거절 사용자도 기능이 그대로 돈다.
"""
from __future__ import annotations

from datetime import date as DateType
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.daily_steps import DailySteps
from app.services.record_dates import kst_today

# 채팅 맥락에서 보는 범위(오늘 제외 7일 평균) / 너무 오래된 동기화는 무시
_BASELINE_DAYS = 7
_STALE_DAYS = 3


def _rows(db: Session, user_id: int, start: DateType, end: DateType) -> dict[DateType, int]:
    """[start, end] 구간의 {day: steps}. 0걸음 행은 '안 걸은 날'이 아니라
    '폰이 아직 못 센 날'일 수 있어 평균에서 뺀다(호출처에서 처리)."""
    rows = db.execute(
        select(DailySteps.day, DailySteps.steps).where(
            DailySteps.user_id == user_id,
            DailySteps.day >= start,
            DailySteps.day <= end,
        )
    ).all()
    return {d: int(s) for d, s in rows}


def _avg(values: list[int]) -> int | None:
    walked = [v for v in values if v > 0]
    return round(sum(walked) / len(walked)) if walked else None


def weekly_avg_steps(db: Session, user_id: int, monday: DateType) -> int | None:
    """그 주(월~일) 걸음이 기록된 날의 일평균. 기록 없으면 None."""
    by_day = _rows(db, user_id, monday, monday + timedelta(days=6))
    return _avg(list(by_day.values()))


def recent_avg_steps(db: Session, user_id: int, days: int = _BASELINE_DAYS) -> int | None:
    """오늘 제외 최근 N일 일평균. 동기 점검 창의 참고 문구용."""
    today = kst_today()
    by_day = _rows(db, user_id, today - timedelta(days=days), today - timedelta(days=1))
    return _avg(list(by_day.values()))


def build_steps_context(db: Session, user_id: int, *, high_risk: bool = False) -> str:
    """오늘·최근 7일 걸음수를 채팅 system 지시로 만든다.

    고위험군이거나 최근 기록이 없으면 빈 문자열. 숫자는 AI 가 참고만 하고
    목표·평가·칼로리 환산을 하지 않도록 금기를 함께 넣는다.
    """
    if high_risk:
        return ""
    today = kst_today()
    by_day = _rows(db, user_id, today - timedelta(days=_BASELINE_DAYS), today)
    if not by_day:
        return ""
    latest_day = max(by_day)
    if (today - latest_day).days > _STALE_DAYS:
        return ""  # 동기화가 끊긴 지 오래면 옛 숫자로 말하지 않는다

    today_steps = by_day.get(today)
    baseline = _avg([v for d, v in by_day.items() if d < today])

    lines = ["[걸음수 — 스마트폰 건강 데이터]"]
    if today_steps is not None:
        lines.append(f"- 오늘({today.isoformat()}) 지금까지 약 {today_steps:,}걸음")
    if baseline is not None:
        lines.append(f"- 최근 {_BASELINE_DAYS}일(오늘 제외) 일평균 약 {baseline:,}걸음")
    lines.append(
        "이 숫자는 건강 앱에서 자동으로 가져온 것이라 사용자가 '기록'한 게 아닙니다. "
        "'폰이 센' 같은 기기 언급은 하지 마세요. 걸음 목표를 제시하거나 "
        "숫자를 평가(많다/적다)하지 말고, 걸음을 칼로리·먹은 음식과 절대 연결하지 "
        "마세요. 사용자가 묻지 않아도 대화 흐름에 맞춰 먼저 걸음수를 가볍게 꺼내 "
        "안부를 건네세요(예: '오늘 지금까지 약 N걸음 움직이셨네요, 하루 어떠세요?'처럼 "
        "사실만). 같은 대화에서 이미 말했다면 반복하지 마세요."
    )
    return "\n".join(lines)

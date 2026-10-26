"""스마트폰 수면 데이터(DailySleep)를 맥락으로 바꾸는 헬퍼. steps_context 의 수면판.

반영처는 걸음수와 같은 3곳(채팅·선인사 / 주간 리포트 / 동기 점검).
수면은 섭식 위험과 직접 엮이지 않아 고위험군 게이트는 두지 않지만, 아래 원칙은 같다.
- 숫자를 평가(부족하다/충분하다)하거나 수면 목표를 제시하지 않는다. 진단도 하지 않는다.
- 수면을 음식·칼로리와 연결하지 않는다.
- 데이터가 없거나 동기화가 끊긴 지 오래면 빈 값 — 웹·권한 거절 사용자도 그대로 동작.
"""
from __future__ import annotations

from datetime import date as DateType
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.daily_sleep import DailySleep
from app.services.record_dates import kst_today

_BASELINE_DAYS = 7
_STALE_DAYS = 3
# 이보다 짧으면 '밤잠'이 아니라 조각/낮잠으로 보고 평균에서 뺀다.
_MIN_NIGHT_MINUTES = 60


def fmt_minutes(minutes: int) -> str:
    """390 → '6시간 30분', 420 → '7시간', 45 → '45분'."""
    h, m = divmod(int(minutes), 60)
    if h and m:
        return f"{h}시간 {m}분"
    if h:
        return f"{h}시간"
    return f"{m}분"


def _rows(db: Session, user_id: int, start: DateType, end: DateType) -> dict[DateType, int]:
    rows = db.execute(
        select(DailySleep.day, DailySleep.asleep_minutes).where(
            DailySleep.user_id == user_id,
            DailySleep.day >= start,
            DailySleep.day <= end,
        )
    ).all()
    return {d: int(m) for d, m in rows}


def _avg(values: list[int]) -> int | None:
    nights = [v for v in values if v >= _MIN_NIGHT_MINUTES]
    return round(sum(nights) / len(nights)) if nights else None


def weekly_avg_sleep_minutes(db: Session, user_id: int, monday: DateType) -> int | None:
    """그 주(월~일, 일어난 날 기준) 밤 평균 수면 분. 기록 없으면 None."""
    return _avg(list(_rows(db, user_id, monday, monday + timedelta(days=6)).values()))


def recent_avg_sleep_minutes(db: Session, user_id: int, days: int = _BASELINE_DAYS) -> int | None:
    """오늘 아침까지 포함 최근 N일 밤 평균. 동기 점검 창의 참고 문구용."""
    today = kst_today()
    return _avg(list(_rows(db, user_id, today - timedelta(days=days - 1), today).values()))


def build_sleep_context(db: Session, user_id: int) -> str:
    """어젯밤·최근 7일 수면을 채팅 system 지시로 만든다. 기록 없으면 빈 문자열."""
    today = kst_today()
    by_day = _rows(db, user_id, today - timedelta(days=_BASELINE_DAYS), today)
    if not by_day:
        return ""
    if (today - max(by_day)).days > _STALE_DAYS:
        return ""

    last_night = by_day.get(today)  # 오늘 아침에 일어난 밤
    baseline = _avg([m for d, m in by_day.items() if d < today])

    lines = ["[수면 — 스마트폰 건강 데이터]"]
    if last_night is not None:
        if last_night >= _MIN_NIGHT_MINUTES:
            lines.append(f"- 어젯밤(오늘 {today.isoformat()} 기상) 약 {fmt_minutes(last_night)} 잠")
        else:
            lines.append("- 어젯밤 수면 기록이 매우 짧게 잡혔음(기기 미착용 등으로 부정확할 수 있음)")
    if baseline is not None:
        lines.append(f"- 최근 {_BASELINE_DAYS}일 밤 평균 약 {fmt_minutes(baseline)}")
    lines.append(
        "이 수면 시간은 건강 앱에서 자동으로 가져온 참고 수치라 실제와 다를 수 있습니다. "
        "'폰이 잰', '워치가 잰' 같은 기기 언급은 하지 마세요. "
        "수면이 부족하다/충분하다고 평가하거나 수면 목표·수면 위생 교육을 먼저 꺼내지 "
        "말고, 수면을 식사·칼로리와 연결하지 마세요. 사용자가 묻지 않아도 대화 흐름에 "
        "맞춰 먼저 어젯밤 잠을 가볍게 꺼내 안부를 건네세요(예: '어젯밤 약 N시간 주무셨네요, "
        "오늘 컨디션은 어떠세요?'). 같은 대화에서 이미 말했다면 반복하지 마세요."
    )
    return "\n".join(lines)

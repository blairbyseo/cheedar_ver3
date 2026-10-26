"""홈 화면 인삿말 한 줄 — 스마트폰 건강 데이터(수면·걸음수)를 먼저 건네는 안부.

2026-10-26 결정: 사용자가 묻지 않아도 건강 데이터를 적극적으로 이야기한다(채팅과 같은 방향).
홈 문구는 AI 를 거치지 않는 고정 문장이라, 금기는 문장 자체로 지킨다.
- 숫자는 그대로 말하되 평가(많다/적다·부족/충분)·목표·칼로리 연결 표현은 쓰지 않는다.
- 섭식 고위험군에게는 걸음 숫자를 주지 않는다(steps_context 와 같은 게이트). 수면은 모두에게.
- 어젯밤/오늘·어제 데이터만 쓴다. 그보다 오래된 숫자로 인사하지 않는다.
- 쓸 데이터가 없으면 None → 홈은 기존 시간대 인사말을 그대로 쓴다.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.services.record_dates import kst_today
from app.services.sleep_context import _MIN_NIGHT_MINUTES, fmt_minutes

# 홈 인삿말의 시간대 경계와 같다(Home.jsx: ~11시 아침).
_MORNING_END_HOUR = 11


def _steps_on(db: Session, user_id: int, day) -> int | None:
    row = db.execute(
        select(DailySteps).where(DailySteps.user_id == user_id, DailySteps.day == day)
    ).scalar_one_or_none()
    return row.steps if row is not None and row.steps > 0 else None


def _last_night_minutes(db: Session, user_id: int) -> int | None:
    row = db.execute(
        select(DailySleep).where(
            DailySleep.user_id == user_id, DailySleep.day == kst_today()
        )
    ).scalar_one_or_none()
    if row is None or row.asleep_minutes < _MIN_NIGHT_MINUTES:
        return None  # 너무 짧게 잡힌 밤은 기기 미착용 등으로 부정확할 수 있어 말하지 않는다
    return row.asleep_minutes


def build_home_greeting(
    db: Session, user_id: int, *, hour: int, high_risk: bool = False
) -> str | None:
    """아침엔 어젯밤 잠을 먼저, 낮·저녁엔 오늘 움직임을 먼저 건넨다. 없으면 다른 쪽으로."""
    today = kst_today()
    sleep = _last_night_minutes(db, user_id)

    def sleep_line() -> str | None:
        if sleep is None:
            return None
        return f"어젯밤 {fmt_minutes(sleep)}쯤 주무셨네요.\n오늘 컨디션은 어떠세요?"

    def steps_line() -> str | None:
        if high_risk:
            return None
        if hour < _MORNING_END_HOUR:
            steps = _steps_on(db, user_id, today - timedelta(days=1))
            return f"어제 {steps:,}걸음 움직이셨어요.\n오늘도 편하게 시작해요" if steps else None
        steps = _steps_on(db, user_id, today)
        return f"오늘 지금까지 {steps:,}걸음 움직이셨어요.\n오늘 하루는 어떠세요?" if steps else None

    order = (sleep_line, steps_line) if hour < _MORNING_END_HOUR else (steps_line, sleep_line)
    for make in order:
        line = make()
        if line:
            return line
    return None

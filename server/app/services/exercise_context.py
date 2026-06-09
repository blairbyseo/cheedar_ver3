"""채팅 호출 시 AI 에게 함께 보여줄 '환자 운동 스냅샷' 빌더.

식단 스냅샷(diet_context.py)과 똑같은 역할의 운동 버전. 매 채팅 턴마다 환자
본인이 오늘 한 운동 + 최근 7일 소모 칼로리 평균을 짧은 한국어 스냅샷으로
만들어 OpenAI 시스템 메시지에 끼워 보낸다. AI 가 "나 요즘 운동 잘 하고
있어?" 같은 질문에 임의로 답하지 않고 실제 DB 기록을 보고 답하도록 한다.

설계 원칙(diet_context 와 동일)
- LLM 호출 없이 단순 SQL 집계만으로 결정적으로 만든다.
- 호출하는 쪽이 그대로 system content 에 박을 수 있도록 string 반환.
- 기록이 하나도 없으면 빈 문자열 반환 — 프롬프트가 부풀지 않게.
"""
from __future__ import annotations

import json
from datetime import date as DateType
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.exercise import ExerciseLog

# 평균 계산 시 오늘 제외하고 며칠을 볼지 (식단과 동일).
_BASELINE_DAYS = 7

# 주관적 강도(1-5) → 한국어 라벨. exercise.py 의 intensity_multiplier 와 동기화.
_INTENSITY_KO = {
    1: "아주 편함",
    2: "편함",
    3: "보통",
    4: "힘듦",
    5: "최대",
}


def _fmt_duration(hours: int, minutes: int) -> str:
    """(시, 분) → '1시간 30분' / '45분' / '2시간'. 둘 다 0이면 빈 문자열."""
    h = int(hours or 0)
    m = int(minutes or 0)
    parts: list[str] = []
    if h:
        parts.append(f"{h}시간")
    if m:
        parts.append(f"{m}분")
    return " ".join(parts)


def _parse_items(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    return [it for it in parsed if isinstance(it, dict)]


def _fmt_item(item: dict) -> str:
    """운동 항목 한 줄: '달리기 30분, 강도 보통 — 약 250 kcal 소모'."""
    name = item.get("exercise_name") or "(운동명 미기록)"
    duration = _fmt_duration(item.get("duration_hours", 0), item.get("duration_minutes", 0))
    pieces: list[str] = [name]
    if duration:
        pieces[0] = f"{name} {duration}"

    intensity = item.get("intensity")
    if isinstance(intensity, int) and intensity in _INTENSITY_KO:
        pieces.append(f"강도 {_INTENSITY_KO[intensity]}")

    head = ", ".join(pieces)
    kcal = item.get("calories_burned")
    if kcal is not None:
        return f"{head} — 약 {int(round(float(kcal)))} kcal 소모"
    return head


def build_exercise_context(
    db: Session,
    user_id: int,
    today: DateType | None = None,
) -> str:
    """환자의 최근 운동을 한국어 텍스트 스냅샷으로 만든다.

    반환 예시:
      [환자의 운동 기록]
      - 오늘(2026-06-09)
        · 달리기 30분, 강도 보통 — 약 250 kcal 소모
        · 웨이트 트레이닝 1시간, 강도 힘듦 — 약 360 kcal 소모
        · 오늘 합계: 약 610 kcal 소모
      - 최근 7일(오늘 제외) 운동한 날 일평균: 약 320 kcal 소모, 운동한 날 4/7일
      위 정보는 환자가 직접 기록한 데이터입니다 ...

    오늘·최근 7일 모두 기록이 없으면 빈 문자열을 반환한다.
    """
    today = today or DateType.today()

    # --- 오늘 운동 (user+date 당 한 행) --------------------------------
    today_row = db.execute(
        select(ExerciseLog).where(
            ExerciseLog.user_id == user_id,
            ExerciseLog.done_on == today,
        )
    ).scalar_one_or_none()

    # --- 최근 7일(오늘 제외) ------------------------------------------
    baseline_start = today - timedelta(days=_BASELINE_DAYS)
    baseline_rows = list(
        db.execute(
            select(ExerciseLog).where(
                ExerciseLog.user_id == user_id,
                ExerciseLog.done_on >= baseline_start,
                ExerciseLog.done_on < today,
            )
        ).scalars()
    )
    # 실제로 운동한 날(쉬는 날/0kcal 제외)만 평균에 넣는다.
    workout_kcals = [
        float(r.calories_burned)
        for r in baseline_rows
        if not r.is_skipped and (r.calories_burned or 0) > 0
    ]
    workout_days = len(workout_kcals)
    baseline_avg = sum(workout_kcals) / workout_days if workout_days else None

    if today_row is None and not baseline_rows:
        return ""

    # --- 텍스트 조립 --------------------------------------------------
    lines: list[str] = ["[환자의 운동 기록]"]

    lines.append(f"- 오늘({today.isoformat()})")
    if today_row is None:
        lines.append("  · 오늘은 아직 기록된 운동이 없습니다.")
    elif today_row.is_skipped:
        lines.append("  · 오늘은 '운동 안 함'으로 기록했습니다.")
    else:
        items = _parse_items(today_row.items)
        if items:
            for it in items:
                lines.append(f"  · {_fmt_item(it)}")
        total = today_row.calories_burned
        if total is not None:
            lines.append(f"  · 오늘 합계: 약 {int(round(float(total)))} kcal 소모")

    if baseline_avg is not None:
        lines.append(
            f"- 최근 {_BASELINE_DAYS}일(오늘 제외) 운동한 날 일평균: "
            f"약 {int(round(baseline_avg))} kcal 소모, "
            f"운동한 날 {workout_days}/{_BASELINE_DAYS}일"
        )
    else:
        lines.append(f"- 최근 {_BASELINE_DAYS}일(오늘 제외) 운동 기록 없음")

    lines.append(
        "위 정보는 환자가 직접 기록한 데이터입니다. 환자가 운동·활동량에 대해 "
        "물으면 이 데이터를 자연스럽게 참고해 답하세요. 데이터에 없는 운동이나 "
        "소모 칼로리는 추측하지 말고 '아직 기록되지 않았어요'라고 안내하세요."
    )
    return "\n".join(lines)

"""채팅 호출 시 AI 에게 함께 보여줄 '환자 식단 스냅샷' 빌더.

매 채팅 턴마다 환자 본인이 오늘 먹은 것 + 최근 7일 평균을 짧은 한국어
스냅샷으로 만들어 OpenAI 시스템 메시지에 끼워 보낸다. AI 가 "어제 뭐
먹었어요?" 같은 질문에 임의로 답하지 않고 실제 DB 의 기록을 보고
답하도록 하는 용도.

설계 원칙
- LLM 호출 없이 단순 SQL 집계만으로 결정적으로 만든다.
- 호출하는 쪽이 그대로 system content 에 박을 수 있도록 string 반환.
- 기록이 하나도 없으면 빈 문자열 반환 — 프롬프트가 부풀지 않게.
"""
from __future__ import annotations

from datetime import date as DateType
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.meal import Meal, MealType

# 평균 계산 시 오늘 제외하고 며칠을 볼지.
_BASELINE_DAYS = 7

# 오늘 총 kcal 이 최근 7일 평균에서 얼마나 벗어났는지 라벨링하는 임계값.
# (레퍼런스 Cheddar_Team_26/user_context.py 의 kcal_vs_7day_avg 와 동일 기준.)
_KCAL_DEV_MUCH = 0.25    # ±25% 이상 → 평소보다 '많이' 많/적
_KCAL_DEV_SOME = 0.10    # ±10% 이상 → 평소보다 '다소' 많/적
_KCAL_DEV_LABEL = {
    "much_higher": "평소보다 많이 많음",
    "higher":      "평소보다 다소 많음",
    "normal":      "평소와 비슷함",
    "lower":       "평소보다 다소 적음",
    "much_lower":  "평소보다 많이 적음",
}

_MEAL_KO = {
    MealType.breakfast: "아침",
    MealType.lunch: "점심",
    MealType.dinner: "저녁",
    MealType.snack: "간식",
}


def _compute_macro_ratio(today_rows: list[Meal]) -> dict | None:
    """오늘 합계 기준 탄/단/지 비율(%) — 매크로 데이터가 하나도 없으면 None.

    레퍼런스의 macro_ratio 와 동일한 계산식: 세 매크로 합을 분모로 한
    상대 비율. 칼로리 환산(탄4·단4·지9)이 아니라 '그램 단위 비율'이라는
    점만 기억하면 됨 — 레퍼런스도 같음.
    """
    total_c = 0.0
    total_p = 0.0
    total_f = 0.0
    have_any = False
    for m in today_rows:
        if m.carbs_g is not None:
            total_c += float(m.carbs_g)
            have_any = True
        if m.protein_g is not None:
            total_p += float(m.protein_g)
            have_any = True
        if m.fat_g is not None:
            total_f += float(m.fat_g)
            have_any = True
    if not have_any:
        return None
    macro_sum = total_c + total_p + total_f
    if macro_sum <= 0:
        return None
    return {
        "carbs_pct":   round(100 * total_c / macro_sum, 1),
        "protein_pct": round(100 * total_p / macro_sum, 1),
        "fat_pct":     round(100 * total_f / macro_sum, 1),
    }


def _kcal_deviation_label(
    today_total: int, baseline_avg: float | None
) -> tuple[float, str] | None:
    """오늘 kcal 이 baseline 평균에서 얼마나 떨어졌는지 (%, 라벨키) 반환.

    baseline 이 없거나 0 이하면 None.
    """
    if baseline_avg is None or baseline_avg <= 0 or today_total <= 0:
        return None
    deviation = (today_total - baseline_avg) / baseline_avg
    if deviation >= _KCAL_DEV_MUCH:
        key = "much_higher"
    elif deviation <= -_KCAL_DEV_MUCH:
        key = "much_lower"
    elif deviation >= _KCAL_DEV_SOME:
        key = "higher"
    elif deviation <= -_KCAL_DEV_SOME:
        key = "lower"
    else:
        key = "normal"
    return deviation * 100, key


def _fmt_kcal(v: int | None) -> str:
    return f"{int(v)} kcal" if v is not None else "kcal 미기록"


def _fmt_macros(meal: Meal) -> str:
    parts: list[str] = []
    if meal.protein_g is not None:
        parts.append(f"단백질 {float(meal.protein_g):.0f}g")
    if meal.carbs_g is not None:
        parts.append(f"탄수화물 {float(meal.carbs_g):.0f}g")
    if meal.fat_g is not None:
        parts.append(f"지방 {float(meal.fat_g):.0f}g")
    return ", ".join(parts)


def build_diet_context(
    db: Session,
    user_id: int,
    today: DateType | None = None,
) -> str:
    """환자의 최근 식단을 한국어 텍스트 스냅샷으로 만든다.

    반환 예시:
      [환자의 식단 기록]
      - 오늘(2026-06-02)
        · 아침: 토스트와 계란후라이 — 320 kcal, 단백질 18g, ...
        · 점심: 비빔밥 — 600 kcal
        · 미기록: 저녁
        · 오늘 합계: 약 920 kcal
      - 최근 7일(오늘 제외) 일평균: 약 1480 kcal, 기록일수 5/7일
      위 정보는 환자가 직접 기록한 데이터입니다 ...

    오늘·최근 7일 모두 비어 있으면 빈 문자열을 반환한다.
    """
    today = today or DateType.today()

    # --- 오늘 식단 ----------------------------------------------------
    today_rows = list(
        db.execute(
            select(Meal)
            .where(Meal.user_id == user_id, Meal.eaten_on == today)
            .order_by(Meal.meal_type)
        ).scalars()
    )
    today_by_type: dict[MealType, Meal] = {m.meal_type: m for m in today_rows}
    today_total_kcal = sum((m.calories or 0) for m in today_rows)

    # --- 최근 7일(오늘 제외) ------------------------------------------
    baseline_start = today - timedelta(days=_BASELINE_DAYS)
    baseline_rows = list(
        db.execute(
            select(Meal).where(
                Meal.user_id == user_id,
                Meal.eaten_on >= baseline_start,
                Meal.eaten_on < today,
            )
        ).scalars()
    )
    kcal_by_date: dict[DateType, int] = {}
    for m in baseline_rows:
        if m.calories is None:
            continue
        kcal_by_date[m.eaten_on] = kcal_by_date.get(m.eaten_on, 0) + int(m.calories)
    baseline_days_logged = len(kcal_by_date)
    baseline_avg_kcal = (
        sum(kcal_by_date.values()) / baseline_days_logged
        if baseline_days_logged
        else None
    )

    if not today_rows and not baseline_rows:
        return ""

    # --- 텍스트 조립 --------------------------------------------------
    lines: list[str] = ["[환자의 식단 기록]"]

    lines.append(f"- 오늘({today.isoformat()})")
    if today_rows:
        for meal_type in (
            MealType.breakfast,
            MealType.lunch,
            MealType.dinner,
            MealType.snack,
        ):
            m = today_by_type.get(meal_type)
            if not m:
                continue
            menu = m.menu or m.ai_summary or "(메뉴 미기록)"
            pieces = [_fmt_kcal(m.calories)]
            macros = _fmt_macros(m)
            if macros:
                pieces.append(macros)
            lines.append(f"  · {_MEAL_KO[meal_type]}: {menu} — {', '.join(pieces)}")

        not_logged = [
            _MEAL_KO[t]
            for t in (MealType.breakfast, MealType.lunch, MealType.dinner)
            if t not in today_by_type
        ]
        if not_logged:
            lines.append(f"  · 미기록: {', '.join(not_logged)}")

        lines.append(f"  · 오늘 합계: 약 {today_total_kcal} kcal")

        macro = _compute_macro_ratio(today_rows)
        if macro:
            lines.append(
                f"  · 오늘 영양소 비율(그램 기준): "
                f"탄수화물 {macro['carbs_pct']}%, "
                f"단백질 {macro['protein_pct']}%, "
                f"지방 {macro['fat_pct']}%"
            )
    else:
        lines.append("  · 오늘은 아직 기록된 식단이 없습니다.")

    if baseline_avg_kcal is not None:
        lines.append(
            f"- 최근 {_BASELINE_DAYS}일(오늘 제외) 일평균: "
            f"약 {int(baseline_avg_kcal)} kcal, 기록일수 "
            f"{baseline_days_logged}/{_BASELINE_DAYS}일"
        )
        dev = _kcal_deviation_label(today_total_kcal, baseline_avg_kcal)
        if dev is not None:
            deviation_pct, key = dev
            lines.append(
                f"  · 오늘은 평균 대비 {deviation_pct:+.1f}% "
                f"({_KCAL_DEV_LABEL[key]})"
            )
    else:
        lines.append(f"- 최근 {_BASELINE_DAYS}일(오늘 제외) 기록 없음")

    lines.append(
        "위 정보는 환자가 직접 기록한 데이터입니다. 환자가 식단·영양에 대해 "
        "물으면 이 데이터를 자연스럽게 참고해 답하세요. 데이터에 없는 끼니나 "
        "영양정보는 추측하지 말고 '아직 기록되지 않았어요'라고 안내하세요."
    )
    return "\n".join(lines)

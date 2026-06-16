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

# 평균(추세) 계산 시 오늘 제외하고 며칠을 볼지.
_BASELINE_DAYS = 7

# 날짜별 상세를 보여줄 범위. 평균은 최근 7일이지만, "저번주에 뭐 먹었지?"
# 같은 회상 질문에 답하려면 더 넓게 봐야 한다(기록이 띄엄띄엄일 수 있음).
# _DETAIL_DAYS 안에서 기록이 있는 날을 최신순으로 최대 _MAX_DETAIL_DAYS 일만
# 나열한다(프롬프트 토큰이 무한정 늘지 않게).
_DETAIL_DAYS = 30
_MAX_DETAIL_DAYS = 20

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


def _relative_day_label(d: DateType, today: DateType) -> str:
    """날짜 → '어제' / 'N일 전' 라벨. 날짜별 식단을 사람이 읽기 쉽게."""
    diff = (today - d).days
    if diff == 1:
        return "어제"
    return f"{diff}일 전"


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

    # --- 과거 기록 (오늘 제외, 최근 _DETAIL_DAYS 일) -------------------
    # 한 번에 넓게(30일) 떠와서, 7일 평균과 날짜별 상세 둘 다 여기서 뽑는다.
    history_start = today - timedelta(days=_DETAIL_DAYS)
    history_rows = list(
        db.execute(
            select(Meal).where(
                Meal.user_id == user_id,
                Meal.eaten_on >= history_start,
                Meal.eaten_on < today,
            )
        ).scalars()
    )
    # 7일 평균은 최근 7일 부분집합으로만 계산.
    baseline_start = today - timedelta(days=_BASELINE_DAYS)
    baseline_rows = [m for m in history_rows if m.eaten_on >= baseline_start]
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

    if not today_rows and not history_rows:
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

    # --- 날짜별 상세 (최근 _DETAIL_DAYS 일, 최신순 최대 _MAX_DETAIL_DAYS 일) --
    # 평균값만으로는 "지난주 수요일 저녁 뭐였지?" 같은 질문에 답할 수 없으므로
    # 날짜·끼니별 목록을 함께 넣어 AI 가 특정 날짜 식단도 답할 수 있게 한다.
    # 기록이 띄엄띄엄일 수 있어 7일이 아닌 _DETAIL_DAYS(기본 30일)까지 본다.
    if history_rows:
        meals_by_date: dict[DateType, list[Meal]] = {}
        for m in history_rows:
            meals_by_date.setdefault(m.eaten_on, []).append(m)

        recent_dates = sorted(meals_by_date.keys(), reverse=True)[:_MAX_DETAIL_DAYS]
        lines.append(f"- 최근 식단 기록(최신순, 최대 {_MAX_DETAIL_DAYS}일):")
        for d in recent_dates:
            day_meals = meals_by_date[d]
            by_type = {m.meal_type: m for m in day_meals}
            parts: list[str] = []
            for meal_type in (
                MealType.breakfast,
                MealType.lunch,
                MealType.dinner,
                MealType.snack,
            ):
                m = by_type.get(meal_type)
                if not m:
                    continue
                menu = m.menu or m.ai_summary or "(메뉴 미기록)"
                seg = f"{_MEAL_KO[meal_type]} {menu}"
                if m.calories is not None:
                    seg += f" {int(m.calories)}kcal"
                # 과거 끼니에도 영양소(단/탄/지)를 넣어 며칠 단위 영양 피드백이
                # 가능하게 한다. 매크로 기록이 없으면 자연스럽게 생략된다.
                macros = _fmt_macros(m)
                if macros:
                    seg += f"({macros})"
                parts.append(seg)
            day_total = sum((m.calories or 0) for m in day_meals)
            line = f"  · {d.isoformat()} ({_relative_day_label(d, today)}): " + ", ".join(parts)
            if day_total:
                line += f" — 합계 약 {day_total} kcal"
            # 그날 영양소 비율도 함께 — "이 날은 탄수화물 위주였네요" 같은 피드백용.
            day_macro = _compute_macro_ratio(day_meals)
            if day_macro:
                line += (
                    f" [영양소 비율 탄 {day_macro['carbs_pct']}%·"
                    f"단 {day_macro['protein_pct']}%·"
                    f"지 {day_macro['fat_pct']}%]"
                )
            lines.append(line)

    lines.append(
        "위 정보는 환자가 직접 기록한 데이터입니다. 환자가 식단·영양에 대해 "
        "물으면 이 데이터를 자연스럽게 참고해 답하세요. '어제'나 '지난주' 같은 "
        "특정 날짜의 식단도 위 '날짜별 식단' 목록에서 찾아 답할 수 있습니다. "
        "다만 목록에 없는 날짜·끼니나 영양정보는 추측하지 말고 '아직 기록되지 "
        "않았어요'라고 안내하세요."
    )
    return "\n".join(lines)

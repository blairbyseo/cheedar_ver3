"""포인트·경험치(XP/CP) 적립 로직.

용어
  XP : 누적 경험치. 레벨 판정 기준. 한 번 오르면 절대 줄지 않는다.
  CP : 소비 가능한 포인트. 적립은 XP 와 '같은 값'으로 함께 일어나지만,
       이후 보상 교환 등으로 차감될 수 있다(차감은 별도 로직).

적립 규칙은 4가지(POINT_RULES) — 프론트 Point.jsx 의 적립 기준 카드와 같다.
식단이 1건 저장될 때마다 award_points_for_meal() 이 호출돼,
충족된 규칙만큼 XP 와 CP 를 함께 올린다.

같은 적립이 두 번 들어가지 않도록 PointHistory 에 (user_id, rule,
dedup_key) 유니크 제약을 두고, 적립 전에 같은 키가 이미 있는지 확인한다.
"""
from __future__ import annotations

from datetime import date as DateType

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.meal import Meal, MealType
from app.models.points import PointHistory
from app.models.user import User

# ── 적립 규칙 ──────────────────────────────────────────────────────────
# rule 키는 프론트(Point.jsx)의 icon-${id} CSS 클래스와 동일하게 유지할 것.
RULE_MEAL_CHECK = "meal-check"
RULE_THREE_MEALS = "three-meals"
RULE_WEEKLY_GOAL = "weekly-goal"
RULE_FULL_WEEK = "full-week"

POINT_RULES: list[dict] = [
    {"id": RULE_MEAL_CHECK,  "label": "식단 1회 기록",      "point": 10},
    {"id": RULE_THREE_MEALS, "label": "하루 3끼 완료",      "point": 20},
    {"id": RULE_WEEKLY_GOAL, "label": "주 5일 기록",        "point": 100},
    {"id": RULE_FULL_WEEK,   "label": "주 7일 기록 보너스", "point": 50},
]
_POINT_BY_RULE: dict[str, int] = {r["id"]: r["point"] for r in POINT_RULES}

# 하루 '3끼'로 인정하는 끼니 — 간식(snack)은 제외.
_MAIN_MEALS = {MealType.breakfast, MealType.lunch, MealType.dinner}

# 적립 내역 라벨용 끼니 한글 이름.
_MEAL_LABEL = {
    MealType.breakfast: "아침",
    MealType.lunch: "점심",
    MealType.dinner: "저녁",
    MealType.snack: "간식",
}

# 주간 목표 — '주 5일 기록'을 한 주의 목표로 본다(Point 화면의 주간 목표 카드).
WEEK_GOAL_DAYS = 5

# 레벨 곡선 — 레벨이 오를수록 다음 레벨에 필요한 XP 가 점점 늘어난다.
#   Lv.N → Lv.N+1 에 드는 XP = LEVEL_BASE + (N-1) * LEVEL_INC
#   → 현재 값(50/150)이면 Lv.1→2 는 50, 2→3 은 200, 3→4 는 350 ... 처럼
#     한 칸 오를 때마다 비용이 LEVEL_INC 만큼 무거워진다.
# 칸 비용이 등차수열이라 'Lv.L 도달 누적 XP' 도 닫힌 식으로 떨어진다(_xp_to_reach).
# 곡선을 바꾸고 싶으면 아래 두 값만 조정하면 된다.
LEVEL_BASE = 50    # Lv.1 → Lv.2 에 필요한 XP
LEVEL_INC = 150    # 레벨이 한 칸 오를 때마다 '다음 칸 비용'에 더해지는 XP


def _xp_to_reach(level: int) -> int:
    """level 에 '도달'하는 데 필요한 누적 XP. Lv.1 은 0.

    Lv.1→2, 2→3, …, (level-1)→level 까지 각 칸 비용을 모두 더한 값.
    각 칸 비용이 LEVEL_BASE/LEVEL_INC 로 만드는 등차수열이라,
    그 합도 닫힌 식으로 나온다.
    """
    n = level - 1                                    # 지금까지 오른 칸 수
    return n * LEVEL_BASE + LEVEL_INC * n * (n - 1) // 2


def level_for_xp(xp: int) -> tuple[int, float]:
    """누적 XP 로 (레벨, 다음 레벨까지 진행률 0.0~1.0) 을 계산.

    _xp_to_reach 는 레벨에 따라 단조 증가하므로, '도달 누적 XP 가
    현재 xp 이하인 가장 큰 레벨'이 곧 현재 레벨이다. 레벨 수가 적어
    한 칸씩 올려보는 선형 탐색으로 충분하다(닫힌 식 역산은 불필요).
    """
    level = 1
    while _xp_to_reach(level + 1) <= xp:
        level += 1
    span = _xp_to_reach(level + 1) - _xp_to_reach(level)   # 이번 레벨 한 칸 비용
    progress = (xp - _xp_to_reach(level)) / span
    return level, progress


def _iso_week_key(d: DateType) -> str:
    """ISO 주 식별 문자열. 예: 2026-W21 — 주간 적립 중복 방지 키로 쓴다."""
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def meal_dates_in_week(
    db: Session, user_id: int, ref_day: DateType
) -> list[DateType]:
    """ref_day 가 속한 ISO 주에 식단을 기록한 '서로 다른 날' 목록 (오름차순).

    홈 화면이 '어느 요일에 기록했는지'까지 알아야 요일별 체크를 그릴 수
    있어서, 개수만 세던 count_meal_days_in_week 의 바탕이 되는 날짜
    목록을 따로 둔다.
    """
    target_week = ref_day.isocalendar()[:2]  # (ISO year, ISO week)
    meal_days = db.execute(
        select(Meal.eaten_on).where(Meal.user_id == user_id).distinct()
    ).scalars()
    return sorted(d for d in meal_days if d.isocalendar()[:2] == target_week)


def count_meal_days_in_week(db: Session, user_id: int, ref_day: DateType) -> int:
    """ref_day 가 속한 ISO 주에 식단을 기록한 '서로 다른 날' 수 (0~7)."""
    return len(meal_dates_in_week(db, user_id, ref_day))


def _grant(
    db: Session,
    user: User,
    rule: str,
    dedup_key: str,
    label: str,
    earned: list[dict],
) -> None:
    """규칙 1건을 적립한다.

    이미 같은 (user, rule, dedup_key) 로 적립된 적이 있으면 아무 일도
    하지 않는다 — 같은 조건으로 두 번 적립되는 것을 막는다.
    """
    # 세션이 autoflush=False 이므로, 앞선 _grant 가 add 한 PointHistory 는
    # 아직 DB 에 없을 수 있다. 중복 검사 SELECT 가 그 행까지 보도록 먼저 flush.
    db.flush()
    already_granted = db.execute(
        select(PointHistory.id).where(
            PointHistory.user_id == user.id,
            PointHistory.rule == rule,
            PointHistory.dedup_key == dedup_key,
        )
    ).first()
    if already_granted is not None:
        return

    amount = _POINT_BY_RULE[rule]
    db.add(
        PointHistory(
            user_id=user.id,
            rule=rule,
            amount=amount,
            label=label,
            dedup_key=dedup_key,
        )
    )
    # ★ 핵심 규칙: 적립이 일어나면 XP 와 CP 가 '같은 값만큼' 동시에 오른다.
    user.xp += amount   # 경험치 — 누적만, 차감 없음
    user.cp += amount   # 포인트 — 적립은 XP 와 동일, 차감은 별도 로직에서
    earned.append({"rule": rule, "label": label, "amount": amount})


def award_points_for_meal(db: Session, user: User, meal: Meal) -> list[dict]:
    """식단 1건이 저장된 직후 호출. 충족된 규칙만큼 user.xp / user.cp 를 올린다.

    DB 커밋은 호출하는 쪽(create_meal)에서 한다 — 식단 저장과 포인트
    적립이 한 트랜잭션으로 함께 반영되도록.
    반환: 이번에 새로 적립된 규칙 목록.
    """
    earned: list[dict] = []
    day = meal.eaten_on

    # 1) 식단 1회 기록 — 끼니 종류와 무관하게 식단 1건당 한 번.
    _grant(
        db, user, RULE_MEAL_CHECK,
        dedup_key=f"meal:{meal.id}",
        label=f"{_MEAL_LABEL.get(meal.meal_type, '식단')} 기록 완료",
        earned=earned,
    )

    # 2) 하루 3끼 완료 — 그날 아침·점심·저녁이 모두 기록됐을 때 하루 한 번.
    day_types = set(
        db.execute(
            select(Meal.meal_type).where(
                Meal.user_id == user.id, Meal.eaten_on == day
            )
        ).scalars()
    )
    if _MAIN_MEALS.issubset(day_types):
        _grant(
            db, user, RULE_THREE_MEALS,
            dedup_key=f"day:{day.isoformat()}",
            label="하루 3끼 기록 달성",
            earned=earned,
        )

    # 3)/4) 주간 기록 — 그 주에 식단을 기록한 '서로 다른 날' 수로 판정.
    #        한 주에 5일·7일 보너스를 각각 한 번씩만 준다.
    days_in_week = count_meal_days_in_week(db, user.id, day)
    week_key = _iso_week_key(day)
    if days_in_week >= 5:
        _grant(
            db, user, RULE_WEEKLY_GOAL,
            dedup_key=f"week:{week_key}",
            label="주 5일 기록 달성",
            earned=earned,
        )
    if days_in_week >= 7:
        _grant(
            db, user, RULE_FULL_WEEK,
            dedup_key=f"week:{week_key}",
            label="주 7일 기록 보너스",
            earned=earned,
        )

    return earned

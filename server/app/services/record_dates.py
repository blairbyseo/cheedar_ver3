"""식단/운동 기록 날짜 규칙.

- '오늘'은 한국 사용자 기준 KST(UTC+9) 날짜다. 서버(EC2)는 UTC 라
  datetime.now().date() 를 쓰면 아침 9시 전 기록이 전날로 들어간다.
- 지난 날짜 기록은 최근 BACKFILL_DAYS 일까지만 허용한다. 미래 날짜는 불가.
  (포인트가 날짜 기준으로 적립되므로 무제한 소급을 막는다.)
"""
from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

KST = timezone(timedelta(hours=9))

# 오늘 포함하지 않고, 오늘로부터 며칠 전까지 기록할 수 있는지
BACKFILL_DAYS = 7


def kst_today() -> DateType:
    return datetime.now(KST).date()


def resolve_record_date(requested: DateType | None) -> DateType:
    """요청 날짜를 검증해 돌려준다. 없으면 오늘(KST)."""
    today = kst_today()
    if requested is None:
        return today
    if requested > today:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "미래 날짜는 기록할 수 없어요.")
    if requested < today - timedelta(days=BACKFILL_DAYS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"최근 {BACKFILL_DAYS}일 이내의 기록만 추가할 수 있어요.",
        )
    return requested

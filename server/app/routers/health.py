"""스마트폰 건강 데이터(걸음수·수면) 수신.

- POST /api/health/steps  : 앱이 읽은 일별 걸음수를 올린다(같은 날은 덮어씀)
- POST /api/health/sleep  : 앱이 조각을 합쳐 만든 하룻밤 수면을 올린다(같은 날은 덮어씀)
- GET  /api/health/status : 마지막으로 동기화된 날/값(설정 화면 표시용)

둘 다 포인트 적립에 쓰지 않는다. 저장만 하고, 맥락 변환은
services/steps_context.py · services/sleep_context.py 가 맡는다.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.user import User
from app.schemas.health import HealthStatusOut, SleepSyncIn, StepsSyncIn, StepsSyncOut
from app.services.record_dates import kst_today

router = APIRouter(prefix="/api/health", tags=["health"])

# 너무 먼 과거/미래 날짜는 버린다(폰 시계 오류·잘못된 집계 방어).
_MAX_BACKFILL_DAYS = 31


@router.post("/steps", response_model=StepsSyncOut)
def sync_steps(
    payload: StepsSyncIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StepsSyncOut:
    today = kst_today()
    oldest = today - timedelta(days=_MAX_BACKFILL_DAYS)
    # 같은 날짜가 두 번 오면 마지막 값만 쓴다.
    wanted = {
        d.day: d.steps
        for d in payload.days
        if oldest <= d.day <= today + timedelta(days=1)  # 폰 시간대가 KST 보다 앞설 수 있어 +1일 허용
    }
    if not wanted:
        return StepsSyncOut(saved=0, latest_day=None)

    existing = {
        row.day: row
        for row in db.execute(
            select(DailySteps).where(
                DailySteps.user_id == current_user.id,
                DailySteps.day.in_(list(wanted)),
            )
        ).scalars()
    }
    for day, steps in wanted.items():
        row = existing.get(day)
        if row is None:
            db.add(
                DailySteps(
                    user_id=current_user.id, day=day, steps=steps, source=payload.source
                )
            )
        else:
            row.steps = steps
            row.source = payload.source
    db.commit()
    return StepsSyncOut(saved=len(wanted), latest_day=max(wanted))


@router.post("/sleep", response_model=StepsSyncOut)
def sync_sleep(
    payload: SleepSyncIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StepsSyncOut:
    today = kst_today()
    oldest = today - timedelta(days=_MAX_BACKFILL_DAYS)
    wanted = {
        n.day: n
        for n in payload.nights
        if oldest <= n.day <= today + timedelta(days=1)
    }
    if not wanted:
        return StepsSyncOut(saved=0, latest_day=None)

    existing = {
        row.day: row
        for row in db.execute(
            select(DailySleep).where(
                DailySleep.user_id == current_user.id,
                DailySleep.day.in_(list(wanted)),
            )
        ).scalars()
    }
    for day, night in wanted.items():
        row = existing.get(day)
        if row is None:
            row = DailySleep(user_id=current_user.id, day=day)
            db.add(row)
        row.asleep_minutes = night.asleep_minutes
        row.bed_start = night.bed_start
        row.wake_end = night.wake_end
        row.source = payload.source
    db.commit()
    return StepsSyncOut(saved=len(wanted), latest_day=max(wanted))


@router.get("/status", response_model=HealthStatusOut)
def health_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HealthStatusOut:
    steps = db.execute(
        select(DailySteps)
        .where(DailySteps.user_id == current_user.id)
        .order_by(DailySteps.day.desc())
        .limit(1)
    ).scalar_one_or_none()
    sleep = db.execute(
        select(DailySleep)
        .where(DailySleep.user_id == current_user.id)
        .order_by(DailySleep.day.desc())
        .limit(1)
    ).scalar_one_or_none()
    out = HealthStatusOut()
    if steps is not None:
        out.latest_day, out.latest_steps, out.updated_at = steps.day, steps.steps, steps.updated_at
    if sleep is not None:
        out.sleep_latest_day, out.sleep_latest_minutes = sleep.day, sleep.asleep_minutes
    return out

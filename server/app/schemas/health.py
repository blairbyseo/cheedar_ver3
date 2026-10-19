from datetime import date as DateType
from datetime import datetime

from pydantic import BaseModel, Field


class DailyStepsIn(BaseModel):
    day: DateType
    steps: int = Field(ge=0, le=200_000)


class StepsSyncIn(BaseModel):
    """앱이 Health Connect/HealthKit 에서 읽은 최근 며칠치 일별 걸음수."""

    source: str = Field(default="health_connect", max_length=32)
    days: list[DailyStepsIn] = Field(min_length=1, max_length=31)


class StepsSyncOut(BaseModel):
    saved: int
    latest_day: DateType | None = None


class SleepNightIn(BaseModel):
    """하룻밤 수면. day 는 일어난 날짜, asleep_minutes 는 깬 구간을 뺀 실제 수면 분."""

    day: DateType
    asleep_minutes: int = Field(ge=0, le=24 * 60)
    bed_start: datetime | None = None
    wake_end: datetime | None = None


class SleepSyncIn(BaseModel):
    source: str = Field(default="health_connect", max_length=32)
    nights: list[SleepNightIn] = Field(min_length=1, max_length=31)


class HealthStatusOut(BaseModel):
    """설정 화면 '마지막 동기화' 표시용 — 걸음수·수면 각각 가장 최근 날."""

    latest_day: DateType | None = None
    latest_steps: int | None = None
    updated_at: datetime | None = None
    sleep_latest_day: DateType | None = None
    sleep_latest_minutes: int | None = None

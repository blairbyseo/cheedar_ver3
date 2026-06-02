from datetime import date as DateType

from pydantic import BaseModel, Field


class ExerciseItemInput(BaseModel):
    """운동 기록의 개별 운동 한 항목 (입력용)."""

    exercise_name: str = Field(..., min_length=1, max_length=60)
    met: float = Field(..., gt=0, le=20)
    duration_hours: int = Field(default=0, ge=0)
    duration_minutes: int = Field(default=0, ge=0, le=59)
    intensity: int = Field(..., ge=1, le=10)


class ExerciseItemOutput(BaseModel):
    """운동 기록의 개별 운동 한 항목 (응답용, 서버 계산된 kcal 포함)."""

    exercise_name: str
    met: float
    duration_hours: int
    duration_minutes: int
    intensity: int
    calories_burned: float


class ExerciseLogCreate(BaseModel):
    """운동 기록 저장 요청. items[] 기반. is_skipped=True면 items 무시."""

    done_on: DateType | None = None  # 미지정 시 서버에서 오늘 날짜
    is_skipped: bool = False
    items: list[ExerciseItemInput] = []


class ExerciseLogOut(BaseModel):
    """운동 기록 응답 — 하루치 한 건."""

    id: int
    done_on: DateType
    is_skipped: bool
    calories_burned: float | None = None
    items: list[ExerciseItemOutput] = []


class ExerciseAnalyzeRequest(BaseModel):
    """사전 MET DB에 없는 운동명에 대한 AI MET 추정 요청."""

    exercise_name: str = Field(..., min_length=1, max_length=60)


class ExerciseAnalyzeResponse(BaseModel):
    """AI MET 추정 응답."""

    normalized_name: str
    met: float
    notes: str | None = None

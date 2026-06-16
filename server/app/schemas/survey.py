"""설문(Survey) API 요청/응답 스키마."""
from datetime import datetime

from pydantic import BaseModel


class SurveyNextResponse(BaseModel):
    """GET /api/survey/next 응답.

    due 가 None 이면 보여줄 설문 없음(나머지 필드는 의미 없음).
    """

    due: str | None = None  # "onboarding" | "recurring" | None
    response_id: int | None = None
    schema_id: int | None = None
    schema_version: str | None = None
    schema_json: dict | None = None
    current_section: str | None = None
    answers: dict = {}
    prefilled_answers: dict = {}
    reward_points: int = 0  # 설문 완료 시 받는 포인트 — 진행 중 독려 안내에 사용


class SurveyProgressRequest(BaseModel):
    """PATCH /api/survey/{id}/progress 요청 — 한 섹션 분량의 부분 응답.

    answers: 이번에 추가/변경된 question_id → 값 매핑. 서버는 기존 answers 에
        update 한다(변경분만 보내도 됨).
    current_section: 다음에 이어서 시작할 섹션 식별자 (예: "C").
    """

    answers: dict
    current_section: str | None = None


class SurveyProgressResponse(BaseModel):
    response_id: int
    current_section: str | None = None
    updated_at: datetime


class SurveySubmitResponse(BaseModel):
    response_id: int
    derived_flags: dict
    completed_at: datetime
    points_awarded: int = 0  # 이번 제출로 새로 적립된 포인트(설문 완료 = 50)

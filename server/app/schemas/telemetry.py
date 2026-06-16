"""사용자 앱이 보내는 원시 텔레메트리 샘플 스키마.

페이지 체류시간/동선 전환을 수집해 관리자 분석에서 집계한다(fire-and-forget).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PageTimeSampleCreate(BaseModel):
    page_path: str = Field(description="경로 식별자. 예: '/record'.")
    time_spent_seconds: float = Field(ge=0, description="페이지 체류시간(초).")


class UserFlowSampleCreate(BaseModel):
    from_page: str = Field(description="출발 페이지 경로.")
    to_page: str = Field(description="도착 페이지 경로.")

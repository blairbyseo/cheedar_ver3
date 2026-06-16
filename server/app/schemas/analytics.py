"""관리자 분석(대시보드 차트)용 응답 스키마.

Cheddar_Team_26 의 schemas/analytics.py 를 그대로 옮긴 것. 프론트(recharts)의
dataKey 와 1:1로 맞춘 키 이름을 유지한다(예: '기록'/'건너뜀', from/to).
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class ActivityDailyItem(BaseModel):
    """주간 활동 통계 일별 항목."""

    name: str = Field(description="요일명 (Sun~Sat)")
    users: int = Field(description="해당일 활성 이용자 수")
    records: int = Field(description="해당일 기록 수")


class ActivityWeeklyResponse(BaseModel):
    items: List[ActivityDailyItem]


class RecordFrequencyElementItem(BaseModel):
    """요소별 기록 빈도 항목 (기록/건너뜀).

    프론트 BarChart 의 dataKey 가 '기록'/'건너뜀' 이라 직렬화 별칭을 맞춘다.
    """

    name: str = Field(description="요소명 (아침/점심/저녁/간식/운동)")
    recorded: int = Field(description="기록 건수", serialization_alias="기록")
    skipped: int = Field(description="건너뜀 건수", serialization_alias="건너뜀")


class RecordFrequencyTimeItem(BaseModel):
    name: str = Field(description="시간대 (00시~23시)")
    records: int = Field(description="해당 시간대 기록 수")


class RecordFrequencyResponse(BaseModel):
    """breakdown 에 따라 daily/element/time 중 하나만 채워진다."""

    daily: Optional[List[ActivityDailyItem]] = None
    element: Optional[List[RecordFrequencyElementItem]] = None
    time: Optional[List[RecordFrequencyTimeItem]] = None


class PageTimeStatsItem(BaseModel):
    """페이지별 소요 시간 집계 1건. 키는 프론트 PAGE_TIME mock 모양과 동일."""

    name: str = Field(description="페이지 경로 또는 표시명")
    avgTime: float = Field(description="평균 소요(초)")
    medianTime: float = Field(description="중앙값(초)")
    p50: float = Field(description="50백분위(초)")
    p90: float = Field(description="90백분위(초)")
    p95: float = Field(description="95백분위(초)")
    totalTime: float = Field(description="총 소요(초)")
    pageViews: int = Field(description="샘플 수(조회수)")


class PageTimeStatsResponse(BaseModel):
    items: List[PageTimeStatsItem]


class UserFlowEdge(BaseModel):
    """Sankey 엣지 — 페이지 전환 1건과 그 횟수."""

    from_: str = Field(alias="from")
    to: str
    value: int

    model_config = {"populate_by_name": True}


class UserFlowResponse(BaseModel):
    edges: List[UserFlowEdge]

from datetime import datetime

from pydantic import BaseModel


class PointRuleOut(BaseModel):
    """포인트 적립 기준 1개 (Point 화면의 적립 기준 카드)."""

    id: str
    label: str
    point: int


class PointHistoryItem(BaseModel):
    """적립 내역 1줄."""

    id: int
    rule: str
    label: str
    amount: int
    created_at: datetime

    class Config:
        from_attributes = True


class PointSummary(BaseModel):
    """홈·포인트 화면용 — 현재 로그인한 환자의 XP/CP 현황."""

    user_id: str
    xp: int                 # 누적 경험치 (레벨 판정용, 감소 없음)
    cp: int                 # 소비 가능한 포인트
    level: int              # XP 로 계산한 레벨
    level_progress: float   # 다음 레벨까지 진행률 (0.0~1.0)
    earned_today: int       # 오늘 적립한 포인트 합
    earned_this_week: int   # 이번 주 적립한 포인트 합
    week_record_days: int   # 이번 주 식단을 기록한 날 수 (0~7)
    week_record_weekdays: list[int]  # 이번 주 기록한 요일 인덱스 (0=월 … 6=일)
    week_goal_days: int     # 주간 목표 일수 (주 5일)
    rules: list[PointRuleOut]
    recent_history: list[PointHistoryItem]


class RankingEntry(BaseModel):
    """랭킹 1줄."""

    rank: int
    user_id: str
    xp: int            # 누적 경험치 — 랭킹 정렬 기준이자 화면 표시값
    level: int         # xp 로 계산된 레벨
    is_me: bool = False
    profile_image_path: str | None = None  # 프로필 사진 경로(없으면 None → 프론트가 색 아바타로 대체)


class RankingResponse(BaseModel):
    """XP 기준 전체 환자 랭킹."""

    me: RankingEntry           # 현재 로그인한 환자의 순위 (100위 밖이어도 채워줌)
    top: list[RankingEntry]    # 1~100위

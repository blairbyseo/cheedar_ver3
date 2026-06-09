from datetime import datetime

from pydantic import BaseModel


class DashboardStats(BaseModel):
    """관리자 대시보드 상단 요약 카드용 숫자들."""

    total_users: int          # 전체 회원 수
    admin_count: int          # 그중 관리자 수
    today_meals: int          # 오늘(KST) 기록된 식단 수
    total_chat_messages: int  # 누적 채팅 메시지 수
    total_points_awarded: int  # 누적 적립 포인트 합 (point_history.amount 합)
    unresolved_safety_count: int  # 아직 처리 안 된 위험 신호 수


class SafetyEventOut(BaseModel):
    """위험 신호 한 건 — 관리자 화면용. 회원 표시 정보를 함께 담는다."""

    id: int
    user_id: int            # 내부 PK (상세 화면 이동용)
    account_id: str         # 로그인 아이디(user.user_id)
    nickname: str | None
    risk_level: str         # low | medium | high | critical
    detected_category: str  # 예: survey_suicide_acute
    source: str             # survey | chat
    description: str | None
    status: str             # unresolved | reviewing | resolved
    is_resolved: bool
    created_at: datetime


class SafetyEventResolveRequest(BaseModel):
    """위험 신호 처리 상태 변경 요청."""

    status: str  # unresolved | reviewing | resolved


class AdminUserListItem(BaseModel):
    """회원 목록 표의 한 줄."""

    id: int
    user_id: str
    nickname: str | None
    email: str | None
    xp: int
    cp: int
    is_admin: bool
    meal_count: int       # 이 회원이 기록한 총 식단 수
    created_at: datetime

    class Config:
        from_attributes = True


class AdminUserListResponse(BaseModel):
    items: list[AdminUserListItem]
    total: int       # 검색 조건에 맞는 전체 회원 수 (페이지네이션용)
    page: int
    page_size: int


class AdminUserDetail(BaseModel):
    """회원 상세 화면 상단 프로필 + 집계."""

    id: int
    user_id: str
    nickname: str | None
    email: str | None
    profile_image_path: str | None
    age: int | None
    height_cm: float | None
    weight_kg: float | None
    xp: int
    cp: int
    is_admin: bool
    created_at: datetime
    # 집계값 — 탭별 데이터 양을 미리 보여주는 데 쓴다.
    meal_count: int
    chat_count: int
    points_total: int

    class Config:
        from_attributes = True

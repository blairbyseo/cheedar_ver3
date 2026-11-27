import csv
import io
import secrets
from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_admin
from app.services.account import anonymize_user
from app.models.chat import ChatMessage, ChatRole
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.inquiry import Inquiry
from app.models.invite_code import InviteCode, normalize_code
from app.models.meal import Meal
from app.models.points import PointHistory
from app.models.reward import RewardClaim, RewardClaimStatus
from app.models.safety import RiskLevel, SafetyEvent
from app.models.survey import (
    SurveyResponse,
    SurveyResponseStatus,
    SurveySchema,
)
from app.models.user import User
from app.schemas.admin import (
    AdminInviteCodeCreateRequest,
    AdminInviteCodeItem,
    AdminInviteCodeUpdateRequest,
    AdminSurveyResponseItem,
    AdminHealthDailyRow,
    AdminHealthDay,
    AdminHealthOverview,
    AdminHealthUserRow,
    AdminUserDetail,
    AdminUserHealth,
    AdminUserListItem,
    AdminUserListResponse,
    DashboardStats,
    SafetyEventOut,
    SafetyEventResolveRequest,
)
from app.schemas.chat import ChatMessageOut
from app.schemas.inquiry import InquiryOut, InquiryResolveRequest
from app.schemas.meal import MealOut
from app.schemas.points import PointHistoryItem
from app.schemas.rewards import (
    AdminRewardClaimItem,
    AdminRewardClaimListResponse,
    AdminRewardClaimUpdateRequest,
)

# 모든 엔드포인트가 get_current_admin 으로 보호된다 — 관리자가 아니면 403.
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)],
)

# '오늘'을 한국 시간 기준으로 묶기 위한 타임존 (points 라우터와 동일 기준).
KST = timezone(timedelta(hours=9))


# -- 바로가기 링크 -----------------------------------------------------------

@router.get("/links")
def admin_links() -> dict:
    """사이드바 바로가기 주소 — 공개 번들에 넣으면 안 되는 주소라 관리자에게만 내려준다."""
    return {"google_sheet_url": get_settings().google_sheet_url}


# -- 대시보드 ---------------------------------------------------------------

@router.get("/stats/dashboard", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    """상단 요약 카드용 숫자들을 한 번에 모아 돌려준다."""
    today = datetime.now(KST).date()

    total_users = db.scalar(
        select(func.count()).select_from(User).where(User.deleted_at.is_(None))
    ) or 0
    admin_count = db.scalar(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    ) or 0
    today_meals = db.scalar(
        select(func.count()).select_from(Meal).where(Meal.eaten_on == today)
    ) or 0
    # 채팅은 timestamp라서 KST '오늘' 00:00~내일 00:00 구간으로 센다.
    today_start = datetime(today.year, today.month, today.day, tzinfo=KST)
    today_chat_messages = db.scalar(
        select(func.count())
        .select_from(ChatMessage)
        .where(
            ChatMessage.created_at >= today_start,
            ChatMessage.created_at < today_start + timedelta(days=1),
        )
    ) or 0
    total_chat_messages = db.scalar(
        select(func.count()).select_from(ChatMessage)
    ) or 0
    total_points_awarded = db.scalar(
        select(func.coalesce(func.sum(PointHistory.amount), 0))
    ) or 0
    unresolved_safety_count = db.scalar(
        select(func.count())
        .select_from(SafetyEvent)
        .where(SafetyEvent.is_resolved.is_(False))
    ) or 0

    # 건강 데이터 수신 현황. 수면 day 는 '일어난 날'이라 KST 오늘 = 어젯밤 잠.
    week_ago = today - timedelta(days=6)

    def _distinct_users(model, start: DateType, end: DateType) -> int:
        return db.scalar(
            select(func.count(func.distinct(model.user_id))).where(
                model.day >= start, model.day <= end
            )
        ) or 0

    return DashboardStats(
        total_users=total_users,
        admin_count=admin_count,
        today_meals=today_meals,
        today_chat_messages=today_chat_messages,
        total_chat_messages=total_chat_messages,
        total_points_awarded=total_points_awarded,
        unresolved_safety_count=unresolved_safety_count,
        sleep_last_night_users=_distinct_users(DailySleep, today, today),
        sleep_users_7d=_distinct_users(DailySleep, week_ago, today),
        steps_today_users=_distinct_users(DailySteps, today, today),
        steps_users_7d=_distinct_users(DailySteps, week_ago, today),
    )


# -- 위험 신호 (SafetyEvent) ------------------------------------------------
# 설문 채점에서 위험 플래그가 뜨면 SafetyEvent 로 적재된다(추후 챗봇 감지도 동일).
# PDF 설계상 '안전 판단은 임상적 판단' — 앱은 신호만 모아 보여주고, 관리자(감독
# 전문의)가 직접 보고 개입한다. 여기가 그 '관리자에게 넘기는' 통로다.

# critical → high → medium → low 순으로 정렬하기 위한 심각도 랭크.
_SEVERITY_RANK = case(
    (SafetyEvent.risk_level == RiskLevel.CRITICAL, 0),
    (SafetyEvent.risk_level == RiskLevel.HIGH, 1),
    (SafetyEvent.risk_level == RiskLevel.MEDIUM, 2),
    else_=3,
)


def _safety_out(event: SafetyEvent, user: User) -> SafetyEventOut:
    """SafetyEvent + 소유 User → 관리자 화면용 응답으로 변환."""
    return SafetyEventOut(
        id=event.id,
        user_id=event.user_id,
        account_id=user.user_id,
        nickname=user.nickname,
        risk_level=event.risk_level.value,
        detected_category=event.detected_category,
        source="survey" if event.detected_category.startswith("survey_") else "chat",
        description=event.description,
        status=event.status,
        is_resolved=event.is_resolved,
        created_at=event.created_at,
    )


@router.get("/safety-events", response_model=list[SafetyEventOut])
def list_safety_events(
    status_filter: str = Query(
        default="open",
        alias="status",
        description="open(미해결) | resolved | all",
    ),
    risk: str | None = Query(default=None, description="risk_level 필터(critical 등)"),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[SafetyEventOut]:
    """위험 신호 목록 — 기본은 미해결, 심각도 높은 순."""
    stmt = select(SafetyEvent, User).join(User, User.id == SafetyEvent.user_id)
    if status_filter == "open":
        stmt = stmt.where(SafetyEvent.is_resolved.is_(False))
    elif status_filter != "all":
        stmt = stmt.where(SafetyEvent.status == status_filter)
    if risk:
        stmt = stmt.where(SafetyEvent.risk_level == RiskLevel(risk))
    stmt = stmt.order_by(_SEVERITY_RANK, SafetyEvent.created_at.desc()).limit(limit)

    return [_safety_out(ev, user) for ev, user in db.execute(stmt).all()]


@router.get(
    "/users/{user_id}/safety-events", response_model=list[SafetyEventOut]
)
def get_user_safety_events(
    user_id: int, db: Session = Depends(get_db)
) -> list[SafetyEventOut]:
    """특정 회원의 위험 신호 — 심각도 높은 순, 같으면 최신순."""
    user = _get_user_or_404(user_id, db)
    stmt = (
        select(SafetyEvent)
        .where(SafetyEvent.user_id == user_id)
        .order_by(_SEVERITY_RANK, SafetyEvent.created_at.desc())
    )
    return [_safety_out(ev, user) for ev in db.execute(stmt).scalars()]


@router.patch("/safety-events/{event_id}", response_model=SafetyEventOut)
def update_safety_event(
    event_id: int,
    body: SafetyEventResolveRequest,
    db: Session = Depends(get_db),
) -> SafetyEventOut:
    """위험 신호 처리 상태 변경(unresolved | reviewing | resolved)."""
    if body.status not in ("unresolved", "reviewing", "resolved"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid status")
    event = db.get(SafetyEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Safety event not found")
    event.status = body.status
    event.is_resolved = body.status == "resolved"
    db.commit()
    db.refresh(event)
    user = db.get(User, event.user_id)
    return _safety_out(event, user)


# -- 회원 목록 / 검색 -------------------------------------------------------

def _user_search_filters(q: str | None) -> list:
    """회원 목록 필터 — 탈퇴(익명화)한 회원은 빼고, 검색어(q)는 아이디/닉네임/이메일 부분검색.

    탈퇴 회원의 기록은 연구용으로 DB 에 남지만 관리자 회원 목록·CSV 에는 보이지 않는다.
    """
    filters = [User.deleted_at.is_(None)]
    if not q:
        return filters
    like = f"%{q.strip()}%"
    return [
        *filters,
        or_(
            User.user_id.ilike(like),
            User.nickname.ilike(like),
            User.email.ilike(like),
        )
    ]


def _chat_count_expr():
    """회원이 직접 보낸 채팅(user 발화) 수.

    식단 outerjoin 과 곱해져 카운트가 부풀지 않도록 상관 서브쿼리로 계산한다.
    AI 응답(role=ai)은 제외하고, 사용자가 실제로 말한 메시지만 센다.
    """
    return (
        select(func.count(ChatMessage.id))
        .where(
            ChatMessage.user_id == User.id,
            ChatMessage.role == ChatRole.user,
        )
        .scalar_subquery()
    )


def _user_order_by(sort: str, order: str, extra: dict | None = None) -> tuple:
    """정렬 기준/방향을 order_by 인자로 변환.

    화이트리스트에 없는 sort 값은 기본(가입순)으로 폴백한다.
    정렬값이 같을 때는 가입순(User.id)으로 tie-break 하여 결과가 안정적으로 나오게 한다.
    extra: created_at/xp 외에 정렬 가능한 집계식(chat_count 등)을 추가로 넘긴다.
    """
    sort_columns = {"created_at": User.id, "xp": User.xp}
    if extra:
        sort_columns.update(extra)
    if sort == "last_active":
        # 사용 기록이 없는 회원은 '오래 안 쓴 순'에선 맨 앞, '최근 사용순'에선 맨 뒤
        if order == "asc":
            return (User.last_active_at.asc().nulls_first(), User.id.asc())
        return (User.last_active_at.desc().nulls_last(), User.id.desc())
    sort_col = sort_columns.get(sort, User.id)
    if order == "asc":
        return (sort_col.asc(), User.id.asc())
    return (sort_col.desc(), User.id.desc())


def _latest_sleep_day_subquery():
    return (
        select(
            DailySleep.user_id.label("user_id"),
            func.max(DailySleep.day).label("day"),
        )
        .group_by(DailySleep.user_id)
        .subquery()
    )


def _latest_steps_day_subquery():
    return (
        select(
            DailySteps.user_id.label("user_id"),
            func.max(DailySteps.day).label("day"),
        )
        .group_by(DailySteps.user_id)
        .subquery()
    )


@router.get("/users", response_model=AdminUserListResponse)
def list_users(
    q: str | None = Query(default=None, description="아이디/닉네임/이메일 부분검색"),
    sort: str = Query(
        default="created_at",
        description="정렬 기준: created_at | xp | chat_count | last_active",
    ),
    order: str = Query(default="desc", description="정렬 방향: asc | desc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> AdminUserListResponse:
    """회원 목록 — 검색어(q)·정렬(sort/order)·페이지네이션 지원. 기본 최신 가입순."""
    filters = _user_search_filters(q)

    total = db.scalar(
        select(func.count()).select_from(User).where(*filters)
    ) or 0

    # 회원별 식단 수·채팅 수를 한 번의 쿼리로 함께 가져온다 (N+1 방지).
    meal_count = func.count(Meal.id).label("meal_count")
    chat_count = _chat_count_expr().label("chat_count")
    latest_sleep = _latest_sleep_day_subquery()
    latest_steps = _latest_steps_day_subquery()
    stmt = (
        select(
            User,
            meal_count,
            chat_count,
            DailySleep.day,
            DailySleep.asleep_minutes,
            DailySteps.day,
            DailySteps.steps,
        )
        .outerjoin(Meal, Meal.user_id == User.id)
        .outerjoin(latest_sleep, latest_sleep.c.user_id == User.id)
        .outerjoin(
            DailySleep,
            (DailySleep.user_id == latest_sleep.c.user_id)
            & (DailySleep.day == latest_sleep.c.day),
        )
        .outerjoin(latest_steps, latest_steps.c.user_id == User.id)
        .outerjoin(
            DailySteps,
            (DailySteps.user_id == latest_steps.c.user_id)
            & (DailySteps.day == latest_steps.c.day),
        )
        .where(*filters)
        .group_by(
            User.id,
            DailySleep.day,
            DailySleep.asleep_minutes,
            DailySteps.day,
            DailySteps.steps,
        )
        .order_by(*_user_order_by(sort, order, {"chat_count": chat_count}))
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    rows = db.execute(stmt).all()

    items = [
        AdminUserListItem(
            id=user.id,
            user_id=user.user_id,
            nickname=user.nickname,
            email=user.email,
            xp=user.xp,
            cp=user.cp,
            is_admin=user.is_admin,
            meal_count=meal_cnt,
            chat_count=chat_cnt,
            last_platform=user.last_platform,
            last_active_at=user.last_active_at,
            last_sleep_day=sleep_day,
            last_asleep_minutes=asleep_minutes,
            last_steps_day=steps_day,
            last_steps=steps,
            created_at=user.created_at,
        )
        for user, meal_cnt, chat_cnt, sleep_day, asleep_minutes, steps_day, steps in rows
    ]

    return AdminUserListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


# users.last_platform → CSV 표기 (관리자 화면의 기기 배지와 같은 이름)
_PLATFORM_LABELS = {"ios": "아이폰", "android": "갤럭시", "web": "웹"}


@router.get("/users/export")
def export_users(
    q: str | None = Query(default=None, description="아이디/닉네임/이메일 부분검색"),
    sort: str = Query(
        default="created_at",
        description="정렬 기준: created_at | xp | chat_count | last_active",
    ),
    order: str = Query(default="desc", description="정렬 방향: asc | desc"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """현재 검색어(q)·정렬(sort/order)을 그대로 반영한 회원 전체를 CSV로 내려준다.

    목록 화면과 동일한 필터/정렬을 쓰되 페이지네이션 없이 매칭되는 전체를 내보낸다.
    """
    meal_count = func.count(Meal.id).label("meal_count")
    chat_count = _chat_count_expr().label("chat_count")
    latest_sleep = _latest_sleep_day_subquery()
    latest_steps = _latest_steps_day_subquery()
    stmt = (
        select(
            User,
            meal_count,
            chat_count,
            DailySleep.day,
            DailySleep.asleep_minutes,
            DailySteps.day,
            DailySteps.steps,
        )
        .outerjoin(Meal, Meal.user_id == User.id)
        .outerjoin(latest_sleep, latest_sleep.c.user_id == User.id)
        .outerjoin(
            DailySleep,
            (DailySleep.user_id == latest_sleep.c.user_id)
            & (DailySleep.day == latest_sleep.c.day),
        )
        .outerjoin(latest_steps, latest_steps.c.user_id == User.id)
        .outerjoin(
            DailySteps,
            (DailySteps.user_id == latest_steps.c.user_id)
            & (DailySteps.day == latest_steps.c.day),
        )
        .where(*_user_search_filters(q))
        .group_by(
            User.id,
            DailySleep.day,
            DailySleep.asleep_minutes,
            DailySteps.day,
            DailySteps.steps,
        )
        .order_by(*_user_order_by(sort, order, {"chat_count": chat_count}))
    )
    rows = db.execute(stmt).all()

    def _iter_csv():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "ID",
                "아이디",
                "닉네임",
                "이메일",
                "식단수",
                "채팅수",
                "XP",
                "CP",
                "관리자",
                "기기",
                "최근 사용 (한국시간)",
                "최근 걸음일",
                "최근 걸음수",
                "최근 수면일(기상일 기준)",
                "최근 수면시간",
                "가입일",
            ]
        )
        for user, meal_cnt, chat_cnt, sleep_day, asleep_minutes, steps_day, steps in rows:
            writer.writerow(
                [
                    user.id,
                    user.user_id,
                    user.nickname or "",
                    user.email or "",
                    meal_cnt,
                    chat_cnt,
                    user.xp,
                    user.cp,
                    "Y" if user.is_admin else "N",
                    _PLATFORM_LABELS.get(user.last_platform or "", ""),
                    user.last_active_at.astimezone(KST).strftime("%Y-%m-%d %H:%M")
                    if user.last_active_at
                    else "",
                    steps_day.isoformat() if steps_day else "",
                    steps if steps is not None else "",
                    sleep_day.isoformat() if sleep_day else "",
                    (
                        f"{asleep_minutes // 60}시간 {asleep_minutes % 60}분"
                        if asleep_minutes is not None
                        else ""
                    ),
                    user.created_at.astimezone(KST).strftime("%Y-%m-%d %H:%M")
                    if user.created_at
                    else "",
                ]
            )
        # Excel이 UTF-8 한글을 깨지 않도록 BOM을 앞에 붙인다.
        yield "﻿" + buf.getvalue()

    filename = f"cheddar_users_{datetime.now(KST).strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        _iter_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# -- 회원 상세 -------------------------------------------------------------

def _get_user_or_404(user_id: int, db: Session) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.get("/users/{user_id}", response_model=AdminUserDetail)
def get_user(user_id: int, db: Session = Depends(get_db)) -> AdminUserDetail:
    user = _get_user_or_404(user_id, db)

    meal_count = db.scalar(
        select(func.count()).select_from(Meal).where(Meal.user_id == user_id)
    ) or 0
    chat_count = db.scalar(
        select(func.count())
        .select_from(ChatMessage)
        .where(ChatMessage.user_id == user_id)
    ) or 0
    points_total = db.scalar(
        select(func.coalesce(func.sum(PointHistory.amount), 0)).where(
            PointHistory.user_id == user_id
        )
    ) or 0

    return AdminUserDetail(
        id=user.id,
        user_id=user.user_id,
        nickname=user.nickname,
        email=user.email,
        profile_image_path=user.profile_image_path,
        age=user.age,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        xp=user.xp,
        cp=user.cp,
        is_admin=user.is_admin,
        last_platform=user.last_platform,
        last_active_at=user.last_active_at,
        created_at=user.created_at,
        meal_count=meal_count,
        chat_count=chat_count,
        points_total=points_total,
        deleted_at=user.deleted_at,
    )


@router.post("/users/{user_id}/withdraw", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> None:
    """관리자가 회원을 탈퇴시킨다 — 본인 탈퇴와 똑같이 '익명화'(anonymize_user).

    되돌릴 수 없다. 기록(식단·설문·채팅·포인트)은 익명으로 남고, 개인정보·사진·건강 데이터는 지워진다.
    그 회원의 남은 로그인은 deleted_at 때문에 다음 요청부터 막힌다.
    """
    user = _get_user_or_404(user_id, db)
    if user.id == admin.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "내 계정은 여기서 탈퇴할 수 없어요. 앱의 설정 화면에서 해 주세요.",
        )
    if user.deleted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 탈퇴한 회원이에요.")
    anonymize_user(db, user)


@router.get("/users/{user_id}/meals", response_model=list[MealOut])
def get_user_meals(
    user_id: int,
    date_from: DateType | None = Query(default=None, alias="from"),
    date_to: DateType | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
) -> list[Meal]:
    """특정 회원의 식단 기록 — 최신순. from/to 로 날짜 범위 필터."""
    _get_user_or_404(user_id, db)
    stmt = select(Meal).where(Meal.user_id == user_id)
    if date_from:
        stmt = stmt.where(Meal.eaten_on >= date_from)
    if date_to:
        stmt = stmt.where(Meal.eaten_on <= date_to)
    stmt = stmt.order_by(Meal.eaten_on.desc(), Meal.created_at.desc())
    return list(db.execute(stmt).scalars())


@router.get("/users/{user_id}/chat-messages", response_model=list[ChatMessageOut])
def get_user_chat(
    user_id: int,
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[ChatMessage]:
    """특정 회원의 채팅 내역 — 오래된 순(읽기 좋게). 최근 limit개."""
    _get_user_or_404(user_id, db)
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.id.desc())
        .limit(limit)
    )
    rows = list(db.execute(stmt).scalars())
    rows.reverse()
    return rows


@router.get(
    "/users/{user_id}/survey-responses",
    response_model=list[AdminSurveyResponseItem],
)
def get_user_survey_responses(
    user_id: int,
    include_in_progress: bool = Query(
        default=False,
        description="True 면 미완료(in_progress) 응답도 포함. 기본은 완료분만.",
    ),
    db: Session = Depends(get_db),
) -> list[AdminSurveyResponseItem]:
    """특정 회원의 설문 응답 원본(answers + derived_flags) — 최신 완료순.

    SurveySchema 와 조인해 응답이 어떤 설문 버전인지(schema_version)도 함께
    내려준다. 기본은 완료(completed)된 응답만; include_in_progress=True 면
    진행 중 응답도 포함한다(정렬은 completed_at, 없으면 started_at 기준).
    """
    _get_user_or_404(user_id, db)
    stmt = (
        select(SurveyResponse, SurveySchema.version)
        .join(SurveySchema, SurveySchema.id == SurveyResponse.schema_id)
        .where(SurveyResponse.user_id == user_id)
    )
    if not include_in_progress:
        stmt = stmt.where(
            SurveyResponse.status == SurveyResponseStatus.COMPLETED
        )
    stmt = stmt.order_by(
        func.coalesce(
            SurveyResponse.completed_at, SurveyResponse.started_at
        ).desc()
    )
    return [
        AdminSurveyResponseItem(
            id=resp.id,
            schema_version=version,
            kind=resp.kind.value,
            status=resp.status.value,
            current_section=resp.current_section,
            answers=resp.answers or {},
            derived_flags=resp.derived_flags or {},
            started_at=resp.started_at,
            updated_at=resp.updated_at,
            completed_at=resp.completed_at,
        )
        for resp, version in db.execute(stmt).all()
    ]


@router.get("/users/{user_id}/health", response_model=AdminUserHealth)
def get_user_health(
    user_id: int,
    days: int = Query(default=30, ge=1, le=180),
    db: Session = Depends(get_db),
) -> AdminUserHealth:
    """특정 회원의 최근 days일(KST 오늘 포함) 걸음수·수면 — 최신 날짜부터.

    기록이 없는 날도 빈 줄로 넣어, 측정이 빠진 날이 표에서 바로 보이게 한다.
    수면 day 는 '일어난 날' 기준(앱 업로드 규칙과 같음).
    """
    _get_user_or_404(user_id, db)
    today = datetime.now(KST).date()
    start = today - timedelta(days=days - 1)

    steps = {
        r.day: r
        for r in db.execute(
            select(DailySteps).where(
                DailySteps.user_id == user_id,
                DailySteps.day >= start,
                DailySteps.day <= today,
            )
        ).scalars()
    }
    sleep = {
        r.day: r
        for r in db.execute(
            select(DailySleep).where(
                DailySleep.user_id == user_id,
                DailySleep.day >= start,
                DailySleep.day <= today,
            )
        ).scalars()
    }

    rows: list[AdminHealthDay] = []
    for i in range(days):
        d = today - timedelta(days=i)
        st, sl = steps.get(d), sleep.get(d)
        rows.append(
            AdminHealthDay(
                day=d,
                steps=st.steps if st else None,
                steps_source=st.source if st else None,
                asleep_minutes=sl.asleep_minutes if sl else None,
                bed_start=sl.bed_start if sl else None,
                wake_end=sl.wake_end if sl else None,
                sleep_source=sl.source if sl else None,
                sleep_updated_at=sl.updated_at if sl else None,
            )
        )

    synced = [r.updated_at for r in [*steps.values(), *sleep.values()] if r.updated_at]
    return AdminUserHealth(
        days=rows,
        steps_days=len(steps),
        sleep_days=len(sleep),
        avg_steps=round(sum(r.steps for r in steps.values()) / len(steps)) if steps else None,
        avg_asleep_minutes=(
            round(sum(r.asleep_minutes for r in sleep.values()) / len(sleep)) if sleep else None
        ),
        last_synced_at=max(synced) if synced else None,
    )


SLEEP_ODD_SHORT_MIN = 180  # 3시간 미만 — 측정이 중간에 끊겼을 가능성
SLEEP_ODD_LONG_MIN = 720  # 12시간 초과 — 깨어 있던 시간이 잠으로 잡혔을 가능성


@router.get("/health/overview", response_model=AdminHealthOverview)
def health_overview(
    days: int = Query(default=14, ge=1, le=90),
    db: Session = Depends(get_db),
) -> AdminHealthOverview:
    """건강 데이터(걸음·수면)가 잘 들어오는지 — 날짜별·출처별 집계 + 회원별 마지막 수신.

    (user, day) 당 한 행이라 출처별 회원 수를 더하면 그날 전체 회원 수가 된다.
    수면 day 는 '일어난 날' 기준(KST 오늘 = 어젯밤 잠).
    """
    today = datetime.now(KST).date()
    start = today - timedelta(days=days - 1)
    week_start = today - timedelta(days=6)

    def _daily(model, value_col, odd_expr=None):
        cols = [model.day, model.source, func.count(), func.avg(value_col)]
        if odd_expr is not None:
            cols.append(func.sum(case((odd_expr, 1), else_=0)))
        rows = db.execute(
            select(*cols)
            .where(model.day >= start, model.day <= today)
            .group_by(model.day, model.source)
        ).all()
        out: dict = {}
        for r in rows:
            d = out.setdefault(r[0], {"by": {}, "sum": 0.0, "n": 0, "odd": 0})
            d["by"][r[1] or "unknown"] = r[2]
            d["sum"] += float(r[3] or 0) * r[2]
            d["n"] += r[2]
            if odd_expr is not None:
                d["odd"] += int(r[4] or 0)
        return out

    steps_daily = _daily(DailySteps, DailySteps.steps)
    sleep_daily = _daily(
        DailySleep,
        DailySleep.asleep_minutes,
        or_(
            DailySleep.asleep_minutes < SLEEP_ODD_SHORT_MIN,
            DailySleep.asleep_minutes > SLEEP_ODD_LONG_MIN,
        ),
    )

    daily: list[AdminHealthDailyRow] = []
    for i in range(days):
        d = today - timedelta(days=i)
        st = steps_daily.get(d, {"by": {}, "sum": 0.0, "n": 0, "odd": 0})
        sl = sleep_daily.get(d, {"by": {}, "sum": 0.0, "n": 0, "odd": 0})
        daily.append(
            AdminHealthDailyRow(
                day=d,
                steps_users=st["n"],
                steps_by_source=st["by"],
                avg_steps=round(st["sum"] / st["n"]) if st["n"] else None,
                sleep_users=sl["n"],
                sleep_by_source=sl["by"],
                avg_asleep_minutes=round(sl["sum"] / sl["n"]) if sl["n"] else None,
                odd_sleep_count=sl["odd"],
            )
        )

    def _per_user(model):
        last = (
            select(model.user_id.label("uid"), func.max(model.day).label("last_day"))
            .group_by(model.user_id)
            .subquery()
        )
        latest = {
            r.user_id: (r.day, r.source)
            for r in db.execute(
                select(model.user_id, model.day, model.source).join(
                    last, (model.user_id == last.c.uid) & (model.day == last.c.last_day)
                )
            )
        }
        week = dict(
            db.execute(
                select(model.user_id, func.count())
                .where(model.day >= week_start, model.day <= today)
                .group_by(model.user_id)
            ).all()
        )
        synced = dict(
            db.execute(
                select(model.user_id, func.max(model.updated_at)).group_by(model.user_id)
            ).all()
        )
        return latest, week, synced

    st_last, st_week, st_sync = _per_user(DailySteps)
    sl_last, sl_week, sl_sync = _per_user(DailySleep)
    user_ids = set(st_last) | set(sl_last)

    users: list[AdminHealthUserRow] = []
    if user_ids:
        for u in db.execute(
            select(User).where(User.id.in_(user_ids), User.deleted_at.is_(None))
        ).scalars():
            st, sl = st_last.get(u.id), sl_last.get(u.id)
            synced = [t for t in (st_sync.get(u.id), sl_sync.get(u.id)) if t]
            users.append(
                AdminHealthUserRow(
                    id=u.id,
                    user_id=u.user_id,
                    nickname=u.nickname,
                    last_steps_day=st[0] if st else None,
                    last_steps_source=st[1] if st else None,
                    steps_days_7d=st_week.get(u.id, 0),
                    last_sleep_day=sl[0] if sl else None,
                    last_sleep_source=sl[1] if sl else None,
                    sleep_days_7d=sl_week.get(u.id, 0),
                    last_synced_at=max(synced) if synced else None,
                )
            )

    def _latest_day(r: AdminHealthUserRow) -> DateType:
        days_ = [d for d in (r.last_steps_day, r.last_sleep_day) if d]
        return max(days_) if days_ else DateType.min

    users.sort(key=lambda r: (_latest_day(r), r.id))  # 가장 오래 끊긴 회원부터
    return AdminHealthOverview(today=today, daily=daily, users=users)


@router.get("/users/{user_id}/points", response_model=list[PointHistoryItem])
def get_user_points(
    user_id: int,
    db: Session = Depends(get_db),
) -> list[PointHistory]:
    """특정 회원의 포인트 적립 내역 — 최신순."""
    _get_user_or_404(user_id, db)
    stmt = (
        select(PointHistory)
        .where(PointHistory.user_id == user_id)
        .order_by(PointHistory.id.desc())
    )
    return list(db.execute(stmt).scalars())


# -- 보상(현금) 지급 관리 ---------------------------------------------------

def _claim_to_item(claim: RewardClaim, user: User) -> AdminRewardClaimItem:
    """(신청, 신청자) → 관리자 목록용 1줄."""
    return AdminRewardClaimItem(
        id=claim.id,
        user_id=claim.user_id,
        user_login_id=user.user_id,
        nickname=user.nickname,
        status=claim.status,
        amount=claim.amount,
        level_at_claim=claim.level_at_claim,
        xp_at_claim=claim.xp_at_claim,
        requested_at=claim.requested_at,
        processed_at=claim.processed_at,
        admin_note=claim.admin_note,
    )


@router.get("/reward-claims", response_model=AdminRewardClaimListResponse)
def list_reward_claims(
    status_filter: RewardClaimStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> AdminRewardClaimListResponse:
    """현금 보상 신청 목록 — 오래된 신청 순(먼저 신청한 사람 먼저 지급).

    `status` 쿼리로 대기(pending)/지급완료(paid)/반려(rejected)만 골라 볼 수
    있다. counts 는 상태별 전체 건수(필터와 무관) — 상단 요약 배지용.
    """
    stmt = (
        select(RewardClaim, User)
        .join(User, RewardClaim.user_id == User.id)
        .order_by(RewardClaim.requested_at.asc())
    )
    if status_filter is not None:
        stmt = stmt.where(RewardClaim.status == status_filter)
    rows = db.execute(stmt).all()
    items = [_claim_to_item(claim, user) for claim, user in rows]

    # 상태별 전체 건수(필터 미적용) — 누락 상태는 0 으로 채운다.
    counts = {s.value: 0 for s in RewardClaimStatus}
    count_rows = db.execute(
        select(RewardClaim.status, func.count())
        .group_by(RewardClaim.status)
    ).all()
    for st, n in count_rows:
        counts[st.value] = n

    return AdminRewardClaimListResponse(
        items=items, total=len(items), counts=counts
    )


@router.patch(
    "/reward-claims/{claim_id}", response_model=AdminRewardClaimItem
)
def update_reward_claim(
    claim_id: int,
    body: AdminRewardClaimUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> AdminRewardClaimItem:
    """신청을 지급완료(paid) 또는 반려(rejected)로 처리한다.

    - pending 으로 되돌리는 요청은 400.
    - 처리 시각·처리한 관리자를 기록한다(누가 언제 지급했는지 추적).
    """
    if body.status == RewardClaimStatus.PENDING:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "cannot_set_pending"
        )

    claim = db.get(RewardClaim, claim_id)
    if claim is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "claim_not_found")

    claim.status = body.status
    if body.admin_note is not None:
        claim.admin_note = body.admin_note
    claim.processed_at = datetime.now(timezone.utc)
    claim.processed_by_id = admin.id
    db.commit()
    db.refresh(claim)

    user = db.get(User, claim.user_id)
    return _claim_to_item(claim, user)


# -- 문의하기 (Inquiry) -----------------------------------------------------
# 사용자가 '설정 > 문의하기'에서 남긴 문의를 관리자가 확인하고 처리완료로 표시한다.

def _inquiry_out(inq: Inquiry, user: User) -> InquiryOut:
    """문의 + 작성자 User → 관리자 화면용 응답으로 변환."""
    return InquiryOut(
        id=inq.id,
        user_id=inq.user_id,
        account_id=user.user_id,
        nickname=user.nickname,
        content=inq.content,
        is_resolved=inq.is_resolved,
        created_at=inq.created_at,
    )


@router.get("/inquiries", response_model=list[InquiryOut])
def list_inquiries(
    status_filter: str = Query(
        default="open",
        alias="status",
        description="open(미처리) | resolved(처리완료) | all",
    ),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[InquiryOut]:
    """문의 목록 — 기본은 미처리, 최신순."""
    stmt = select(Inquiry, User).join(User, User.id == Inquiry.user_id)
    if status_filter == "open":
        stmt = stmt.where(Inquiry.is_resolved.is_(False))
    elif status_filter == "resolved":
        stmt = stmt.where(Inquiry.is_resolved.is_(True))
    stmt = stmt.order_by(Inquiry.created_at.desc()).limit(limit)
    return [_inquiry_out(inq, user) for inq, user in db.execute(stmt).all()]


@router.patch("/inquiries/{inquiry_id}", response_model=InquiryOut)
def update_inquiry(
    inquiry_id: int,
    body: InquiryResolveRequest,
    db: Session = Depends(get_db),
) -> InquiryOut:
    """문의 처리 상태 변경(처리완료 / 미처리)."""
    inq = db.get(Inquiry, inquiry_id)
    if inq is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Inquiry not found")
    inq.is_resolved = body.is_resolved
    db.commit()
    db.refresh(inq)
    user = db.get(User, inq.user_id)
    return _inquiry_out(inq, user)


# -- 초대코드 --------------------------------------------------------------

# 코드 자동 생성용 문자 집합 — 카톡으로 받은 코드를 손으로 옮겨 치는 상황이라
# 헷갈리는 글자(O/0, I/1/L)를 빼서 오타를 줄인다.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _generate_code() -> str:
    """CHEDDAR-A3F9 형태의 무작위 코드를 만든다."""
    body = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))
    tail = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))
    return f"{body}-{tail}"


def _invite_out(invite: InviteCode, now: datetime) -> AdminInviteCodeItem:
    return AdminInviteCodeItem(
        id=invite.id,
        code=invite.code,
        label=invite.label,
        max_uses=invite.max_uses,
        used_count=invite.used_count,
        remaining=invite.remaining(),
        expires_at=invite.expires_at,
        is_active=invite.is_active,
        created_at=invite.created_at,
        usable=invite.unusable_reason(now) is None,
    )


@router.get("/invite-codes", response_model=list[AdminInviteCodeItem])
def list_invite_codes(db: Session = Depends(get_db)) -> list[AdminInviteCodeItem]:
    """초대코드 목록 — 최신 발급 순."""
    now = datetime.now(timezone.utc)
    codes = (
        db.execute(select(InviteCode).order_by(InviteCode.created_at.desc()))
        .scalars()
        .all()
    )
    return [_invite_out(c, now) for c in codes]


@router.post(
    "/invite-codes",
    response_model=AdminInviteCodeItem,
    status_code=status.HTTP_201_CREATED,
)
def create_invite_code(
    body: AdminInviteCodeCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> AdminInviteCodeItem:
    """초대코드 발급. code 를 비우면 무작위로 만들어 준다."""
    raw = (body.code or "").strip() or _generate_code()
    code = normalize_code(raw)
    if not 4 <= len(code) <= 40:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "코드는 4~40자로 입력해주세요."
        )
    if body.max_uses is not None and body.max_uses < 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "인원 제한은 1 이상이어야 합니다."
        )

    exists = (
        db.execute(select(InviteCode.id).where(InviteCode.code == code)).first()
        is not None
    )
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 있는 코드입니다.")

    invite = InviteCode(
        code=code,
        label=body.label,
        max_uses=body.max_uses,
        expires_at=body.expires_at,
        created_by_user_id=admin.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return _invite_out(invite, datetime.now(timezone.utc))


@router.patch("/invite-codes/{invite_id}", response_model=AdminInviteCodeItem)
def update_invite_code(
    invite_id: int,
    body: AdminInviteCodeUpdateRequest,
    db: Session = Depends(get_db),
) -> AdminInviteCodeItem:
    """초대코드 수정 — 보낸 필드만 반영한다(유출 시 is_active=false 로 즉시 차단).

    exclude_unset 을 쓰는 이유: max_uses 를 null 로 보내 '무제한으로 바꾸기'와
    아예 안 보내 '그대로 두기'를 구분해야 하기 때문이다.
    """
    invite = db.get(InviteCode, invite_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite code not found")

    changes = body.model_dump(exclude_unset=True)
    if "max_uses" in changes and changes["max_uses"] is not None:
        if changes["max_uses"] < 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "인원 제한은 1 이상이어야 합니다."
            )
    for field, value in changes.items():
        setattr(invite, field, value)

    db.commit()
    db.refresh(invite)
    return _invite_out(invite, datetime.now(timezone.utc))

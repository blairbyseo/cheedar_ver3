import csv
import io
from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_admin
from app.models.chat import ChatMessage, ChatRole
from app.models.inquiry import Inquiry
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
    AdminSurveyResponseItem,
    AdminUserDetail,
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


# -- 대시보드 ---------------------------------------------------------------

@router.get("/stats/dashboard", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    """상단 요약 카드용 숫자들을 한 번에 모아 돌려준다."""
    today = datetime.now(KST).date()

    total_users = db.scalar(select(func.count()).select_from(User)) or 0
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

    return DashboardStats(
        total_users=total_users,
        admin_count=admin_count,
        today_meals=today_meals,
        today_chat_messages=today_chat_messages,
        total_chat_messages=total_chat_messages,
        total_points_awarded=total_points_awarded,
        unresolved_safety_count=unresolved_safety_count,
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
    """검색어(q)를 아이디/닉네임/이메일 부분검색 필터로 변환."""
    if not q:
        return []
    like = f"%{q.strip()}%"
    return [
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
    sort_col = sort_columns.get(sort, User.id)
    if order == "asc":
        return (sort_col.asc(), User.id.asc())
    return (sort_col.desc(), User.id.desc())


@router.get("/users", response_model=AdminUserListResponse)
def list_users(
    q: str | None = Query(default=None, description="아이디/닉네임/이메일 부분검색"),
    sort: str = Query(
        default="created_at",
        description="정렬 기준: created_at | xp | chat_count",
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
    stmt = (
        select(User, meal_count, chat_count)
        .outerjoin(Meal, Meal.user_id == User.id)
        .where(*filters)
        .group_by(User.id)
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
            created_at=user.created_at,
        )
        for user, meal_cnt, chat_cnt in rows
    ]

    return AdminUserListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/users/export")
def export_users(
    q: str | None = Query(default=None, description="아이디/닉네임/이메일 부분검색"),
    sort: str = Query(
        default="created_at",
        description="정렬 기준: created_at | xp | chat_count",
    ),
    order: str = Query(default="desc", description="정렬 방향: asc | desc"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """현재 검색어(q)·정렬(sort/order)을 그대로 반영한 회원 전체를 CSV로 내려준다.

    목록 화면과 동일한 필터/정렬을 쓰되 페이지네이션 없이 매칭되는 전체를 내보낸다.
    """
    meal_count = func.count(Meal.id).label("meal_count")
    chat_count = _chat_count_expr().label("chat_count")
    stmt = (
        select(User, meal_count, chat_count)
        .outerjoin(Meal, Meal.user_id == User.id)
        .where(*_user_search_filters(q))
        .group_by(User.id)
        .order_by(*_user_order_by(sort, order, {"chat_count": chat_count}))
    )
    rows = db.execute(stmt).all()

    def _iter_csv():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            ["ID", "아이디", "닉네임", "이메일", "식단수", "채팅수", "XP", "CP", "관리자", "가입일"]
        )
        for user, meal_cnt, chat_cnt in rows:
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
        created_at=user.created_at,
        meal_count=meal_count,
        chat_count=chat_count,
        points_total=points_total,
    )


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

"""설문(Survey) API 라우터.

엔드포인트 (모두 인증 필요):
  GET   /api/survey/next             활성 스키마 + (있다면) in_progress 응답 + prefill
  PATCH /api/survey/{id}/progress    섹션 종료마다 부분 저장
  POST  /api/survey/{id}/submit      최종 제출 → derived_flags 계산 + User 갱신 + SafetyEvent

권한: 모든 엔드포인트는 current_user 기준. /{id}/* 는 응답 소유자만 접근 가능.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.survey import SurveyResponse, SurveyResponseStatus
from app.models.user import User
from app.schemas.survey import (
    SurveyNextResponse,
    SurveyProgressRequest,
    SurveyProgressResponse,
    SurveySubmitResponse,
)
from app.services.survey.service import (
    build_prefilled_answers,
    compute_survey_due,
    finalize_submission,
    get_active_schema,
    get_or_create_in_progress,
    merge_partial_answers,
)

router = APIRouter(prefix="/api/survey", tags=["survey"])


# ---------- 내부 헬퍼 ----------

def _load_owned_response(
    db: Session, response_id: int, current_user: User
) -> SurveyResponse:
    """응답 조회 + 소유권 검증. 없거나 다른 사용자 소유면 404."""
    response = db.get(SurveyResponse, response_id)
    if response is None or response.user_id != current_user.id:
        # 존재 여부 누설 방지 위해 동일 메시지
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="survey_response_not_found"
        )
    return response


# ---------- 엔드포인트 ----------

@router.get("/next", response_model=SurveyNextResponse)
def get_next_survey(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyNextResponse:
    """현재 사용자에게 띄울 설문을 반환한다.

    - due 가 None 이면 띄울 설문 없음.
    - in_progress 가 있으면 그것을 이어쓰기 대상으로 반환, 없으면 새로 생성.
    - prefilled_answers 는 회원가입에서 이미 받은 값(A-1, B-1).
    """
    due = compute_survey_due(db, current_user)
    if due is None:
        return SurveyNextResponse(due=None)

    schema = get_active_schema(db)
    if schema is None:
        # 트리거는 떴는데 활성 스키마가 사라진 비정상 케이스
        return SurveyNextResponse(due=None)

    response = get_or_create_in_progress(db, current_user, schema, due)
    prefilled = build_prefilled_answers(db, current_user)

    return SurveyNextResponse(
        due=due,
        response_id=response.id,
        schema_id=schema.id,
        schema_version=schema.version,
        schema_json=schema.schema_json,
        current_section=response.current_section,
        answers=response.answers or {},
        prefilled_answers=prefilled,
    )


@router.patch("/{response_id}/progress", response_model=SurveyProgressResponse)
def save_progress(
    response_id: int,
    body: SurveyProgressRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyProgressResponse:
    """진행 중 응답을 부분 저장. answers 는 기존 위에 update merge."""
    response = _load_owned_response(db, response_id, current_user)
    if response.status != SurveyResponseStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="survey_response_not_in_progress",
        )
    response = merge_partial_answers(db, response, body.answers, body.current_section)
    return SurveyProgressResponse(
        response_id=response.id,
        current_section=response.current_section,
        updated_at=response.updated_at,
    )


@router.post("/{response_id}/submit", response_model=SurveySubmitResponse)
def submit_survey(
    response_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveySubmitResponse:
    """제출 → derived_flags 계산 + User.onboarded / last_survey_at 갱신 + SafetyEvent."""
    response = _load_owned_response(db, response_id, current_user)
    if response.status != SurveyResponseStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="survey_response_already_submitted",
        )
    response = finalize_submission(db, current_user, response)
    return SurveySubmitResponse(
        response_id=response.id,
        derived_flags=response.derived_flags or {},
        completed_at=response.completed_at,
    )

"""설문(Survey) 모델 — 스키마 버전 관리 + 사용자 응답 인스턴스.

Cheddar_Team_26 의 SQLModel 정의를 이 프로젝트(순수 SQLAlchemy 2.0) 스타일로
옮긴 것. 테이블명은 우리 컨벤션(snake_case 복수형)을 따른다:
surveyschema → survey_schemas, surveyresponse → survey_responses.

postgres 전용(JSONB) — schema_json/answers/derived_flags 는 JSONB 컬럼이다.
"""
import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SurveyKind(str, enum.Enum):
    """설문 트리거 유형.

    onboarding: 회원가입 직후 1회.
    recurring: 활성 스키마의 trigger_interval_days 마다 로그인 시.
    """

    ONBOARDING = "onboarding"
    RECURRING = "recurring"


class SurveyResponseStatus(str, enum.Enum):
    """설문 응답 진행 상태.

    in_progress: 시작했지만 미완료(이어서 하기 대상).
    completed: 제출 완료 — derived_flags 계산 후 last_survey_at 갱신됨.
    abandoned: (예약) 새 설문 트리거 시 이전 in_progress 폐기용.
    """

    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


# 값 저장 규칙: enum 멤버 NAME 이 아니라 VALUE("onboarding" 등)를 DB에 저장한다.
# 마이그레이션에서 만든 enum 타입 값과 일치시키기 위함.
_kind_enum = Enum(
    SurveyKind,
    name="survey_kind",
    values_callable=lambda obj: [e.value for e in obj],
)
_status_enum = Enum(
    SurveyResponseStatus,
    name="survey_response_status",
    values_callable=lambda obj: [e.value for e in obj],
)


class SurveySchema(Base):
    """설문 스키마(섹션·문항·분기 규칙)의 버전 관리 테이블.

    schema_json 에 sections[].questions[] 와 branching DSL 을 모두 담는다.
    관리자가 문항 텍스트/옵션/트리거 주기를 코드 변경 없이 바꿀 수 있게 하는
    핵심 테이블이다.

    - is_active: True 인 row 는 한 시점에 1개만(애플리케이션 레벨에서 보장).
    - trigger_interval_days: 재설문 주기(일).
    - schema_json: `app/services/survey/{version}_schema.json` 구조 그대로.
      scoring_module 키로 derived_flags 계산 모듈을 지정한다.
    """

    __tablename__ = "survey_schemas"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), index=True
    )
    trigger_interval_days: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("14")
    )
    schema_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SurveyResponse(Base):
    """한 사용자의 한 설문 응답 인스턴스.

    - in_progress 상태에서 answers(JSONB)에 부분 저장 후 재방문 시 이어쓰기.
    - 제출(submit) 시 derived_flags 계산 + User.onboarded / last_survey_at 갱신.
    - answers: {"A-1": 16, "B-1b-1": 7, "C-10": {"rows": {...}}, ...}
      — question_id → 응답 매핑.
    - derived_flags: scoring 모듈 결과(phq2_sum, suicide_screen, bmi_category,
      anorexia_candidate, purging_flag, readiness_stage 등).
    """

    __tablename__ = "survey_responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    schema_id: Mapped[int] = mapped_column(
        ForeignKey("survey_schemas.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[SurveyKind] = mapped_column(_kind_enum, nullable=False)
    status: Mapped[SurveyResponseStatus] = mapped_column(
        _status_enum,
        nullable=False,
        server_default=SurveyResponseStatus.IN_PROGRESS.value,
        index=True,
    )
    current_section: Mapped[str | None] = mapped_column(String(40), nullable=True)
    answers: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    derived_flags: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

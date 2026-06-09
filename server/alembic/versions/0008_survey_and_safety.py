"""survey + safety tables (+ user.onboarded/last_survey_at) and seed v3 schema

survey_schemas / survey_responses / safety_events 테이블을 만들고, users 에
onboarded / last_survey_at 컬럼을 더한다. 마지막으로 v3 설문 스키마(JSON
파일)를 survey_schemas 에 활성 상태로 시드한다.

postgres 전용(JSONB) — SQLite 로컬 테스트 금지.

Revision ID: 0008_survey_and_safety
Revises: 0007_user_is_admin
Create Date: 2026-06-09

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.services.survey.loader import load_schema

revision: str = "0008_survey_and_safety"
down_revision: str | Sequence[str] | None = "0007_user_is_admin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_KIND_VALUES = ("onboarding", "recurring")
_KIND_ENUM = "survey_kind"

_STATUS_VALUES = ("in_progress", "completed", "abandoned")
_STATUS_ENUM = "survey_response_status"

_RISK_VALUES = ("low", "medium", "high", "critical")
_RISK_ENUM = "risk_level"


def upgrade() -> None:
    # 1) users 컬럼 추가 (기존 사용자는 onboarded=False / last_survey_at=NULL)
    op.add_column(
        "users",
        sa.Column(
            "onboarded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "users",
        sa.Column("last_survey_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 2) Enum 타입은 column 정의 시점에 SQLAlchemy 가 자동 생성하도록 위임.
    #    (별도 .create() + column 양쪽 등록 시 중복 CREATE 로 DuplicateObject 발생)
    kind_enum = sa.Enum(*_KIND_VALUES, name=_KIND_ENUM)
    status_enum = sa.Enum(*_STATUS_VALUES, name=_STATUS_ENUM)
    risk_enum = sa.Enum(*_RISK_VALUES, name=_RISK_ENUM)

    # 3) survey_schemas
    op.create_table(
        "survey_schemas",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("version", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "trigger_interval_days",
            sa.Integer(),
            nullable=False,
            server_default="14",
        ),
        sa.Column("schema_json", JSONB(), nullable=False),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_survey_schemas_version", "survey_schemas", ["version"], unique=True
    )
    op.create_index(
        "ix_survey_schemas_is_active", "survey_schemas", ["is_active"]
    )

    # 4) survey_responses
    op.create_table(
        "survey_responses",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "schema_id",
            sa.Integer(),
            sa.ForeignKey("survey_schemas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", kind_enum, nullable=False),
        sa.Column(
            "status",
            status_enum,
            nullable=False,
            server_default="in_progress",
        ),
        sa.Column("current_section", sa.String(length=40), nullable=True),
        sa.Column(
            "answers", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "derived_flags",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_survey_responses_user_id", "survey_responses", ["user_id"]
    )
    op.create_index(
        "ix_survey_responses_schema_id", "survey_responses", ["schema_id"]
    )
    op.create_index(
        "ix_survey_responses_status", "survey_responses", ["status"]
    )
    # admin/유저별 최근 완료 조회용
    op.create_index(
        "ix_survey_responses_user_completed",
        "survey_responses",
        ["user_id", "completed_at"],
    )

    # 5) safety_events (관리자 위험 모니터링용)
    op.create_table(
        "safety_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            sa.Integer(),
            sa.ForeignKey("chat_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("risk_level", risk_enum, nullable=False),
        sa.Column("detected_category", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("risk_score", sa.Integer(), nullable=True),
        sa.Column("ai_score", sa.Float(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'unresolved'"),
        ),
        sa.Column(
            "is_resolved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_safety_events_user_id", "safety_events", ["user_id"])
    op.create_index(
        "ix_safety_events_created_at", "safety_events", ["created_at"]
    )

    # 6) v3 스키마 시드 (JSON 파일에서 로드, 활성 상태로 1건)
    schema_dict = load_schema("v3")
    op.bulk_insert(
        sa.table(
            "survey_schemas",
            sa.column("version", sa.String()),
            sa.column("name", sa.String()),
            sa.column("description", sa.Text()),
            sa.column("is_active", sa.Boolean()),
            sa.column("trigger_interval_days", sa.Integer()),
            sa.column("schema_json", JSONB()),
        ),
        [
            {
                "version": schema_dict["version"],
                "name": schema_dict["name"],
                "description": schema_dict.get("description"),
                "is_active": True,
                "trigger_interval_days": 14,
                "schema_json": schema_dict,
            }
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_safety_events_created_at", table_name="safety_events")
    op.drop_index("ix_safety_events_user_id", table_name="safety_events")
    op.drop_table("safety_events")

    op.drop_index(
        "ix_survey_responses_user_completed", table_name="survey_responses"
    )
    op.drop_index("ix_survey_responses_status", table_name="survey_responses")
    op.drop_index("ix_survey_responses_schema_id", table_name="survey_responses")
    op.drop_index("ix_survey_responses_user_id", table_name="survey_responses")
    op.drop_table("survey_responses")

    op.drop_index("ix_survey_schemas_is_active", table_name="survey_schemas")
    op.drop_index("ix_survey_schemas_version", table_name="survey_schemas")
    op.drop_table("survey_schemas")

    bind = op.get_bind()
    sa.Enum(name=_RISK_ENUM).drop(bind, checkfirst=True)
    sa.Enum(name=_STATUS_ENUM).drop(bind, checkfirst=True)
    sa.Enum(name=_KIND_ENUM).drop(bind, checkfirst=True)

    op.drop_column("users", "last_survey_at")
    op.drop_column("users", "onboarded")

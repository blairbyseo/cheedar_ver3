"""reward_claims table (최종 레벨 현금 보상 신청·지급 기록)

reward_claims 테이블과 reward_claim_status enum 을 만든다. 사용자가 최종
레벨에 도달해 현금 보상을 '신청'하면 pending 행이 생기고, 관리자가 실제
송금 후 paid 로 표시한다. (user_id, kind) 유니크로 1인 1회 신청을 보장.

postgres 전용.

Revision ID: 0009_reward_claims
Revises: 0008_survey_and_safety
Create Date: 2026-06-09

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_reward_claims"
down_revision: str | Sequence[str] | None = "0008_survey_and_safety"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_STATUS_VALUES = ("pending", "paid", "rejected")
_STATUS_ENUM = "reward_claim_status"


def upgrade() -> None:
    # Enum 타입은 column 정의 시점에 SQLAlchemy 가 자동 생성하도록 위임
    # (0008 과 동일 — 별도 .create() 와 중복되면 DuplicateObject).
    status_enum = sa.Enum(*_STATUS_VALUES, name=_STATUS_ENUM)

    op.create_table(
        "reward_claims",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("level_at_claim", sa.Integer(), nullable=False),
        sa.Column("xp_at_claim", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column(
            "status", status_enum, nullable=False, server_default="pending"
        ),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "processed_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "user_id", "kind", name="uq_reward_claim_user_kind"
        ),
    )
    op.create_index("ix_reward_claims_user_id", "reward_claims", ["user_id"])
    op.create_index("ix_reward_claims_status", "reward_claims", ["status"])
    op.create_index(
        "ix_reward_claims_requested_at", "reward_claims", ["requested_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_reward_claims_requested_at", table_name="reward_claims")
    op.drop_index("ix_reward_claims_status", table_name="reward_claims")
    op.drop_index("ix_reward_claims_user_id", table_name="reward_claims")
    op.drop_table("reward_claims")

    bind = op.get_bind()
    sa.Enum(name=_STATUS_ENUM).drop(bind, checkfirst=True)

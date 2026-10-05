"""motivation_checks (주 1회 동기 점검: 중요도·자신감 + 선택 몸무게)

Revision ID: 0020_motivation_checks
Revises: 0019_weekly_feedbacks
Create Date: 2026-10-05
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_motivation_checks"
down_revision: str | Sequence[str] | None = "0019_weekly_feedbacks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "motivation_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("confidence", sa.Integer(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_motivation_checks_user_id"), "motivation_checks", ["user_id"]
    )
    op.create_index(
        op.f("ix_motivation_checks_created_at"), "motivation_checks", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_motivation_checks_created_at"), table_name="motivation_checks")
    op.drop_index(op.f("ix_motivation_checks_user_id"), table_name="motivation_checks")
    op.drop_table("motivation_checks")

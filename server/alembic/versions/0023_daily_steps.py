"""daily_steps (스마트폰 건강 데이터 걸음수 — 하루 1행, 맥락용)

Revision ID: 0023_daily_steps
Revises: 0022_apple_login_ai_consent
Create Date: 2026-10-19
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_daily_steps"
down_revision: str | Sequence[str] | None = "0022_apple_login_ai_consent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_steps",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="health_connect"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "day", name="uq_daily_steps_user_day"),
    )
    op.create_index(op.f("ix_daily_steps_user_id"), "daily_steps", ["user_id"])
    op.create_index(op.f("ix_daily_steps_day"), "daily_steps", ["day"])


def downgrade() -> None:
    op.drop_index(op.f("ix_daily_steps_day"), table_name="daily_steps")
    op.drop_index(op.f("ix_daily_steps_user_id"), table_name="daily_steps")
    op.drop_table("daily_steps")

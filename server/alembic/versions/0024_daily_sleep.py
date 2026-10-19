"""daily_sleep (스마트폰 건강 데이터 수면 — 하룻밤 1행, 맥락용)

Revision ID: 0024_daily_sleep
Revises: 0023_daily_steps
Create Date: 2026-10-19
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_daily_sleep"
down_revision: str | Sequence[str] | None = "0023_daily_steps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_sleep",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("asleep_minutes", sa.Integer(), nullable=False),
        sa.Column("bed_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("wake_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="health_connect"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "day", name="uq_daily_sleep_user_day"),
    )
    op.create_index(op.f("ix_daily_sleep_user_id"), "daily_sleep", ["user_id"])
    op.create_index(op.f("ix_daily_sleep_day"), "daily_sleep", ["day"])


def downgrade() -> None:
    op.drop_index(op.f("ix_daily_sleep_day"), table_name="daily_sleep")
    op.drop_index(op.f("ix_daily_sleep_user_id"), table_name="daily_sleep")
    op.drop_table("daily_sleep")

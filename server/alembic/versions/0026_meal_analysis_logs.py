"""meal_analysis_logs (식단 AI 분석 1회의 소요 시간)

Revision ID: 0026_meal_analysis_logs
Revises: 0025_meal_taken_at
Create Date: 2026-11-23
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_meal_analysis_logs"
down_revision: str | Sequence[str] | None = "0025_meal_taken_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "meal_analysis_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("image_path", sa.String(255), nullable=True),
        sa.Column("model", sa.String(64), nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("save_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ai_ms", sa.Integer(), nullable=False),
        sa.Column("total_ms", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_meal_analysis_logs_user_id", "meal_analysis_logs", ["user_id"])
    op.create_index("ix_meal_analysis_logs_image_path", "meal_analysis_logs", ["image_path"])
    op.create_index("ix_meal_analysis_logs_created_at", "meal_analysis_logs", ["created_at"])


def downgrade() -> None:
    op.drop_table("meal_analysis_logs")

"""telemetry logs (page time + user flow)

Revision ID: 0010_telemetry_logs
Revises: 0009_reward_claims
Create Date: 2026-06-15

관리자 분석 차트(페이지별 소요 시간, 사용자 동선 Sankey)의 원시 샘플을 담는
두 테이블. 사용자 앱이 /api/telemetry/* 로 적재하고 관리자 분석에서 집계한다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_telemetry_logs"
down_revision: str | Sequence[str] | None = "0009_reward_claims"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_time_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page_path", sa.String(length=255), nullable=False),
        sa.Column("time_spent_seconds", sa.Float(), nullable=False),
        sa.Column(
            "metric_type",
            sa.String(length=20),
            nullable=False,
            server_default="sample",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_page_time_logs_user_id", "page_time_logs", ["user_id"])
    op.create_index("ix_page_time_logs_page_path", "page_time_logs", ["page_path"])
    op.create_index("ix_page_time_logs_created_at", "page_time_logs", ["created_at"])

    op.create_table(
        "user_flow_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_page", sa.String(length=255), nullable=False),
        sa.Column("to_page", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_user_flow_logs_user_id", "user_flow_logs", ["user_id"])
    op.create_index("ix_user_flow_logs_from_page", "user_flow_logs", ["from_page"])
    op.create_index("ix_user_flow_logs_to_page", "user_flow_logs", ["to_page"])
    op.create_index("ix_user_flow_logs_created_at", "user_flow_logs", ["created_at"])


def downgrade() -> None:
    op.drop_table("user_flow_logs")
    op.drop_table("page_time_logs")

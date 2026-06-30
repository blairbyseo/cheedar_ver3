"""emotion_logs table (daily 기분 체크인)

Revision ID: 0012_emotion_logs
Revises: 0011_inquiries
Create Date: 2026-06-30

채팅 진입 시 하루 1회 남기는 기분 체크인을 담는 테이블. Cheddar_Team_26 의
daily check-in 이식. 사용자별·시각별 한 행이 쌓이며, build_emotion_context 가
가장 최근(24h) 기록을 읽어 채팅 응답 톤에 반영한다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_emotion_logs"
down_revision: str | Sequence[str] | None = "0011_inquiries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "emotion_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("emotion_label", sa.String(length=40), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_emotion_logs_user_id", "emotion_logs", ["user_id"])
    op.create_index("ix_emotion_logs_occurred_at", "emotion_logs", ["occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_emotion_logs_occurred_at", table_name="emotion_logs")
    op.drop_index("ix_emotion_logs_user_id", table_name="emotion_logs")
    op.drop_table("emotion_logs")

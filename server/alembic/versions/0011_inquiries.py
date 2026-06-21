"""inquiries table (설정 > 문의하기)

Revision ID: 0011_inquiries
Revises: 0010_telemetry_logs
Create Date: 2026-06-21

사용자가 설정 화면에서 남긴 문의를 담는 테이블. 사용자 앱이 /api/inquiries 로
적재하고 관리자 화면에서 확인·처리한다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_inquiries"
down_revision: str | Sequence[str] | None = "0010_telemetry_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inquiries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "is_resolved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_inquiries_user_id", "inquiries", ["user_id"])
    op.create_index("ix_inquiries_created_at", "inquiries", ["created_at"])


def downgrade() -> None:
    op.drop_table("inquiries")

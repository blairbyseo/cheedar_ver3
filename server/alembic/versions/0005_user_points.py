"""user xp/cp + point_history

Revision ID: 0005_user_points
Revises: 0004_id_password_auth
Create Date: 2026-05-22

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_user_points"
down_revision: str | Sequence[str] | None = "0004_id_password_auth"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 환자별 누적 경험치(xp)·소비 가능 포인트(cp). 기존 사용자는 0 으로 시작.
    op.add_column(
        "users",
        sa.Column("xp", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "users",
        sa.Column("cp", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    # 적립 내역(원장) — 어떤 규칙으로 언제 얼마가 적립됐는지 한 줄씩.
    op.create_table(
        "point_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rule", sa.String(20), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("dedup_key", sa.String(40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id", "rule", "dedup_key", name="uq_point_history_award"
        ),
    )
    op.create_index("ix_point_history_user_id", "point_history", ["user_id"])
    op.create_index(
        "ix_point_history_created_at", "point_history", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_point_history_created_at", table_name="point_history")
    op.drop_index("ix_point_history_user_id", table_name="point_history")
    op.drop_table("point_history")
    op.drop_column("users", "cp")
    op.drop_column("users", "xp")

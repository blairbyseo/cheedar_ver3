"""user is_admin flag

Revision ID: 0007_user_is_admin
Revises: 0006_exercise_and_user_body
Create Date: 2026-06-02

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_user_is_admin"
down_revision: str | Sequence[str] | None = "0006_exercise_and_user_body"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 관리자 화면 접근 권한. 기존 사용자는 모두 일반 회원(False)으로 시작.
    op.add_column(
        "users",
        sa.Column(
            "is_admin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "is_admin")

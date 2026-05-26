"""id/password auth: drop email verification, add user_id change-window tracking

Revision ID: 0004_id_password_auth
Revises: 0003_email_auth
Create Date: 2026-05-22

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_id_password_auth"
down_revision: str | Sequence[str] | None = "0003_email_auth"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 이메일 인증 절차 폐지 — 아이디/비밀번호 가입으로 전환하면서 인증 컬럼 삭제.
    # (email 컬럼 자체는 카카오 가입자가 계속 쓰므로 남겨 둔다)
    op.drop_column("users", "email_verification_expires_at")
    op.drop_column("users", "email_verification_code")
    op.drop_column("users", "email_verified")

    # 아이디 변경 제한(첫 변경부터 30일간 최대 2회) 추적용 컬럼
    op.add_column(
        "users",
        sa.Column(
            "user_id_change_window_start",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "user_id_change_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "user_id_change_count")
    op.drop_column("users", "user_id_change_window_start")

    op.add_column(
        "users",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "users", sa.Column("email_verification_code", sa.String(6), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column(
            "email_verification_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.execute("UPDATE users SET email_verified = true WHERE kakao_id IS NOT NULL")

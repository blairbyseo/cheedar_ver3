"""email/password auth: nullable kakao_id + password & verification columns

Revision ID: 0003_email_auth
Revises: 0002_chat_messages
Create Date: 2026-05-21

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_email_auth"
down_revision: str | Sequence[str] | None = "0002_chat_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 이메일 가입자는 카카오 ID가 없으므로 nullable 로 변경
    op.alter_column("users", "kakao_id", existing_type=sa.String(40), nullable=True)

    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
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

    # 기존 카카오 가입자는 카카오가 신원을 보증하므로 인증 완료로 표시
    op.execute("UPDATE users SET email_verified = true WHERE kakao_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("users", "email_verification_expires_at")
    op.drop_column("users", "email_verification_code")
    op.drop_column("users", "email_verified")
    op.drop_column("users", "password_hash")
    op.alter_column("users", "kakao_id", existing_type=sa.String(40), nullable=False)

"""users.apple_sub / apple_refresh_token / ai_consent_at

Revision ID: 0022_apple_login_ai_consent
Revises: 0021_profile_backfill
Create Date: 2026-10-07

App Store 심사 대응.
- apple_sub, apple_refresh_token: Sign in with Apple(4.8). refresh token 은
  회원탈퇴 때 Apple 토큰을 revoke(5.1.1(v))하는 데 쓴다.
- ai_consent_at: 외부 AI(OpenAI)로 데이터를 보내기 전 받은 동의(5.1.2(i)).
  기존 사용자는 모두 NULL(미동의)로 시작해 앱에서 다시 동의를 받는다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_apple_login_ai_consent"
down_revision: str | Sequence[str] | None = "0021_profile_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("apple_sub", sa.String(255), nullable=True))
    op.create_index("ix_users_apple_sub", "users", ["apple_sub"], unique=True)
    op.add_column(
        "users", sa.Column("apple_refresh_token", sa.String(512), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column("ai_consent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "ai_consent_at")
    op.drop_column("users", "apple_refresh_token")
    op.drop_index("ix_users_apple_sub", table_name="users")
    op.drop_column("users", "apple_sub")

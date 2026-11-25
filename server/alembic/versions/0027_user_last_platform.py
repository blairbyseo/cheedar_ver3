"""users.last_platform (마지막 접속 기기: ios | android | web)

Revision ID: 0027_user_last_platform
Revises: 0026_meal_analysis_logs
Create Date: 2026-11-25
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_user_last_platform"
down_revision: str | Sequence[str] | None = "0026_meal_analysis_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("last_platform", sa.String(16), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "last_platform")

"""meals.taken_at (식단 사진 촬영 시각 — 기기 현지 벽시계 시각, 시간대 없음)

Revision ID: 0025_meal_taken_at
Revises: 0024_daily_sleep
Create Date: 2026-11-23
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_meal_taken_at"
down_revision: str | Sequence[str] | None = "0024_daily_sleep"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("meals", sa.Column("taken_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("meals", "taken_at")

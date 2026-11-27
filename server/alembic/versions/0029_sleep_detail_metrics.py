"""daily_sleep 추가 지표 (소리 수면 측정 · DeltaSleep 기반 추정)

깊은/얕은/렘 분, 중간에 깬 분·횟수, 수면 효율, 호흡수, 숨 감지 비율, 무호흡/저호흡 의심 횟수.
앱 versionCode 19+ 의 phone_mic 기록만 채운다. 기존 행은 NULL.

Revision ID: 0029_sleep_detail_metrics
Revises: 0028_user_last_active
Create Date: 2026-11-27
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_sleep_detail_metrics"
down_revision: str | Sequence[str] | None = "0028_user_last_active"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INT_COLUMNS = (
    "deep_minutes",
    "light_minutes",
    "rem_minutes",
    "awake_minutes",
    "awakenings",
    "sleep_efficiency",
    "breathing_detected_pct",
    "apnea_count",
    "hypopnea_count",
)


def upgrade() -> None:
    for name in _INT_COLUMNS:
        op.add_column("daily_sleep", sa.Column(name, sa.Integer(), nullable=True))
    op.add_column("daily_sleep", sa.Column("breathing_rate", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("daily_sleep", "breathing_rate")
    for name in reversed(_INT_COLUMNS):
        op.drop_column("daily_sleep", name)

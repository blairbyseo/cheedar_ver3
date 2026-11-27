"""users.last_active_at (최근 사용 시각) + 기존 기록으로 채우기

앞으로는 로그인된 요청이 올 때 갱신된다(core/deps.py). 컬럼이 생기기 전 회원은
이미 남아 있는 '직접 쓴' 기록 중 가장 최근 시각으로 채운다:
화면 체류·이동 로그, 채팅, 식단, 감정, 운동.
걸음·수면은 폰이 자동으로 올리는 것이라 사용으로 치지 않는다.

Revision ID: 0028_user_last_active
Revises: 0027_user_last_platform
Create Date: 2026-11-27
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_user_last_active"
down_revision: str | Sequence[str] | None = "0027_user_last_platform"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SOURCES = (
    "page_time_logs",
    "user_flow_logs",
    "chat_messages",
    "meals",
    "emotion_logs",
    "exercise_logs",
)


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_last_active_at", "users", ["last_active_at"])

    # GREATEST 는 NULL 을 건너뛴다(PostgreSQL). 기록이 하나도 없으면 NULL 로 남는다.
    latest = ", ".join(
        f"(SELECT MAX(t.created_at) FROM {table} t WHERE t.user_id = users.id)"
        for table in _SOURCES
    )
    op.execute(f"UPDATE users SET last_active_at = GREATEST({latest})")


def downgrade() -> None:
    op.drop_index("ix_users_last_active_at", table_name="users")
    op.drop_column("users", "last_active_at")

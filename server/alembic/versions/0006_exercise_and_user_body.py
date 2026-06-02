"""exercise_logs table + user body info (age/height/weight)

Revision ID: 0006_exercise_and_user_body
Revises: 0005_user_points
Create Date: 2026-06-02

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_exercise_and_user_body"
down_revision: str | Sequence[str] | None = "0005_user_points"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 회원가입 때 입력받는 신체 정보 — 기존 사용자는 NULL.
    op.add_column("users", sa.Column("age", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("height_cm", sa.Float(), nullable=True))
    op.add_column("users", sa.Column("weight_kg", sa.Float(), nullable=True))

    # 하루치 운동 기록 — (user, date) 당 한 행. 여러 운동은 items(JSON)로.
    op.create_table(
        "exercise_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("done_on", sa.Date(), nullable=False),
        sa.Column(
            "is_skipped",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("calories_burned", sa.Float(), nullable=True),
        sa.Column("items", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "done_on", name="uq_exercise_user_date"),
    )
    op.create_index("ix_exercise_logs_user_id", "exercise_logs", ["user_id"])
    op.create_index("ix_exercise_logs_done_on", "exercise_logs", ["done_on"])


def downgrade() -> None:
    op.drop_index("ix_exercise_logs_done_on", table_name="exercise_logs")
    op.drop_index("ix_exercise_logs_user_id", table_name="exercise_logs")
    op.drop_table("exercise_logs")
    op.drop_column("users", "weight_kg")
    op.drop_column("users", "height_cm")
    op.drop_column("users", "age")

"""weekly_feedbacks (주간 리포트 AI 한마디 캐시)

Revision ID: 0019_weekly_feedbacks
Revises: 0018_survey_v3_f2_multi
Create Date: 2026-10-05

주간 리포트를 열 때마다 AI 를 부르지 않도록 (user, 주) 당 하루 한 번
만든 문구를 저장해 둔다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_weekly_feedbacks"
down_revision: str | Sequence[str] | None = "0018_survey_v3_f2_multi"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "weekly_feedbacks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("generated_on", sa.Date(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "week_start"),
    )
    op.create_index(
        op.f("ix_weekly_feedbacks_user_id"), "weekly_feedbacks", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_weekly_feedbacks_user_id"), table_name="weekly_feedbacks")
    op.drop_table("weekly_feedbacks")

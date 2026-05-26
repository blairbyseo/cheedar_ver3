"""initial: users + meals (Kakao OAuth)

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-18

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kakao_id", sa.String(40), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("user_id", sa.String(40), nullable=False),
        sa.Column("nickname", sa.String(80), nullable=True),
        sa.Column("profile_image_path", sa.String(255), nullable=True),
        sa.Column("user_id_last_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_kakao_id", "users", ["kakao_id"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_user_id", "users", ["user_id"], unique=True)

    meal_type_enum = sa.Enum(
        "breakfast", "lunch", "dinner", "snack", name="meal_type"
    )

    op.create_table(
        "meals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("meal_type", meal_type_enum, nullable=False),
        sa.Column("eaten_on", sa.Date(), nullable=False),
        sa.Column("menu", sa.String(120), nullable=True),
        sa.Column("calories", sa.Integer(), nullable=True),
        sa.Column("protein_g", sa.Numeric(6, 2), nullable=True),
        sa.Column("carbs_g", sa.Numeric(6, 2), nullable=True),
        sa.Column("fat_g", sa.Numeric(6, 2), nullable=True),
        sa.Column("image_path", sa.String(255), nullable=True),
        sa.Column("ai_summary", sa.String(500), nullable=True),
        sa.Column("ai_comment", sa.String(500), nullable=True),
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
    )
    op.create_index("ix_meals_user_id", "meals", ["user_id"])
    op.create_index("ix_meals_meal_type", "meals", ["meal_type"])
    op.create_index("ix_meals_eaten_on", "meals", ["eaten_on"])


def downgrade() -> None:
    op.drop_index("ix_meals_eaten_on", table_name="meals")
    op.drop_index("ix_meals_meal_type", table_name="meals")
    op.drop_index("ix_meals_user_id", table_name="meals")
    op.drop_table("meals")
    sa.Enum(name="meal_type").drop(op.get_bind(), checkfirst=False)

    op.drop_index("ix_users_user_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_kakao_id", table_name="users")
    op.drop_table("users")

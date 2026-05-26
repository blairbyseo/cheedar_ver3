"""add chat_messages table

Revision ID: 0002_chat_messages
Revises: 0001_initial
Create Date: 2026-05-18

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_chat_messages"
down_revision: str | Sequence[str] | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    chat_role_enum = sa.Enum("user", "ai", name="chat_role")

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", chat_role_enum, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"])
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_created_at", table_name="chat_messages")
    op.drop_index("ix_chat_messages_user_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    sa.Enum(name="chat_role").drop(op.get_bind(), checkfirst=False)

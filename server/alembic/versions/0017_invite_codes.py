"""invite_codes (가입 초대코드) + users.invite_code_id

Revision ID: 0017_invite_codes
Revises: 0016_user_deleted_at
Create Date: 2026-09-08

프로덕션(공개 출시) 이후에도 아무나 가입하지 못하게 막기 위한 테이블.
아이디 회원가입과 카카오 첫 로그인 양쪽에서 코드를 요구한다.
이미 가입한 사용자는 영향을 받지 않는다 — 코드는 계정 생성 시에만 쓰인다.

max_uses 하나로 운영 방식이 갈린다(NULL=무제한 / 30=선착순 / 1=1인 1코드).

업그레이드 시 코드 두 개를 심어둔다. 컬럼만 만들고 코드가 하나도 없으면
가입이 전면 차단되기 때문이다.
  · REVIEW-ACCESS  무제한·무기한 — Play 심사자용. 절대 비활성화하지 말 것
    (앱 업데이트를 올릴 때마다 심사자가 다시 가입 흐름을 확인한다)
  · CHEDDAR-2026   기본 참여자용. 인원·만료는 관리자 화면에서 조정
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_invite_codes"
down_revision: str | Sequence[str] | None = "0016_user_deleted_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column(
            "used_count", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_invite_codes_code"), "invite_codes", ["code"], unique=True
    )

    op.add_column("users", sa.Column("invite_code_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_invite_code_id",
        "users",
        "invite_codes",
        ["invite_code_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 초기 코드 — 없으면 가입이 전면 차단되므로 반드시 함께 심는다.
    op.execute(
        sa.text(
            """
            INSERT INTO invite_codes (code, label, max_uses, is_active)
            VALUES
              ('REVIEW-ACCESS', 'Play 심사용 (무제한·비활성화 금지)', NULL, true),
              ('CHEDDAR-2026',  '기본 참여자용',                      NULL, true)
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_invite_code_id", "users", type_="foreignkey")
    op.drop_column("users", "invite_code_id")
    op.drop_index(op.f("ix_invite_codes_code"), table_name="invite_codes")
    op.drop_table("invite_codes")

"""users.deleted_at (회원탈퇴 익명화 표시)

Revision ID: 0016_user_deleted_at
Revises: 0015_survey_v3_age_max
Create Date: 2026-08-24

회원탈퇴를 '행 삭제'가 아니라 '익명화'로 처리하기 위한 컬럼.
탈퇴하면 users 행은 남기고 식별정보(카카오ID·이메일·비밀번호·닉네임·
프로필사진)만 비운 뒤 deleted_at 에 시각을 찍는다. 식단·설문·채팅 기록은
누구의 것인지 알 수 없는 상태로 연구 통계에 남는다.

deleted_at 이 NULL 이 아닌 계정은 get_current_user 와 랭킹에서 제외된다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_user_deleted_at"
down_revision: str | Sequence[str] | None = "0015_survey_v3_age_max"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "deleted_at")

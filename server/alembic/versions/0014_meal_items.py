"""meals 항목별 분석 컬럼 추가 (items / ai_notes / ai_confidence)

Revision ID: 0014_meal_items
Revises: 0013_survey_v3_add_e15b
Create Date: 2026-07-07

Cheddar_Team_26 의 항목별 식단 분석 이식. 사진을 음식 항목 단위로 분해해
저장할 수 있도록 meals 테이블에 컬럼 3개를 추가한다.
  - items         : MealItem[] 의 JSON 문자열 (음식별 이름/양/단위/영양소).
  - ai_notes      : 분석 실패 사유나 수정 반영 메모.
  - ai_confidence : 전체 인식 자신감(0~1).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_meal_items"
down_revision: str | Sequence[str] | None = "0013_survey_v3_add_e15b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("meals", sa.Column("ai_notes", sa.Text(), nullable=True))
    op.add_column("meals", sa.Column("ai_confidence", sa.Float(), nullable=True))
    op.add_column("meals", sa.Column("items", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("meals", "items")
    op.drop_column("meals", "ai_confidence")
    op.drop_column("meals", "ai_notes")

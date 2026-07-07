"""사전설문 v3: 나이(A-1) 입력 상한 25 → 100 (스키마 통째 UPDATE)

Revision ID: 0015_survey_v3_age_max
Revises: 0014_meal_items
Create Date: 2026-07-07

A-1(나이) 문항의 max 가 25 로 잡혀 있어 프론트 스텝퍼가 25 에서 멈춰
25 세 이상을 입력할 수 없었다. v3_schema.json 의 max 를 100 으로 올리고,
런타임은 DB(survey_schemas)의 schema_json 을 읽으므로 0013 과 동일하게
활성 v3 행을 파일 내용으로 통째 UPDATE 한다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.services.survey.loader import load_schema

revision: str = "0015_survey_v3_age_max"
down_revision: str | Sequence[str] | None = "0014_meal_items"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_survey_schemas = sa.table(
    "survey_schemas",
    sa.column("version", sa.String()),
    sa.column("name", sa.String()),
    sa.column("description", sa.Text()),
    sa.column("schema_json", JSONB()),
)


def upgrade() -> None:
    schema_dict = load_schema("v3")
    op.execute(
        _survey_schemas.update()
        .where(_survey_schemas.c.version == "v3")
        .values(
            name=schema_dict["name"],
            description=schema_dict.get("description"),
            schema_json=schema_dict,
        )
    )


def downgrade() -> None:
    # 스키마 콘텐츠 변경(max 값)은 이전 본문을 보관하지 않으면 정확히 되돌릴 수
    # 없다. 상한을 넓히는 방향이라 안전하므로 downgrade 는 no-op 으로 둔다.
    pass

"""사전설문 v3: C-10 문구 "한 거" → "한 것" (스키마 통째 UPDATE)

Revision ID: 0025_survey_v3_c10_wording
Revises: 0024_daily_sleep
Create Date: 2026-11-16

2026-11-09 미팅 요청. 런타임은 DB(survey_schemas)의 schema_json 을 읽으므로
0015·0018 과 동일하게 활성 v3 행을 파일 내용으로 통째 UPDATE 한다.
문구만 바뀌고 문항 id·선택지·채점은 그대로라 기존 응답에는 영향이 없다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.services.survey.loader import load_schema

revision: str = "0025_survey_v3_c10_wording"
down_revision: str | Sequence[str] | None = "0024_daily_sleep"
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
    # 이전 스키마 본문을 보관하지 않으므로 정확히 되돌릴 수 없다. no-op.
    pass

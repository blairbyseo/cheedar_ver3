"""사전설문 v3: F-2(최근 관심사) 단일선택 → 복수선택 (스키마 통째 UPDATE)

Revision ID: 0018_survey_v3_f2_multi
Revises: 0017_invite_codes
Create Date: 2026-10-05

F-2 의 type 을 single_select → multi_select 로 바꿨다. 런타임은 DB(survey_schemas)의
schema_json 을 읽으므로 0015 와 동일하게 활성 v3 행을 파일 내용으로 통째 UPDATE 한다.
F-2 응답은 채점·채팅 개인화에서 쓰지 않으므로 기존 응답(문자열)은 그대로 둔다.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.services.survey.loader import load_schema

revision: str = "0018_survey_v3_f2_multi"
down_revision: str | Sequence[str] | None = "0017_invite_codes"
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

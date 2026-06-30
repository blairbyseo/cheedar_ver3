"""사전설문 v3: 성공경험 후속 문항 E-1-5b 추가 (스키마 통째 UPDATE)

Revision ID: 0013_survey_v3_add_e15b
Revises: 0012_emotion_logs
Create Date: 2026-06-30

온보딩 리디자인에서 추가된 문항 E-1-5b("어떤 경험이었나요?", free_text,
show_if E-1-5 == yes)를 활성 v3 스키마에 반영한다. 런타임은 DB(survey_schemas)
의 schema_json 을 읽으므로, JSON 파일 수정만으로는 반영되지 않아 이 마이그레이션으로
활성 행을 파일 내용으로 통째 UPDATE 한다. (F-2 는 이미 스키마에 존재해 변경 없음.)
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.services.survey.loader import load_schema

revision: str = "0013_survey_v3_add_e15b"
down_revision: str | Sequence[str] | None = "0012_emotion_logs"
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
    # 스키마 콘텐츠 변경은 이전 JSON 본문을 보관하지 않으면 정확히 되돌릴 수 없다.
    # E-1-5b 추가 자체는 분기(show_if)로만 노출되는 선택 free_text 라 안전하므로
    # downgrade 는 의도적으로 no-op 으로 둔다.
    pass

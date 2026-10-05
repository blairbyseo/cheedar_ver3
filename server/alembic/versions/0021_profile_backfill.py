"""설문 나이(A-1)·키·몸무게(B-1)로 비어 있는 프로필 채우기 (데이터 백필)

Revision ID: 0021_profile_backfill
Revises: 0020_motivation_checks
Create Date: 2026-10-05

카카오 가입자는 회원가입 폼을 거치지 않아 users.age/height_cm/weight_kg 가 비어
있고, 설문에서만 입력했다. 그 값이 프로필에 반영되지 않아 운동 칼로리가 70kg
가정으로 계산되고 있었다. 앞으로의 제출은 finalize_submission 이 반영하고,
이미 제출된 설문은 여기서 '비어 있는 칸만' 각자의 최근 완료 설문 답으로 채운다.
범위는 회원가입 검증과 같다(나이 1~120, 키 50~250, 몸무게 20~400).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0021_profile_backfill"
down_revision: str | Sequence[str] | None = "0020_motivation_checks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NUM = r"'^[0-9]+(\.[0-9]+)?$'"

_LATEST = """
    SELECT DISTINCT ON (user_id) user_id, answers
    FROM survey_responses
    WHERE status = 'completed'
    ORDER BY user_id, completed_at DESC
"""


def upgrade() -> None:
    op.execute(f"""
        UPDATE users u SET weight_kg = (l.answers->'B-1'->>'weight')::float
        FROM ({_LATEST}) l
        WHERE l.user_id = u.id AND u.weight_kg IS NULL
          AND (l.answers->'B-1'->>'weight') ~ {_NUM}
          AND (l.answers->'B-1'->>'weight')::float BETWEEN 20 AND 400
    """)
    op.execute(f"""
        UPDATE users u SET height_cm = (l.answers->'B-1'->>'height')::float
        FROM ({_LATEST}) l
        WHERE l.user_id = u.id AND u.height_cm IS NULL
          AND (l.answers->'B-1'->>'height') ~ {_NUM}
          AND (l.answers->'B-1'->>'height')::float BETWEEN 50 AND 250
    """)
    op.execute(f"""
        UPDATE users u SET age = round((l.answers->>'A-1')::float)::int
        FROM ({_LATEST}) l
        WHERE l.user_id = u.id AND u.age IS NULL
          AND (l.answers->>'A-1') ~ {_NUM}
          AND (l.answers->>'A-1')::float BETWEEN 1 AND 120
    """)


def downgrade() -> None:
    # 채운 값과 원래 입력값을 구분할 수 없어 되돌리지 않는다(빈 칸만 채웠음).
    pass

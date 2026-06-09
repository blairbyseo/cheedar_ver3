"""설문 스키마 로더.

JSON 파일을 dict 로 읽어주는 유틸. Alembic 시드 마이그레이션과
관리자가 초기 스키마를 다시 import 할 때 공통으로 사용한다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_SCHEMA_DIR = Path(__file__).resolve().parent


def load_schema(version: str) -> dict[str, Any]:
    """주어진 version 의 JSON 스키마를 dict 로 반환한다.

    파일 위치 규약: ``app/services/survey/{version}_schema.json``.
    """
    path = _SCHEMA_DIR / f"{version}_schema.json"
    with path.open(encoding="utf-8") as f:
        return json.load(f)

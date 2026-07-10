"""레거시 백업 CSV 21개를 Postgres `legacy` 스키마에 원본 그대로 적재한다.

무손실 보장 계층: 현재 앱이 쓰지 않는 테이블/컬럼(bodylog, dietimage 2번째
이후 장, user.gender/phone 등)도 여기 남는다. 전 컬럼 TEXT라 변환 손실이 없다.

사용법(Windows 로컬 Docker):
    docker exec cheddar-backend python -m app.scripts.import_legacy_raw \
        --csv-dir /tmp/legacy_csv
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine

# 파일별 실측 논리 행수 — 하나라도 어긋나면 실패시킨다.
EXPECTED_ROWS = {
    "ainodestats": 3, "alembic_version": 1, "bodylog": 34, "chatmessage": 294,
    "chatsession": 63, "dieteditevent": 134, "dietimage": 114, "dietlog": 106,
    "emotionlog": 23, "exerciselog": 11, "goal": 1, "group": 0,
    "motivationcheck": 0, "pagetimelog": 3324, "safetyevent": 2,
    "surveyresponse": 33, "surveyschema": 1, "symptomlog": 0, "user": 42,
    "userflowlog": 5174, "usermemory": 0,
}


def table_name(csv_path: Path) -> str:
    # 예: chatmessage_202606240039.csv → chatmessage
    return re.sub(r"_\d{12}$", "", csv_path.stem)


def main() -> int:
    parser = argparse.ArgumentParser(description="레거시 CSV → legacy 스키마 원본 적재")
    parser.add_argument("--csv-dir", required=True)
    args = parser.parse_args()

    files = sorted(Path(args.csv_dir).glob("*.csv"))
    names = {table_name(f) for f in files}
    if names != set(EXPECTED_ROWS):
        print(f"❌ CSV 구성이 예상과 다릅니다. 누락: {set(EXPECTED_ROWS) - names}, 추가: {names - set(EXPECTED_ROWS)}")
        return 1

    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS legacy"))
        for f in files:
            tbl = table_name(f)
            with open(f, newline="", encoding="utf-8") as fh:
                reader = csv.reader(fh)
                header = next(reader)
                rows = list(reader)
            cols = ", ".join(f'"{c}" TEXT' for c in header)
            conn.execute(text(f'DROP TABLE IF EXISTS legacy."{tbl}"'))
            conn.execute(text(f'CREATE TABLE legacy."{tbl}" ({cols})'))
            if rows:
                col_list = ", ".join(f'"{c}"' for c in header)
                params = ", ".join(f":c{i}" for i in range(len(header)))
                insert = text(f'INSERT INTO legacy."{tbl}" ({col_list}) VALUES ({params})')
                conn.execute(insert, [{f"c{i}": v for i, v in enumerate(r)} for r in rows])
            if len(rows) != EXPECTED_ROWS[tbl]:
                print(f"❌ {tbl}: {len(rows)}건 적재 — 기대 {EXPECTED_ROWS[tbl]}건")
                return 1
            print(f"✅ legacy.{tbl}: {len(rows)}건")
    print("✅ 21개 테이블 원본 보존 완료 (legacy 스키마)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

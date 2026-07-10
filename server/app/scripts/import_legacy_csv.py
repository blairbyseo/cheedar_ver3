"""레거시 CSV → live 테이블 ETL (대상 DB에 기존 사용자가 있어도 안전).

핵심 규칙:
  - 레거시 PK 보존 안 함 — 새 id는 시퀀스 발급, FK는 매핑 dict로 재연결.
  - 사용자 병합: kakao_id 일치 → 병합, (비카카오) email 소문자 일치 → 병합,
    그 외 신규 생성. 병합 시 ver3 값 우선, NULL 프로필 필드만 레거시로 채움.
  - 무손실 감사: 모든 원본 행은 legacy.id_map(이식/병합) 또는
    legacy.skip_log(사유 있는 미이식) 중 정확히 한 곳에 기록된다.
  - 멱등성: legacy.id_map 에 행이 있으면 중단(중복 이식 방지).

사용법(Windows 로컬 Docker):
    # dry-run(기본): 전부 수행 후 rollback
    docker exec cheddar-backend python -m app.scripts.import_legacy_csv --csv-dir /tmp/legacy_csv
    # 실제 반영:
    docker exec cheddar-backend python -m app.scripts.import_legacy_csv --csv-dir /tmp/legacy_csv --commit
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import date
from pathlib import Path

from sqlalchemy import select, text

from app.core.database import SessionLocal
from app.models.chat import ChatMessage, ChatRole
from app.models.emotion import EmotionLog
from app.models.exercise import ExerciseLog
from app.models.meal import Meal, MealType
from app.models.safety import RiskLevel, SafetyEvent
from app.models.survey import SurveyKind, SurveyResponse, SurveyResponseStatus, SurveySchema
from app.models.telemetry import PageTimeLog, UserFlowLog
from app.models.user import User
from app.scripts import legacy_transforms as tf

# CSV 원본 행수 — "이식 + 병합 + 스킵 = 원본" 등식의 우변
SOURCE_ROWS = {
    "user": 42, "dietlog": 106, "chatmessage": 294, "exerciselog": 11,
    "emotionlog": 23, "surveyresponse": 33, "safetyevent": 2,
    "pagetimelog": 3324, "userflowlog": 5174,
}


def load(csv_dir: Path, prefix: str) -> list[dict]:
    matches = sorted(csv_dir.glob(f"{prefix}_*.csv"))
    files = [f for f in matches if re.fullmatch(rf"{prefix}_\d{{12}}", f.stem)]
    if len(files) != 1:
        raise FileNotFoundError(f"{prefix} CSV를 특정할 수 없음: {files}")
    with open(files[0], newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def main() -> int:
    parser = argparse.ArgumentParser(description="레거시 CSV → live 테이블 ETL")
    parser.add_argument("--csv-dir", required=True)
    parser.add_argument("--commit", action="store_true", help="실제 반영 (없으면 dry-run)")
    args = parser.parse_args()
    csv_dir = Path(args.csv_dir)
    as_of = date.today()  # age 환산 기준일

    db = SessionLocal()
    stats: dict[str, dict[str, int]] = {
        e: {"inserted": 0, "merged": 0, "skipped": 0} for e in SOURCE_ROWS
    }
    id_map_rows: list[dict] = []   # {"entity","legacy_id","live_id","action"}
    skip_rows: list[dict] = []     # {"entity","legacy_id","reason"}
    notes: list[str] = []

    def mapped(entity: str, legacy_id: str, live_id: int, action: str = "inserted"):
        id_map_rows.append({"entity": entity, "legacy_id": int(legacy_id),
                            "live_id": live_id, "action": action})
        stats[entity][action] += 1

    def skipped(entity: str, legacy_id: str, reason: str):
        skip_rows.append({"entity": entity, "legacy_id": int(legacy_id), "reason": reason})
        stats[entity]["skipped"] += 1

    try:
        # --- 사전 점검 -----------------------------------------------------
        db.execute(text("CREATE SCHEMA IF NOT EXISTS legacy"))
        db.execute(text(
            "CREATE TABLE IF NOT EXISTS legacy.id_map ("
            " entity TEXT NOT NULL, legacy_id INT NOT NULL, live_id INT NOT NULL,"
            " action TEXT NOT NULL, PRIMARY KEY (entity, legacy_id))"
        ))
        db.execute(text(
            "CREATE TABLE IF NOT EXISTS legacy.skip_log ("
            " entity TEXT NOT NULL, legacy_id INT NOT NULL, reason TEXT NOT NULL,"
            " PRIMARY KEY (entity, legacy_id))"
        ))
        if db.execute(text("SELECT COUNT(*) FROM legacy.id_map")).scalar_one():
            print("❌ legacy.id_map 에 이미 이식 기록이 있습니다 — 중복 실행 방지로 중단.")
            return 1
        v3 = db.execute(
            select(SurveySchema).where(SurveySchema.version == "v3")
        ).scalars().first()
        if v3 is None:
            print("❌ survey_schemas 에 시드된 v3 가 없습니다. alembic upgrade head 먼저.")
            return 1

        # --- 1) users: 병합 또는 신규 생성 -----------------------------------
        existing = db.execute(select(User)).scalars().all()
        by_kakao = {u.kakao_id: u for u in existing if u.kakao_id}
        by_email = {u.email.lower(): u for u in existing if u.email}
        taken = {u.user_id.lower() for u in existing}
        user_map: dict[str, int] = {}   # legacy user.id(str) → live users.id
        legacy_admin_merged: list[str] = []

        for row in load(csv_dir, "user"):
            match = by_kakao.get(row["kakao_id"] or "___none___")
            if match is None and not row["kakao_id"] and row["email"]:
                match = by_email.get(row["email"].lower())
            if match is not None:
                # 병합: ver3 값 우선, NULL 프로필 필드만 레거시로 채움
                fields = tf.transform_user(row, taken=set(), as_of=as_of)
                for col in ("nickname", "age", "height_cm", "weight_kg"):
                    if getattr(match, col) is None and fields[col] is not None:
                        setattr(match, col, fields[col])
                match.onboarded = match.onboarded or fields["onboarded"]
                if fields["last_survey_at"] and (
                    match.last_survey_at is None
                    or fields["last_survey_at"] > match.last_survey_at
                ):
                    match.last_survey_at = fields["last_survey_at"]
                if fields["is_admin"] and not match.is_admin:
                    legacy_admin_merged.append(match.user_id)
                user_map[row["id"]] = match.id
                mapped("user", row["id"], match.id, "merged")
            else:
                u = User(**tf.transform_user(row, taken, as_of))
                db.add(u)
                db.flush()
                user_map[row["id"]] = u.id
                mapped("user", row["id"], u.id)
        db.flush()

        # --- 2) meals (dietlog) ----------------------------------------------
        for row in load(csv_dir, "dietlog"):
            out = tf.transform_meal(row)
            if out is None:
                skipped("dietlog", row["id"], "is_skipped=true — meals에 대응 컬럼 없음 (legacy.dietlog 보존)")
                continue
            m = Meal(user_id=user_map[row["user_id"]],
                     meal_type=MealType(out.pop("meal_type")), **out)
            db.add(m)
            db.flush()
            mapped("dietlog", row["id"], m.id)

        # --- 3) chat_messages (chatsession 조인으로 user 연결) -----------------
        session_user = {r["id"]: r["user_id"] for r in load(csv_dir, "chatsession")}
        message_map: dict[str, int] = {}  # legacy chatmessage.id → live id (safety 재매핑용)
        for row in load(csv_dir, "chatmessage"):
            out = tf.transform_chat_message(row)
            cm = ChatMessage(user_id=user_map[session_user[row["session_id"]]],
                             role=ChatRole(out.pop("role")), **out)
            db.add(cm)
            db.flush()
            message_map[row["id"]] = cm.id
            mapped("chatmessage", row["id"], cm.id)

        # --- 4) exercise (병합 사용자의 (user, done_on) 유니크 충돌 방어) ------
        for row in load(csv_dir, "exerciselog"):
            out = tf.transform_exercise(row)
            live_uid = user_map[row["user_id"]]
            dup = db.execute(select(ExerciseLog.id).where(
                ExerciseLog.user_id == live_uid,
                ExerciseLog.done_on == out["done_on"],
            )).scalar()
            if dup:
                skipped("exerciselog", row["id"],
                        f"기존 ver3 기록(id={dup})과 (user,date) 충돌 — ver3 우선 (legacy.exerciselog 보존)")
                continue
            e = ExerciseLog(user_id=live_uid, **out)
            db.add(e)
            db.flush()
            mapped("exerciselog", row["id"], e.id)

        # --- 5) emotion --------------------------------------------------------
        for row in load(csv_dir, "emotionlog"):
            el = EmotionLog(user_id=user_map[row["user_id"]], **tf.transform_emotion(row))
            db.add(el)
            db.flush()
            mapped("emotionlog", row["id"], el.id)

        # --- 6) survey_responses (schema → live v3, 병합 사용자 in_progress 폐기) --
        merged_legacy_uids = {r["legacy_id"] for r in id_map_rows
                              if r["entity"] == "user" and r["action"] == "merged"}
        for row in load(csv_dir, "surveyresponse"):
            out = tf.transform_survey_response(row)
            status = out.pop("status")
            if status == "in_progress" and int(row["user_id"]) in merged_legacy_uids:
                # ver3에서 활동 중인 계정에 옛 미완료 설문을 살리면 '이어하기'가
                # 과거 설문으로 되돌아간다 → abandoned 로 이식(원본은 legacy 보존)
                status = "abandoned"
                notes.append(f"surveyresponse legacy_id={row['id']}: in_progress → abandoned (병합 계정)")
            sr = SurveyResponse(
                user_id=user_map[row["user_id"]], schema_id=v3.id,
                kind=SurveyKind(out.pop("kind")),
                status=SurveyResponseStatus(status), **out,
            )
            db.add(sr)
            db.flush()
            mapped("surveyresponse", row["id"], sr.id)

        # --- 7) safety_events (chat 이후 — message_id 재매핑) -------------------
        for row in load(csv_dir, "safetyevent"):
            out = tf.transform_safety(row)
            se = SafetyEvent(
                user_id=user_map[row["user_id"]],
                message_id=message_map[row["message_id"]] if row["message_id"] else None,
                risk_level=RiskLevel(out.pop("risk_level")), **out,
            )
            db.add(se)
            db.flush()
            mapped("safetyevent", row["id"], se.id)

        # --- 8) telemetry -------------------------------------------------------
        for row in load(csv_dir, "pagetimelog"):
            p = PageTimeLog(user_id=user_map[row["user_id"]], **tf.transform_page_time(row))
            db.add(p)
            db.flush()
            mapped("pagetimelog", row["id"], p.id)
        for row in load(csv_dir, "userflowlog"):
            fl = UserFlowLog(user_id=user_map[row["user_id"]], **tf.transform_user_flow(row))
            db.add(fl)
            db.flush()
            mapped("userflowlog", row["id"], fl.id)

        # --- 감사 테이블 적재 ----------------------------------------------------
        db.execute(text(
            "INSERT INTO legacy.id_map (entity, legacy_id, live_id, action)"
            " VALUES (:entity, :legacy_id, :live_id, :action)"), id_map_rows)
        if skip_rows:
            db.execute(text(
                "INSERT INTO legacy.skip_log (entity, legacy_id, reason)"
                " VALUES (:entity, :legacy_id, :reason)"), skip_rows)

        # --- 무손실 등식 검증: 이식 + 병합 + 스킵 = 원본 --------------------------
        ok = True
        for entity, src in SOURCE_ROWS.items():
            s = stats[entity]
            total = s["inserted"] + s["merged"] + s["skipped"]
            mark = "✅" if total == src else "❌"
            if total != src:
                ok = False
            print(f"{mark} {entity}: 이식 {s['inserted']} + 병합 {s['merged']}"
                  f" + 스킵 {s['skipped']} = {total} (원본 {src})")
        for n in notes:
            print(f"ℹ️  {n}")
        for r in skip_rows:
            print(f"ℹ️  skip {r['entity']}#{r['legacy_id']}: {r['reason']}")
        if legacy_admin_merged:
            print(f"⚠️  레거시 admin이지만 기존 계정과 병합되어 승격하지 않음: {legacy_admin_merged}"
                  f" — 필요 시 make_admin 으로 수동 승격")
        if not ok:
            print("❌ 무손실 등식 검증 실패 — rollback")
            db.rollback()
            return 1

        if args.commit:
            db.commit()
            print("✅ COMMIT 완료")
        else:
            db.rollback()
            print("ℹ️  dry-run — rollback 했습니다. 반영하려면 --commit")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())

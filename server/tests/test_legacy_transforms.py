"""레거시 CSV 변환 규칙 테스트 — 백업에서 실측한 엣지케이스를 그대로 사용한다."""
from datetime import date, datetime, timezone

from app.scripts.legacy_transforms import (
    age_from_birth,
    make_user_id,
    parse_bool,
    parse_int_from_float,
    parse_ts,
    transform_chat_message,
    transform_exercise,
    transform_meal,
    transform_safety,
    transform_survey_response,
    transform_user,
)


def test_parse_ts_naive_utc():
    ts = parse_ts("2026-01-13 13:45:22.519")
    assert ts == datetime(2026, 1, 13, 13, 45, 22, 519000, tzinfo=timezone.utc)
    assert parse_ts("2026-01-17 14:41:18") == datetime(2026, 1, 17, 14, 41, 18, tzinfo=timezone.utc)
    assert parse_ts("") is None


def test_parse_int_from_float():
    assert parse_int_from_float("1010.0") == 1010
    assert parse_int_from_float("") is None


def test_age_from_birth():
    assert age_from_birth("1997-06-23", as_of=date(2026, 7, 9)) == 29
    assert age_from_birth("2004-08-01", as_of=date(2026, 7, 9)) == 21  # 생일 전
    assert age_from_birth("", as_of=date(2026, 7, 9)) is None


def test_make_user_id_kakao_email_and_collision():
    # 운영 DB의 기존 user_id 들이 taken 에 미리 들어온다 (소문자)
    taken = {"demo_user"}
    assert make_user_id("kakao_4923644871@kakao.id", "4923644871", 29, taken) == "kakao_4923644871"
    assert make_user_id("test01@gmail.com", "", 2, taken) == "test01"
    # 실측 충돌: id=19 test01@test01.com → suffix로 레거시 id
    assert make_user_id("test01@test01.com", "", 19, taken) == "test01_19"
    # 운영 기존 아이디와 충돌하는 경우
    assert make_user_id("demo_user@x.com", "", 7, taken) == "demo_user_7"


def test_transform_user_admin_and_kakao():
    taken: set[str] = set()
    row = {
        "id": "29", "email": "kakao_4923644871@kakao.id",
        "password_hash": "$2b$12$xxx", "name": "강진구", "gender": "MALE",
        "birth_date": "1997-06-23", "height": "175.0",
        "created_at": "2026-05-31 23:05:29.968", "kakao_id": "4923644871",
        "phone": "010-3681-6068", "guardian_phone": "", "group_id": "",
        "status": "Active", "last_visit": "", "last_weight": "70.5",
        "role": "admin", "patient_code": "", "last_weight_date": "",
        "onboarded": "true", "last_survey_at": "2026-05-31 23:08:00.000",
    }
    out = transform_user(row, taken, as_of=date(2026, 7, 9))
    assert "id" not in out  # 새 id는 시퀀스가 발급
    assert out["user_id"] == "kakao_4923644871"
    assert out["nickname"] == "강진구"
    assert out["age"] == 29
    assert out["height_cm"] == 175.0
    assert out["weight_kg"] == 70.5
    assert out["is_admin"] is True
    assert out["onboarded"] is True
    # 카카오 가입자는 현재 모델 규약상 password_hash 미보유
    assert out["password_hash"] is None
    assert out["kakao_id"] == "4923644871"


def test_transform_meal_korean_mealtime_and_skip():
    row = {
        "id": "18", "user_id": "12", "date": "2026-05-02", "meal_time": "점심",
        "image_url": "https://cheddar-diet-uploads.s3.ap-northeast-2.amazonaws.com/diet/x.jpeg",
        "description": "라면", "calories": "450.0", "carbs": "60.0",
        "protein": "20.0", "fat": "15.0", "is_skipped": "false",
        "created_at": "2026-05-02 13:55:20.291",
        "items": '[{"name":"라면","calories":450,"carbs":60,"protein":20,"fat":15,"quantity":1,"unit":"그릇","is_ingredient":false}]',
        "analysis_id": "abc",
    }
    out = transform_meal(row)
    assert "id" not in out and "user_id" not in out  # ETL이 매핑으로 연결
    assert out["meal_type"] == "lunch"
    assert out["eaten_on"] == date(2026, 5, 2)
    assert out["menu"] == "라면"
    assert out["calories"] == 450
    assert out["carbs_g"] == 60.0
    assert out["image_path"].startswith("https://")
    assert '"라면"' in out["items"]
    # 굶은 끼니는 meals에 대응 컬럼이 없어 이식하지 않는다
    row_skip = dict(row, is_skipped="true")
    assert transform_meal(row_skip) is None


def test_transform_chat_message_role():
    row = {
        "id": "7", "session_id": "3", "role": "ASSISTANT",
        "content": "안녕하세요!", "created_at": "2026-01-13 13:45:22.519",
        "route": "general", "tools": "", "flags": "{}",
    }
    out = transform_chat_message(row)
    assert out == {
        "role": "ai", "text": "안녕하세요!",
        "created_at": datetime(2026, 1, 13, 13, 45, 22, 519000, tzinfo=timezone.utc),
    }
    assert transform_chat_message(dict(row, role="USER"))["role"] == "user"


def test_transform_exercise_reconstructs_items():
    # 실측 1행: items가 비고 exercise_type만 있는 초기 데이터
    row = {
        "id": "1", "user_id": "4", "date": "2026-01-17", "exercise_type": "cycling",
        "duration_hours": "0", "duration_minutes": "30", "calories_burned": "262.5",
        "is_skipped": "false", "created_at": "2026-01-17 14:41:18.325", "items": "",
    }
    out = transform_exercise(row)
    assert out["done_on"] == date(2026, 1, 17)
    import json
    items = json.loads(out["items"])
    assert items == [{
        "exercise_name": "cycling", "met": None, "duration_hours": 0,
        "duration_minutes": 30, "intensity": None, "calories_burned": 262.5,
    }]
    # items가 이미 있으면 그대로 통과
    row2 = dict(row, items='[{"exercise_name": "달리기", "met": 9.8, "duration_hours": 0, "duration_minutes": 30, "intensity": 5, "calories_burned": 352.8}]')
    assert json.loads(transform_exercise(row2)["items"])[0]["met"] == 9.8
    # 건너뛴 날은 items 없음
    row3 = dict(row, exercise_type="", is_skipped="true", items="", calories_burned="0.0")
    out3 = transform_exercise(row3)
    assert out3["is_skipped"] is True and out3["items"] is None


def test_transform_safety_lowercases_risk():
    row = {
        "id": "1", "user_id": "24", "message_id": "", "risk_level": "HIGH",
        "detected_category": "survey_purging",
        "description": "survey_response_id=9; flag=purging_flag",
        "is_resolved": "false", "created_at": "2026-05-31 23:06:17.283",
        "risk_score": "", "ai_score": "", "status": "unresolved",
    }
    out = transform_safety(row)
    assert out["risk_level"] == "high"
    assert out["is_resolved"] is False
    assert "message_id" not in out  # ETL이 message_map으로 연결


def test_transform_survey_response_parses_json():
    row = {
        "id": "9", "user_id": "24", "schema_id": "1", "kind": "onboarding",
        "status": "completed", "current_section": "F",
        "answers": '{"A-1": 16}', "derived_flags": '{"purging_flag": true}',
        "started_at": "2026-05-31 22:50:00.000",
        "updated_at": "2026-05-31 23:06:00.000",
        "completed_at": "2026-05-31 23:06:10.000",
    }
    out = transform_survey_response(row)
    assert "schema_id" not in out  # ETL이 live v3 id로 연결
    assert out["answers"] == {"A-1": 16}
    assert out["derived_flags"] == {"purging_flag": True}
    assert out["kind"] == "onboarding"
    assert out["completed_at"] is not None


def test_parse_bool():
    assert parse_bool("true") is True
    assert parse_bool("false") is False
    assert parse_bool("") is False

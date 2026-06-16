"""채팅에 들어가는 식단·운동·설문 컨텍스트를 그대로 출력하는 진단 스크립트.

채팅이 "지난주 식단을 기억 못 한다"고 할 때, 원인이
  (1) DB 에 그 사용자의 기록이 실제로 없어서인지
  (2) build_*_context 코드가 날짜별 상세를 안 만들어서인지
를 LLM·서버 재시작과 무관하게 바로 확인하기 위한 용도.

이 스크립트는 디스크의 *현재* 코드를 직접 호출하므로, 여기서 '날짜별 식단'
섹션이 보이는데 채팅에는 안 보인다면 → 서버 재시작이 안 된 것이다.

사용법 (Docker 환경):
    docker exec cheddar-backend python -m app.scripts.debug_chat_context <아이디>

로컬에서 직접 실행:
    cd server
    python -m app.scripts.debug_chat_context <아이디>
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models.user import User
from app.services.diet_context import build_diet_context
from app.services.exercise_context import build_exercise_context
from app.services.survey_context import build_survey_context


def _find_user(db, user_id: str) -> User | None:
    return (
        db.execute(select(User).where(func.lower(User.user_id) == user_id.lower()))
        .scalars()
        .first()
    )


def _section(title: str, body: str) -> None:
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)
    if body:
        print(body)
    else:
        print("(빈 문자열 — 기록이 없어 컨텍스트가 생성되지 않음)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="채팅에 들어가는 식단/운동/설문 컨텍스트 미리보기"
    )
    parser.add_argument("user_id", help="대상 계정의 아이디(user_id)")
    args = parser.parse_args()

    with SessionLocal() as db:
        user = _find_user(db, args.user_id)
        if user is None:
            print(f"❌ 아이디 {args.user_id!r} 인 사용자를 찾지 못했습니다.")
            return 1

        print(f"✅ 사용자: id={user.id}  user_id={user.user_id!r}  nickname={user.nickname!r}")

        _section("[식단 컨텍스트]  build_diet_context", build_diet_context(db, user.id))
        _section("[운동 컨텍스트]  build_exercise_context", build_exercise_context(db, user.id))
        _section("[설문 컨텍스트]  build_survey_context", build_survey_context(db, user.id))

        print("\n" + "-" * 60)
        print("판독 가이드:")
        print("  · '최근 7일 날짜별 식단/운동' 줄이 보이면 → 코드 반영 OK.")
        print("    채팅에 안 나오면 서버를 재시작하세요(코드 미적용).")
        print("  · 날짜별 줄이 없고 평균만 있으면 → 그 기간에 기록이 없는 것.")
        print("  · 통째로 '(빈 문자열)' 이면 → 해당 사용자의 기록 자체가 없음.")
        return 0


if __name__ == "__main__":
    sys.exit(main())

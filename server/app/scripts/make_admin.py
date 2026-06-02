"""특정 계정을 관리자로 승격/해제하는 터미널 스크립트.

관리자 권한은 API 로는 못 바꾸게 막아두고, 서버 운영자가 터미널에서만
직접 부여한다(최초 관리자 임명 등).

사용법 (Docker 환경):
    docker exec cheddar-backend python -m app.scripts.make_admin <아이디>
    docker exec cheddar-backend python -m app.scripts.make_admin <아이디> --revoke
    docker exec cheddar-backend python -m app.scripts.make_admin --list
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models.user import User


def _find_user(db, user_id: str) -> User | None:
    # 로그인과 동일하게 대소문자 무시로 찾는다.
    return (
        db.execute(select(User).where(func.lower(User.user_id) == user_id.lower()))
        .scalars()
        .first()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="관리자 권한 부여/해제")
    parser.add_argument("user_id", nargs="?", help="대상 계정의 아이디(user_id)")
    parser.add_argument(
        "--revoke", action="store_true", help="관리자 권한을 해제한다"
    )
    parser.add_argument(
        "--list", action="store_true", help="현재 관리자 목록을 출력한다"
    )
    args = parser.parse_args()

    with SessionLocal() as db:
        if args.list:
            admins = db.execute(
                select(User).where(User.is_admin.is_(True)).order_by(User.id)
            ).scalars().all()
            if not admins:
                print("현재 관리자가 없습니다.")
            else:
                print(f"관리자 {len(admins)}명:")
                for u in admins:
                    print(f"  - id={u.id}  user_id={u.user_id!r}  nickname={u.nickname!r}")
            return 0

        if not args.user_id:
            parser.error("아이디를 입력하거나 --list 를 사용하세요.")

        user = _find_user(db, args.user_id)
        if user is None:
            print(f"❌ 아이디 {args.user_id!r} 인 사용자를 찾지 못했습니다.")
            return 1

        target = not args.revoke
        if user.is_admin == target:
            state = "이미 관리자" if target else "이미 일반 회원"
            print(f"ℹ️  {user.user_id!r} 은(는) {state}입니다. 변경 없음.")
            return 0

        user.is_admin = target
        db.commit()
        verb = "관리자로 승격" if target else "관리자 권한 해제"
        print(f"✅ {user.user_id!r} (id={user.id}) — {verb} 완료.")
        return 0


if __name__ == "__main__":
    sys.exit(main())

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

settings = get_settings()


def _extract_token(request: Request, cookie_token: str | None) -> str | None:
    if cookie_token:
        return cookie_token
    # Fallback: support `Authorization: Bearer <token>` for tooling / curl.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return None


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    cookie_token: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
) -> User:
    token = _extract_token(request, cookie_token)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    subject = decode_access_token(token)
    if not subject:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = db.get(User, int(subject))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """관리자 전용 엔드포인트 가드.

    로그인은 됐지만 관리자가 아니면 403 으로 막는다. 관리자 화면
    (frontend_admin)의 모든 /api/admin/* 엔드포인트가 이 의존성을 쓴다.
    """
    if not current_user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return current_user

from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    decode_access_token,
    token_needs_renewal,
)
from app.models.user import User

settings = get_settings()


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


def _extract_token(request: Request, cookie_token: str | None) -> str | None:
    if cookie_token:
        return cookie_token
    # Fallback: support `Authorization: Bearer <token>` for tooling / curl.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return None


_PLATFORMS = {"ios", "android", "web"}


def detect_platform(headers) -> str | None:
    """요청 헤더로 접속 기기를 추정한다: "ios" | "android" | "web" | None(모름).

    1) 앱이 직접 붙여 보내는 X-Client-Platform 이 있으면 그대로 믿는다.
    2) 없으면(구버전 앱·웹 브라우저) User-Agent 로 추정한다. 앱은 CapacitorHttp
       (네이티브 HTTP)를 쓰므로 안드로이드는 "Dalvik/… Android …", 아이폰은
       "…CFNetwork/… Darwin/…" 형태로 온다. 폰 브라우저의 "Android"/"iPhone" 도 같이 잡힌다.
    curl 같은 도구는 None 으로 두어 기존 값을 덮어쓰지 않는다.
    """
    explicit = (headers.get("X-Client-Platform") or "").strip().lower()
    if explicit in _PLATFORMS:
        return explicit
    ua = (headers.get("User-Agent") or "").lower()
    if "android" in ua or "dalvik" in ua:
        return "android"
    if any(k in ua for k in ("iphone", "ipad", "ipod", "cfnetwork", "darwin")):
        return "ios"
    if "mozilla" in ua:
        return "web"
    return None


def _remember_platform(request: Request, user: User, db: Session) -> None:
    """접속 기기가 바뀌었을 때만 users.last_platform 을 갱신한다(관리자 화면 표시용)."""
    platform = detect_platform(request.headers)
    if platform is None or user.last_platform == platform:
        return
    try:
        user.last_platform = platform
        db.commit()
    except Exception:
        # 표시용 부가 정보일 뿐 — 저장에 실패해도 본 요청은 그대로 진행한다.
        db.rollback()


def get_current_user(
    request: Request,
    response: Response,
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
    # 탈퇴(익명화)된 계정 — 아직 유효한 쿠키를 들고 있어도 더는 못 쓴다
    if user.deleted_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Withdrawn account")
    # 자동 로그인: 앱을 쓰는 동안엔 만료일을 계속 뒤로 미룬다(하루 1회 재발급).
    # 쿠키로 들어온 경우만 — Bearer(도구/curl)는 쿠키를 안 쓰니 건드리지 않는다.
    # 주의: 엔드포인트가 Response 객체를 직접 반환하면 이 쿠키는 버려지지만,
    # 앱 시작 때마다 부르는 /api/auth/me 는 모델을 반환하므로 여기서 확실히 연장된다.
    if cookie_token and token_needs_renewal(cookie_token):
        set_auth_cookie(response, create_access_token(user.id))
    _remember_platform(request, user, db)
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


def get_ai_consented_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """외부 AI(OpenAI)를 부르는 엔드포인트 가드 (App Store 5.1.2(i)).

    사용자가 앱에서 'AI 데이터 전송'에 동의하기 전에는 데이터를 보내지 않는다.
    프론트는 detail == "AI_CONSENT_REQUIRED" 를 보고 동의 화면을 띄운다.
    """
    if current_user.ai_consent_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "AI_CONSENT_REQUIRED")
    return current_user

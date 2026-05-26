import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import (
    KakaoLoginRequest,
    LoginRequest,
    LoginResponse,
    SignupRequest,
    UserIdUpdateRequest,
    UserOut,
)
from app.services import kakao as kakao_service
from app.services.uploads import delete_profile_image, save_profile_image

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

# 아이디(user_id) 규칙 — 프론트(SignupPage.jsx / Settings.jsx)와 반드시 동일하게 유지할 것
USER_ID_MIN_LEN = 3
USER_ID_MAX_LEN = 15
USER_ID_PATTERN = re.compile(r"^[가-힣a-zA-Z0-9_]+$")

# 아이디 변경 제한 — 첫 변경 시점부터 30일 동안 최대 2번.
USER_ID_CHANGE_WINDOW_DAYS = 30
USER_ID_MAX_CHANGES_PER_WINDOW = 2

# 비밀번호 규칙
PASSWORD_MIN_LEN = 8
PASSWORD_MAX_LEN = 64


@router.get("/kakao/authorize-url")
def kakao_authorize_url() -> dict[str, str]:
    """프론트가 카카오 동의 화면으로 보낼 때 쓰는 URL.
    .env 의 KAKAO_REST_API_KEY 와 KAKAO_REDIRECT_URI 로 만든다.
    프론트는 키를 알 필요 없이 이 엔드포인트만 호출하면 됨."""
    if not settings.kakao_rest_api_key:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "KAKAO_REST_API_KEY not configured",
        )
    params = {
        "response_type": "code",
        "client_id": settings.kakao_rest_api_key,
        "redirect_uri": settings.kakao_redirect_uri,
    }
    return {
        "url": f"https://kauth.kakao.com/oauth/authorize?{urlencode(params)}",
        "redirect_uri": settings.kakao_redirect_uri,
    }


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


def _validate_user_id_format(new_id: str) -> None:
    """아이디 길이·허용 문자 검증. 실패 시 HTTPException(400) 발생."""
    if not USER_ID_MIN_LEN <= len(new_id) <= USER_ID_MAX_LEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"아이디는 {USER_ID_MIN_LEN}~{USER_ID_MAX_LEN}자로 입력해주세요.",
        )
    if not USER_ID_PATTERN.match(new_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "아이디는 한글, 영문, 숫자, 밑줄(_)만 쓸 수 있어요.",
        )


def _user_id_taken(
    db: Session, new_id: str, exclude_user_id: int | None = None
) -> bool:
    """다른 사용자가 이미 같은 아이디(대소문자 무시)를 쓰는지 검사."""
    stmt = select(User.id).where(func.lower(User.user_id) == new_id.lower())
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return db.execute(stmt).first() is not None


def _find_user_by_user_id(db: Session, user_id: str) -> User | None:
    """아이디로 사용자 조회 (대소문자 무시)."""
    return (
        db.execute(select(User).where(func.lower(User.user_id) == user_id.lower()))
        .scalars()
        .first()
    )


def _find_or_create_user(db: Session, profile: kakao_service.KakaoProfile) -> User:
    # 카카오가 프로필 사진을 http 로 줄 때가 있어 https 로 맞춘다
    # (운영 https 환경에서 http 이미지가 mixed-content 로 차단되는 것 방지).
    kakao_image = (
        profile.profile_image_url.replace("http://", "https://", 1)
        if profile.profile_image_url
        else None
    )

    user = db.execute(
        select(User).where(User.kakao_id == profile.kakao_id)
    ).scalar_one_or_none()
    if user:
        # 최신 정보로 가볍게 동기화 — 사용자가 직접 바꾼 값(user_id,
        # 직접 올린 프로필 사진)은 건드리지 않으므로 '비어 있을 때만' 채운다.
        if profile.nickname and not user.nickname:
            user.nickname = profile.nickname
        if profile.email and not user.email:
            user.email = profile.email
        if kakao_image and not user.profile_image_path:
            user.profile_image_path = kakao_image
        db.commit()
        db.refresh(user)
        return user

    display_id = f"user_{profile.kakao_id}"
    user = User(
        kakao_id=profile.kakao_id,
        email=profile.email,
        user_id=display_id,
        nickname=profile.nickname,
        # 카카오 가입 시 카카오톡 프로필 사진을 그대로 가져온다
        profile_image_path=kakao_image,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/kakao", response_model=LoginResponse, status_code=status.HTTP_200_OK)
def kakao_login(
    payload: KakaoLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> LoginResponse:
    access_token = kakao_service.exchange_code_for_token(
        payload.code, redirect_uri=payload.redirect_uri
    )
    profile = kakao_service.fetch_profile(access_token)
    user = _find_or_create_user(db, profile)

    jwt_token = create_access_token(user.id)
    _set_auth_cookie(response, jwt_token)
    return LoginResponse(user=UserOut.model_validate(user))


@router.post(
    "/signup",
    response_model=LoginResponse,
    status_code=status.HTTP_201_CREATED,
)
def signup(
    payload: SignupRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """아이디/비밀번호 회원가입 — 가입과 동시에 로그인된다(쿠키 발급)."""
    new_user_id = payload.user_id.strip()
    password = payload.password

    # 1) 형식 검증
    _validate_user_id_format(new_user_id)
    if not PASSWORD_MIN_LEN <= len(password) <= PASSWORD_MAX_LEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"비밀번호는 {PASSWORD_MIN_LEN}~{PASSWORD_MAX_LEN}자로 입력해주세요.",
        )

    # 2) 아이디 중복 검사
    if _user_id_taken(db, new_user_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "이미 누군가 쓰고 있는 아이디예요."
        )

    # 3) 계정 생성
    user = User(user_id=new_user_id, password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # 거의 동시에 같은 아이디를 선점당한 경우 — unique 인덱스가 막아준다
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "이미 누군가 쓰고 있는 아이디예요."
        ) from None
    db.refresh(user)

    # 4) 가입 즉시 로그인 처리
    jwt_token = create_access_token(user.id)
    _set_auth_cookie(response, jwt_token)
    return LoginResponse(user=UserOut.model_validate(user))


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """아이디/비밀번호 로그인."""
    user = _find_user_by_user_id(db, payload.user_id.strip())

    # 보안상 '없는 아이디'와 '틀린 비밀번호'를 구분하지 않는다
    if (
        user is None
        or user.password_hash is None
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "아이디 또는 비밀번호가 올바르지 않아요.",
        )

    jwt_token = create_access_token(user.id)
    _set_auth_cookie(response, jwt_token)
    return LoginResponse(user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    response.delete_cookie(key=settings.auth_cookie_name, path="/")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.patch("/me/user-id", response_model=UserOut)
def change_user_id(
    payload: UserIdUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """설정 탭의 '아이디 변경'.

    규칙: 3~15자 / 한글·영문·숫자·밑줄(_)만 / 다른 사용자와 중복 불가 /
    첫 변경 시점부터 30일 동안 최대 2번까지만 변경 가능.
    """
    new_id = payload.user_id.strip()

    # 1) 형식 검증 — 길이, 허용 문자
    _validate_user_id_format(new_id)

    # 2) 기존 아이디와 같으면 변경 횟수를 소모하지 않고 그대로 둔다
    if new_id == current_user.user_id:
        return current_user

    # 3) 30일 윈도우 안에서 2번을 모두 썼는지 검사
    now = datetime.now(timezone.utc)
    window_start = current_user.user_id_change_window_start
    used = current_user.user_id_change_count

    window_active = (
        window_start is not None
        and now < window_start + timedelta(days=USER_ID_CHANGE_WINDOW_DAYS)
    )
    if not window_active:
        # 윈도우가 없거나 만료됨 → 이번 변경이 새 30일 윈도우의 첫 변경이 된다
        window_start = now
        used = 0

    if used >= USER_ID_MAX_CHANGES_PER_WINDOW:
        next_allowed = window_start + timedelta(days=USER_ID_CHANGE_WINDOW_DAYS)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"아이디는 {USER_ID_CHANGE_WINDOW_DAYS}일에 "
            f"{USER_ID_MAX_CHANGES_PER_WINDOW}번까지만 바꿀 수 있어요. "
            f"{next_allowed.date().isoformat()}부터 다시 변경할 수 있어요.",
        )

    # 4) 중복 검사 — 대소문자 무시, 본인은 제외
    if _user_id_taken(db, new_id, exclude_user_id=current_user.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "이미 누군가 쓰고 있는 아이디예요."
        )

    # 5) 반영
    current_user.user_id = new_id
    current_user.user_id_last_changed_at = now
    current_user.user_id_change_window_start = window_start
    current_user.user_id_change_count = used + 1
    try:
        db.commit()
    except IntegrityError:
        # 거의 동시에 같은 아이디를 선점당한 경우 — unique 인덱스가 막아준다
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "이미 누군가 쓰고 있는 아이디예요."
        ) from None
    db.refresh(current_user)
    return current_user


@router.patch("/me/profile-image", response_model=UserOut)
def change_profile_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """설정 탭의 프로필 사진 변경 — 업로드한 이미지를 저장하고 그 경로를 기록한다.

    직접 올렸던 이전 사진 파일은 새 사진 저장이 끝난 뒤 삭제한다.
    """
    old_path = current_user.profile_image_path
    current_user.profile_image_path = save_profile_image(file)
    db.commit()
    db.refresh(current_user)
    # 새 사진 저장·기록이 끝난 뒤 옛 파일 정리 (로컬 업로드 파일만, 카카오 URL 은 건너뜀)
    delete_profile_image(old_path)
    return current_user


@router.post("/dev-login", response_model=LoginResponse)
def dev_login(
    response: Response,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Local-only test login. Requires ALLOW_DEV_LOGIN=true."""
    if not settings.allow_dev_login:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "dev-login disabled"
        )

    test_kakao_id = "dev-test-user"
    user = db.execute(
        select(User).where(User.kakao_id == test_kakao_id)
    ).scalar_one_or_none()
    if not user:
        user = User(
            kakao_id=test_kakao_id,
            user_id="dev_tester",
            nickname="Dev Tester",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    jwt_token = create_access_token(user.id)
    _set_auth_cookie(response, jwt_token)
    return LoginResponse(user=UserOut.model_validate(user))

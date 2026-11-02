from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()

ALGORITHM = "HS256"

# bcrypt 는 72바이트를 넘는 입력에서 에러를 내므로, 해시·검증 양쪽에서
# 동일하게 잘라 일관성을 맞춘다. (72바이트면 보안 강도는 충분)
_BCRYPT_MAX_BYTES = 72


def hash_password(plain: str) -> str:
    """평문 비밀번호를 bcrypt 해시 문자열로 변환."""
    pw = plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """평문이 저장된 해시와 일치하는지 확인."""
    pw = plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    try:
        return bcrypt.checkpw(pw, hashed.encode("utf-8"))
    except ValueError:
        # 저장된 해시 형식이 깨진 경우 — 로그인 실패로 처리
        return False


def create_access_token(subject: str | int, expires_minutes: int | None = None) -> str:
    expire = datetime.now(UTC) + timedelta(
        minutes=expires_minutes or settings.access_token_expire_minutes
    )
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


# 자동 로그인(슬라이딩 연장): 발급된 지 이만큼 지난 토큰은 요청이 올 때 새로 발급한다.
# 하루에 최대 한 번만 재발급되므로 매 요청마다 쿠키를 갈아끼우지 않는다.
TOKEN_RENEW_AFTER = timedelta(days=1)


def token_needs_renewal(token: str) -> bool:
    """유효한 토큰인데 발급된 지 TOKEN_RENEW_AFTER 이상 지났으면 True.

    토큰에 발급 시각(iat)이 없어서 '만료까지 남은 시간'으로 역산한다.
    (남은 시간 < 전체 수명 - 1일  ==  발급된 지 1일 넘음)
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return False
    exp = payload.get("exp")
    if exp is None:
        return False
    remaining = datetime.fromtimestamp(exp, UTC) - datetime.now(UTC)
    lifetime = timedelta(minutes=settings.access_token_expire_minutes)
    return remaining < lifetime - TOKEN_RENEW_AFTER

"""Sign in with Apple — identity token 검증과 토큰 발급/폐기.

흐름:
  1) 앱(iOS)이 ASAuthorizationController 로 identity token(JWT)과
     authorization code 를 받아 POST /api/auth/apple 로 보낸다.
  2) verify_identity_token(): Apple 공개키(JWKS)로 서명을 검증하고
     iss/aud/exp/nonce 를 확인한 뒤 sub(사용자 고유 ID)를 돌려준다.
  3) 서버에 Apple 키(.p8)가 설정돼 있으면 exchange_code() 로 refresh token 을
     받아 저장해 두고, 탈퇴 때 revoke_token() 으로 폐기한다(App Store 5.1.1(v)).
"""
import hashlib
import hmac
import logging
import time

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"

# Apple 공개키는 자주 바뀌지 않는다. 매 로그인마다 받지 않도록 잠깐 캐시한다.
_JWKS_TTL_SECONDS = 60 * 60
_jwks_cache: dict = {"keys": [], "fetched_at": 0.0}


def _fetch_jwks(force: bool = False) -> list[dict]:
    now = time.time()
    if not force and _jwks_cache["keys"] and now - _jwks_cache["fetched_at"] < _JWKS_TTL_SECONDS:
        return _jwks_cache["keys"]
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(APPLE_KEYS_URL)
    if resp.status_code != 200:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Apple 공개키를 가져오지 못했어요."
        )
    _jwks_cache["keys"] = resp.json().get("keys", [])
    _jwks_cache["fetched_at"] = now
    return _jwks_cache["keys"]


def _find_key(kid: str) -> dict | None:
    for key in _fetch_jwks():
        if key.get("kid") == kid:
            return key
    # 키가 교체됐을 수 있으니 캐시를 무시하고 한 번 더 받아 본다
    for key in _fetch_jwks(force=True):
        if key.get("kid") == kid:
            return key
    return None


def verify_identity_token(identity_token: str, raw_nonce: str) -> dict:
    """identity token 을 검증하고 claims(dict)를 돌려준다. 실패 시 401."""
    invalid = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Apple 로그인 정보를 확인하지 못했어요."
    )
    try:
        header = jwt.get_unverified_header(identity_token)
    except JWTError:
        raise invalid from None

    key = _find_key(header.get("kid", ""))
    if key is None:
        raise invalid

    try:
        claims = jwt.decode(
            identity_token,
            key,
            algorithms=["RS256"],
            audience=settings.apple_client_id,
            issuer=APPLE_ISSUER,
            # at_hash 는 access token 이 없어 검증 대상이 아니다
            options={"verify_at_hash": False},
        )
    except JWTError as exc:
        logger.info("apple identity token rejected: %s", exc)
        raise invalid from None

    # 앱은 원본 nonce 의 SHA-256 을 Apple 에 넘기고, 원본은 서버로 보낸다.
    # 토큰 안의 nonce 와 비교해 다른 요청의 토큰을 재사용하는 것을 막는다.
    # nonce 는 필수 — 빠지면 검증을 건너뛰게 되므로 거부한다.
    if not raw_nonce:
        raise invalid
    expected = hashlib.sha256(raw_nonce.encode()).hexdigest()
    if not hmac.compare_digest(str(claims.get("nonce", "")), expected):
        raise invalid

    if not claims.get("sub"):
        raise invalid
    return claims


def _revoke_configured() -> bool:
    return bool(settings.apple_team_id and settings.apple_key_id and settings.apple_private_key)


def _client_secret() -> str:
    """Apple REST API 용 client_secret (ES256 JWT, 최대 6개월 유효 — 여기선 5분)."""
    now = int(time.time())
    private_key = settings.apple_private_key.replace("\\n", "\n")
    return jwt.encode(
        {
            "iss": settings.apple_team_id,
            "iat": now,
            "exp": now + 300,
            "aud": APPLE_ISSUER,
            "sub": settings.apple_client_id,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": settings.apple_key_id},
    )


def exchange_code(authorization_code: str) -> str | None:
    """authorization code → refresh token. 키 미설정·실패 시 None (로그인은 계속)."""
    if not _revoke_configured() or not authorization_code:
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                APPLE_TOKEN_URL,
                data={
                    "client_id": settings.apple_client_id,
                    "client_secret": _client_secret(),
                    "code": authorization_code,
                    "grant_type": "authorization_code",
                },
            )
        if resp.status_code != 200:
            logger.warning("apple code exchange failed: %s %s", resp.status_code, resp.text)
            return None
        return resp.json().get("refresh_token")
    except Exception as exc:  # noqa: BLE001 — 로그인 자체는 막지 않는다
        logger.warning("apple code exchange error: %s", exc)
        return None


def revoke_token(refresh_token: str | None) -> None:
    """탈퇴 시 Apple 토큰 폐기 (best-effort — 실패해도 탈퇴는 진행)."""
    if not refresh_token or not _revoke_configured():
        return
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                APPLE_REVOKE_URL,
                data={
                    "client_id": settings.apple_client_id,
                    "client_secret": _client_secret(),
                    "token": refresh_token,
                    "token_type_hint": "refresh_token",
                },
            )
        if resp.status_code != 200:
            logger.warning("apple revoke failed: %s %s", resp.status_code, resp.text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("apple revoke error: %s", exc)

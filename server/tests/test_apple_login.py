"""Sign in with Apple 토큰 검증 · AI 동의 가드 단위 테스트 (네트워크·DB 없음)."""
import hashlib
import json
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException
from jose import jwk, jwt

from app.core import deps
from app.services import apple

KID = "test-kid"


@pytest.fixture
def rsa_key(monkeypatch):
    """가짜 Apple 서명키를 만들고 JWKS 조회를 그 공개키로 바꿔치기한다."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    public_jwk = jwk.construct(public_pem, "RS256").to_dict()
    public_jwk = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in public_jwk.items()}
    public_jwk["kid"] = KID
    monkeypatch.setattr(apple, "_fetch_jwks", lambda force=False: [public_jwk])
    return pem


def _token(pem, **overrides):
    now = int(time.time())
    claims = {
        "iss": apple.APPLE_ISSUER,
        "aud": apple.settings.apple_client_id,
        "sub": "001234.abcdef.5678",
        "iat": now,
        "exp": now + 600,
        "nonce": hashlib.sha256(b"raw-nonce").hexdigest(),
    }
    claims.update(overrides)
    return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": KID})


def test_valid_token_returns_sub(rsa_key):
    claims = apple.verify_identity_token(_token(rsa_key), "raw-nonce")
    assert claims["sub"] == "001234.abcdef.5678"


@pytest.mark.parametrize(
    "overrides, nonce",
    [
        ({}, "other-nonce"),                       # nonce 불일치(재사용 방지)
        ({}, ""),                                  # nonce 누락 — 검증 우회 불가
        ({"nonce": None}, "raw-nonce"),            # 토큰에 nonce 없음
        ({"aud": "com.someone.else"}, "raw-nonce"),  # 다른 앱용 토큰
        ({"iss": "https://evil.example"}, "raw-nonce"),
        ({"exp": int(time.time()) - 10}, "raw-nonce"),  # 만료
    ],
)
def test_invalid_tokens_rejected(rsa_key, overrides, nonce):
    with pytest.raises(HTTPException) as exc:
        apple.verify_identity_token(_token(rsa_key, **overrides), nonce)
    assert exc.value.status_code == 401


def test_unknown_kid_rejected(rsa_key):
    token = jwt.encode(
        json.loads('{"sub": "x"}'), rsa_key, algorithm="RS256", headers={"kid": "nope"}
    )
    with pytest.raises(HTTPException):
        apple.verify_identity_token(token, "raw-nonce")


def test_client_secret_is_es256_with_kid(monkeypatch):
    ec_pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    monkeypatch.setattr(apple.settings, "apple_team_id", "TEAM123456")
    monkeypatch.setattr(apple.settings, "apple_key_id", "KEY1234567")
    # .env 에 한 줄로 넣은 경우(\n 이스케이프)도 처리돼야 한다
    monkeypatch.setattr(apple.settings, "apple_private_key", ec_pem.replace("\n", "\\n"))
    secret = apple._client_secret()
    header = jwt.get_unverified_header(secret)
    assert header["alg"] == "ES256" and header["kid"] == "KEY1234567"
    assert jwt.get_unverified_claims(secret)["iss"] == "TEAM123456"


def test_revoke_skipped_without_keys(monkeypatch):
    monkeypatch.setattr(apple.settings, "apple_private_key", None)
    # 키가 없으면 네트워크 호출 없이 조용히 넘어가야 한다
    apple.revoke_token("some-refresh-token")
    assert apple.exchange_code("some-code") is None


def test_ai_consent_guard():
    with pytest.raises(HTTPException) as exc:
        deps.get_ai_consented_user(SimpleNamespace(ai_consent_at=None))
    assert exc.value.status_code == 403
    assert exc.value.detail == "AI_CONSENT_REQUIRED"

    user = SimpleNamespace(ai_consent_at=datetime.now(timezone.utc))
    assert deps.get_ai_consented_user(user) is user

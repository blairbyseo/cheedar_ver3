from dataclasses import dataclass

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings

settings = get_settings()

KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"
KAKAO_USER_URL = "https://kapi.kakao.com/v2/user/me"


@dataclass
class KakaoProfile:
    kakao_id: str
    email: str | None
    nickname: str | None
    profile_image_url: str | None


def _require_keys() -> None:
    if not settings.kakao_rest_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Kakao login is not configured"
        )


def exchange_code_for_token(code: str, redirect_uri: str | None = None) -> str:
    """Exchange Kakao authorization code for an access token."""
    _require_keys()
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.kakao_rest_api_key,
        "redirect_uri": redirect_uri or settings.kakao_redirect_uri,
        "code": code,
    }
    if settings.kakao_client_secret:
        data["client_secret"] = settings.kakao_client_secret

    with httpx.Client(timeout=10.0) as client:
        resp = client.post(
            KAKAO_TOKEN_URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code != 200:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Kakao token exchange failed: {resp.text}",
        )
    return resp.json()["access_token"]


def fetch_profile(access_token: str) -> KakaoProfile:
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(
            KAKAO_USER_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code != 200:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Kakao profile fetch failed: {resp.text}",
        )
    payload = resp.json()
    account = payload.get("kakao_account", {}) or {}
    profile = account.get("profile", {}) or {}
    return KakaoProfile(
        kakao_id=str(payload["id"]),
        email=account.get("email"),
        nickname=profile.get("nickname"),
        profile_image_url=profile.get("profile_image_url"),
    )

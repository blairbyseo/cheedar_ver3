"""자동 로그인(슬라이딩 연장) 테스트.

앱을 쓰는 동안엔 만료일이 계속 뒤로 밀려야 하고, 하루에 한 번만 재발급해야 한다.
"""
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from fastapi import Response
from jose import jwt

from app.core import deps, security
from app.core.config import get_settings

settings = get_settings()


def _token_issued_ago(age: timedelta) -> str:
    """age 만큼 전에 발급된 것처럼 보이는 토큰(만료 = 발급 + 전체 수명)."""
    lifetime = timedelta(minutes=settings.access_token_expire_minutes)
    exp = datetime.now(UTC) - age + lifetime
    return jwt.encode(
        {"sub": "1", "exp": exp}, settings.secret_key, algorithm=security.ALGORITHM
    )


class _FakeDb:
    def get(self, _model, _id):
        return SimpleNamespace(id=1, deleted_at=None)


def _call(cookie_token=None, auth_header=None):
    headers = {"Authorization": auth_header} if auth_header else {}
    request = SimpleNamespace(headers=headers)
    response = Response()
    user = deps.get_current_user(request, response, _FakeDb(), cookie_token)
    return user, response.headers.get("set-cookie")


def test_fresh_token_is_not_renewed():
    assert not security.token_needs_renewal(_token_issued_ago(timedelta(hours=1)))
    _, cookie = _call(cookie_token=_token_issued_ago(timedelta(hours=1)))
    assert cookie is None


def test_day_old_token_is_renewed():
    old = _token_issued_ago(timedelta(days=2))
    assert security.token_needs_renewal(old)
    user, cookie = _call(cookie_token=old)
    assert user.id == 1
    assert cookie is not None
    assert cookie.startswith(f"{settings.auth_cookie_name}=")
    new_token = cookie.split(";", 1)[0].split("=", 1)[1]
    assert new_token != old
    assert not security.token_needs_renewal(new_token)


def test_bearer_token_is_not_renewed():
    old = _token_issued_ago(timedelta(days=2))
    _, cookie = _call(auth_header=f"Bearer {old}")
    assert cookie is None


def test_invalid_token_does_not_need_renewal():
    assert not security.token_needs_renewal("not-a-jwt")

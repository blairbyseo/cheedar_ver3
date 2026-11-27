"""접속 기기 판별(아이폰/갤럭시/웹)과 users.last_platform 갱신 테스트."""
from types import SimpleNamespace

import pytest

from app.core import deps


@pytest.mark.parametrize(
    "headers,expected",
    [
        # 앱이 직접 보내는 헤더가 최우선
        ({"X-Client-Platform": "ios", "User-Agent": "Dalvik/2.1.0"}, "ios"),
        ({"X-Client-Platform": "Android"}, "android"),
        # 구버전 앱(CapacitorHttp 네이티브 HTTP)의 기본 User-Agent
        ({"User-Agent": "Dalvik/2.1.0 (Linux; U; Android 14; SM-S921N Build/UP1A)"}, "android"),
        ({"User-Agent": "Cheddar/17 CFNetwork/1490.0.4 Darwin/23.2.0"}, "ios"),
        # 폰 브라우저 / WebView
        ({"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"}, "ios"),
        ({"User-Agent": "Mozilla/5.0 (Linux; Android 14; SM-S921N) Chrome/120"}, "android"),
        # PC 브라우저
        ({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"}, "web"),
        # 도구·알 수 없는 값은 None → 기존 값을 덮어쓰지 않는다
        ({"User-Agent": "curl/8.4.0"}, None),
        ({"X-Client-Platform": "windows-phone"}, None),
        ({}, None),
    ],
)
def test_detect_platform(headers, expected):
    assert deps.detect_platform(headers) == expected


class _Db:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def _request(headers, path="/api/health/steps"):
    # 기본은 걸음 자동 업로드 경로 — 최근 사용 시각은 건드리지 않아 기기 갱신만 본다.
    return SimpleNamespace(headers=headers, url=SimpleNamespace(path=path))


def _remember(headers, current):
    user = SimpleNamespace(last_platform=current, last_active_at=None)
    db = _Db()
    deps._remember_usage(_request(headers), user, db)
    return user.last_platform, db.commits


def test_platform_saved_when_changed():
    assert _remember({"X-Client-Platform": "ios"}, None) == ("ios", 1)
    assert _remember({"X-Client-Platform": "android"}, "ios") == ("android", 1)


def test_platform_not_rewritten_when_same_or_unknown():
    assert _remember({"X-Client-Platform": "ios"}, "ios") == ("ios", 0)
    assert _remember({"User-Agent": "curl/8.4.0"}, "android") == ("android", 0)


def test_last_active_set_on_normal_request():
    user = SimpleNamespace(last_platform="ios", last_active_at=None)
    db = _Db()
    deps._remember_usage(_request({"X-Client-Platform": "ios"}, "/api/meals"), user, db)
    assert user.last_active_at is not None and db.commits == 1


def test_last_active_throttled_within_5_minutes():
    from datetime import datetime, timedelta, timezone

    recent = datetime.now(timezone.utc) - timedelta(minutes=2)
    user = SimpleNamespace(last_platform="ios", last_active_at=recent)
    db = _Db()
    deps._remember_usage(_request({"X-Client-Platform": "ios"}, "/api/meals"), user, db)
    assert user.last_active_at == recent and db.commits == 0

    old = datetime.now(timezone.utc) - timedelta(minutes=10)
    user.last_active_at = old
    deps._remember_usage(_request({"X-Client-Platform": "ios"}, "/api/meals"), user, db)
    assert user.last_active_at > old and db.commits == 1


def test_background_health_upload_is_not_usage():
    user = SimpleNamespace(last_platform="android", last_active_at=None)
    db = _Db()
    deps._remember_usage(
        _request({"X-Client-Platform": "android"}, "/api/health/sleep"), user, db
    )
    assert user.last_active_at is None and db.commits == 0

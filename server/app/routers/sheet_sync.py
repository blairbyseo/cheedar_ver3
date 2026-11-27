"""구글시트 '체다 사용자 데이터' 자동 동기화용 읽기 전용 주소.

시트에 붙인 Apps Script(docs/google_sheet_sync.gs)가 10분마다 호출해 두 시트를 덮어쓴다.
- 참여율: 아이디 · 닉네임 · XP (높은 순)
- 건강 데이터: 걸음·수면 요약 (건강 기록이 있는 회원만, 출처 열은 넣지 않음)

보안: 관리자 로그인 대신 비밀 토큰(X-Sync-Token)으로 연다. 토큰은 시트 편집자에게 보일 수
있으므로, 이 주소는 **시트에 이미 보이는 값만** 돌려준다(이메일·채팅·설문 등은 절대 넣지 않는다).
"""

import secrets
from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.user import User

router = APIRouter(prefix="/api/sheet-sync", tags=["sheet-sync"])

KST = timezone(timedelta(hours=9))
HEALTH_DAYS = 180
SLEEP_ODD_SHORT_MIN = 180  # 3시간 미만
SLEEP_ODD_LONG_MIN = 720  # 12시간 초과

PARTICIPATION_HEADER = ["아이디", "닉네임 (카카오아이디)", "XP (참여율 높은 순)"]
# 건강 기록이 있는 회원이 한 명도 없을 때 시트에 남길 머리글
_EMPTY_HEALTH_HEADER = ["아이디", "닉네임", "건강 기록 없음"]

def _check_token(token: str | None) -> None:
    expected = get_settings().sheet_sync_token
    if not expected:
        # 꺼져 있으면 주소가 없는 것처럼
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid sync token")


def _fmt_minutes(minutes: float | None) -> str:
    if minutes is None:
        return ""
    m = round(minutes)
    return f"{m // 60}시간 {m % 60}분"


def _fmt_dt(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(KST).strftime("%Y-%m-%d %H:%M")


def _avg(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _avg_clock(times: list[datetime], pivot_hour: int) -> str:
    """시각(KST)의 평균 — 자정을 넘나드는 잠든 시각을 위해 pivot_hour 를 하루의 시작으로 본다.

    예) pivot 12시: 23:00 과 01:00 의 평균은 00:00 (12:00 기준 660분·780분 → 720분).
    """
    if not times:
        return ""
    offsets = []
    for t in times:
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        k = t.astimezone(KST)
        offsets.append(((k.hour - pivot_hour) % 24) * 60 + k.minute)
    mean = round(sum(offsets) / len(offsets))
    total = (mean + pivot_hour * 60) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def _round(v: float | None) -> int | str:
    return round(v) if v is not None else ""


@router.get("")
def sheet_sync(
    x_sync_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    _check_token(x_sync_token)

    today = datetime.now(KST).date()
    start = today - timedelta(days=HEALTH_DAYS - 1)
    d7 = today - timedelta(days=6)
    d30 = today - timedelta(days=29)

    users = db.execute(
        select(User)
        .where(User.deleted_at.is_(None))
        .order_by(User.xp.desc(), User.id.asc())
    ).scalars().all()
    by_id = {u.id: u for u in users}

    participation = [PARTICIPATION_HEADER] + [
        [u.user_id, u.nickname or "", u.xp] for u in users
    ]

    steps: dict[int, list[DailySteps]] = {}
    for r in db.execute(
        select(DailySteps).where(DailySteps.day >= start, DailySteps.day <= today)
    ).scalars():
        if r.user_id in by_id:
            steps.setdefault(r.user_id, []).append(r)
    sleep: dict[int, list[DailySleep]] = {}
    for r in db.execute(
        select(DailySleep).where(DailySleep.day >= start, DailySleep.day <= today)
    ).scalars():
        if r.user_id in by_id:
            sleep.setdefault(r.user_id, []).append(r)

    def _latest_day(uid: int) -> DateType:
        days = [r.day for r in steps.get(uid, []) + sleep.get(uid, [])]
        return max(days) if days else DateType.min

    health_header: list[str] = []
    health_rows = []
    for uid in sorted(set(steps) | set(sleep), key=lambda i: (_latest_day(i), -i), reverse=True):
        u = by_id[uid]
        st = sorted(steps.get(uid, []), key=lambda r: r.day, reverse=True)
        sl = sorted(sleep.get(uid, []), key=lambda r: r.day, reverse=True)
        st_last = st[0] if st else None
        sl_last = sl[0] if sl else None
        st7 = [r.steps for r in st if r.day >= d7]
        st30 = [r.steps for r in st if r.day >= d30]
        sl7 = [r.asleep_minutes for r in sl if r.day >= d7]
        sl30 = [r for r in sl if r.day >= d30]
        avg_sleep_all = _avg([r.asleep_minutes for r in sl])
        odd = sum(
            1
            for r in sl
            if r.asleep_minutes < SLEEP_ODD_SHORT_MIN or r.asleep_minutes > SLEEP_ODD_LONG_MIN
        )
        uploaded = [r.updated_at for r in st + sl if r.updated_at]

        # (머리글, 값) 쌍 — 걸음 열끼리, 수면 열끼리 모아 둔다(시트에서 머리글 색으로 구분).
        cols = [
            ("아이디", u.user_id),
            ("닉네임", u.nickname or ""),
            # 걸음
            ("최근 걸음 기록일", st_last.day.isoformat() if st_last else ""),
            ("최근 걸음수", st_last.steps if st_last else ""),
            ("최근 7일 평균 걸음수", _round(_avg(st7))),
            ("최근 30일 평균 걸음수", _round(_avg(st30))),
            ("평균 걸음수(180일)", _round(_avg([r.steps for r in st]))),
            ("최근 7일 걸음 기록일수", len(st7)),
            ("걸음 기록일수(180일)", len(st)),
            # 수면 (최근 = 기상일이 가장 늦은 하룻밤)
            ("최근 수면 기록일(기상일)", sl_last.day.isoformat() if sl_last else ""),
            ("수면시간(분)", sl_last.asleep_minutes if sl_last else ""),
            ("수면시간", _fmt_minutes(sl_last.asleep_minutes) if sl_last else ""),
            ("잠든 시각", _fmt_dt(sl_last.bed_start) if sl_last else ""),
            ("일어난 시각", _fmt_dt(sl_last.wake_end) if sl_last else ""),
            ("최근 7일 평균 수면시간", _fmt_minutes(_avg(sl7))),
            ("최근 30일 평균 수면시간", _fmt_minutes(_avg([r.asleep_minutes for r in sl30]))),
            ("평균 수면시간(분, 180일)", _round(avg_sleep_all)),
            ("평균 수면시간(180일)", _fmt_minutes(avg_sleep_all)),
            ("평균 잠든 시각(30일)", _avg_clock([r.bed_start for r in sl30 if r.bed_start], pivot_hour=12)),
            ("평균 일어난 시각(30일)", _avg_clock([r.wake_end for r in sl30 if r.wake_end], pivot_hour=0)),
            ("최근 7일 수면 기록일수", len(sl7)),
            ("수면 기록일수(180일)", len(sl)),
            ("이상 수면 기록 수(180일, 3시간 미만·12시간 초과)", odd),
            # 공통
            ("마지막 건강정보 업로드", _fmt_dt(max(uploaded)) if uploaded else ""),
        ]
        health_header = [name for name, _ in cols]
        health_rows.append([value for _, value in cols])

    return {
        "updated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "participation": participation,
        "health": [health_header or _EMPTY_HEALTH_HEADER] + health_rows,
    }

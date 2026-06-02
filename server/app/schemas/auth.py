from datetime import datetime

from pydantic import BaseModel, Field


class KakaoLoginRequest(BaseModel):
    code: str
    # 프론트에서 같은 도메인이 아닌 다른 redirect_uri를 썼다면 명시. 기본값은 서버 .env.
    redirect_uri: str | None = None


class UserOut(BaseModel):
    id: int
    user_id: str
    nickname: str | None = None
    email: str | None = None
    profile_image_path: str | None = None
    # 신체 정보 — 회원가입 때 입력. 운동 칼로리 계산 등에 쓰인다.
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    # 아이디 변경 제한(30일 2회) 계산용 —
    # 프론트가 남은 변경 횟수와 잠금 해제일을 표시하는 데 쓴다.
    user_id_change_window_start: datetime | None = None
    user_id_change_count: int = 0
    # 관리자 화면 접근 가능 여부 — 프론트(frontend_admin)가 로그인 후 확인.
    is_admin: bool = False

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    user: UserOut


class UserIdUpdateRequest(BaseModel):
    """설정 탭의 '아이디 변경' 요청 바디.

    형식 검증(길이·허용 문자)은 명확한 한국어 에러 메시지를 주기 위해
    라우터에서 직접 수행한다.
    """

    user_id: str


# ── 아이디/비밀번호 회원가입·로그인 ───────────────────────────────────
# 형식 검증(아이디 규칙·비밀번호 길이)은 라우터에서 직접 수행한다.


class SignupRequest(BaseModel):
    user_id: str
    password: str
    # 신체 정보 — 회원가입 폼에서 함께 입력받는다.
    # 범위 검증은 명확한 한국어 메시지를 위해 라우터에서 함께 처리.
    age: int | None = Field(default=None, ge=1, le=120)
    height_cm: float | None = Field(default=None, ge=50, le=250)
    weight_kg: float | None = Field(default=None, ge=20, le=400)


class LoginRequest(BaseModel):
    user_id: str
    password: str

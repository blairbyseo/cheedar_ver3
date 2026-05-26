from datetime import datetime

from pydantic import BaseModel


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
    # 아이디 변경 제한(30일 2회) 계산용 —
    # 프론트가 남은 변경 횟수와 잠금 해제일을 표시하는 데 쓴다.
    user_id_change_window_start: datetime | None = None
    user_id_change_count: int = 0

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


class LoginRequest(BaseModel):
    user_id: str
    password: str

from datetime import datetime

from pydantic import BaseModel, Field


class KakaoLoginRequest(BaseModel):
    code: str
    # 프론트에서 같은 도메인이 아닌 다른 redirect_uri를 썼다면 명시. 기본값은 서버 .env.
    redirect_uri: str | None = None
    # 초대코드 — 처음 보는 카카오 계정일 때만 필요하다. 이미 가입한 계정은
    # 비어 있어도 그대로 로그인된다(프론트가 매번 물어보지 않게 하기 위함).
    invite_code: str | None = None


class InviteCodeCheckRequest(BaseModel):
    """초대코드 사전 확인 요청 — 가입 폼을 띄우기 전에 코드만 검사한다."""

    code: str


class InviteCodeCheckResponse(BaseModel):
    # 정규화(대문자·공백 제거)된 코드. 앱은 이 값을 저장해뒀다가 가입 요청에 싣는다.
    code: str
    # 관리자가 붙여둔 라벨("1차 참여자" 등). 사용자에게 확인용으로 보여줄 수 있다.
    label: str | None = None


class AppleLoginRequest(BaseModel):
    """앱(iOS)의 Sign in with Apple 결과.

    nonce 는 앱이 만든 원본 값 — Apple 에는 SHA-256 해시를 넘겼다.
    이름은 Apple 이 '첫 로그인'에만 주므로 있을 때만 온다.
    """

    identity_token: str
    authorization_code: str | None = None
    nonce: str = Field(min_length=16)
    given_name: str | None = None
    family_name: str | None = None
    # 신규 가입일 때만 필요 (카카오 가입과 같은 규칙)
    invite_code: str | None = None


class AiConsentRequest(BaseModel):
    """외부 AI(OpenAI) 데이터 전송 동의(True) 또는 철회(False)."""

    agree: bool


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
    # 아이디/비밀번호 계정인지(카카오 전용 계정이면 False).
    # 회원탈퇴 시 비밀번호 확인란을 띄울지 판단하는 데 쓴다.
    has_password: bool = False
    # 외부 AI(OpenAI) 데이터 전송 동의 여부. False 면 앱이 AI 기능 전에 동의를 받는다.
    ai_consented: bool = False

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
    # 초대코드 — 가입에 반드시 필요하다.
    invite_code: str | None = None
    # 신체 정보 — 회원가입 폼에서 함께 입력받는다.
    # 범위 검증은 명확한 한국어 메시지를 위해 라우터에서 함께 처리.
    age: int | None = Field(default=None, ge=1, le=120)
    height_cm: float | None = Field(default=None, ge=50, le=250)
    weight_kg: float | None = Field(default=None, ge=20, le=400)


class LoginRequest(BaseModel):
    user_id: str
    password: str


class WithdrawRequest(BaseModel):
    """회원탈퇴 요청 바디.

    아이디/비밀번호 계정은 본인 확인을 위해 password 가 필요하다.
    카카오 계정은 비밀번호가 없으므로 생략 가능(앱에서 한 번 더 확인 모달).
    """

    password: str | None = None

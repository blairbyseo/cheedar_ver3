from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database ----------------------------------------------------------
    # Accepts either `postgresql://...` or `postgresql+psycopg://...`.
    # We normalize to psycopg3 driver via field_validator below.
    database_url: str = Field(
        default="postgresql+psycopg://cheddar:cheddar_dev@localhost:5432/cheddar"
    )

    # --- App / auth --------------------------------------------------------
    secret_key: str = Field(default="dev-secret-change-me")
    access_token_expire_minutes: int = 60 * 24 * 7

    # Cookie used to store the JWT on the browser
    auth_cookie_name: str = "cheddar_auth"
    # In prod (https) we want Secure cookies; locally we don't.
    cookie_secure: bool = False
    cookie_samesite: str = "lax"  # 'lax' | 'strict' | 'none'

    # --- CORS --------------------------------------------------------------
    # Real .env uses CORS_ALLOW_ORIGINS — accept either name.
    cors_allow_origins: str = Field(
        # 5173: 사용자 프론트(Vite), 3000: 카카오 redirect, 3001: 관리자 프론트
        default="http://localhost:5173,http://localhost:3000,http://localhost:3001",
        validation_alias="CORS_ALLOW_ORIGINS",
    )

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _strip_duplicate_prefix(cls, v: str) -> str:
        # Tolerate the historical typo: `CORS_ALLOW_ORIGINS=CORS_ALLOW_ORIGINS=...`
        if isinstance(v, str) and v.lower().startswith("cors_allow_origins="):
            return v.split("=", 1)[1]
        return v

    # --- Uploads -----------------------------------------------------------
    upload_dir: str = "./uploads"   # 로컬 임시 저장 (S3 업로드 실패 시 fallback 용도)
    max_upload_mb: int = 10

    # --- Exercise ----------------------------------------------------------
    # 운동 소모 칼로리 계산(MET×체중×시간)용 기본 체중(kg). 회원가입 때 체중을
    # 입력하지 않은 사용자(예: 카카오 가입자)에게 폴백으로 쓰인다.
    default_weight_kg: float = 70.0

    # --- AWS / S3 ----------------------------------------------------------
    # boto3 가 AWS 자격증명을 찾는 우선순위:
    #   1) .env 또는 환경변수 (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    #   2) ~/.aws/credentials  (aws configure 로 만든 파일)
    #   3) EC2 / ECS IAM Role
    # 로컬 개발에선 2번(aws configure)이면 충분하므로 키는 None 으로 둠.
    aws_region: str = "ap-northeast-2"
    s3_bucket: str = "cheddar-0519"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None

    # --- Kakao OAuth -------------------------------------------------------
    kakao_rest_api_key: str | None = None
    kakao_client_secret: str | None = None
    kakao_redirect_uri: str = "http://localhost:3000/oauth/kakao/callback"

    # --- OpenAI ------------------------------------------------------------
    openai_api_key: str | None = None
    openai_model: str = "gpt-5-mini"

    # When true, /api/meals/analyze returns a fixed mock instead of calling OpenAI.
    ai_mock_mode: bool = False

    # When true, /api/auth/dev-login endpoint is enabled — bypasses Kakao for
    # local testing. Must be False in production.
    allow_dev_login: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def normalized_database_url(self) -> str:
        """SQLAlchemy URL using the psycopg3 driver."""
        url = self.database_url
        if url.startswith("postgresql://"):
            return "postgresql+psycopg://" + url[len("postgresql://"):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()

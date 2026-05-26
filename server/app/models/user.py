from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Kakao 고유 식별자 (string으로 저장 — Kakao id는 큰 정수).
    # 아이디/비밀번호 가입자는 카카오 ID가 없으므로 nullable.
    kakao_id: Mapped[str | None] = mapped_column(
        String(40), unique=True, index=True, nullable=True
    )

    # 카카오가 제공한 이메일(있을 때만). 아이디/비밀번호 가입자는 None.
    email: Mapped[str | None] = mapped_column(
        String(255), unique=True, index=True, nullable=True
    )

    # 로그인·화면 표시에 쓰는 아이디 (사용자가 설정에서 변경 가능)
    user_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    nickname: Mapped[str | None] = mapped_column(String(80), nullable=True)
    profile_image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # 아이디/비밀번호 가입자의 비밀번호 해시. 카카오 가입자는 None.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- 아이디 변경 제한 (첫 변경부터 30일간 최대 2회) ----------------------
    # 마지막으로 아이디를 바꾼 시각 (참고용)
    user_id_last_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 현재 30일 제한 윈도우가 시작된 시각 (= 윈도우 내 첫 변경 시각)
    user_id_change_window_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 현재 윈도우 안에서 아이디를 바꾼 횟수 (0~2)
    user_id_change_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    # --- 포인트/경험치 -----------------------------------------------------
    # 환자 1명마다 따로 쌓인다. 적립이 일어나면 둘이 '같은 값만큼' 함께 오른다.
    # xp: 누적 경험치. 레벨 판정 기준. 절대 줄지 않는다.
    # cp: 소비 가능한 포인트. 적립은 xp와 함께지만 이후 차감될 수 있다.
    xp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    cp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def normalize_code(raw: str) -> str:
    """입력받은 코드를 저장·비교용 형태로 통일한다.

    카톡으로 받은 코드를 손으로 옮겨 치는 상황이라 대소문자와 앞뒤 공백은
    무시한다. 한글 코드는 upper() 의 영향을 받지 않으므로 그대로 남는다.
    """
    return raw.strip().upper()


class InviteCode(Base):
    """가입 초대코드 1건.

    프로덕션(공개 출시) 이후에도 아무나 가입하지 못하게 막는 장치다.
    아이디 회원가입과 카카오 첫 로그인 **양쪽**에서 이 코드를 요구한다.
    이미 가입한 사용자는 영향을 받지 않는다 — 코드는 계정을 '만들 때'만 쓰인다.

    운영 방식은 max_uses 하나로 결정된다.
      · 공용 코드   max_uses = NULL   무제한 (심사용 코드가 이것)
      · 그룹 코드   max_uses = 30     선착순 30명
      · 1인 1코드   max_uses = 1

    code 는 항상 normalize_code() 를 거친 대문자로 저장한다.
    """

    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(primary_key=True)

    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)

    # 이 코드를 누구에게 줬는지 적어두는 메모 ("1차 참여자", "심사용" 등)
    label: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # 가입 가능 인원. NULL 이면 무제한.
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 실제로 이 코드로 가입한 인원
    used_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    # 만료 시각. NULL 이면 무기한.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # 유출 등으로 즉시 막아야 할 때 내리는 스위치
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def remaining(self) -> int | None:
        """남은 가입 가능 인원. 무제한이면 None."""
        if self.max_uses is None:
            return None
        return max(self.max_uses - self.used_count, 0)

    def unusable_reason(self, now: datetime) -> str | None:
        """지금 이 코드로 가입할 수 없는 이유. 쓸 수 있으면 None.

        사용자에게 그대로 보여줄 한국어 문장을 돌려준다 — "왜 안 되는지"를
        알려줘야 코드를 다시 받아오든 문의하든 할 수 있기 때문이다.
        """
        if not self.is_active:
            return "사용할 수 없는 초대코드예요. 코드를 준 분께 확인해 주세요."
        if self.expires_at is not None and self.expires_at <= now:
            return "기간이 지난 초대코드예요. 새 코드를 받아 주세요."
        if self.max_uses is not None and self.used_count >= self.max_uses:
            return "이 초대코드는 정원이 모두 찼어요. 코드를 준 분께 문의해 주세요."
        return None

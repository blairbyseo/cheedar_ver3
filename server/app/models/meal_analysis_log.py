from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MealAnalysisLog(Base):
    """식단 AI 분석(/api/meals/analyze) 1회의 소요 시간 기록.

    분석은 저장 전에 일어나서 meals 행이 아직 없다. 사진이 있으면 image_path 가
    저장된 meals.image_path 와 같으므로 그걸로 이어 볼 수 있다.
    시간은 모두 서버가 요청을 받은 뒤부터 잰 값이라 앱→서버 업로드 시간은 빠져 있다.
      save_ms  : 사진 검증·리사이즈·S3 업로드
      ai_ms    : OpenAI 호출(재시도 포함)
      total_ms : 엔드포인트 전체
    """

    __tablename__ = "meal_analysis_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    image_path: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    # 실제로 결과를 낸 모델. OpenAI 실패로 mock 이 나갔으면 "mock".
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    save_ms: Mapped[int] = mapped_column(Integer, default=0)
    ai_ms: Mapped[int] = mapped_column(Integer)
    total_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

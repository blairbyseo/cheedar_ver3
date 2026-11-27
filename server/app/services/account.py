"""회원 탈퇴(익명화) — 본인 탈퇴(/api/auth/me/withdraw)와 관리자 탈퇴가 같은 규칙을 쓴다."""

from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.daily_sleep import DailySleep
from app.models.daily_steps import DailySteps
from app.models.meal import Meal
from app.models.user import User
from app.services import apple as apple_service
from app.services.uploads import delete_meal_image, delete_profile_image


def anonymize_user(db: Session, user: User) -> None:
    """계정을 '익명화'한다 (Google Play 계정 삭제 정책 대응). commit 까지 한다.

    행을 지우지 않는 이유: 식단·설문·채팅은 연구 데이터라 통계로는 남겨야 한다.
    대신 **누구의 기록인지 알 수 없게** 만든다.

    - 즉시 제거: 카카오ID, Apple ID(토큰 revoke 포함), AI 동의, 이메일, 비밀번호,
      닉네임, 프로필 사진(파일까지), 식단 사진 파일(S3 객체까지), 관리자 권한,
      스마트폰 건강 데이터(걸음수·수면 행 자체)
    - 익명으로 유지: 식단 영양수치, 운동, 설문 응답, 감정, 채팅, 포인트
    - user_id 는 `deleted#{id}` 로 치환 — '#' 는 아이디 규칙상 쓸 수 없는
      문자라 다른 사람이 이 아이디로 가입해 겹칠 일이 없다.

    탈퇴 후 같은 카카오 계정으로 다시 로그인하면 kakao_id 가 비워졌으므로
    완전히 새 계정이 만들어진다(옛 기록과 연결되지 않음).
    deleted_at 이 채워지면 get_current_user 가 막으므로 남은 로그인 쿠키도 무효가 된다.
    """
    # 1) 지울 파일 경로를 먼저 모아둔다 (commit 후 실제 삭제)
    old_profile_image = user.profile_image_path
    apple_refresh_token = user.apple_refresh_token
    meal_images = [
        path
        for (path,) in db.execute(
            select(Meal.image_path).where(
                Meal.user_id == user.id,
                Meal.image_path.is_not(None),
            )
        ).all()
    ]

    # 2) DB 익명화 — 사진 경로도 함께 끊는다(파일 삭제 후 깨진 링크 방지)
    db.execute(update(Meal).where(Meal.user_id == user.id).values(image_path=None))
    # 스마트폰 건강 데이터(Health Connect/HealthKit 걸음수·수면)는 통계로도 남기지 않고 지운다.
    # Health Connect 정책상 사용자가 삭제를 요청할 수 있어야 하고, 연구 데이터도 아니다.
    db.execute(delete(DailySteps).where(DailySteps.user_id == user.id))
    db.execute(delete(DailySleep).where(DailySleep.user_id == user.id))
    user.kakao_id = None
    user.apple_sub = None
    user.apple_refresh_token = None
    user.ai_consent_at = None
    user.email = None
    user.password_hash = None
    user.nickname = None
    user.profile_image_path = None
    user.is_admin = False
    user.user_id = f"deleted#{user.id}"
    user.deleted_at = datetime.now(timezone.utc)
    db.commit()

    # 3) 실제 파일 삭제·Apple 토큰 폐기 (best-effort — 실패해도 탈퇴는 이미 확정)
    apple_service.revoke_token(apple_refresh_token)
    delete_profile_image(old_profile_image)
    for image_url in meal_images:
        delete_meal_image(image_url)

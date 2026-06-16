"""위험 신호(SafetyEvent) 데이터 정리 + 백필 스크립트.

두 가지를 한 번에 한다:
  1) 대시보드 확인용으로 직접 넣어둔 '[TEST]' 더미 이벤트 삭제.
  2) 이미 '완료(completed)'된 설문 응답들의 derived_flags 를 다시 훑어,
     위험 플래그가 양성인데도 SafetyEvent 가 없는 건을 생성(백필).

왜 필요한가: 실시간 제출 경로(/api/survey/{id}/submit → finalize_submission →
_emit_safety_events)는 정상 동작하지만, 그 배선이 붙기 전/시드로 채워진 과거
완료 응답들은 이벤트가 누락돼 있을 수 있다. 이 스크립트가 그 격차를 메운다.

감지 규칙은 서비스의 _RISK_FLAG_TO_SAFETY_EVENT 매핑을 그대로 재사용하므로,
실시간 경로와 100% 동일한 기준으로 이벤트를 만든다(설명문 형식까지 동일).

사용법:
    python -m app.scripts.backfill_safety_events            # 실제 적용
    python -m app.scripts.backfill_safety_events --dry-run  # 미리보기만
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.safety import SafetyEvent
from app.models.survey import SurveyResponse, SurveyResponseStatus
from app.services.survey.service import _RISK_FLAG_TO_SAFETY_EVENT


def _delete_test_dummies(db: Session, dry_run: bool) -> int:
    """description 이 '[TEST]' 로 시작하는 더미 이벤트를 삭제하고 건수를 돌려준다."""
    dummies = db.execute(
        select(SafetyEvent).where(SafetyEvent.description.like("[TEST]%"))
    ).scalars().all()
    for event in dummies:
        print(
            f"  - 삭제: id={event.id} user={event.user_id} "
            f"{event.detected_category} | {event.description}"
        )
        if not dry_run:
            db.delete(event)
    return len(dummies)


def _backfill_completed(db: Session, dry_run: bool) -> int:
    """완료된 설문 응답의 누락 SafetyEvent 를 생성하고 생성 건수를 돌려준다."""
    responses = db.execute(
        select(SurveyResponse)
        .where(SurveyResponse.status == SurveyResponseStatus.COMPLETED)
        .order_by(SurveyResponse.id)
    ).scalars().all()

    created = 0
    for response in responses:
        derived = response.derived_flags or {}
        # 실시간 경로와 동일: suicide_acute 가 있으면 screen 은 중복 적재 안 함.
        suppress_screen = bool(derived.get("suicide_acute"))

        for flag_key, category, level in _RISK_FLAG_TO_SAFETY_EVENT:
            if not derived.get(flag_key):
                continue
            if flag_key == "suicide_screen" and suppress_screen:
                continue

            description = f"survey_response_id={response.id}; flag={flag_key}"
            # 멱등성: 같은 설명문(=같은 응답·같은 플래그)이 이미 있으면 건너뜀.
            already = db.execute(
                select(SafetyEvent.id).where(
                    SafetyEvent.user_id == response.user_id,
                    SafetyEvent.detected_category == category,
                    SafetyEvent.description == description,
                )
            ).first()
            if already is not None:
                continue

            print(
                f"  + 생성: user={response.user_id} {category} "
                f"({level.value}) | {description}"
            )
            if not dry_run:
                db.add(
                    SafetyEvent(
                        user_id=response.user_id,
                        message_id=None,
                        risk_level=level,
                        detected_category=category,
                        description=description,
                        status="unresolved",
                        is_resolved=False,
                    )
                )
            created += 1

    return created


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SafetyEvent 더미 삭제 + 완료 설문 백필"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="실제로 바꾸지 않고 무엇을 할지 출력만 한다",
    )
    args = parser.parse_args()

    with SessionLocal() as db:
        print("=== 1) [TEST] 더미 이벤트 삭제 ===")
        deleted = _delete_test_dummies(db, args.dry_run)
        if deleted == 0:
            print("  (삭제할 더미 없음)")

        print("=== 2) 완료 설문 누락 이벤트 백필 ===")
        created = _backfill_completed(db, args.dry_run)
        if created == 0:
            print("  (백필할 누락 이벤트 없음)")

        if args.dry_run:
            db.rollback()
            print(f"\n[dry-run] 삭제 예정 {deleted}건 · 생성 예정 {created}건 (DB 미반영)")
        else:
            db.commit()
            print(f"\n✅ 완료 — 더미 삭제 {deleted}건 · 이벤트 생성 {created}건")

    return 0


if __name__ == "__main__":
    sys.exit(main())

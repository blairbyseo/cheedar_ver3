# 스마트폰 건강 데이터 연동 (걸음수·수면) — 갤럭시 기준 정리

작성일: 2026-10-19
상태: **코드 완료(2026-10-19), 실기기 검증·DB 마이그레이션·Play 신고 남음**

## 1. 결론

갤럭시에서 삼성 헬스의 걸음수·수면을 Cheddar 앱으로 가져오는 것은 **가능**하다.
삼성 헬스 전용 SDK를 쓰지 않고, Android 표준 창구인 **Health Connect**에서 읽는다.

```
갤럭시 워치 / 폰 센서 → 삼성 헬스 → Health Connect → Cheddar 앱
```

- 갤럭시 S24(테스트 기기)는 Android 14 이상이라 Health Connect가 OS에 내장되어 있다. 별도 설치 없음.
- 아이폰은 HealthKit 경로로 같은 플러그인이 처리하지만, iOS 빌드 자체가 미착수라 **갤럭시 먼저** 진행한다.

## 2. 제품 결정 (2026-10-12 확정)

| 항목 | 결정 |
|---|---|
| 걸음수·수면 → 포인트 적립 | **하지 않는다** |
| 반영 위치 | 주간 리포트, 주 1회 동기 점검, 감정 체크인 AI 선인사(opener) 3곳만 |
| 운동 ↔ 음식 칼로리 연결 | **절대 금지** (보상행동 유발) |
| 섭식 고위험군(`eating_high_risk`) | 칼로리·체중 권한 요청 자체를 하지 않고, 걸음 숫자를 주지 않는다(수면은 섭식과 직접 안 엮여 모두에게) |
| 수면 | 부족/충분 평가·수면 목표·수면 위생 교육을 먼저 꺼내지 않는다. 식사와 연결 금지 |
| 권한 거절 / 웹 / 데이터 없음 | 모든 기능이 정상 동작해야 한다 (건강 데이터는 선택 사항) |

이유: 현재 운동 적립은 "기록했느냐"만 보는 수동 입력(MET×시간) 구조라 걸음수 기준이 없다.
걸음 목표에 포인트를 걸면 설문 C-10-h(운동 못 한 날 죄책감)를 앱이 부추길 위험이 있다.

## 3. 사용자 쪽 전제 조건 (갤럭시)

1. 삼성 헬스 설정 → **Health Connect 동기화 켜기** → 걸음수·수면 공유 허용.
   기본값이 꺼져 있는 경우가 있어 앱 안에 안내 문구가 필요하다.
2. 과거 데이터는 소급되지 않는다. 동기화를 켠 시점부터 쌓인다.
3. 삼성 헬스가 **배터리 최적화**에 걸리면 동기화가 멈추는 사례가 흔하다.
   사용자 안내: 설정 → 배터리 → 삼성 헬스 "제한 없음".

## 4. 구현 내용 (2026-10-19 완료)

### 앱(React/Capacitor)
- `@capgo/capacitor-health` 8.11.12 설치. `android/variables.gradle` minSdk 24 → 26.
- `android/app/src/main/AndroidManifest.xml`: 플러그인이 선언하는 건강 권한 47개 중 **READ_STEPS·READ_SLEEP 둘만 남기고** `tools:node="remove"` 로 제거.
- `android/app/src/main/res/values/strings.xml`: `health_connect_privacy_policy_url` = https://cheddar-care.com/privacy.html (Health Connect 권한 화면 링크).
- `src/health/healthData.js`: 가용성 확인 → 권한 요청(steps·sleep 읽기만) → 걸음수는 `queryAggregated(day, sum)` 일별 합계, 수면은 `readSamples` 조각을 **직접 합쳐 하룻밤으로**(일어난 날짜 기준, awake/inBed 제외, 겹치는 구간 합집합) → `POST /api/health/steps`, `POST /api/health/sleep`. 웹은 no-op. 10분 간격 제한.
- `src/App.jsx`: 앱 진입 시 + 백그라운드 복귀 시 동기화(연동 켠 사용자만).
- `src/tab_pages/Settings.jsx`: "건강 데이터" 카드(앱에서만 표시) — 걸음수·수면 연동 토글(권한 한 번에 요청, 하나만 허용돼도 동작), 각각 마지막 동기화, 삼성 헬스 안내, Health Connect 설정 열기.
- `src/tab_pages/WeeklyReport.jsx`: 이번 주 "걸음수 · 수면" 카드(정보 표현, 연동한 사용자만) + 4주 비교 그래프에 걸음·수면 막대. 4주 집계 조회는 부모에서 1회.
- `src/MotivationCheck.jsx`: 동기 점검 창에 "지난 7일 하루 평균 N걸음" / "밤 평균 N시간" 한 줄씩(서버가 값을 줄 때만).

### 서버(FastAPI)
- `app/models/daily_steps.py` + `0023_daily_steps.py`: `daily_steps` (user_id, day 유니크).
- `app/models/daily_sleep.py` + `0024_daily_sleep.py`: `daily_sleep` (day=일어난 날, asleep_minutes, bed_start, wake_end).
- `app/routers/health.py`: `POST /api/health/steps`, `POST /api/health/sleep`(같은 날 덮어쓰기, 31일 이내만), `GET /api/health/status`.
- `app/services/steps_context.py` / `sleep_context.py`: 맥락 변환 3종 + 금기 문구. 걸음은 고위험군이면 빈 값, 수면은 60분 미만 밤은 평균에서 제외.
- 반영 3곳: `routers/chat.py`(채팅·opener, 운동 스냅샷 뒤에 덧붙임) / `routers/reports.py`(`WeekStat.avg_steps`·`avg_sleep_minutes`, AI 한마디 요약) / `services/motivation.py`(`recent_avg_steps`·`recent_avg_sleep_minutes`).
- 테스트: `server/tests/test_health_steps.py`, `test_health_sleep.py` (upsert·범위 밖 날짜·맥락 규칙·오래된 동기화 무시).

### 남은 작업
- [ ] 로컬·운영 DB `alembic upgrade head` (0023, 0024)
- [ ] 갤럭시 S24 실기기: 권한 창(걸음수·수면) → 삼성 헬스 동기화 → 설정 카드에 걸음수·수면 표시 확인. 수면 조각이 실제로 어떤 모양(세션 1개 + stages / 단계별 샘플)으로 오는지 로그 확인
- [ ] 운영 배포(서버 + 앱 빌드 versionCode 상향)
- [ ] Play 콘솔 건강 앱 신고서 제출(아래 5장) — 걸음수·수면 2종
- [ ] iOS: HealthKit entitlement + Info.plist `NSHealthShareUsageDescription` (iOS 빌드 착수 시)

## 5. Google Play 심사

- 플레이 콘솔 → 앱 콘텐츠 → **건강 앱 신고서** 필수.
- 요청 데이터 유형은 **걸음수·수면 2종만**. 사용 목적을 구체적으로 작성한다.
  (예: "사용자의 주간 활동량·수면 패턴을 본인에게 보여주는 주간 리포트와 AI 코칭 대화의 맥락으로 반영. 진단·치료 목적 아님")
- 개인정보처리방침은 Health Connect 권한 화면의 링크와 **동일한 문서**여야 한다.
- 데이터 유형이 바뀌면 신고서를 다시 제출해야 한다.

## 6. 참고 링크

- Capgo Health 플러그인 문서: https://capgo.app/docs/plugins/health/
- Capgo Google Fit → Health Connect 마이그레이션 가이드: https://capgo.app/blog/google-fit-to-health-connect-migration-in-capacitor/
- Android 공식 — Health Connect 데이터 접근 신고: https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
- Android 공식 — 건강 앱 Google Play 게시: https://developer.android.com/health-and-fitness/health-connect/publish

관련 문서: `GOOGLE_PLAY_RELEASE_GUIDE.md`, `PLAY_RELEASE_TIMELINE.md`

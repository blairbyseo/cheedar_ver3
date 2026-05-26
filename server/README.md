# Cheddar Backend (FastAPI)

React 프론트(`../src`)와 같이 동작하는 식단/포인트 관리 API.
**1단계: 인증(Kakao) + 식단 기록 기능**을 우선 구현했습니다.

## 스택

| 항목 | 운영 | 로컬 개발 |
|---|---|---|
| Web | FastAPI + Uvicorn | 동일 |
| DB | AWS RDS (Postgres, ap-northeast-2) | Docker Postgres |
| Auth | **Kakao OAuth** → JWT (HttpOnly 쿠키) | 동일 |
| AI | **OpenAI** (`gpt-5-mini`, vision) | 동일 또는 `AI_MOCK_MODE=true` |

## 폴더 구조

```
server/
├── app/
│   ├── main.py              FastAPI 앱 + CORS + /uploads 정적 서빙
│   ├── core/
│   │   ├── config.py        환경변수 (pydantic-settings)
│   │   ├── database.py      SQLAlchemy 엔진/세션
│   │   ├── security.py      JWT 발급/검증
│   │   └── deps.py          쿠키(또는 Bearer) → 현재 사용자
│   ├── models/              User, Meal
│   ├── schemas/             Pydantic 요청/응답
│   ├── routers/
│   │   ├── auth.py          Kakao OAuth + /me + 로그아웃
│   │   └── meals.py         식단 CRUD + AI 분석
│   └── services/
│       ├── kakao.py         Kakao token 교환 + 프로필 조회
│       ├── openai_client.py OpenAI vision 호출 (mock fallback)
│       └── uploads.py       이미지 디스크 저장
├── alembic/                 DB 마이그레이션
├── uploads/                 업로드된 이미지 (gitignore)
├── docker-compose.yml       로컬 Postgres
├── requirements.txt
└── .env / .env.example
```

## 실행 순서 (Windows PowerShell)

### 1) 로컬 Postgres 띄우기

```powershell
docker compose up -d
```

### 2) Python 가상환경 + 패키지

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3) 환경변수

`.env`는 이미 로컬 dev용으로 채워져 있습니다. 필요하면 `.env.example` 참고해 수정.
주요 항목:
- `DATABASE_URL` — 로컬 Docker로 기본 설정 (운영 RDS URL은 주석 처리)
- `KAKAO_REDIRECT_URI` — `http://localhost:3000/oauth/kakao/callback` (운영은 `https://cheddar-care.com/...`)
- `AI_MOCK_MODE=false` — OpenAI 실제 호출. 키 없는 환경이면 `true`로 두면 mock 응답.

### 4) DB 마이그레이션

```powershell
alembic upgrade head
```

### 5) 서버 실행

```powershell
uvicorn app.main:app --reload --port 8000
```

- API 문서: <http://localhost:8000/docs>
- 헬스체크: <http://localhost:8000/health>

## API 요약

### 인증 (`/api/auth`)
- `POST /kakao` — body: `{ code, redirect_uri? }`.
  프론트가 `https://kauth.kakao.com/oauth/authorize?...` 로 보낸 사용자가 redirect 되어 받은 `code`를 그대로 백엔드로 전달. 백엔드가 Kakao 토큰 교환 → 프로필 조회 → 회원 생성/조회 → JWT를 **HttpOnly 쿠키**(`cheddar_auth`)로 set.
- `POST /logout` — 쿠키 삭제 (204).
- `GET /me` — 쿠키의 JWT로 내 정보 반환.

### 챗 (`/api/chat`) — 인증 필요
- `GET /messages?limit=50` — 내 대화 이력 (오래된 것부터 정렬).
- `POST /messages` — body: `{ text }`. 사용자 메시지를 저장하고 OpenAI에 직전 20개 메시지를 컨텍스트로 보내 AI 응답 생성 → 두 메시지(user/ai) 모두 저장 후 함께 반환.
- `DELETE /messages` — 내 대화 이력 전체 삭제 (대화 초기화 버튼용).

`AI_MOCK_MODE=true`거나 OpenAI 호출이 실패하면 고정 mock 응답으로 fallback.

### 식단 (`/api/meals`) — 인증 필요
- `POST /analyze` — multipart 파일 업로드. OpenAI vision 분석 결과(`summary, calories, protein_g, carbs_g, fat_g, comment, image_path`) 반환. `AI_MOCK_MODE=true` 또는 호출 실패 시 고정 mock.
- `POST /` — 식단 기록 생성 (eaten_on 생략 시 오늘).
- `GET /?on=YYYY-MM-DD` — 내 식단 목록 (날짜 필터).
- `GET /today/status` — 오늘 아침/점심/저녁/간식 4종 기록 현황. 프론트 `Diet.jsx`의 `INITIAL_TODAY_STATUS` 형태 그대로.
- `GET /{id}` / `PATCH /{id}` / `DELETE /{id}` — 단건 조회/수정/삭제.

`POST /` 로 식단이 저장될 때마다 포인트 적립 규칙이 평가돼 XP/CP 가 함께 오른다.

### 포인트/경험치 (`/api/points`) — 인증 필요
- `GET /me` — 내 XP/CP, 레벨, 오늘·이번 주 적립 합, 적립 기준 4종, 최근 적립 내역.
- `GET /ranking` — 전체 환자를 **XP 내림차순**으로 정렬한 상위 100명 + 내 순위.

적립 규칙(식단 1건당 평가):

| rule | 조건 | 포인트 |
|---|---|---|
| `meal-check` | 식단 1회 기록 | +10 |
| `three-meals` | 하루 3끼(아침·점심·저녁) 완료 | +20 |
| `weekly-goal` | 한 주에 5일 기록 | +100 |
| `full-week` | 한 주에 7일 기록 보너스 | +50 |

적립이 일어나면 **XP 와 CP 가 같은 값만큼 함께** 오른다. XP 는 누적값(레벨
판정용, 감소 없음), CP 는 소비 가능한 포인트. 같은 적립이 두 번 들어가지
않도록 `point_history` 에 `(user_id, rule, dedup_key)` 유니크 제약을 둔다.

## 프론트 연동 흐름 (Kakao + 쿠키)

```js
// 1) Kakao 동의 화면으로 보냄
window.location.href =
  `https://kauth.kakao.com/oauth/authorize` +
  `?response_type=code` +
  `&client_id=${KAKAO_REST_API_KEY}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

// 2) /oauth/kakao/callback 페이지에서 URL의 ?code= 를 백엔드로 전달
await fetch("/api/auth/kakao", {
  method: "POST",
  credentials: "include",                // ★ 쿠키 받기 위해 필수
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code }),
});

// 3) 이후 모든 API 호출에 credentials: 'include' 를 붙이면 자동 인증
await fetch("/api/meals/today/status", { credentials: "include" });
```

## 다음 단계 (아직 미구현)

- 스트릭(연속 기록 일수) 저장 — 지금 홈 화면 streak 는 프론트 임시값
- CP 차감(보상 교환) 기능 — 적립만 구현됨
- 알림 설정 저장 / 푸시
- 문의하기
- 챗 컨텍스트에 식단 기록 통합 (지금은 메시지 history만 사용)

각각은 같은 패턴(`models/` + `schemas/` + `routers/`)으로 추가하면 됩니다.

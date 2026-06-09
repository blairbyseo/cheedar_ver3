# Cheddar (체다)

- **프론트엔드**: React 19 + Vite (`src/`) — dev 서버 포트 `3000`
- **백엔드**: FastAPI + Postgres (`server/`) — API 포트 `8000`
- 프론트의 `/api/...`, `/uploads/...` 요청은 Vite proxy가 백엔드(`127.0.0.1:8000`)로 넘긴다 (`vite.config.js`).

---

## 처음 시작하기 

> ⚠️ **클론만 하면 로그인이 안 됩니다.** 깃에 안 올라가는 `server/.env`를
> 직접 만들어야 하고, 백엔드(FastAPI + DB)를 띄워야 프론트의 로그인/설문이
> 동작합니다. 아래 순서를 그대로 따라오세요.

### 0) 사전 준비물

- **Node.js** 18+ (프론트)
- **Docker Desktop** (백엔드 + Postgres) — 실행해서 데몬이 켜져 있어야 함
- Git

### 1) 레포 클론

```powershell
git clone https://github.com/blairbyseo/cheedar_ver3.git
cd cheedar_ver3
```

### 2) 백엔드 환경변수 파일 만들기 (★ 제일 자주 놓치는 단계)

`server/.env`는 `.gitignore`에 들어 있어서 **레포에 포함되지 않습니다.**
템플릿(`server/.env.example`)을 복사해서 직접 만들어야 합니다.

```powershell
Copy-Item server/.env.example server/.env
```

그다음 `server/.env`를 열어 **`SECRET_KEY`를 각자 아무 긴 랜덤 문자열로** 설정하세요.

```
SECRET_KEY=아무거나-길고-랜덤한-문자열-예: 3f9a...c21
```

> `SECRET_KEY`는 **각자의 백엔드가 JWT 토큰에 서명/검증하는 자기만의 키**입니다.
> 공유받는 값이 아니라 각자 임의로 정하면 되고, 작성자 값과 같을 필요가 없습니다.
> (기본값이 있어서 안 바꿔도 로컬에선 로그인이 *동작은* 하지만, 보안상 각자 랜덤 값으로 바꾸는 것을 권장합니다.)
>
> 카카오 로그인이나 실제 AI 응답까지 보려면 `KAKAO_REST_API_KEY`·`OPENAI_API_KEY`가
> 추가로 필요한데, 이건 **작성자만 가진 외부 서비스 키**라 따로 전달받아야 합니다.
> 없이 테스트하려면 **"아이디로 회원가입/로그인"** 을 쓰고, AI는 `AI_MOCK_MODE=true`로
> 두면 키 없이 가짜 응답으로 동작합니다.

### 3) 백엔드 + DB 띄우기 (Docker)

```powershell
docker compose -f server/docker-compose.yml up -d --build
```

- Postgres와 FastAPI 컨테이너가 함께 뜹니다.
- 백엔드 컨테이너가 **부팅 시 `alembic upgrade head`로 DB 마이그레이션을 자동 적용**하므로, 따로 마이그레이션 명령을 칠 필요가 없습니다.
- 확인: <http://localhost:8000/docs> 가 열리면 OK.

### 4) 프론트엔드 띄우기

```powershell
npm install
npm run dev
```

- 접속: <http://localhost:3000>
- 회원가입: <http://localhost:3000/signup> — **아이디로 가입**하면 가입 직후
  자동 로그인되고, 신규 계정(`onboarded=false`)이라 **온보딩 설문이 바로 뜹니다.**

### 잘 안 될 때 (로그인 오류 체크리스트)

| 증상 | 원인 | 해결 |
|---|---|---|
| `docker compose up`이 `.env not found`로 실패 | `server/.env` 없음 | 2번 단계 (`Copy-Item ...`) |
| 로그인 시 네트워크 오류 / 500 | 백엔드 안 떠 있음 | 3번 단계 + Docker Desktop 켜기 |
| 재시작 후 다들 로그아웃됨 / 토큰 무효 | `SECRET_KEY`를 매번 바꿈 | `server/.env`에 고정된 `SECRET_KEY` 한 번만 정해두기 |
| 카카오 로그인만 실패 | 카카오 키 없음 | 아이디 로그인으로 테스트하거나 키 입력 |
| 페이지는 뜨는데 `/api/...` 404/502 | 프론트만 뜨고 백엔드 down | 백엔드 컨테이너 상태 `docker ps` 확인 |

백엔드 로그 확인: `docker logs cheddar-backend`

---

## 폴더 구조 (요약)

```
.
├── src/                  React 프론트엔드 (Vite)
│   ├── App.jsx           탭 라우팅 + 설문 게이트
│   ├── auth/             로그인/회원가입/인증 컨텍스트
│   ├── tab_pages/        Home/Diet/Chat/Point/Settings 화면
│   └── survey/           설문 UI
├── server/               FastAPI 백엔드 (자세한 건 server/README.md)
├── vite.config.js        dev 서버 + /api, /uploads 프록시
└── package.json
```

백엔드 API 상세(엔드포인트, 포인트 규칙, 설문 트리거 등)는 **[`server/README.md`](server/README.md)** 참고.

---

## 프론트 구조 메모 (초기 작성)

1. **index.html** — React root (`main.jsx`로 연결), 모바일웹 연동(height 100% / margin 0), 상단 이름.
2. **main.jsx** — `index.html` root에 연결.
3. **App.jsx** — `useState("Home")`으로 현재 선택 탭을 기억하고 TabBar에 전달. `tab_pages/`의 화면들이 걸려 있음.
4. **TabBar.jsx** — 탭 아이콘.

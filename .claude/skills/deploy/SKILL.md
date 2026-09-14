---
name: deploy
description: Cheddar 프로덕션(api.cheddar-care.com) 배포 런북. EC2 백엔드 + S3/CloudFront 프론트 3종을 git pull → 빌드 → 배포 → 헬스체크 순으로 수행한다. 사용자가 "배포해", "deploy", "prod 올려", "cheddar 배포" 등을 요청할 때 사용. ⚠️ 배포 대상은 dbrua/Cheddar_Team_26 레포(이 레포 아님).
---

# Cheddar 배포 작업

⚠️ **배포 대상 레포 주의**: 이 스킬의 모든 경로/버킷/EC2는 **`Cheddar_Team_26`**(origin `https://github.com/dbrua/Cheddar_Team_26`, 로컬 `~/26년연구/Cheddar_Team_26`) 기준이다. 지금 이 작업 레포(`cheedar_ver3`)와는 폴더 구조(`backend/` vs `server/`)가 다르니, 배포 명령은 반드시 `Cheddar_Team_26` 경로에서 실행한다.

아래 인프라 정보와 절차를 정확히 따른다.

## 인프라 정보

**Backend (EC2)**
- Host: `ubuntu@54.116.79.208` (인스턴스 `i-08904118c574d7a3d`, Name `CHEDDAR26`, region `ap-northeast-2`)
- SSH key: `~/Downloads/cheddar-key.pem`
- Repo path on EC2: `~/Cheddar_Team_26`
- Container: `cheddar_backend` (docker-compose v1 사용 — `docker-compose` 하이픈 필수, `docker compose` 스페이스 v2는 미설치)
- API public: `https://api.cheddar-care.com` (Nginx → 127.0.0.1:8000)

**Frontend (S3 + CloudFront)** — AWS 계정 `716643471145`

| 디렉토리 | S3 버킷 | CloudFront ID |
|---|---|---|
| `frontend/` (사용자 메인) | `cheddar-frontend` | `E1IEVWG4XAD4IZ` |
| `frontend_admin/` (관리자) | `cheddar-admin-frontend` | `E1HJ9YBU491NTG` |
| `frontend_admin_former/` (구 관리자) | `cheddar-former-frontend` | `E2WMIFNZJ0U14I` |

**Repo (로컬)**
- Path: `~/26년연구/Cheddar_Team_26`
- Origin: `https://github.com/dbrua/Cheddar_Team_26`

## 함정 / 주의사항

1. **SSH key는 `BatchMode=yes` 쓰지 마라** — 이전에 `Connection reset by peer` 발생. 평범하게 `ssh -o ConnectTimeout=10 -o ServerAliveInterval=10 -o StrictHostKeyChecking=accept-new -i ~/Downloads/cheddar-key.pem ubuntu@54.116.79.208 '<cmd>'` 형태로.
2. **옛 EC2 IP `13.124.236.6`은 죽었다** — 현재 prod는 `54.116.79.208`. 옛 IP 절대 쓰지 마라.
3. **`docker-compose` 하이픈** — v1만 설치돼 있음. `docker compose`(v2 스페이스) 호출하면 `unknown command` 에러.
4. **SSH로 `docker logs` tail 같은 streaming 명령은 hang 가능** — 짧은 단일 명령만 SSH로 보내고, 필요하면 `--tail N` 옵션으로 한계 설정.
5. **CloudFront invalidation은 1~3분 소요** — 즉시 반영 안 됨. 사용자에게 강력새로고침(Cmd+Shift+R) 안내.

## 배포 절차

### 0. 영향 범위 판단

```bash
cd ~/26년연구/Cheddar_Team_26 && git checkout main && git fetch origin && git log --stat origin/main...HEAD
```

마지막 배포 이후 변경 파일 보고:
- `backend/` 변경 있음 → Backend 배포 필요
- `frontend/src/` 변경 있음 → 메인 frontend 배포 필요
- `frontend_admin/src/` 변경 있음 → Admin 배포 필요
- `frontend_admin_former/src/` 변경 있음 → Former 배포 필요

해당 없으면 그 단계는 skip.

### 1. 로컬 main 동기화

```bash
cd ~/26년연구/Cheddar_Team_26 && git checkout main && git pull origin main && git log -1 --oneline
```

### 2. Backend 배포 (backend 변경 시)

EC2에 SSH로 git pull + docker rebuild. 한 번에 호출:

```bash
ssh -o ConnectTimeout=10 -o ServerAliveInterval=10 -o StrictHostKeyChecking=accept-new -i ~/Downloads/cheddar-key.pem ubuntu@54.116.79.208 'cd Cheddar_Team_26 && git pull origin main 2>&1 | tail -10 && echo "---HEAD---" && git log -1 --oneline && echo "---REBUILD---" && docker-compose up -d --build 2>&1 | tail -30 && echo "---STATUS---" && docker-compose ps'
```

성공 기준:
- `git log -1` 출력이 로컬 main HEAD와 일치
- `docker-compose ps`에 `cheddar_backend` Up 상태

타임아웃은 5분으로 잡아라 (이미지 빌드 ~1분, pip install ~30초).

### 3. Frontend 빌드 (어느 frontend든 변경 시)

해당 디렉토리에서 빌드. 동시에 여러 개 빌드해도 됨:

```bash
cd ~/26년연구/Cheddar_Team_26/frontend && npm run build
# 필요 시:
cd ~/26년연구/Cheddar_Team_26/frontend_admin && npm run build
cd ~/26년연구/Cheddar_Team_26/frontend_admin_former && npm run build
```

빌드 시간 ~3초. 결과는 각 디렉토리의 `build/`에. 1MB 넘는 chunk 경고는 정상 (무시).

### 4. S3 sync + CloudFront invalidate

해당 frontend별로 한 줄씩 실행:

```bash
# 메인 frontend
cd ~/26년연구/Cheddar_Team_26/frontend && \
  aws s3 sync build/ s3://cheddar-frontend --delete && \
  aws cloudfront create-invalidation --distribution-id E1IEVWG4XAD4IZ --paths "/*"

# Admin frontend
cd ~/26년연구/Cheddar_Team_26/frontend_admin && \
  aws s3 sync build/ s3://cheddar-admin-frontend --delete && \
  aws cloudfront create-invalidation --distribution-id E1HJ9YBU491NTG --paths "/*"

# Former admin
cd ~/26년연구/Cheddar_Team_26/frontend_admin_former && \
  aws s3 sync build/ s3://cheddar-former-frontend --delete && \
  aws cloudfront create-invalidation --distribution-id E2WMIFNZJ0U14I --paths "/*"
```

성공 기준:
- `aws s3 sync` 출력에 `upload: ...` 라인 + (옛 파일이 있다면) `delete: ...`
- `create-invalidation` JSON 응답에 `"Status": "InProgress"` + Invalidation ID

### 5. 헬스체크

```bash
curl -s -o /dev/null -w "HTTP %{http_code} (%{time_total}s)\n" https://api.cheddar-care.com/docs
curl -s -o /dev/null -w "HTTP %{http_code} (%{time_total}s)\n" https://api.cheddar-care.com/
```

둘 다 HTTP 200이어야 통과. 5xx면 SSH로 들어가서 `docker logs cheddar_backend --tail 50` 확인.

### 6. 보고

사용자에게 표 형태로 보고:
- 배포된 커밋 SHA + 메시지
- Backend 상태 (skip 또는 deployed)
- 각 frontend 상태 (skip 또는 deployed + Invalidation ID)
- 헬스체크 결과 (HTTP 코드)

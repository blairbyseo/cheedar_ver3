#!/usr/bin/env bash
#
# 웹(cheddar-care.com) 배포 스크립트 — S3 + CloudFront
#
# 왜 이 스크립트가 필요한가 (손으로 하면 반드시 한 번은 틀리는 것들):
#
#   1) 빌드 모드를 헷갈린다
#      웹은 `vite build`(상대경로 /api), 앱은 `vite build --mode app`(절대주소).
#      앱용 빌드를 웹에 올리면 API 호출 경로가 통째로 바뀐다.
#      → 이 스크립트는 항상 웹 모드로 빌드하고, 산출물에 앱용 절대주소가
#        섞였는지 검사해서 섞였으면 배포를 중단한다.
#
#   2) `aws s3 sync` 가 확장자 없는 파일의 content-type 을 깨뜨린다
#      apple-app-site-association(확장자 없음, 애플 규격)이
#      binary/octet-stream 으로 올라가면 애플이 조용히 무시한다.
#      → sync 직후 content-type 을 다시 씌운다.
#
#   3) CloudFront 무효화를 잊는다 → 사용자에게 구버전이 계속 나간다.
#
# 사용법:
#   ./scripts/deploy-web.sh              # 삭제 목록 확인 후 물어보고 배포
#   ./scripts/deploy-web.sh --dry-run    # 아무것도 바꾸지 않고 미리보기만
#   ./scripts/deploy-web.sh --yes        # 확인 없이 배포 (CI 용)
#
set -euo pipefail

# ── 배포 대상 ────────────────────────────────────────────────────────────
BUCKET="cheddar-frontend"          # 실서비스 버킷 (cheddar-0519 는 쓰지 않는 구버킷)
DISTRIBUTION_ID="E1IEVWG4XAD4IZ"
DOMAIN="https://cheddar-care.com"
export AWS_PROFILE="${AWS_PROFILE:-cheddar}"   # 기본 자격증명은 다른 프로젝트용이라 프로파일 지정 필수

# 확장자가 없어 S3 가 종류를 못 알아보는 파일들: "경로|content-type"
EXTENSIONLESS=(
  ".well-known/apple-app-site-association|application/json"
  "oauth/kakao/app-callback|text/html; charset=utf-8"
)

# ── 옵션 ────────────────────────────────────────────────────────────────
DRY_RUN=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y)  ASSUME_YES=true ;;
    *) echo "알 수 없는 옵션: $arg"; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf "\n\033[1m▶ %s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗ %s\033[0m\n" "$1"; exit 1; }

# ── 0. 자격증명 확인 ─────────────────────────────────────────────────────
step "AWS 자격증명 확인 (프로파일: $AWS_PROFILE)"
aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS 자격증명 실패. AWS_PROFILE 을 확인하세요."
ok "$(aws sts get-caller-identity --query Arn --output text)"

# ── 1. 웹 모드로 빌드 ────────────────────────────────────────────────────
step "웹 모드로 빌드 (vite build — 앱용 --mode app 아님)"
rm -rf dist
npm run build >/dev/null
ok "dist/ 생성"

# ── 2. 앱용 빌드가 섞였는지 검사 ─────────────────────────────────────────
step "빌드 산출물 검증"
if grep -rq "api\.cheddar-care\.com" dist/assets/ 2>/dev/null; then
  fail "번들에 앱 전용 API 절대주소가 있습니다. --mode app 으로 빌드된 것 같습니다. 배포 중단."
fi
ok "앱용 절대 API 주소 없음 (웹은 상대경로 /api 사용)"

for entry in "${EXTENSIONLESS[@]}"; do
  path="${entry%%|*}"
  [ -f "dist/$path" ] || fail "dist/$path 가 없습니다. public/ 에 있는지 확인하세요."
done
ok "딥링크 파일 존재 (AASA, 카카오 환승 페이지)"

# ── 3. 무엇이 지워지는지 먼저 보여준다 ───────────────────────────────────
step "변경 예정 내역 (--delete 로 사라질 파일 포함)"
PLAN="$(aws s3 sync dist/ "s3://$BUCKET" --delete --dryrun)"
DEL_COUNT="$(printf '%s\n' "$PLAN" | grep -c '^(dryrun) delete' || true)"
UP_COUNT="$(printf '%s\n' "$PLAN" | grep -c '^(dryrun) upload' || true)"
printf '%s\n' "$PLAN" | grep '^(dryrun) delete' || true
echo "  업로드 $UP_COUNT건 / 삭제 $DEL_COUNT건"

if [ "$DRY_RUN" = true ]; then
  step "--dry-run 이므로 여기서 종료합니다 (아무것도 바뀌지 않았습니다)"
  exit 0
fi

if [ "$ASSUME_YES" != true ]; then
  read -r -p $'\n위 내용으로 실제 배포할까요? (yes 입력): ' answer
  [ "$answer" = "yes" ] || { echo "취소했습니다."; exit 1; }
fi

# ── 4. 업로드 ───────────────────────────────────────────────────────────
step "S3 동기화"
aws s3 sync dist/ "s3://$BUCKET" --delete >/dev/null
ok "동기화 완료"

# ── 5. content-type 복구 (sync 가 매번 깨뜨린다) ─────────────────────────
step "확장자 없는 파일 content-type 복구"
for entry in "${EXTENSIONLESS[@]}"; do
  path="${entry%%|*}"; ctype="${entry#*|}"
  aws s3 cp "dist/$path" "s3://$BUCKET/$path" \
    --content-type "$ctype" --cache-control no-cache >/dev/null
  ok "$path → $ctype"
done

# ── 6. CloudFront 무효화 ────────────────────────────────────────────────
step "CloudFront 캐시 무효화"
INVALIDATION_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query Invalidation.Id --output text)"
ok "무효화 시작: $INVALIDATION_ID"
echo "  (완료까지 보통 1~5분. 아래 검증이 실패하면 잠시 후 다시 확인하세요.)"

# ── 7. 실제 서비스 URL 검증 ─────────────────────────────────────────────
step "배포 검증"
for p in "/" "/privacy.html" "/account-deletion.html" "/.well-known/assetlinks.json"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$DOMAIN$p")"
  [ "$code" = "200" ] && ok "$p → $code" || printf "  \033[33m! %s → %s\033[0m\n" "$p" "$code"
done

for entry in "${EXTENSIONLESS[@]}"; do
  path="${entry%%|*}"; expected="${entry#*|}"
  actual="$(curl -sI "$DOMAIN/$path" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
  case "$actual" in
    "$expected"*) ok "/$path → $actual" ;;
    *) printf "  \033[33m! /%s → %s (기대: %s) — CDN 반영 대기 중일 수 있습니다\033[0m\n" "$path" "${actual:-없음}" "$expected" ;;
  esac
done

step "배포 완료"

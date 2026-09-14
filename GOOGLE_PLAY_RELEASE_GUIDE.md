# 🤖 Google Play 출시 가이드 (Cheddar / com.cheddar.care)

개발자 계정은 만들어진 상태에서, **비공개 테스트(Closed testing) 트랙에 앱을
올리기까지** 무엇을 어떤 순서로 하면 되는지 정리한 문서입니다.

붙여넣을 문구·설문 답변은 별도 문서에 있습니다 → **[PLAY_STORE_LISTING.md](./PLAY_STORE_LISTING.md)**

---

## 0. 지금 상태 한눈에

| 준비물 | 상태 |
|---|---|
| 패키지명 `com.cheddar.care` | ✅ 확정 (첫 업로드 후 영구 고정) |
| 릴리즈 서명 keystore | ✅ `android/upload-keystore.jks` |
| 회원탈퇴(계정 삭제) 기능 | ✅ 구현 완료 (설정 → 회원탈퇴) |
| 개인정보처리방침 페이지 | ✅ `public/privacy.html` 배포됨 — ⚠️ 문의 이메일 수정분 재배포 필요 |
| 계정 삭제 안내 페이지 | ✅ `public/account-deletion.html` 배포됨 — ⚠️ 동일 |
| 앱 아이콘 512 / 그래픽 1024×500 | ✅ `assets/play/` |
| 휴대전화 스크린샷 5장 | ✅ `assets/play/screenshots/` |
| 스토어 문구·설문 답변 | ✅ PLAY_STORE_LISTING.md |
| **릴리즈 AAB** | ✅ `android/app/build/outputs/bundle/release/app-release.aab` (8/28 빌드, 줄바꿈 수정 포함) |
| 운영 백엔드 배포 | ✅ 완료 (`/api/auth/me/withdraw` 라이브) |
| 운영 프론트 배포 | ⚠️ 이메일 수정분 재배포 필요 — 2단계 참고 |
| 개발자 계정 | ✅ **등록 완료** (개인계정 cmyanglab26@gmail.com, 2026-09-07 확인) |
| 심사용 테스트 계정 | ✅ `playreview` / `Play!Review2026` (운영 DB 생성·로그인 검증 완료) |
| 테스트 트랙 | **비공개 테스트(Closed)** — 5-4 참고 |

> ✅ `app-release.aab` 는 8/28 17:43 빌드본(웹 동기화 17:40)으로 한글 줄바꿈
> 수정이 들어있습니다. 그대로 업로드하면 됩니다 — 재빌드 불필요, versionCode 1.

---

## 1. 계정 상태 확인 (개인계정)

개발자 계정은 **개인계정 `cmyanglab26@gmail.com`** 입니다. 본인이 소유자라
초대받을 필요도, D-U-N-S 조직 인증도 없습니다. 바로 앱을 만들 수 있어요.

다만 개인계정이라 아래 두 가지를 알고 시작해야 합니다.

**① 개발자 연락처 이메일이 스토어에 공개됩니다.**
스토어 등록정보의 연락처 이메일은 앱 상세페이지에 그대로 노출됩니다.
공개가 꺼려지면 별도 문의용 Gmail을 하나 파서 쓰세요. 단, 그 주소를
`public/privacy.html` 의 문의처와 **일치**시켜야 합니다.

**② 프로덕션(공개 출시)에는 "테스터 12명 × 14일" 이력이 필요합니다.**
2023년 11월 이후 만들어진 개인계정은 공개 출시 전에 **비공개 테스트를
테스터 12명 이상으로 연속 14일** 운영한 기록이 있어야 합니다.
⚠️ **내부 테스트(Internal)는 이 요건에 안 잡힙니다.** 그래서 이 문서는
처음부터 **비공개 테스트(Closed)** 트랙 기준으로 씁니다.

> 지인 손에 당장 쥐어주는 게 급하면 내부 테스트를 병행해도 됩니다.
> 14일 카운트는 비공개 테스트 트랙에서만 쌓입니다.

---

## 2. 웹/서버 먼저 배포 (앱 업로드 전에 해야 함)

앱은 운영 백엔드(`api.cheddar-care.com`)를 바라봅니다. 회원탈퇴 API가 운영에
없으면 앱에서 탈퇴 버튼이 실패하고, 이는 **심사 반려 사유**가 됩니다.

### 2-1. 문서 페이지 내용 채우기

`public/privacy.html` 과 `public/account-deletion.html` 을 열어 빨간색으로
표시된 부분을 채웁니다.

- `[기관명]` — 개발자 계정 명의와 같게
- `[이름]` / `[직위]` — 개인정보 보호책임자
- `[이메일 주소]` — 문의·삭제요청 받을 주소
- `[기관 주소]`
- 시행일 (예: `2026-09-01`)
- 3번 항목의 "연구 목적 이용" 문장 — 해당 없으면 삭제

### 2-2. 백엔드 배포 (EC2)

```bash
ssh -i cheddar-key.pem ubuntu@54.116.79.208
cd ~/new_backend && git pull origin app     # 또는 main 머지 후 main
cd server && docker-compose -f docker-compose.prod.yml up -d --build
```

- 컨테이너가 부팅하며 `alembic upgrade head` 를 자동 실행 → `0016_user_deleted_at` 적용
- ⚠️ 이 호스트에서는 `docker compose`(띄어쓰기)가 아니라 **`docker-compose`**(하이픈)
- 확인: `curl -i https://api.cheddar-care.com/api/auth/me/withdraw -X POST` → **401**(인증 없음)이 나오면 배포 성공. 404면 아직 옛 코드.

### 2-3. 프론트 배포 (S3 + CloudFront)

```bash
npm run deploy:web
```

`scripts/deploy-web.sh` 가 아래를 한 번에 처리한다. **`aws s3 sync` 를 직접 치지 말 것** —
`aws s3 sync` 는 확장자 없는 파일(`apple-app-site-association`, `oauth/kakao/app-callback`)의
content-type 을 `binary/octet-stream` 으로 깨뜨리고, 그러면 애플이 AASA 를 조용히 무시해
iOS 카카오 로그인 딥링크가 죽는다.

1. 웹 모드로 빌드 (앱용 `--mode app` 이 섞이면 배포 중단)
2. 삭제 예정 목록을 보여주고 확인받은 뒤 sync
3. 확장자 없는 파일 content-type 복구
4. CloudFront 무효화
5. 실서비스 URL 검증

미리보기만 하려면 `npm run deploy:web:dry` (아무것도 바뀌지 않는다).

확인:
- https://cheddar-care.com/privacy.html → 200
- https://cheddar-care.com/account-deletion.html → 200
- https://cheddar-care.com/.well-known/assetlinks.json → 200

---

## 3. ⭐ 카카오 로그인이 깨지지 않게 — assetlinks 처리

**여기가 가장 놓치기 쉬운 부분입니다.**

Play에 올리면 **Play 앱 서명(Play App Signing)** 이 적용됩니다. 즉 우리가 만든
업로드 키로 서명해서 올려도, 구글이 **자기 키로 다시 서명해서** 사용자에게
배포합니다. 그래서 사용자 기기에 깔린 앱의 지문은 우리 업로드 키 지문과 **다릅니다.**

카카오 로그인은 App Links(`https://cheddar-care.com/oauth/kakao/app-callback`)로
동작하고, App Links 검증은 `assetlinks.json` 의 지문과 앱 지문이 같아야 통과합니다.
→ **구글의 앱 서명 키 지문을 assetlinks.json 에 추가하지 않으면, 스토어로 받은
앱에서 카카오 로그인이 브라우저로 튕깁니다.**

### 해야 할 일 (첫 AAB 업로드 직후)

1. Play Console → **테스트 및 출시 → 앱 무결성 → "앱 서명" 탭**
   (예전 "설정 → 앱 서명" 경로는 없어졌습니다. 지문은 첫 AAB 업로드 후에 생깁니다)
2. **앱 서명 키 인증서**의 `SHA-256 인증서 지문` 복사
3. `public/.well-known/assetlinks.json` 의 `sha256_cert_fingerprints` 배열에 추가
4. 프론트 재배포(2-3) + CloudFront 무효화

현재 등록된 지문:

| 용도 | SHA-256 |
|---|---|
| 디버그 키 (개발용, 이미 등록됨) | `50:7A:4F:FF:...:9C:0F` |
| **업로드 키** (참고용) | `85:D8:B4:C0:42:01:77:25:D1:3E:C0:EB:71:31:52:85:55:A4:B5:F3:ED:26:77:FE:42:1C:80:27:A7:6B:FF:FE` |
| **Play 앱 서명 키** | ⚠️ 업로드 후 콘솔에서 확인해 추가 |

> 배열에 여러 개를 넣어도 됩니다. 디버그/업로드/Play 서명 키 세 개를 모두 넣어두면
> 개발·비공개테스트·정식 배포 어디서든 카카오 로그인이 동작합니다.

---

## 4. 릴리즈 AAB 재빌드

회원탈퇴 기능과 복구된 이미지가 들어간 새 빌드를 만듭니다.

```powershell
# 1) 운영 주소로 웹 빌드 + 네이티브 동기화
npm run cap:sync

# 2) 서명된 AAB 생성
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\android\gradlew.bat -p android bundleRelease
```

결과물: `android/app/build/outputs/bundle/release/app-release.aab`

- `versionCode 1` / `versionName 1.0` 그대로 올리면 됩니다 (한 번도 업로드한 적 없으므로)
- 다음 업데이트부터는 `android/app/build.gradle` 의 `versionCode` 를 2, 3… 으로 올려야 합니다

> ⚠️ **keystore 백업**: `android/upload-keystore.jks` 와 `android/keystore.properties`
> 를 잃어버리면 앱 업데이트를 못 올립니다. 지금 바로 비밀번호 관리자나 팀 드라이브에
> 백업하세요. (git에는 올라가지 않습니다)

---

## 5. Play Console 작업 순서

### 5-1. 앱 만들기

**모든 앱 → 앱 만들기**

| 항목 | 값 |
|---|---|
| 앱 이름 | `Cheddar 체다 - 식단 기록` |
| 기본 언어 | 한국어 |
| 앱 또는 게임 | **앱** |
| 무료 또는 유료 | **무료** (⚠️ 무료→유료 변경 불가) |

선언 두 개(개발자 프로그램 정책 / 미국 수출법)에 체크 → 앱 만들기

### 5-2. 앱 콘텐츠 (왼쪽 메뉴 → 정책 → 앱 콘텐츠)

아래 항목을 **전부 초록불**로 만들어야 출시가 가능합니다.

- [ ] 개인정보처리방침 → `https://cheddar-care.com/privacy.html`
- [ ] 앱 액세스 권한 → 로그인 필요 + 테스트 계정 `playreview` / `Play!Review2026`
- [ ] 광고 → 광고 없음
- [ ] 콘텐츠 등급 → 설문 응답 (전체이용가 예상)
- [ ] 타겟층 및 콘텐츠 → 18세 이상
- [ ] 데이터 보안 → 수집 항목 신고 + **계정 삭제 URL 등록**
- [ ] 정부 앱 → 아니요
- [ ] 금융 기능 → 해당 없음
- [ ] 건강 앱 선언 (뜨면) → 의료기기 아님

각 항목의 구체적 답변은 **PLAY_STORE_LISTING.md** 를 그대로 옮기면 됩니다.

### 5-3. 스토어 등록정보 (성장 → 스토어 등록정보 → 기본 스토어 등록정보)

- 앱 이름 / 간단한 설명 / 자세한 설명 → PLAY_STORE_LISTING.md
- 앱 아이콘 → `assets/play/play-icon-512.png`
- 그래픽 이미지 → `assets/play/feature-graphic-1024x500.png`
- 휴대전화 스크린샷 → `assets/play/screenshots/01~05.png` (5장 전부)
- 앱 카테고리 → 건강/피트니스
- 연락처 이메일 / 웹사이트

### 5-4. 비공개 테스트 트랙에 올리기

**테스트 및 출시 → 테스트 → 비공개 테스트**

1. **테스터** 탭 → 이메일 목록 만들기 → 지인 Gmail 주소 추가
   - ⚠️ 프로덕션 승격을 노린다면 **12명 이상**을 채워야 14일 카운트가 유효합니다
   - 테스터는 각자 **실제로 앱을 설치**해야 인원으로 인정됩니다
2. **새 버전 만들기**
3. AAB 업로드 (`app-release.aab`)
   - 여기서 Play 앱 서명이 자동으로 켜집니다 → **3단계(assetlinks) 잊지 말 것**
4. 출시명(기본값 `1 (1.0)`) 확인, 출시 노트 붙여넣기
5. **검토 → 비공개 테스트 출시 시작**
6. 테스터 탭의 **opt-in 링크**를 테스터들에게 전달 → 링크에서 "테스터 되기" 를
   눌러야 스토어에서 앱이 보입니다

비공개 테스트도 심사를 거치지만 정식 출시보다 가볍습니다(보통 **하루~며칠**).
첫 제출이라 내부 테스트보다는 오래 걸린다고 보면 됩니다.

> **14일 카운트 주의:** 트랙이 활성 상태로 연속 14일이어야 합니다. 중간에
> 출시를 중단하면 카운트가 끊깁니다. 새 버전을 올리는 건 괜찮습니다.

---

## 6. 출시 후 바로 확인할 것

- [ ] 테스터 기기에서 설치 → **로그인 (아이디 / 카카오 둘 다)**
- [ ] 카카오 로그인이 앱 안에서 끝나는지 (브라우저로 튕기면 → 3단계 assetlinks 문제)
- [ ] 식단 사진 업로드 → AI 분석 결과 표시
- [ ] 대화 탭에서 AI 응답
- [ ] 알림 권한 허용 → 설정에서 식단 알림 토글
- [ ] **설정 → 회원탈퇴** 동작 (테스트 계정으로 실제 탈퇴 한 번)

---

## 7. 자주 걸리는 반려 사유 체크

| 사유 | 대응 |
|---|---|
| 계정 삭제 경로 없음 | ✅ 앱 내 회원탈퇴 + 웹 URL 둘 다 준비됨 |
| 개인정보처리방침 URL 접속 불가 | 배포 후 실제로 열어볼 것 (CloudFront 무효화 확인) |
| 데이터 보안 신고와 실제 동작 불일치 | 건강 데이터·사진·메시지 수집을 빠짐없이 신고 |
| 심사자가 로그인 못 함 | 앱 액세스 권한에 테스트 계정을 반드시 등록 |
| 의료 주장 | 설명에 진단·치료 표현 금지 (현재 문구는 "참고용" 명시) |

---

## 8. 다음 버전 올릴 때

1. `android/app/build.gradle` 의 `versionCode` 를 +1 (versionName도 함께 올리면 좋음)
2. `npm run cap:sync`
3. `.\android\gradlew.bat -p android bundleRelease`
4. 비공개 테스트 → 새 버전 만들기 → AAB 업로드 → 출시

---

## 부록: 로컬에서 앱을 테스트하고 싶을 때

운영 DB를 건드리지 않고 로컬 백엔드로 앱을 띄울 수 있습니다.

```bash
# 로컬 백엔드 실행
cd server && docker-compose up -d

# 앱을 로컬 백엔드(10.0.2.2:8000)에 붙여 빌드
npm run cap:sync:local
```

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\android\gradlew.bat -p android installDebug
```

- 주소 설정: `.env.applocal`
- 평문 HTTP 허용은 디버그 빌드에만 적용됩니다
  (`android/app/src/debug/res/xml/network_security_config.xml`)
- 스토어 스크린샷 재생성: `node scripts/make_play_screenshots.cjs`
- 아이콘/그래픽 재생성: `node scripts/make_play_assets.cjs`

# 🤖 Google Play 출시 가이드 (Cheddar / com.cheddar.care)

개발자 계정은 만들어진 상태에서, **내부 테스트 트랙에 앱을 올리기까지** 무엇을
어떤 순서로 하면 되는지 정리한 문서입니다.

붙여넣을 문구·설문 답변은 별도 문서에 있습니다 → **[PLAY_STORE_LISTING.md](./PLAY_STORE_LISTING.md)**

---

## 0. 지금 상태 한눈에

| 준비물 | 상태 |
|---|---|
| 패키지명 `com.cheddar.care` | ✅ 확정 (첫 업로드 후 영구 고정) |
| 릴리즈 서명 keystore | ✅ `android/upload-keystore.jks` |
| 회원탈퇴(계정 삭제) 기능 | ✅ 구현 완료 (설정 → 회원탈퇴) |
| 개인정보처리방침 페이지 | ✅ `public/privacy.html` — ⚠️ 기관정보 채우고 **배포 필요** |
| 계정 삭제 안내 페이지 | ✅ `public/account-deletion.html` — ⚠️ 동일 |
| 앱 아이콘 512 / 그래픽 1024×500 | ✅ `assets/play/` |
| 휴대전화 스크린샷 5장 | ✅ `assets/play/screenshots/` |
| 스토어 문구·설문 답변 | ✅ PLAY_STORE_LISTING.md |
| **릴리즈 AAB (회원탈퇴 포함)** | ⚠️ **재빌드 필요** — 4단계 참고 |
| 운영 백엔드/프론트 배포 | ⚠️ **필요** — 2단계 참고 |

> ⚠️ 8/9에 만든 기존 `app-release.aab` 는 회원탈퇴 기능이 없어 **쓰면 안 됩니다.**

---

## 1. 콘솔 접근 권한부터 확인

랩실에서 만든 계정이라면, 본인 구글 계정이 그 개발자 계정에 **초대**되어 있어야
작업할 수 있습니다.

1. 계정을 만든 분이 [Play Console](https://play.google.com/console) →
   **사용자 및 권한 → 사용자 초대**
2. 본인 Gmail 주소를 넣고 권한 부여
   - 혼자 다 진행하려면 **관리자(Admin)**
   - 최소 권한으로 하려면 앱별로 `앱 정보 보기/수정`, `프로덕션·테스트 트랙에
     출시` 를 켜주면 됩니다
3. 초대 메일의 링크를 눌러 수락

> 계정 유형이 **조직(단체)** 이면 D-U-N-S 번호와 조직 인증이 끝나야 앱을 만들 수
> 있습니다. 인증이 심사 중이면 여기서 며칠 기다려야 할 수 있어요.

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

1. Play Console → **테스트 및 출시 → 설정 → 앱 서명**
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
> 개발·내부테스트·정식 배포 어디서든 카카오 로그인이 동작합니다.

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
- [ ] 앱 액세스 권한 → 로그인 필요 + **심사용 테스트 계정 등록**
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

### 5-4. 내부 테스트 트랙에 올리기

**테스트 및 출시 → 테스트 → 내부 테스트**

1. **테스터** 탭 → 이메일 목록 만들기 → 지인 Gmail 주소 추가
2. **새 버전 만들기**
3. AAB 업로드 (`app-release.aab`)
   - 여기서 Play 앱 서명이 자동으로 켜집니다 → **3단계(assetlinks) 잊지 말 것**
4. 출시명(기본값 `1 (1.0)`) 확인, 출시 노트 붙여넣기
5. **검토 → 내부 테스트 출시 시작**
6. 테스터 탭의 **opt-in 링크**(`https://play.google.com/apps/internaltest/...`)를
   테스터들에게 전달 → 링크에서 "테스터 되기" 를 눌러야 스토어에서 앱이 보입니다

내부 테스트는 보통 **몇 분~몇 시간** 안에 반영됩니다(정식 심사보다 훨씬 빠름).

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
4. 내부 테스트 → 새 버전 만들기 → AAB 업로드 → 출시

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

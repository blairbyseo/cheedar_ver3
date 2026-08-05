# 🍏 iOS 앱 출시 가이드 (Cheddar)

맥(macOS)에서 이 앱을 **iOS 앱으로 빌드해 App Store에 출시**하기 위한 가이드입니다.
안드로이드 앱은 이미 완성되어 있고, 코드는 그대로 재사용합니다. iOS 폴더만 새로 생성하면 됩니다.

---

## 0. 미리 알아둘 것

- 이 프로젝트는 **Capacitor** 기반입니다. (웹앱 = React + Vite → 네이티브 앱으로 감쌈)
- 모바일 작업은 **`app` 브랜치**에 있습니다. **`main`이 아닙니다.** 반드시 `app` 브랜치로 작업하세요.
- 앱 ID / Bundle ID = **`com.cheddar.care`**
- 웹 빌드는 반드시 **"앱 모드"**로 해야 합니다. (`vite build --mode app` → `.env.app`의 API 주소 사용)
  `package.json`의 `cap:sync` 스크립트에 이미 반영되어 있으니 그 스크립트를 쓰면 됩니다.
- 앱 소유자와 **같은 팀**이므로, 팀의 Apple Developer 계정으로 서명·출시하면 됩니다.

---

## 1. 필요한 것

### 프로그램 (모두 무료)
| 프로그램 | 역할 | 설치 |
|---|---|---|
| **Xcode** | iOS 빌드·서명·업로드 핵심 IDE | 맥 App Store |
| **Node.js + npm** | 웹 빌드 + Capacitor CLI | nodejs.org 또는 `brew install node` |
| **CocoaPods** | iOS 네이티브 라이브러리(플러그인) 관리 | `sudo gem install cocoapods` 또는 `brew install cocoapods` |
| **Homebrew** (선택) | 위 도구 설치 편의 | brew.sh |

### 계정 / 자료
- **Apple Developer Program** ($99/년) — 팀 계정으로 로그인
- **개인정보처리방침(Privacy Policy) URL** — App Store 심사 필수
- 앱 설명, 스크린샷 — 초안은 Claude Code가 만들어 줌

---

## 2. 진행 순서 요약

```
[1단계] 빌드 & 시뮬레이터 실행   ← Apple 계정 없어도 가능
[2단계] iOS 기능 점검
[3단계] 서명 & Apple Developer 등록
[4단계] App Store Connect 제출 & 심사
```

### 1단계 — 빌드 & 시뮬레이터 실행
1. `app` 브랜치 checkout 후 `npm install`
2. Xcode, CocoaPods 설치 확인
3. `npx cap add ios` — iOS 프로젝트(`ios/` 폴더) 생성
4. `npm run cap:sync` — 웹 빌드(--mode app) + 네이티브 동기화 + `pod install`
5. **Info.plist에 권한 설명 추가** (없으면 iOS에서 크래시):
   - `NSCameraUsageDescription` (식단 사진 촬영)
   - `NSPhotoLibraryUsageDescription` (앨범에서 사진 선택)
   - 로컬 알림 권한도 확인
6. 앱 아이콘/스플래시 확인 (없으면 Capacitor assets로 기본값 생성)
7. `npx cap open ios` → iPhone 시뮬레이터에서 빌드·실행 확인

### 2단계 — iOS 기능 점검
- 이메일 로그인 / 식단 사진 업로드 / 채팅 / 로컬 알림 동작 확인
- ⚠️ **카카오 로그인**: 현재 안드로이드용 딥링크로만 설정됨. iOS는 `Info.plist`에
  URL Scheme 등록 + Universal Links 설정이 추가로 필요. (복잡하면 우선 넘어가고
  이메일 로그인 위주로 확인)
- ⚠️ **Sign in with Apple**: 소셜 로그인(카카오)을 제공하면 애플이 "Apple로 로그인"도
  요구할 수 있음(Guideline 4.8). 해당 여부 검토 필요.

### 3단계 — 서명 & Apple Developer 등록
- Xcode > Signing & Capabilities에서 **팀 선택**, Bundle ID `com.cheddar.care` 등록
- 릴리즈 빌드 통과 확인

### 4단계 — App Store Connect 제출
- App Store Connect에 앱 레코드 생성
- 등록물: 앱 이름, 설명, 키워드, **개인정보처리방침 URL**, 스크린샷(6.7인치 등 필수 크기)
- App Privacy 설문(계정정보·식단/건강 데이터 수집), 연령 등급 설정
- Xcode에서 **Archive → App Store Connect 업로드** → 심사 제출
- 거절 시 사유 해석 후 수정

---

## 3. Claude Code에 붙여넣을 프롬프트

맥에서 Claude Code를 켜고 아래를 그대로 붙여넣으면 단계별로 진행해 줍니다.

```
나는 Mac을 쓰고 있어. 우리 팀 Capacitor 웹앱을 iOS 앱으로 빌드해서 App Store에
출시하는 것까지 도와줘. GitHub 저장소는 이미 받았어. (같은 팀이라 우리 Apple 계정으로 출시)

[프로젝트 상황]
- Capacitor 프로젝트. 모바일 작업은 git의 `app` 브랜치에 있으니 먼저 `app` 브랜치로
  checkout 해줘. (main 아님)
- appId / bundle id = com.cheddar.care. 아직 iOS 폴더(ios/)가 없어서 새로 만들어야 해.
- 웹 빌드는 반드시 "앱 모드"로. package.json의 `cap:sync` 스크립트가
  `vite build --mode app`을 쓰도록 되어 있으니 그걸 사용해줘. (.env.app 참고)
- 저장소 루트의 IOS_RELEASE_GUIDE.md에 전체 계획이 정리돼 있으니 참고해.

각 단계마다 진행 상황을 설명하고, 내 입력이 필요한 부분(계정 로그인, 앱 설명,
스크린샷 승인 등)에서는 멈추고 물어봐줘.

[1단계 — 빌드 & 시뮬레이터 실행]
1. `app` 브랜치 checkout 후 `npm install`
2. Xcode와 CocoaPods 설치 확인, 없으면 설치 안내
3. `npx cap add ios`로 iOS 프로젝트 생성
4. `npm run cap:sync` 실행 (웹 빌드 --mode app + 동기화 + pod install)
5. iOS Info.plist에 NSCameraUsageDescription, NSPhotoLibraryUsageDescription 추가
   (식단 사진 업로드 때문. 없으면 크래시남). 로컬 알림 권한도 확인.
6. 앱 아이콘/스플래시 확인, 없으면 기본값 생성
7. `npx cap open ios` → iPhone 시뮬레이터에서 빌드·실행 확인, 스크린샷 보여줘

[2단계 — iOS 기능 점검]
8. 이메일 로그인, 식단 사진 업로드, 채팅, 로컬 알림이 iOS에서 동작하는지 확인
9. 카카오 로그인은 안드로이드용 딥링크로만 설정돼 있어. iOS에서 되게 하려면
   URL Scheme + Universal Links 설정이 필요해. 가능하면 설정하고, 복잡하면
   무슨 작업이 필요한지 정리해서 알려줘.
10. 소셜 로그인 제공 시 "Sign in with Apple" 요구(Guideline 4.8) 해당 여부 검토.

[3단계 — 서명 & Apple Developer 등록]
11. Xcode에서 우리 팀으로 서명 설정, bundle id com.cheddar.care 등록
12. 릴리즈 빌드 통과 확인

[4단계 — App Store Connect 제출]
13. App Store Connect에 앱 레코드 생성
14. 앱 설명/키워드/홍보문구 초안 작성. 개인정보처리방침 URL 필요(없으면 만드는 법 안내).
15. 시뮬레이터로 필수 크기 스크린샷 촬영
16. App Privacy 설문(계정정보·식단/건강 데이터 수집), 연령 등급 설정
17. Xcode에서 Archive → App Store Connect 업로드
18. 심사 제출. 거절되면 사유 해석해서 수정 방향 알려줘

각 단계 끝나면 무엇을 했고 다음에 내 확인이 필요한 게 뭔지 요약해줘.
```

---

## 4. 자주 막히는 곳 (체크리스트)

- [ ] **`app` 브랜치**에서 작업했는가? (main에서 하면 모바일 코드 없음)
- [ ] 웹 빌드를 `--mode app`으로 했는가? (안 그러면 API 주소가 틀려서 로그인 실패)
- [ ] Info.plist에 카메라/사진 권한 설명을 넣었는가? (안 넣으면 사진 기능에서 크래시)
- [ ] CocoaPods `pod install`이 성공했는가?
- [ ] 개인정보처리방침 URL을 준비했는가? (심사 필수)
- [ ] 서명(Signing) 팀이 우리 Apple Developer 팀으로 설정됐는가?

---

## 5. 참고

- 안드로이드 쪽 이식/설정 내역은 커밋 히스토리와 `capacitor.config.json` 참고.
- CapacitorHttp가 켜져 있어(`capacitor.config.json`) CORS/쿠키 문제 없이 API 호출됨. iOS도 동일하게 동작.
- 문제가 생기면 Claude Code에 에러 메시지를 그대로 붙여넣으면 대부분 해결됨.

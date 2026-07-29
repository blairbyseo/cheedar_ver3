# 앱(Capacitor) 전용 환경변수. `vite build --mode app` 일 때만 로드된다.
# 웹 빌드(vite build, production 모드)는 이 파일을 읽지 않으므로 웹 동작 불변.
#
# 앱 안에서 fetch("/api/...") 가 붙일 백엔드 절대주소.
VITE_API_BASE=https://api.cheddar-care.com

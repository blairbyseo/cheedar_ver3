/* 웹/앱 공통 API 베이스 주소 스위치.
 *
 * 왜 필요한가:
 *   웹 브라우저에서 fetch("/api/...") 는 "현재 도메인 + /api" 로 풀린다(정상).
 *   하지만 Capacitor 앱 안에서는 현재 주소가 http://localhost(기기 내부)라
 *   fetch("/api/...") 가 백엔드가 아니라 폰 자기 자신을 가리켜 전부 실패한다.
 *
 * 어떻게 푸는가:
 *   - 웹 빌드: VITE_API_BASE 없음 → API_BASE="" → 아무 것도 안 함(기존 동작 100% 동일).
 *   - 앱 빌드(vite build --mode app): .env.app 의 VITE_API_BASE 가 채워짐 →
 *     앱 시작 시 window.fetch 를 감싸서 "/api"·"/uploads" 로 시작하는 요청 앞에
 *     절대주소를 붙여준다. 각 화면의 fetch("/api/...") 코드는 한 줄도 안 바꾼다.
 */

// 웹에서는 "" (Vite 가 정의 안 된 env 를 undefined 로 치환 → || "" 로 흡수).
export const API_BASE = import.meta.env.VITE_API_BASE || "";

/** API_BASE 가 설정된 앱 빌드에서만 fetch 를 감싼다. 웹(API_BASE="")에서는 no-op. */
export function installApiBaseFetch() {
  if (!API_BASE) return; // 웹: 아무 것도 안 함 → 기존과 동일
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    // 각 화면이 쓰는 상대경로 문자열만 절대주소로 바꾼다.
    if (
      typeof input === "string" &&
      (input.startsWith("/api") || input.startsWith("/uploads"))
    ) {
      return nativeFetch(API_BASE + input, init);
    }
    // Request 객체이거나 이미 절대주소면 그대로 통과
    return nativeFetch(input, init);
  };
}

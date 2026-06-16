/* 사용자 텔레메트리 전송 클라이언트.
 *
 * 페이지 체류시간/동선 전환 샘플을 백엔드(/api/telemetry/*)로 보낸다.
 * 관리자 분석(대시보드 차트)에서 이 샘플들을 집계한다. fire-and-forget.
 *
 * 이 앱은 쿠키 기반 인증(credentials: include) + 상태 기반 탭 네비게이션이라,
 * 참조(Cheddar_Team_26)의 axios+Bearer 버전을 fetch+쿠키로 옮겼다.
 */

async function postJson(path, body) {
  await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 페이지 체류시간 샘플 1건. */
export function postPageTimeSample({ pagePath, timeSpentSeconds }) {
  return postJson("/telemetry/page-time", {
    page_path: pagePath,
    time_spent_seconds: timeSpentSeconds,
  });
}

/** 페이지 전환(from -> to) 샘플 1건. */
export function postUserFlowSample({ fromPage, toPage }) {
  return postJson("/telemetry/user-flow", {
    from_page: fromPage,
    to_page: toPage,
  });
}

/** 탭/창이 닫힐 때 마지막 체류시간을 best-effort 로 전송(keepalive).
 *
 * 일반 요청은 탭 종료 시 취소될 수 있어 fetch(keepalive:true) 로 보낸다.
 * 인증은 쿠키(credentials:include)로 처리하므로 토큰을 따로 읽지 않는다.
 */
export function postPageTimeSampleKeepalive({ pagePath, timeSpentSeconds }) {
  try {
    fetch("/api/telemetry/page-time", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page_path: pagePath,
        time_spent_seconds: timeSpentSeconds,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort — 실패 무시
  }
}

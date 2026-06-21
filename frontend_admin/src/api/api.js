/* 백엔드(FastAPI) 호출을 한 곳에 모은 얇은 래퍼.
 *
 * - 모든 요청은 쿠키 기반 인증(credentials: include) — 사용자 앱과 동일.
 * - /api 는 vite.config.js 의 프록시가 백엔드(8000)로 넘긴다.
 * - 실패하면 백엔드가 준 detail 메시지를 담은 Error 를 던진다(상태코드 포함).
 */

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.detail || `요청에 실패했어요 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

function qs(params) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.append(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // --- 인증 ---
  me: () => request("/auth/me"),
  login: (userId, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, password }),
    }),
  logout: () => request("/auth/logout", { method: "POST" }),

  // --- 관리자 ---
  dashboard: () => request("/admin/stats/dashboard"),
  users: ({ q, page, pageSize } = {}) =>
    request(`/admin/users${qs({ q, page, page_size: pageSize })}`),
  user: (id) => request(`/admin/users/${id}`),
  userMeals: (id) => request(`/admin/users/${id}/meals`),
  userChat: (id) => request(`/admin/users/${id}/chat-messages`),
  userPoints: (id) => request(`/admin/users/${id}/points`),

  // --- 분석(대시보드 차트) ---
  analyticsActivityWeekly: ({ from, to } = {}) =>
    request(`/admin/analytics/activity-weekly${qs({ from, to })}`),
  analyticsRecordFrequency: ({ breakdown, from, to } = {}) =>
    request(`/admin/analytics/record-frequency${qs({ breakdown, from, to })}`),
  analyticsPageTime: ({ from, to } = {}) =>
    request(`/admin/analytics/page-time${qs({ from, to })}`),
  analyticsUserFlow: ({ from, to } = {}) =>
    request(`/admin/analytics/user-flow${qs({ from, to })}`),

  // --- 위험 신호 ---
  safetyEvents: ({ status, risk } = {}) =>
    request(`/admin/safety-events${qs({ status, risk })}`),
  userSafetyEvents: (id) => request(`/admin/users/${id}/safety-events`),
  resolveSafetyEvent: (id, status) =>
    request(`/admin/safety-events/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  // --- 문의하기 ---
  // status: open(미처리) | resolved(처리완료) | all. 미지정 시 백엔드 기본 open.
  inquiries: ({ status } = {}) => request(`/admin/inquiries${qs({ status })}`),
  resolveInquiry: (id, isResolved) =>
    request(`/admin/inquiries/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_resolved: isResolved }),
    }),

  // --- 현금 보상 신청 ---
  // status 미지정 시 전체. 응답: { items, total, counts: {pending,paid,rejected} }
  rewardClaims: ({ status } = {}) =>
    request(`/admin/reward-claims${qs({ status })}`),
  // 신청 처리 — status 는 "paid"(지급완료) 또는 "rejected"(반려).
  updateRewardClaim: (id, status, adminNote) =>
    request(`/admin/reward-claims/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, admin_note: adminNote ?? null }),
    }),
};

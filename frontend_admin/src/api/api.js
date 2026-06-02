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
};

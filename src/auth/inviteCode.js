/* 가입 초대코드 — 저장·조회·검증.
 *
 * 코드는 "계정을 만들 때"만 필요하다. 로그인에는 쓰이지 않으므로,
 * 앱을 지웠다 깔아도 기존 사용자는 코드 없이 그대로 로그인된다.
 *
 * 한 번 통과한 코드는 기기에 저장해 둔다. 카카오 가입은
 * (코드 입력 → 카카오 인증) 두 화면을 오가야 해서, 그 사이에 코드를
 * 들고 있을 곳이 필요하기 때문이다.
 */

const STORAGE_KEY = "cheddar.inviteCode";

/** 저장해 둔 초대코드. 없으면 null. */
export function loadInviteCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    // 시크릿 모드 등에서 localStorage 접근이 막히는 경우
    return null;
  }
}

export function saveInviteCode(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* 저장 못 해도 가입 자체는 진행된다 */
  }
}

export function clearInviteCode() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/**
 * 이 서버가 초대코드를 요구하는지 확인한다.
 *
 * 앱 업데이트와 서버 배포는 시점이 어긋난다 — 초대코드 화면이 든 앱이
 * 먼저 깔리고 서버가 아직 옛 버전이면, 관문만 세워두고 통과할 방법이 없어
 * 가입이 통째로 막힌다. 그래서 엔드포인트 존재 여부(404)로 판단해
 * 서버가 준비된 뒤에 관문이 저절로 켜지게 한다.
 *
 * 네트워크 실패 시에도 막지 않는다 — 가입을 못 하게 만드는 쪽이 더 나쁘고,
 * 실제 차단은 어차피 가입 요청에서 서버가 한 번 더 검증한다.
 */
export async function isInviteRequired() {
  try {
    const res = await fetch("/api/auth/invite-code/check", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "" }),
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

/**
 * 코드가 지금 쓸 수 있는지 서버에 확인한다(소모하지 않음).
 * 성공하면 정규화된 코드를 저장하고 그 값을 돌려준다.
 * 실패하면 서버가 준 한국어 안내를 담은 Error 를 던진다.
 */
export async function verifyInviteCode(rawCode) {
  const res = await fetch("/api/auth/invite-code/check", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: rawCode }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `초대코드를 확인하지 못했어요 (${res.status})`);
  }
  const data = await res.json();
  saveInviteCode(data.code);
  return data;
}

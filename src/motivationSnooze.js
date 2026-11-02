/* 동기 점검 창의 '나중에'(하루 미루기) 상태 + 이번 진입에 뜰 예정인지 확인.
 * MotivationCheck.jsx 와 건강 연결 안내 팝업(health/HealthInvite.jsx)이 같이 쓴다. */

const SNOOZE_KEY = "cheddar.motivationSnoozeUntil";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function isSnoozed() {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

export function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // 저장소를 못 쓰면 이번 실행에서만 닫힌다.
  }
}

/** 이번 진입에 동기 점검 창이 뜰 예정인지 — 다른 홈 팝업이 겹치지 않게 확인용. */
export async function motivationCheckPending() {
  if (isSnoozed()) return false;
  try {
    const res = await fetch("/api/motivation/status", { credentials: "include" });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.due;
  } catch {
    return false;
  }
}

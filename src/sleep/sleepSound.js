/* 소리 수면 측정 — 화면 쪽 연결 파일.
 *
 * 안드로이드 앱 안의 요청 창구(SleepSoundPlugin.java)를 부르고, 아침에 받은 결과를
 * 서버의 기존 수면 저장 기능(POST /api/health/sleep)으로 보낸다. 출처는 "phone_mic".
 *
 * 흐름: 시작 → 녹음 서비스가 밤새 30초마다 판정을 휴대폰 안에 쌓음 → 멈춤 → 결과 3가지
 *       (잔 시간·잠든 시각·일어난 시각) → 서버 전송. 소리 자체는 어디에도 저장·전송하지 않는다.
 * 판정 방식은 DeltaSleep(MIT)을 옮긴 것 — android/app/src/main/java/com/cheddar/care/sleep/ 참고.
 *
 * 안드로이드 앱에서만 동작. 웹·iOS 에서는 모든 함수가 아무 일도 하지 않는다.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

const SleepSound = registerPlugin("SleepSound");

// 한 번이라도 휴대폰 마이크 측정을 시작했는지 — Health Connect 수면이 같은 날을 덮어쓰지 않게 하는 데 쓴다
export const SLEEP_MIC_USED_KEY = "sleep.mic.used";
// 마지막 결과(홈 카드 표시용)
const LAST_RESULT_KEY = "sleep.mic.last";
// 수면 결과가 새로 생기면 홈 카드가 다시 읽도록 알리는 이벤트
export const SLEEP_UPDATED_EVENT = "cheddar:sleep-updated";
// 걸음수·수면이 서버에 새로 올라갔다는 신호 — 홈 인사말이 다시 불러온다(Home.jsx).
// 아침에 앱을 열면 인사말 요청이 수면 결과 업로드보다 먼저 끝날 수 있어서 필요하다.
export const HEALTH_UPDATED_EVENT = "cheddar:health-updated";

export function isSleepSoundAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function sleepMicWasUsed() {
  try {
    return localStorage.getItem(SLEEP_MIC_USED_KEY) === "1";
  } catch {
    return false;
  }
}

export function loadLastSleepResult() {
  try {
    return JSON.parse(localStorage.getItem(LAST_RESULT_KEY)) || null;
  } catch {
    return null;
  }
}

function saveLastSleepResult(result) {
  try {
    localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(result));
  } catch {
    // 저장소를 못 쓰면 카드에 지난 결과만 안 보인다
  }
  // 앱을 다시 열 때 올라간 결과가 카드에 바로 보이도록(먼저 그려진 카드가 다시 읽는다)
  window.dispatchEvent(new Event(SLEEP_UPDATED_EVENT));
}

/** {running, sessionId, startedAt, epochCount}. 앱이 아니면 null. */
export async function getSleepStatus() {
  if (!isSleepSoundAvailable()) return null;
  return SleepSound.getStatus();
}

// ───────── 매일 밤 자동 기록(한 번 켜면 끝) ─────────
// 밤(저녁 8시~낮 12시)에 휴대폰 화면이 꺼져 있을 때만 마이크로 잰다. 사용자가 정하는 시각은 없다.

/**
 * 자동 기록 켜기/끄기. 켤 때 마이크 권한을 먼저 묻는다.
 * 반환: { status: "on" | "off" | "denied" | "unavailable" }
 */
export async function setAutoSleep(enabled) {
  if (!isSleepSoundAvailable()) return { status: "unavailable" };
  if (enabled) {
    const perm = await SleepSound.requestMicPermission();
    if (!perm?.granted) return { status: "denied" };
    try {
      localStorage.setItem(SLEEP_MIC_USED_KEY, "1");
    } catch {
      // 무시 — Health Connect 수면과 겹칠 수 있다는 것뿐
    }
  }
  await SleepSound.setAutoMode({ enabled });
  return { status: enabled ? "on" : "off" };
}

/** 앱이 열릴 때마다 — 자동 기록이 꺼져 있으면(재부팅 등) 다시 켠다. */
export async function ensureAutoSleep() {
  if (!isSleepSoundAvailable()) return null;
  try {
    return await SleepSound.ensureAuto();
  } catch (err) {
    console.error("[SleepSound] 자동 기록 다시 켜기 실패:", err);
    return null;
  }
}

let uploading = null;

/**
 * 아직 서버에 못 보낸 밤 결과를 보낸다. 앱 진입·복귀 때마다 불러도 된다.
 * 밤중에 끊긴 측정도 이때 마무리돼 함께 올라간다.
 */
export function uploadPendingNights() {
  if (!isSleepSoundAvailable()) return Promise.resolve(null);
  if (!uploading) {
    uploading = doUpload().finally(() => {
      uploading = null;
    });
  }
  return uploading;
}

async function doUpload() {
  try {
    const { nights = [] } = (await SleepSound.getPendingNights()) || {};
    if (nights.length === 0) return null;

    // 같은 날이 두 번 있으면(낮잠 측정 등) 더 오래 잔 쪽만 — 서버는 날짜당 한 줄
    const byDay = new Map();
    for (const n of nights) {
      const prev = byDay.get(n.day);
      if (!prev || n.asleep_minutes > prev.asleep_minutes) byDay.set(n.day, n);
    }
    const latest = nights[nights.length - 1];
    if (latest) saveLastSleepResult(latest);

    const res = await fetch("/api/health/sleep", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "phone_mic",
        nights: [...byDay.values()].map((n) => ({
          day: n.day,
          asleep_minutes: n.asleep_minutes,
          bed_start: n.bed_start,
          wake_end: n.wake_end,
        })),
      }),
    });
    if (!res.ok) throw new Error(`/api/health/sleep ${res.status}`);
    await SleepSound.markUploaded({ sessionIds: nights.map((n) => n.sessionId) });
    window.dispatchEvent(new Event(HEALTH_UPDATED_EVENT));
    return res.json();
  } catch (err) {
    console.error("[SleepSound] 수면 결과 전송 실패 — 다음에 다시 보냄:", err);
    return null;
  }
}

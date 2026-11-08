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
}

/** {running, sessionId, startedAt, epochCount}. 앱이 아니면 null. */
export async function getSleepStatus() {
  if (!isSleepSoundAvailable()) return null;
  return SleepSound.getStatus();
}

/**
 * 측정 시작. 마이크 권한이 없으면 먼저 묻는다.
 * 반환: { status: "started" | "denied", startedAt }
 */
export async function startSleepMeasure() {
  if (!isSleepSoundAvailable()) return { status: "unavailable" };
  const perm = await SleepSound.requestMicPermission();
  if (!perm?.granted) return { status: "denied" };
  try {
    localStorage.setItem(SLEEP_MIC_USED_KEY, "1");
  } catch {
    // 무시 — Health Connect 수면과 겹칠 수 있다는 것뿐
  }
  const res = await SleepSound.start();
  return { status: "started", startedAt: res?.startedAt };
}

/**
 * 측정 끝. 결과를 받아 바로 서버로 보낸다(실패하면 다음에 앱을 열 때 다시 보냄).
 * 반환: { summary | null, reason: "ok" | "too_short" | "not_running", interrupted }
 */
export async function stopSleepMeasure() {
  if (!isSleepSoundAvailable()) return { summary: null, reason: "unavailable" };
  const res = await SleepSound.stop();
  const summary = res?.summary || null;
  if (summary) saveLastSleepResult(summary);
  await uploadPendingNights();
  return { summary, reason: res?.reason || "ok", interrupted: !!res?.interrupted };
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
    return res.json();
  } catch (err) {
    console.error("[SleepSound] 수면 결과 전송 실패 — 다음에 다시 보냄:", err);
    return null;
  }
}

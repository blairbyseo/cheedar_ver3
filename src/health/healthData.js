/* 스마트폰 건강 데이터(걸음수·수면) 연동.
 *
 * - 걸음수(안드로이드): **폰 센서**. Google Play 서비스의 Recording API 가 폰의 걸음 센서를 직접
 *   기록한다(앱 내장 플러그인 StepSensorPlugin.java). 삼성 헬스·Health Connect 를 거치지 않는다.
 *   2026-11-08 교체 — 삼성 헬스→Health Connect 쓰기가 기본 꺼짐이거나 몇 시간~하루씩 늦어서
 *   대부분 사용자에게 걸음이 안 들어왔다. 대신 "연결한 순간부터" 센다(과거 기록 X), 워치 걸음 X.
 * - 걸음수(iOS): 아직 HealthKit (@capgo/capacitor-health).
 * - 수면: Health Connect/HealthKit (@capgo/capacitor-health). 플러그인은 '조각' 목록만 줘서
 *   여기서 하룻밤으로 합친다(일어난 날짜 기준, 깬 구간 제외). 호흡음 측정으로 바꿀 예정.
 * 웹에서는 전부 no-op.
 *
 * 제품 원칙(2026-10-12 결정, HEALTH_DATA_INTEGRATION.md):
 * - 포인트 적립에 쓰지 않는다. 주간 리포트·동기 점검·AI 선인사 맥락으로만.
 * - 권한을 거절하거나 연동을 안 켜도 모든 기능이 그대로 동작해야 한다.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Health } from "@capgo/capacitor-health";
import { sleepMicWasUsed } from "../sleep/sleepSound";

// android/app/src/main/java/com/cheddar/care/StepSensorPlugin.java
const StepSensor = registerPlugin("StepSensor");

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

function isAndroid() {
  return Capacitor.getPlatform() === "android";
}

// 연동 토글 상태. 기본값은 꺼짐 — 건강 데이터는 사용자가 직접 켜는 선택 기능.
// (키 이름은 걸음수만 있던 시절 그대로 — 이미 켠 사용자의 설정을 유지하기 위해)
export const HEALTH_SYNC_KEY = "health.steps";

export function isHealthSyncEnabled() {
  try {
    return localStorage.getItem(HEALTH_SYNC_KEY) === "on";
  } catch {
    return false;
  }
}

export function setHealthSyncEnabled(on) {
  try {
    localStorage.setItem(HEALTH_SYNC_KEY, on ? "on" : "off");
  } catch {
    // 저장소를 못 쓰면 이번 실행에서만 유지된다
  }
}

// 서버에 올릴 때 출처 표시. 나중에 출처별 품질 비교용.
function stepsSourceName() {
  return isAndroid() ? "phone_sensor" : "healthkit";
}
function sleepSourceName() {
  return isAndroid() ? "health_connect" : "healthkit";
}

// ───────────────────────── 사용 가능 여부 ─────────────────────────

/** Health Connect(안드로이드)/HealthKit(iOS)을 쓸 수 있는지 — 이제 안드로이드에선 수면용. */
export async function checkHealthAvailable() {
  if (!isNativeApp()) return { available: false, reason: "web" };
  try {
    const res = await Health.isAvailable();
    return { available: !!res?.available, reason: res?.reason || "" };
  } catch (err) {
    console.error("[Health] isAvailable 실패:", err);
    return { available: false, reason: String(err?.message || err) };
  }
}

/** 걸음수를 읽을 수 있는지. 안드로이드=폰 센서(Play 서비스 버전), iOS=HealthKit. */
export async function checkStepsAvailable() {
  if (!isNativeApp()) return { available: false, reason: "web" };
  if (!isAndroid()) return checkHealthAvailable();
  try {
    const res = await StepSensor.isAvailable();
    return { available: !!res?.available, reason: res?.reason || "" };
  } catch (err) {
    console.error("[StepSensor] isAvailable 실패:", err);
    return { available: false, reason: String(err?.message || err) };
  }
}

/** 걸음수든 수면이든 하나라도 연결할 수 있는 기기인지 — 안내 팝업·설정 카드 노출 판단용. */
export async function checkAnyHealthAvailable() {
  const [steps, hc] = await Promise.all([checkStepsAvailable(), checkHealthAvailable()]);
  return steps.available || hc.available;
}

// ───────────────────────── 권한 ─────────────────────────

function authorizedSet(res) {
  return new Set(Array.isArray(res?.readAuthorized) ? res.readAuthorized : []);
}

/** 권한 창 없이 현재 허용 상태만 확인. { steps, sleep, any } */
export async function checkHealthPermissions() {
  const none = { steps: false, sleep: false, any: false };
  if (!isNativeApp()) return none;
  let steps = false;
  let sleep = false;
  if (isAndroid()) {
    try {
      steps = !!(await StepSensor.checkActivityPermission())?.granted;
    } catch {
      steps = false;
    }
  }
  try {
    const types = isAndroid() ? ["sleep"] : ["steps", "sleep"];
    const got = authorizedSet(await Health.checkAuthorization({ read: types }));
    if (!isAndroid()) steps = got.has("steps");
    sleep = got.has("sleep");
  } catch {
    // Health Connect 미설치 등 — 수면만 없는 것으로 본다
  }
  return { steps, sleep, any: steps || sleep };
}

/**
 * 안드로이드 걸음 센서: '신체 활동' 권한 → 기록 시작(subscribe). 허용되면 true.
 * subscribe 한 순간부터 Play 서비스가 앱이 꺼져 있어도 계속 센다.
 */
async function connectStepSensor() {
  const perm = await StepSensor.requestActivityPermission();
  if (!perm?.granted) return false;
  await StepSensor.subscribe();
  return true;
}

// ───────────────────────── Health Connect 설정 ─────────────────────────

/** Health Connect 설정 화면(수면 권한)을 연다. 안드로이드 전용. 미설치면 아무 일 없음. */
export async function openHealthSettings() {
  if (!isNativeApp() || !isAndroid()) return;
  try {
    await Health.openHealthConnectSettings();
  } catch (err) {
    console.error("[Health] 설정 열기 실패:", err);
  }
}

// Date → 기기 로컬 날짜 "YYYY-MM-DD". (toISOString 은 UTC 라 자정 근처에 하루가 밀린다)
function localDayString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeStart(days) {
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

// ───────────────────────── 걸음수 ─────────────────────────

/**
 * 최근 N일(오늘 포함) 일별 걸음수 합계. [{ day: "2026-10-19", steps: 6543 }, ...]
 * 안드로이드: 폰 센서(최대 10일 보관). iOS: HealthKit queryAggregated(일 합계, 중복 제거).
 */
export async function readDailySteps(days = 7) {
  if (!isNativeApp()) return [];
  if (isAndroid()) {
    // 혹시 Play 서비스 쪽 구독이 풀렸어도(데이터 초기화 등) 다시 걸어 둔다 — 이미 구독 중이면 무해
    await StepSensor.subscribe();
    const res = await StepSensor.readDailySteps({ days });
    return (res?.days || [])
      .map((r) => ({ day: r.day, steps: Math.round(Number(r.steps) || 0) }))
      .filter((r) => r.steps > 0)
      .sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  const res = await Health.queryAggregated({
    dataType: "steps",
    startDate: rangeStart(days).toISOString(),
    endDate: new Date().toISOString(),
    bucket: "day",
    aggregation: "sum",
  });
  const byDay = new Map();
  for (const s of res?.samples || []) {
    const value = Number(s?.value ?? s?.values?.sum ?? 0);
    if (!Number.isFinite(value) || value < 0) continue;
    const key = localDayString(new Date(s.startDate));
    byDay.set(key, Math.round((byDay.get(key) || 0) + value));
  }
  return [...byDay.entries()]
    .map(([day, steps]) => ({ day, steps }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

// ───────────────────────── 수면 ─────────────────────────

// 깨어 있던 구간 — 수면 시간에서 뺀다. 나머지(asleep/rem/deep/light/미표기)는 잔 것으로 본다.
const AWAKE_STATES = new Set(["awake", "inBed"]);

/**
 * 수면 조각 목록 → 실제로 잔 구간 [{start, end}] 로 펼친다.
 * - 단계(stages) 정보가 있으면 단계별로 쪼개고 awake/inBed 단계는 버린다.
 * - 없으면 조각 자체를 하나의 구간으로. 조각이 awake/inBed 면 버린다.
 */
function asleepIntervals(samples) {
  const out = [];
  for (const s of samples) {
    if (s?.hasStageData && Array.isArray(s.stages) && s.stages.length > 0) {
      for (const st of s.stages) {
        if (AWAKE_STATES.has(st.stage)) continue;
        out.push({ start: new Date(st.startDate), end: new Date(st.endDate) });
      }
      continue;
    }
    if (AWAKE_STATES.has(s?.sleepState)) continue;
    out.push({ start: new Date(s.startDate), end: new Date(s.endDate) });
  }
  return out.filter((iv) => iv.end > iv.start);
}

/** 겹치는 구간을 합친다(폰+워치가 같은 밤을 둘 다 기록해도 두 배로 안 세게). */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      merged.push({ start: new Date(iv.start), end: new Date(iv.end) });
    }
  }
  return merged;
}

/**
 * 조각 → 하룻밤. 각 구간을 **끝난(일어난) 날짜**에 붙이고 그 날의 구간을 전부 합산한다.
 * 반환: [{ day, asleep_minutes, bed_start, wake_end }, ...] (day 오름차순)
 *
 * 수면 조각은 플러그인이 집계를 지원하지 않아 여기서 직접 합친다. 자정을 넘겨 자므로
 * 잠든 날이 아니라 깬 날이 "그 밤"이다. 낮잠도 같은 날에 더해진다(별도 구분 X).
 */
export function buildNightsFromSamples(samples) {
  const byDay = new Map();
  for (const iv of mergeIntervals(asleepIntervals(samples))) {
    const key = localDayString(iv.end);
    const night = byDay.get(key) || { minutes: 0, start: iv.start, end: iv.end };
    night.minutes += (iv.end - iv.start) / 60000;
    if (iv.start < night.start) night.start = iv.start;
    if (iv.end > night.end) night.end = iv.end;
    byDay.set(key, night);
  }
  return [...byDay.entries()]
    .map(([day, n]) => ({
      day,
      asleep_minutes: Math.round(n.minutes),
      bed_start: n.start.toISOString(),
      wake_end: n.end.toISOString(),
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** 최근 N일 밤 수면을 읽어 하룻밤 단위로 만든다. */
export async function readNightlySleep(days = 7) {
  if (!isNativeApp()) return [];
  // 첫날 밤은 전날 저녁에 시작하므로 조회 시작을 하루 앞당긴다.
  const start = rangeStart(days);
  start.setDate(start.getDate() - 1);
  const res = await Health.readSamples({
    dataType: "sleep",
    startDate: start.toISOString(),
    endDate: new Date().toISOString(),
    limit: 500,
    ascending: true,
  });
  return buildNightsFromSamples(res?.samples || []);
}

// ───────────────────────── 서버 동기화 ─────────────────────────

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

/**
 * 허용된 데이터만 읽어 서버에 올린다. 권한 창은 띄우지 않는다.
 * 걸음·수면은 서로 독립 — 한쪽이 실패해도 다른 쪽은 올린다.
 * 반환: { steps: 서버응답|null, sleep: 서버응답|null } — 둘 다 null 이면 올린 게 없음.
 */
export async function syncHealthToServer(days = 7) {
  const result = { steps: null, sleep: null };
  if (!isNativeApp()) return result;
  const perm = await checkHealthPermissions();
  if (perm.steps) {
    try {
      const rows = await readDailySteps(days);
      if (rows.length > 0) {
        result.steps = await post("/api/health/steps", { source: stepsSourceName(), days: rows });
      }
    } catch (err) {
      console.error("[Health] 걸음수 동기화 실패:", err);
    }
  }
  // 휴대폰 마이크로 수면을 재기 시작한 사용자는 Health Connect 수면을 올리지 않는다 —
  // 서버는 날짜당 한 줄이라 나중에 올린 쪽이 마이크 결과를 덮어쓰기 때문(src/sleep/sleepSound.js)
  if (perm.sleep && !sleepMicWasUsed()) {
    try {
      const nights = await readNightlySleep(days);
      if (nights.length > 0) {
        result.sleep = await post("/api/health/sleep", { source: sleepSourceName(), nights });
      }
    } catch (err) {
      console.error("[Health] 수면 동기화 실패:", err);
    }
  }
  return result;
}

/**
 * 연동 켜기 전체 흐름 — 설정 토글과 홈 안내 팝업이 같이 쓴다.
 * 안드로이드: '신체 활동' 권한(걸음 센서) → Health Connect 가 있으면 수면 권한 → 바로 동기화.
 * iOS: HealthKit 에서 걸음·수면을 한 번에.
 * 반환: { status, stepsGranted, sleepGranted, gotSteps, gotSleep }
 *   status: "connected" | "no-data" | "denied" | "unavailable"
 *   안드로이드 걸음 센서는 연결한 순간부터 세므로 처음엔 데이터가 없어도 "connected".
 * 예외는 그대로 던진다(호출 쪽에서 '연동 실패' 안내).
 */
export async function connectHealth() {
  const [stepsAvail, hcAvail] = await Promise.all([checkStepsAvailable(), checkHealthAvailable()]);
  if (!stepsAvail.available && !hcAvail.available) return { status: "unavailable" };

  let stepsGranted = false;
  let sleepGranted = false;
  if (isAndroid()) {
    if (stepsAvail.available) stepsGranted = await connectStepSensor();
    if (hcAvail.available) {
      try {
        const got = authorizedSet(await Health.requestAuthorization({ read: ["sleep"] }));
        sleepGranted = got.has("sleep");
      } catch (err) {
        console.error("[Health] 수면 권한 요청 실패:", err);
      }
    }
  } else {
    const got = authorizedSet(await Health.requestAuthorization({ read: ["steps", "sleep"] }));
    stepsGranted = got.has("steps");
    sleepGranted = got.has("sleep");
  }
  if (!stepsGranted && !sleepGranted) return { status: "denied", stepsGranted, sleepGranted };

  setHealthSyncEnabled(true);
  const result = await syncHealthIfEnabled({ force: true });
  const gotSteps = !!result?.steps?.latest_day;
  const gotSleep = !!result?.sleep?.latest_day;
  const connected = gotSteps || gotSleep || (isAndroid() && stepsGranted);
  return {
    status: connected ? "connected" : "no-data",
    stepsGranted,
    sleepGranted,
    gotSteps,
    gotSleep,
  };
}

/** 연결 직후 안내 문구 — 폰 센서는 지금부터 세기 시작하므로 그렇게 알려 준다. */
export function connectedMessage(stepsGranted, gotSleep) {
  const parts = [];
  if (stepsGranted) parts.push("걸음수는 지금부터 휴대폰이 직접 세요.");
  if (gotSleep) parts.push("수면 기록도 연결됐어요.");
  return `연결됐어요! ${parts.join(" ")} 체다가 대화할 때 참고할게요.`;
}

/**
 * 예전(Health Connect 걸음수) 방식으로 연동을 켜 둔 사용자 — 토글은 켜져 있는데
 * 걸음 센서 권한이 없다. 설정 화면에서 '다시 연결' 안내를 띄우는 데 쓴다.
 */
export async function stepsNeedReconnect() {
  if (!isNativeApp() || !isAndroid() || !isHealthSyncEnabled()) return false;
  const avail = await checkStepsAvailable();
  if (!avail.available) return false;
  const perm = await checkHealthPermissions();
  return !perm.steps;
}

// 같은 세션에서 너무 자주 올리지 않도록 — 앱 복귀 때마다 호출돼도 10분에 한 번만.
const SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastSyncAt = 0;

/** 토글이 켜져 있으면 동기화. 앱 진입·복귀 시 호출. 웹/꺼짐이면 null. */
export async function syncHealthIfEnabled({ force = false } = {}) {
  if (!isNativeApp() || !isHealthSyncEnabled()) return null;
  if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return null;
  lastSyncAt = Date.now();
  try {
    return await syncHealthToServer();
  } catch (err) {
    console.error("[Health] 건강 데이터 동기화 실패:", err);
    return null;
  }
}

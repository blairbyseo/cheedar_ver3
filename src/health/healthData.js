/* 스마트폰 건강 데이터(걸음수·수면) 연동.
 *
 * 안드로이드는 Health Connect, iOS 는 HealthKit 에서 읽어 서버에 올린다.
 * 플러그인 @capgo/capacitor-health 가 두 플랫폼을 같은 API 로 감싸준다. 웹에서는 전부 no-op.
 *
 * - 걸음수: 플러그인이 일별 합계를 바로 준다(queryAggregated). → POST /api/health/steps
 * - 수면  : 플러그인은 '조각(세션/단계)' 목록만 준다(readSamples). 여기서 조각을 합쳐
 *           "하룻밤"으로 만든다(일어난 날짜 기준, 깬 구간 제외). → POST /api/health/sleep
 *
 * 제품 원칙(2026-10-12 결정, HEALTH_DATA_INTEGRATION.md):
 * - 포인트 적립에 쓰지 않는다. 주간 리포트·동기 점검·AI 선인사 맥락으로만.
 * - 권한을 거절하거나 연동을 안 켜도 모든 기능이 그대로 동작해야 한다.
 * - 읽기는 steps·sleep 두 가지만 요청한다(매니페스트도 READ_STEPS·READ_SLEEP 만 남김).
 *
 * 갤럭시 주의: 삼성 헬스가 Health Connect 에 데이터를 넘겨주려면 사용자가
 * 삼성 헬스 → 설정 → 연결된 앱 및 서비스 → "헬스 커넥트"(한글 표기)에서 삼성 헬스의
 * 걸음수·수면 '쓰기'를 허용해야 한다(기본 꺼짐). Cheddar 쪽 읽기 권한만 있고 이게 꺼져
 * 있으면 오류 없이 빈 결과만 온다. 허용 직후에도 삼성 헬스가 몰아서 보내 바로 안 보일 수 있다.
 */
import { Capacitor } from "@capacitor/core";
import { Health } from "@capgo/capacitor-health";

export function isNativeApp() {
  return Capacitor.isNativePlatform();
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

const READ_TYPES = ["steps", "sleep"];

// 서버에 올릴 때 출처 표시. 나중에 플랫폼별 품질 비교용.
function sourceName() {
  return Capacitor.getPlatform() === "ios" ? "healthkit" : "health_connect";
}

/** 이 기기에서 건강 데이터를 읽을 수 있는지. {available, reason} */
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

function authorizedSet(res) {
  return new Set(Array.isArray(res?.readAuthorized) ? res.readAuthorized : []);
}

/**
 * 걸음수·수면 읽기 권한을 한 번에 요청한다.
 * 반환: { steps: boolean, sleep: boolean, any: boolean } — 사용자가 둘 중 하나만 허용할 수도 있다.
 */
export async function requestHealthPermissions() {
  if (!isNativeApp()) return { steps: false, sleep: false, any: false };
  const got = authorizedSet(await Health.requestAuthorization({ read: READ_TYPES }));
  const steps = got.has("steps");
  const sleep = got.has("sleep");
  return { steps, sleep, any: steps || sleep };
}

/** 권한 창 없이 현재 허용 상태만 확인. */
export async function checkHealthPermissions() {
  if (!isNativeApp()) return { steps: false, sleep: false, any: false };
  try {
    const got = authorizedSet(await Health.checkAuthorization({ read: READ_TYPES }));
    const steps = got.has("steps");
    const sleep = got.has("sleep");
    return { steps, sleep, any: steps || sleep };
  } catch {
    return { steps: false, sleep: false, any: false };
  }
}

// Android 13 이하는 Health Connect 가 기본 탑재가 아니라 Play 스토어에서 따로 받아야 한다.
// url=healthconnect://onboarding 은 Google 이 안내하는 설치 링크 형식 — 설치 후 온보딩으로 이어진다.
// https 링크라 Capacitor 가 WebView 밖(Play 스토어 앱)으로 넘긴다.
const HEALTH_CONNECT_INSTALL_URL =
  "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding";

/** 플러그인의 isAvailable reason 으로 "설치(또는 업데이트)하면 쓸 수 있는" 상태인지 판단. */
export function healthConnectNeedsInstall(reason) {
  return Capacitor.getPlatform() === "android" && /needs an update/i.test(reason || "");
}

/** Play 스토어의 Health Connect 설치 페이지를 연다. 안드로이드 전용. */
export function openHealthConnectInstall() {
  if (Capacitor.getPlatform() !== "android") return;
  window.location.href = HEALTH_CONNECT_INSTALL_URL;
}

/**
 * Health Connect 설정 화면(권한·연결된 앱)을 연다. 안드로이드 전용.
 * 설치가 안 된 기기에선 설정 화면이 없어 열기가 실패하므로 설치 페이지로 보낸다
 * (2026-10-26 Galaxy A9 Pro/Android 10 실기기에서 아무 반응 없던 문제).
 */
export async function openHealthSettings() {
  if (!isNativeApp()) return;
  try {
    await Health.openHealthConnectSettings();
  } catch (err) {
    console.error("[Health] 설정 열기 실패:", err);
    const avail = await checkHealthAvailable();
    if (healthConnectNeedsInstall(avail.reason)) openHealthConnectInstall();
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
 *
 * queryAggregated(bucket: day, sum) 를 쓰는 이유: 삼성 헬스와 갤럭시 워치가 같은
 * 걸음을 둘 다 기록해도 Health Connect 가 합산 시 중복을 걸러준다.
 */
export async function readDailySteps(days = 7) {
  if (!isNativeApp()) return [];
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
 * 반환: { steps: 서버응답|null, sleep: 서버응답|null } — 둘 다 null 이면 올린 게 없음.
 */
export async function syncHealthToServer(days = 7) {
  const result = { steps: null, sleep: null };
  if (!isNativeApp()) return result;
  const perm = await checkHealthPermissions();
  if (perm.steps) {
    const rows = await readDailySteps(days);
    if (rows.length > 0) {
      result.steps = await post("/api/health/steps", { source: sourceName(), days: rows });
    }
  }
  if (perm.sleep) {
    const nights = await readNightlySleep(days);
    if (nights.length > 0) {
      result.sleep = await post("/api/health/sleep", { source: sourceName(), nights });
    }
  }
  return result;
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

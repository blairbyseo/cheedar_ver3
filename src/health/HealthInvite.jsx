/* '걸음수·수면 자동 기록' 안내 팝업 — 앱 진입 시 아래에서 올라오는 시트. 앱에서만.
 *
 * 2026-11-08 사용자 결정: "팝업에서 허용 한 번 누르면 끝". [허용] 한 번으로
 *  - 걸음수: '신체 활동' 권한 → 휴대폰 걸음 센서 연결
 *  - 수면(안드로이드): 마이크 권한 → '매일 밤 자동 기록' 켜기(밤에 화면이 꺼져 있을 때만 재고, 아침 첫 잠금 해제에 끝)
 * 이 순서로 안드로이드 권한 창이 이어서 뜬다(권한 창 자체는 OS 가 띄워 생략할 수 없다).
 * 시스템 권한 창을 바로 띄우지 않고 이 팝업으로 설명한 뒤 [허용]을 눌렀을 때만 띄운다
 * (안드로이드는 권한을 두 번 거절하면 창을 다시 안 띄워 준다 — 설명 없이 띄워 거절당하면 기회를 잃는다).
 *
 * 노출 규칙: 아직 켜지 않은 항목이 있을 때. 첫 진입에 한 번 → '나중에' 누르면 7일 뒤 한 번 더 → 그 뒤로는 안 띄움.
 * 설정에서 걸음수를 직접 끈 사람에게는 걸음수를 다시 묻지 않는다. 같은 날 동기 점검 창이 뜨면 양보.
 */
import { useEffect, useState } from "react";
import {
  HEALTH_SYNC_KEY,
  isNativeApp,
  checkAnyHealthAvailable,
  checkHealthPermissions,
  connectHealth,
  isHealthSyncEnabled,
} from "./healthData";
import { getSleepStatus, isSleepSoundAvailable, setAutoSleep } from "../sleep/sleepSound";
import { motivationCheckPending } from "../motivationSnooze";
import "../MotivationCheck.css"; // 시트 모양(mot-overlay/mot-sheet/버튼)을 동기 점검 창과 같이 쓴다

// 수면 자동 측정이 생기면서 다시 한 번 묻도록 키를 바꿨다(이전: "health.invite")
const INVITE_KEY = "health.invite2"; // { shown: 나중에 누른 횟수, at: 마지막 '나중에' ms, done: 더 안 띄움 }
const MAX_DISMISS = 2;
const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function loadInvite() {
  try {
    return JSON.parse(localStorage.getItem(INVITE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveInvite(state) {
  try {
    localStorage.setItem(INVITE_KEY, JSON.stringify(state));
  } catch {
    // 저장소를 못 쓰면 다음 실행에 다시 보일 수 있다 — 치명적이지 않음
  }
}

function stepsTurnedOffByUser() {
  try {
    return localStorage.getItem(HEALTH_SYNC_KEY) === "off";
  } catch {
    return true;
  }
}

function inviteAllowedNow() {
  if (!isNativeApp()) return false;
  const inv = loadInvite();
  if (inv.done || (inv.shown ?? 0) >= MAX_DISMISS) return false;
  if ((inv.shown ?? 0) === 0) return true;
  return Date.now() - (inv.at ?? 0) >= REMIND_AFTER_MS;
}

/** 이번에 물어볼 것: { steps, sleep } — 둘 다 false 면 팝업을 띄우지 않는다. */
async function whatToAsk() {
  // 토글이 켜져 있어도 '신체 활동' 권한이 없으면(예전 방식으로 켰거나 권한을 뺀 경우) 다시 묻는다
  const stepsReady = isHealthSyncEnabled() && !!(await checkHealthPermissions())?.steps;
  const steps = !stepsReady && !stepsTurnedOffByUser() && (await checkAnyHealthAvailable());
  let sleep = false;
  if (isSleepSoundAvailable()) {
    const s = await getSleepStatus().catch(() => null);
    sleep = !!s && !s.autoEnabled;
  }
  return { steps, sleep };
}

export default function HealthInvite() {
  const [visible, setVisible] = useState(false);
  const [ask, setAsk] = useState({ steps: false, sleep: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false); // 결과 문구만 남기고 버튼 숨김

  useEffect(() => {
    if (!inviteAllowedNow()) return undefined;
    let cancelled = false;
    (async () => {
      // 동기 점검 창이 뜨는 진입이면 이번엔 양보 — 노출 횟수는 차감하지 않는다
      if (await motivationCheckPending()) return;
      const next = await whatToAsk();
      if (cancelled || (!next.steps && !next.sleep)) return;
      setAsk(next);
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  function handleLater() {
    const inv = loadInvite();
    saveInvite({ ...inv, shown: (inv.shown ?? 0) + 1, at: Date.now() });
    setVisible(false);
  }

  async function handleAllow() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const done = [];
    const missed = [];
    try {
      if (ask.steps) {
        const { status } = await connectHealth();
        if (status === "connected" || status === "no-data") done.push("걸음수");
        else missed.push("걸음수(신체 활동 권한)");
      }
      if (ask.sleep) {
        const { status } = await setAutoSleep(true);
        if (status === "on") done.push("수면");
        else missed.push("수면(마이크 권한)");
      }
      saveInvite({ ...loadInvite(), done: true });
      setFinished(true);
      const lines = [];
      if (done.length) {
        lines.push(`${done.join("·")} 자동 기록을 켰어요.`);
        if (done.includes("수면")) lines.push("오늘 밤부터 휴대폰 화면이 꺼져 있을 때 재고, 아침에 잠금을 풀면 자동으로 끝나요.");
      }
      if (missed.length) {
        lines.push(`${missed.join(", ")}이 허용되지 않아 켜지 못했어요. 홈의 수면 카드나 설정에서 다시 켤 수 있어요.`);
      }
      setMessage(lines.join(" "));
    } catch (err) {
      console.error("[HealthInvite] 켜기 실패:", err);
      setMessage("켜지 못했어요. 홈의 수면 카드나 설정에서 다시 시도해 주세요.");
      setFinished(true);
    } finally {
      setBusy(false);
    }
  }

  // 바깥(어두운 배경)을 눌러 닫으면 '나중에'와 같게 친다. 결과 화면에선 그냥 닫기.
  function handleBackdrop() {
    if (busy) return;
    if (finished) setVisible(false);
    else handleLater();
  }

  const title =
    ask.steps && ask.sleep
      ? "걸음수와 수면을 자동으로 기록할까요?"
      : ask.sleep
        ? "수면을 자동으로 기록할까요?"
        : "걸음수를 자동으로 기록할까요?";

  return (
    <div className="mot-overlay" onClick={handleBackdrop}>
      <div
        className="mot-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="건강 데이터 자동 기록 안내"
        onClick={(e) => e.stopPropagation()}
      >
        {finished ? (
          <>
            <p className="mot-title">자동 기록</p>
            <p className="health-invite-text">{message}</p>
            <div className="mot-actions">
              <button type="button" className="mot-submit" onClick={() => setVisible(false)}>
                확인
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mot-title">{title}</p>
            {ask.steps && (
              <p className="health-invite-text">
                <b>걸음수</b> · 휴대폰 센서로 하루 걸음을 세요.
              </p>
            )}
            {ask.sleep && (
              <p className="health-invite-text">
                <b>수면</b> · 밤에 휴대폰 화면이 꺼져 있을 때 소리로 잠을 재고, 아침에 잠금을 풀면 자동으로 끝나요.
                소리는 저장하지 않고 휴대폰 안에서만 분석해요.
              </p>
            )}
            <p className="health-invite-text health-invite-note">
              허용을 누르면 휴대폰 권한 창이 이어서 나와요. 포인트와는 관계없고, 언제든 끌 수 있어요.
            </p>
            <div className="mot-actions">
              <button type="button" className="mot-later" onClick={handleLater} disabled={busy}>
                나중에
              </button>
              <button type="button" className="mot-submit" onClick={handleAllow} disabled={busy}>
                {busy ? "켜는 중…" : "허용"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

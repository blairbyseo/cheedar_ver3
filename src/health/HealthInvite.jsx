/* '건강 데이터 연결' 안내 팝업 — 앱 진입 시 아래에서 올라오는 시트. 앱에서만, 연동을 한 번도
 * 켜본 적 없는 사용자에게. 같은 날 동기 점검 창이 뜨면 겹치지 않게 이번엔 건너뛴다.
 *
 * 설정 화면 토글만으로는 기능이 있는지 모르는 사용자가 대부분이라 먼저 알린다.
 * 시스템 권한 창을 바로 띄우지 않고 이 팝업으로 설명한 뒤 '연결하기'를 눌렀을 때만 띄운다.
 * (안드로이드는 권한을 두 번 거절하면 그 앱에 창을 다시 안 띄워 준다 — 설명 없이 띄워
 *  거절당하면 기회를 잃는다.)
 *
 * 노출 규칙: 첫 진입에 한 번 → '나중에' 누르면 7일 뒤 한 번 더 → 그 뒤로는 안 띄움.
 * 설정에서 직접 끈 사람(토글 값 "off")과 권한을 거절한 사람에게도 다시 띄우지 않는다.
 */
import { useEffect, useState } from "react";
import {
  HEALTH_SYNC_KEY,
  isNativeApp,
  checkHealthAvailable,
  healthConnectNeedsInstall,
  connectHealth,
  openHealthConnectInstall,
} from "./healthData";
import { motivationCheckPending } from "../motivationSnooze";
import "../MotivationCheck.css"; // 시트 모양(mot-overlay/mot-sheet/버튼)을 동기 점검 창과 같이 쓴다

const INVITE_KEY = "health.invite"; // { shown: 나중에 누른 횟수, at: 마지막 '나중에' ms, done: 더 안 띄움 }
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

function syncToggleWasEverSet() {
  try {
    return localStorage.getItem(HEALTH_SYNC_KEY) !== null;
  } catch {
    return true; // 저장소를 못 쓰면 안내도 띄우지 않는다
  }
}

function shouldInvite() {
  if (!isNativeApp() || syncToggleWasEverSet()) return false;
  const inv = loadInvite();
  if (inv.done || (inv.shown ?? 0) >= MAX_DISMISS) return false;
  if ((inv.shown ?? 0) === 0) return true;
  return Date.now() - (inv.at ?? 0) >= REMIND_AFTER_MS;
}

export default function HealthInvite() {
  const [visible, setVisible] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false); // 결과 문구만 남기고 버튼 숨김

  useEffect(() => {
    if (!shouldInvite()) return undefined;
    let cancelled = false;
    (async () => {
      // 동기 점검 창이 뜨는 진입이면 이번엔 양보 — 노출 횟수는 차감하지 않는다
      if (await motivationCheckPending()) return;
      // Health Connect 를 아예 못 쓰는 기기(설치로도 해결 안 됨)면 띄우지 않는다
      const avail = await checkHealthAvailable();
      if (cancelled) return;
      const install = healthConnectNeedsInstall(avail.reason);
      if (avail.available || install) {
        setNeedsInstall(install);
        setVisible(true);
      }
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

  async function handleConnect() {
    if (busy) return;
    if (needsInstall) {
      // 설치하고 돌아오면 다음 진입 때 다시 이 카드가 '연결하기'로 뜬다
      openHealthConnectInstall();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { status, gotSteps, gotSleep } = await connectHealth();
      if (status === "needs-install") {
        setNeedsInstall(true);
        setMessage("먼저 Health Connect 앱을 설치해 주세요.");
        return;
      }
      if (status === "unavailable") {
        saveInvite({ ...loadInvite(), done: true });
        setMessage("이 기기에서는 건강 데이터를 연결할 수 없어요.");
        setFinished(true);
        return;
      }
      saveInvite({ ...loadInvite(), done: true });
      setFinished(true);
      if (status === "denied") {
        setMessage("권한이 허용되지 않았어요. 원하시면 설정 → 건강 데이터 연동에서 다시 켤 수 있어요.");
      } else if (status === "connected") {
        const what = [gotSteps && "걸음수", gotSleep && "수면"].filter(Boolean).join("·");
        setMessage(`${what} 연결됐어요! 체다가 대화할 때 참고할게요.`);
      } else {
        setMessage(
          "연결됐어요. 아직 넘어온 데이터가 없어요 — 갤럭시라면 삼성 헬스 → 설정 → 연결된 앱 및 서비스 → 헬스 커넥트에서 걸음수·수면을 허용해 주세요.",
        );
      }
    } catch (err) {
      console.error("[HealthInvite] 연결 실패:", err);
      setMessage("연결에 실패했어요. 설정 → 건강 데이터 연동에서 다시 시도해 주세요.");
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

  return (
    <div className="mot-overlay" onClick={handleBackdrop}>
      <div
        className="mot-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="건강 데이터 연결 안내"
        onClick={(e) => e.stopPropagation()}
      >
        {finished ? (
          <>
            <p className="mot-title">건강 데이터 연결</p>
            <p className="health-invite-text">{message}</p>
            <div className="mot-actions">
              <button type="button" className="mot-submit" onClick={() => setVisible(false)}>
                확인
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mot-title">걸음수·수면을 연결해 보세요</p>
            <p className="health-invite-text">
              폰에 기록된 걸음수와 수면을 연결하면 체다가 컨디션까지 함께 봐 드려요.
              포인트와는 관계없고, 언제든 설정에서 끌 수 있어요.
            </p>
            {message && <p className="health-invite-text health-invite-note">{message}</p>}
            <div className="mot-actions">
              <button type="button" className="mot-later" onClick={handleLater} disabled={busy}>
                나중에
              </button>
              <button type="button" className="mot-submit" onClick={handleConnect} disabled={busy}>
                {busy ? "연결 중…" : needsInstall ? "Health Connect 설치" : "연결하기"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

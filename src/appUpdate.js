/* 앱 새 버전 안내 — Google Play 인앱 업데이트(유연 업데이트).
 *
 * 안드로이드는 앱이 직접 확인하지 않으면 새 버전이 나와도 앱 안에서 아무것도 뜨지 않는다.
 * 그래서 앱 진입·복귀 때 Play 에 새 버전이 있는지 물어보고, 있으면 Play 기본 업데이트 창을 띄운다.
 *   1) Play 창에서 '업데이트' → 앱을 쓰는 동안 뒤에서 받는다
 *   2) 다 받으면(DOWNLOADED) "지금 다시 시작할까요?" → 확인 시 설치·재시작
 *   3) '나중에' 를 누르면 하루 동안 다시 묻지 않는다
 *
 * - Play 에서 설치한 앱에서만 동작한다(PC 에서 직접 설치한 테스트 빌드는 항상 '업데이트 없음').
 * - 새 버전이 보이는 시점은 Play 스토어에 업데이트 버튼이 보이는 시점과 같다(출시 후 수십 분~몇 시간).
 * - 안드로이드 전용. 웹·iOS 는 no-op.
 */
import { Capacitor } from "@capacitor/core";
import {
  AppUpdate,
  AppUpdateAvailability,
  AppUpdateResultCode,
  FlexibleUpdateInstallStatus,
} from "@capawesome/capacitor-app-update";

const SNOOZE_KEY = "appUpdate.snoozedUntil";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function isSnoozed() {
  try {
    return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0);
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // 저장 못 하면 다음 진입 때 다시 물어볼 뿐
  }
}

async function askRestart() {
  if (window.confirm("새 버전을 받았어요. 지금 앱을 다시 시작해 업데이트할까요?")) {
    await AppUpdate.completeFlexibleUpdate();
  }
}

let checking = false;
let listening = false;

/** 새 버전이 있으면 안내한다. 앱 진입·복귀 때 호출. 여러 번 겹쳐 불려도 한 번만 돈다. */
export async function checkAppUpdate() {
  if (Capacitor.getPlatform() !== "android" || checking) return;
  checking = true;
  try {
    const info = await AppUpdate.getAppUpdateInfo();

    // 지난번에 받아만 두고 재시작을 미룬 경우 — 다시 묻는다
    if (info.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
      await askRestart();
      return;
    }
    if (
      info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE ||
      !info.flexibleUpdateAllowed ||
      isSnoozed()
    ) {
      return;
    }

    if (!listening) {
      listening = true;
      await AppUpdate.addListener("onFlexibleUpdateStateChange", (state) => {
        if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) askRestart();
      });
    }
    const result = await AppUpdate.startFlexibleUpdate();
    if (result.code !== AppUpdateResultCode.OK) snooze(); // '나중에' 또는 실패
  } catch (err) {
    console.error("[AppUpdate] 업데이트 확인 실패:", err);
  } finally {
    checking = false;
  }
}

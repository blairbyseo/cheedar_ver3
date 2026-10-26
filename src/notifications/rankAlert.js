/* 랭킹 상승 로컬 알림.
 *
 * 랭킹은 전체 환자의 누적 XP 순(GET /api/points/ranking)이고 XP 는 줄지 않는다.
 * 그래서 내 순위는 내가 포인트를 받을 때만 오른다 — 서버 푸시 없이, 포인트가 바뀐
 * 직후(refreshPoints)·앱 진입·복귀 때 순위를 다시 보고 지난번보다 오르면 바로 알린다
 * (2026-10-26 결정. '누가 나를 추월' 알림은 경쟁 압박 우려로 만들지 않음).
 *
 * 지난 순위는 기기에 저장한다. 처음 보는 경우엔 기준만 저장하고 알리지 않는다.
 * 토글이 꺼져 있어도 기준은 계속 갱신해 둔다 — 나중에 켰을 때 묵은 차이로 울리지 않게.
 */
import { LocalNotifications } from "@capacitor/local-notifications";
import { NOTIF_ALL_KEY, ensureNotificationPermission, isNativeApp } from "./mealReminders";

const RANK_UP_ID = 1201;
export const NOTIF_RANKING_KEY = "notif.ranking";
const LAST_RANK_KEY = "rank.last";

export function isRankAlertEnabled() {
  try {
    return (
      localStorage.getItem(NOTIF_ALL_KEY) !== "off" &&
      localStorage.getItem(NOTIF_RANKING_KEY) !== "off"
    );
  } catch {
    return true;
  }
}

function readLastRank() {
  try {
    const n = Number(localStorage.getItem(LAST_RANK_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveLastRank(rank) {
  try {
    localStorage.setItem(LAST_RANK_KEY, String(rank));
  } catch {
    // 저장 못 하면 다음 확인 때 처음 보는 것으로 취급된다(알림 1번 놓칠 뿐)
  }
}

const RANK_OWNER_KEY = "rank.owner";

/**
 * 지난 순위가 누구 것인지 맞춘다. 같은 폰에서 다른 계정으로 로그인하면 남의 순위와
 * 비교하게 되므로, 주인이 바뀌었으면 기준을 버린다. 로그인 사용자가 정해질 때 호출.
 */
export function setRankOwner(userPk) {
  try {
    const owner = String(userPk);
    if (localStorage.getItem(RANK_OWNER_KEY) !== owner) {
      localStorage.removeItem(LAST_RANK_KEY);
      localStorage.setItem(RANK_OWNER_KEY, owner);
    }
  } catch {
    // 무시
  }
}

let checking = false;

/** 순위를 다시 보고 올랐으면 알린다. 여러 곳에서 겹쳐 불려도 한 번만 돈다. */
export async function checkRankUp() {
  if (!isNativeApp() || checking) return;
  checking = true;
  try {
    const res = await fetch("/api/points/ranking", { credentials: "include" });
    if (!res.ok) return;
    const rank = (await res.json())?.me?.rank;
    if (!Number.isInteger(rank) || rank < 1) return;

    const last = readLastRank();
    saveLastRank(rank);
    if (last == null || rank >= last || !isRankAlertEnabled()) return;
    if (!(await ensureNotificationPermission())) return;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: RANK_UP_ID, // 같은 id — 연달아 오르면 마지막 소식으로 바뀐다
          title: "랭킹이 올랐어요! 🎉",
          body: `${last}위 → ${rank}위로 올라섰어요. 랭킹을 확인해보세요`,
          extra: { tab: "ranking" },
        },
      ],
    });
  } catch (err) {
    console.error("[Notif] 랭킹 확인 실패:", err);
  } finally {
    checking = false;
  }
}

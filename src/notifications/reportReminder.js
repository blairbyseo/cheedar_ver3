/* 주간 리포트 로컬 알림.
 *
 * 주간 리포트는 미리 만들어 두지 않고 열 때마다 "이번 주(월~오늘)" 기록으로 만든다
 * (server/app/routers/reports.py). 그래서 한 주 기록이 거의 다 모인 일요일 저녁에
 * "이번 주 리포트가 준비됐어요"를 띄운다(2026-10-26 결정). 서버 푸시 없이 OS 가
 * 매주 같은 시각에 울려준다. 누르면 리포트 탭으로 간다(App.jsx 의 탭 이동 리스너).
 */
import { LocalNotifications, Weekday } from "@capacitor/local-notifications";
import { NOTIF_ALL_KEY, ensureNotificationPermission, isNativeApp } from "./mealReminders";

const WEEKLY_REPORT_ID = 1101;
export const NOTIF_WEEKLY_KEY = "notif.weekly";

/** 저장된 토글 기준으로 주간 리포트 알림이 켜져 있는지. 기본값은 켜짐. */
export function isWeeklyReportReminderEnabled() {
  try {
    return (
      localStorage.getItem(NOTIF_ALL_KEY) !== "off" &&
      localStorage.getItem(NOTIF_WEEKLY_KEY) !== "off"
    );
  } catch {
    return true;
  }
}

/** 매주 일요일 20:00 반복 예약. 같은 id 로 덮어써 중복되지 않는다. */
export async function scheduleWeeklyReportReminder() {
  if (!isNativeApp()) return false;
  if (!(await ensureNotificationPermission())) return false;
  await cancelWeeklyReportReminder();
  await LocalNotifications.schedule({
    notifications: [
      {
        id: WEEKLY_REPORT_ID,
        title: "이번 주 리포트가 준비됐어요",
        body: "한 주 동안의 기록과 체다의 한마디를 확인해보세요 📊",
        extra: { tab: "report" },
        schedule: {
          on: { weekday: Weekday.Sunday, hour: 20, minute: 0, second: 0 },
          allowWhileIdle: true,
        },
      },
    ],
  });
  return true;
}

export async function cancelWeeklyReportReminder() {
  if (!isNativeApp()) return;
  await LocalNotifications.cancel({ notifications: [{ id: WEEKLY_REPORT_ID }] });
}

/** 저장된 토글대로 예약/취소를 맞춘다. 앱 시작 시 한 번(설정 탭을 안 연 사용자 대비). */
export async function syncWeeklyReportReminder() {
  if (!isNativeApp()) return;
  if (isWeeklyReportReminderEnabled()) {
    await scheduleWeeklyReportReminder();
  } else {
    await cancelWeeklyReportReminder();
  }
}

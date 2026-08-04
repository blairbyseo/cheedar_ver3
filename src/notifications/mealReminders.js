/* 식단 기록 로컬 알림(리마인더).
 *
 * 서버/Firebase 없이 폰이 스스로 매일 정해진 시각에 알림을 띄운다
 * (@capacitor/local-notifications). 웹에서는 전부 no-op.
 *
 * - 아침 8시 / 점심 12시 / 저녁 7시에 "식단 기록하세요" 알림
 * - Settings 의 "식단 기록 알림" + "모든 알림" 토글로 켜고 끈다
 * - 예약된 알림은 앱이 꺼져 있어도 OS가 울려준다(로컬 스케줄링)
 */
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

// id 는 고정 정수 — 재예약 시 같은 id 로 덮어써 중복을 막는다.
const MEAL_REMINDERS = [
  {
    id: 1001,
    hour: 8,
    minute: 0,
    title: "아침 식사 기록",
    body: "오늘 아침 뭐 드셨어요? 식단을 기록해보세요 🍳",
  },
  {
    id: 1002,
    hour: 12,
    minute: 0,
    title: "점심 식사 기록",
    body: "점심 식사 기록할 시간이에요! 🍚",
  },
  {
    id: 1003,
    hour: 19,
    minute: 0,
    title: "저녁 식사 기록",
    body: "저녁 식단을 기록하고 포인트도 받아가세요 🍽️",
  },
];

const REMINDER_IDS = MEAL_REMINDERS.map((m) => m.id);

/** 알림 권한 요청. 허용됐는지 여부를 반환. */
export async function ensureNotificationPermission() {
  if (!isNativeApp()) return false;
  const res = await LocalNotifications.requestPermissions();
  return res.display === "granted";
}

/** 식단 리마인더 3종을 매일 반복으로 예약. 권한 없으면 먼저 요청. */
export async function scheduleMealReminders() {
  if (!isNativeApp()) return false;
  const granted = await ensureNotificationPermission();
  if (!granted) return false;
  // 기존 예약 취소 후 재등록 — 중복 예약 방지
  await cancelMealReminders();
  await LocalNotifications.schedule({
    notifications: MEAL_REMINDERS.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      // on: { hour, minute } 만 지정하면 매일 그 시각에 반복
      schedule: { on: { hour: m.hour, minute: m.minute }, allowWhileIdle: true },
    })),
  });
  return true;
}

/** 예약된 식단 리마인더 전부 취소. */
export async function cancelMealReminders() {
  if (!isNativeApp()) return;
  await LocalNotifications.cancel({
    notifications: REMINDER_IDS.map((id) => ({ id })),
  });
}

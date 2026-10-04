/* 식단/운동 기록 날짜 도우미.
 *
 * 날짜는 "YYYY-MM-DD" 문자열로 다룬다 (API 의 on= / eaten_on / done_on 과 같은 형식).
 * toISOString 은 UTC 라 한국 아침 9시 전엔 전날이 되므로 로컬 기준으로 직접 만든다.
 * 지난 날짜는 최근 BACKFILL_DAYS 일까지만 — 서버 services/record_dates.py 와 값을 맞춘다.
 */

export const BACKFILL_DAYS = 7;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function toDateStr(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

// "YYYY-MM-DD" 를 로컬 자정 Date 로. (new Date("YYYY-MM-DD") 는 UTC 로 해석돼 쓰지 않는다)
function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function oldestRecordDateStr() {
  return addDays(todayStr(), -BACKFILL_DAYS);
}

// 화면 표시용: "9월 27일 (토)"
export function formatDateLabel(s) {
  const d = parseDateStr(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

// 문장 속에 넣을 짧은 말: "오늘" / "어제" / "9월 27일"
export function dayWord(s) {
  const today = todayStr();
  if (s === today) return "오늘";
  if (s === addDays(today, -1)) return "어제";
  const d = parseDateStr(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

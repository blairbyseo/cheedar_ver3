import { useEffect, useState } from "react";

/* 오늘 끼니별 기록 현황을 가져오는 공용 훅 (GET /api/meals/today/status).
 *
 * - 홈 화면 상단 멘트("점심 기록이 아직 비어 있어요")와 끼니 현황 줄
 *   ("아침 완료 · 점심 미기록 · 저녁 예정")이 이 값으로 그려진다.
 * - 탭이 마운트될 때마다 호출되므로, 식단을 기록한 뒤 홈으로 돌아오면
 *   갱신된 현황이 자동으로 반영된다.
 * - 응답 전이거나 실패하면 null 을 돌려준다(호출부에서 ?. 로 처리).
 *
 * 반환: 끼니별 상태 맵 — { breakfast, lunch, dinner, snack } 각 값은
 *       "done"(기록함) 또는 "missing"(아직 안 함).
 */
export function useTodayStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/meals/today/status", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`today-status ${res.status}`);
        const data = await res.json();
        // 백엔드 items: [{ meal_type, state }] → { meal_type: state } 맵으로 변환
        const byType = {};
        for (const item of data.items) byType[item.meal_type] = item.state;
        if (!cancelled) setStatus(byType);
      } catch (err) {
        console.error("[useTodayStatus] load failed:", err);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return status;
}

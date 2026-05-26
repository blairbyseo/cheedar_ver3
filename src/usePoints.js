import { useEffect, useState } from "react";

/* 현재 로그인한 환자의 포인트/레벨 요약을 가져오는 공용 훅 (GET /api/points/me).
 *
 * - 헤더 우상단 포인트(CP), 홈 카드의 레벨 등 여러 탭이 함께 쓴다.
 * - 탭이 마운트될 때마다 호출되므로, 식단을 기록한 뒤 다른 탭으로 이동하면
 *   갱신된 CP/레벨이 자동으로 반영된다.
 * - 응답 전이거나 실패하면 null 을 돌려준다(호출부에서 ?? 0 등으로 처리).
 *
 * 반환 객체 주요 필드:
 *   { cp, xp, level, level_progress,
 *     week_record_days, week_record_weekdays,  // 이번 주 기록 일수 / 요일(0=월~6=일)
 *     rules, recent_history, ... }
 */
export function usePoints() {
  const [points, setPoints] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/points/me", { credentials: "include" });
        if (!res.ok) throw new Error(`points ${res.status}`);
        const data = await res.json();
        if (!cancelled) setPoints(data);
      } catch (err) {
        console.error("[usePoints] load failed:", err);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return points;
}

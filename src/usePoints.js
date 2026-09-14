import { useEffect, useState } from "react";

/* 현재 로그인한 환자의 포인트/레벨 요약을 가져오는 공용 훅 (GET /api/points/me).
 *
 * - 헤더 우상단 포인트(CP), 홈 카드의 레벨 등 여러 탭이 함께 쓴다.
 * - 탭이 마운트될 때 한 번 부른다. 기록 직후처럼 즉시 갱신이 필요하면
 *   요청 성공 후 refreshPoints() 를 호출하면 화면에 떠 있는 모든 훅이 다시 부른다.
 * - 응답 전이거나 실패하면 null 을 돌려준다(호출부에서 ?? 0 등으로 처리).
 *
 * 반환 객체 주요 필드:
 *   { cp, xp, level, level_progress,
 *     week_record_days, week_record_weekdays,  // 이번 주 기록 일수 / 요일(0=월~6=일)
 *     rules, recent_history, ... }
 */
// 포인트가 바뀐 횟수. 값이 바뀌면 화면에 떠 있는 모든 usePoints 가 다시 불러온다.
// (식단·운동을 기록한 화면의 헤더가 탭을 옮기기 전에도 갱신되도록)
let pointsVersion = 0;
const pointsListeners = new Set();

/** 포인트를 바꾼 요청이 성공한 직후 호출한다. 화면 전체의 포인트를 다시 불러온다. */
export function refreshPoints() {
  pointsVersion += 1;
  pointsListeners.forEach((notify) => notify(pointsVersion));
}

export function usePoints() {
  const [points, setPoints] = useState(null);
  const [version, setVersion] = useState(pointsVersion);

  // refreshPoints() 신호를 구독 — 마운트돼 있는 동안만 받는다
  useEffect(() => {
    pointsListeners.add(setVersion);
    return () => {
      pointsListeners.delete(setVersion);
    };
  }, []);

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
  }, [version]);

  return points;
}

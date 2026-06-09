import { useCallback, useEffect, useState } from "react";

/* 최종 레벨 현금 보상 현황 훅 (GET /api/rewards/final-level).
 *
 * 레벨은 XP(누적)로만 오르고, 목표 레벨(final_level)에 도달하면 현금 보상을
 * '신청'할 수 있다. 실제 지급은 관리자가 수동으로 한다.
 *
 * 반환:
 *   status   : { final_level, current_level, eligible, reward_amount, claim }
 *              claim 은 이미 신청했으면 { status:'pending'|'paid'|'rejected', ... },
 *              아직 안 했으면 null. (응답 전/실패 시 status 자체가 null)
 *   claiming : 신청 요청 진행 중 여부(버튼 비활성화용)
 *   claim()  : POST 후 현황을 다시 불러온다. { ok, error } 반환
 *              (error 코드: not_eligible / already_claimed / network)
 */
export function useFinalReward() {
  const [status, setStatus] = useState(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rewards/final-level", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`reward ${res.status}`);
      setStatus(await res.json());
    } catch (err) {
      console.error("[useFinalReward] load failed:", err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await fetch("/api/rewards/final-level/claim", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        // 백엔드가 detail 에 사유 코드(not_eligible/already_claimed)를 담아준다.
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.detail || `claim ${res.status}` };
      }
      await load(); // 신청 직후 현황(claim) 갱신
      return { ok: true };
    } catch (err) {
      console.error("[useFinalReward] claim failed:", err);
      return { ok: false, error: "network" };
    } finally {
      setClaiming(false);
    }
  }, [load]);

  return { status, claiming, claim };
}

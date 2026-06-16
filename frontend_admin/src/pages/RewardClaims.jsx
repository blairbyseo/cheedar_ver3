import { Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";

// 탭(상태 필터) — key 가 백엔드 status 쿼리값. "all" 은 쿼리 없이 전체.
const FILTERS = [
  { key: "pending", label: "대기" },
  { key: "paid", label: "지급완료" },
  { key: "rejected", label: "반려" },
  { key: "all", label: "전체" },
];

// 상태별 배지 색 — 위험 신호의 risk-badge 와 같은 톤(연배경 + 진한 글자).
const STATUS_META = {
  pending: { label: "대기", color: "#b45309", bg: "#fef3c7" },
  paid: { label: "지급완료", color: "#047857", bg: "#d1fae5" },
  rejected: { label: "반려", color: "#b91c1c", bg: "#fee2e2" },
};

export default function RewardClaims() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("pending");
  const [data, setData] = useState(null); // { items, total, counts }
  const [error, setError] = useState("");
  // 처리 중인 신청 id — 버튼 중복 클릭 방지.
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setData(null);
    setError("");
    api
      .rewardClaims({ status: filter === "all" ? undefined : filter })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function process(id, status) {
    // 반려는 되돌릴 수 없으니 한 번 더 확인.
    if (status === "rejected" && !window.confirm("이 신청을 반려할까요?")) return;
    setBusyId(id);
    setError("");
    try {
      await api.updateRewardClaim(id, status);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const counts = data?.counts ?? {};

  return (
    <div className="page">
      <header className="page-header">
        <h1>현금 보상 신청</h1>
        <p className="page-desc">
          최종 레벨을 달성한 사용자의 현금 보상 신청입니다. 입금 후 지급완료로
          처리하세요. 먼저 신청한 순서대로 정렬됩니다.
        </p>
      </header>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`tab${filter === f.key ? " active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key !== "all" && counts[f.key] ? ` (${counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      {error && <p className="error-banner">{error}</p>}

      {!data ? (
        <p className="muted">불러오는 중…</p>
      ) : data.items.length === 0 ? (
        <p className="muted">해당하는 신청이 없어요.</p>
      ) : (
        <div className="safety-list">
          {data.items.map((c) => (
            <RewardRow
              key={c.id}
              claim={c}
              busy={busyId === c.id}
              onOpenUser={() => navigate(`/users/${c.user_id}`)}
              onProcess={process}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RewardRow({ claim, busy, onOpenUser, onProcess }) {
  const meta = STATUS_META[claim.status] || {
    label: claim.status,
    color: "var(--muted)",
    bg: "var(--surface-2)",
  };
  const isPending = claim.status === "pending";

  return (
    <div className="safety-card" style={{ borderLeftColor: meta.color }}>
      <div className="safety-main">
        <div className="safety-top">
          <span
            className="risk-badge"
            style={{ color: meta.color, background: meta.bg }}
          >
            <Wallet size={13} /> {meta.label}
          </span>
          <span className="reward-amount">
            {claim.amount.toLocaleString()}원
          </span>
          <span className="safety-source">Lv.{claim.level_at_claim} 달성</span>
        </div>
        <button className="safety-user" onClick={onOpenUser}>
          {claim.user_login_id}
          {claim.nickname ? ` (${claim.nickname})` : ""}
        </button>
        <p className="safety-meta">
          신청 {new Date(claim.requested_at).toLocaleString("ko-KR")}
          {claim.processed_at &&
            ` · 처리 ${new Date(claim.processed_at).toLocaleString("ko-KR")}`}
        </p>
      </div>
      <div className="safety-actions">
        {isPending ? (
          <>
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => onProcess(claim.id, "rejected")}
            >
              반려
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => onProcess(claim.id, "paid")}
            >
              {busy ? "처리 중…" : "지급완료"}
            </button>
          </>
        ) : (
          // 이미 처리됨 — 대기로 되돌리는 건 백엔드가 막으므로 반대 상태로만 전환.
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() =>
              onProcess(claim.id, claim.status === "paid" ? "rejected" : "paid")
            }
          >
            {claim.status === "paid" ? "반려로 변경" : "지급완료로 변경"}
          </button>
        )}
      </div>
    </div>
  );
}

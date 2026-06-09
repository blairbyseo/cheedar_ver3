import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";
import { categoryLabel, riskMeta, STATUS_LABELS } from "../safety";

const FILTERS = [
  { key: "open", label: "미해결" },
  { key: "resolved", label: "처리완료" },
  { key: "all", label: "전체" },
];

export default function SafetyEvents() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("open");
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setEvents(null);
    setError("");
    api
      .safetyEvents({ status: filter })
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(id, status) {
    try {
      await api.resolveSafetyEvent(id, status);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>위험 신호</h1>
        <p className="page-desc">
          설문·채팅에서 감지된 위험 신호입니다. 감독 전문의가 직접 확인하고 개입·판단하세요.
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
          </button>
        ))}
      </div>

      {error && <p className="error-banner">{error}</p>}

      {!events ? (
        <p className="muted">불러오는 중…</p>
      ) : events.length === 0 ? (
        <p className="muted">해당하는 위험 신호가 없어요.</p>
      ) : (
        <div className="safety-list">
          {events.map((ev) => (
            <SafetyRow
              key={ev.id}
              ev={ev}
              onOpenUser={() => navigate(`/users/${ev.user_id}`)}
              onChangeStatus={changeStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SafetyRow({ ev, onOpenUser, onChangeStatus }) {
  const risk = riskMeta(ev.risk_level);
  return (
    <div className="safety-card" style={{ borderLeftColor: risk.color }}>
      <div className="safety-main">
        <div className="safety-top">
          <span
            className="risk-badge"
            style={{ color: risk.color, background: risk.bg }}
          >
            <AlertTriangle size={13} /> {risk.label}
          </span>
          <span className="safety-category">{categoryLabel(ev.detected_category)}</span>
          <span className="safety-source">{ev.source === "survey" ? "설문" : "채팅"}</span>
        </div>
        <button className="safety-user" onClick={onOpenUser}>
          {ev.account_id}
          {ev.nickname ? ` (${ev.nickname})` : ""}
        </button>
        <p className="safety-meta">
          {new Date(ev.created_at).toLocaleString("ko-KR")} · {STATUS_LABELS[ev.status] || ev.status}
        </p>
      </div>
      <div className="safety-actions">
        {ev.status !== "reviewing" && !ev.is_resolved && (
          <button className="btn-ghost" onClick={() => onChangeStatus(ev.id, "reviewing")}>
            확인 중
          </button>
        )}
        {!ev.is_resolved ? (
          <button className="btn-primary" onClick={() => onChangeStatus(ev.id, "resolved")}>
            처리완료
          </button>
        ) : (
          <button className="btn-ghost" onClick={() => onChangeStatus(ev.id, "unresolved")}>
            되돌리기
          </button>
        )}
      </div>
    </div>
  );
}

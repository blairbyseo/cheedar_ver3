import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";

const FILTERS = [
  { key: "open", label: "미처리" },
  { key: "resolved", label: "처리완료" },
  { key: "all", label: "전체" },
];

export default function Inquiries() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("open");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setItems(null);
    setError("");
    api
      .inquiries({ status: filter })
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(id, isResolved) {
    try {
      await api.resolveInquiry(id, isResolved);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>문의하기</h1>
        <p className="page-desc">사용자가 설정 화면에서 남긴 문의입니다.</p>
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

      {!items ? (
        <p className="muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="muted">해당하는 문의가 없어요.</p>
      ) : (
        <div className="safety-list">
          {items.map((it) => (
            <div
              key={it.id}
              className="safety-card"
              style={{ borderLeftColor: it.is_resolved ? "#9aa0a6" : "#f5a623" }}
            >
              <div className="safety-main">
                <div className="safety-top">
                  <span
                    className="risk-badge"
                    style={{ color: "#8a6d3b", background: "#fcf3e3" }}
                  >
                    <MessageSquare size={13} /> 문의
                  </span>
                </div>
                <button
                  className="safety-user"
                  onClick={() => navigate(`/users/${it.user_id}`)}
                >
                  {it.account_id}
                  {it.nickname ? ` (${it.nickname})` : ""}
                </button>
                <p style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>
                  {it.content}
                </p>
                <p className="safety-meta">
                  {new Date(it.created_at).toLocaleString("ko-KR")} ·{" "}
                  {it.is_resolved ? "처리완료" : "미처리"}
                </p>
              </div>
              <div className="safety-actions">
                {!it.is_resolved ? (
                  <button
                    className="btn-primary"
                    onClick={() => changeStatus(it.id, true)}
                  >
                    처리완료
                  </button>
                ) : (
                  <button
                    className="btn-ghost"
                    onClick={() => changeStatus(it.id, false)}
                  >
                    되돌리기
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

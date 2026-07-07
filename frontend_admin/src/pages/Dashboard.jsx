import { AlertTriangle, MessageSquare, ShieldAlert, UtensilsCrossed, Users } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";
import AnalyticsCharts from "../components/AnalyticsCharts";

// 대시보드 요약 카드 정의 — 키는 백엔드 DashboardStats 의 필드명과 맞춘다.
// (위험 대화 감지 카드는 클릭 동작이 있어 별도로 렌더링한다 — CARDS 에는 없음.)
const CARDS = [
  { key: "total_users", label: "전체 회원", icon: Users, suffix: "명", color: "#3182f6", to: "/users" },
  { key: "today_meals", label: "오늘 기록된 식단", icon: UtensilsCrossed, suffix: "건", color: "#10b981" },
  { key: "today_chat_messages", label: "오늘 채팅", icon: MessageSquare, suffix: "개", color: "#f59e0b" },
  { key: "total_chat_messages", label: "전체 채팅", icon: MessageSquare, suffix: "개", color: "#ec4899" },
];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.dashboard().then(setStats).catch((e) => setError(e.message));
  }, []);

  const unresolved = stats?.unresolved_safety_count ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <h1>대시보드</h1>
        <p className="page-desc">서비스 현황을 한눈에 봅니다.</p>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {/* 미해결 위험 신호 — 0보다 크면 빨갛게 강조, 클릭 시 위험 신호 화면으로 */}
      <button
        className={`safety-banner${unresolved > 0 ? " alert" : ""}`}
        onClick={() => navigate("/safety")}
      >
        <AlertTriangle size={20} />
        <span className="safety-banner-text">
          {unresolved > 0
            ? `처리하지 않은 위험 신호 ${unresolved}건이 있어요`
            : "미해결 위험 신호 없음"}
        </span>
        <span className="safety-banner-go">위험 신호 보기 →</span>
      </button>

      <div className="card-grid">
        {CARDS.map(({ key, label, icon: Icon, suffix, color, to }, i) => (
          <Fragment key={key}>
            {/* to 가 있으면 클릭 시 해당 화면으로 이동하는 버튼으로 렌더 */}
            {(() => {
              const Card = to ? "button" : "div";
              return (
                <Card
                  className={`stat-card${to ? " clickable" : ""}`}
                  onClick={to ? () => navigate(to) : undefined}
                >
                  <div className="stat-body">
                    <span className="stat-label">{label}</span>
                    <span className="stat-value">
                      {stats ? stats[key].toLocaleString() : "—"}
                      <span className="stat-suffix">{suffix}</span>
                    </span>
                  </div>
                  <div className="stat-icon" style={{ background: `${color}1a`, color }}>
                    <Icon size={22} />
                  </div>
                </Card>
              );
            })()}

            {/* 전체 회원 카드 다음에 '위험 대화 감지' 카드 — 클릭 시 위험 신호로 이동 */}
            {i === 0 && (
              <button className="stat-card clickable" onClick={() => navigate("/safety")}>
                <div className="stat-body">
                  <span className="stat-label">위험 대화 감지</span>
                  <span className="stat-value">
                    {stats ? unresolved.toLocaleString() : "—"}
                    <span className="stat-suffix">건</span>
                  </span>
                </div>
                <div className="stat-icon" style={{ background: "#ef44441a", color: "#ef4444" }}>
                  <ShieldAlert size={22} />
                </div>
              </button>
            )}
          </Fragment>
        ))}
      </div>

      {stats && (
        <p className="dashboard-note">
          현재 관리자 {stats.admin_count}명이 등록돼 있어요.
        </p>
      )}

      <AnalyticsCharts />
    </div>
  );
}

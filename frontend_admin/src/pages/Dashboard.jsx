import { AlertTriangle, Coins, MessageSquare, UtensilsCrossed, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";

// 대시보드 요약 카드 정의 — 키는 백엔드 DashboardStats 의 필드명과 맞춘다.
const CARDS = [
  { key: "total_users", label: "전체 회원", icon: Users, suffix: "명", color: "#f59e0b" },
  { key: "today_meals", label: "오늘 기록된 식단", icon: UtensilsCrossed, suffix: "건", color: "#10b981" },
  { key: "total_points_awarded", label: "누적 적립 포인트", icon: Coins, suffix: "P", color: "#6366f1" },
  { key: "total_chat_messages", label: "누적 채팅 메시지", icon: MessageSquare, suffix: "개", color: "#ec4899" },
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
        {CARDS.map(({ key, label, icon: Icon, suffix, color }) => (
          <div className="stat-card" key={key}>
            <div className="stat-icon" style={{ background: `${color}1a`, color }}>
              <Icon size={22} />
            </div>
            <div className="stat-body">
              <span className="stat-label">{label}</span>
              <span className="stat-value">
                {stats ? stats[key].toLocaleString() : "—"}
                <span className="stat-suffix">{suffix}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {stats && (
        <p className="dashboard-note">
          현재 관리자 {stats.admin_count}명이 등록돼 있어요.
        </p>
      )}
    </div>
  );
}

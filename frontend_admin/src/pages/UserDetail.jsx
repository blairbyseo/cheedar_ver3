import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api/api";

const MEAL_LABELS = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

const TABS = [
  { key: "meals", label: "식단" },
  { key: "activity", label: "채팅 · 포인트" },
];

export default function UserDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("meals");
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api.user(userId).then(setUser).catch((e) => setError(e.message));
  }, [userId]);

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> 회원 목록
      </button>

      {error && <p className="error-banner">{error}</p>}

      {user && (
        <>
          <header className="detail-header">
            <div className="detail-avatar">
              {user.profile_image_path ? (
                <img src={user.profile_image_path} alt="" />
              ) : (
                <span>{user.user_id.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="detail-id">
              <h1>
                {user.user_id}
                {user.is_admin && <span className="badge-admin">관리자</span>}
              </h1>
              <p className="detail-meta">
                {user.nickname || "닉네임 없음"} · {user.email || "이메일 없음"}
              </p>
              <p className="detail-meta">
                가입일 {new Date(user.created_at).toLocaleDateString("ko-KR")}
                {user.age != null && ` · ${user.age}세`}
                {user.height_cm != null && ` · ${user.height_cm}cm`}
                {user.weight_kg != null && ` · ${user.weight_kg}kg`}
              </p>
            </div>
            <div className="detail-stats">
              <Stat label="식단" value={user.meal_count} />
              <Stat label="채팅" value={user.chat_count} />
              <Stat label="XP" value={user.xp} />
              <Stat label="CP" value={user.cp} />
            </div>
          </header>

          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab${tab === t.key ? " active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "meals" ? (
            <MealsTab userId={userId} />
          ) : (
            <ActivityTab userId={userId} />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="mini-stat">
      <span className="mini-stat-value">{value?.toLocaleString?.() ?? value}</span>
      <span className="mini-stat-label">{label}</span>
    </div>
  );
}

// --- 식단 탭 ---------------------------------------------------------------

function MealsTab({ userId }) {
  const [meals, setMeals] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.userMeals(userId).then(setMeals).catch((e) => setError(e.message));
  }, [userId]);

  if (error) return <p className="error-banner">{error}</p>;
  if (!meals) return <p className="muted">불러오는 중…</p>;
  if (meals.length === 0) return <p className="muted">기록된 식단이 없어요.</p>;

  return (
    <div className="meal-list">
      {meals.map((m) => (
        <div className="meal-card" key={m.id}>
          {m.image_path && (
            <img className="meal-thumb" src={m.image_path} alt="" />
          )}
          <div className="meal-info">
            <div className="meal-top">
              <span className="meal-type">{MEAL_LABELS[m.meal_type] || m.meal_type}</span>
              <span className="meal-date">
                {new Date(m.eaten_on).toLocaleDateString("ko-KR")}
              </span>
            </div>
            {m.menu && <p className="meal-menu">{m.menu}</p>}
            <div className="meal-macros">
              {m.calories != null && <span>{m.calories}kcal</span>}
              {m.protein_g != null && <span>단백 {m.protein_g}g</span>}
              {m.carbs_g != null && <span>탄수 {m.carbs_g}g</span>}
              {m.fat_g != null && <span>지방 {m.fat_g}g</span>}
            </div>
            {m.ai_comment && <p className="meal-ai">💬 {m.ai_comment}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- 채팅 · 포인트 탭 ------------------------------------------------------

function ActivityTab({ userId }) {
  const [chat, setChat] = useState(null);
  const [points, setPoints] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.userChat(userId), api.userPoints(userId)])
      .then(([c, p]) => {
        setChat(c);
        setPoints(p);
      })
      .catch((e) => setError(e.message));
  }, [userId]);

  if (error) return <p className="error-banner">{error}</p>;

  return (
    <div className="activity-grid">
      <section className="activity-col">
        <h3 className="col-title">채팅 내역</h3>
        {!chat ? (
          <p className="muted">불러오는 중…</p>
        ) : chat.length === 0 ? (
          <p className="muted">채팅 내역이 없어요.</p>
        ) : (
          <div className="chat-log">
            {chat.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                <span className="chat-role">{m.role === "ai" ? "AI" : "회원"}</span>
                <p className="chat-text">{m.text}</p>
                <span className="chat-time">
                  {new Date(m.created_at).toLocaleString("ko-KR")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="activity-col">
        <h3 className="col-title">포인트 적립 내역</h3>
        {!points ? (
          <p className="muted">불러오는 중…</p>
        ) : points.length === 0 ? (
          <p className="muted">적립 내역이 없어요.</p>
        ) : (
          <ul className="point-log">
            {points.map((p) => (
              <li key={p.id} className="point-row">
                <div>
                  <span className="point-label">{p.label}</span>
                  <span className="point-date">
                    {new Date(p.created_at).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                <span className="point-amount">+{p.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

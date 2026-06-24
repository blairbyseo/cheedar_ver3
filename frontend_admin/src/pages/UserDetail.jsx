import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api/api";
import { categoryLabel, riskMeta, STATUS_LABELS } from "../safety";

const MEAL_LABELS = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

const TABS = [
  { key: "meals", label: "식단" },
  { key: "activity", label: "채팅 · 포인트" },
  { key: "survey", label: "설문" },
  { key: "safety", label: "위험 신호" },
];

// 설문 트리거 유형 라벨
const SURVEY_KIND_LABELS = {
  onboarding: "온보딩",
  recurring: "정기",
};

// 응답 상태 라벨
const SURVEY_STATUS_LABELS = {
  completed: "완료",
  in_progress: "진행 중",
  abandoned: "폐기",
};

// derived_flags 중 '값이 켜졌을 때' 위험/특이 신호로 강조할 boolean 플래그.
// 키 → 한국어 라벨. (수치형/문자형 플래그는 아래 SCORE_FLAG_LABELS 에서 따로 표시)
const RISK_FLAG_LABELS = {
  suicide_acute: "자살 위험(급성)",
  suicide_screen: "자살 선별 양성",
  purging_flag: "제거행동(purging)",
  anorexia_candidate: "신경성 식욕부진 의심",
  bed_candidate: "폭식장애 의심",
  psychosis_positive: "정신증 의심",
  mania_positive: "조증 의심",
  depression_positive: "우울 양성",
  anxiety_positive: "불안 양성",
  panic_positive: "공황 양성",
  social_phobia_positive: "사회불안 양성",
  ocd_positive: "강박 양성",
  adhd_positive: "ADHD 양성",
  ptsd_positive: "PTSD 양성",
  compensatory_exercise_flag: "보상운동",
  weight_control_tier2: "체중조절 행동",
  body_dissatisfaction_severe: "심한 신체 불만족",
};

// 수치/구간/문자형으로 그대로 보여줄 플래그.
const SCORE_FLAG_LABELS = {
  bmi: "BMI",
  bmi_category: "BMI 구간",
  phq2_sum: "PHQ-2(우울)",
  gad_sum: "GAD(불안)",
  adhd_sum: "ADHD 점수",
  readiness_stage: "변화 준비도",
  importance: "변화 중요도",
  confidence: "변화 자신감",
};

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

          {tab === "meals" && <MealsTab userId={userId} />}
          {tab === "activity" && <ActivityTab userId={userId} />}
          {tab === "survey" && <SurveyTab userId={userId} />}
          {tab === "safety" && <SafetyTab userId={userId} />}
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

// --- 설문 탭 --------------------------------------------------------------

function SurveyTab({ userId }) {
  const [responses, setResponses] = useState(null);
  const [includeInProgress, setIncludeInProgress] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setResponses(null);
    setError("");
    api
      .userSurveyResponses(userId, { includeInProgress })
      .then(setResponses)
      .catch((e) => setError(e.message));
  }, [userId, includeInProgress]);

  if (error) return <p className="error-banner">{error}</p>;

  return (
    <div className="survey-list">
      <label className="survey-toggle">
        <input
          type="checkbox"
          checked={includeInProgress}
          onChange={(e) => setIncludeInProgress(e.target.checked)}
        />
        진행 중(미완료) 응답도 보기
      </label>

      {!responses ? (
        <p className="muted">불러오는 중…</p>
      ) : responses.length === 0 ? (
        <p className="muted">제출된 설문이 없어요.</p>
      ) : (
        responses.map((r) => <SurveyResponseCard key={r.id} response={r} />)
      )}
    </div>
  );
}

function SurveyResponseCard({ response: r }) {
  const when = r.completed_at || r.started_at;
  // derived_flags 를 (위험 boolean / 수치·구간 / 기타) 로 분류해 보여준다.
  const flags = r.derived_flags || {};
  const riskFlags = Object.keys(RISK_FLAG_LABELS).filter((k) => flags[k]);
  const scoreFlags = Object.keys(SCORE_FLAG_LABELS).filter(
    (k) => flags[k] !== undefined && flags[k] !== null && flags[k] !== "",
  );
  const answerCount = Object.keys(r.answers || {}).length;

  return (
    <div className="survey-card">
      <div className="survey-card-top">
        <span className="survey-kind">
          {SURVEY_KIND_LABELS[r.kind] || r.kind}
        </span>
        <span className="survey-version">{r.schema_version}</span>
        <span className={`survey-status survey-status-${r.status}`}>
          {SURVEY_STATUS_LABELS[r.status] || r.status}
        </span>
        <span className="survey-date">
          {new Date(when).toLocaleString("ko-KR")}
        </span>
      </div>

      {riskFlags.length > 0 && (
        <div className="survey-flags">
          {riskFlags.map((k) => (
            <span key={k} className="survey-flag-risk">
              <AlertTriangle size={12} /> {RISK_FLAG_LABELS[k]}
            </span>
          ))}
        </div>
      )}

      {scoreFlags.length > 0 && (
        <div className="survey-scores">
          {scoreFlags.map((k) => (
            <span key={k} className="survey-score">
              <span className="survey-score-label">{SCORE_FLAG_LABELS[k]}</span>
              <span className="survey-score-value">{String(flags[k])}</span>
            </span>
          ))}
        </div>
      )}

      <details className="survey-raw">
        <summary>응답 원본 보기 ({answerCount}문항)</summary>
        <pre className="survey-json">
          {JSON.stringify(r.answers, null, 2)}
        </pre>
        {Object.keys(flags).length > 0 && (
          <>
            <p className="survey-raw-title">derived_flags (채점 결과 전체)</p>
            <pre className="survey-json">
              {JSON.stringify(flags, null, 2)}
            </pre>
          </>
        )}
      </details>
    </div>
  );
}

// --- 위험 신호 탭 ----------------------------------------------------------

function SafetyTab({ userId }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.userSafetyEvents(userId).then(setEvents).catch((e) => setError(e.message));
  }, [userId]);

  if (error) return <p className="error-banner">{error}</p>;
  if (!events) return <p className="muted">불러오는 중…</p>;
  if (events.length === 0) return <p className="muted">감지된 위험 신호가 없어요.</p>;

  return (
    <div className="safety-list">
      {events.map((ev) => {
        const risk = riskMeta(ev.risk_level);
        return (
          <div className="safety-card" key={ev.id} style={{ borderLeftColor: risk.color }}>
            <div className="safety-main">
              <div className="safety-top">
                <span className="risk-badge" style={{ color: risk.color, background: risk.bg }}>
                  <AlertTriangle size={13} /> {risk.label}
                </span>
                <span className="safety-category">{categoryLabel(ev.detected_category)}</span>
                <span className="safety-source">{ev.source === "survey" ? "설문" : "채팅"}</span>
              </div>
              <p className="safety-meta">
                {new Date(ev.created_at).toLocaleString("ko-KR")} ·{" "}
                {STATUS_LABELS[ev.status] || ev.status}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

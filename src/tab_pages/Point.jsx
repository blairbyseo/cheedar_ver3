/*5-3. Point.jsx: App.jsx 파일에 걸림*/
import { useState } from "react";
import { usePoints } from "../usePoints";

// 적립 규칙·내역의 아이콘 — rule(id)별 고정. CSS는 icon-${id} 클래스를 함께 쓴다.
const RULE_ICONS = {
  "meal-check": "✓",
  "three-meals": "•••",
  "weekly-goal": "★",
  "full-week": "★★★",
};

// 카드에는 최근 2건만 미리 보여주고, 나머지는 '전체 보기' 모달에서 확인한다.
const HISTORY_PREVIEW_COUNT = 2;

// 적립 시각(ISO 문자열)을 "오늘 08:20" / "어제 21:10" / "5월 21일" 로.
function formatHistoryTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (dayDiff === 0) return `오늘 ${hh}:${mm}`;
  if (dayDiff === 1) return `어제 ${hh}:${mm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function Point() {
  const [showPointInfo, setShowPointInfo] = useState(false);
  // '전체 보기' 모달(최근 적립 내역 전체)의 열림 여부.
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  // 백엔드 GET /api/points/me — CP/XP, 적립 기준, 적립 내역을 한 번에 받는다.
  const summary = usePoints();

  const totalPoint = summary?.cp ?? 0;            // 총 누적 포인트 = CP
  const todayPoint = summary?.earned_today ?? 0;
  const weekPoint = summary?.earned_this_week ?? 0;
  const weekGoalCurrent = summary?.week_record_days ?? 0;
  const weekGoalTotal = summary?.week_goal_days ?? 5;

  // 적립 규칙 4가지 — 백엔드 services/points.py 의 POINT_RULES 와 동일.
  const pointRules = summary?.rules ?? [];
  // 최근 적립 내역 — 백엔드 point_history 테이블에서 최신순.
  const recentHistory = summary?.recent_history ?? [];

  // 적립 내역 한 줄(li) — 카드(2건)와 모달(전체)이 같은 마크업을 공유한다.
  const renderHistoryRows = (items) =>
    items.map((item) => (
      <li key={item.id} className="point-history-row">
        <span className={`point-rule-icon icon-${item.rule}`}>
          {RULE_ICONS[item.rule]}
        </span>
        <div className="point-history-info">
          <p className="point-history-label">{item.label}</p>
          <p className="point-history-time">
            {formatHistoryTime(item.created_at)}
          </p>
        </div>
        <span className="point-history-value">+{item.amount}P</span>
      </li>
    ));

  return (
    <div className="home-page point-page">
      <div className="hero-bg">
        <header className="home-header">
          <h1 className="home-logo">Cheddar</h1>
          <div className="point-summary">
            <span className="point-badge">P</span>
            <strong>{totalPoint.toLocaleString()}</strong>
          </div>
        </header>
      </div>


      <section className="point-card point-total-card">
        <p>총 누적 포인트</p>

        <strong className="point-total-number">
          {totalPoint.toLocaleString()}<span>CP</span>
        </strong>
        <div className="point-page-desc">" 기록할수록 쌓이는 체다 포인트 "</div>

      </section>

      <section className="point-summary-grid">
        <div className="point-summary-card">
          <p className="point-summary-label">오늘 획득</p>
          <strong className="point-summary-value">{todayPoint}P</strong>
        </div>
        <div className="point-summary-card">
          <p className="point-summary-label">이번 주 획득</p>
          <strong className="point-summary-value">{weekPoint}P</strong>
        </div>
        <div className="point-summary-card">
          <p className="point-summary-label">주간 목표</p>
          <strong className="point-summary-value">
            {weekGoalCurrent} / {weekGoalTotal}일
          </strong>
        </div>
      </section>

      <section className="point-history">
        <div className="point-history-header">
          <div className="point-history-heading">
            <h2 className="point-history-title">최근 적립 내역</h2>
            <p className="point-history-sub">최근 적립 내역을 확인할 수 있습니다</p>
          </div>
          <button
            type="button"
            className="point-history-more"
            onClick={() => setShowHistoryModal(true)}
          >
            전체 보기 &gt;
          </button>
        </div>

        <div className="point-history-card">
          {recentHistory.length === 0 ? (
            <p className="point-history-empty">아직 적립 내역이 없어요. 식단을 기록해보세요!</p>
          ) : (
            <ul className="point-history-list">
              {renderHistoryRows(recentHistory.slice(0, HISTORY_PREVIEW_COUNT))}
            </ul>
          )}
        </div>
      </section>

      <section className="point-rules">
        <div className="point-rules-title-row">
          <h2 className="point-rules-title">포인트 적립 기준</h2>
          <div className="point-rules-help-wrap">
            <button
              type="button"
              className="point-rules-help"
              onClick={() => setShowPointInfo((v) => !v)}
              aria-label="적립 기준 안내"
              aria-expanded={showPointInfo}
            >
              ?
            </button>
            {showPointInfo && (
              <div className="point-info-tooltip" role="tooltip">
                포인트와 XP는 동시에 적립됩니다.
              </div>
            )}
          </div>
        </div>
        <div className="point-rules-grid">
          {pointRules.map((rule) => (
            <div key={rule.id} className="point-rules-card">
              <span className={`point-rule-icon icon-${rule.id}`}>
                {RULE_ICONS[rule.id]}
              </span>
              <p className="point-rules-label">{rule.label}</p>
              <strong className="point-rules-value">+{rule.point}P</strong>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── 최근 적립 내역 전체 보기 모달 ───────── */}
      {showHistoryModal && (
        <div
          className="point-history-modal-backdrop"
          onClick={() => setShowHistoryModal(false)}
          role="presentation"
        >
          <div
            className="point-history-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="최근 적립 내역 전체"
          >
            <div className="point-history-modal-header">
              <h3 className="point-history-modal-title">최근 적립 내역</h3>
              <button
                type="button"
                className="point-history-modal-close"
                onClick={() => setShowHistoryModal(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            {recentHistory.length === 0 ? (
              <p className="point-history-empty">
                아직 적립 내역이 없어요. 식단을 기록해보세요!
              </p>
            ) : (
              <ul className="point-history-list point-history-modal-list">
                {renderHistoryRows(recentHistory)}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Point;

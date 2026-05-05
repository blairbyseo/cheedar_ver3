/*5-3. Point.jsx: App.jsx 파일에 걸림*/
import { useState } from "react";

function Point() {
  const [showPointInfo, setShowPointInfo] = useState(false);
  const totalPoint = 1040;
  const todayPoint = 20;
  const weekPoint = 180;
  const weekGoalCurrent = 3;
  const weekGoalTotal = 5;

  // 적립 규칙. id가 아이콘 시스템의 단일 키 — pointRules와 recentHistory가 같은 id/icon을 공유.
  const pointRules = [
    { id: "meal-check",  label: "식단 1회 기록", point: 10,  icon: "✓"   },
    { id: "three-meals", label: "하루 3끼 완료", point: 20,  icon: "•••" },
    { id: "weekly-goal", label: "주 5일 기록",   point: 100, icon: "★"   },
    { id: "full-week",   label: "주 7일 기록 보너스",   point: 50,  icon: "★★★" },
  ];

  const recentHistory = [
    { id: "meal-check",  label: "아침 기록 완료",     time: "오늘 08:20", point: 10,  icon: "✓"   },
    { id: "meal-check",  label: "점심 기록 완료",     time: "오늘 12:35", point: 10,  icon: "✓"   },
    { id: "three-meals", label: "하루 3끼 기록 달성", time: "어제 21:10", point: 20,  icon: "•••" },
    { id: "weekly-goal", label: "주 5일 기록 달성",   time: "4월 26일",   point: 100, icon: "★"   },
    { id: "full-week",   label: "주 7일 기록 보너스", time: "4월 28일",   point: 50,  icon: "★★★" },
  ];

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
            <p className="point-history-sub">최근 7일 기록을 확인할 수 있습니다</p>
          </div>
          <button type="button" className="point-history-more">전체 보기 &gt;</button>
        </div>

        <div className="point-history-card">
          <ul className="point-history-list">
            {recentHistory.map((item, idx) => (
              <li key={idx} className="point-history-row">
                <span className={`point-rule-icon icon-${item.id}`}>{item.icon}</span>
                <div className="point-history-info">
                  <p className="point-history-label">{item.label}</p>
                  <p className="point-history-time">{item.time}</p>
                </div>
                <span className="point-history-value">+{item.point}P</span>
              </li>
            ))}
          </ul>
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
              <span className={`point-rule-icon icon-${rule.id}`}>{rule.icon}</span>
              <p className="point-rules-label">{rule.label}</p>
              <strong className="point-rules-value">+{rule.point}P</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Point;

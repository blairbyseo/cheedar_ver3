/*5-3. Point.jsx: App.jsx 파일에 걸림*/
import { useState, useEffect } from "react";
import { usePoints } from "../usePoints";
import { useFinalReward } from "../useFinalReward";

// 적립 규칙·내역의 아이콘 — rule(id)별 고정. CSS는 icon-${id} 클래스를 함께 쓴다.
// 백엔드 services/points.py 의 POINT_RULES 7종과 키를 맞춘다(식단4 + 운동2 + 설문1).
const RULE_ICONS = {
  "meal-check": "✓",
  "three-meals": "•••",
  "weekly-goal": "★",
  "full-week": "★★★",
  "exercise-log": "🏃",
  "exercise-week": "🔥",
  "survey-done": "📝",
};

// 적립 기준 한 줄 설명 — rule(id)별 고정. 백엔드 label 밑에 보조 설명으로 깐다.
const RULE_SUBS = {
  "meal-check": "식단을 한 번 기록할 때마다",
  "three-meals": "아침·점심·저녁 모두 기록",
  "weekly-goal": "한 주에 5일 이상 기록",
  "full-week": "한 주 7일 모두 기록",
  "exercise-log": "운동을 한 번 기록할 때마다",
  "exercise-week": "한 주 운동 목표 달성",
  "survey-done": "설문을 완료하면",
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
  // 적립 기준 카드 그리드 — 참고용이라 기본은 접어두고 제목을 누르면 펼친다.
  const [showRules, setShowRules] = useState(false);
  // 첫 진입 시 "아래로 내려보세요" 힌트 — 살짝만 스크롤해도 숨긴다.
  const [showScrollHint, setShowScrollHint] = useState(true);
  // 백엔드 GET /api/points/me — CP/XP, 적립 기준, 적립 내역을 한 번에 받는다.
  const summary = usePoints();
  // 최종 레벨 현금 보상 현황 — 별도 엔드포인트(/api/rewards/final-level).
  const reward = useFinalReward();
  const rw = reward.status;                  // null 이면 아직 로딩 전
  const [claimError, setClaimError] = useState("");

  // 스크롤이 일어나는 곳은 창(window) 전체 — 40px만 내려도 "아래 있다"를
  // 인지한 것으로 보고 힌트를 숨긴다. 내용이 한 화면에 다 들어오면 애초에 안 띄움.
  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 40) setShowScrollHint(false);
    };
    // 콘텐츠가 다 받아진 뒤 높이를 재야 하므로 한 박자 늦춰 판단한다.
    const t = setTimeout(() => {
      const noScroll =
        document.documentElement.scrollHeight <= window.innerHeight + 20;
      if (noScroll) setShowScrollHint(false);
    }, 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  async function handleClaim() {
    setClaimError("");
    const res = await reward.claim();
    if (!res.ok) {
      setClaimError(
        res.error === "already_claimed"
          ? "이미 신청했어요."
          : res.error === "not_eligible"
          ? "아직 신청 자격이 안 돼요."
          : "신청 중 오류가 났어요. 잠시 후 다시 시도해주세요."
      );
    }
  }

  const totalPoint = summary?.cp ?? 0;            // 총 누적 포인트 = CP

  // 적립 규칙 4가지 — 백엔드 services/points.py 의 POINT_RULES 와 동일.
  const pointRules = summary?.rules ?? [];
  // 최근 적립 내역 — 백엔드 point_history 테이블에서 최신순.
  const recentHistory = summary?.recent_history ?? [];

  // 적립 기준 한 줄(토스풍) — 아이콘 배지 + 라벨/설명 + 우측 포인트 pill.
  // isExtra=true 면 펼칠 때 살짝 페이드되는 클래스를 더 붙인다.
  const renderRuleRow = (rule, isExtra = false) => (
    <div
      key={rule.id}
      className={`point-rule-row${isExtra ? " point-rule-row--extra" : ""}`}
    >
      <span className={`point-rule-icon icon-${rule.id}`}>
        {RULE_ICONS[rule.id]}
      </span>
      <div className="point-rule-info">
        <p className="point-rule-name">{rule.label}</p>
        {RULE_SUBS[rule.id] && (
          <p className="point-rule-sub">{RULE_SUBS[rule.id]}</p>
        )}
      </div>
      <span className="point-rule-pill">+{rule.point}P</span>
    </div>
  );

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

      {/* ───────── 현금 보상 챌린지 — 토스풍 클린 카드 (목표 레벨 도달 시) ───────── */}
      {rw && (() => {
        // 진행률(%)과 남은 레벨을 미리 계산해 화면 곳곳에서 재사용.
        // 목표 레벨(final_level)은 '2주쯤 꾸준히 기록하면 도달하는 레벨'로 잡혀 있다.
        const pct = Math.min(
          100,
          Math.round((rw.current_level / rw.final_level) * 100)
        );
        const levelsLeft = Math.max(0, rw.final_level - rw.current_level);
        // 응원 문구는 '목표 달성' 때만 — 그 외에는 진행바만 깔끔하게 둔다.
        const cheer = rw.eligible
          ? "목표 달성! 지금 바로 받아가세요 🎉"
          : "";

        return (
          <section className="reward-card">
            <div className="reward-card-head">
              <span className="reward-card-tag">🏆 현금 보상 챌린지</span>
              <span className="reward-card-goal">목표 Lv.{rw.final_level}</span>
            </div>

            <p className="reward-card-caption">목표 달성 시 받는 현금</p>
            <strong className="reward-card-amount">
              {rw.reward_amount.toLocaleString()}
              <span>원</span>
            </strong>

            <div className="reward-meter">
              <div className="reward-meter-top">
                <span className="reward-meter-pct">{pct}%</span>
                <span className="reward-meter-level">
                  Lv.{rw.current_level} / {rw.final_level}
                </span>
              </div>
              <div className="reward-track">
                <div className="reward-track-fill" style={{ width: `${pct}%` }} />
              </div>
              {cheer && <p className="reward-cheer">{cheer}</p>}
            </div>

            {rw.claim ? (
              // 이미 신청함 — 상태별 안내
              <div className={`reward-result reward-result-${rw.claim.status}`}>
                {rw.claim.status === "pending" &&
                  "신청 완료 — 관리자 확인 후 지급돼요"}
                {rw.claim.status === "paid" && "지급 완료! 수고하셨어요 🎉"}
                {rw.claim.status === "rejected" && "신청이 반려되었어요"}
              </div>
            ) : rw.eligible ? (
              // 자격 있음 + 미신청 → 받기 버튼(시선 끌기용 펄스)
              <button
                type="button"
                className="reward-cta reward-cta--pulse"
                disabled={reward.claiming}
                onClick={handleClaim}
              >
                {reward.claiming
                  ? "신청 중…"
                  : `${rw.reward_amount.toLocaleString()}원 받기`}
              </button>
            ) : (
              // 아직 자격 미달 → 남은 레벨 안내(비활성 톤)
              <button type="button" className="reward-cta reward-cta--ghost" disabled>
                목표까지 {levelsLeft}레벨 남았어요
              </button>
            )}
            {claimError && <p className="reward-card-error">{claimError}</p>}
          </section>
        );
      })()}

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

        {/* 토스풍 한 장 카드 — 첫 3개는 항상, 나머지는 '더보기'로 펼친다 */}
        <div className="point-rules-listcard">
          {pointRules.slice(0, 3).map((rule) => renderRuleRow(rule))}
          {showRules &&
            pointRules.slice(3).map((rule) => renderRuleRow(rule, true))}

          {pointRules.length > 3 && (
            <button
              type="button"
              className={`point-more-btn${showRules ? " open" : ""}`}
              onClick={() => setShowRules((v) => !v)}
              aria-expanded={showRules}
            >
              <span className="point-more-chevron" />
              {showRules ? "접기" : `${pointRules.length - 3}개 더보기`}
            </button>
          )}
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

      {/* 첫 진입 힌트 — 아래에 내용이 더 있음을 알리는 통통 튀는 셰브론 */}
      {showScrollHint && (
        <div className="point-scroll-hint" aria-hidden="true">
          <span className="point-scroll-hint-text">아래로 내려보세요</span>
          <span className="point-scroll-hint-chevron" />
        </div>
      )}
    </div>
  );
}

export default Point;

/* Survey — 사전 설문(정신건강/섭식 스크리닝 v3) 화면.
 *
 * 흐름:
 *   1) props.data 로 활성 스키마 + prefilled + in_progress 응답을 받는다
 *      (게이트가 GET /api/survey/next 로 받아서 전달 — 중복 호출 방지).
 *   2) 섹션별 step machine 으로 진행 (분기는 branching.js 가 처리).
 *   3) 섹션 끝날 때마다 PATCH /api/survey/{id}/progress (autosave).
 *   4) 마지막 섹션 → POST /submit → onDone().
 *
 * props:
 *   data   : GET /api/survey/next 응답 (due 가 onboarding|recurring 인 것).
 *   onDone : 설문 완료/건너뛰기 시 호출 (게이트가 화면을 닫는다).
 */
import { useCallback, useMemo, useState } from "react";

import { saveSurveyProgress, submitSurvey } from "../utils/survey.js";
import { Question } from "./questionTypes/Question.jsx";
import { visibleQuestions } from "./branching.js";
import { unansweredIds } from "./validation.js";
import "../Survey.css";

const READY = "ready";
const SUBMITTING = "submitting";
const DONE = "done";

export default function Survey({ data, onDone }) {
  const [phase, setPhase] = useState(READY);
  const [error, setError] = useState("");
  // 제출 응답에서 받은 '이번에 새로 적립된 포인트' — 완료 화면 효과에 쓴다.
  const [pointsAwarded, setPointsAwarded] = useState(0);
  // '나중에 하기' 확인 모달 표시 여부.
  const [confirmingQuit, setConfirmingQuit] = useState(false);

  // prefilled 위에 in_progress answers 가 우선
  const [answers, setAnswers] = useState(() => ({
    ...(data.prefilled_answers || {}),
    ...(data.answers || {}),
  }));

  const sections = useMemo(
    () => data.schema_json?.sections || [],
    [data.schema_json],
  );

  // 이어쓰기: current_section 매치되는 인덱스부터 시작
  const [sectionIndex, setSectionIndex] = useState(() => {
    if (!data.current_section) return 0;
    const idx = sections.findIndex((s) => s.id === data.current_section);
    return Math.max(0, idx);
  });

  const currentSection = sections[sectionIndex];
  const totalSections = sections.length;
  const progressPct =
    totalSections > 0
      ? Math.round(((sectionIndex + 1) / totalSections) * 100)
      : 0;

  const questionsToShow = useMemo(
    () => (currentSection ? visibleQuestions(currentSection, answers) : []),
    [currentSection, answers],
  );

  // 현재 화면에서 아직 답하지 않은 필수 문항 — 있으면 다음/제출을 막는다.
  const pendingIds = useMemo(
    () => new Set(unansweredIds(questionsToShow, answers)),
    [questionsToShow, answers],
  );
  const incomplete = pendingIds.size > 0;

  const setAnswer = useCallback((qid, value) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }, []);

  const goNext = useCallback(async () => {
    setError("");
    const isLast = sectionIndex >= totalSections - 1;
    const nextSectionId = isLast ? null : sections[sectionIndex + 1]?.id;

    try {
      await saveSurveyProgress(data.response_id, {
        answers, // 전체 보내기(서버에서 merge — 단순성 우선)
        currentSection: nextSectionId,
      });
    } catch {
      setError("진행 상황 저장에 실패했어요. 잠시 후 다시 시도해주세요.");
      return;
    }

    if (!isLast) {
      setSectionIndex((i) => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // 마지막 섹션 → 제출
    setPhase(SUBMITTING);
    try {
      const result = await submitSurvey(data.response_id);
      setPointsAwarded(result?.points_awarded || 0);
      setPhase(DONE);
      // 포인트 획득 효과를 충분히 보여주고 닫기
      window.setTimeout(() => onDone?.(), 2600);
    } catch {
      setError("제출에 실패했어요. 잠시 후 다시 시도해주세요.");
      setPhase(READY);
    }
  }, [answers, data.response_id, onDone, sectionIndex, sections, totalSections]);

  const goPrev = useCallback(() => {
    if (sectionIndex > 0) {
      setSectionIndex((i) => i - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [sectionIndex]);

  // '나중에 하기': 현재 섹션 응답을 best-effort 저장(현재 섹션에서 재개되도록)하고 닫는다.
  // 제출이 아니므로 due 가 그대로라 다음 접속 때 이어서 다시 뜬다.
  const quitForNow = useCallback(async () => {
    try {
      await saveSurveyProgress(data.response_id, {
        answers,
        currentSection: currentSection?.id ?? null,
      });
    } catch {
      // 저장 실패해도 닫기는 진행 — 직전 섹션까지는 이미 저장돼 있다.
    }
    onDone?.();
  }, [answers, currentSection, data.response_id, onDone]);

  if (phase === DONE) {
    return (
      <div className="survey-shell">
        <div className="survey-page survey-center">
          <div className="survey-done-emoji" aria-hidden="true">🧀</div>
          <p className="survey-done-title">설문 완료!</p>
          {pointsAwarded > 0 && (
            <div className="survey-reward" role="status">
              {/* 톡 튀어오르는 포인트 배지 + 주변 반짝임 */}
              <span className="survey-reward-sparkle" aria-hidden="true">✨</span>
              <div className="survey-reward-badge">
                <span className="survey-reward-amount">+{pointsAwarded}</span>
                <span className="survey-reward-unit">포인트</span>
              </div>
              <p className="survey-reward-text">포인트를 획득했어요!</p>
            </div>
          )}
          <p className="survey-done-sub">설문을 완료했습니다! 잠시 후 홈으로 이동합니다…</p>
        </div>
      </div>
    );
  }

  const submitting = phase === SUBMITTING;
  const isLast = sectionIndex >= totalSections - 1;
  // 진행 중 독려: 완료 시 받을 포인트(백엔드 survey/next 가 내려준 실제 값).
  const rewardPoints = data.reward_points || 0;

  return (
    <div className="survey-shell">
    <div className="survey-page">
      <header className="survey-head">
        <div className="survey-topbar">
          {rewardPoints > 0 ? (
            <div className="survey-reward-hint" role="note">
              <span className="survey-reward-hint-emoji" aria-hidden="true">🧀</span>
              <span className="survey-reward-hint-text">
                설문 끝까지 완료하고 <strong>{rewardPoints}P</strong> 받기
              </span>
            </div>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="survey-quit"
            onClick={() => setConfirmingQuit(true)}
            disabled={submitting}
          >
            나중에 하기
          </button>
        </div>
        <p className="survey-kicker">
          {data.due === "onboarding" ? "시작 설문" : "주기 설문"} · {sectionIndex + 1} / {totalSections}
        </p>
        <h1 className="survey-section-title">{currentSection?.title}</h1>
        {currentSection?.description && (
          <p className="survey-section-desc">{currentSection.description}</p>
        )}
        <div className="survey-progress">
          <div className="survey-progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      <ol className="survey-questions">
        {questionsToShow.map((q) => {
          const pending = pendingIds.has(q.id);
          return (
            <li
              key={q.id}
              className={`survey-question${pending ? " is-unanswered" : ""}`}
            >
              <div className="survey-question-head">
                <span className="survey-qid">{q.id}</span>
                <p className="survey-qtext">{q.text}</p>
              </div>
              <Question
                question={q}
                value={answers[q.id]}
                onChange={(v) => setAnswer(q.id, v)}
                disabled={submitting}
              />
              {q.note && <p className="survey-qnote">{q.note}</p>}
              {pending && <p className="survey-required-note">응답해 주세요</p>}
            </li>
          );
        })}
      </ol>

      {error && <p className="survey-error">{error}</p>}
      {incomplete && (
        <p className="survey-incomplete">
          아직 답하지 않은 문항이 {pendingIds.size}개 있어요.
        </p>
      )}

      <footer className="survey-foot">
        <button
          type="button"
          className="survey-btn survey-btn--ghost"
          onClick={goPrev}
          disabled={sectionIndex === 0 || submitting}
        >
          이전
        </button>
        <button
          type="button"
          className="survey-btn survey-btn--primary"
          onClick={goNext}
          disabled={submitting || incomplete}
        >
          {submitting
            ? "제출 중…"
            : isLast
              ? rewardPoints > 0
                ? `제출하고 ${rewardPoints}P 받기`
                : "제출"
              : "다음"}
        </button>
      </footer>
    </div>

    {confirmingQuit && (
      <div className="survey-modal-overlay" role="dialog" aria-modal="true">
        <div className="survey-modal">
          <p className="survey-modal-title">설문을 나중에 할까요?</p>
          <p className="survey-modal-desc">
            지금까지 답한 내용은 저장돼요.
            {rewardPoints > 0 && ` 다만 지금 그만두면 완료 보상 ${rewardPoints}P는 아직 받을 수 없어요.`}
          </p>
          <div className="survey-modal-actions">
            <button
              type="button"
              className="survey-btn survey-btn--ghost"
              onClick={quitForNow}
            >
              나중에 하기
            </button>
            <button
              type="button"
              className="survey-btn survey-btn--primary"
              onClick={() => setConfirmingQuit(false)}
            >
              계속하기
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

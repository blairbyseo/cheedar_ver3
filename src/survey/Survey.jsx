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
import "../Survey.css";

const READY = "ready";
const SUBMITTING = "submitting";
const DONE = "done";

export default function Survey({ data, onDone }) {
  const [phase, setPhase] = useState(READY);
  const [error, setError] = useState("");

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
      await submitSurvey(data.response_id);
      setPhase(DONE);
      // 잠깐 완료 화면 보여주고 닫기
      window.setTimeout(() => onDone?.(), 1200);
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

  if (phase === DONE) {
    return (
      <div className="survey-shell">
        <div className="survey-page survey-center">
          <div className="survey-done-emoji" aria-hidden="true">🧀</div>
          <p className="survey-done-title">설문 완료!</p>
          <p className="survey-done-sub">함께해줘서 고마워요. 잠시 후 이동합니다…</p>
        </div>
      </div>
    );
  }

  const submitting = phase === SUBMITTING;
  const isLast = sectionIndex >= totalSections - 1;

  return (
    <div className="survey-shell">
    <div className="survey-page">
      <header className="survey-head">
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
        {questionsToShow.map((q) => (
          <li key={q.id} className="survey-question">
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
          </li>
        ))}
      </ol>

      {error && <p className="survey-error">{error}</p>}

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
          disabled={submitting}
        >
          {submitting ? "제출 중…" : isLast ? "제출" : "다음"}
        </button>
      </footer>
    </div>
    </div>
  );
}

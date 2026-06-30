/* OnboardingSurvey — "한 문항 = 한 화면" 스텝 머신 (기존 섹션-페이지 Survey 대체).
 *
 * props: { data, onDone } — 기존 Survey 와 동일 계약(드롭인 교체).
 *   data: GET /api/survey/next 응답 (+ App.jsx 가 user_name 주입).
 *   onDone: 완료/건너뛰기 시 호출.
 *
 * 흐름: welcome → A문항 → 축하 → (왜묻는지) → B → (전환) → C → (고마움) → D → E
 *       → (마지막) → F → Before/After → 결심+싸인 → 분석 로딩(=제출) → 결과 → onDone.
 * - 분기/프리필 스킵을 반영해 다음/이전 보이는 스텝 탐색.
 * - 섹션 경계에서 PATCH progress (autosave, best-effort).
 * - 로딩 화면 진입 시 POST submit. 결과 화면은 응답 기반 결정론 reflection 렌더.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { saveSurveyProgress, submitSurvey } from "../../utils/survey.js";
import { shouldShowQuestion } from "../branching.js";
import { buildFlow } from "./flow.js";
import { theme, tap } from "./theme.js";
import { PrimaryButton } from "./parts.jsx";
import {
  WelcomeScreen, QuestionScreen, InterstitialScreen, TransitionScreen,
  CompareScreen, CommitmentScreen, LoadingScreen, ResultScreen,
} from "./screens.jsx";
import "./onboarding.css";

// ── 결과 개인화(결정론, 프론트 임시) ──────────────────────────
// 백엔드 scoring(v3)이 reflection 을 내려주기 전까지의 안전한 임시 버전.
// 가드레일: 체중·칼로리 언어 회피, 급성 신호(자살사고 등) 직접 노출 금지.
function buildInsights(answers) {
  const out = [];
  const sleep = answers["A-7"]?.sleep_time;
  if (sleep) {
    const late = sleep >= "23:00" || sleep <= "03:30";
    out.push({
      icon: "solar:moon-stars-linear", tag: "수면",
      text: late
        ? "취침이 조금 늦은 편이에요. 30분 당기기부터 같이 해봐요."
        : "수면 리듬이 안정적이에요. 지금 흐름을 같이 지켜가요.",
    });
  }
  const bf = answers["D-1-3"];
  if (bf) {
    out.push({
      icon: "solar:plate-linear", tag: "식사",
      text: bf === "yes"
        ? "아침을 잘 챙기고 있어요. 끼니 리듬을 함께 이어가요."
        : "아침을 거를 때가 있네요. 한 입으로 리듬을 잡아봐요.",
    });
  }
  // 마음: '좋은 출발선' 프레이밍(핸드오프 F 2변형) — 구체 신호는 노출하지 않음.
  out.push({
    icon: "solar:heart-pulse-linear", tag: "마음",
    text: "여기까지 솔직하게 와줬어요. 무리하지 않게 천천히 같이 가요.",
  });
  return out.slice(0, 3);
}
function buildRoutine(answers) {
  const byGoal = {
    meal_pattern: "첫 루틴 · 아침 한 입부터 기록하기",
    sleep: "첫 루틴 · 자기 전 휴대폰 5분 멀리 두기",
    exercise: "첫 루틴 · 하루 10분 가볍게 걷기",
    binge: "첫 루틴 · 먹기 전 한 번 숨 고르기",
    mood_food: "첫 루틴 · 먹은 뒤 기분 한 줄 적기",
    log_only: "첫 루틴 · 오늘 한 끼만 가볍게 남기기",
  };
  return byGoal[answers["F-1"]] || "첫 루틴 · 자기 전 휴대폰 5분 멀리 두기";
}

export default function OnboardingSurvey({ data, onDone }) {
  const [error, setError] = useState("");
  const [confirmingQuit, setConfirmingQuit] = useState(false);
  const [dir, setDir] = useState("fwd");
  const [resultData, setResultData] = useState(null);

  const userName = data.user_name || data.name || "";
  const rewardPoints = data.reward_points || 0;
  const flow = useMemo(() => buildFlow(data.schema_json, userName), [data.schema_json, userName]);

  const prefilledIds = useMemo(
    () => new Set(Object.keys(data.prefilled_answers || {})),
    [data.prefilled_answers],
  );

  const [answers, setAnswers] = useState(() => ({
    ...(data.prefilled_answers || {}),
    ...(data.answers || {}),
  }));
  // 자동넘김 직후 최신값으로 분기 평가하기 위한 미러 ref.
  const answersRef = useRef(answers);

  const isVisible = useCallback(
    (step) => {
      if (!step) return false;
      if (step.kind !== "question") return true;
      if (step.skipIfPrefilled && prefilledIds.has(step.id)) return false;
      return shouldShowQuestion(step, answersRef.current);
    },
    [prefilledIds],
  );

  const [idx, setIdx] = useState(() => {
    const sec = data.current_section;
    if (!sec) return 0;
    const start = flow.findIndex((s) => s.kind === "question" && s.section === sec);
    return start < 0 ? 0 : start;
  });

  const step = flow[idx];

  const questionIdxs = useMemo(
    () => flow.map((s, i) => (s.kind === "question" ? i : -1)).filter((i) => i >= 0),
    [flow],
  );
  const totalQ = questionIdxs.length;
  const answeredBefore = questionIdxs.filter((i) => i < idx).length;
  const progress = totalQ > 0 ? answeredBefore / totalQ : 0;

  const t = useMemo(() => theme(step?.tone === "calm" ? "calm" : "warm"), [step?.tone]);

  const setValue = useCallback((qid, value) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: value };
      answersRef.current = next;
      return next;
    });
  }, []);

  const findVisible = useCallback(
    (start, dirStep) => {
      let i = start;
      while (i >= 0 && i < flow.length) {
        if (isVisible(flow[i])) return i;
        i += dirStep;
      }
      return -1;
    },
    [flow, isVisible],
  );

  const autosaveBoundary = useCallback(
    (fromStep, toStep) => {
      const fromSec = fromStep?.section ?? null;
      const toSec = toStep?.section ?? null;
      if (toSec && toSec !== fromSec) {
        saveSurveyProgress(data.response_id, {
          answers: answersRef.current,
          currentSection: toSec,
        }).catch(() => {});
      }
    },
    [data.response_id],
  );

  const goNext = useCallback(() => {
    const ni = findVisible(idx + 1, +1);
    if (ni === -1) {
      onDone?.();
      return;
    }
    autosaveBoundary(flow[idx], flow[ni]);
    setDir("fwd");
    setIdx(ni);
  }, [idx, flow, findVisible, autosaveBoundary, onDone]);

  const goPrev = useCallback(() => {
    const pi = findVisible(idx - 1, -1);
    if (pi === -1) return;
    setDir("back");
    setIdx(pi);
  }, [idx, findVisible]);

  const quitForNow = useCallback(async () => {
    await saveSurveyProgress(data.response_id, {
      answers: answersRef.current,
      currentSection: step?.section ?? null,
    }).catch(() => {});
    onDone?.();
  }, [data.response_id, step, onDone]);

  // 로딩 화면 진입 시 1회 제출 → 결과 reflection 준비
  const submittedRef = useRef(false);
  useEffect(() => {
    if (step?.kind !== "loading" || submittedRef.current) return;
    submittedRef.current = true;
    (async () => {
      await saveSurveyProgress(data.response_id, {
        answers: answersRef.current,
        currentSection: null,
      }).catch(() => {});
      let points = 0;
      try {
        const result = await submitSurvey(data.response_id);
        points = result?.points_awarded || 0;
      } catch {
        setError("제출 저장에 문제가 있었어요. 네트워크 확인 후 다시 시도해주세요.");
      }
      setResultData({
        insights: buildInsights(answersRef.current),
        routine: buildRoutine(answersRef.current),
        points,
      });
    })();
  }, [step?.kind, data.response_id]);

  // ── 스텝 렌더 ──
  let view = null;
  if (step?.kind === "welcome") {
    view = <WelcomeScreen t={t} userName={userName} onNext={goNext} />;
  } else if (step?.kind === "question") {
    view = (
      <QuestionScreen
        step={step} t={t} value={answers[step.id]} setValue={setValue}
        onNext={goNext} onBack={goPrev} progress={progress}
        reward={rewardPoints}
        onQuit={() => { tap(); setConfirmingQuit(true); }}
      />
    );
  } else if (step?.kind === "interstitial") {
    view = <InterstitialScreen step={step} t={t} progress={progress} onNext={goNext} onBack={goPrev} />;
  } else if (step?.kind === "transition") {
    view = <TransitionScreen step={step} t={t} progress={progress} onNext={goNext} onBack={goPrev} />;
  } else if (step?.kind === "compare") {
    view = <CompareScreen step={step} t={t} progress={progress} onNext={goNext} onBack={goPrev} />;
  } else if (step?.kind === "commitment") {
    view = <CommitmentScreen step={step} t={t} progress={progress} onNext={goNext} onBack={goPrev} />;
  } else if (step?.kind === "loading") {
    view = <LoadingScreen step={step} t={t} onNext={goNext} />;
  } else if (step?.kind === "result") {
    view = (
      <ResultScreen
        step={{
          ...step,
          insights: resultData?.insights || [],
          routine: resultData?.routine,
          points: resultData?.points || 0,
        }}
        userName={userName}
        t={t}
        onNext={() => onDone?.()}
      />
    );
  }

  const noHeaderKind = step?.kind === "welcome" || step?.kind === "loading" || step?.kind === "result";

  return (
    <div className="onb-root" data-tone={t.tone} style={{ background: step?.bg || t.bg }}>
      <div key={idx} className={`onb-step-enter${dir === "back" ? " is-back" : ""}`} style={{ height: "100%" }}>
        {view}
      </div>

      {error && !noHeaderKind && (
        <p style={{ position: "absolute", bottom: 96, left: 22, right: 22, textAlign: "center", fontSize: 14, color: "#C8674F", fontFamily: "inherit" }}>
          {error}
        </p>
      )}

      {confirmingQuit && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "absolute", inset: 0, background: "rgba(20,22,24,0.32)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 10 }}
          onClick={() => setConfirmingQuit(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: "22px 22px 0 0", padding: "24px 22px 28px", fontFamily: "inherit" }}
          >
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: t.text }}>
              {rewardPoints > 0 ? `조금만 더 하면 ${rewardPoints}P예요!` : "설문을 나중에 할까요?"}
            </p>
            <p style={{ margin: "10px 0 20px", fontSize: 14.5, lineHeight: 1.55, color: t.sub, wordBreak: "keep-all" }}>
              {rewardPoints > 0
                ? `지금 그만두면 완료 보상 ${rewardPoints}P는 아직 받을 수 없어요. 답한 내용은 저장되니, 끝까지 마치면 ${rewardPoints}P를 받을 수 있어요.`
                : "지금까지 답한 내용은 저장돼요. 다음에 이어서 할 수 있어요."}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button" onClick={quitForNow}
                style={{ flex: 1, height: 52, borderRadius: 15, border: `1.5px solid ${t.line}`, background: "#fff", color: t.sub, fontFamily: "inherit", fontSize: 15, fontWeight: 600, cursor: "pointer", wordBreak: "keep-all" }}
              >
                {rewardPoints > 0 ? `${rewardPoints}P 포기` : "나중에 하기"}
              </button>
              <div style={{ flex: 1 }}>
                <PrimaryButton t={t} label={rewardPoints > 0 ? `계속하고 ${rewardPoints}P 받기` : "계속하기"} onClick={() => setConfirmingQuit(false)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

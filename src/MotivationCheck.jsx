/* MotivationCheck.jsx: 홈 진입 시 주 1회 뜨는 "동기 점검" 창.
 *
 * 설문 B-2 의 중요도·자신감(0~10)을 다시 묻고 지난 점수(첫 점검이면 설문 답)와 비교해 보여준다.
 * 몸무게는 선택 입력 — 서버가 show_weight=false(섭식 고위험군)를 주면 칸 자체를 숨긴다.
 * 띄울지 여부(due)는 서버(GET /api/motivation/status)가 정한다. "나중에"는 하루 동안만 미룬다.
 */
import { useEffect, useState } from "react";
import "./MotivationCheck.css";

const SNOOZE_KEY = "cheddar.motivationSnoozeUntil";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

const QUESTIONS = [
  {
    key: "importance",
    label: "중요도",
    text: "식습관·생활을 바꾸는 게 지금 나에게 얼마나 중요한가요?",
    low: "전혀",
    high: "매우",
  },
  {
    key: "confidence",
    label: "자신감",
    text: "바꿀 수 있다는 자신감은 얼마나 있나요?",
    low: "전혀",
    high: "매우",
  },
];

function isSnoozed() {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // 저장소를 못 쓰면 이번 실행에서만 닫힌다.
  }
}

// 지난 점수 대비 변화 문구 (존댓말·비판단)
function trendText(prev, now) {
  if (prev == null) return "처음 기록했어요";
  if (now > prev) return "조금 올라왔어요";
  if (now < prev) return "조금 내려왔어요. 괜찮아요, 천천히 가요";
  return "지난번과 같아요";
}

function MotivationCheck() {
  const [phase, setPhase] = useState("hidden"); // hidden | asking | done
  const [status, setStatus] = useState(null);
  const [scores, setScores] = useState({ importance: null, confidence: null });
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isSnoozed()) return;
    let cancelled = false;
    fetch("/api/motivation/status", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.due) return;
        setStatus(data);
        setPhase("asking");
      })
      .catch(() => {}); // 못 불러오면 조용히 넘어간다(다음 진입 때 다시)
    return () => { cancelled = true; };
  }, []);

  if (phase === "hidden" || !status) return null;

  const prev = status.previous;
  const prevWord = prev?.source === "survey" ? "설문 때" : "지난번";
  const canSubmit = scores.importance != null && scores.confidence != null && !isSubmitting;

  function close() {
    setPhase("hidden");
  }

  function later() {
    snooze();
    close();
  }

  async function submit() {
    if (!canSubmit) return;
    const w = weight.trim() === "" ? null : Number(weight);
    if (w != null && !(w >= 20 && w <= 300)) {
      setError("몸무게는 20~300kg 사이로 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/motivation/checkin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scores, weight_kg: status.show_weight ? w : null }),
      });
      if (!res.ok) throw new Error(`checkin ${res.status}`);
      setResult(await res.json());
      setPhase("done");
    } catch (err) {
      console.error("[MotivationCheck] save failed:", err);
      setError("기록에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mot-overlay" onClick={phase === "done" ? close : undefined}>
      <div className="mot-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {phase === "asking" && (
          <>
            <p className="mot-title">이번 주 동기 점검</p>
            <p className="mot-sub">지난 일주일을 떠올리며 편하게 답해 주세요</p>

            {QUESTIONS.map((q) => {
              const value = scores[q.key];
              const before = prev?.[q.key];
              return (
                <div className="mot-question" key={q.key}>
                  <p className="mot-q-text">{q.text}</p>
                  <div className="mot-scale">
                    {Array.from({ length: 11 }, (_, n) => (
                      <button
                        type="button"
                        key={n}
                        className={`mot-dot${value === n ? " is-selected" : ""}`}
                        onClick={() => setScores((s) => ({ ...s, [q.key]: n }))}
                        aria-label={`${q.label} ${n}점`}
                        aria-pressed={value === n}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="mot-scale-ends">
                    <span>{q.low}</span>
                    {before != null && (
                      <span className="mot-prev">{prevWord} {before}점</span>
                    )}
                    <span>{q.high}</span>
                  </div>
                </div>
              );
            })}

            {status.show_weight && (
              <label className="mot-weight">
                <span className="mot-q-text">몸무게 <em>(선택)</em></span>
                <div className="mot-weight-input">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder={status.last_weight_kg ? String(status.last_weight_kg) : "예: 55.0"}
                  />
                  <span>kg</span>
                </div>
                <span className="mot-weight-hint">운동 칼로리 계산에 쓰여요. 비워 둬도 괜찮아요</span>
              </label>
            )}

            {error && <p className="mot-error">{error}</p>}

            <div className="mot-actions">
              <button type="button" className="mot-later" onClick={later} disabled={isSubmitting}>
                나중에
              </button>
              <button type="button" className="mot-submit" onClick={submit} disabled={!canSubmit}>
                {isSubmitting ? "기록 중..." : "기록하기"}
              </button>
            </div>
          </>
        )}

        {phase === "done" && result && (
          <>
            <p className="mot-title">기록했어요</p>
            <ul className="mot-result">
              {QUESTIONS.map((q) => {
                const before = result.previous?.[q.key];
                return (
                  <li key={q.key}>
                    <span className="mot-result-label">{q.label}</span>
                    <span className="mot-result-score">
                      {before != null ? `${before} → ` : ""}
                      <strong>{result[q.key]}</strong>
                    </span>
                    <span className="mot-result-trend">{trendText(before, result[q.key])}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mot-sub">체다가 대화할 때 참고할게요. 다음 주에 또 같이 봐요!</p>
            <div className="mot-actions">
              <button type="button" className="mot-submit" onClick={close}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MotivationCheck;

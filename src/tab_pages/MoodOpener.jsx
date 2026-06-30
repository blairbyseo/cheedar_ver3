/* MoodOpener — 채팅 진입 시 하루 1회 보여주는 기분 체크인 카드.
 *
 * Cheddar_Team_26 의 daily check-in 을 이식.
 * 1~10 슬라이더(좌 빨강 → 우 초록)로 현재 기분을 받아 POST /api/emotion/log 한다.
 * 점수를 고르면 표정 이모지와 한글 라벨이 즉시 바뀌어 피드백을 준다.
 * 기록에 성공하면 onLogged({ score, emotion_label }) 를 호출 — 부모(Chat)가
 * 카드를 감추고 AI 가 먼저 인사하는 opener 스트림을 트리거한다.
 */
import { useState } from "react";

const SCORE_TO_LABEL = {
  1: "너무 나쁨",
  2: "매우 나쁨",
  3: "나쁨",
  4: "좀 나쁨",
  5: "그저 그럼",
  6: "괜찮음",
  7: "좋음",
  8: "꽤 좋음",
  9: "정말 좋음",
  10: "너무 좋음",
};

const SCORE_TO_EMOJI = {
  1: "😭",
  2: "😢",
  3: "😞",
  4: "🙁",
  5: "😐",
  6: "🙂",
  7: "😊",
  8: "😄",
  9: "😁",
  10: "🤩",
};

function MoodOpener({ onLogged }) {
  const [score, setScore] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit() {
    if (score === null || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/emotion/log", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, emotion_label: SCORE_TO_LABEL[score] }),
      });
      if (!res.ok) throw new Error(`emotion log ${res.status}`);
      onLogged({ score, emotion_label: SCORE_TO_LABEL[score] });
    } catch (err) {
      console.error("[MoodOpener] log failed:", err);
      setError("기록에 실패했어요. 다시 시도해주세요.");
      setIsSubmitting(false);
    }
  }

  const picked = score !== null;

  return (
    <div className="mood-opener">
      <div className="mood-opener-head">
        <span className="mood-opener-badge">오늘의 기분</span>
        <p className="mood-opener-title">오늘 기분 어때요?</p>
      </div>

      <div className="mood-face" aria-hidden="true">
        <span className={`mood-face-emoji ${picked ? "" : "is-empty"}`}>
          {picked ? SCORE_TO_EMOJI[score] : "🙂"}
        </span>
      </div>
      <p className={`mood-face-label ${picked ? "" : "is-empty"}`}>
        {picked ? SCORE_TO_LABEL[score] : "슬라이더를 움직여 골라주세요"}
      </p>

      <div className="mood-slider-wrap">
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={score ?? 5}
          onChange={(e) => {
            setScore(parseInt(e.target.value, 10));
            setError(null);
          }}
          aria-label="기분 점수 1부터 10까지"
          className={`mood-slider ${picked ? "" : "mood-slider-empty"}`}
        />
        {/* 1~10 단계 눈금 — 모바일에서 단계를 예측할 수 있게. 선택값까지 채워진다. */}
        <div className="mood-ticks" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className={`mood-tick${picked && i + 1 <= score ? " is-active" : ""}${
                picked && i + 1 === score ? " is-current" : ""
              }`}
            />
          ))}
        </div>
        <div className="mood-anchor-row">
          <span>매우 나쁨</span>
          <span>보통</span>
          <span>매우 좋음</span>
        </div>
      </div>

      {error && <p className="mood-opener-error">{error}</p>}

      <button
        type="button"
        className="mood-opener-submit"
        disabled={!picked || isSubmitting}
        onClick={handleSubmit}
      >
        {isSubmitting ? "기록 중..." : "이 기분으로 대화 시작하기"}
      </button>
    </div>
  );
}

export default MoodOpener;

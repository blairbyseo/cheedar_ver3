/*5-8. Exercise.jsx: 홈의 "운동 기록" 카드에서 진입하는 운동 기록 화면.
 *
 * Cheddar_Team_26 의 ExerciseTab 방식을 이 프로젝트(순수 CSS + FastAPI)에 맞게 옮긴 것.
 *  - 운동 종목 입력 → 사전 MET 에 있으면 바로, 없으면 /api/exercise/analyze 로 AI 추정.
 *  - 시간(시/분)·강도(1~10)로 소모 칼로리를 미리 계산해 보여주고 목록에 추가.
 *  - "저장하기"로 하루치를 한 번에 POST /api/exercise (UPSERT).
 *  - 칼로리 미리보기는 회원가입 때 입력한 체중을 쓰고, 서버가 저장 시 같은 공식으로 재계산.
 *  - 랭킹/리포트와 동일한 onBack 패턴.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  lookupKnownMet,
  estimateCalories,
  intensityLabel,
  emojiForExercise,
  sumItemCalories,
  formatDurationShort,
  KNOWN_EXERCISES,
} from "../utils/exercise";

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function Exercise({ onBack, embedded = false }) {
  const { user } = useAuth();
  const weightKg = user?.weight_kg || 70; // 미리보기용. 서버가 저장 시 재계산.

  const [items, setItems] = useState([]);       // 추가된 운동 목록
  const [name, setName] = useState("");
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(30);
  const [intensity, setIntensity] = useState(3);

  const [isSkipped, setIsSkipped] = useState(false);
  const [savedForToday, setSavedForToday] = useState(false); // 오늘 이미 저장됨
  const [isEditing, setIsEditing] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [status, setStatus] = useState("loading"); // loading | ready

  // 첫 진입: 오늘 운동 기록이 있으면 불러와 표시.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/exercise?on=${todayStr()}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`exercise ${res.status}`);
        const rows = await res.json();
        if (cancelled) return;
        const today = rows[0];
        if (today) {
          setItems(today.items ?? []);
          setIsSkipped(today.is_skipped);
          setSavedForToday(true);
        }
      } catch (err) {
        console.error("[Exercise] load failed:", err);
      } finally {
        if (!cancelled) setStatus("ready");
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const totalKcal = sumItemCalories(items);
  const hasDuration = Number(hours) > 0 || Number(minutes) > 0;
  // 저장된 기록을 읽기 전용으로 보여줄지 (편집 중이 아니고, 안함 기록도 아닐 때)
  const showSavedReadOnly = savedForToday && !isEditing && !isSkipped;

  async function handleAddExercise() {
    const trimmed = name.trim();
    if (!trimmed) { setErrorText("운동 종목을 입력해 주세요."); return; }
    if (!hasDuration) { setErrorText("운동 시간을 입력해 주세요."); return; }
    setErrorText("");

    let met = lookupKnownMet(trimmed);
    let normalizedName = trimmed;

    // 사전 MET 에 없으면 AI 로 추정
    if (met == null) {
      try {
        setIsAnalyzing(true);
        const res = await fetch("/api/exercise/analyze", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exercise_name: trimmed }),
        });
        if (!res.ok) throw new Error(`analyze ${res.status}`);
        const data = await res.json();
        met = Number(data.met);
        if (data.normalized_name) normalizedName = data.normalized_name;
      } catch (err) {
        console.error("[Exercise] analyze failed:", err);
        setErrorText("운동 정보를 불러오지 못했어요. 다시 시도해주세요.");
        return;
      } finally {
        setIsAnalyzing(false);
      }
    }

    const calories = estimateCalories({
      met,
      weightKg,
      durationHours: hours,
      durationMinutes: minutes,
      intensity,
    });

    setItems((prev) => [
      ...prev,
      {
        exercise_name: normalizedName,
        met,
        duration_hours: Number(hours) || 0,
        duration_minutes: Number(minutes) || 0,
        intensity: Number(intensity),
        calories_burned: calories,
      },
    ]);

    // 폼 초기화 (강도는 유지)
    setName("");
    setHours(0);
    setMinutes(30);
  }

  function removeItemAt(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (isSaving) return;
    if (!isSkipped && items.length === 0) {
      setErrorText("운동을 추가하거나 '운동 안 함'으로 기록해 주세요.");
      return;
    }
    setIsSaving(true);
    setErrorText("");
    try {
      const payload = {
        is_skipped: isSkipped,
        items: isSkipped
          ? []
          : items.map((it) => ({
              exercise_name: it.exercise_name,
              met: it.met,
              duration_hours: it.duration_hours,
              duration_minutes: it.duration_minutes,
              intensity: it.intensity,
            })),
      };
      const res = await fetch("/api/exercise", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      const saved = await res.json();
      setItems(saved.items ?? []);
      setSavedForToday(true);
      setIsEditing(false);
      setSavedMessage(
        isSkipped ? "오늘은 운동 안 함으로 기록했어요" : "운동 기록 완료!"
      );
      setTimeout(() => setSavedMessage(""), 2000);
    } catch (err) {
      console.error("[Exercise] save failed:", err);
      setErrorText("저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="exercise-page">
      {/* embedded(식단 탭 안 패널)일 땐 자체 헤더를 숨긴다 — Diet 화면의 헤더·토글이 맥락을 준다 */}
      {!embedded && (
        <header className="exercise-header">
          <button
            type="button"
            className="exercise-back"
            onClick={onBack}
            aria-label="뒤로 가기"
          >
            ‹
          </button>
          <h1 className="exercise-title">운동 기록</h1>
          <span className="exercise-header-spacer" aria-hidden="true" />
        </header>
      )}
      <p className="exercise-sub">운동을 기록하면 주간 리포트에 반영돼요</p>

      {status === "loading" ? (
        <p className="exercise-state">불러오는 중…</p>
      ) : showSavedReadOnly ? (
        // 오늘 이미 저장됨 — 읽기 전용 + 수정 버튼
        <section className="exercise-card">
          <h2 className="exercise-card-title">오늘의 운동</h2>
          <div className="exercise-item-list">
            {items.map((it, idx) => (
              <div className="exercise-item" key={idx}>
                <span className="exercise-item-text">
                  {emojiForExercise(it.exercise_name)} {it.exercise_name}
                  {" · "}
                  {formatDurationShort(it.duration_hours, it.duration_minutes)}
                  {" · "}
                  {intensityLabel(it.intensity)}
                  {" · "}
                  {Math.round(it.calories_burned)} kcal
                </span>
              </div>
            ))}
          </div>
          <div className="exercise-total">
            <span>총 소모 칼로리</span>
            <strong>{Math.round(totalKcal)} kcal</strong>
          </div>
          <button
            type="button"
            className="exercise-edit-button"
            onClick={() => setIsEditing(true)}
          >
            수정하기
          </button>
        </section>
      ) : isSkipped ? (
        // "운동 안 함" 상태
        <section className="exercise-card">
          <p className="exercise-skip-text">오늘은 운동 안 함으로 기록할게요</p>
          <button
            type="button"
            className="exercise-skip-undo"
            onClick={() => setIsSkipped(false)}
          >
            운동 안 함 해제
          </button>
          <button
            type="button"
            className="exercise-save-button"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "저장 중..." : "운동 안 함 기록하기"}
          </button>
        </section>
      ) : (
        <>
          {/* 입력 폼 */}
          <section className="exercise-card">
            <label className="exercise-field">
              <span className="exercise-field-label">운동 종목</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 펜싱, 줄넘기, 요가"
                disabled={isAnalyzing}
              />
            </label>

            {/* 추천 종목 빠른 선택 */}
            <div className="exercise-chips">
              {KNOWN_EXERCISES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className={`exercise-chip ${name.trim() === ex ? "is-selected" : ""}`}
                  onClick={() => setName(ex)}
                >
                  {emojiForExercise(ex)} {ex}
                </button>
              ))}
            </div>

            <div className="exercise-time-row">
              <label className="exercise-field">
                <span className="exercise-field-label">시간</span>
                <div className="exercise-num-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="12"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                  <span className="exercise-num-unit">시간</span>
                </div>
              </label>
              <label className="exercise-field">
                <span className="exercise-field-label">분</span>
                <div className="exercise-num-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="59"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                  <span className="exercise-num-unit">분</span>
                </div>
              </label>
            </div>

            <div className="exercise-field">
              <span className="exercise-field-label">
                운동 강도 — {intensity} ({intensityLabel(intensity)})
              </span>
              {/* 가는 띠 위에서 동그라미가 1~5 지점으로 슬라이드하며 이동한다. */}
              <div
                className="intensity-track"
                role="slider"
                tabIndex={0}
                aria-label="운동 강도"
                aria-valuemin={1}
                aria-valuemax={5}
                aria-valuenow={intensity}
                aria-valuetext={intensityLabel(intensity)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                    e.preventDefault();
                    setIntensity((v) => Math.max(1, v - 1));
                  }
                  if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setIntensity((v) => Math.min(5, v + 1));
                  }
                }}
              >
                <div className="intensity-rail">
                  {/* 선택 지점까지 채워지는 띠 */}
                  <div
                    className="intensity-rail-fill"
                    style={{ width: `${((intensity - 1) / 4) * 100}%` }}
                  />
                  {/* 1~5 눈금 — 누르면 동그라미가 그 지점으로 이동 */}
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="intensity-tick"
                      style={{ left: `${((n - 1) / 4) * 100}%` }}
                      onClick={() => setIntensity(n)}
                      aria-label={`강도 ${n}단계`}
                    />
                  ))}
                  {/* 움직이는 동그라미 */}
                  <div
                    className="intensity-thumb"
                    style={{ left: `${((intensity - 1) / 4) * 100}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              className="exercise-add-button"
              onClick={handleAddExercise}
              disabled={!name.trim() || !hasDuration || isAnalyzing}
            >
              {isAnalyzing ? "체다 AI 분석 중…" : "+ 운동 추가"}
            </button>

            <button
              type="button"
              className="exercise-skip-link"
              onClick={() => setIsSkipped(true)}
            >
              오늘은 운동 안 함으로 기록
            </button>
          </section>

          {/* 추가된 운동 목록 */}
          {items.length > 0 && (
            <section className="exercise-card">
              <h2 className="exercise-card-title">추가된 운동</h2>
              <div className="exercise-item-list">
                {items.map((it, idx) => (
                  <div className="exercise-item" key={idx}>
                    <span className="exercise-item-text">
                      {emojiForExercise(it.exercise_name)} {it.exercise_name}
                      {" · "}
                      {formatDurationShort(it.duration_hours, it.duration_minutes)}
                      {" · "}
                      {intensityLabel(it.intensity)}
                      {" · "}
                      {Math.round(it.calories_burned)} kcal
                    </span>
                    <button
                      type="button"
                      className="exercise-item-remove"
                      onClick={() => removeItemAt(idx)}
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="exercise-total">
                <span>총 소모 칼로리</span>
                <strong>{Math.round(totalKcal)} kcal</strong>
              </div>
            </section>
          )}

          <button
            type="button"
            className="exercise-save-button"
            onClick={handleSave}
            disabled={isSaving || items.length === 0}
          >
            {isSaving ? "저장 중..." : "저장하기"}
          </button>
        </>
      )}

      {errorText && <p className="exercise-error">{errorText}</p>}
      {savedMessage && <p className="exercise-saved-toast">{savedMessage}</p>}
    </div>
  );
}

export default Exercise;

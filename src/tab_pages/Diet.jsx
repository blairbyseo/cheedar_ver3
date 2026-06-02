/*5-4. Diet.jsx: App.jsx 파일에 걸림 */
import { useEffect, useRef, useState } from "react";
import { usePoints } from "../usePoints";
import Exercise from "./Exercise";

const MEAL_TYPES = [
  { id: "breakfast", label: "아침" },
  { id: "lunch",     label: "점심" },
  { id: "dinner",    label: "저녁" },
  { id: "snack",     label: "간식" },
];

// 현재 시간으로 어떤 끼니인지 추정. 사용자는 카드 클릭으로 언제든 바꿀 수 있음.
// 05~11=아침, 1114시=점심, 17~21시=저녁, 그 외=간식
function getInitialMealType() {
  const hour = new Date().getHours();
  if (hour >= 5  && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 17 && hour < 21) return "dinner";
  return "snack";
}

// 첫 렌더용 placeholder — useEffect 안에서 GET /api/meals/today/status 로 즉시 갱신됨
const INITIAL_TODAY_STATUS = MEAL_TYPES.map((t) => ({ ...t, state: "missing" }));

const STATE_LABEL = {
  done:     "완료",
  missing:  "미기록",
  upcoming: "예정",
  selected: "선택",
};

// 끼니별 시간대 시작 시각 — 현재 시각이 이보다 이르면 아직 '예정'
const MEAL_SLOT_START = { breakfast: 0, lunch: 11, dinner: 17 };

function Diet() {
  // 헤더 우상단 포인트 — 현재 로그인한 환자의 CP
  const point = usePoints()?.cp ?? 0;

  const [selectedMealType, setSelectedMealType] = useState(getInitialMealType);
  const [uploadedImagePreview, setUploadedImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);          // 백엔드 업로드용 원본 파일
  const [manualEntry, setManualEntry] = useState({
    menu: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
  });
  const [analysis, setAnalysis] = useState(null);            // 분석 결과 객체 (null이면 미분석)
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showPointReward, setShowPointReward] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [todayStatus, setTodayStatus] = useState(INITIAL_TODAY_STATUS);
  // 이미 기록된 끼니에서 "추가하기"를 눌러 업로드 UI를 다시 연 상태인지
  const [isAdding, setIsAdding] = useState(false);
  // 기록 모드 — "diet"(식단) / "exercise"(운동). 한 화면에서 토글로 전환.
  const [mode, setMode] = useState("diet");

  // 끼니 현황 라벨 — 기록했으면 '완료', 아직 그 시간대 전이면 '예정',
  // 시간대가 지났는데 기록이 없으면 '미기록'.
  const nowHour = new Date().getHours();
  const mealStateLabel = (id) => {
    const state = todayStatus.find((s) => s.id === id)?.state;
    if (state === "done") return "완료";
    if (nowHour < MEAL_SLOT_START[id]) return "예정";
    return "미기록";
  };

  // 현재 선택된 끼니의 상태 — 기록이 있으면 state === "done"
  const currentMealStatus = todayStatus.find((s) => s.id === selectedMealType);
  const hasRecord = currentMealStatus?.state === "done";
  const selectedMealLabel = currentMealStatus?.label ?? "";
  // 기록이 없거나, "추가하기"를 눌러 새 입력 중일 때만 업로드 UI 표시
  const shouldShowUploadUI = !hasRecord || isAdding;

  const didInitRef = useRef(false);
  const resultRef = useRef(null);

  // 분석 결과가 막 도착했을 때 결과 카드까지 자동 스크롤.
  // analysis 가 null → 객체로 바뀌는 순간 발화.
  useEffect(() => {
    if (analysis) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [analysis]);

  // 첫 진입: 오늘 식단 현황 불러오기. 인증은 ProtectedRoute 단계에서 이미 통과한 상태.
  // 백엔드 응답 items: [{ meal_type, state }] → frontend의 todayStatus 형태로 매핑.
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    async function init() {
      try {
        const res = await fetch("/api/meals/today/status", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();

        setTodayStatus((prev) =>
          prev.map((s) => {
            const item = data.items.find((i) => i.meal_type === s.id);
            return item ? { ...s, state: item.state } : s;
          })
        );
      } catch (err) {
        console.error("[Diet] init failed:", err);
      }
    }
    init();
  }, []);

  // 끼니 탭을 바꾸면 화면에 떠 있던 사진/분석/직접입력/저장 진행 상태를 모두 초기화.
  // (예: 점심용으로 올렸지만 저장 안 한 사진이 저녁 탭에 따라가지 않도록)
  useEffect(() => {
    setUploadedImagePreview(null);
    setImageFile(null);
    setAnalysis(null);
    setAnalyzeError("");
    setManualEntry({ menu: "", calories: "", protein: "", carbs: "", fat: "" });
    setShowPointReward(false);
    setSavedMessage("");
    setIsAdding(false);
  }, [selectedMealType]);

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);          // 백엔드 업로드용 원본
    setAnalysis(null);            // 새 사진 → 이전 분석 결과 초기화
    setAnalyzeError("");
    const reader = new FileReader();
    reader.onload = () => setUploadedImagePreview(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleAnalyzeMeal() {
    if (!imageFile || isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzeError("");
    setAnalysis(null);

    try {
      // multipart/form-data 로 보내야 FastAPI 의 UploadFile 이 받음.
      // FormData 의 키 "file" 은 백엔드 함수의 매개변수 이름과 일치해야 함.
      const formData = new FormData();
      formData.append("file", imageFile);

      const res = await fetch("/api/meals/analyze", {
        method: "POST",
        credentials: "include",
        body: formData,
        // Content-Type 헤더는 직접 설정하지 않음 — 브라우저가 boundary 포함해 자동 설정
      });
      if (!res.ok) throw new Error(`analyze ${res.status}`);
      const data = await res.json();
      setAnalysis(data);
    } catch (err) {
      console.error("[Diet] analyze failed:", err);
      setAnalyzeError("분석에 실패했어요. 다시 시도해주세요.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  // 업로드한 이미지 삭제 — 미리보기 / 분석 결과 모두 초기화.
  // 사진을 빼고 직접 입력만으로 기록할 수 있도록 함.
  function handleRemoveImage() {
    setUploadedImagePreview(null);
    setImageFile(null);
    setAnalysis(null);
    setAnalyzeError("");
  }

  function handleManualChange(field, value) {
    setManualEntry((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSaveMeal() {
    if (isSaving) return;

    // 직접 입력 4칸: 전부 비워두면 사진 분석만 쓰는 경우로 보고 통과.
    // 일부만 채워두면 미완성 → 차단 + 경고.
    const nutritionFields = [
      manualEntry.calories,
      manualEntry.protein,
      manualEntry.carbs,
      manualEntry.fat,
    ];
    const filled = nutritionFields.filter(
      (v) => String(v).trim() !== ""
    ).length;
    if (filled > 0 && filled < 4) {
      alert("값을 입력하세요");
      return;
    }

    // 직접 입력이 있으면 그걸 우선, 없으면 AI 분석 결과 사용.
    // 사진도 분석도 직접입력도 다 없는 경우는 menu/calories 가 모두 비어 차단.
    const useManual = filled === 4;
    const payload = {
      meal_type: selectedMealType,                                // 백엔드가 오늘 날짜 채움
      menu: manualEntry.menu || analysis?.summary || null,
      calories: useManual ? Number(manualEntry.calories) : analysis?.calories ?? null,
      protein_g: useManual ? Number(manualEntry.protein) : analysis?.protein_g ?? null,
      carbs_g:   useManual ? Number(manualEntry.carbs)   : analysis?.carbs_g   ?? null,
      fat_g:     useManual ? Number(manualEntry.fat)     : analysis?.fat_g     ?? null,
      image_path: analysis?.image_path || null,
      ai_summary: analysis?.summary || null,
      ai_comment: analysis?.comment || null,
    };

    if (!payload.menu && payload.calories == null) {
      alert("사진을 분석하거나 직접 입력해주세요");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);

      setShowPointReward(true);
      setSavedMessage(`${selectedMealLabel} 기록 완료! 10P가 적립됐어요`);

      // 오늘 현황: 방금 저장한 끼니를 "완료"로 즉시 반영 (낙관적 업데이트)
      setTodayStatus((prev) =>
        prev.map((s) =>
          s.id === selectedMealType ? { ...s, state: "done" } : s
        )
      );

      // 1.7초 뒤: 보상 애니메이션이 끝나면 업로드 진행 상태 초기화 + isAdding 풀어서
      // "✓ 완료 + 추가하기" 카드로 자연스럽게 전환.
      setTimeout(() => {
        setShowPointReward(false);
        setSavedMessage("");
        setUploadedImagePreview(null);
        setImageFile(null);
        setAnalysis(null);
        setManualEntry({ menu: "", calories: "", protein: "", carbs: "", fat: "" });
        setIsAdding(false);
      }, 1700);
    } catch (err) {
      console.error("[Diet] save failed:", err);
      alert("저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="diet-page">
      {/* 홈과 동일한 헤더 — 로고 + 포인트 요약 */}
      <header className="home-header">
        <h1 className="home-logo">Cheddar</h1>
        <div className="point-summary">
          <span className="point-badge">P</span>
          <strong>{point.toLocaleString()}</strong>
        </div>
      </header>

      {/* 식단/운동 전환 — 한 "기록" 화면에서 두 기록을 토글 (Cheddar_Team_26 방식) */}
      <div className="record-mode-toggle">
        <button
          type="button"
          className={`record-mode-tab ${mode === "diet" ? "is-active" : ""}`}
          onClick={() => setMode("diet")}
        >
          식단
        </button>
        <button
          type="button"
          className={`record-mode-tab ${mode === "exercise" ? "is-active" : ""}`}
          onClick={() => setMode("exercise")}
        >
          운동
        </button>
      </div>

      {mode === "exercise" ? (
        <Exercise embedded />
      ) : (
      <>
      <section className="diet-page-title">
        <h2>식단 기록</h2>
        <p>AI가 음식 종류와 영양 정보를 분석합니다</p>
        <span className="diet-status-badge">
          {MEAL_TYPES.slice(0, 3).map((t, i) => (
            <span key={t.id}>
              {i > 0 && " · "}
              {t.label} {mealStateLabel(t.id)}
            </span>
          ))}
        </span>
      </section>

      {/* 1. 식사 타입 선택 */}
      <section className="meal-type-grid">
        {MEAL_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`meal-type-card ${selectedMealType === t.id ? "is-selected" : ""}`}
            onClick={() => setSelectedMealType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </section>

      {/* 2. 사진 업로드 카드 — 이미 기록된 끼니면 "완료 + 추가하기"로 전환 */}
      <section className="meal-photo-card">
        {!shouldShowUploadUI ? (
          // 완료 상태: 저장된 사진은 굳이 띄우지 않고 표식 + 추가하기 버튼만
          <div className="meal-upload-area">
            <p className="meal-upload-title">✓ {selectedMealLabel} 기록 완료</p>
            <p className="meal-upload-sub">
              추가 기록하려면 아래 버튼을 누르세요
            </p>
            <button
              type="button"
              className="meal-upload-button"
              onClick={() => setIsAdding(true)}
            >
              추가하기
            </button>
          </div>
        ) : uploadedImagePreview ? (
          <>
            <div className="meal-preview-wrap">
              <img
                src={uploadedImagePreview}
                alt="식단 미리보기"
                className="meal-preview-image"
              />
              <button
                type="button"
                className="meal-preview-remove"
                onClick={handleRemoveImage}
                aria-label="이미지 삭제"
                disabled={isAnalyzing}
              >
                ✕
              </button>
              {isAnalyzing && (
                <div className="meal-analyzing-overlay" role="status" aria-live="polite">
                  <div className="meal-spinner" aria-hidden="true">
                    <span className="meal-spinner-dot" />
                    <span className="meal-spinner-dot" />
                    <span className="meal-spinner-dot" />
                    <span className="meal-spinner-dot" />
                    <span className="meal-spinner-dot" />
                    <span className="meal-spinner-dot" />
                    <span className="meal-spinner-dot" />
                    <span className="meal-spinner-dot" />
                  </div>
                  <p className="meal-analyzing-text">체다가 사진을 분석 중이에요</p>
                </div>
              )}
            </div>
            <div className="meal-photo-actions">
              <label className="meal-upload-relabel">
                다른 사진 가져오기
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  hidden
                />
              </label>
              <button
                type="button"
                className="meal-analyze-button"
                onClick={handleAnalyzeMeal}
                disabled={isAnalyzing || !imageFile}
              >
                {isAnalyzing ? "분석 중..." : "업로드 후 AI분석"}
              </button>
            </div>
          </>
        ) : (
          <div className="meal-upload-area">
            <p className="meal-upload-title">식단 사진을 올려주세요</p>
            <p className="meal-upload-sub">사진을 업로드하면 AI가 자동 분석합니다</p>

            <label className="meal-upload-button">
              사진 업로드
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageUpload}
                hidden
              />
            </label>
          </div>
        )}
      </section>

      {/* 완료 상태에서는 직접 입력 / 분석 결과 / 저장 버튼 모두 숨김 */}
      {shouldShowUploadUI && (
        <>
          {/* 3. 직접 입력 — 메뉴 + 영양 정보 4종 */}
          <section className="meal-manual-input">
            <p className="meal-manual-label">직접 입력</p>

            <label className="manual-field manual-field-full">
              <span className="manual-field-label">메뉴 이름</span>
              <input
                type="text"
                value={manualEntry.menu}
                onChange={(e) => handleManualChange("menu", e.target.value)}
                placeholder="예: 치킨샐러드"
              />
            </label>

            <div className="manual-field-grid">
              <label className="manual-field">
                <span className="manual-field-label">칼로리</span>
                <div className="manual-field-input-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={manualEntry.calories}
                    onChange={(e) => handleManualChange("calories", e.target.value)}
                    placeholder="0"
                  />
                  <span className="manual-field-unit">kcal</span>
                </div>
              </label>

              <label className="manual-field">
                <span className="manual-field-label">단백질</span>
                <div className="manual-field-input-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={manualEntry.protein}
                    onChange={(e) => handleManualChange("protein", e.target.value)}
                    placeholder="0"
                  />
                  <span className="manual-field-unit">g</span>
                </div>
              </label>

              <label className="manual-field">
                <span className="manual-field-label">탄수화물</span>
                <div className="manual-field-input-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={manualEntry.carbs}
                    onChange={(e) => handleManualChange("carbs", e.target.value)}
                    placeholder="0"
                  />
                  <span className="manual-field-unit">g</span>
                </div>
              </label>

              <label className="manual-field">
                <span className="manual-field-label">지방</span>
                <div className="manual-field-input-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={manualEntry.fat}
                    onChange={(e) => handleManualChange("fat", e.target.value)}
                    placeholder="0"
                  />
                  <span className="manual-field-unit">g</span>
                </div>
              </label>
            </div>
          </section>

          {/* 4. AI 분석 결과 카드 — 실제 API 응답 */}
          {analyzeError && (
            <p className="diet-error-text">{analyzeError}</p>
          )}
          {analysis && (
            <section className="ai-result-card" ref={resultRef}>
              <h3 className="ai-result-title">AI 분석 결과</h3>
              <p className="ai-result-summary">{analysis.summary}</p>

              <div className="ai-result-stats">
                <div><span>예상 칼로리</span><strong>{analysis.calories} kcal</strong></div>
                <div><span>단백질</span><strong>{analysis.protein_g} g</strong></div>
                <div><span>탄수화물</span><strong>{analysis.carbs_g} g</strong></div>
                <div><span>지방</span><strong>{analysis.fat_g} g</strong></div>
              </div>

              <p className="ai-result-comment">{analysis.comment}</p>
            </section>
          )}

          {/* 5. 저장 버튼 + 보상 피드백 */}
          <div className="meal-save-wrap">
            <button
              type="button"
              className={`meal-save-button ${showPointReward ? "is-saved" : ""}`}
              onClick={handleSaveMeal}
              disabled={isSaving || showPointReward}
            >
              {isSaving
                ? "저장 중..."
                : showPointReward
                ? "기록 완료!"
                : "식단 기록 저장"}
            </button>

            {showPointReward && (
              <>
                <span className="point-reward-badge">+10P</span>
                <span className="reward-sparkle reward-sparkle-1">✨</span>
                <span className="reward-sparkle reward-sparkle-2">✨</span>
                <span className="reward-sparkle reward-sparkle-3">✨</span>
              </>
            )}
          </div>

          {savedMessage && <p className="saved-toast">{savedMessage}</p>}
        </>
      )}

      {/* 6. 오늘 기록 현황 */}
      </>
      )}
    </div>
  );
}

export default Diet;

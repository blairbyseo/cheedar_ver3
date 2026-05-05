/*5-4. Diet.jsx: App.jsx 파일에 걸림 */
import { useState } from "react";

const MEAL_TYPES = [
  { id: "breakfast", label: "아침" },
  { id: "lunch",     label: "점심" },
  { id: "dinner",    label: "저녁" },
  { id: "snack",     label: "간식" },
];

// 오늘 기록 상태 mock 초기값 — 추후 API 연결 시 교체.
// useState 초기값으로만 사용. 저장 시 해당 식사 타입이 "done" 으로 갱신됨.
const INITIAL_TODAY_STATUS = [
  { id: "breakfast", label: "아침", state: "done"     },
  { id: "lunch",     label: "점심", state: "missing"  },
  { id: "dinner",    label: "저녁", state: "upcoming" },
  { id: "snack",     label: "간식", state: "selected" },
];

const STATE_LABEL = {
  done:     "완료",
  missing:  "미기록",
  upcoming: "예정",
  selected: "선택",
};

function Diet() {
  const point = 1040;

  const [selectedMealType, setSelectedMealType] = useState("lunch");
  const [uploadedImagePreview, setUploadedImagePreview] = useState(null);
  const [manualEntry, setManualEntry] = useState({
    menu: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
  });
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [showPointReward, setShowPointReward] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [todayStatus, setTodayStatus] = useState(INITIAL_TODAY_STATUS);

  const recordedCount = todayStatus.filter((s) => s.state === "done").length;

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImagePreview(reader.result);
      setIsAnalyzed(false); // 새 이미지를 올리면 이전 분석 결과는 초기화
    };
    reader.readAsDataURL(file);
  }

  function handleAnalyzeMeal() {
    // MVP: 실제 AI API 미연결 — mock 결과 카드 표시
    setIsAnalyzed(true);
  }

  // 업로드한 이미지 삭제 — 미리보기 / 분석 결과 모두 초기화.
  // 사진을 빼고 직접 입력만으로 기록할 수 있도록 함.
  function handleRemoveImage() {
    setUploadedImagePreview(null);
    setIsAnalyzed(false);
  }

  function handleManualChange(field, value) {
    setManualEntry((prev) => ({ ...prev, [field]: value }));
  }

  function handleSaveMeal() {
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

    // MVP: 저장 API 미연결 — UI 상태와 보상 피드백만 처리
    const mealLabel =
      MEAL_TYPES.find((m) => m.id === selectedMealType)?.label ?? "";

    setIsSaved(true);
    setShowPointReward(true);
    setSavedMessage(`${mealLabel} 기록 완료! 10P가 적립됐어요`);

    // 선택한 식사 타입을 "완료"로 표시
    setTodayStatus((prev) =>
      prev.map((s) =>
        s.id === selectedMealType ? { ...s, state: "done" } : s
      )
    );

    // 1.7s 후 +10P 배지/반짝이 애니메이션 종료. isSaved/메시지는 유지.
    setTimeout(() => setShowPointReward(false), 1700);
  }

  function handleEditMeal() {
    // 다시 수정할 수 있도록 저장 상태 해제 (오늘 기록 상태는 그대로 둠)
    setIsSaved(false);
    setSavedMessage("");
    setShowPointReward(false);
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

      <section className="diet-page-title">
        <h2>식단 기록</h2>
        <p>AI가 음식 종류와 영양 정보를 분석합니다</p>
        <span className="diet-status-badge">
          오늘 {recordedCount} / {todayStatus.length}개 기록
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

      {/* 2. 사진 업로드 카드 */}
      <section className="meal-photo-card">
        {uploadedImagePreview ? (
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
              >
                ✕
              </button>
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
              >
                업로드 후 AI분석
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

      {/* 4. AI 분석 결과 카드 (mock) */}
      {isAnalyzed && (
        <section className="ai-result-card">
          <h3 className="ai-result-title">AI 분석 결과</h3>
          <p className="ai-result-summary">
            새우버거로 추정돼요
          </p>

          <div className="ai-result-stats">
            <div><span>예상 칼로리</span><strong>520 kcal</strong></div>
            <div><span>단백질</span><strong>32 g</strong></div>
            <div><span>탄수화물</span><strong>68 g</strong></div>
            <div><span>지방</span><strong>14 g</strong></div>
          </div>

          <p className="ai-result-comment">
            단백질은 충분하지만 나트륨 섭취는 조금 주의해보세요
          </p>

        </section>
      )}

      {/* 5. 저장 버튼 + 보상 피드백 */}
      <div className="meal-save-wrap">
        <button
          type="button"
          className={`meal-save-button ${isSaved ? "is-saved" : ""}`}
          onClick={isSaved ? handleEditMeal : handleSaveMeal}
        >
          {showPointReward
            ? "기록 완료!"
            : isSaved
            ? "기록 수정하기"
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

      {/* 6. 오늘 기록 현황 */}

    </div>
  );
}

export default Diet;

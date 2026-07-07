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

// 항목 편집에서 쓰는 단위 후보 (Cheddar_Team_26 단위 규칙 이식).
const UNIT_OPTIONS = ["개", "조각", "공기", "그릇", "컵", "g", "스푼", "장", "마리", "줄"];

// 로컬 item 에 붙일 고유 id 생성기 (React key 용). 브라우저 전용이라 Date.now 사용 가능.
let _itemSeq = 0;
function nextItemId() {
  _itemSeq += 1;
  return `it-${Date.now()}-${_itemSeq}`;
}

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

// 끼니별 시간대 시작 시각 — 현재 시각이 이보다 이르면 아직 '예정'
const MEAL_SLOT_START = { breakfast: 0, lunch: 11, dinner: 17 };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (v) => Math.round(num(v) * 10) / 10;

// API item({name,calories,carbs,protein,fat,quantity,unit,is_ingredient}) → 로컬 편집 item
function toLocalItem(x) {
  return {
    id: nextItemId(),
    name: x.name ?? "",
    calories: num(x.calories),
    carbs: num(x.carbs),
    protein: num(x.protein),
    fat: num(x.fat),
    quantity: x.quantity != null ? num(x.quantity) : 1,
    unit: x.unit || "개",
    isIngredient: x.is_ingredient ?? null,
    needsReestimation: false,
  };
}

// 로컬 편집 item → 백엔드 MealItem 형태
function toApiItem(it) {
  return {
    name: it.name,
    calories: round1(it.calories),
    carbs: round1(it.carbs),
    protein: round1(it.protein),
    fat: round1(it.fat),
    quantity: it.quantity,
    unit: it.unit,
    is_ingredient: it.isIngredient ?? null,
  };
}

// 항목들의 영양소 합계
function sumItems(items) {
  return items.reduce(
    (acc, it) => ({
      calories: acc.calories + num(it.calories),
      carbs: acc.carbs + num(it.carbs),
      protein: acc.protein + num(it.protein),
      fat: acc.fat + num(it.fat),
    }),
    { calories: 0, carbs: 0, protein: 0, fat: 0 }
  );
}

function Diet() {
  // 헤더 우상단 포인트 — 현재 로그인한 환자의 CP
  const point = usePoints()?.cp ?? 0;

  const [selectedMealType, setSelectedMealType] = useState(getInitialMealType);
  const [uploadedImagePreview, setUploadedImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);          // 백엔드 업로드용 원본 파일
  const [mealDescription, setMealDescription] = useState(""); // 분석 힌트용 설명(선택)
  const [manualEntry, setManualEntry] = useState({
    menu: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
  });
  const [analysis, setAnalysis] = useState(null);            // 분석 메타(id/notes/confidence/image_path/suggested_description)
  const [items, setItems] = useState([]);                    // 편집 가능한 음식 항목 배열
  const [deltaText, setDeltaText] = useState("");            // 자연어 수정사항
  const [deltaNote, setDeltaNote] = useState("");            // 수정 반영 결과 메모
  const [isApplyingDelta, setIsApplyingDelta] = useState(false);
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

  // 현재 선택된 끼니의 상태 라벨 — 기록했으면 '완료', 아직 그 시간대 전이면 '예정',
  // 시간대가 지났는데 기록이 없으면 '미기록'.
  const nowHour = new Date().getHours();
  const mealStateLabel = (id) => {
    const state = todayStatus.find((s) => s.id === id)?.state;
    if (state === "done") return "완료";
    if (nowHour < MEAL_SLOT_START[id]) return "예정";
    return "미기록";
  };

  const currentMealStatus = todayStatus.find((s) => s.id === selectedMealType);
  const hasRecord = currentMealStatus?.state === "done";
  const selectedMealLabel = currentMealStatus?.label ?? "";
  const shouldShowUploadUI = !hasRecord || isAdding;

  const didInitRef = useRef(false);
  const resultRef = useRef(null);

  const totals = sumItems(items);
  const hasItems = items.length > 0;

  // 항목이 막 도착했을 때 결과 카드까지 자동 스크롤.
  useEffect(() => {
    if (hasItems) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // hasItems 가 false→true 로 바뀌는 순간만 발화하도록 length 를 dep 으로.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length > 0]);

  // 첫 진입: 오늘 식단 현황 불러오기.
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

  // 끼니 탭을 바꾸면 화면 상태 초기화.
  useEffect(() => {
    resetDraft();
    setIsAdding(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMealType]);

  function resetDraft() {
    setUploadedImagePreview(null);
    setImageFile(null);
    setMealDescription("");
    setAnalysis(null);
    setItems([]);
    setDeltaText("");
    setDeltaNote("");
    setAnalyzeError("");
    setManualEntry({ menu: "", calories: "", protein: "", carbs: "", fat: "" });
    setShowPointReward(false);
    setSavedMessage("");
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setItems([]);
    setAnalysis(null);
    setAnalyzeError("");
    const reader = new FileReader();
    reader.onload = () => setUploadedImagePreview(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleAnalyzeMeal() {
    if (!imageFile || isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzeError("");
    setItems([]);
    setAnalysis(null);
    setDeltaNote("");

    try {
      // multipart/form-data 로 사진 + 끼니 + 설명(선택)을 함께 전달.
      const formData = new FormData();
      formData.append("file", imageFile);
      formData.append("meal_time", selectedMealLabel || "");
      if (mealDescription.trim()) formData.append("description", mealDescription.trim());

      const res = await fetch("/api/meals/analyze", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error(`analyze ${res.status}`);
      const data = await res.json();

      setAnalysis(data);
      setItems((data.items || []).map(toLocalItem));
      if ((data.items || []).length === 0) {
        setAnalyzeError(data.notes || "사진에서 음식을 찾지 못했어요. 다시 시도해주세요.");
      }
    } catch (err) {
      console.error("[Diet] analyze failed:", err);
      setAnalyzeError("분석에 실패했어요. 다시 시도해주세요.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleRemoveImage() {
    setUploadedImagePreview(null);
    setImageFile(null);
    setItems([]);
    setAnalysis(null);
    setAnalyzeError("");
  }

  function handleManualChange(field, value) {
    setManualEntry((prev) => ({ ...prev, [field]: value }));
  }

  // --- 항목 편집 -----------------------------------------------------------

  function updateItemName(id, name) {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, name, needsReestimation: true } : it
      )
    );
  }

  function updateItemUnit(id, unit) {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, unit, needsReestimation: true } : it
      )
    );
  }

  // 수량 증감 — 영양소를 비례로 스케일(저장 시 재추정 불필요). g 는 10, 그 외 0.5 단위.
  function changeItemQty(id, dir) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const step = it.unit === "g" ? 10 : 0.5;
        const nextQty = Math.max(step, round1(it.quantity + dir * step));
        const ratio = it.quantity > 0 ? nextQty / it.quantity : 1;
        return {
          ...it,
          quantity: nextQty,
          calories: round1(it.calories * ratio),
          carbs: round1(it.carbs * ratio),
          protein: round1(it.protein * ratio),
          fat: round1(it.fat * ratio),
        };
      })
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: nextItemId(),
        name: "",
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
        quantity: 1,
        unit: "개",
        isIngredient: null,
        needsReestimation: true,
      },
    ]);
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleApplyDelta() {
    const t = deltaText.trim();
    if (!t || isApplyingDelta) return;
    setIsApplyingDelta(true);
    try {
      const res = await fetch("/api/meals/apply-delta", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map(toApiItem), delta_text: t }),
      });
      if (!res.ok) throw new Error(`delta ${res.status}`);
      const data = await res.json();
      setItems((data.items || []).map(toLocalItem));
      setDeltaText("");
      setDeltaNote(data.notes || "");
    } catch (err) {
      console.error("[Diet] apply-delta failed:", err);
      alert("수정사항 적용에 실패했어요. 다시 시도해주세요.");
    } finally {
      setIsApplyingDelta(false);
    }
  }

  // --- 저장 ---------------------------------------------------------------

  async function handleSaveMeal() {
    if (isSaving) return;
    if (hasItems) {
      await saveWithItems();
    } else {
      await saveManual();
    }
  }

  async function saveWithItems() {
    // 이름 있는 항목만 저장 대상
    const valid = items.filter((it) => it.name.trim());
    if (valid.length === 0) {
      alert("음식 항목을 하나 이상 입력해주세요.");
      return;
    }

    setIsSaving(true);
    try {
      // 이름/단위가 바뀌었거나 새로 추가된 항목은 저장 직전에 영양소 재추정.
      let working = valid;
      const need = valid.filter((it) => it.needsReestimation);
      if (need.length > 0) {
        const results = await Promise.all(
          need.map(async (it) => {
            try {
              const res = await fetch("/api/meals/analyze-item", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: it.name,
                  quantity: it.quantity,
                  unit: it.unit,
                }),
              });
              if (!res.ok) throw new Error(String(res.status));
              return { id: it.id, d: await res.json() };
            } catch {
              return { id: it.id, d: null };
            }
          })
        );
        const byId = Object.fromEntries(results.map((r) => [r.id, r.d]));
        working = valid.map((it) => {
          const d = byId[it.id];
          if (!d) return { ...it, needsReestimation: false };
          return {
            ...it,
            calories: d.calories ?? it.calories,
            carbs: d.carbs ?? it.carbs,
            protein: d.protein ?? it.protein,
            fat: d.fat ?? it.fat,
            needsReestimation: false,
          };
        });
      }

      const t = sumItems(working);
      const menu =
        (analysis?.suggested_description || working.map((i) => i.name).join(", "))
          .slice(0, 120) || null;
      const payload = {
        meal_type: selectedMealType,
        menu,
        calories: Math.round(t.calories),
        protein_g: round1(t.protein),
        carbs_g: round1(t.carbs),
        fat_g: round1(t.fat),
        image_path: analysis?.image_path || null,
        ai_summary: analysis?.suggested_description || null,
        ai_comment: null,
        ai_notes: analysis?.notes || null,
        ai_confidence: analysis?.confidence ?? null,
        items: working.map(toApiItem),
      };

      await postMeal(payload);
    } catch (err) {
      console.error("[Diet] save failed:", err);
      alert("저장에 실패했어요. 다시 시도해주세요.");
      setIsSaving(false);
    }
  }

  // 사진/AI 없이 직접 입력만으로 저장하는 폴백 경로.
  async function saveManual() {
    const nutritionFields = [
      manualEntry.calories,
      manualEntry.protein,
      manualEntry.carbs,
      manualEntry.fat,
    ];
    const filled = nutritionFields.filter((v) => String(v).trim() !== "").length;
    if (filled > 0 && filled < 4) {
      alert("영양 정보 4칸을 모두 입력하거나 모두 비워주세요.");
      return;
    }
    const useManual = filled === 4;
    const payload = {
      meal_type: selectedMealType,
      menu: manualEntry.menu || null,
      calories: useManual ? Number(manualEntry.calories) : null,
      protein_g: useManual ? Number(manualEntry.protein) : null,
      carbs_g: useManual ? Number(manualEntry.carbs) : null,
      fat_g: useManual ? Number(manualEntry.fat) : null,
      image_path: analysis?.image_path || null,
      ai_summary: null,
      ai_comment: null,
    };
    if (!payload.menu && payload.calories == null) {
      alert("사진을 분석하거나 직접 입력해주세요.");
      return;
    }
    setIsSaving(true);
    try {
      await postMeal(payload);
    } catch (err) {
      console.error("[Diet] save failed:", err);
      alert("저장에 실패했어요. 다시 시도해주세요.");
      setIsSaving(false);
    }
  }

  async function postMeal(payload) {
    const res = await fetch("/api/meals", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`save ${res.status}`);

    setShowPointReward(true);
    setSavedMessage(`${selectedMealLabel} 기록 완료! 10P가 적립됐어요`);
    setTodayStatus((prev) =>
      prev.map((s) => (s.id === selectedMealType ? { ...s, state: "done" } : s))
    );
    setTimeout(() => {
      resetDraft();
      setIsAdding(false);
      setIsSaving(false);
    }, 1700);
  }

  return (
    <div className="diet-page">
      <header className="home-header">
        <h1 className="home-logo">Cheddar</h1>
        <div className="point-summary">
          <span className="point-badge">P</span>
          <strong>{point.toLocaleString()}</strong>
        </div>
      </header>

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
            <p>AI가 음식을 항목별로 나눠 영양 정보를 분석합니다</p>
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

          {/* 2. 사진 업로드 카드 */}
          <section className="meal-photo-card">
            {!shouldShowUploadUI ? (
              <div className="meal-upload-area">
                <p className="meal-upload-title">✓ {selectedMealLabel} 기록 완료</p>
                <p className="meal-upload-sub">추가 기록하려면 아래 버튼을 누르세요</p>
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
                      <p className="meal-analyzing-text">체다가 음식을 항목별로 분석 중이에요</p>
                    </div>
                  )}
                </div>
                <div className="meal-photo-actions">
                  <label className="meal-upload-relabel">
                    갤러리
                    <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                  </label>
                  <label className="meal-upload-relabel">
                    재촬영
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
                <p className="meal-upload-sub">사진을 업로드하면 AI가 음식을 하나하나 분석합니다</p>
                <div className="meal-upload-options">
                  <label className="meal-upload-button">
                    갤러리에서 선택
                    <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                  </label>
                  <label className="meal-upload-button">
                    카메라로 촬영
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageUpload}
                      hidden
                    />
                  </label>
                </div>
              </div>
            )}
          </section>

          {shouldShowUploadUI && (
            <>
              {/* 분석 힌트용 설명(선택) — 사진 업로드 후 노출 */}
              {uploadedImagePreview && !hasItems && (
                <section className="meal-desc-input">
                  <label className="manual-field-label" htmlFor="meal-desc">
                    메뉴 설명 (선택) — 적어주면 분석이 더 정확해져요
                  </label>
                  <input
                    id="meal-desc"
                    type="text"
                    value={mealDescription}
                    onChange={(e) => setMealDescription(e.target.value)}
                    placeholder="예: 학교 급식, 공기밥에 제육볶음"
                  />
                </section>
              )}

              {analyzeError && <p className="diet-error-text">{analyzeError}</p>}

              {/* 3-A. AI 분석 결과 — 항목별 편집 플레이트 */}
              {hasItems && (
                <section className="ai-plate" ref={resultRef}>
                  <div className="ai-plate-header">
                    <h3 className="ai-plate-title">오늘의 식단표</h3>
                    <span className="ai-plate-total">
                      총 {Math.round(totals.calories)} kcal
                    </span>
                  </div>

                  {analysis?.confidence != null && (
                    <p className="ai-plate-confidence">
                      AI 인식 신뢰도 {Math.round(analysis.confidence * 100)}%
                    </p>
                  )}

                  <ul className="plate-list">
                    {items.map((it) => (
                      <li key={it.id} className="plate-item">
                        <div className="plate-item-top">
                          <input
                            className="plate-item-name"
                            type="text"
                            value={it.name}
                            onChange={(e) => updateItemName(it.id, e.target.value)}
                            placeholder="음식 이름"
                          />
                          <button
                            type="button"
                            className="plate-item-delete"
                            onClick={() => removeItem(it.id)}
                            aria-label="항목 삭제"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="plate-item-controls">
                          <div className="qty-stepper">
                            <button
                              type="button"
                              className="qty-btn"
                              onClick={() => changeItemQty(it.id, -1)}
                              aria-label="수량 감소"
                            >
                              −
                            </button>
                            <span className="qty-value">{round1(it.quantity)}</span>
                            <button
                              type="button"
                              className="qty-btn"
                              onClick={() => changeItemQty(it.id, +1)}
                              aria-label="수량 증가"
                            >
                              +
                            </button>
                          </div>
                          <select
                            className="unit-select"
                            value={UNIT_OPTIONS.includes(it.unit) ? it.unit : "개"}
                            onChange={(e) => updateItemUnit(it.id, e.target.value)}
                          >
                            {UNIT_OPTIONS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </div>

                        <p className="plate-item-macros">
                          {it.needsReestimation ? (
                            <span className="plate-item-reest">
                              저장 시 {round1(it.quantity)}{it.unit} 기준으로 재계산돼요
                            </span>
                          ) : (
                            <>
                              {Math.round(it.calories)}kcal · 탄 {round1(it.carbs)}g · 단{" "}
                              {round1(it.protein)}g · 지 {round1(it.fat)}g
                            </>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>

                  <button type="button" className="plate-add-btn" onClick={addItem}>
                    + 음식 추가
                  </button>

                  {/* 자연어 수정사항 */}
                  <div className="delta-box">
                    <label className="manual-field-label" htmlFor="delta-input">
                      수정사항을 문장으로 알려주세요
                    </label>
                    <div className="delta-row">
                      <input
                        id="delta-input"
                        className="delta-input"
                        type="text"
                        value={deltaText}
                        onChange={(e) => setDeltaText(e.target.value)}
                        placeholder="예: 공기밥 반만 먹었어, 깍두기 30g 추가"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleApplyDelta();
                        }}
                      />
                      <button
                        type="button"
                        className="delta-apply"
                        onClick={handleApplyDelta}
                        disabled={isApplyingDelta || !deltaText.trim()}
                      >
                        {isApplyingDelta ? "적용 중..." : "적용"}
                      </button>
                    </div>
                    {deltaNote && <p className="delta-note">{deltaNote}</p>}
                  </div>
                </section>
              )}

              {/* 3-B. 직접 입력 — 항목이 없을 때만 노출 */}
              {!hasItems && (
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
              )}

              {/* 4. 저장 버튼 + 보상 피드백 */}
              <div className="meal-save-wrap">
                <button
                  type="button"
                  className={`meal-save-button ${showPointReward ? "is-saved" : ""}`}
                  onClick={handleSaveMeal}
                  disabled={isSaving || showPointReward}
                >
                  {isSaving ? "저장 중..." : showPointReward ? "기록 완료!" : "식단 기록 저장"}
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
        </>
      )}
    </div>
  );
}

export default Diet;

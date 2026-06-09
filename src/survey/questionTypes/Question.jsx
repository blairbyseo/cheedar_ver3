/* Question — schema_json 의 question 한 개를 그리는 dispatcher.
 *
 * question.type 별로 적절한 입력 컴포넌트를 선택한다. 새 타입 추가 시
 * 백엔드 v3_schema.json 의 question_types 와 여기 switch 양쪽 모두 업데이트.
 */
import { BmiInput } from "./BmiInput.jsx";
import { Composite } from "./Composite.jsx";
import { ChecklistWithFrequency } from "./ChecklistWithFrequency.jsx";

// ---------- 단순 입력 컴포넌트들 ----------

function ScaleSlider({ question, value, onChange, disabled }) {
  const labels = question.labels || {};
  const current = typeof value === "number" ? value : 5;
  return (
    <div className="survey-scale">
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="survey-range"
      />
      <div className="survey-scale-labels">
        <span>{labels["0"] ?? "0"}</span>
        <span className="survey-scale-value">{current}</span>
        <span>{labels["10"] ?? "10"}</span>
      </div>
    </div>
  );
}

const LIKERT_LABELS = ["없음", "가끔", "자주", "거의 매일"];

function LikertScale({ question, value, onChange, disabled }) {
  const labels = question.labels || LIKERT_LABELS;
  return (
    <div className="survey-likert">
      {[0, 1, 2, 3].map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            className={`survey-likert-btn${selected ? " is-selected" : ""}`}
          >
            <span className="survey-likert-num">{n}</span>
            <span className="survey-likert-label">{labels[n]}</span>
          </button>
        );
      })}
    </div>
  );
}

function YesNo({ value, onChange, disabled }) {
  return (
    <div className="survey-yesno">
      {[
        { v: "yes", label: "예" },
        { v: "no", label: "아니오" },
      ].map((opt) => {
        const selected = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.v)}
            className={`survey-choice survey-choice--half${selected ? " is-selected" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SingleSelect({ question, value, onChange, disabled }) {
  const options = question.options || [];
  return (
    <div className="survey-options">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`survey-choice survey-choice--block${selected ? " is-selected" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MultiSelect({ question, value, onChange, disabled }) {
  const options = question.options || [];
  const selectedSet = new Set(Array.isArray(value) ? value : []);
  const toggle = (v) => {
    const next = new Set(selectedSet);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };
  return (
    <div className="survey-chips">
      {options.map((opt) => {
        const selected = selectedSet.has(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => toggle(opt.value)}
            className={`survey-chip${selected ? " is-selected" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function NumericInput({ question, value, onChange, disabled }) {
  const unit = question.unit;
  return (
    <div className="survey-numeric">
      <input
        type="number"
        inputMode={question.integer ? "numeric" : "decimal"}
        min={question.min}
        max={question.max}
        step={question.integer ? 1 : "any"}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        className="survey-input survey-input--num"
      />
      {unit && <span className="survey-unit">{unit}</span>}
      {question.allow_unknown && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(question.unknown_label || "unknown")}
          className="survey-unknown-btn"
        >
          {question.unknown_label || "잘 기억 안 남"}
        </button>
      )}
    </div>
  );
}

function FreeText({ question, value, onChange, disabled }) {
  return (
    <textarea
      value={value ?? ""}
      maxLength={question.max_length}
      disabled={disabled}
      rows={3}
      onChange={(e) => onChange(e.target.value)}
      className="survey-input survey-textarea"
    />
  );
}

function TimeInput({ value, onChange, disabled }) {
  return (
    <input
      type="time"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="survey-input survey-input--time"
    />
  );
}

// ---------- Dispatcher ----------

export function Question({ question, value, onChange, disabled }) {
  const common = { question, value, onChange, disabled };
  switch (question.type) {
    case "scale_0_10":
      return <ScaleSlider {...common} />;
    case "likert_0_3":
      return <LikertScale {...common} />;
    case "yes_no":
      return <YesNo {...common} />;
    case "single_select":
      return <SingleSelect {...common} />;
    case "multi_select":
      return <MultiSelect {...common} />;
    case "numeric":
      return <NumericInput {...common} />;
    case "free_text":
      return <FreeText {...common} />;
    case "time":
      return <TimeInput {...common} />;
    case "composite":
      return <Composite {...common} />;
    case "bmi":
      return <BmiInput {...common} />;
    case "checklist_with_frequency":
      return <ChecklistWithFrequency {...common} />;
    default:
      return (
        <div className="survey-unknown-type">
          알 수 없는 문항 타입: {question.type}
        </div>
      );
  }
}

export default Question;

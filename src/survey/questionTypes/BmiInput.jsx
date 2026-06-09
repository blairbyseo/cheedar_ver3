/* BmiInput — B-1 키/몸무게 입력 + BMI 자동 계산.
 *
 * value: { height: number, weight: number } | undefined
 */
import { useMemo } from "react";

export function BmiInput({ value, onChange, disabled }) {
  const height = value?.height ?? "";
  const weight = value?.weight ?? "";

  const bmi = useMemo(() => {
    const h = Number(height);
    const w = Number(weight);
    if (!h || !w) return null;
    const m = h / 100;
    return (w / (m * m)).toFixed(1);
  }, [height, weight]);

  const update = (key, raw) => {
    const next = raw === "" ? undefined : Number(raw);
    onChange({ ...(value || {}), [key]: next });
  };

  return (
    <div className="survey-bmi">
      <div className="survey-bmi-row">
        <label className="survey-bmi-field">
          <span className="survey-field-label">키 (cm)</span>
          <input
            type="number"
            inputMode="decimal"
            min={50}
            max={250}
            value={height}
            disabled={disabled}
            onChange={(e) => update("height", e.target.value)}
            className="survey-input"
          />
        </label>
        <label className="survey-bmi-field">
          <span className="survey-field-label">몸무게 (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            min={10}
            max={300}
            value={weight}
            disabled={disabled}
            onChange={(e) => update("weight", e.target.value)}
            className="survey-input"
          />
        </label>
      </div>
      {bmi !== null && (
        <div className="survey-bmi-result">
          BMI: <strong>{bmi}</strong>
        </div>
      )}
    </div>
  );
}

export default BmiInput;

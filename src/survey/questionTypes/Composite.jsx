/* Composite — 여러 sub-field 를 한 문항으로 묶음 (예: A-7 취침/기상 시간).
 *
 * question.fields: [{id, type, label}] — 현재는 type==="time" 위주.
 * value: { sub_id: value, ... } | undefined
 */
export function Composite({ question, value, onChange, disabled }) {
  const fields = question.fields || [];

  const update = (subId, raw) => {
    onChange({ ...(value || {}), [subId]: raw });
  };

  return (
    <div className="survey-composite">
      {fields.map((field) => (
        <label key={field.id} className="survey-composite-field">
          <span className="survey-composite-label">{field.label}</span>
          <input
            type={field.type === "time" ? "time" : "text"}
            value={value?.[field.id] ?? ""}
            disabled={disabled}
            onChange={(e) => update(field.id, e.target.value)}
            className="survey-input"
          />
        </label>
      ))}
    </div>
  );
}

export default Composite;

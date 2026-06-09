/* ChecklistWithFrequency — C-10 (살이 찌지 않게 하려고 한 행동) 전용.
 *
 * question.rows: [{id, label, tier}]
 * question.frequency_max: int (디폴트 7)
 *
 * value: { rows: { row_id: { checked: boolean, frequency: number } } }
 */
export function ChecklistWithFrequency({ question, value, onChange, disabled }) {
  const rows = question.rows || [];
  const max = question.frequency_max ?? 7;
  const current = value?.rows || {};

  const update = (rowId, patch) => {
    const nextRow = {
      ...(current[rowId] || { checked: false, frequency: 0 }),
      ...patch,
    };
    // 체크 해제 시 빈도 0 으로 리셋
    if (patch.checked === false) {
      nextRow.frequency = 0;
    }
    onChange({ rows: { ...current, [rowId]: nextRow } });
  };

  return (
    <ul className="survey-checklist">
      {rows.map((row) => {
        const rowVal = current[row.id] || { checked: false, frequency: 0 };
        return (
          <li key={row.id} className="survey-checklist-row">
            <input
              type="checkbox"
              checked={Boolean(rowVal.checked)}
              disabled={disabled}
              onChange={(e) => update(row.id, { checked: e.target.checked })}
              className="survey-checkbox"
            />
            <span className="survey-checklist-label">{row.label}</span>
            <label className="survey-checklist-freq">
              <span>주</span>
              <input
                type="number"
                min={0}
                max={max}
                step={1}
                value={rowVal.frequency ?? 0}
                disabled={disabled || !rowVal.checked}
                onChange={(e) =>
                  update(row.id, {
                    frequency: Math.max(
                      0,
                      Math.min(max, Number(e.target.value) || 0),
                    ),
                  })
                }
                className="survey-freq-input"
              />
              <span>일</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default ChecklistWithFrequency;

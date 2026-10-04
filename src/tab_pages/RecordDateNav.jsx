/* RecordDateNav.jsx: 식단/운동 기록 화면 상단의 날짜 이동 바.
 *
 *  ‹  9월 27일 (토) · 어제  ›      [오늘로]
 *
 * 최근 BACKFILL_DAYS 일 ~ 오늘 사이에서만 움직인다. 날짜 상태는 부모(Diet)가 들고 있어
 * 식단/운동 토글을 오가도 같은 날짜가 유지된다.
 */
import {
  addDays,
  dayWord,
  formatDateLabel,
  oldestRecordDateStr,
  todayStr,
} from "../utils/recordDate";

function RecordDateNav({ value, onChange, disabled = false }) {
  const today = todayStr();
  const isToday = value === today;
  const canPrev = !disabled && value > oldestRecordDateStr();
  const canNext = !disabled && value < today;
  const word = dayWord(value);

  return (
    <div className="record-date-nav">
      <button
        type="button"
        className="record-date-arrow"
        onClick={() => onChange(addDays(value, -1))}
        disabled={!canPrev}
        aria-label="이전 날짜"
      >
        ‹
      </button>
      <div className="record-date-center">
        <span className="record-date-label">{formatDateLabel(value)}</span>
        {(isToday || word === "어제") && (
          <span className={`record-date-chip ${isToday ? "is-today" : ""}`}>{word}</span>
        )}
      </div>
      <button
        type="button"
        className="record-date-arrow"
        onClick={() => onChange(addDays(value, 1))}
        disabled={!canNext}
        aria-label="다음 날짜"
      >
        ›
      </button>
      {!isToday && (
        <button
          type="button"
          className="record-date-today"
          onClick={() => onChange(today)}
          disabled={disabled}
        >
          오늘로
        </button>
      )}
    </div>
  );
}

export default RecordDateNav;

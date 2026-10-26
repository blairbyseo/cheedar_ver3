/* RecordDateNav.jsx: 식단/운동 기록 화면 상단의 날짜 이동 바.
 *
 *  ‹     9월 27일 (토) [어제] ⌄     ›
 *               [오늘로]
 *
 * 지난 날짜로는 제한 없이 이동한다(지난 식단 보기). 다만 기록은 최근 BACKFILL_DAYS 일까지만
 * 되므로 그보다 지난 날은 부모 화면이 보기 전용으로 그린다(isViewOnlyDate).
 * 가운데 날짜를 누르면 기기 달력이 떠서 먼 날짜로 바로 갈 수 있다.
 * 날짜 상태는 부모(Diet)가 들고 있어 식단/운동 토글을 오가도 같은 날짜가 유지된다.
 */
import { ChevronDown } from "lucide-react";
import {
  addDays,
  dayWord,
  formatDateLabel,
  isLateRecord,
  isViewOnlyDate,
  todayStr,
} from "../utils/recordDate";

function RecordDateNav({ value, onChange, disabled = false }) {
  const today = todayStr();
  const isToday = value === today;
  const canPrev = !disabled;
  const canNext = !disabled && value < today;
  const word = dayWord(value);
  const viewOnly = isViewOnlyDate(value);

  return (
    <>
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
      {/* 날짜(+오늘/어제 표시)는 ‹ › 사이 정가운데. '오늘로' 버튼은 그 아래 작은 줄로 —
          한 줄에 같이 두면 360px 폭에서 날짜가 왼쪽으로 밀린다. */}
      <div className="record-date-center">
        <span className="record-date-label">
          {formatDateLabel(value)}
          {(isToday || word === "어제") && (
            <span className={`record-date-chip ${isToday ? "is-today" : ""}`}>{word}</span>
          )}
          <ChevronDown className="record-date-caret" size={18} strokeWidth={2.4} aria-hidden="true" />
        </span>
        {/* 날짜를 누르면 기기 달력 — 투명한 date 입력을 가운데 영역 위에 겹쳐 둔다 */}
        <input
          type="date"
          className="record-date-picker"
          value={value}
          max={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          disabled={disabled}
          aria-label="날짜 선택"
        />
        {!isToday && (
          <div className="record-date-sub">
            <button
              type="button"
              className="record-date-today"
              onClick={() => onChange(today)}
              disabled={disabled}
            >
              오늘로
            </button>
          </div>
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
    </div>
    {/* 7일이 지난 날은 기록 자체를 못 하므로 포인트 안내도 띄우지 않는다 */}
    {!viewOnly && isLateRecord(value) && (
      <p className="record-date-note">지난 기록은 포인트가 절반만 적립돼요</p>
    )}
    </>
  );
}

export default RecordDateNav;

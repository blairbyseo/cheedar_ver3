/*5-7. WeeklyReport.jsx: 홈의 "주간 피드백 리포트" 카드에서 진입하는 주간 리포트 화면.
 *
 * Cheddar_Team_26 의 WeeklyReport 를 참고했으나, 그 구현은 Tailwind·recharts·
 * 운동 기록 등 이 프로젝트엔 없는 의존성을 쓰므로 내용만 가져와 현재 스택
 * (순수 CSS + FastAPI /api/meals)에 맞게 새로 작성했다.
 *
 * 동작:
 *  - 이번 주(월~일) 7일의 식단을 GET /api/meals?on=YYYY-MM-DD 로 각각 조회.
 *  - 총 섭취 칼로리·영양소(탄/단/지)와 일평균, 요일별 기록 현황, 기록 일수와
 *    달성률을 계산해 보여준다. (운동 데이터는 백엔드에 없어 제외)
 *  - 랭킹 화면과 같은 onBack 패턴 — 자체 뒤로가기로 홈으로 돌아간다.
 */
import { useEffect, useState } from "react";

// 요일별 기록 원형의 채움 기준이 되는 주요 3끼
const MAIN_MEALS = ["breakfast", "lunch", "dinner"];
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

// Date → "YYYY-MM-DD" (로컬 기준). toISOString 은 UTC라 날짜가 밀릴 수 있어 직접 만든다.
function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 이번 주 월요일을 기준으로 월~일 7일의 Date 배열을 만든다.
function thisWeekDates() {
  const now = new Date();
  const offsetToMonday = (now.getDay() + 6) % 7; // 일(0)→6, 월(1)→0 …
  const monday = new Date(now);
  monday.setDate(now.getDate() - offsetToMonday);
  monday.setHours(0, 0, 0, 0);
  return WEEKDAYS.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const num = (v) => Number(v) || 0; // null/undefined/문자열 방어

function WeeklyReport({ onBack }) {
  // perDay: [{ date, label(월..), dateNum, meals: Set(meal_type), mealCount(주요 3끼), hasExercise }]
  const [perDay, setPerDay] = useState([]);
  const [totals, setTotals] = useState({ kcal: 0, carbs: 0, protein: 0, fat: 0 });
  // 운동 합계 — 총 소모 칼로리, 총 운동 시간(분), 운동한 날 수
  const [exercise, setExercise] = useState({ burned: 0, minutes: 0, days: 0 });
  const [status, setStatus] = useState("loading"); // loading | ok | error

  const dates = thisWeekDates();
  const rangeStart = dates[0];
  const rangeEnd = dates[6];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const days = thisWeekDates();
        // 7일치 식단 + 운동을 병렬로 조회
        const results = await Promise.all(
          days.map(async (d) => {
            const ds = toLocalDateStr(d);
            const [mealsRes, exRes] = await Promise.all([
              fetch(`/api/meals?on=${ds}`, { credentials: "include" }),
              fetch(`/api/exercise?on=${ds}`, { credentials: "include" }),
            ]);
            if (!mealsRes.ok) throw new Error(`meals ${mealsRes.status}`);
            if (!exRes.ok) throw new Error(`exercise ${exRes.status}`);
            return {
              date: d,
              meals: await mealsRes.json(),
              exercise: await exRes.json(), // 0~1건 배열
            };
          })
        );
        if (cancelled) return;

        const sums = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
        const exTotals = { burned: 0, minutes: 0, days: 0 };
        const rows = results.map(({ date, meals, exercise: exRows }) => {
          const types = new Set();
          for (const m of meals) {
            types.add(m.meal_type);
            sums.kcal += num(m.calories);
            sums.carbs += num(m.carbs_g);
            sums.protein += num(m.protein_g);
            sums.fat += num(m.fat_g);
          }
          const mealCount = MAIN_MEALS.filter((t) => types.has(t)).length;

          // 그날 운동 기록(있으면 한 건). is_skipped 가 아니고 운동 항목이 있으면 운동한 날.
          const exLog = exRows[0];
          const exItems = (exLog && !exLog.is_skipped && exLog.items) || [];
          const dayMinutes = exItems.reduce(
            (acc, it) => acc + num(it.duration_hours) * 60 + num(it.duration_minutes),
            0
          );
          const hasExercise = exItems.length > 0;
          if (hasExercise) {
            exTotals.burned += num(exLog.calories_burned);
            exTotals.minutes += dayMinutes;
            exTotals.days += 1;
          }

          return {
            date,
            label: WEEKDAYS[(date.getDay() + 6) % 7],
            dateNum: date.getDate(),
            types,
            mealCount,
            hasExercise,
          };
        });

        setPerDay(rows);
        setTotals(sums);
        setExercise(exTotals);
        setStatus("ok");
      } catch (err) {
        console.error("[WeeklyReport] load failed:", err);
        if (!cancelled) setStatus("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // 기록한 날 = 주요 끼니 중 하나라도 기록된 날 (간식만 있어도 기록으로 인정)
  const recordedDays = perDay.filter((d) => d.types.size > 0).length;
  const achievePct = perDay.length
    ? Math.round((recordedDays / perDay.length) * 100)
    : 0;

  const todayStr = toLocalDateStr(new Date());

  return (
    <div className="report-page">
      <header className="report-header">
        <button
          type="button"
          className="report-back"
          onClick={onBack}
          aria-label="뒤로 가기"
        >
          ‹
        </button>
        <div className="report-headtext">
          <h1 className="report-title">이번 주 리포트</h1>
          <p className="report-range">
            {rangeStart.getMonth() + 1}월 {rangeStart.getDate()}일 ~ {rangeEnd.getMonth() + 1}월 {rangeEnd.getDate()}일
          </p>
        </div>
        <span className="report-header-spacer" aria-hidden="true" />
      </header>

      {status === "loading" && (
        <p className="report-state">리포트를 불러오는 중…</p>
      )}
      {status === "error" && (
        <p className="report-state">리포트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>
      )}

      {status === "ok" && (
        <>
          {/* 총 섭취 칼로리 + 일평균 */}
          <section className="report-kcal-card">
            <p className="report-kcal-label">이번 주 총 섭취 칼로리</p>
            <p className="report-kcal-value">
              {Math.round(totals.kcal).toLocaleString()}
              <span className="report-kcal-unit">kcal</span>
            </p>
            <p className="report-kcal-avg">
              일평균 {Math.round(totals.kcal / (perDay.length || 7)).toLocaleString()}kcal
            </p>
          </section>

          {/* 요일별 기록 — 주요 3끼 기준 원형, 기록한 끼니 칩 */}
          <section className="report-section">
            <h2 className="report-section-title">요일별 기록</h2>
            <div className="report-week-row">
              {perDay.map((d) => {
                const isToday = toLocalDateStr(d.date) === todayStr;
                const full = d.mealCount >= 3;
                return (
                  <div className="report-day" key={d.dateNum + d.label}>
                    <span className="report-day-label">{d.label}</span>
                    <div
                      className={
                        "report-day-circle" +
                        (full ? " full" : d.mealCount > 0 ? " partial" : "") +
                        (isToday ? " today" : "")
                      }
                    >
                      {full ? "✓" : d.mealCount > 0 ? `${d.mealCount}/3` : ""}
                    </div>
                    {/* 운동한 날 표시 */}
                    <span className="report-day-exercise" aria-label={d.hasExercise ? "운동함" : ""}>
                      {d.hasExercise ? "🏃" : ""}
                    </span>
                    <span className="report-day-date">{d.dateNum}</span>
                  </div>
                );
              })}
            </div>
            <p className="report-section-footer">
              7일 중 <strong>{recordedDays}일</strong> 기록 ({achievePct}%)
            </p>
          </section>

          {/* 영양소 통계 — 총합 + 일평균 */}
          {(totals.carbs > 0 || totals.protein > 0 || totals.fat > 0) && (
            <section className="report-section">
              <h2 className="report-section-title">영양소 통계</h2>
              <div className="report-nutri-grid">
                <div className="report-nutri-item carbs">
                  <p className="report-nutri-label">탄수화물</p>
                  <p className="report-nutri-value">{Math.round(totals.carbs)}</p>
                  <p className="report-nutri-unit">g (총합)</p>
                </div>
                <div className="report-nutri-item protein">
                  <p className="report-nutri-label">단백질</p>
                  <p className="report-nutri-value">{Math.round(totals.protein)}</p>
                  <p className="report-nutri-unit">g (총합)</p>
                </div>
                <div className="report-nutri-item fat">
                  <p className="report-nutri-label">지방</p>
                  <p className="report-nutri-value">{Math.round(totals.fat)}</p>
                  <p className="report-nutri-unit">g (총합)</p>
                </div>
              </div>
              <div className="report-nutri-avg">
                <div>
                  <p className="report-nutri-avg-value">
                    {Math.round(totals.carbs / (perDay.length || 7))}g
                  </p>
                  <p className="report-nutri-avg-label">일평균</p>
                </div>
                <div>
                  <p className="report-nutri-avg-value">
                    {Math.round(totals.protein / (perDay.length || 7))}g
                  </p>
                  <p className="report-nutri-avg-label">일평균</p>
                </div>
                <div>
                  <p className="report-nutri-avg-value">
                    {Math.round(totals.fat / (perDay.length || 7))}g
                  </p>
                  <p className="report-nutri-avg-label">일평균</p>
                </div>
              </div>
            </section>
          )}

          {/* 운동 통계 — 운동 기록이 있을 때만 */}
          {exercise.days > 0 && (
            <section className="report-section">
              <h2 className="report-section-title">운동 통계</h2>
              <div className="report-nutri-grid">
                <div className="report-nutri-item burn">
                  <p className="report-nutri-label">소모 칼로리</p>
                  <p className="report-nutri-value">{Math.round(exercise.burned)}</p>
                  <p className="report-nutri-unit">kcal (총합)</p>
                </div>
                <div className="report-nutri-item time">
                  <p className="report-nutri-label">운동 시간</p>
                  <p className="report-nutri-value">
                    {Math.floor(exercise.minutes / 60)}
                    <span className="report-nutri-sub">시간</span>
                    {exercise.minutes % 60}
                    <span className="report-nutri-sub">분</span>
                  </p>
                  <p className="report-nutri-unit">(총합)</p>
                </div>
                <div className="report-nutri-item days">
                  <p className="report-nutri-label">운동한 날</p>
                  <p className="report-nutri-value">{exercise.days}</p>
                  <p className="report-nutri-unit">일 / 7일</p>
                </div>
              </div>
              <p className="report-section-footer">
                일평균 <strong>{Math.round(exercise.minutes / (perDay.length || 7))}분</strong>
                {" · "}
                소모 {Math.round(exercise.burned / (perDay.length || 7))}kcal
              </p>
            </section>
          )}

          {/* 아무 기록도 없을 때 안내 */}
          {recordedDays === 0 && exercise.days === 0 && (
            <p className="report-state">
              이번 주 기록이 아직 없어요. 식단이나 운동을 기록하면 리포트가 채워져요!
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default WeeklyReport;

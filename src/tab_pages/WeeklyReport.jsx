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

const weekLabel = (n) => (n === 0 ? "이번 주" : n === 1 ? "지난 주" : `${n}주 전`);

// 막대 높이(%) — 0 이어도 바닥선이 보이게 최소 2%
const barPct = (v, max) => (max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 2);

// 체다의 한마디 — 이번 주 기록에 대한 AI 피드백(GET /api/reports/weekly-feedback).
// 서버가 하루 한 번만 만들어 저장해 두므로 화면을 여러 번 열어도 AI 를 다시 부르지 않는다.
function WeeklyFeedback() {
  const [message, setMessage] = useState("");
  const [state, setState] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/weekly-feedback", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`weekly-feedback ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMessage(data.message);
        setState("ok");
      })
      .catch((err) => {
        console.error("[WeeklyReport] feedback load failed:", err);
        if (!cancelled) setState("error");
      });
    return () => { cancelled = true; };
  }, []);

  if (state === "error") return null;

  return (
    <section className="report-feedback">
      <img src="/cheese/happy_smile.svg" alt="" className="report-feedback-mascot" />
      <div className="report-feedback-body">
        <p className="report-feedback-title">체다의 한마디</p>
        <p className={`report-feedback-text${state === "loading" ? " is-loading" : ""}`}>
          {state === "loading" ? "체다가 이번 주를 돌아보는 중이에요…" : message}
        </p>
      </div>
    </section>
  );
}

// 최근 4주 비교 — 옛 웹의 '주간 비교 그래프' 이식. 집계는 서버(GET /api/reports/weekly-compare)가
// 한 번에 해 준다. 그래프는 라이브러리 없이 CSS 막대로 그린다.
function WeeklyCompare() {
  const [weeks, setWeeks] = useState([]);
  const [state, setState] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/weekly-compare?weeks=4", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`weekly-compare ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setWeeks(data);
        setState("ok");
      })
      .catch((err) => {
        console.error("[WeeklyReport] compare load failed:", err);
        if (!cancelled) setState("error");
      });
    return () => { cancelled = true; };
  }, []);

  if (state === "error") return null;

  const maxSnack = Math.max(0, ...weeks.map((w) => w.snack_count));
  const maxKcal = Math.max(0, ...weeks.map((w) => w.avg_calories));

  // 한 주에 막대 여러 개(series) 를 나란히 그린다.
  const chart = (series, max, unit) => (
    <div className="cmp-chart">
      {weeks.map((w) => (
        <div className={`cmp-group${w.weeks_ago === 0 ? " is-current" : ""}`} key={w.week_start}>
          <div className="cmp-bars">
            {series.map(({ key, cls }) => (
              <div className="cmp-bar-col" key={key}>
                <span className="cmp-val">{w[key].toLocaleString()}</span>
                <div
                  className={`cmp-bar ${cls}`}
                  style={{ height: `${barPct(w[key], max)}%` }}
                  aria-label={`${weekLabel(w.weeks_ago)} ${w[key]}${unit}`}
                />
              </div>
            ))}
          </div>
          <span className="cmp-label">{weekLabel(w.weeks_ago)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <section className="report-section">
      <h2 className="report-section-title">최근 4주 비교</h2>
      {state === "loading" ? (
        <p className="report-section-footer">불러오는 중…</p>
      ) : (
        <>
          <div className="cmp-legend">
            <span><i className="cmp-dot recorded" />기록한 날</span>
            <span><i className="cmp-dot meals" />3끼 다 먹은 날</span>
            <span><i className="cmp-dot exercise" />운동한 날</span>
          </div>
          {chart(
            [
              { key: "recorded_days", cls: "recorded" },
              { key: "three_meal_days", cls: "meals" },
              { key: "exercise_days", cls: "exercise" },
            ],
            7,
            "일"
          )}

          <p className="cmp-subtitle">간식 횟수 (회/주)</p>
          {chart([{ key: "snack_count", cls: "snack" }], maxSnack, "회")}

          <p className="cmp-subtitle">기록한 날 평균 섭취 칼로리 (kcal)</p>
          {chart([{ key: "avg_calories", cls: "kcal" }], maxKcal, "kcal")}

          <p className="report-section-footer">이번 주는 오늘까지의 기록이에요</p>
        </>
      )}
    </section>
  );
}

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
          let dayKcal = 0;
          for (const m of meals) {
            types.add(m.meal_type);
            dayKcal += num(m.calories);
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
            dayKcal,
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

  // 식단 일평균은 '기록한 날' 기준 — 7로 나누면 하루만 기록해도 평균이 낮게 보여
  // "적게 먹었다"는 인상을 준다. 칼로리는 칼로리가 기록된 날로, 영양소는 식단을 기록한 날로 나눈다.
  const kcalDays = perDay.filter((d) => d.dayKcal > 0).length || 1;
  const foodDays = recordedDays || 1;

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
          <WeeklyFeedback />

          {/* 총 섭취 칼로리 + 일평균 */}
          <section className="report-kcal-card">
            <p className="report-kcal-label">이번 주 총 섭취 칼로리</p>
            <p className="report-kcal-value">
              {Math.round(totals.kcal).toLocaleString()}
              <span className="report-kcal-unit">kcal</span>
            </p>
            <p className="report-kcal-avg">
              기록한 날 평균 {Math.round(totals.kcal / kcalDays).toLocaleString()}kcal
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
                    {Math.round(totals.carbs / foodDays)}g
                  </p>
                  <p className="report-nutri-avg-label">기록한 날 평균</p>
                </div>
                <div>
                  <p className="report-nutri-avg-value">
                    {Math.round(totals.protein / foodDays)}g
                  </p>
                  <p className="report-nutri-avg-label">기록한 날 평균</p>
                </div>
                <div>
                  <p className="report-nutri-avg-value">
                    {Math.round(totals.fat / foodDays)}g
                  </p>
                  <p className="report-nutri-avg-label">기록한 날 평균</p>
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

          <WeeklyCompare />
        </>
      )}
    </div>
  );
}

export default WeeklyReport;

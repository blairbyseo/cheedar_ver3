/* 홈 '수면' 카드 — 결과만 보여 준다(안드로이드 앱). 2026-11-08 사용자 결정으로 단순화.
 *
 * 켜기는 홈 팝업(HealthInvite)의 [허용] 한 번, 끄기는 설정 → 건강 데이터.
 * 측정은 '매일 밤 자동'(SleepRecordService) — 밤에 스스로 시작, 아침 첫 잠금 해제에 끝.
 * 그래서 홈에는 어젯밤 결과(또는 지금 재는 중)만 한 줄로 보여 주고, 아무것도 없으면 카드를 숨긴다.
 * 결과는 숫자와 시각만 보여 준다(설명 문구 없이 — 2026-11-08 사용자 결정). 평가·목표도 없이 사실만.
 */
import { useEffect, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { SLEEP_UPDATED_EVENT, getSleepStatus, loadLastSleepResult } from "./sleepSound";
import "./SleepMeasure.css";

function hhmm(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** 오늘 오후 1시 전에 끝난 결과면 "어젯밤", 아니면 날짜(예: "11월 8일"). */
function nightLabel(result) {
  const end = new Date(result.wake_end);
  const now = new Date();
  if (end.toDateString() === now.toDateString() && end.getHours() < 13) return "어젯밤";
  return `${end.getMonth() + 1}월 ${end.getDate()}일`;
}

export default function SleepMeasureCard() {
  const [status, setStatus] = useState(null);
  const [last, setLast] = useState(loadLastSleepResult);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getSleepStatus()
        .then((s) => {
          if (!alive) return;
          setStatus(s);
          setLast(loadLastSleepResult());
        })
        .catch((err) => console.error("[SleepCard] 상태 확인 실패:", err));
    load();
    // 밤사이 자동 측정이 끝나 결과가 올라왔으면 앱으로 돌아올 때 다시 읽는다
    const sub = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) load();
    });
    window.addEventListener(SLEEP_UPDATED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(SLEEP_UPDATED_EVENT, load);
      sub.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  const running = !!status?.running;
  if (!running && !last) return null;

  return (
    <section className="sleep-card" aria-label="수면">
      <div className="sleep-card-head">
        <h3>수면</h3>
        {running && <span className="sleep-card-live">재는 중</span>}
      </div>
      {running ? (
        <p className="sleep-card-desc">
          {status.startedAt ? `${hhmm(status.startedAt)}부터 ` : ""}재고 있어요
        </p>
      ) : (
        <>
          <div className="sleep-card-result">
            <span className="sleep-card-label">{nightLabel(last)}</span>
            <strong>{formatMinutes(last.asleep_minutes)}</strong>
            <span>
              {hhmm(last.bed_start)} ~ {hhmm(last.wake_end)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/* 홈 '수면 측정' 카드 — 안드로이드 앱에서만.
 *
 * 자기 전 [측정 시작] → "수면 측정 중" 알림 → 아침 [일어났어요] → 잔 시간·잠든/일어난 시각.
 * 결과는 대략적인 추정이라고 항상 함께 보여 준다(조용히 누워 깨어 있으면 잠으로 셀 수 있음).
 * 수면은 평가·목표 없이 사실만 보여 준다(건강 데이터 원칙, HEALTH_DATA_INTEGRATION.md).
 */
import { useCallback, useEffect, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import {
  getSleepStatus,
  loadLastSleepResult,
  startSleepMeasure,
  stopSleepMeasure,
} from "./sleepSound";
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

export default function SleepMeasureCard() {
  const [status, setStatus] = useState(null);
  const [last, setLast] = useState(() => loadLastSleepResult());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await getSleepStatus());
      setLast(loadLastSleepResult());
    } catch (err) {
      console.error("[SleepMeasureCard] 상태 확인 실패:", err);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getSleepStatus()
        .then((s) => {
          if (!alive) return;
          setStatus(s);
          setLast(loadLastSleepResult());
        })
        .catch((err) => console.error("[SleepMeasureCard] 상태 확인 실패:", err));
    load();
    // 알림의 '측정 끝내기'로 멈췄거나 밤중에 끊긴 경우 — 앱으로 돌아오면 다시 확인
    const sub = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) load();
    });
    return () => {
      alive = false;
      sub.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  async function handleStart() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await startSleepMeasure();
      if (res.status === "denied") {
        setMessage("마이크 권한이 필요해요. 휴대폰 설정 → 애플리케이션 → Cheddar → 권한에서 마이크를 허용해 주세요.");
      }
      await refresh();
    } catch (err) {
      console.error("[SleepMeasureCard] 시작 실패:", err);
      setMessage("측정을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await stopSleepMeasure();
      if (!res.summary) {
        setMessage("잠든 구간을 찾지 못했어요. 5분 이상 이어서 잔 기록이 있어야 결과가 나와요.");
      }
      await refresh();
    } catch (err) {
      console.error("[SleepMeasureCard] 멈춤 실패:", err);
      setMessage("측정을 끝내지 못했어요. 잠시 후 다시 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const running = !!status?.running;

  return (
    <section className="sleep-card" aria-label="수면 측정">
      <div className="sleep-card-head">
        <h3>수면 측정</h3>
        {running && <span className="sleep-card-live">측정 중</span>}
      </div>

      {running ? (
        <>
          <p className="sleep-card-desc">
            {status.startedAt ? `${hhmm(status.startedAt)}부터 ` : ""}재고 있어요. 일어나면 아래 버튼을 눌러 주세요.
          </p>
          <button type="button" className="sleep-card-btn sleep-card-btn-stop" onClick={handleStop} disabled={busy}>
            {busy ? "정리하는 중…" : "일어났어요 · 측정 끝내기"}
          </button>
        </>
      ) : (
        <>
          {last ? (
            <div className="sleep-card-result">
              <strong>{formatMinutes(last.asleep_minutes)}</strong>
              <span>
                {hhmm(last.bed_start)} ~ {hhmm(last.wake_end)}
              </span>
            </div>
          ) : (
            <p className="sleep-card-desc">
              자기 전에 시작을 누르고 휴대폰을 머리맡에 두세요. 소리는 저장하지 않고 휴대폰 안에서만 분석해요.
            </p>
          )}
          {last?.interrupted && <p className="sleep-card-note">중간에 측정이 끊겨서 남은 기록으로만 계산했어요.</p>}
          {last && <p className="sleep-card-note">소리로 잰 대략적인 추정이에요.</p>}
          <button type="button" className="sleep-card-btn" onClick={handleStart} disabled={busy}>
            {busy ? "시작하는 중…" : "오늘 밤 측정 시작"}
          </button>
          <p className="sleep-card-tip">충전기를 꽂아 두면 배터리 걱정 없이 잴 수 있어요.</p>
        </>
      )}

      {message && <p className="sleep-card-message">{message}</p>}
    </section>
  );
}

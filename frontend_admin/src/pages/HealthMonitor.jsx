import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";

// 건강 데이터 수집 모니터링 — "업데이트 후 걸음·수면이 잘 들어오고 있나?" 확인용.
// - 날짜별: 그날 기록을 보낸 회원 수(출처별), 평균값, 이상 수면값
// - 회원별: 마지막으로 걸음·수면이 들어온 날 → 며칠째 끊겼는지
// 수면 날짜는 '일어난 날' 기준(오늘 줄 = 어젯밤 잠).

const SOURCE_LABELS = {
  phone_sensor: "폰 센서",
  phone_mic: "폰 마이크",
  health_connect: "Health Connect",
  healthkit: "HealthKit",
};
const SOURCE_COLORS = {
  phone_sensor: "#14b8a6",
  phone_mic: "#6366f1",
  health_connect: "#f59e0b",
  healthkit: "#ec4899",
};
const RANGES = [7, 14, 30];
const STALE_DAYS = 2; // 마지막 기록이 이틀 이상 전이면 '끊김'

function fmtDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  const wd = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d} (${wd})`;
}

function fmtMinutes(min) {
  if (min == null) return "—";
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

function daysBetween(from, to) {
  // "YYYY-MM-DD" 두 개의 차이(일) — UTC 로 계산해 시간대 밀림 없음
  const p = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(to) - p(from)) / 86400000);
}

function SourceChips({ bySource }) {
  const entries = Object.entries(bySource || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return (
    <span className="hm-chips">
      {entries.map(([src, n]) => (
        <span
          key={src}
          className="hm-chip"
          style={{ color: SOURCE_COLORS[src] || "var(--muted)", borderColor: SOURCE_COLORS[src] || "var(--border)" }}
        >
          {SOURCE_LABELS[src] || src} {n}
        </span>
      ))}
    </span>
  );
}

function Freshness({ lastDay, source, today }) {
  if (!lastDay) return <span className="hm-status none">기록 없음</span>;
  const gap = daysBetween(lastDay, today);
  const cls = gap <= 0 ? "ok" : gap < STALE_DAYS ? "warn" : "stale";
  const text = gap <= 0 ? "오늘" : gap === 1 ? "어제" : `${gap}일째 없음`;
  return (
    <span className="hm-fresh">
      <span className={`hm-status ${cls}`}>{text}</span>
      <span className="hm-sub">
        {fmtDay(lastDay)} · {SOURCE_LABELS[source] || source}
      </span>
    </span>
  );
}

export default function HealthMonitor() {
  const navigate = useNavigate();
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);

  useEffect(() => {
    setError("");
    api.healthOverview({ days }).then(setData).catch((e) => setError(e.message));
  }, [days]);

  // 걸음·수면 중 더 최근 것도 STALE_DAYS 이상 지났으면 '끊김'
  const allUsers = useMemo(() => {
    if (!data) return [];
    return data.users.map((u) => {
      const gaps = [u.last_steps_day, u.last_sleep_day]
        .filter(Boolean)
        .map((d) => daysBetween(d, data.today));
      return { ...u, stale: !gaps.length || Math.min(...gaps) >= STALE_DAYS };
    });
  }, [data]);
  const staleCount = allUsers.filter((u) => u.stale).length;
  const users = staleOnly ? allUsers.filter((u) => u.stale) : allUsers;

  const today = data?.daily[0];
  const yday = data?.daily[1];

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>건강 데이터</h1>
          <p className="page-desc">걸음수·수면이 앱에서 잘 들어오고 있는지 확인합니다.</p>
        </div>
        <div className="health-ranges">
          {RANGES.map((n) => (
            <button
              key={n}
              className={`health-range${days === n ? " active" : ""}`}
              onClick={() => setDays(n)}
            >
              최근 {n}일
            </button>
          ))}
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}
      {!data && !error && <p className="muted">불러오는 중…</p>}

      {data && (
        <>
          <div className="card-grid">
            <SummaryCard
              label="어젯밤 수면 기록"
              value={today.sleep_users}
              prev={yday?.sleep_users}
              suffix="명"
            />
            <SummaryCard
              label="오늘 걸음수 업로드"
              value={today.steps_users}
              prev={yday?.steps_users}
              suffix="명"
            />
            <SummaryCard
              label="건강 데이터 보낸 적 있는 회원"
              value={data.users.length}
              suffix="명"
            />
            <SummaryCard
              label={`${STALE_DAYS}일 이상 끊긴 회원`}
              value={staleCount}
              suffix="명"
              danger
            />
          </div>

          <h2 className="dashboard-section-title">날짜별 수신</h2>
          <div className="table-wrap">
            <table className="data-table health-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th className="num">걸음 회원</th>
                  <th>걸음 출처</th>
                  <th className="num">평균 걸음</th>
                  <th className="num">수면 회원</th>
                  <th>수면 출처</th>
                  <th className="num">평균 수면</th>
                  <th className="num">이상 수면값</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr key={d.day}>
                    <td>{fmtDay(d.day)}</td>
                    <td className="num cell-strong">{d.steps_users || <span className="health-missing">0</span>}</td>
                    <td><SourceChips bySource={d.steps_by_source} /></td>
                    <td className="num">{d.avg_steps?.toLocaleString() ?? "—"}</td>
                    <td className="num cell-strong">{d.sleep_users || <span className="health-missing">0</span>}</td>
                    <td><SourceChips bySource={d.sleep_by_source} /></td>
                    <td className="num">{fmtMinutes(d.avg_asleep_minutes)}</td>
                    <td className={`num${d.odd_sleep_count ? " health-odd" : ""}`}>
                      {d.odd_sleep_count || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted health-note">
            폰 센서(걸음)·폰 마이크(수면)는 11/8 앱 업데이트(1.0.12) 이후 생긴 출처예요. 업데이트 이후
            날짜에서 이 두 출처 숫자가 늘어나면 새 방식이 잘 동작하는 거예요. 이상 수면값은 3시간 미만이거나
            12시간을 넘는 기록 수예요.
          </p>

          <div className="hm-users-head">
            <h2 className="dashboard-section-title">회원별 마지막 수신</h2>
            <label className="hm-toggle">
              <input
                type="checkbox"
                checked={staleOnly}
                onChange={(e) => setStaleOnly(e.target.checked)}
              />
              {STALE_DAYS}일 이상 끊긴 회원만
            </label>
          </div>
          <div className="table-wrap">
            <table className="data-table health-table">
              <thead>
                <tr>
                  <th>회원</th>
                  <th>걸음수</th>
                  <th className="num">최근 7일 걸음</th>
                  <th>수면</th>
                  <th className="num">최근 7일 수면</th>
                  <th>마지막 업로드</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">해당하는 회원이 없어요.</td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id} className="row-clickable" onClick={() => navigate(`/users/${u.id}`)}>
                    <td>
                      <span className="cell-strong">{u.user_id}</span>
                      {u.nickname && <span className="hm-sub"> {u.nickname}</span>}
                    </td>
                    <td><Freshness lastDay={u.last_steps_day} source={u.last_steps_source} today={data.today} /></td>
                    <td className="num">{u.steps_days_7d}/7</td>
                    <td><Freshness lastDay={u.last_sleep_day} source={u.last_sleep_source} today={data.today} /></td>
                    <td className="num">{u.sleep_days_7d}/7</td>
                    <td className="hm-sub">
                      {u.last_synced_at ? new Date(u.last_synced_at).toLocaleString("ko-KR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted health-note">
            건강 데이터를 한 번이라도 보낸 회원만 나와요. 자동 기록을 켰는지는 폰에만 저장돼서 서버는 알 수
            없어요. 가장 오래 끊긴 회원이 위에 있고, 줄을 누르면 회원 상세의 걸음·수면 탭에서 날짜별로 볼 수 있어요.
          </p>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, prev, suffix, danger }) {
  const diff = prev != null ? value - prev : null;
  return (
    <div className="stat-card">
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <span className="stat-value" style={danger && value > 0 ? { color: "var(--danger)" } : undefined}>
          {value.toLocaleString()}
          <span className="stat-suffix">{suffix}</span>
        </span>
        {diff != null && (
          <span className="hm-sub">
            전날 대비 {diff > 0 ? `+${diff}` : diff}
          </span>
        )}
      </div>
    </div>
  );
}

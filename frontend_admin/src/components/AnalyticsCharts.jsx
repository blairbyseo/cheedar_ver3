/**
 * 대시보드 분석 차트 묶음.
 *
 * Cheddar_Team_26 frontend_admin 의 Home 차트(활동 통계 / 기록 빈도 /
 * 페이지별 소요 시간 / 사용자 동선 Sankey)를 이 관리자 앱 스택으로 옮긴 것.
 * 데이터·탭·메트릭 토글·로딩/에러/빈 상태 처리 동작을 동일하게 재현한다.
 *
 * 원본은 shadcn/radix 달력 팝오버로 주(week) 단위 글로벌 날짜를 골랐는데,
 * 이 앱엔 그 스택이 없어 가벼운 네이티브 date 입력(from~to)으로 대체했다.
 * (차트 자체 동작은 동일.)
 */
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../api/api";
import { SankeyChart } from "./charts/SankeyChart";

// --- 날짜 헬퍼: 기본 범위는 '이번 주'(일~토), 참조 구현과 동일 ---
function fmtLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeekSun(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function endOfWeekSun(d) {
  const x = startOfWeekSun(d);
  x.setDate(x.getDate() + 6);
  return x;
}

const PAGE_TIME_METRICS = [
  { value: "avgTime", label: "평균" },
  { value: "medianTime", label: "중앙값" },
  { value: "p50", label: "P50" },
  { value: "p90", label: "P90" },
  { value: "p95", label: "P95" },
];

const TOOLTIP_STYLE = {
  borderRadius: "12px",
  border: "none",
  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
};

// status: 'loading' | 'error' | 'empty' | 'success'
function ChartMessage({ status, error }) {
  if (status === "loading") return <div className="chart-msg">불러오는 중…</div>;
  if (status === "error") return <div className="chart-msg error">{error ?? "오류가 발생했습니다"}</div>;
  if (status === "empty") return <div className="chart-msg">데이터 없음</div>;
  return null;
}

// 데이터 fetch 공통 훅: status 와 data 를 함께 관리.
function useChartData(fetcher, deps, pick) {
  const [data, setData] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setError(null);
    fetcher()
      .then((body) => {
        if (!alive) return;
        const items = pick(body) ?? [];
        setData(items);
        setStatus(items.length > 0 ? "success" : "empty");
      })
      .catch((e) => {
        if (!alive) return;
        setStatus("error");
        setError(e.message);
        setData([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, status, error };
}

export default function AnalyticsCharts() {
  const [range, setRange] = useState(() => {
    const today = new Date();
    return { from: fmtLocal(startOfWeekSun(today)), to: fmtLocal(endOfWeekSun(today)) };
  });
  const [recordTab, setRecordTab] = useState("daily"); // daily | element | time
  const [pageTimeMetric, setPageTimeMetric] = useState("avgTime");

  const { from, to } = range;

  const activity = useChartData(
    () => api.analyticsActivityWeekly({ from, to }),
    [from, to],
    (b) => b?.items
  );
  const element = useChartData(
    () => api.analyticsRecordFrequency({ breakdown: "element", from, to }),
    [from, to],
    (b) => b?.element
  );
  const timeOfDay = useChartData(
    () => api.analyticsRecordFrequency({ breakdown: "time", from, to }),
    [from, to],
    (b) => b?.time
  );
  const pageTime = useChartData(
    () => api.analyticsPageTime({ from, to }),
    [from, to],
    (b) => b?.items
  );
  const userFlow = useChartData(
    () => api.analyticsUserFlow({ from, to }),
    [from, to],
    (b) => b?.edges
  );

  // 기록 빈도 탭에 따라 보여줄 데이터/상태 선택.
  const recordView =
    recordTab === "daily"
      ? activity
      : recordTab === "element"
        ? element
        : timeOfDay;

  const totalPlayTime = useMemo(
    () => (pageTime.data ?? []).reduce((sum, p) => sum + (p.totalTime || 0), 0),
    [pageTime.data]
  );

  const metricLabel =
    PAGE_TIME_METRICS.find((m) => m.value === pageTimeMetric)?.label ?? "평균";

  return (
    <div className="analytics">
      <div className="analytics-head">
        <h2 className="analytics-title">분석</h2>
        <div className="date-range">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
          <span>~</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
      </div>

      {/* ---- 활동 통계 ---- */}
      <h3 className="analytics-cat">활동 통계</h3>
      <div className="chart-grid">
        {/* 주간 활동 통계 (Area) */}
        <div className="chart-card">
          <div className="chart-card-head">
            <h4>주간 활동 통계</h4>
          </div>
          <div className="chart-box sm">
            {activity.status !== "success" ? (
              <ChartMessage status={activity.status} error={activity.error} />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={activity.data}>
                  <defs>
                    <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3182F6" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#3182F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="users" stroke="#3182F6" strokeWidth={3} fillOpacity={1} fill="url(#colorUsers)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 기록 빈도 (탭) */}
        <div className="chart-card">
          <div className="chart-card-head">
            <h4>기록 빈도</h4>
          </div>
          <div className="rf-tabs">
            {[
              { key: "daily", label: "날짜별" },
              { key: "element", label: "요소별" },
              { key: "time", label: "시간대별" },
            ].map((t) => (
              <button
                key={t.key}
                className={`rf-tab${recordTab === t.key ? " active" : ""}`}
                onClick={() => setRecordTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="chart-box sm">
            {recordView.status !== "success" ? (
              <ChartMessage status={recordView.status} error={recordView.error} />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                {recordTab === "daily" ? (
                  <BarChart data={activity.data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "#F1F5F9" }} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="records" fill="#3182F6" radius={[4, 4, 0, 0]} barSize={32} />
                  </BarChart>
                ) : recordTab === "element" ? (
                  <BarChart data={element.data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "#F1F5F9" }} contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="rect" />
                    <Bar dataKey="기록" fill="#3182F6" radius={[4, 4, 0, 0]} barSize={32} />
                    <Bar dataKey="건너뜀" fill="#EF4444" radius={[4, 4, 0, 0]} barSize={32} />
                  </BarChart>
                ) : (
                  <BarChart data={timeOfDay.data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} angle={-45} textAnchor="end" height={50} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "#F1F5F9" }} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="records" fill="#3182F6" radius={[4, 4, 0, 0]} barSize={16} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ---- 페이지 분석 ---- */}
      <h3 className="analytics-cat">페이지 분석</h3>
      <div className="chart-grid">
        {/* 페이지별 소요 시간 (가로 막대 + 메트릭 선택) */}
        <div className="chart-card">
          <div className="chart-card-head">
            <h4>페이지별 소요 시간</h4>
            <select
              className="metric-select"
              value={pageTimeMetric}
              onChange={(e) => setPageTimeMetric(e.target.value)}
            >
              {PAGE_TIME_METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="chart-box md">
            {pageTime.status !== "success" ? (
              <ChartMessage status={pageTime.status} error={pageTime.error} />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={pageTime.data} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke="#E2E8F0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} width={100} />
                  <Tooltip
                    cursor={{ fill: "#F1F5F9" }}
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => [`${value}초`, `${metricLabel} 소요 시간`]}
                  />
                  <Bar dataKey={pageTimeMetric} fill="#3182F6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="chart-footer">
            <span>총 플레이 시간</span>
            <strong>
              {pageTime.status === "success"
                ? `${totalPlayTime.toLocaleString()}초`
                : pageTime.status === "error"
                  ? pageTime.error ?? "오류"
                  : pageTime.status === "empty"
                    ? "데이터 없음"
                    : "불러오는 중…"}
            </strong>
          </div>
        </div>
      </div>

      {/* ---- 사용자 동선 (Sankey) ---- */}
      <div className="chart-card">
        <div className="chart-card-head">
          <h4>사용자 동선 추적</h4>
        </div>
        <div className="chart-box lg">
          {userFlow.status !== "success" ? (
            <ChartMessage status={userFlow.status} error={userFlow.error} />
          ) : (
            <SankeyChart data={userFlow.data} nodeWidth={15} nodePadding={10} />
          )}
        </div>
        <div className="chart-footer column">
          <p className="ff-title">사용자 동선 설명</p>
          <p className="ff-desc">
            이 차트는 사용자가 앱 내에서 페이지 간 이동하는 경로를 시각화합니다. 각
            링크의 두께는 해당 경로로 이동한 횟수를 나타내며, 주요 이동 패턴을 파악해
            UI/UX 최적화에 활용할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}

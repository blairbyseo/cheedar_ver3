import { Download, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";
import PlatformBadge from "../components/PlatformBadge";

const PAGE_SIZE = 20;

function formatSleepMinutes(minutes) {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

function formatClock(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

function formatKoreanDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`;
}

function koreanToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// 정렬 선택지 — value는 "sort:order" 형태로 API 파라미터와 매핑한다.
const SORT_OPTIONS = [
  { value: "created_at:desc", label: "가입순 (최신순)" },
  { value: "created_at:asc", label: "가입순 (오래된순)" },
  { value: "xp:desc", label: "XP 높은순" },
  { value: "xp:asc", label: "XP 낮은순" },
  { value: "chat_count:desc", label: "채팅 많은순" },
  { value: "chat_count:asc", label: "채팅 적은순" },
];

export default function UserManagement() {
  const navigate = useNavigate();

  const [query, setQuery] = useState(""); // 입력창 값
  const [q, setQ] = useState(""); // 실제 검색에 쓰는 값(제출 시 반영)
  const [sortKey, setSortKey] = useState("created_at:desc"); // 정렬 기준
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [healthByUser, setHealthByUser] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [healthExporting, setHealthExporting] = useState(false);
  const [healthExportProgress, setHealthExportProgress] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const [sort, order] = sortKey.split(":");
    api
      .users({ q, sort, order, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, sortKey, page]);

  useEffect(() => {
    let cancelled = false;
    const items = data?.items ?? [];
    setHealthByUser({});
    if (items.length === 0) return () => { cancelled = true; };

    Promise.all(
      items.map(async (user) => {
        try {
          const health = await api.userHealth(user.id, { days: 180 });
          return {
            userId: user.id,
            health: {
              sleep: health.days.find((day) => day.asleep_minutes != null) ?? null,
              steps: health.days.find((day) => day.steps != null) ?? null,
            },
          };
        } catch (e) {
          return { userId: user.id, error: e };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next = Object.fromEntries(results.map(({ userId, ...result }) => [userId, result]));
      setHealthByUser(next);
      const failed = results.find((result) => result.error);
      if (failed) setError(`일부 회원의 건강 데이터를 불러오지 못했어요: ${failed.error.message}`);
    });

    return () => { cancelled = true; };
  }, [data?.items]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    setQ(query.trim());
  }

  async function handleExport() {
    setExporting(true);
    setHealthExportProgress("");
    setError("");
    try {
      const [sort, order] = sortKey.split(":");
      const firstPage = await api.users({ q, sort, order, page: 1, pageSize: 100 });
      const users = [...firstPage.items];
      const totalPages = Math.ceil(firstPage.total / firstPage.page_size);
      for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
        const result = await api.users({
          q,
          sort,
          order,
          page: pageNumber,
          pageSize: 100,
        });
        users.push(...result.items);
      }

      const rows = [[
        "회원 ID",
        "아이디",
        "닉네임",
        "이메일",
        "기기",
        "식단수",
        "채팅수",
        "XP",
        "CP",
        "최근 걸음 기록일(180일)",
        "최근 걸음수",
        "걸음 출처",
        "걸음 기록일수(180일)",
        "평균 걸음수(180일)",
        "최근 수면 기록일(180일, 기상일)",
        "수면시간(분)",
        "수면시간",
        "잠든 시각 (한국시간)",
        "일어난 시각 (한국시간)",
        "수면 출처",
        "수면 기록일수(180일)",
        "평균 수면시간(분, 180일)",
        "평균 수면시간(180일)",
        "마지막 건강정보 업로드 (한국시간)",
        "가입일시 (한국시간)",
      ]];

      for (let offset = 0; offset < users.length; offset += 8) {
        const batch = users.slice(offset, offset + 8);
        const healthResults = await Promise.all(
          batch.map(async (user) => {
            try {
              return { health: await api.userHealth(user.id, { days: 180 }) };
            } catch (e) {
              throw new Error(`${user.user_id} 회원의 건강 데이터를 불러오지 못했어요: ${e.message}`);
            }
          }),
        );
        healthResults.forEach(({ health }, index) => {
          const user = batch[index];
          const latestSleep = health.days.find((day) => day.asleep_minutes != null);
          const latestSteps = health.days.find((day) => day.steps != null);
          rows.push([
            user.id,
            user.user_id,
            user.nickname,
            user.email,
            user.last_platform,
            user.meal_count,
            user.chat_count,
            user.xp,
            user.cp,
            latestSteps?.day,
            latestSteps?.steps,
            latestSteps?.steps_source,
            health.steps_days,
            health.avg_steps,
            latestSleep?.day,
            latestSleep?.asleep_minutes,
            latestSleep ? formatSleepMinutes(latestSleep.asleep_minutes) : "",
            formatKoreanDateTime(latestSleep?.bed_start),
            formatKoreanDateTime(latestSleep?.wake_end),
            latestSleep?.sleep_source,
            health.sleep_days,
            health.avg_asleep_minutes,
            health.avg_asleep_minutes != null
              ? formatSleepMinutes(health.avg_asleep_minutes)
              : "",
            formatKoreanDateTime(health.last_synced_at),
            formatKoreanDateTime(user.created_at),
          ]);
        });
        setHealthExportProgress(`${Math.min(offset + batch.length, users.length)} / ${users.length}명`);
      }

      downloadCsv(
        `cheddar_users_sleep_steps_${koreanToday()}.csv`,
        rows,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleHealthExport() {
    setHealthExporting(true);
    setHealthExportProgress("");
    setError("");
    try {
      const [sort, order] = sortKey.split(":");
      const firstPage = await api.users({ q, sort, order, page: 1, pageSize: 100 });
      const users = [...firstPage.items];
      const totalPages = Math.ceil(firstPage.total / firstPage.page_size);
      for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
        const result = await api.users({
          q,
          sort,
          order,
          page: pageNumber,
          pageSize: 100,
        });
        users.push(...result.items);
      }

      const csvRows = [[
        "회원 ID",
        "아이디",
        "닉네임",
        "이메일",
        "기록일",
        "걸음수",
        "걸음 출처",
        "수면시간(분)",
        "수면시간",
        "잠든 시각 (한국시간)",
        "일어난 시각 (한국시간)",
        "수면 출처",
      ]];
      for (let offset = 0; offset < users.length; offset += 8) {
        const batch = users.slice(offset, offset + 8);
        const healthResults = await Promise.all(
          batch.map((user) => api.userHealth(user.id, { days: 180 })),
        );
        healthResults.forEach((health, index) => {
          const user = batch[index];
          health.days.forEach((day) => {
            if (day.steps == null && day.asleep_minutes == null) return;
            csvRows.push([
              user.id,
              user.user_id,
              user.nickname,
              user.email,
              day.day,
              day.steps,
              day.steps_source,
              day.asleep_minutes,
              formatSleepMinutes(day.asleep_minutes) === "—"
                ? ""
                : formatSleepMinutes(day.asleep_minutes),
              formatKoreanDateTime(day.bed_start),
              formatKoreanDateTime(day.wake_end),
              day.sleep_source,
            ]);
          });
        });
        setHealthExportProgress(`${Math.min(offset + batch.length, users.length)} / ${users.length}명`);
      }

      downloadCsv(
        `cheddar_sleep_steps_daily_${koreanToday()}_180days.csv`,
        csvRows,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setHealthExporting(false);
      setHealthExportProgress("");
    }
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>회원 관리</h1>
          <p className="page-desc">전체 {total.toLocaleString()}명</p>
        </div>
        <button
          className="btn-ghost btn-export"
          type="button"
          onClick={handleExport}
          disabled={exporting || healthExporting || total === 0}
        >
          <Download size={16} />
          {exporting
            ? `내보내는 중… ${healthExportProgress}`
            : "회원별 CSV (수면·걸음 포함)"}
        </button>
        <button
          className="btn-ghost btn-export"
          type="button"
          onClick={handleHealthExport}
          disabled={healthExporting || exporting || total === 0}
          title="전체 회원의 최근 180일 건강 기록 다운로드"
        >
          <Download size={16} />
          {healthExporting
            ? `건강 데이터 내보내는 중… ${healthExportProgress}`
            : "수면·걸음 일별 CSV (180일)"}
        </button>
      </header>

      <form className="search-bar" onSubmit={handleSearch}>
        <Search size={18} className="search-icon" />
        <input
          className="search-input"
          placeholder="아이디 · 닉네임 · 이메일 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-primary" type="submit">검색</button>
        <select
          className="sort-select"
          value={sortKey}
          onChange={(e) => {
            setPage(1);
            setSortKey(e.target.value);
          }}
          aria-label="정렬 기준"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </form>

      {error && <p className="error-banner">{error}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>아이디</th>
              <th>닉네임</th>
              <th>이메일</th>
              <th>기기</th>
              <th className="num">식단</th>
              <th className="num">채팅</th>
              <th className="num">XP</th>
              <th className="num">CP</th>
              <th className="num">수면시간</th>
              <th className="num">일어난 시각</th>
              <th className="num">잠든 시각</th>
              <th className="num">걸음수</th>
              <th>가입일</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr
                key={u.id}
                className="row-clickable"
                onClick={() => navigate(`/users/${u.id}`)}
              >
                <td>{u.id}</td>
                <td>
                  <span className="cell-strong">{u.user_id}</span>
                  {u.is_admin && (
                    <span className="badge-admin" title="관리자">
                      <ShieldCheck size={12} /> 관리자
                    </span>
                  )}
                </td>
                <td>{u.nickname || "—"}</td>
                <td>{u.email || "—"}</td>
                <td><PlatformBadge platform={u.last_platform} /></td>
                <td className="num">{u.meal_count}</td>
                <td className="num">{u.chat_count}</td>
                <td className="num">{u.xp}</td>
                <td className="num">{u.cp}</td>
                {(() => {
                  const health = healthByUser[u.id];
                  const sleep = health?.health?.sleep;
                  const steps = health?.health?.steps;
                  const sleepDay = u.last_sleep_day || sleep?.day;
                  const stepsDay = u.last_steps_day || steps?.day;
                  const missing = health?.error
                    ? <span title={health.error.message}>오류</span>
                    : <span className="health-missing">—</span>;
                  return (
                    <>
                      <td className="num" title={sleepDay ? `기상일 ${sleepDay}` : undefined}>
                        {u.last_asleep_minutes != null || sleep
                          ? formatSleepMinutes(u.last_asleep_minutes ?? sleep?.asleep_minutes)
                          : missing}
                        {sleepDay && <div className="muted">{sleepDay}</div>}
                      </td>
                      <td className="num" title={sleepDay ? `기상일 ${sleepDay}` : undefined}>
                        {sleep ? formatClock(sleep.wake_end) : missing}
                      </td>
                      <td className="num" title={sleepDay ? `기상일 ${sleepDay}` : undefined}>
                        {sleep ? formatClock(sleep.bed_start) : missing}
                      </td>
                      <td className="num" title={stepsDay ? `기록일 ${stepsDay}` : undefined}>
                        {u.last_steps != null || steps
                          ? `${(u.last_steps ?? steps?.steps).toLocaleString()}보`
                          : missing}
                        {stepsDay && <div className="muted">{stepsDay}</div>}
                      </td>
                    </>
                  );
                })()}
                <td>{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
              </tr>
            ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={14} className="table-empty">검색 결과가 없어요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button
          className="btn-ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          이전
        </button>
        <span className="page-indicator">{page} / {totalPages}</span>
        <button
          className="btn-ghost"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          다음
        </button>
      </div>
    </div>
  );
}

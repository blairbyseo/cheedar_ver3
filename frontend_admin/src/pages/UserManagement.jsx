import { Download, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";

const PAGE_SIZE = 20;

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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    setQ(query.trim());
  }

  async function handleExport() {
    setExporting(true);
    setError("");
    try {
      const [sort, order] = sortKey.split(":");
      const { blob, filename } = await api.exportUsers({ q, sort, order });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
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
          disabled={exporting || total === 0}
        >
          <Download size={16} />
          {exporting ? "내보내는 중…" : "CSV 내보내기"}
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
              <th className="num">식단</th>
              <th className="num">채팅</th>
              <th className="num">XP</th>
              <th className="num">CP</th>
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
                <td className="num">{u.meal_count}</td>
                <td className="num">{u.chat_count}</td>
                <td className="num">{u.xp}</td>
                <td className="num">{u.cp}</td>
                <td>{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
              </tr>
            ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={9} className="table-empty">검색 결과가 없어요.</td>
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

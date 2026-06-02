import { Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/api";

const PAGE_SIZE = 20;

export default function UserManagement() {
  const navigate = useNavigate();

  const [query, setQuery] = useState(""); // 입력창 값
  const [q, setQ] = useState(""); // 실제 검색에 쓰는 값(제출 시 반영)
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .users({ q, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, page]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    setQ(query.trim());
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <header className="page-header">
        <h1>회원 관리</h1>
        <p className="page-desc">전체 {total.toLocaleString()}명</p>
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
                <td className="num">{u.xp}</td>
                <td className="num">{u.cp}</td>
                <td>{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
              </tr>
            ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="table-empty">검색 결과가 없어요.</td>
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

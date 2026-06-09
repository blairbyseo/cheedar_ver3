import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 이미 관리자로 로그인돼 있으면 대시보드로
  if (admin) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await login(userId.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <h1>Cheddar 관리자모드</h1>
        </div>
        <p className="login-sub">관리자 계정으로 로그인하세요</p>

        <input
          className="login-input"
          type="text"
          placeholder="아이디"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          autoComplete="username"
          disabled={busy}
          required
        />
        <input
          className="login-input"
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
          required
        />
        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>

        {error && <p className="login-error">{error}</p>}
      </form>
    </div>
  );
}

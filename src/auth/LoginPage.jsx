/* 로그인 화면 — 아이디/비밀번호 로그인 + 카카오 로그인.
 * 회원가입은 별도 /signup 페이지에서 처리. */
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthContext";

function LoginPage() {
  const { user, idLogin } = useAuth();
  const navigate = useNavigate();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [isKakaoLoading, setIsKakaoLoading] = useState(false); // 카카오로 이동 중
  const [isLoggingIn, setIsLoggingIn] = useState(false); // 아이디 로그인 처리 중
  const [errorText, setErrorText] = useState("");

  // 이미 로그인된 상태로 /login 에 들어오면 메인으로 보냄
  if (user) return <Navigate to="/" replace />;

  const busy = isKakaoLoading || isLoggingIn;

  // 아이디/비밀번호 로그인
  async function handleLogin(e) {
    e.preventDefault();
    if (busy) return;
    setErrorText("");
    setIsLoggingIn(true);
    try {
      await idLogin(userId.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      console.error("[Login] id login failed:", err);
      setErrorText(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  }

  // 카카오 로그인 — 백엔드가 만들어준 동의 URL 로 이동
  async function handleKakaoLogin() {
    if (busy) return;
    setIsKakaoLoading(true);
    setErrorText("");
    try {
      const res = await fetch("/api/auth/kakao/authorize-url");
      if (!res.ok) throw new Error(`authorize-url ${res.status}`);
      const { url } = await res.json();
      window.location.href = url;
      // 위 줄에서 페이지가 떠나므로 그 뒤 코드는 실행 안 됨
    } catch (err) {
      console.error("[Login] failed to get kakao url:", err);
      setErrorText("카카오 로그인 준비에 실패했어요. 서버 상태를 확인해주세요.");
      setIsKakaoLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-logo">Cheddar</h1>
        <p className="login-tagline">
          식단을 기록하고<br />건강한 하루를 만들어요
        </p>

        <form className="login-form" onSubmit={handleLogin}>
          <input
            type="text"
            className="login-input"
            placeholder="아이디"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            autoComplete="username"
            disabled={busy}
            required
          />
          <input
            type="password"
            className="login-input"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            required
          />
          <button type="submit" className="login-submit-btn" disabled={busy}>
            {isLoggingIn ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {errorText && <p className="login-error">{errorText}</p>}

        <p className="login-signup-row">
          아직 회원이 아니신가요?{" "}
          <Link to="/signup" className="login-signup-link">
            회원가입
          </Link>
        </p>

        <div className="login-divider">
          <span>또는</span>
        </div>

        <button
          type="button"
          className="login-kakao-btn"
          onClick={handleKakaoLogin}
          disabled={busy}
        >
          <span className="login-kakao-icon" aria-hidden="true">💬</span>
          {isKakaoLoading ? "카카오로 이동 중..." : "카카오로 시작하기"}
        </button>
      </div>
    </div>
  );
}

export default LoginPage;

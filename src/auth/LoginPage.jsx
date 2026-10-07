/* 로그인 화면 — 아이디/비밀번호 로그인 + 카카오 로그인 + (iOS) Apple 로그인.
 * 회원가입은 별도 /signup 페이지에서 처리. */
import { useState } from "react";
import { FaApple } from "react-icons/fa";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { isAppleSignInAvailable, requestAppleCredential } from "./appleNative";

import { useAuth } from "./AuthContext";
import InviteGate from "./InviteGate";
import { isNativeApp, openKakaoNative } from "./kakaoNative";

function LoginPage() {
  const { user, idLogin, appleLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [isKakaoLoading, setIsKakaoLoading] = useState(false); // 카카오로 이동 중
  const [isLoggingIn, setIsLoggingIn] = useState(false); // 아이디 로그인 처리 중
  const [isAppleLoading, setIsAppleLoading] = useState(false); // Apple 로그인 처리 중
  const [errorText, setErrorText] = useState("");
  // 카카오 신규 가입이라 초대코드가 필요한 상태 — 콜백에서 넘겨준다
  const [needsInvite, setNeedsInvite] = useState(
    () => location.state?.needsInviteCode === true,
  );
  // 초대코드를 요구한 쪽 — 통과 후 안내 문구를 고르는 데 쓴다 ("kakao" | "apple")
  const [inviteFor, setInviteFor] = useState("kakao");
  const [inviteMessage, setInviteMessage] = useState("");
  const [noticeText, setNoticeText] = useState("");

  // 이미 로그인된 상태로 /login 에 들어오면 메인으로 보냄
  if (user) return <Navigate to="/" replace />;

  // 카카오로 처음 들어온 사람 — 코드를 먼저 받는다.
  // 통과해도 자동으로 이어지지 않는다: 카카오 인가코드가 1회용이라
  // 카카오 로그인 버튼을 한 번 더 눌러야 한다. 그 사정을 안내로 알려준다.
  if (needsInvite) {
    return (
      <InviteGate
        title="회원가입"
        hint={
          inviteMessage ||
          location.state?.inviteMessage ||
          "초대받은 분만 가입할 수 있어요.\n받으신 코드를 입력해 주세요."
        }
        onPass={() => {
          setNeedsInvite(false);
          setNoticeText(
            inviteFor === "apple"
              ? "초대코드를 확인했어요. Apple로 로그인을 한 번 더 눌러 주세요."
              : "초대코드를 확인했어요. 카카오 로그인을 한 번 더 눌러 주세요.",
          );
        }}
        onCancel={() => setNeedsInvite(false)}
      />
    );
  }

  const busy = isKakaoLoading || isLoggingIn || isAppleLoading;

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

  // 카카오 로그인
  //  - 앱(Capacitor): 동의창을 시스템 브라우저로 열고, 로그인 후 App Link 로
  //    앱에 돌아오면 KakaoDeepLinkHandler 가 나머지(코드 교환)를 처리한다.
  //  - 웹: 기존대로 백엔드가 만들어준 동의 URL 로 현재 창을 이동시킨다.
  async function handleKakaoLogin() {
    if (busy) return;
    setIsKakaoLoading(true);
    setErrorText("");
    try {
      if (isNativeApp()) {
        await openKakaoNative();
        // 이후는 딥링크 핸들러가 처리 — 브라우저에 갔다 오는 동안 버튼만 원복
        setIsKakaoLoading(false);
        return;
      }
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

  // Apple 로그인 (iOS 앱 전용) — 사용자가 창을 닫으면 조용히 원래 상태로 돌아간다
  async function handleAppleLogin() {
    if (busy) return;
    setIsAppleLoading(true);
    setErrorText("");
    try {
      const credential = await requestAppleCredential();
      if (!credential) return;
      await appleLogin(credential);
      navigate("/", { replace: true });
    } catch (err) {
      // 처음 보는 Apple 계정 = 신규 가입 → 카카오와 똑같이 초대코드를 먼저 받는다
      if (err.needsInviteCode) {
        setInviteFor("apple");
        setInviteMessage(err.message);
        setNeedsInvite(true);
        return;
      }
      console.error("[Login] apple login failed:", err);
      setErrorText("Apple 로그인에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsAppleLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-logo">Cheddar</h1>
        <p className="login-tagline">
          식단을 기록하고<br />하루의 기분도 함께 남겨요
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

        {noticeText && <p className="login-notice">{noticeText}</p>}
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
          <span className="login-kakao-icon" aria-hidden="true"></span>
          {isKakaoLoading ? "카카오로 이동 중..." : "카카오톡으로 시작하기"}
        </button>

        {/* App Store 4.8: 카카오 같은 외부 로그인이 있으면 Apple 로그인을 같은 크기로
            함께 제공해야 한다. iOS 앱에서만 보인다. */}
        {isAppleSignInAvailable() && (
          <button
            type="button"
            className="login-apple-btn"
            onClick={handleAppleLogin}
            disabled={busy}
          >
            <FaApple className="login-apple-icon" aria-hidden="true" />
            {isAppleLoading ? "Apple 로그인 중..." : "Apple로 로그인"}
          </button>
        )}
      </div>
    </div>
  );
}

export default LoginPage;

/* 카카오에서 동의 후 돌아오는 페이지: /oauth/kakao/callback?code=XXX
 * - URL 에서 code 를 꺼내 useAuth().login(code, ...) 호출
 * - 성공하면 메인(/)으로, 실패하면 /login 으로 보냄 */
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "./AuthContext";

function OAuthKakaoCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuth();
  const didRunRef = useRef(false);

  useEffect(() => {
    // StrictMode 에서 useEffect 가 2번 실행되는 문제 방지 — code 는 1회용이라 두 번 쓰면 카카오가 거절함
    if (didRunRef.current) return;
    didRunRef.current = true;

    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      console.error("[OAuth] kakao returned error:", error);
      navigate("/login", { replace: true });
      return;
    }
    if (!code) {
      navigate("/login", { replace: true });
      return;
    }

    async function complete() {
      try {
        // redirect_uri 는 카카오 콘솔 등록값과 정확히 일치해야 하므로,
        // 현재 콜백 페이지의 origin 으로 만든다.
        const redirectUri = `${window.location.origin}/oauth/kakao/callback`;
        await login(code, redirectUri);
        navigate("/", { replace: true });
      } catch (err) {
        console.error("[OAuth] kakao login failed:", err);
        navigate("/login", { replace: true });
      }
    }
    complete();
  }, [params, login, navigate]);

  return (
    <div className="login-page">
      <div className="login-card">
        <p className="login-tagline">로그인 중이에요...</p>
      </div>
    </div>
  );
}

export default OAuthKakaoCallback;

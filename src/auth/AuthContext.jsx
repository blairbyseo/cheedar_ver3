/* 로그인 상태를 앱 전체에서 공유하기 위한 React Context.
 *
 * 동작:
 * - 앱 시작 시 GET /api/auth/me 한 번 호출해서 쿠키 기반 로그인 여부 확인
 * - user가 null이면 비로그인, 객체면 로그인됨
 * - 자식 컴포넌트는 useAuth() 훅으로 user/loading/login 등을 사용
 */
import { createContext, useContext, useEffect, useState } from "react";
import { loadInviteCode } from "./inviteCode";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 앱 시작 시 한 번: 쿠키가 유효하면 user 채워짐, 만료/없으면 null
  useEffect(() => {
    async function bootstrap() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          setUser(await res.json());
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  // 카카오 콜백에서 호출 — 백엔드가 쿠키를 set 한 뒤 user 객체를 돌려줌.
  // 처음 보는 카카오 계정이면 서버가 초대코드를 요구하며 403 을 준다. 기존
  // 사용자는 코드가 없어도 그대로 로그인되므로, 저장된 코드가 있으면 실어 보낸다.
  async function login(code, redirectUri) {
    const res = await fetch("/api/auth/kakao", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        redirect_uri: redirectUri,
        invite_code: loadInviteCode(),
      }),
    });
    if (res.status === 403) {
      // 신규 가입인데 코드가 없거나 못 쓰는 코드 → 로그인 화면이 코드 입력을 띄운다
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.detail || "초대코드가 필요해요.");
      err.needsInviteCode = true;
      throw err;
    }
    if (!res.ok) throw new Error(`kakao login ${res.status}`);
    const data = await res.json();
    setUser(data.user);
    return data.user;
  }

  // 아이디/비밀번호 로그인 — 성공하면 백엔드가 쿠키를 심고 user 객체를 돌려줌
  async function idLogin(userId, password) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `로그인에 실패했어요 (${res.status})`);
    }
    const data = await res.json();
    setUser(data.user);
    return data.user;
  }

  // 아이디/비밀번호 회원가입 — 가입과 동시에 로그인 상태가 됨(백엔드가 쿠키를 심음)
  // profile: { age, height_cm, weight_kg } — 회원가입 폼에서 입력받은 신체 정보
  async function signup(userId, password, profile = {}) {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        password,
        age: profile.age ?? null,
        height_cm: profile.height_cm ?? null,
        weight_kg: profile.weight_kg ?? null,
        invite_code: loadInviteCode(),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(
        data.detail || `회원가입에 실패했어요 (${res.status})`,
      );
      // 코드가 그새 만료·소진된 경우 — 가입 폼이 코드 입력 화면으로 되돌린다
      if (res.status === 403) err.needsInviteCode = true;
      throw err;
    }
    const data = await res.json();
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, idLogin, signup, logout, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

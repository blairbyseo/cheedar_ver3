/* 로그인 상태를 앱 전체에서 공유하기 위한 React Context.
 *
 * 동작:
 * - 앱 시작 시 GET /api/auth/me 한 번 호출해서 쿠키 기반 로그인 여부 확인
 * - user가 null이면 비로그인, 객체면 로그인됨
 * - 자식 컴포넌트는 useAuth() 훅으로 user/loading/login 등을 사용
 */
import { createContext, useContext, useEffect, useState } from "react";

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

  // 카카오 콜백에서 호출 — 백엔드가 쿠키를 set 한 뒤 user 객체를 돌려줌
  async function login(code, redirectUri) {
    const res = await fetch("/api/auth/kakao", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });
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
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `회원가입에 실패했어요 (${res.status})`);
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

/* 관리자 로그인 상태를 앱 전체에서 공유하는 Context.
 *
 * 사용자 앱의 AuthContext 와 같은 쿠키 기반 방식이지만, 한 가지가 다르다:
 * "로그인 됨" 만으로는 부족하고 반드시 is_admin === true 여야 한다.
 * 일반 회원이 같은 아이디로 로그인하면 곧바로 로그아웃시키고 막는다.
 */
import { createContext, useContext, useEffect, useState } from "react";

import { api } from "../api/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  // 앱 시작 시 한 번: 쿠키가 유효하고 관리자면 admin 채움, 아니면 null
  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setAdmin(me?.is_admin ? me : null);
      } catch {
        setAdmin(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 아이디/비밀번호 로그인 — 성공해도 관리자가 아니면 거부한다.
  async function login(userId, password) {
    const { user } = await api.login(userId, password);
    if (!user?.is_admin) {
      // 일반 회원이 로그인된 상태로 남지 않도록 쿠키를 즉시 비운다.
      await api.logout().catch(() => {});
      throw new Error("관리자 권한이 없는 계정이에요.");
    }
    setAdmin(user);
    return user;
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      setAdmin(null);
    }
  }

  return (
    <AuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

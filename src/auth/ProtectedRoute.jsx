/* 로그인된 사용자만 접근할 수 있는 라우트 보호 컴포넌트.
 * - 부팅 중(loading)이면 빈 화면(로딩)
 * - 로그인 안 됨이면 /login 으로 자동 이동
 * - 로그인됨이면 children 렌더 */
import { Navigate } from "react-router-dom";

import { useAuth } from "./AuthContext";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-tagline">불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default ProtectedRoute;

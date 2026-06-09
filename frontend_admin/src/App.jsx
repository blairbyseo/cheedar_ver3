import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import SafetyEvents from "./pages/SafetyEvents";
import UserDetail from "./pages/UserDetail";
import UserManagement from "./pages/UserManagement";

// 로그인(관리자)된 경우에만 사이드바 + 본문 레이아웃을 보여준다.
function AdminLayout({ children }) {
  return (
    <div className="admin-shell">
      <Sidebar />
      <main className="admin-main">{children}</main>
    </div>
  );
}

// 관리자가 아니면 로그인 페이지로 보낸다.
function RequireAdmin({ children }) {
  const { admin, loading } = useAuth();
  if (loading) return <div className="page-loading">불러오는 중…</div>;
  if (!admin) return <Navigate to="/login" replace />;
  return <AdminLayout>{children}</AdminLayout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAdmin>
            <Dashboard />
          </RequireAdmin>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAdmin>
            <UserManagement />
          </RequireAdmin>
        }
      />
      <Route
        path="/safety"
        element={
          <RequireAdmin>
            <SafetyEvents />
          </RequireAdmin>
        }
      />
      <Route
        path="/users/:userId"
        element={
          <RequireAdmin>
            <UserDetail />
          </RequireAdmin>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

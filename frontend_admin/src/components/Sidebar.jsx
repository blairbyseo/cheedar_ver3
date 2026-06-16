import { AlertTriangle, LayoutDashboard, LogOut, Users, Wallet } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/", label: "대시보드", icon: LayoutDashboard, end: true },
  { to: "/users", label: "회원 관리", icon: Users, end: false },
  { to: "/safety", label: "위험 신호", icon: AlertTriangle, end: false },
  { to: "/rewards", label: "현금 보상 신청", icon: Wallet, end: false },
];

export default function Sidebar() {
  const { admin, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">Cheddar</span>
        <span className="sidebar-brand-tag">admin</span>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `sidebar-link${isActive ? " active" : ""}`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-name">{admin?.user_id}</span>
          <span className="sidebar-user-role">관리자</span>
        </div>
        <button className="sidebar-logout" onClick={logout}>
          <LogOut size={16} />
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  );
}

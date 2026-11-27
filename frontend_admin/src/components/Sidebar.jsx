import {
  Activity,
  AlertTriangle,
  ExternalLink,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { api } from "../api/api";

import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/", label: "대시보드", icon: LayoutDashboard, end: true },
  { to: "/users", label: "회원 관리", icon: Users, end: false },
  { to: "/health", label: "건강 데이터", icon: Activity, end: false },
  { to: "/safety", label: "위험 신호", icon: AlertTriangle, end: false },
  { to: "/rewards", label: "현금 보상 신청", icon: Wallet, end: false },
  { to: "/inquiries", label: "문의하기", icon: MessageSquare, end: false },
  { to: "/invite-codes", label: "초대코드", icon: Ticket, end: false },
];

export default function Sidebar() {
  const { admin, logout } = useAuth();
  // 구글시트 주소는 공개 번들에 넣지 않고 서버(.env)에서 받아온다. 설정 안 됐으면 버튼 숨김.
  const [sheetUrl, setSheetUrl] = useState(null);
  useEffect(() => {
    api
      .links()
      .then((l) => setSheetUrl(l.google_sheet_url))
      .catch(() => setSheetUrl(null));
  }, []);

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
        {sheetUrl && (
          <a className="sidebar-link" href={sheetUrl} target="_blank" rel="noopener noreferrer">
            <FileSpreadsheet size={18} />
            <span>구글시트 연결</span>
            <ExternalLink size={13} className="sidebar-link-ext" />
          </a>
        )}
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

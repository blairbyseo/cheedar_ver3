/*2. App.jsx — 라우팅 + 인증 컨텍스트의 루트 */

import './App.css'
import './Point.css'
import './Chat.css'
import './Diet.css'
import './Settings.css'
import './Login.css'
import './Ranking.css'

import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';

import Home from './tab_pages/Home';
import Diet from './tab_pages/Diet';
import Chat from './tab_pages/Chat';
import Point from './tab_pages/Point';
import Settings from './tab_pages/Settings';
import Ranking from './tab_pages/Ranking';
import TabBar from './TabBar';

import { AuthProvider } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import SignupPage from './auth/SignupPage';
import OAuthKakaoCallback from './auth/OAuthKakaoCallback';
import ProtectedRoute from './auth/ProtectedRoute';

/* 로그인 이후 보여줄 메인 화면 — 탭 5개 + 하단 TabBar */
function MainShell() {
  const [activeTab, setActiveTab] = useState("home");

  return (
    <div className="app">
      <div className="wholescreen">
        {activeTab === "home"     && <Home setActiveTab={setActiveTab} />}
        {activeTab === "diet"     && <Diet />}
        {activeTab === "chat"     && <Chat />}
        {activeTab === "point"    && <Point />}
        {activeTab === "settings" && <Settings />}
        {/* 랭킹 — 홈의 "랭킹" 카드에서 진입. 탭바에는 없고 자체 뒤로가기 사용 */}
        {activeTab === "ranking"  && <Ranking onBack={() => setActiveTab("home")} />}
      </div>
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/oauth/kakao/callback" element={<OAuthKakaoCallback />} />
        <Route
          path="/*"
          element={
            /* TEMP-PREVIEW-BYPASS: 스크린샷 확인용 인증 우회 — 되돌릴 것 */
            <MainShell />
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;

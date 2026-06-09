/*2. App.jsx — 라우팅 + 인증 컨텍스트의 루트 */

import './App.css'
import './Point.css'
import './Chat.css'
import './Diet.css'
import './Settings.css'
import './Login.css'
import './Ranking.css'
import './WeeklyReport.css'
import './Exercise.css'

import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';

import Home from './tab_pages/Home';
import Diet from './tab_pages/Diet';
import Chat from './tab_pages/Chat';
import Point from './tab_pages/Point';
import Settings from './tab_pages/Settings';
import Ranking from './tab_pages/Ranking';
import WeeklyReport from './tab_pages/WeeklyReport';
import TabBar from './TabBar';

import Survey from './survey/Survey';
import { getNextSurvey } from './utils/survey';

import { AuthProvider } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import SignupPage from './auth/SignupPage';
import OAuthKakaoCallback from './auth/OAuthKakaoCallback';
import ProtectedRoute from './auth/ProtectedRoute';

/* 로그인 이후 보여줄 메인 화면 — 탭 5개 + 하단 TabBar */
function MainShell() {
  const [activeTab, setActiveTab] = useState("home");

  // 설문 게이트: 로그인 후 첫 진입 시 띄워야 할 설문(온보딩/주기)이 있는지 확인.
  // due 가 있으면 탭 화면 대신 설문을 전체화면으로 보여주고, 완료되면 홈으로 돌아간다.
  // (비로그인/스크린샷 우회 상태에서는 /api/survey/next 가 401 → 그냥 무시)
  const [surveyData, setSurveyData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getNextSurvey();
        if (!cancelled && data?.due && data?.schema_json) {
          setSurveyData(data);
        }
      } catch {
        // 띄울 설문 없음 또는 비로그인 — 무시하고 메인 화면 진행
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (surveyData) {
    return <Survey data={surveyData} onDone={() => setSurveyData(null)} />;
  }

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
        {/* 주간 리포트 — 홈의 "주간 피드백 리포트" 카드에서 진입. 자체 뒤로가기 사용 */}
        {activeTab === "report"   && <WeeklyReport onBack={() => setActiveTab("home")} />}
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

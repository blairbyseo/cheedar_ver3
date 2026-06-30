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

import { useEffect, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';

import Home from './tab_pages/Home';
import Diet from './tab_pages/Diet';
import Chat, { WELCOME_MESSAGE } from './tab_pages/Chat';
import Point from './tab_pages/Point';
import Settings from './tab_pages/Settings';
import Ranking from './tab_pages/Ranking';
import WeeklyReport from './tab_pages/WeeklyReport';
import TabBar from './TabBar';

import Survey from './survey/onboarding/OnboardingSurvey';
import { getNextSurvey } from './utils/survey';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { useTabTelemetry } from './useTabTelemetry';
import LoginPage from './auth/LoginPage';
import SignupPage from './auth/SignupPage';
import OAuthKakaoCallback from './auth/OAuthKakaoCallback';
import ProtectedRoute from './auth/ProtectedRoute';

/* 로그인 이후 보여줄 메인 화면 — 탭 5개 + 하단 TabBar */
function MainShell() {
  const [activeTab, setActiveTab] = useState("home");
  // 로그인한 사용자 닉네임 — 설문 Welcome 인사("OO님, 반가워요!")에 쓴다.
  const { user } = useAuth();

  // 탭 전환을 페이지 이동으로 계측 — 관리자 분석(페이지 소요시간/동선)용 샘플 적재.
  // (hook 규칙상 surveyData 조기 return 보다 위에서 호출해야 한다.)
  useTabTelemetry(activeTab);

  // ── 채팅 상태를 여기(부모)로 끌어올림 ──────────────────────────────
  // MainShell 은 탭을 바꿔도 언마운트되지 않으므로, 채팅 탭을 떠났다 돌아와도
  // 인삿말·로딩 표시·진행 중인 답변이 그대로 유지된다.
  const [chatMessages, setChatMessages] = useState([WELCOME_MESSAGE]);
  const [chatIsSending, setChatIsSending] = useState(false);
  const [chatErrorText, setChatErrorText] = useState("");
  const [chatDraft, setChatDraft] = useState("");

  // 기존 대화 이력은 앱 진입 시 딱 한 번만 불러온다. (Chat 재마운트마다 불러오면 덮어씀)
  const chatInitRef = useRef(false);
  useEffect(() => {
    if (chatInitRef.current) return;
    chatInitRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/chat/messages?limit=50", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`history ${res.status}`);
        const history = await res.json();
        if (history.length > 0) setChatMessages(history);
      } catch (err) {
        console.error("[Chat] init failed:", err);
        setChatErrorText("서버 연결에 실패했어요. 백엔드가 켜져 있는지 확인해주세요.");
      }
    })();
  }, []);

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
    return (
      <Survey
        data={{ ...surveyData, user_name: user?.nickname || "" }}
        onDone={() => setSurveyData(null)}
      />
    );
  }

  return (
    <div className="app">
      <div className="wholescreen">
        {activeTab === "home"     && <Home setActiveTab={setActiveTab} />}
        {activeTab === "diet"     && <Diet />}
        {activeTab === "chat"     && (
          <Chat
            messages={chatMessages}
            setMessages={setChatMessages}
            isSending={chatIsSending}
            setIsSending={setChatIsSending}
            errorText={chatErrorText}
            setErrorText={setChatErrorText}
            draft={chatDraft}
            setDraft={setChatDraft}
          />
        )}
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
            /* 로그인한 사용자만 메인 앱 사용 가능. 비로그인 시 /login 으로 이동. */
            <ProtectedRoute>
              <MainShell />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;

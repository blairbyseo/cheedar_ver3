import { ChatIcon } from "./icons/ChatIcon";
import { CoinIcon } from "./icons/CoinIcon";
import { Home, Settings } from "lucide-react";
import { DiaryIcon } from "./icons/DiaryIcon";


function TabBar({ activeTab, setActiveTab }) {
  return (
    <nav className="tabs">
     {/*1. 홈버튼*/}
      <button
        className={activeTab === "home" ? "active" : ""}
        onClick={() => setActiveTab("home")}  
      > {/*버튼을 클릭하면 setActiveTab 함수가 실행됨*/}

        <div><Home color={activeTab=="home" ? "#FFB300" : "#9CA3AF"} /></div>
        {/*activeTab === "home"이 참이면 Home color (아이콘 색깔)이 노란색으로 바뀌고, 거짓이면 회색*/}
        <div>홈</div>
      </button>
      
     {/*2. 포인트버튼*/}
      <button
        className={activeTab === "point" ? "active" : ""}
        onClick={() => setActiveTab("point")}
      >
        <div><CoinIcon active={activeTab === "point"} /></div>
        <div>포인트</div>
      </button>
      
    {/*3. 식단버튼*/}
      <button
        className={activeTab === "diet" ? "active diet-tab" : "diet-tab"}
        onClick={() => setActiveTab("diet")} 
      >
        
        <div className="diet-floating-icon">
          {/* <span className="diet-plus-icon" /> */}
             <DiaryIcon active={true} /> 
            {/*DiaryIcon은 항상 “활성 상태”로 동작하도록 active={true}로 설정 -> 아이콘이 항상 노란색*/}
        </div>
        <div className="diet-label">기록</div>
      </button>

    {/*4. 대화버튼*/}
      <button
        className={activeTab === "chat" ? "active" : ""}
        onClick={() => setActiveTab("chat")}
      >
        <div><ChatIcon active={activeTab === "chat"} /></div>
        <div>대화</div>
      </button>

    {/*5. 설정버튼*/}
      <button
        className={activeTab === "settings" ? "active" : ""}
        onClick={() => setActiveTab("settings")}
      >
        <div><Settings color={activeTab=="settings" ? "#FFB800" : "#9CA3AF"} /></div>
        <div>설정</div>
      </button>
    </nav>
  );
}

export default TabBar 
// 이 파일에서 TabBar를 다른 파일에서 쓸 수 있게 내보낸다
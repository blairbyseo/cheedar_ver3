/*2. App.jsx*/

import './App.css'
import './Point.css'
import './Chat.css'
import './Diet.css'
import './Settings.css'
import { useState } from 'react';
import Home from './tab_pages/Home';
import Diet from './tab_pages/Diet';
import Chat from './tab_pages/Chat';
import Point from './tab_pages/Point';
import Settings from './tab_pages/Settings';
import TabBar from './TabBar';

/*App이라는 React 컴포넌트를 만듦*/
function App() { 
  const [activeTab, setActiveTab] = useState("home");
  /*const[a,b] = useState("home") 꼴로 정의 내리는 코드*/
  /*useState: React에서 값을 기억하게 해주는 기능. 여기서는 "현재 어떤 탭이 선택되어 있는지"를 기억하고 있음.*/

  return (
    <div className="app">
      <div className="wholescreen">
        {activeTab === "home"&& <Home setActiveTab={setActiveTab} />} {/*activeTab === "home"이 참이면 <Home />이 화면에 나와. setActiveTab={setActiveTab}는 Home 컴포넌트에게 setActiveTab 함수를 전달하는 것*/}
        {activeTab === "diet" && <Diet />}
        {activeTab === "chat" && <Chat />}
        {activeTab === "point" && <Point />}
        {activeTab === "settings" && <Settings />}
      </div>

      {/*하단탭: 위에서 activetab 정의한 것을 TabBar.jsx 파일로 넘겨줌*/}
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>


    );
}

export default App;

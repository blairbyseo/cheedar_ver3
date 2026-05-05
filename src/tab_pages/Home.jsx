/*5-1. Home.jsx: App.jsx 파일에 걸림*/
import TalkingCharacter from "../TalkingCharacter";
import {RankingIcon} from "../charticons/RankingIcon";
import {BadgeIcon} from "../charticons/BadgeIcon";
import {ChatIcon} from "../charticons/ChatIcon";

function Home({setActiveTab}) {
  const point = 1040; // 현재 포인트 (예시로 1040점 설정)
  const streak = 3; // 연속 기록 일수 (예시로 4일 설정)
  const remainingDays = 7 - streak;
  const days = ["월", "화", "수", "목", "금", "토", "일"];
  /* const mealStatusText = "아침 완료 · 점심 미기록 · 저녁 예정"; */
  
  // 오늘
  const now = new Date();

  const month = now.getMonth() + 1;
  const date = now.getDate();

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const day = dayNames[now.getDay()];

  const today = new Date().getDay(); // 월0 화1 수2 목3 금4 토5 일6
  const todayIndex = today === 0 ? 6 : today - 1; // 0(월) ~ 6(일)로 변환
  // 일요일이면 6, 아니면 -1 해서 월요일부터 시작하도록


  let image = "/cheese/sleeping.svg"; // 디폴트 이미지
  let message = "오늘 식단을 기록해볼까요?"; // 기본 메시지
  let variant = "sleeping";

  if (streak>=6) {
    image = "/cheese/happy_smile.svg";
    variant = "happy-smile";
    message = `와~ 6일 연속이네요! 대단해요!`;
  } else if (streak >= 4) {
    image = "/cheese/happy_normal.svg";
    variant = "happy-normal";
    message =`${remainingDays}일만 더 기록하고 \n 포인트 받아가요!`;
  } else if (streak >= 1) {
    image = "/cheese/normal.svg";
    variant = "normal";
    message = "시작이 좋아요! 계속 달려봐요!";
  }

  return (
    <div className="home-page">
      <div className="hero-bg">
      <header className = "home-header">
        <h1 className="home-logo">Cheddar</h1>

        <div className="point-summary">
          <span className="point-badge">P</span>
          <strong>{point.toLocaleString()}</strong>
        </div>
      </header>
      </div>
      
      <br />
      <section className="welcome-card">
        <div className = "mouse-image">
          <TalkingCharacter image={image} streak={streak} variant={variant} />
        </div>

        <div className="welcome-content">
          <h2>오늘의 식단관리</h2>
          <p className = "welcome-content-sub">체다님 ! 점심 기록이 아직 비어 있어요</p>

          <div className="meal-status">
            아침 완료 · <span className="highlight">점심 미기록</span> · 저녁 예정
          </div>
          {/* <p>{message}</p> */}

          <div className="welcome-buttons">
            <button onClick={()=>setActiveTab("diet")}>식단 기록하기</button> 
          </div>

            {/* <button className="feedback-button"
              onClick={() => setActiveTab("point")}> 주간리포트 </button> */}
        </div> {/* setActiveTab("point")는 임시. 추후 주간 리포트 페이지에 연결. */}
      </section>


      <section className="point-card">
        <div className="level-badge">Lv.7</div>
        <strong>1,240</strong>
        <span>XP</span>
        <p>다음 레벨까지 70%</p>
        <div className="progress-bar">
          <div className="progress-fill"></div>
        </div>
      
        <section className="week-row">
            {days.map((day, index) => {
              const isChecked = index <= todayIndex && index >= todayIndex - (streak - 1);

              return (
                <div className="day-item" key={day}>
                  <span>{day}</span>
                  <div className={isChecked ? "day-circle checked" : "day-circle"}>
                    ✓
                  </div>
                </div>
              );
            })}
          </section>
      </section>
    <section className="menus">
      <div className="menu-card menu-rank">
        <h3>랭킹</h3>
        <p>병원 내 랭킹<br /> 확인하기</p>
        {/* <RankingIcon /> */}
      </div>

      <div className="menu-card menu-point" onClick={() => setActiveTab("point")} role="button" tabIndex={0}>
        <h3>포인트</h3>
        <p>누적 포인트 <br />확인하기</p>
        {/* <BadgeIcon /> */}
      </div>

      <div className="menu-card menu-chat" onClick={() => setActiveTab("chat")} role="button" tabIndex={0}>
        <h3>채팅</h3>
        <p>체다 AI와<br/> 대화하기</p>
        {/* <ChatIcon /> */}
      </div>

    </section>

    <section className="menu-card2 feedback" role="button" tabIndex={0}>
      <h3>주간 피드백 리포트</h3>
    </section>
    </div>
  )
}

export default Home
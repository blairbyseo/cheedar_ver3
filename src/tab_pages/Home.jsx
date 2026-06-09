/*5-1. Home.jsx: App.jsx 파일에 걸림*/
import TalkingCharacter from "../TalkingCharacter";
import {RankingIcon} from "../charticons/RankingIcon";
import {BadgeIcon} from "../charticons/BadgeIcon";
import {ChatIcon} from "../charticons/ChatIcon";
import { usePoints } from "../usePoints";
import { useTodayStatus } from "../useTodayStatus";

// 헤더 멘트·끼니 현황 줄에서 쓰는 끼니 한글 표기.
const MEAL_KR = { breakfast: "아침", lunch: "점심", dinner: "저녁" };
// 끼니별 시간대 시작 시각 — 현재 시각이 이보다 이르면 아직 '예정'.
const MEAL_SLOT_START = { breakfast: 0, lunch: 11, dinner: 17 };

function Home({setActiveTab}) {
  const days = ["월", "화", "수", "목", "금", "토", "일"];
  /* const mealStatusText = "아침 완료 · 점심 미기록 · 저녁 예정"; */

  // 포인트/경험치 — 헤더와 포인트 카드에는 포인트(CP)를, 카드 배지에는
  // XP로 계산된 레벨을 표시한다. XP 숫자 자체는 화면에 노출하지 않는다.
  const points = usePoints();
  const point = points?.cp ?? 0;                    // 포인트(CP) — 헤더·카드 공통
  const level = points?.level ?? 1;                 // XP로 계산된 레벨
  const levelPct = Math.round((points?.level_progress ?? 0) * 100);

  // 이번 주 기록 현황 — 같은 GET /api/points/me 응답에서 함께 온다.
  //   weekRecordDays   : 이번 주에 식단을 기록한 날 수(0~7). 캐릭터 단계 기준.
  //   recordedWeekdays : 기록한 요일 인덱스 목록(0=월 … 6=일). 요일 체크 표시용.
  const weekRecordDays = points?.week_record_days ?? 0;
  const recordedWeekdays = points?.week_record_weekdays ?? [];
  const remainingDays = 7 - weekRecordDays;

  // 오늘
  const now = new Date();
  const hour = now.getHours();

  const month = now.getMonth() + 1;
  const date = now.getDate();

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const day = dayNames[now.getDay()];

  // 오늘 끼니별 기록 현황 — GET /api/meals/today/status.
  //   { breakfast: "done"|"missing", lunch: …, dinner: …, snack: … }
  const todayStatus = useTodayStatus();
  const isMealDone = (type) => todayStatus?.[type] === "done";

  // 지금 시간대의 끼니 — 헤더 멘트가 가리킬 끼니.
  //   ~11시 아침 / 11~17시 점심 / 17시~ 저녁
  const currentMeal = hour < 11 ? "breakfast" : hour < 17 ? "lunch" : "dinner";

  // 헤더 서브 멘트 — "{아이디}님!" + 지금 시간대(아침/점심/저녁)에 맞는 인사말.
  // 끼니별로 인사말 후보를 두고, 날짜로 골라 매일 문구가 살짝 달라지게 한다.
  const GREETINGS = {
    breakfast: [
      "좋은 아침이에요~ 오늘도 힘차게 시작해봐요",
      "바빠도 아침은 꼭 챙겨드셔해요",
      "상쾌한 아침이에요~ 가볍게 한 끼 어때요?",
      "아침 식사로 든든하게 하루를 깨워봐요~",
    ],
    lunch: [
      "점심 맛있게 드세요~",
      "든든한 점심으로 오후도 힘내봐요~",
      "오전도 수고했어요~ 점심 챙기는 거 잊지 마세요",
      "점심 한 끼로 에너지 채워봐요!",
    ],
    dinner: [
      "오늘 하루도 고생 많으셨어요",
      "저녁은 가볍게, 하루는 든든하게 마무리해요~",
      "편안한 저녁 보내세요~ 오늘도 잘하셨어요",
      "하루의 마지막 식사, 천천히 즐겨봐요",
    ],
  };
  const userName = points?.user_id;
  // 지금 시간대의 인사말 후보 중 오늘 날짜로 하나 선택 (매일 조금씩 바뀜).
  const greetingPool = GREETINGS[currentMeal];
  const greeting = greetingPool[date % greetingPool.length];

  // 끼니별 상태 라벨 — 기록했으면 '완료', 아직 그 시간대 전이면 '예정',
  // 시간대가 지났는데 기록이 없으면 '미기록'.
  const mealStateLabel = (type) => {
    if (isMealDone(type)) return "완료";
    if (hour < MEAL_SLOT_START[type]) return "예정";
    return "미기록";
  };

  let image = "/cheese/sleeping.svg"; // 디폴트 이미지
  let message = "오늘 식단을 기록해볼까요?"; // 기본 메시지
  let variant = "sleeping";

  // 캐릭터·메시지는 '이번 주 기록 일수'에 따라 단계가 바뀐다.
  if (weekRecordDays >= 6) {
    image = "/cheese/happy_smile.svg";
    variant = "happy-smile";
    message = `와~ 이번 주 ${weekRecordDays}일이나 기록했네요! 대단해요!`;
  } else if (weekRecordDays >= 4) {
    image = "/cheese/happy_normal.svg";
    variant = "happy-normal";
    message =`${remainingDays}일만 더 기록하고 \n 포인트 받아가요!`;
  } else if (weekRecordDays >= 1) {
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

      <section className="welcome-card">
        <div className = "mouse-image">
          <TalkingCharacter image={image} streak={weekRecordDays} variant={variant} />
        </div>

        <div className="welcome-content">
          <div className="welcome-bubble">
            <h2>{userName ? `${userName}님` : "오늘의 식단관리"}</h2>
            <p className="welcome-content-sub">{greeting}</p>
          </div>
          {/* <p>{message}</p> */}

          { /*div className="welcome-buttons">
            <button onClick={()=>setActiveTab("diet")}>식단 기록하기</button>
          </div>
          */}
            {/* <button className="feedback-button"
              onClick={() => setActiveTab("point")}> 주간리포트 </button> */}
        </div> {/* setActiveTab("point")는 임시. 추후 주간 리포트 페이지에 연결. */}
      </section>


      <section className="point-card">
        {/* 기존 UI 그대로 — 큰 숫자는 포인트(CP), 배지는 레벨.
            XP 숫자는 노출하지 않고 레벨 계산에만 쓰인다. */}
        <div className="level-badge">Lv.{level}</div>
        <strong>{point.toLocaleString()}</strong>
        <span>P</span>
        <p>다음 레벨까지 {levelPct}%</p>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${levelPct}%` }}></div>
        </div>

        <section className="week-row">
            {days.map((day, index) => {
              // 백엔드가 준 '기록한 요일' 목록에 들어 있으면 체크.
              // index 0=월 … 6=일 — week_record_weekdays 와 같은 기준.
              const isChecked = recordedWeekdays.includes(index);

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
      <div className="menu-card menu-rank" onClick={() => setActiveTab("ranking")} role="button" tabIndex={0}>
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

    <section
      className="menu-card2 feedback"
      role="button"
      tabIndex={0}
      onClick={() => setActiveTab("report")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setActiveTab("report");
      }}
    >
      <h3>주간 피드백 리포트</h3>
    </section>
    </div>
  )
}

export default Home

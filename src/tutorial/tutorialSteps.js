/* 튜토리얼(기능 안내) 내용과 '봤는지' 기록.
 *
 * 문구를 고치거나 단계를 더하려면 아래 TUTORIAL_STEPS 만 바꾸면 된다.
 *   target : 비출 화면 요소. 그 요소에 data-tour="이 값" 이 붙어 있어야 한다
 *            (탭 버튼은 TabBar.jsx, 홈 말풍선·랭킹·주간 리포트 카드는 Home.jsx).
 *   when   : 있으면 true 일 때만 그 단계를 보여 준다(예: 앱에서만).
 *
 * 누구에게 뜨나: 이 기기에서 아직 TUTORIAL_VERSION 을 못 본 사람.
 *   - 새로 가입한 사람(기록 없음)과, 이 기능이 처음 들어간 버전으로 업데이트한 사람 모두 한 번 본다.
 *   - 나중에 새 기능을 안내하려면 TUTORIAL_VERSION 을 1 올린다 → 모두에게 한 번 더 뜬다.
 * 설정 > 기타 > '앱 사용법 다시 보기'로 언제든 다시 볼 수 있다.
 */
import { isHealthSupported } from "../health/healthData";

export const TUTORIAL_VERSION = 1;
const SEEN_KEY = "cheddar.tutorial.seen"; // 마지막으로 본 TUTORIAL_VERSION

export const TUTORIAL_STEPS = [
  {
    target: "home-greeting",
    title: "걸음수와 수면",
    body: "휴대폰이 잰 걸음수와 어젯밤 수면을 체다가 여기서 알려줘요.\n설정의 '건강 데이터'에서 언제든 켜고 끌 수 있어요.",
    when: () => isHealthSupported(), // 걸음수·수면은 안드로이드 앱에서만 잰다(iOS 는 아직 끔)
  },
  {
    target: "home-ranking",
    title: "랭킹",
    body: "병원 안에서 내 순위를 볼 수 있어요.\n기록으로 쌓은 경험치로 순위가 정해져요.",
  },
  {
    target: "home-report",
    title: "주간 피드백 리포트",
    body: "한 주의 식단·운동 기록을 모아 보고, 체다의 한마디를 받아요.\n지난 주와 비교도 할 수 있어요.",
  },
  {
    target: "tab-point",
    title: "포인트",
    body: "기록할 때마다 포인트가 쌓여요.\n적립 내역과 기준을 여기서 볼 수 있어요.",
  },
  {
    target: "tab-diet",
    title: "기록",
    body: "식단과 운동을 기록하는 곳이에요.\n날짜를 옮기면 지난 기록도 볼 수 있어요.",
  },
  {
    target: "tab-chat",
    title: "대화",
    body: "오늘 기분을 고르면, 체다가 그 기분에 맞춰 이야기해요.",
  },
  {
    target: "tab-settings",
    title: "설정",
    body: "알림과 건강 데이터를 관리해요.\n이 안내는 설정에서 다시 볼 수 있어요.",
  },
];

export function activeTutorialSteps() {
  return TUTORIAL_STEPS.filter((s) => !s.when || s.when());
}

export function shouldShowTutorial() {
  try {
    return Number(localStorage.getItem(SEEN_KEY) || 0) < TUTORIAL_VERSION;
  } catch {
    return false; // 저장소를 못 쓰면 매번 뜨게 되므로 아예 띄우지 않는다
  }
}

export function markTutorialSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(TUTORIAL_VERSION));
  } catch {
    // 무시
  }
}

/* presentation — 프론트 전용 "표현 오버레이". 스키마(v3_schema.json)는 임상 단일
 * 소스(문항/옵션/분기)이고, 여기서는 아이콘·기본값·help·필드 메타·마스코트처럼
 * "보여주는 방법"만 question id 로 덧붙인다. (핸드오프 아키텍처 원칙)
 *
 * flow.js 가 스키마 문항 위에 이 값을 머지한다. 여기 없는 문항은 스키마 그대로
 * 렌더된다(아이콘 없는 기본 행 등) — 기능엔 문제 없음.
 *
 * 키:
 *   help        : 보조 설명
 *   optionIcons : { optionValue: 'solar:...' }  단일/다중 선택 행 아이콘
 *   optionDescs : { optionValue: '설명' }        카드형 보조설명
 *   card        : true  → 아이콘 카드(OptionCard)로 렌더 (F 류)
 *   def         : numeric/scale 표시 기본값(미상호작용 시 저장 안 함)
 *   labels      : { 0:'...', 10:'...' } scale 양 끝 / likert 오버라이드
 *   fields      : composite/bmi 의 표시 필드(label/icon/unit/def)
 *   sleepMascot : true → 우상단 sleep 마스코트
 *   tone        : 'calm'
 */
const STAGE = {
  A: "기본 정보", B: "몸과 마음", C: "마음 건강",
  D: "생활 습관", E: "나의 주변", F: "맞춤 설정",
};

export const PRESENTATION = {
  // ── A. 기본 정보 ──
  "A-1": { def: 16 },
  "A-2": {
    optionIcons: { male: "solar:men-linear", female: "solar:women-linear", no_answer: "solar:minus-circle-linear" },
  },
  "A-3": {
    help: "해당하는 걸 모두 골라요",
    optionIcons: {
      mother: "solar:heart-linear", father: "solar:user-linear",
      sibling: "solar:users-group-rounded-linear", grandparent: "solar:home-smile-linear",
      other: "solar:add-circle-linear",
    },
  },
  "A-6": { def: 9 },
  "A-7": {
    sleepMascot: true,
    fields: [
      { id: "sleep_time", label: "취침", icon: "solar:moon-stars-linear", def: "23:30" },
      { id: "wake_time", label: "기상", icon: "solar:sun-2-linear", def: "07:00" },
    ],
  },
  "A-10": { def: 6, labels: { 0: "안 좋아요", 10: "아주 좋아요" }, help: "0점부터 10점까지" },

  // ── B. 몸과 마음 (일부 데코) ──
  "B-1": {
    help: "BMI는 체다가 알아서 계산할게요",
    fields: [
      { id: "height", label: "키", unit: "cm", def: 168 },
      { id: "weight", label: "몸무게", unit: "kg", def: 58 },
    ],
  },
  "B-1b-1": { def: 5, labels: { 0: "많이 아쉬워요", 10: "만족해요" } },
  "B-2-1": { def: 6, labels: { 0: "전혀", 10: "엄청" } },
  "B-2-2": { def: 5, labels: { 0: "전혀", 10: "매우" } },
  "B-2-3": { def: 7, labels: { 0: "별로요", 10: "많이요" } },
  "B-2-4": {
    optionIcons: {
      body_mood: "solar:smile-circle-linear", family_worry: "solar:users-group-rounded-linear",
      doctor_recommend: "solar:stethoscope-linear", friends: "solar:hand-shake-linear",
      unknown: "solar:question-circle-linear",
    },
  },

  // ── D. 생활 습관 (scale 기본값) ──
  "D-1-1": { def: 5, labels: { 0: "전혀 불규칙", 10: "매우 규칙적" } },
  "D-2-1": { def: 4, labels: { 0: "전혀", 10: "매우" } },
  "D-3-3": { def: 5, labels: { 0: "매우 불만족", 10: "매우 만족" } },

  // ── E. 나의 주변 ──
  "E-1-1": { def: 3 },
  "E-1-5b": { help: "자랑해도 좋아요. 넘어가도 돼요", placeholder: "예: 한 달 동안 매일 줄넘기 성공" },

  // ── F. 맞춤 설정 (아이콘 카드) ──
  "F-1": {
    card: true, help: "하나만 골라요",
    optionIcons: {
      meal_pattern: "solar:plate-linear", binge: "solar:donut-bitten-linear",
      mood_food: "solar:heart-linear", sleep: "solar:moon-sleep-linear",
      exercise: "solar:running-linear", log_only: "solar:notebook-linear",
    },
    optionDescs: {
      meal_pattern: "들쭉날쭉한 끼니 잡기", binge: "멈추기 어려운 순간 돕기",
      mood_food: "마음과 먹는 것의 관계", sleep: "수면 리듬 정돈",
      exercise: "꾸준히 움직이기", log_only: "부담 없이 남기기",
    },
  },
  "F-2": {
    card: true, help: "하나만 골라요",
    optionIcons: {
      academic_stress: "solar:book-linear", family_conflict: "solar:home-linear",
      friend_loneliness: "solar:users-group-rounded-linear", medication_side_effect: "solar:pill-linear",
      body_appearance: "solar:user-circle-linear", nothing_special: "solar:check-circle-linear",
      unknown: "solar:question-circle-linear",
    },
    optionDescs: {
      academic_stress: "공부·시험 부담", family_conflict: "집에서의 마찰",
      friend_loneliness: "관계의 어려움", medication_side_effect: "약 때문에 힘듦",
      body_appearance: "몸과 외모 고민", nothing_special: "무난했어요",
    },
  },
};

export { STAGE };

/**
 * 운동 기록 유틸리티 — Cheddar_Team_26 의 utils/exercise.js 를 옮겨온 것.
 *
 * - 사전 MET lookup (백엔드 services/exercise.py EXERCISE_MET 과 동기화)
 * - 강도(1-10) → multiplier / 라벨 (백엔드 intensity_multiplier 와 동일)
 * - 단일 운동 칼로리 미리보기 계산 (서버가 저장 시 재계산하므로 표시용)
 * - 이모지 매핑
 */

// 사전 MET 매핑. 백엔드 _resolve_met / EXERCISE_MET 과 반드시 동기화.
const MET_MAP = {
  달리기: 9.8,
  자전거: 7.5,
  "웨이트 트레이닝": 6.0,
  수영: 8.0,
  "요가/필라테스": 3.0,
};

const EMOJI_MAP = {
  달리기: "🏃",
  자전거: "🚴",
  "웨이트 트레이닝": "🏋️",
  수영: "🏊",
  "요가/필라테스": "🧘",
};

// 빠른 선택용 추천 종목 목록 (사전 MET 가 있는 것들)
export const KNOWN_EXERCISES = Object.keys(MET_MAP);

// 사전에 등록된 운동명이면 MET 값 반환, 아니면 null (AI 추정 필요).
export const lookupKnownMet = (exerciseName) => {
  if (!exerciseName) return null;
  return MET_MAP[exerciseName.trim()] ?? null;
};

// 운동명에 대응하는 이모지 (없으면 기본 💪).
export const emojiForExercise = (exerciseName) => {
  return EMOJI_MAP[exerciseName?.trim()] ?? "💪";
};

// 강도 1-10 → MET multiplier (계단식, 백엔드와 동일).
export const intensityMultiplier = (intensity) => {
  const n = Number(intensity) || 0;
  if (n <= 3) return 0.7;
  if (n <= 6) return 1.0;
  if (n <= 8) return 1.2;
  return 1.4;
};

// 강도 숫자 → 라벨. 아주 편함(1-2)/편함(3-4)/보통(5-6)/힘듦(7-8)/최대(9-10).
export const intensityLabel = (intensity) => {
  const parsed = Number(intensity);
  const n = Number.isFinite(parsed) ? parsed : 5;
  if (n <= 2) return "아주 편함";
  if (n <= 4) return "편함";
  if (n <= 6) return "보통";
  if (n <= 8) return "힘듦";
  return "최대";
};

// 프론트 미리보기용 칼로리. 서버 저장 시 회원 체중으로 재계산되므로 표시 용도만.
export const estimateCalories = ({
  met,
  weightKg = 70,
  durationHours,
  durationMinutes,
  intensity,
}) => {
  const hours = Number(durationHours || 0) + Number(durationMinutes || 0) / 60;
  const mult = intensityMultiplier(intensity);
  const kcal = Number(met) * Number(weightKg) * hours * mult;
  return Math.round(kcal * 10) / 10;
};

// items 배열의 총 칼로리.
export const sumItemCalories = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.reduce(
    (acc, item) => acc + (Number(item?.calories_burned) || 0),
    0
  );
};

// 시/분 → "1시간 30분" 식 짧은 표기.
export const formatDurationShort = (hours, minutes) => {
  const h = Number(hours || 0);
  const m = Number(minutes || 0);
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
};

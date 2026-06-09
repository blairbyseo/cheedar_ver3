/* 위험 신호(SafetyEvent) 표시용 공통 라벨/색상.
 *
 * 백엔드 detected_category(예: survey_suicide_acute)와 risk_level(critical 등)을
 * 관리자 화면에서 사람이 읽기 좋은 한국어 라벨/색으로 바꾼다.
 */

// risk_level → 라벨 + 색 (index.css 토큰과 무관한 독립 색상 사용)
export const RISK = {
  critical: { label: "위급", color: "#dc2626", bg: "#fee2e2" },
  high: { label: "높음", color: "#ea580c", bg: "#ffedd5" },
  medium: { label: "중간", color: "#ca8a04", bg: "#fef9c3" },
  low: { label: "낮음", color: "#6b7280", bg: "#f3f4f6" },
};

// detected_category → 한국어 설명
export const CATEGORY_LABELS = {
  survey_suicide_acute: "자살 위험(급성)",
  survey_suicide_screen: "자살 선별 양성",
  survey_purging: "제거행동(purging)",
  survey_anorexia_candidate: "신경성 식욕부진 의심",
  survey_bed_candidate: "폭식장애 의심",
  survey_psychosis: "정신증 의심",
  survey_mania: "조증 의심",
};

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}

export function riskMeta(level) {
  return RISK[level] || RISK.low;
}

// 처리 상태 라벨
export const STATUS_LABELS = {
  unresolved: "미해결",
  reviewing: "확인 중",
  resolved: "처리완료",
};

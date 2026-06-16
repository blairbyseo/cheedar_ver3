/* 설문(Survey) API 클라이언트.
 *
 * 백엔드 라우터: server/app/routers/survey.py (prefix /api/survey).
 * 이 프로젝트의 다른 호출들과 동일하게 axios 가 아니라 fetch + 쿠키 인증
 * (credentials: "include") 을 쓴다.
 */

/* 현재 사용자에게 띄울 설문을 조회.
 *
 * @returns {Promise<{
 *   due: 'onboarding' | 'recurring' | null,
 *   response_id?: number,
 *   schema_id?: number,
 *   schema_version?: string,
 *   schema_json?: object,
 *   current_section?: string | null,
 *   answers?: object,
 *   prefilled_answers?: object,
 *   reward_points?: number,   // 완료 시 받는 포인트 — 진행 중 독려 안내에 사용
 * }>}
 */
export async function getNextSurvey() {
  const res = await fetch("/api/survey/next", { credentials: "include" });
  if (!res.ok) throw new Error(`survey/next ${res.status}`);
  return res.json();
}

/* 진행 중 설문에 부분 응답을 저장(섹션 단위 autosave).
 *
 * @param {number} responseId
 * @param {{ answers: object, currentSection?: string|null }} params
 *   answers: 변경분만 보내도 서버가 기존 위에 merge.
 * @returns {Promise<{ response_id, current_section, updated_at }>}
 */
export async function saveSurveyProgress(responseId, { answers, currentSection } = {}) {
  const res = await fetch(`/api/survey/${responseId}/progress`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answers: answers || {},
      current_section: currentSection ?? null,
    }),
  });
  if (!res.ok) throw new Error(`survey/progress ${res.status}`);
  return res.json();
}

/* 설문 최종 제출. 백엔드가 scoring → derived_flags 저장 →
 * User.onboarded / last_survey_at 갱신 → SafetyEvent 적재 수행.
 *
 * @param {number} responseId
 * @returns {Promise<{ response_id, derived_flags, completed_at, points_awarded }>}
 *   points_awarded: 이번 제출로 새로 적립된 포인트(설문 완료 = 50).
 */
export async function submitSurvey(responseId) {
  const res = await fetch(`/api/survey/${responseId}/submit`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`survey/submit ${res.status}`);
  return res.json();
}

/**
 * 설문 분기(branching) 평가기.
 *
 * SurveySchema.schema_json 의 question 에 붙은 show_if / show_if_any /
 * show_if_all / show_if_sum DSL 을 평가해서 해당 문항을 표시할지 결정.
 *
 * 백엔드 services/survey/v3_schema.json 의 branching_dsl 키와 동일 의미를 가진다.
 * 추가/변경 시 양쪽 동기화 필요.
 */

/** answers 에서 특정 question_id 의 값을 정규화해서 반환. */
function getAnswerValue(answers, questionId) {
  if (!answers) return undefined;
  return answers[questionId];
}

/** 단일 조건 평가: {question_id, op, value}. */
export function evaluateCondition(cond, answers) {
  if (!cond || typeof cond !== 'object') return true;
  const { question_id: qid, op, value } = cond;
  const actual = getAnswerValue(answers, qid);

  switch (op) {
    case '==':
      return actual === value;
    case '!=':
      return actual !== value;
    case '<':
      return Number(actual) < Number(value);
    case '<=':
      return Number(actual) <= Number(value);
    case '>':
      return Number(actual) > Number(value);
    case '>=':
      return Number(actual) >= Number(value);
    case 'in':
      return Array.isArray(value) && value.includes(actual);
    case 'contains':
      return Array.isArray(actual) && actual.includes(value);
    case 'row_checked':
      // checklist_with_frequency 전용: actual = {rows: {row_id: {checked, frequency}}}
      return Boolean(actual?.rows?.[value]?.checked);
    default:
      return true;
  }
}

/** show_if_sum 평가: {question_ids:[...], op, value}. likert_0_3 합산 비교. */
export function evaluateSum(cond, answers) {
  if (!cond || !Array.isArray(cond.question_ids)) return true;
  const sum = cond.question_ids.reduce((acc, qid) => {
    const v = Number(getAnswerValue(answers, qid));
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  const target = Number(cond.value);
  switch (cond.op) {
    case '<': return sum < target;
    case '<=': return sum <= target;
    case '>': return sum > target;
    case '>=': return sum >= target;
    case '==': return sum === target;
    case '!=': return sum !== target;
    default: return true;
  }
}

/**
 * 문항을 표시해야 하는지 결정.
 * 분기 키가 하나도 없으면 항상 표시.
 *
 * @param {object} question - schema_json 의 questions[] 한 개
 * @param {object} answers - 현재 누적 응답
 * @returns {boolean}
 */
export function shouldShowQuestion(question, answers) {
  if (!question) return false;

  if (question.show_if && !evaluateCondition(question.show_if, answers)) {
    return false;
  }
  if (Array.isArray(question.show_if_all)) {
    const allPass = question.show_if_all.every((c) => evaluateCondition(c, answers));
    if (!allPass) return false;
  }
  if (Array.isArray(question.show_if_any)) {
    const anyPass = question.show_if_any.some((c) => evaluateCondition(c, answers));
    if (!anyPass) return false;
  }
  if (question.show_if_sum && !evaluateSum(question.show_if_sum, answers)) {
    return false;
  }
  return true;
}

/** 한 섹션에서 표시할 문항 배열만 필터링. */
export function visibleQuestions(section, answers) {
  if (!section?.questions) return [];
  return section.questions.filter((q) => shouldShowQuestion(q, answers));
}

/**
 * 설문 응답 완성도 검사.
 *
 * "이 문항에 답했는가?"를 타입별로 판정한다. 값의 모양이 타입마다 달라
 * (객관식=문자열, 다중선택=배열, BMI/수면=객체 …) 한 곳에 모아둔다.
 * 화면(Survey.jsx)은 이걸로 '다음/제출' 버튼을 막고 미응답을 표시한다.
 *
 * 검사에서 제외(항상 통과)하는 타입:
 *   - free_text                : 자유서술은 선택 입력.
 *   - checklist_with_frequency : '해당 없음(전부 미체크)'이 정상 응답이라
 *                                강제하면 잘못된 데이터가 된다(C-10 등).
 */

const OPTIONAL_TYPES = new Set(["free_text", "checklist_with_frequency"]);

/** 단순 값(문자열/숫자)이 '있다'고 볼 수 있는지 — 빈문자열/undefined/null 만 미응답. */
function hasValue(v) {
  return v !== undefined && v !== null && v !== "";
}

/**
 * 문항 1개에 답했는지 판정.
 * @param {object} question - schema_json 의 questions[] 한 개
 * @param {*} value - answers[question.id]
 * @returns {boolean}
 */
export function isAnswered(question, value) {
  if (!question) return true;
  if (OPTIONAL_TYPES.has(question.type)) return true;

  switch (question.type) {
    case "multi_select":
      // 최소 1개 선택해야 답한 것으로 본다.
      return Array.isArray(value) && value.length > 0;

    case "likert_0_3":
    case "scale_0_10":
      // 0 도 유효한 응답이므로 '숫자인지'로만 판정(슬라이더/리커트는 터치해야 값이 생김).
      return typeof value === "number" && Number.isFinite(value);

    case "composite":
      // 모든 하위 칸(예: 취침·기상)이 채워져야 답한 것.
      return (
        !!value &&
        (question.fields || []).every((f) => hasValue(value[f.id]))
      );

    case "bmi":
      // 키·몸무게 둘 다 있어야 함.
      return !!value && hasValue(value.height) && hasValue(value.weight);

    // numeric(허용 시 '모름' 센티넬 포함), single_select, yes_no, time …
    default:
      return hasValue(value);
  }
}

/**
 * 표시 중인 문항들 중 '아직 답하지 않은' 것의 id 목록.
 * @param {Array} questions - 현재 화면에 보이는 문항(visibleQuestions 결과)
 * @param {object} answers - 누적 응답
 * @returns {string[]}
 */
export function unansweredIds(questions, answers) {
  if (!Array.isArray(questions)) return [];
  return questions
    .filter((q) => !isAnswered(q, answers?.[q.id]))
    .map((q) => q.id);
}

/* __preview — 백엔드 없이 OnboardingSurvey 를 목 데이터로 띄우는 개발 전용 미리보기.
 * /onboarding-preview.html 로 접속. 스크린샷/디자인 확인용. 프로덕션 번들과 무관.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import schema from "../../../server/app/services/survey/v3_schema.json";
import OnboardingSurvey from "./OnboardingSurvey.jsx";

// 네트워크 스텁: progress/submit 호출이 에러 없이 통과하도록
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  if (typeof url === "string" && url.includes("/api/survey")) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, points_awarded: 50 }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return realFetch(url, opts);
};

// ?section=C 로 특정 섹션부터, ?name=지우 로 인사 이름 바꿔 미리보기
// ?due=recurring 으로 재설문(2주 주기) 축약본 미리보기 — 서버 필터와 같은 문항만 남긴다.
const RECURRING_IDS = new Set([
  "A-10", "B-2-1", "B-2-2", "B-2-3", "B-2-4", "C-1-1", "C-1-2",
  "C-9-1", "C-10", "C-11-1", "C-11-2", "C-11-3",
]);
const params = new URLSearchParams(window.location.search);
const due = params.get("due") === "recurring" ? "recurring" : "onboarding";
const previewSchema = due === "recurring"
  ? {
      ...schema,
      sections: schema.sections
        .map((s) => ({ ...s, questions: s.questions.filter((q) => RECURRING_IDS.has(q.id)) }))
        .filter((s) => s.questions.length > 0),
    }
  : schema;
const data = {
  due,
  response_id: 1,
  schema_json: previewSchema,
  current_section: params.get("section") || null,
  answers: {},
  prefilled_answers: {},
  reward_points: 50,
  user_name: params.get("name") || "유빈",
};

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <OnboardingSurvey data={data} onDone={() => console.log("[preview] done")} />
  </StrictMode>,
);

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
const params = new URLSearchParams(window.location.search);
const data = {
  due: "onboarding",
  response_id: 1,
  schema_json: schema,
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

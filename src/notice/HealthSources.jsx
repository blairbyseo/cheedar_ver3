/* 건강·영양 정보 참고 자료 (App Store 1.4.1 — 건강 정보에는 출처를 쉽게 찾을 수 있게 표시).
 *
 * 주의: AI(GPT)는 이 자료를 실제로 조회하지 않는다. 답변·칼로리는 모델의 일반 지식으로
 * 만든 추정이므로, 이 목록은 '사용자가 직접 확인할 수 있는 공식 자료'로만 소개한다.
 * "AI가 이 자료를 바탕으로 안내한다"처럼 사실과 다른 문구를 쓰지 말 것.
 * 대화 탭 면책 문구, 식단 분석 결과, 설정 탭에서 이 모달을 연다.
 * 출처를 바꾸면 서버 CHAT_SYSTEM_PROMPT(openai_client.py)의 출처 목록도 함께 맞출 것.
 */
import { useState } from "react";
import { createPortal } from "react-dom";

import { handleExternalClick } from "../openExternal";
import "./Notice.css";

const HEALTH_SOURCES = [
  {
    title: "2020 한국인 영양소 섭취기준",
    org: "보건복지부 · 한국영양학회",
    url: "https://www.kns.or.kr/",
    use: "하루 권장 열량·영양소 기준 확인",
  },
  {
    title: "식품영양성분 데이터베이스",
    org: "식품의약품안전처",
    url: "https://various.foodsafetykorea.go.kr/nutrient/",
    use: "음식별 영양성분(칼로리·탄수화물·단백질·지방) 확인",
  },
  {
    title: "국가건강정보포털",
    org: "질병관리청",
    url: "https://health.kdca.go.kr/healthinfo/",
    use: "식생활·생활습관 건강 정보 확인",
  },
  {
    title: "Healthy diet (건강한 식단)",
    org: "세계보건기구(WHO)",
    url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
    use: "균형 잡힌 식사·당·나트륨 섭취 권고 확인",
  },
  {
    title: "Physical activity (신체활동)",
    org: "세계보건기구(WHO)",
    url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
    use: "권장 운동량 확인",
  },
  {
    title: "Compendium of Physical Activities",
    org: "Arizona State University 외",
    url: "https://pacompendium.com/",
    use: "운동 종류별 강도(MET) 기준 확인",
  },
  {
    title: "국가정신건강정보포털",
    org: "국립정신건강센터",
    url: "https://www.mentalhealth.go.kr/",
    use: "기분·스트레스 관련 정보 확인",
  },
];

export function HealthSourcesModal({ onClose }) {
  // body 로 띄운다 — 면책 문구(<p>) 안에서 열리면 탭바 아래로 깔리고 정렬도 물려받는다
  return createPortal(
    <div className="notice-backdrop" onClick={onClose} role="presentation">
      <div
        className="notice-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="건강 정보 참고 자료"
      >
        <h3 className="notice-title">건강 정보 참고 자료</h3>
        <p className="notice-desc">
          AI 답변과 칼로리·영양소 분석은 일반적인 영양 지식으로 만든 추정이에요.
          아래 공식 자료에서 직접 확인해 보세요.
        </p>
        <ul className="notice-list">
          {HEALTH_SOURCES.map((s) => (
            <li key={s.url}>
              <a
                className="notice-source-link"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleExternalClick(s.url)}
              >
                {s.title}
              </a>
              <span className="notice-source-use">
                {s.org} · {s.use}
              </span>
            </li>
          ))}
        </ul>
        <p className="notice-foot">
          AI가 알려주는 내용은 참고용 추정치이며 의학적 진단이나 치료를 대신하지
          않아요. 건강 상태에 대한 판단이 필요하면 의료진과 상담해 주세요.
        </p>
        <div className="notice-buttons">
          <button type="button" className="is-primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 면책 문구 옆에 붙이는 '참고 자료' 텍스트 버튼 + 모달. */
export function HealthSourcesLink({ label = "참고 자료" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="notice-inline-link"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && <HealthSourcesModal onClose={() => setOpen(false)} />}
    </>
  );
}

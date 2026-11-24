/* 튜토리얼 — 화면을 어둡게 하고 버튼을 하나씩 비추며 설명하는 안내(게임 튜토리얼 방식).
 *
 * 내용은 tutorialSteps.js, 언제 띄울지는 App.jsx(MainShell)가 정한다.
 * 진행 중에는 홈 화면에 머문다 — 탭을 실제로 옮기지 않고 탭 버튼만 비춘다
 * (대화 탭을 열면 AI 선인사가 호출되는 등 부작용이 있어서).
 * 화면 아무 곳이나 누르면 다음으로 넘어간다. [건너뛰기]는 바로 끝낸다.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { activeTutorialSteps, markTutorialSeen } from "./tutorialSteps";
import "./Tutorial.css";

const PAD = 8;      // 비추는 영역을 요소보다 이만큼 넓게
const GAP = 14;     // 비춘 영역과 말풍선 사이
const MARGIN = 16;  // 말풍선과 화면 가장자리 사이
const EDGE = 4;     // 비추는 상자와 화면 가장자리 사이
const CARD_MAX = 320;
const TOP_CLEAR = 60;      // 이보다 위에 걸치면 가려진 것으로 본다(상태바·로고 줄)
const TABBAR_CLEAR = 100;  // 아래 탭바(78px + 떠 있는 기록 아이콘) 높이

/** data-tour 요소와 그 안쪽 요소를 모두 감싸는 사각형(기록 탭의 떠 있는 아이콘처럼 밖으로 삐져나온 것 포함). */
function measure(target) {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  let { left, top, right, bottom } = el.getBoundingClientRect();
  el.querySelectorAll("*").forEach((child) => {
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  });
  if (right - left <= 0 || bottom - top <= 0) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function sameRect(a, b) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export default function Tutorial({ setActiveTab, onClose }) {
  const steps = useMemo(() => activeTutorialSteps(), []);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const step = steps[index];

  const finish = useCallback(() => {
    markTutorialSeen();
    onClose();
  }, [onClose]);

  // 시작할 때 홈 맨 위로. 진행 중에는 뒤 화면이 스크롤되지 않게 잠근다.
  useEffect(() => {
    setActiveTab("home");
    window.scrollTo(0, 0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [setActiveTab]);

  // 보여 줄 단계가 하나도 없으면 그냥 끝낸다.
  useEffect(() => {
    if (steps.length === 0) finish();
  }, [steps.length, finish]);

  // 비출 요소가 화면 밖이거나 아래 탭바에 가려져 있으면(작은 화면의 주간 리포트 카드 등) 보이는 곳으로 옮긴다.
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el || el.closest(".tabs")) return; // 탭바는 화면에 고정돼 있어 옮길 필요가 없다
    const r = el.getBoundingClientRect();
    if (r.top < TOP_CLEAR || r.bottom > window.innerHeight - TABBAR_CLEAR) {
      el.scrollIntoView({ block: "center" });
    }
  }, [step]);

  // 비출 위치 재기 — 홈 인사말처럼 늦게 불러와져 크기가 바뀌는 요소가 있어 주기적으로 다시 잰다.
  useLayoutEffect(() => {
    if (!step) return undefined;
    const update = () => {
      const next = measure(step.target);
      setRect((prev) => (sameRect(prev, next) ? prev : next));
      setViewport((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev
          : { w: window.innerWidth, h: window.innerHeight },
      );
    };
    update();
    const timer = setInterval(update, 250);
    window.addEventListener("resize", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", update);
    };
  }, [step]);

  if (!step) return null;

  const isLast = index === steps.length - 1;
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));

  // 말풍선 위치: 비춘 곳이 화면 아래쪽이면 위에, 위쪽이면 아래에.
  const cardWidth = Math.min(CARD_MAX, viewport.w - MARGIN * 2);
  let cardStyle;
  let arrowStyle = null;
  let placement = "center";
  // 비추는 상자 — 화면 가장자리에 붙은 요소(설정 탭 등)는 테두리가 잘리지 않게 화면 안쪽으로 맞춘다
  let spot = null;
  if (rect) {
    const l = Math.max(rect.left - PAD, EDGE);
    const t = Math.max(rect.top - PAD, EDGE);
    const r = Math.min(rect.left + rect.width + PAD, viewport.w - EDGE);
    const b = Math.min(rect.top + rect.height + PAD, viewport.h - EDGE);
    spot = { left: l, top: t, width: r - l, height: b - t };
  }
  if (rect) {
    const centerX = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centerX - cardWidth / 2, MARGIN), viewport.w - MARGIN - cardWidth);
    const above = rect.top + rect.height / 2 > viewport.h / 2;
    placement = above ? "above" : "below";
    cardStyle = above
      ? { left, width: cardWidth, bottom: viewport.h - (rect.top - PAD) + GAP }
      : { left, width: cardWidth, top: rect.top + rect.height + PAD + GAP };
    // 꼬리는 비춘 곳의 가운데를 가리키되 말풍선 모서리 밖으로는 나가지 않게
    arrowStyle = { left: Math.min(Math.max(centerX - left, 24), cardWidth - 24) };
  } else {
    cardStyle = { left: (viewport.w - cardWidth) / 2, width: cardWidth, top: viewport.h * 0.38 };
  }

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="앱 사용법 안내" onClick={next}>
      {rect ? (
        <div
          className="tour-spotlight"
          style={spot}
        />
      ) : (
        <div className="tour-dim" />
      )}

      <div
        className={`tour-card tour-card--${placement}`}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {arrowStyle && <span className="tour-arrow" style={arrowStyle} aria-hidden="true" />}
        <p className="tour-count">
          {index + 1} / {steps.length}
        </p>
        <p className="tour-title">{step.title}</p>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          {!isLast && (
            <button type="button" className="tour-skip" onClick={finish}>
              건너뛰기
            </button>
          )}
          <button type="button" className="tour-next" onClick={next}>
            {isLast ? "시작하기" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}

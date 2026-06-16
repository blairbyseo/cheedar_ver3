/* 탭 기반 텔레메트리 훅.
 *
 * 이 앱은 라우터 경로가 아니라 activeTab 상태로 화면을 전환하므로, 참조의
 * useLocation 기반 TelemetryTracker 대신 '탭 전환'을 페이지 이동으로 계측한다.
 *
 * 탭이 바뀔 때마다:
 *  - 이전 탭의 체류시간을 page-time 샘플로 전송
 *  - 이전→현재 전환을 user-flow 샘플로 전송
 * 탭/창이 닫힐 때:
 *  - 현재 탭 체류시간을 keepalive 로 best-effort 전송
 *
 * 로그인 상태(user)일 때만 동작한다(엔드포인트가 인증을 요구).
 * page_path 는 `/탭이름`(예: /home, /diet, /chat) 형태로 보낸다.
 */
import { useEffect, useRef } from "react";

import { useAuth } from "./auth/AuthContext";
import {
  postPageTimeSample,
  postPageTimeSampleKeepalive,
  postUserFlowSample,
} from "./api/telemetry";

const MIN_SAMPLE_SECONDS = 0.5;

function secondsSince(timestampMs) {
  return Math.max(0, (Date.now() - timestampMs) / 1000);
}

export function useTabTelemetry(activeTab) {
  const { user } = useAuth();
  const isLoggedIn = !!user;

  const currentPathRef = useRef(null);
  const enterTimestampRef = useRef(null);

  useEffect(() => {
    if (!isLoggedIn) {
      currentPathRef.current = null;
      enterTimestampRef.current = null;
      return;
    }

    const nextPath = `/${activeTab}`;
    const prevPath = currentPathRef.current;
    const prevEnter = enterTimestampRef.current;

    if (prevPath && typeof prevEnter === "number") {
      const timeSpentSeconds = secondsSince(prevEnter);
      if (timeSpentSeconds >= MIN_SAMPLE_SECONDS) {
        postPageTimeSample({ pagePath: prevPath, timeSpentSeconds }).catch(() => {});
      }
      if (nextPath && prevPath !== nextPath) {
        postUserFlowSample({ fromPage: prevPath, toPage: nextPath }).catch(() => {});
      }
    }

    currentPathRef.current = nextPath;
    enterTimestampRef.current = Date.now();
  }, [isLoggedIn, activeTab]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const handleBeforeUnload = () => {
      const path = currentPathRef.current;
      const enter = enterTimestampRef.current;
      if (!path || typeof enter !== "number") return;
      const timeSpentSeconds = secondsSince(enter);
      if (timeSpentSeconds < MIN_SAMPLE_SECONDS) return;
      postPageTimeSampleKeepalive({ pagePath: path, timeSpentSeconds });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isLoggedIn]);
}

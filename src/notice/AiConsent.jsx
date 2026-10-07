/* 외부 AI(OpenAI) 데이터 전송 동의 (App Store 5.1.1(i)·5.1.2(i)).
 *
 * 무엇을 / 누구에게 보내는지 알리고, 보내기 전에 허락을 받는다.
 * 서버도 동의 전에는 AI 엔드포인트를 403 AI_CONSENT_REQUIRED 로 막는다(deps.py).
 *
 * 쓰는 법:
 *   const { ensureAiConsent } = useAiConsent();
 *   if (!(await ensureAiConsent())) return;   // 거절하면 AI 호출을 하지 않는다
 *
 * 이미 동의했으면 바로 true. 아니면 동의 모달을 띄우고 사용자의 선택을 기다린다.
 * 설정 탭에서 setAiConsent(false) 로 철회할 수 있다.
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "../auth/AuthContext";
import { PRIVACY_URL, handleExternalClick } from "../openExternal";
import "./Notice.css";

const AiConsentContext = createContext(null);

export function AiConsentProvider({ children }) {
  const { user, setUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  // 모달이 열려 있는 동안 기다리는 호출들 — 선택이 끝나면 한꺼번에 응답한다
  const waitersRef = useRef([]);

  const setAiConsent = useCallback(
    async (agree) => {
      const res = await fetch("/api/auth/me/ai-consent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agree }),
      });
      if (!res.ok) throw new Error(`ai-consent ${res.status}`);
      const updated = await res.json();
      setUser(updated);
      return updated;
    },
    [setUser],
  );

  const ensureAiConsent = useCallback(() => {
    if (user?.ai_consented) return Promise.resolve(true);
    return new Promise((resolve) => {
      waitersRef.current.push(resolve);
      setErrorText("");
      setIsOpen(true);
    });
  }, [user?.ai_consented]);

  function finish(result) {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    setIsOpen(false);
    waiters.forEach((resolve) => resolve(result));
  }

  async function handleAgree() {
    setIsSaving(true);
    setErrorText("");
    try {
      await setAiConsent(true);
      finish(true);
    } catch (err) {
      console.error("[AiConsent] save failed:", err);
      setErrorText("동의를 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AiConsentContext.Provider value={{ ensureAiConsent, setAiConsent }}>
      {children}
      {isOpen && createPortal(
        <div className="notice-backdrop" role="presentation">
          <div className="notice-modal" role="dialog" aria-label="AI 기능 이용 동의">
            <h3 className="notice-title">AI 기능을 쓰려면 동의가 필요해요</h3>
            <p className="notice-desc">
              식단 사진 분석과 체다 AI 대화는 외부 AI 서비스를 이용해요. 동의하시면
              아래 정보가 AI 서비스로 전송돼요.
            </p>
            <ul className="notice-list">
              <li>
                <span className="notice-list-label">받는 곳</span>
                OpenAI, L.L.C. (미국) — AI 분석·대화 답변 생성
              </li>
              <li>
                <span className="notice-list-label">보내는 정보</span>
                식단 사진과 음식 설명, 운동 이름, AI 대화 메시지, 답변에 참고하는
                기록 요약(식단·운동·기분, 설문 응답에 따른 대화 방향)
              </li>
              <li>
                <span className="notice-list-label">보내지 않는 정보</span>
                아이디, 이름, 이메일, 비밀번호, 프로필 사진
              </li>
              <li>
                <span className="notice-list-label">AI 학습</span>
                OpenAI의 API 데이터 정책에 따라, 보낸 정보는 AI 모델 학습에
                쓰이지 않아요.
              </li>
            </ul>
            <p className="notice-foot">
              동의하지 않아도 식단·운동을 직접 기록하는 기능은 쓸 수 있어요.
              동의는 [설정 → AI 데이터 제공 동의]에서 언제든 철회할 수 있어요.{" "}
              <a
                href={PRIVACY_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleExternalClick(PRIVACY_URL)}
              >
                개인정보처리방침
              </a>
            </p>
            {errorText && <p className="notice-foot" style={{ color: "#c0392b" }}>{errorText}</p>}
            <div className="notice-buttons">
              <button type="button" onClick={() => finish(false)} disabled={isSaving}>
                동의하지 않음
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={handleAgree}
                disabled={isSaving}
              >
                {isSaving ? "저장 중…" : "동의하고 계속"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </AiConsentContext.Provider>
  );
}

export function useAiConsent() {
  const ctx = useContext(AiConsentContext);
  if (!ctx) throw new Error("useAiConsent must be used inside <AiConsentProvider>");
  return ctx;
}

/*5-2. Chat.jsx: App.jsx 파일에 걸림 */
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { usePoints } from "../usePoints";

// 첫 진입 안내 메시지 (DB에 저장되진 않고 화면에만 보이는 인삿말)
const WELCOME_MESSAGE = {
  role: "ai",
  text: "안녕하세요! 체다에게 궁금한 점을 물어봐주세요.",
};

function Chat() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState("");
  // 헤더 우상단 포인트 — 현재 로그인한 환자의 CP
  const point = usePoints()?.cp ?? 0;

  const didInitRef = useRef(false);
  const bottomRef = useRef(null);
  const initialScrollPendingRef = useRef(true);

  // 채팅창 자동 스크롤
  // - 첫 진입 시 과거 기록 로드 직후: 즉시 점프해서 처음부터 가장 최근 대화가 보이게
  // - 이후 새 메시지 추가/AI 응답 중: 부드럽게 스크롤
  useEffect(() => {
    const isInitial =
      initialScrollPendingRef.current && messages.length > 1;
    bottomRef.current?.scrollIntoView({
      behavior: isInitial ? "auto" : "smooth",
      block: "end",
    });
    if (isInitial) initialScrollPendingRef.current = false;
  }, [messages, isSending]);

  // 첫 진입: 기존 대화 이력 불러오기. 인증은 ProtectedRoute 단계에서 이미 통과한 상태.
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    async function init() {
      try {
        const res = await fetch("/api/chat/messages?limit=50", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`history ${res.status}`);
        const history = await res.json();
        if (history.length > 0) {
          setMessages(history);
        }
      } catch (err) {
        console.error("[Chat] init failed:", err);
        setErrorText("서버 연결에 실패했어요. 백엔드가 켜져 있는지 확인해주세요.");
      }
    }
    init();
  }, []);

  async function handleReset() {
    if (isSending) return;
    const ok = window.confirm("대화 기록을 모두 지울까요?");
    if (!ok) return;

    try {
      const res = await fetch("/api/chat/messages", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error(`reset ${res.status}`);
      setMessages([WELCOME_MESSAGE]);
      setErrorText("");
    } catch (err) {
      console.error("[Chat] reset failed:", err);
      setErrorText("대화 초기화에 실패했어요.");
    }
  }

  // 스트림으로 들어온 이벤트 1건을 화면 상태에 반영
  function applyStreamEvent(event) {
    if (event.type === "user") {
      // 낙관적으로 그려둔 유저 메시지를 서버가 저장한 실제 메시지로 교체
      setMessages((prev) =>
        prev.map((m) => (m._pending ? event.message : m))
      );
    } else if (event.type === "delta") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?._streaming) {
          // 진행 중인 AI 버블에 글자를 이어 붙임
          const grown = { ...last, text: last.text + event.text };
          return [...prev.slice(0, -1), grown];
        }
        // 첫 글자 — 새 AI 버블을 만든다
        return [...prev, { role: "ai", text: event.text, _streaming: true }];
      });
    } else if (event.type === "done") {
      // 스트리밍 버블을 서버가 저장한 최종 메시지(id 포함)로 교체
      setMessages((prev) => [
        ...prev.filter((m) => !m._streaming),
        event.message,
      ]);
      // 답변이 끝났으니 입력창을 바로 풀어준다
      // (setMessages 와 같은 배치로 처리돼 입력중 애니메이션 깜빡임 방지)
      setIsSending(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;

    // 사용자 메시지를 먼저 화면에 그려 즉시 피드백
    const optimisticUser = { role: "user", text, _pending: true };
    setMessages((prev) => [...prev, optimisticUser]);
    setDraft("");
    setIsSending(true);
    setErrorText("");

    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) throw new Error(`send ${res.status}`);

      // 응답은 NDJSON 스트림 — 한 줄에 JSON 이벤트 1개씩 들어온다.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 줄바꿈 단위로 끊어, 완성된 줄만 파싱 (조각난 줄은 buffer에 남김)
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) applyStreamEvent(JSON.parse(line));
        }
      }
    } catch (err) {
      console.error("[Chat] send failed:", err);
      // 낙관적 유저 메시지/진행 중이던 AI 버블을 걷어낸다
      setMessages((prev) => prev.filter((m) => !m._pending && !m._streaming));
      setErrorText("메시지 전송에 실패했어요. 다시 시도해주세요.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="chat-page">
      {/* 홈과 동일한 헤더 — 로고 + 포인트 요약 */}
      <header className="home-header">
        <h1 className="home-logo">Cheddar</h1>
        <div className="point-summary">
          <span className="point-badge">P</span>
          <strong>{point.toLocaleString()}</strong>
        </div>
      </header>

      <section className="chat-title-section">
        <h2 className="chat-title">체다 AI</h2>
        <p className="chat-subtitle">건강 고민을 편하게 물어보세요</p>
      </section>

      <section className="chat-info-card">
        <span className="chat-info-card-text">
          고민이 있다면 체다에게 물어보세요
        </span>
        <button
          type="button"
          className="chat-reset-button"
          onClick={handleReset}
          disabled={isSending}
          aria-label="대화 초기화"
          title="대화 초기화"
        >
          <RotateCcw size={13} strokeWidth={2.2} />
        </button>
      </section>

      <section className="chat-thread">
        {messages.map((m, idx) => (
          <div key={m.id ?? `tmp-${idx}`} className={`chat-message message-${m.role}`}>
            {m.role === "ai" && (
              <span className="chat-avatar">
                <img src="/cheese/normal.svg" alt="체다" />
              </span>
            )}
            <div className={`chat-bubble bubble-${m.role}`}>{m.text}</div>
          </div>
        ))}
        {/* 점 애니메이션은 첫 글자가 오기 전까지만 — 글자가 흐르기 시작하면 버블 자체가 신호 */}
        {isSending && !messages.some((m) => m._streaming) && (
          <div className="chat-message message-ai">
            <span className="chat-avatar">
              <img src="/cheese/normal.svg" alt="체다" />
            </span>
            <div className="chat-bubble bubble-ai chat-typing" aria-label="입력 중">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </section>

      {errorText && (
        <div style={{ padding: "0 16px", color: "#c0392b", fontSize: 13 }}>
          {errorText}
        </div>
      )}

      <form className="chat-composer" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() =>
            bottomRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "end",
            })
          }
          placeholder="질문을 입력해보세요"
          aria-label="질문 입력"
          disabled={isSending}
        />
        <button
          type="submit"
          className="chat-send"
          aria-label="전송"
          disabled={isSending}
        >
          ↑
        </button>
      </form>
    </div>
  );
}

export default Chat;

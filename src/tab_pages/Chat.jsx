/*5-2. Chat.jsx: App.jsx 파일에 걸림 */
import { useState } from "react";

// 예시 대화 — 사용자가 첫 메시지를 보내면 사라지고 사용자 대화로 교체됨.
const initialMessages = [
  { role: "ai",   text: "안녕하세요! 식단 관련 궁금한 점을 편하게 물어봐 주세요." },
  { role: "user", text: "오늘 점심 뭐 먹으면 좋을까요?" },
  { role: "ai",   text: "아침에 단백질이 부족했어요. 닭가슴살 샐러드나 두부 덮밥을 추천드려요." },
];

function Chat() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [userHasSent, setUserHasSent] = useState(false);
  const point = 1040;

  function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    const newMessage = { role: "user", text };
    if (!userHasSent) {
      // 첫 유저 메시지 — 예시 대화를 비우고 사용자 메시지만 남김
      setMessages([newMessage]);
      setUserHasSent(true);
    } else {
      setMessages((prev) => [...prev, newMessage]);
    }
    setDraft("");
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
        고민이 있다면 체다에게 물어보세요
      </section>

      <section className="chat-thread">
        {messages.map((m, idx) => (
          <div key={idx} className={`chat-message message-${m.role}`}>
            {m.role === "ai" && (
              <span className="chat-avatar">
                <img src="/cheese/normal.svg" alt="체다" />
              </span>
            )}
            <div className={`chat-bubble bubble-${m.role}`}>{m.text}</div>
          </div>
        ))}
      </section>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="질문을 입력해보세요 (Enter)"
          aria-label="질문 입력"
        />
        <button
          type="submit"
          className="chat-send"
          aria-label="전송"
        >
          ↑
        </button>
      </form>
    </div>
  );
}

export default Chat;

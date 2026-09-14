import { useState } from "react";
import { verifyInviteCode } from "./inviteCode";

/* 초대코드 입력 화면.
 *
 * 가입 경로 앞에만 세운다 — 로그인에는 코드가 필요 없다.
 * 통과하면 코드를 기기에 저장하고 onPass() 로 다음 단계(가입 폼 / 카카오 인증)를 넘긴다.
 *
 * props
 *   title     화면 제목
 *   hint      제목 아래 한 줄 설명
 *   onPass    검증 통과 시 호출 (정규화된 코드를 인자로 받음)
 *   onCancel  돌아가기. 없으면 버튼을 숨긴다
 */
function InviteGate({ title = "초대코드 입력", hint, onPass, onCancel }) {
  const [code, setCode] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (isBusy) return;

    const trimmed = code.trim();
    if (!trimmed) {
      setErrorText("초대코드를 입력해 주세요.");
      return;
    }

    setIsBusy(true);
    setErrorText("");
    try {
      const data = await verifyInviteCode(trimmed);
      onPass?.(data.code);
    } catch (err) {
      setErrorText(err.message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-logo">Cheddar</h1>
        <p className="login-tagline">{title}</p>
        <p className="invite-gate-hint">
          {hint ?? "초대받은 분만 가입할 수 있어요.\n받으신 코드를 입력해 주세요."}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="login-input invite-gate-input"
            placeholder="초대코드"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            /* 코드는 대소문자를 가리지 않지만, 모바일 자판이 첫 글자를 멋대로
               대문자로 바꾸거나 오타를 교정하지 않도록 꺼둔다 */
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            disabled={isBusy}
            required
          />

          {errorText && <p className="login-error">{errorText}</p>}

          <button type="submit" className="login-submit-btn" disabled={isBusy}>
            {isBusy ? "확인 중…" : "다음"}
          </button>
        </form>

        {onCancel && (
          <button type="button" className="invite-gate-back" onClick={onCancel}>
            돌아가기
          </button>
        )}
      </div>
    </div>
  );
}

export default InviteGate;

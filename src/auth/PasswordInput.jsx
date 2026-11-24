/* 비밀번호 입력칸 + 눈 아이콘(입력한 비밀번호 보기/숨기기).
 *
 * 평소 쓰던 <input type="password" ...> 자리에 그대로 넣으면 된다 — 받은 속성은 전부 input 으로 넘긴다.
 * 로그인·회원가입·회원탈퇴 확인에서 같이 쓴다. 모양은 Login.css 의 .password-field.
 */
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({ className = "", disabled, ...props }) {
  const [shown, setShown] = useState(false);

  return (
    <div className="password-field">
      <input
        {...props}
        disabled={disabled}
        type={shown ? "text" : "password"}
        className={`${className} password-field-input`}
      />
      <button
        type="button"
        className="password-field-toggle"
        // 눌러도 입력칸의 커서가 유지되게(휴대폰 키보드가 내려가지 않게) 한다
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((v) => !v)}
        disabled={disabled}
        aria-label={shown ? "비밀번호 숨기기" : "비밀번호 보기"}
        aria-pressed={shown}
      >
        {shown ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  );
}

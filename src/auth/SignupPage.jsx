/* 회원가입 화면 — 아이디/비밀번호로 가입.
 * 가입에 성공하면 백엔드가 바로 로그인 쿠키를 심어주므로 메인(/)으로 이동. */
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthContext";

// 아이디/비밀번호 규칙 — 서버(app/routers/auth.py)와 반드시 동일하게 유지할 것
const USER_ID_REGEX = /^[가-힣a-zA-Z0-9_]+$/;
const USER_ID_MIN = 3;
const USER_ID_MAX = 15;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64;

// 신체 정보 허용 범위 — 서버(app/schemas/auth.py SignupRequest)와 동일하게 유지할 것
const AGE_MIN = 1, AGE_MAX = 120;
const HEIGHT_MIN = 50, HEIGHT_MAX = 250;
const WEIGHT_MIN = 20, WEIGHT_MAX = 400;

// 가입 폼 1차 검증. 통과하면 null, 실패하면 에러 메시지를 돌려준다.
function validateSignupForm(userId, password, passwordConfirm, body) {
  if (userId.length < USER_ID_MIN || userId.length > USER_ID_MAX) {
    return `아이디는 ${USER_ID_MIN}~${USER_ID_MAX}자로 입력해주세요.`;
  }
  if (!USER_ID_REGEX.test(userId)) {
    return "아이디는 한글, 영문, 숫자, 밑줄(_)만 쓸 수 있어요.";
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해주세요.`;
  }
  if (password !== passwordConfirm) {
    return "비밀번호가 서로 일치하지 않아요.";
  }
  // 신체 정보 — 운동 칼로리 계산 등에 쓰이므로 모두 입력받는다.
  const { age, height, weight } = body;
  if (!age || age < AGE_MIN || age > AGE_MAX) {
    return `나이는 ${AGE_MIN}~${AGE_MAX} 사이로 입력해주세요.`;
  }
  if (!height || height < HEIGHT_MIN || height > HEIGHT_MAX) {
    return `키는 ${HEIGHT_MIN}~${HEIGHT_MAX}cm 사이로 입력해주세요.`;
  }
  if (!weight || weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
    return `체중은 ${WEIGHT_MIN}~${WEIGHT_MAX}kg 사이로 입력해주세요.`;
  }
  return null;
}

function SignupPage() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // 이미 로그인된 상태로 /signup 에 들어오면 메인으로 보냄
  if (user) return <Navigate to="/" replace />;

  async function handleSignup(e) {
    e.preventDefault();
    if (isBusy) return;

    const trimmedUserId = userId.trim();
    const ageNum = Number(age);
    const heightNum = Number(height);
    const weightNum = Number(weight);
    const localError = validateSignupForm(
      trimmedUserId,
      password,
      passwordConfirm,
      { age: ageNum, height: heightNum, weight: weightNum },
    );
    if (localError) {
      setErrorText(localError);
      return;
    }

    setIsBusy(true);
    setErrorText("");
    try {
      // 성공 시 AuthContext 가 로그인 상태로 만들어 줌
      await signup(trimmedUserId, password, {
        age: ageNum,
        height_cm: heightNum,
        weight_kg: weightNum,
      });
      navigate("/", { replace: true });
    } catch (err) {
      console.error("[Signup] signup failed:", err);
      setErrorText(err.message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-logo">Cheddar</h1>
        <p className="login-tagline">아이디로 회원가입</p>

        <form className="login-form" onSubmit={handleSignup}>
          <input
            type="text"
            className="login-input"
            placeholder={`아이디 (${USER_ID_MIN}~${USER_ID_MAX}자, 한글·영문·숫자)`}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            maxLength={USER_ID_MAX}
            autoComplete="username"
            disabled={isBusy}
            required
          />
          <input
            type="password"
            className="login-input"
            placeholder={`비밀번호 (${PASSWORD_MIN}자 이상)`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={isBusy}
            required
          />
          <input
            type="password"
            className="login-input"
            placeholder="비밀번호 확인"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={isBusy}
            required
          />

          {/* 신체 정보 — 운동 칼로리 계산 등에 쓰여요 */}
          <input
            type="number"
            inputMode="numeric"
            className="login-input"
            placeholder="나이 (만)"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            min={AGE_MIN}
            max={AGE_MAX}
            disabled={isBusy}
            required
          />
          <div className="signup-body-row">
            <input
              type="number"
              inputMode="decimal"
              className="login-input"
              placeholder="키 (cm)"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              min={HEIGHT_MIN}
              max={HEIGHT_MAX}
              disabled={isBusy}
              required
            />
            <input
              type="number"
              inputMode="decimal"
              className="login-input"
              placeholder="체중 (kg)"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              min={WEIGHT_MIN}
              max={WEIGHT_MAX}
              disabled={isBusy}
              required
            />
          </div>

          <button type="submit" className="login-submit-btn" disabled={isBusy}>
            {isBusy ? "가입 중..." : "회원가입"}
          </button>
        </form>

        {errorText && <p className="login-error">{errorText}</p>}

        <p className="login-signup-row">
          이미 회원이신가요?{" "}
          <Link to="/login" className="login-signup-link">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}

export default SignupPage;

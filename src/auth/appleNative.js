/* iOS 앱 전용 Sign in with Apple (App Store 4.8 — 카카오 로그인과 동등한 선택지).
 *
 * 네이티브 쪽은 ios/App/App/AppleSignInPlugin.swift (앱 안에 둔 Capacitor 플러그인).
 *  1) 원본 nonce 를 만들어 플러그인에 넘긴다 → 플러그인이 SHA-256 해시만 Apple 에 보낸다.
 *  2) Apple 이 돌려준 identity token + 원본 nonce 를 POST /api/auth/apple 로 보낸다.
 *  3) 서버가 토큰 서명·nonce 를 검증하고 로그인 쿠키를 심는다.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

const AppleSignIn = registerPlugin("AppleSignIn");

/** Apple 로그인 버튼을 보여줄지 — iOS 앱에서만. (웹·안드로이드는 기존 로그인만) */
export function isAppleSignInAvailable() {
  return Capacitor.getPlatform() === "ios";
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Apple 동의창을 띄우고 서버 로그인 요청 바디를 만든다.
 *  사용자가 창을 닫으면 null 을 돌려준다(에러 메시지를 띄우지 않기 위해). */
export async function requestAppleCredential() {
  const nonce = randomNonce();
  try {
    const res = await AppleSignIn.authorize({ nonce });
    return {
      identity_token: res.identityToken,
      authorization_code: res.authorizationCode ?? null,
      nonce,
      given_name: res.givenName ?? null,
      family_name: res.familyName ?? null,
    };
  } catch (err) {
    if (err?.code === "CANCELED") return null;
    throw err;
  }
}

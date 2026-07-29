/* 앱(Capacitor) 전용 카카오 로그인 딥링크 처리.
 *
 * 웹은 기존 방식(window.location 이동) 그대로 두고, 앱에서만 아래로 동작한다:
 *  1) openKakaoNative(): 카카오 동의창을 시스템 브라우저로 열되, redirect_uri 를
 *     앱 전용 App Link(https://cheddar-care.com/oauth/kakao/app-callback)로 지정.
 *  2) 카카오가 그 주소로 돌려보내면 Android App Link 가 브라우저 대신 앱을 열고,
 *     KakaoDeepLinkHandler 가 appUrlOpen 으로 code 를 받아 백엔드와 교환한다.
 *
 * 백엔드 무수정: POST /api/auth/kakao 가 이미 {code, redirect_uri} 를 받는다.
 * client_id 는 앱에 하드코딩하지 않고 /kakao/authorize-url 응답 URL에서 파싱한다.
 */
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { useNavigate } from "react-router-dom";

import { useAuth } from "./AuthContext";

// 카카오 콘솔에 등록할 앱 전용 Redirect URI (App Link). 웹 콜백(/callback)과 경로가 다르다.
export const KAKAO_APP_REDIRECT =
  "https://cheddar-care.com/oauth/kakao/app-callback";

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/** 앱에서 카카오 동의창 열기 — 앱 전용 redirect_uri 로 authorize URL 을 재구성한다. */
export async function openKakaoNative() {
  const res = await fetch("/api/auth/kakao/authorize-url");
  if (!res.ok) throw new Error(`authorize-url ${res.status}`);
  const { url } = await res.json();
  const clientId = new URL(url).searchParams.get("client_id");
  if (!clientId) throw new Error("client_id 파싱 실패");
  const authorize =
    "https://kauth.kakao.com/oauth/authorize?response_type=code" +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(KAKAO_APP_REDIRECT)}`;
  await Browser.open({ url: authorize });
}

/** 앱에서 카카오 redirect(App Link)를 받아 로그인 완료시키는 리스너.
 *  라우터 + AuthProvider 안에 한 번만 마운트한다. 웹에서는 no-op. */
export function KakaoDeepLinkHandler() {
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeApp()) return;
    const handle = CapApp.addListener("appUrlOpen", async ({ url }) => {
      if (!url || !url.includes("/oauth/kakao/app-callback")) return;
      try {
        const code = new URL(url).searchParams.get("code");
        await Browser.close().catch(() => {});
        if (!code) return;
        await login(code, KAKAO_APP_REDIRECT); // AuthContext 의 카카오 교환 재사용
        navigate("/", { replace: true });
      } catch (err) {
        console.error("[KakaoDeepLink] 로그인 실패:", err);
      }
    });
    return () => {
      handle.then((h) => h.remove()).catch(() => {});
    };
  }, [login, navigate]);

  return null;
}

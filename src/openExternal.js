/* 앱/웹 공용 외부 링크 열기.
 *
 * 앱(Capacitor)에서 그냥 <a href> 나 window.open 을 쓰면 WebView 안에서 페이지가
 * 열려 버린다. 앱에는 주소창도 뒤로가기도 없어서 사용자가 갇히므로, 네이티브에서는
 * 시스템 브라우저(@capacitor/browser)로 띄운다. 웹에서는 새 탭이면 충분하다.
 *
 * 쓰는 곳: 포인트 탭의 보상 규정 링크, 설정 탭의 개인정보처리방침 링크.
 */
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

// 웹에 올라가 있는 정적 문서들. 앱에 번들하지 않고 웹에 두는 이유는
// 내용이 바뀌어도 앱 재심사 없이 고칠 수 있기 때문이다.
export const PRIVACY_URL = "https://cheddar-care.com/privacy.html";
export const REWARD_RULES_URL = "https://cheddar-care.com/reward-rules.html";

/** 외부 문서 열기. 앱이면 시스템 브라우저, 웹이면 새 탭. */
export async function openExternal(url) {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * <a href> 에 얹는 onClick 핸들러를 만든다.
 * 웹에서는 <a> 기본 동작에 맡기고, 앱에서만 가로채 시스템 브라우저로 넘긴다.
 * (href 를 그대로 두면 링크로서의 접근성·우클릭 동작이 유지된다)
 */
export function handleExternalClick(url) {
  return (e) => {
    if (!Capacitor.isNativePlatform()) return;
    e.preventDefault();
    openExternal(url);
  };
}

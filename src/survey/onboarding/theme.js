/* theme — 온보딩/설문 디자인 토큰 (핸드오프 Design Tokens 그대로).
 * tone: 'warm'(기본 골드) | 'calm'(정신건강 C/E-2 슬레이트).
 * 컴포넌트들이 이 토큰 객체 t 를 받아 인라인 스타일로 픽셀에 가깝게 재현한다.
 */
export function theme(tone) {
  if (tone === "calm") {
    return {
      tone: "calm",
      bg: "#F3F6F8", paper: "#EEF2F5",
      text: "#27343B", sub: "#566069", ter: "#8A97A0",
      line: "#E1E8ED", card: "#FFFFFF",
      accent: "#5C7C99", accentStrong: "#456179",
      accentSoft: "#E9F0F5", accentTint: "#F2F6F9",
      btnInk: "#FFFFFF",
      shadow: "0 1px 2px rgba(39,52,59,0.04), 0 8px 24px rgba(39,52,59,0.05)",
      btnShadow: "0 6px 18px rgba(92,124,153,0.32)",
    };
  }
  return {
    tone: "warm",
    bg: "#FFFFFF", paper: "#FBF7EE",
    text: "#2D3436", sub: "#5E6A6D", ter: "#A39E92",
    line: "#EDE8DC", card: "#FFFFFF",
    accent: "#D9B24C", accentStrong: "#C89D32",
    accentSoft: "#FBF2D6", accentTint: "#FCF8EC",
    btnInk: "#2A2620",
    shadow: "0 1px 2px rgba(45,52,54,0.04), 0 10px 28px rgba(160,130,40,0.07)",
    btnShadow: "0 6px 18px rgba(201,157,50,0.30)",
  };
}

// 햅틱 느낌 (지원 기기에서만)
export function tap(strong) {
  try {
    if (navigator.vibrate) navigator.vibrate(strong ? 16 : 8);
  } catch {
    /* noop */
  }
}

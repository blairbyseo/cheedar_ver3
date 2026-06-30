/* parts — 온보딩 공유 프리미티브: Mascot, ProgressHeader, PrimaryButton.
 * 핸드오프 prototype/onboarding/ui.jsx 를 이 앱(import 기반)으로 옮긴 것.
 */
import { useState } from "react";
import { Icon } from "./Icon.jsx";
import { tap } from "./theme.js";

const MASCOT_SRC = {
  happy: "/cheddar/cheddar-happy.png",
  sleep: "/cheddar/cheddar-sleep.png",
  cheer: "/cheddar/cheddar-cheer.png",
  love: "/cheddar/cheddar-love.png",
  search: "/cheddar/cheddar-search.png",
};

export function Mascot({ variant = "happy", size = 132, float = true, style }) {
  const src = MASCOT_SRC[variant] || MASCOT_SRC.happy;
  return (
    <div
      style={{
        width: size, height: size, position: "relative",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
          width: size * 0.52, height: size * 0.1, borderRadius: "50%",
          background: "rgba(150,130,70,0.16)", filter: "blur(5px)",
        }}
      />
      <img
        src={src} alt="체다"
        className={float ? "chd-float" : ""}
        style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative" }}
      />
    </div>
  );
}

// 상단 헤더: 뒤로가기 원형 버튼 + 진행률 바 + 단계 라벨
export function ProgressHeader({ progress = 0, onBack, showBack = true, t, stage, showStage = true, reward = 0 }) {
  return (
    <div style={{ padding: "6px 22px 0", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 36 }}>
        <button
          type="button"
          onClick={() => { tap(); onBack && onBack(); }}
          aria-label="뒤로"
          className="chd-pop"
          style={{
            width: 38, height: 38, marginLeft: -2, borderRadius: 999, flexShrink: 0,
            border: `1px solid ${t.line}`, background: t.card,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", boxShadow: t.shadow,
            opacity: showBack ? 1 : 0, pointerEvents: showBack ? "auto" : "none",
          }}
        >
          <Icon icon="solar:arrow-left-linear" size={20} color={t.text} />
        </button>
        <div style={{ flex: 1, height: 7, borderRadius: 999, background: t.line, overflow: "hidden" }}>
          <div
            style={{
              height: "100%", width: `${Math.max(4, progress * 100)}%`,
              background: t.accent, borderRadius: 999,
              transition: "width .5s cubic-bezier(.2,0,0,1)",
            }}
          />
        </div>
      </div>
      {showStage && (stage || reward > 0) && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.02em", color: t.accentStrong, display: "flex", alignItems: "center", gap: 6 }}>
            {stage && <span style={{ width: 6, height: 6, borderRadius: 999, background: t.accent, display: "inline-block" }} />}
            {stage}
          </span>
          {reward > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, background: t.accentSoft, fontSize: 12, fontWeight: 700, color: t.accentStrong, flexShrink: 0 }}>
              <Icon icon="solar:star-bold" size={13} />완료 시 {reward}P
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// 풀폭 알약 버튼
export function PrimaryButton({ label, onClick, t, disabled, variant = "solid" }) {
  const [press, setPress] = useState(false);
  const solid = variant === "solid";
  return (
    <button
      type="button"
      onClick={() => { if (disabled) return; tap(true); onClick && onClick(); }}
      disabled={disabled}
      onPointerDown={() => setPress(true)}
      onPointerUp={() => setPress(false)}
      onPointerLeave={() => setPress(false)}
      style={{
        width: "100%", height: 58, borderRadius: 18, border: "none",
        cursor: disabled ? "default" : "pointer",
        background: solid ? (disabled ? t.line : t.accent) : "transparent",
        color: solid ? t.btnInk : t.sub,
        fontSize: 17, fontWeight: 700, fontFamily: "inherit", letterSpacing: "-0.01em",
        boxShadow: solid && !disabled ? t.btnShadow : "none",
        transform: press && !disabled ? "scale(0.975)" : "scale(1)",
        transition: "transform .12s ease, background .2s ease, box-shadow .2s ease",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {label}
    </button>
  );
}

/* inputs — 문항 입력 컨트롤 (핸드오프 prototype/onboarding/inputs.jsx 이식).
 * 모두 t(테마 토큰)와 value/onChange 를 받는다. 값 포맷은 핸드오프 State 계약:
 *   numeric→number / single·yesno→string / multi→string[] / scale→0–10 number /
 *   likert→0–3 number / time2→{sleep_time,wake_time} / bmi→{height,weight} /
 *   freetext→string / checklist→{rows:{[id]:{checked,freq}}}
 */
import { useState, useRef } from "react";
import { Icon } from "./Icon.jsx";
import { tap } from "./theme.js";

// 단일/다중 선택 텍스트 행
export function OptionRow({ option, selected, onClick, t, multi }) {
  const [press, setPress] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { tap(); onClick && onClick(); }}
      onPointerDown={() => setPress(true)}
      onPointerUp={() => setPress(false)}
      onPointerLeave={() => setPress(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "17px 18px", borderRadius: 16, cursor: "pointer",
        textAlign: "left", fontFamily: "inherit",
        background: selected ? t.accentSoft : t.card,
        border: `1.5px solid ${selected ? t.accent : t.line}`,
        boxShadow: selected ? "none" : t.shadow,
        transform: press ? "scale(0.985)" : "scale(1)",
        transition: "transform .12s ease, background .18s ease, border-color .18s ease",
      }}
    >
      {option.icon && (
        <span
          style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: selected ? "#fff" : t.accentTint,
            color: selected ? t.accentStrong : t.sub,
          }}
        >
          <Icon icon={option.icon} size={20} />
        </span>
      )}
      <span style={{ flex: 1, fontSize: 16.5, fontWeight: selected ? 700 : 500, color: t.text, letterSpacing: "-0.01em", wordBreak: "keep-all" }}>
        {option.label}
      </span>
      <span
        style={{
          width: 23, height: 23, borderRadius: multi ? 7 : 999, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `1.6px solid ${selected ? t.accent : t.line}`,
          background: selected ? t.accent : "transparent", transition: "all .16s ease",
        }}
      >
        {selected && <Icon icon="solar:check-read-linear" size={14} color={t.tone === "calm" ? "#fff" : "#2A2620"} />}
      </span>
    </button>
  );
}

// 아이콘 카드 (설명 있는 선택지: F-1/F-2)
export function OptionCard({ option, selected, onClick, t }) {
  const [press, setPress] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { tap(); onClick && onClick(); }}
      onPointerDown={() => setPress(true)}
      onPointerUp={() => setPress(false)}
      onPointerLeave={() => setPress(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "15px 16px", borderRadius: 18, cursor: "pointer",
        textAlign: "left", fontFamily: "inherit",
        background: selected ? t.accentSoft : t.card,
        border: `1.5px solid ${selected ? t.accent : t.line}`,
        boxShadow: selected ? "none" : t.shadow,
        transform: press ? "scale(0.985)" : "scale(1)",
        transition: "transform .12s ease, background .18s ease, border-color .18s ease",
      }}
    >
      {option.icon && (
        <span
          style={{
            width: 46, height: 46, borderRadius: 13, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: selected ? t.accent : t.accentTint,
            color: selected ? "#2A2620" : t.accentStrong, transition: "all .18s ease",
          }}
        >
          <Icon icon={option.icon} size={25} />
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16.5, fontWeight: 700, color: t.text, letterSpacing: "-0.01em", wordBreak: "keep-all" }}>
          {option.label}
        </span>
        {option.desc && (
          <span style={{ display: "block", marginTop: 2, fontSize: 13, color: t.sub, wordBreak: "keep-all" }}>{option.desc}</span>
        )}
      </span>
      {selected && <Icon icon="solar:check-circle-bold" size={24} color={t.accent} />}
    </button>
  );
}

// 0–10 커스텀 슬라이더 (큰 숫자 + 드래그 트랙)
export function ScaleSlider({ value, onChange, labels = {}, t }) {
  const trackRef = useRef(null);
  const v = typeof value === "number" ? value : 5;
  const set = (clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const n = Math.round(pct * 10);
    if (n !== v) tap();
    onChange(n);
  };
  const drag = (e) => {
    set(e.clientX);
    const move = (ev) => set(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const pct = v / 10;
  return (
    <div style={{ padding: "8px 4px 0" }}>
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <span style={{ fontSize: 56, fontWeight: 800, color: t.accentStrong, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{v}</span>
        <span style={{ fontSize: 22, fontWeight: 600, color: t.ter }}> / 10</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={drag}
        style={{ position: "relative", height: 16, borderRadius: 999, background: t.line, cursor: "pointer", touchAction: "none" }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, background: t.accent, borderRadius: 999 }} />
        <div
          style={{
            position: "absolute", top: "50%", left: `${pct * 100}%`, transform: "translate(-50%,-50%)",
            width: 32, height: 32, borderRadius: 999, background: "#fff",
            border: `3px solid ${t.accent}`, boxShadow: "0 3px 10px rgba(0,0,0,0.14)",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 13.5, color: t.sub, fontWeight: 500 }}>
        <span>{labels[0] ?? "0"}</span>
        <span>{labels[10] ?? "10"}</span>
      </div>
    </div>
  );
}

// 리커트 0–3 (세로 스택)
const LIKERT = [
  { n: 0, label: "없었어요", sub: "전혀" },
  { n: 1, label: "가끔요", sub: "며칠" },
  { n: 2, label: "자주요", sub: "절반 이상" },
  { n: 3, label: "거의 매일요", sub: "대부분" },
];
export function Likert({ value, onChange, t, labels }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {LIKERT.map((o) => {
        const sel = value === o.n;
        const label = labels?.[o.n] ?? o.label;
        return (
          <button
            key={o.n}
            type="button"
            onClick={() => { tap(); onChange(o.n); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 14,
              padding: "16px 18px", borderRadius: 15, cursor: "pointer",
              textAlign: "left", fontFamily: "inherit",
              background: sel ? t.accentSoft : t.card,
              border: `1.5px solid ${sel ? t.accent : t.line}`,
              boxShadow: sel ? "none" : t.shadow,
              transition: "background .18s ease, border-color .18s ease",
            }}
          >
            <span
              style={{
                width: 30, height: 30, borderRadius: 999, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700,
                background: sel ? t.accent : t.accentTint, color: sel ? "#fff" : t.sub,
              }}
            >{o.n}</span>
            <span style={{ flex: 1, fontSize: 16, fontWeight: sel ? 700 : 500, color: t.text }}>{label}</span>
            <span style={{ fontSize: 13, color: t.ter }}>{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

// 예 / 아니오
export function YesNo({ value, onChange, t }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      {[{ v: "yes", l: "예" }, { v: "no", l: "아니오" }].map((o) => {
        const sel = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => { tap(); onChange(o.v); }}
            style={{
              flex: 1, height: 64, borderRadius: 16, cursor: "pointer", fontFamily: "inherit",
              fontSize: 17, fontWeight: sel ? 700 : 600, color: t.text,
              background: sel ? t.accentSoft : t.card,
              border: `1.5px solid ${sel ? t.accent : t.line}`,
              boxShadow: sel ? "none" : t.shadow, transition: "all .16s ease",
            }}
          >{o.l}</button>
        );
      })}
    </div>
  );
}

// 숫자 스테퍼
export function NumberStepper({ value, onChange, unit, min = 0, max = 999, t }) {
  const v = typeof value === "number" ? value : min;
  const step = (d) => {
    const n = Math.min(max, Math.max(min, v + d));
    if (n !== v) tap();
    onChange(n);
  };
  const btnStyle = {
    width: 52, height: 52, borderRadius: 14, cursor: "pointer",
    background: t.accentTint, border: `1.5px solid ${t.line}`,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18 }}>
      <button type="button" onClick={() => step(-1)} style={btnStyle} aria-label="감소">
        <Icon icon="solar:minus-circle-linear" size={22} color={t.accentStrong} />
      </button>
      <div style={{ minWidth: 130, textAlign: "center" }}>
        <span style={{ fontSize: 52, fontWeight: 800, color: t.text, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{v}</span>
        {unit && <span style={{ fontSize: 20, fontWeight: 600, color: t.ter, marginLeft: 4 }}>{unit}</span>}
      </div>
      <button type="button" onClick={() => step(1)} style={btnStyle} aria-label="증가">
        <Icon icon="solar:add-circle-linear" size={22} color={t.accentStrong} />
      </button>
    </div>
  );
}

// 취침/기상 두 시간 입력
export function Time2({ fields, value, onChange, t }) {
  const val = value || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {fields.map((f) => (
        <label
          key={f.id}
          style={{
            display: "flex", alignItems: "center", gap: 14, padding: "16px 18px",
            borderRadius: 16, background: t.card, border: `1.5px solid ${t.line}`,
            boxShadow: t.shadow, cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: t.accentTint, color: t.accentStrong,
            }}
          ><Icon icon={f.icon} size={21} /></span>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: t.text }}>{f.label}</span>
          <input
            type="time"
            value={val[f.id] ?? f.def ?? ""}
            onChange={(e) => onChange({ ...val, [f.id]: e.target.value })}
            className="chd-time"
            style={{ fontFamily: "inherit", fontSize: 19, fontWeight: 700, color: t.accentStrong, border: "none", background: "transparent", textAlign: "right" }}
          />
        </label>
      ))}
    </div>
  );
}

// 키 + 몸무게 + 자동 BMI (판정 라벨 숨김 — 숫자만)
export function BmiInput({ fields, value, onChange, t }) {
  const val = value || {};
  const h = Number(val.height ?? fields[0].def);
  const w = Number(val.weight ?? fields[1].def);
  const bmi = h > 0 ? w / Math.pow(h / 100, 2) : 0;
  const adjust = (id, d, def) => {
    const cur = Number(val[id] ?? def);
    tap();
    onChange({ ...val, [id]: cur + d });
  };
  const stepBtn = {
    width: 40, height: 40, borderRadius: 11, cursor: "pointer", flexShrink: 0,
    background: t.accentTint, border: `1.5px solid ${t.line}`,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {fields.map((f) => {
        const cur = Number(val[f.id] ?? f.def);
        return (
          <div
            key={f.id}
            style={{
              display: "flex", alignItems: "center", padding: "14px 16px",
              borderRadius: 16, background: t.card, border: `1.5px solid ${t.line}`, boxShadow: t.shadow,
            }}
          >
            <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: t.sub }}>{f.label}</span>
            <button type="button" onClick={() => adjust(f.id, -1, f.def)} style={stepBtn}>
              <Icon icon="solar:minus-linear" size={18} color={t.accentStrong} />
            </button>
            <span style={{ minWidth: 78, textAlign: "center", fontSize: 26, fontWeight: 800, color: t.text, fontVariantNumeric: "tabular-nums" }}>
              {cur}<span style={{ fontSize: 14, fontWeight: 600, color: t.ter, marginLeft: 2 }}>{f.unit}</span>
            </span>
            <button type="button" onClick={() => adjust(f.id, 1, f.def)} style={stepBtn}>
              <Icon icon="solar:add-circle-linear" size={18} color={t.accentStrong} />
            </button>
          </div>
        );
      })}
      <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 14, borderRadius: 16, background: t.accentTint }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: t.sub }}>BMI</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: t.text, fontVariantNumeric: "tabular-nums" }}>{bmi.toFixed(1)}</span>
      </div>
    </div>
  );
}

// 자유 서술
export function FreeText({ value, onChange, placeholder, maxLength, t }) {
  return (
    <div>
      <textarea
        value={value ?? ""}
        maxLength={maxLength}
        rows={4}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "편하게 적어주세요"}
        style={{
          width: "100%", borderRadius: 16, padding: "15px 16px", resize: "none",
          fontFamily: "inherit", fontSize: 16, lineHeight: 1.5, color: t.text,
          background: t.card, border: `1.5px solid ${t.line}`, boxShadow: t.shadow,
          outline: "none", boxSizing: "border-box",
        }}
      />
      {maxLength && (
        <div style={{ marginTop: 6, textAlign: "right", fontSize: 12, color: t.ter }}>
          {(value || "").length} / {maxLength}
        </div>
      )}
    </div>
  );
}

// 체크 + 빈도(주 N일)
export function ChecklistWithFrequency({ rows, value, onChange, t }) {
  const val = value && value.rows ? value.rows : {};
  const setRow = (id, patch) => {
    onChange({ rows: { ...val, [id]: { ...(val[id] || { checked: false, freq: 1 }), ...patch } } });
  };
  const freqBtn = {
    width: 32, height: 32, borderRadius: 9, cursor: "pointer", flexShrink: 0,
    background: "#fff", border: `1.5px solid ${t.line}`,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => {
        const st = val[r.id] || { checked: false, freq: 1 };
        const sel = st.checked;
        return (
          <div
            key={r.id}
            style={{
              borderRadius: 15, background: sel ? t.accentSoft : t.card,
              border: `1.5px solid ${sel ? t.accent : t.line}`, boxShadow: sel ? "none" : t.shadow,
              overflow: "hidden", transition: "background .18s ease, border-color .18s ease",
            }}
          >
            <button
              type="button"
              onClick={() => { tap(); setRow(r.id, { checked: !sel }); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "15px 16px", background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  width: 23, height: 23, borderRadius: 7, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1.6px solid ${sel ? t.accent : t.line}`, background: sel ? t.accent : "transparent",
                }}
              >
                {sel && <Icon icon="solar:check-read-linear" size={14} color={t.tone === "calm" ? "#fff" : "#2A2620"} />}
              </span>
              <span style={{ flex: 1, fontSize: 15.5, fontWeight: sel ? 700 : 500, color: t.text, wordBreak: "keep-all" }}>{r.label}</span>
            </button>
            {sel && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 14px 51px" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.sub }}>주</span>
                <button type="button" onClick={() => setRow(r.id, { freq: Math.max(1, st.freq - 1) })} style={freqBtn}>
                  <Icon icon="solar:minus-linear" size={15} color={t.accentStrong} />
                </button>
                <span style={{ minWidth: 20, textAlign: "center", fontSize: 17, fontWeight: 800, color: t.text }}>{st.freq}</span>
                <button type="button" onClick={() => setRow(r.id, { freq: Math.min(7, st.freq + 1) })} style={freqBtn}>
                  <Icon icon="solar:add-circle-linear" size={15} color={t.accentStrong} />
                </button>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.sub }}>일</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

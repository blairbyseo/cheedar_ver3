/* screens — 온보딩 화면들. Phase 3: Welcome + Question(한 문항=한 화면).
 * 나머지 비-문항 화면(interstitial/transition/compare/commitment/loading/result)은
 * Phase 1에서 추가. 핸드오프 prototype/onboarding/screens.jsx 이식.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";
import { Mascot, ProgressHeader, PrimaryButton } from "./parts.jsx";
import {
  OptionRow, OptionCard, ScaleSlider, Likert, YesNo,
  NumberStepper, Time2, BmiInput, FreeText, ChecklistWithFrequency,
} from "./inputs.jsx";

// ── 공통 셸 ───────────────────────────────────────────────
function Shell({ t, children, bg }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: bg || t.bg, color: t.text }}>
      <div style={{ height: 18, flexShrink: 0 }} />
      {children}
    </div>
  );
}
function Body({ children, style }) {
  return (
    <div className="chd-scroll" style={{ flex: 1, overflow: "auto", padding: "20px 22px 8px", display: "flex", flexDirection: "column", ...style }}>
      {children}
    </div>
  );
}
function Footer({ children }) {
  return <div style={{ padding: "12px 22px 28px", flexShrink: 0 }}>{children}</div>;
}
function QTitle({ t, text, help }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h1 style={{ margin: 0, fontSize: 25, lineHeight: 1.32, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line" }}>
        {text}
      </h1>
      {help && <p style={{ margin: "10px 0 0", fontSize: 14.5, color: t.sub, wordBreak: "keep-all" }}>{help}</p>}
    </div>
  );
}

// ── 환영 ─────────────────────────────────────────────────
export function WelcomeScreen({ t, userName, onNext }) {
  const chips = [
    ["solar:clock-circle-linear", "약 8분"],
    ["solar:diskette-linear", "자동 저장"],
    ["solar:lock-keyhole-minimalistic-linear", "비공개"],
  ];
  return (
    <Shell t={t} bg={t.paper}>
      <Body style={{ justifyContent: "center", alignItems: "center", textAlign: "center", paddingBottom: 0 }}>
        <Mascot variant="happy" size={170} />
        <h1 style={{ margin: "20px 0 0", fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line" }}>
          {(userName ? userName + "님, " : "") + "반가워요!\n저는 체다예요"}
        </h1>
        <p style={{ margin: "14px 0 0", fontSize: 16, lineHeight: 1.55, color: t.sub, wordBreak: "keep-all", maxWidth: 280 }}>
          딱 맞는 식습관과 생활 리듬을{"\n"}몇 가지 질문으로 같이 찾아볼게요.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 22, flexWrap: "wrap", justifyContent: "center" }}>
          {chips.map(([ic, tx]) => (
            <span key={tx} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 13px", borderRadius: 999, background: "#fff", border: `1px solid ${t.line}`, fontSize: 13, fontWeight: 600, color: t.sub }}>
              <Icon icon={ic} size={15} color={t.accentStrong} />{tx}
            </span>
          ))}
        </div>
      </Body>
      <Footer>
        <PrimaryButton t={t} label="시작하기" onClick={onNext} />
        <p style={{ margin: "14px 0 0", textAlign: "center", fontSize: 12.5, color: t.ter, wordBreak: "keep-all" }}>
          평가하려는 게 아니에요. 더 잘 돕고 싶어서 물어보는 거예요.
        </p>
      </Footer>
    </Shell>
  );
}

// 입력 타입별 컨트롤 + 진행 가능 여부 계산
const TAP_ADVANCE = new Set(["single_select", "single-card", "likert_0_3", "yes_no"]);
const ALWAYS_READY = new Set(["scale_0_10", "numeric", "bmi", "time", "composite", "free_text", "checklist_with_frequency"]);

function isAnswered(step, value) {
  const type = step.type;
  if (value === undefined || value === null) return false;
  if (type === "multi_select") return Array.isArray(value) && value.length > 0;
  return true;
}
function canProceed(step, value) {
  return ALWAYS_READY.has(step.type) || isAnswered(step, value);
}

// ── 문항 화면 ─────────────────────────────────────────────
export function QuestionScreen({ step, t, value, setValue, onNext, onBack, progress, onQuit, reward = 0, autoAdvanceOn = true }) {
  const advTimer = useRef(null);
  useEffect(() => () => clearTimeout(advTimer.current), []);

  const pick = (v) => {
    setValue(step.id, v);
    if (autoAdvanceOn) {
      clearTimeout(advTimer.current);
      advTimer.current = setTimeout(onNext, t.tone === "calm" ? 440 : 300);
    }
  };

  const type = step.type;
  const isCard = step.card || type === "single-card";
  const tapAdvance = TAP_ADVANCE.has(type) || isCard;
  const showNext = !(tapAdvance && autoAdvanceOn);

  let control;
  if (type === "single_select" || type === "single-card") {
    const Comp = isCard ? OptionCard : OptionRow;
    control = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(step.options || []).map((o) => (
          <Comp key={o.value} option={o} t={t} selected={value === o.value} onClick={() => pick(o.value)} />
        ))}
      </div>
    );
  } else if (type === "multi_select") {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (v) => setValue(step.id, arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    control = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(step.options || []).map((o) => (
          <OptionRow key={o.value} option={o} t={t} multi selected={arr.includes(o.value)} onClick={() => toggle(o.value)} />
        ))}
      </div>
    );
  } else if (type === "scale_0_10") {
    control = <ScaleSlider value={value ?? step.def} onChange={(v) => setValue(step.id, v)} labels={step.labels} t={t} />;
  } else if (type === "likert_0_3") {
    control = <Likert value={value} onChange={pick} labels={step.labels} t={t} />;
  } else if (type === "yes_no") {
    control = <YesNo value={value} onChange={pick} t={t} />;
  } else if (type === "numeric") {
    control = <NumberStepper value={value ?? step.def} onChange={(v) => setValue(step.id, v)} unit={step.unit} min={step.min} max={step.max} t={t} />;
  } else if (type === "time" || type === "composite") {
    control = <Time2 fields={step.fields} value={value} onChange={(v) => setValue(step.id, v)} t={t} />;
  } else if (type === "bmi") {
    control = <BmiInput fields={step.fields} value={value} onChange={(v) => setValue(step.id, v)} t={t} />;
  } else if (type === "free_text") {
    control = <FreeText value={value} onChange={(v) => setValue(step.id, v)} placeholder={step.placeholder} maxLength={step.max_length || step.maxLength} t={t} />;
  } else if (type === "checklist_with_frequency") {
    control = <ChecklistWithFrequency rows={step.rows} value={value} onChange={(v) => setValue(step.id, v)} t={t} />;
  } else {
    control = <p style={{ color: t.ter }}>지원되지 않는 문항 타입: {type}</p>;
  }

  const nextReady = canProceed(step, value);

  return (
    <Shell t={t}>
      <ProgressHeader t={t} progress={progress} onBack={onBack} stage={step.stage} reward={reward} />
      <Body style={{ paddingTop: 22 }}>
        <QTitle t={t} text={step.text} help={step.help} />
        {step.sleepMascot && (
          <div style={{ position: "absolute", right: 18, top: 96, pointerEvents: "none" }}>
            <Mascot variant="sleep" size={64} float={false} />
          </div>
        )}
        {control}
        <div style={{ flex: 1 }} />
      </Body>
      {(showNext || onQuit) && (
        <Footer>
          {onQuit && (
            <button
              type="button"
              onClick={onQuit}
              style={{
                display: "block", margin: "0 auto 12px", padding: "4px 8px",
                background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 13.5, fontWeight: 600, color: t.ter,
                textDecoration: "underline", textUnderlineOffset: 3,
              }}
            >
              나중에 하기
            </button>
          )}
          {showNext && <PrimaryButton t={t} label="다음" onClick={onNext} disabled={!nextReady} />}
        </Footer>
      )}
    </Shell>
  );
}

// ── 인터스티셜 (축하 / 왜 묻는지) ─────────────────────────
export function InterstitialScreen({ step, t, onNext, onBack, progress }) {
  const why = step.variant === "why";
  return (
    <Shell t={t} bg={why ? t.bg : t.paper}>
      <ProgressHeader t={t} progress={progress} onBack={onBack} stage={step.stage} showStage={!why} />
      <Body style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        {step.mascot && <Mascot variant={step.mascot} size={150} />}
        {why && (
          <div style={{ width: 64, height: 64, borderRadius: 20, marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "center", background: t.accentSoft }}>
            <Icon icon="solar:heart-pulse-linear" size={32} color={t.accentStrong} />
          </div>
        )}
        {step.eyebrow && (
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: t.accentStrong, marginBottom: 10 }}>{step.eyebrow}</span>
        )}
        <h1 style={{ margin: step.mascot ? "20px 0 0" : 0, fontSize: 26, lineHeight: 1.34, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line" }}>
          {step.title}
        </h1>
        <p style={{ margin: "16px 0 0", fontSize: 15.5, lineHeight: 1.6, color: t.sub, wordBreak: "keep-all", whiteSpace: "pre-line", maxWidth: 290 }}>
          {step.body}
        </p>
      </Body>
      <Footer><PrimaryButton t={t} label={step.cta} onClick={onNext} /></Footer>
    </Shell>
  );
}

// ── 차분한 전환 (정신건강 진입) ───────────────────────────
export function TransitionScreen({ step, t, onNext, onBack, progress }) {
  return (
    <Shell t={t} bg={t.paper}>
      <ProgressHeader t={t} progress={progress} onBack={onBack} stage={step.stage} />
      <Body style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ width: 70, height: 70, borderRadius: 22, marginBottom: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", border: `1.5px solid ${t.line}`, boxShadow: t.shadow }}>
          <Icon icon="solar:leaf-linear" size={34} color={t.accent} />
        </div>
        <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.34, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line" }}>
          {step.title}
        </h1>
        <p style={{ margin: "18px 0 0", fontSize: 15.5, lineHeight: 1.65, color: t.sub, wordBreak: "keep-all", whiteSpace: "pre-line", maxWidth: 300 }}>
          {step.body}
        </p>
        {step.note && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 24, padding: "9px 15px", borderRadius: 999, background: t.accentSoft, fontSize: 13, fontWeight: 600, color: t.accentStrong }}>
            <Icon icon="solar:lock-keyhole-minimalistic-linear" size={15} />{step.note}
          </span>
        )}
      </Body>
      <Footer><PrimaryButton t={t} label={step.cta} onClick={onNext} /></Footer>
    </Shell>
  );
}

// ── Before / After ────────────────────────────────────────
export function CompareScreen({ step, t, onNext, onBack, progress }) {
  const card = (label, items, after) => (
    <div style={{ flex: 1, borderRadius: 20, padding: "18px 16px 14px", position: "relative", overflow: "hidden", minHeight: 250, background: after ? t.accentTint : "#F3F4F4", border: `1.5px solid ${after ? t.accent : "#E7E9E9"}` }}>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em", color: after ? t.accentStrong : "#9AA0A0", marginBottom: 14 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {items.map((it) => (
          <div key={it} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Icon icon={after ? "solar:check-circle-bold" : "solar:close-circle-linear"} size={19} color={after ? t.accent : "#B7BCBC"} />
            <span style={{ fontSize: 14.5, fontWeight: after ? 700 : 500, wordBreak: "keep-all", color: after ? t.text : "#8A9090" }}>{it}</span>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", right: 6, bottom: 4, opacity: after ? 1 : 0.55 }}>
        <Mascot variant={after ? "happy" : "sleep"} size={60} float={after} />
      </div>
    </div>
  );
  return (
    <Shell t={t}>
      <ProgressHeader t={t} progress={progress} onBack={onBack} stage={step.stage} showStage={false} />
      <Body style={{ paddingTop: 24 }}>
        <h1 style={{ margin: 0, fontSize: 25, lineHeight: 1.32, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line", textAlign: "center" }}>{step.title}</h1>
        <p style={{ margin: "12px 0 0", fontSize: 14.5, color: t.sub, wordBreak: "keep-all", textAlign: "center" }}>{step.subtitle}</p>
        <div style={{ display: "flex", gap: 11, marginTop: 28, alignItems: "stretch" }}>
          {card(step.before.label, step.before.items, false)}
          {card(step.after.label, step.after.items, true)}
        </div>
      </Body>
      <Footer><PrimaryButton t={t} label={step.cta} onClick={onNext} /></Footer>
    </Shell>
  );
}

// ── 손가락 싸인 패드 (저장 안 함, 로컬만) ─────────────────
function SignaturePad({ t, placeholder, onInk }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [inked, setInked] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const ctx = c.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = t.text;
    } catch {
      /* noop */
    }
  }, [t.text]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e) => { drawing.current = true; last.current = pos(e); e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked) { setInked(true); onInk && onInk(true); }
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    setInked(false);
    onInk && onInk(false);
  };

  return (
    <div style={{ position: "relative", borderRadius: 18, background: "#fff", border: `1.5px solid ${t.line}`, boxShadow: t.shadow, height: 188, overflow: "hidden" }}>
      {!inked && (
        <span style={{ position: "absolute", top: 18, left: 18, fontSize: 15, color: t.ter, pointerEvents: "none", wordBreak: "keep-all" }}>{placeholder}</span>
      )}
      <canvas
        ref={canvasRef}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        style={{ width: "100%", height: "100%", touchAction: "none", display: "block", cursor: "crosshair" }}
      />
      {inked && (
        <button type="button" onClick={clear} style={{ position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: 999, border: "none", background: "#F0F1F1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon icon="solar:close-linear" size={16} color={t.sub} />
        </button>
      )}
    </div>
  );
}

// ── 결심 약속 + 싸인 ──────────────────────────────────────
export function CommitmentScreen({ step, t, onNext, onBack, progress }) {
  const [inked, setInked] = useState(false);
  return (
    <Shell t={t} bg={t.paper}>
      <ProgressHeader t={t} progress={progress} onBack={onBack} stage={step.stage} showStage={false} />
      <Body style={{ paddingTop: 18 }}>
        <h1 style={{ margin: 0, fontSize: 25, lineHeight: 1.32, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line" }}>{step.title}</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "24px 0 20px" }}>
          {step.vows.map((v, i) => (
            <div key={v} className="chd-rise" style={{ display: "flex", alignItems: "flex-start", gap: 11, animationDelay: `${0.12 + i * 0.12}s` }}>
              <Icon icon="solar:check-circle-bold" size={22} color={t.accent} style={{ marginTop: 1 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 600, color: t.text, wordBreak: "keep-all" }}>{v}</span>
            </div>
          ))}
        </div>
        <SignaturePad t={t} placeholder={step.placeholder} onInk={setInked} />
        <p style={{ margin: "14px 0 0", textAlign: "center", fontSize: 12.5, color: t.ter, wordBreak: "keep-all" }}>※ {step.note}</p>
        <div style={{ flex: 1 }} />
      </Body>
      <Footer><PrimaryButton t={t} label={step.cta} onClick={onNext} disabled={!inked} /></Footer>
    </Shell>
  );
}

// ── 분석 로딩 (자동으로 결과로) ───────────────────────────
export function LoadingScreen({ step, t, onNext }) {
  const [pct, setPct] = useState(0);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const total = 3400;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / total);
      setPct(Math.round(p * 100));
      setIdx(Math.min(step.steps.length - 1, Math.floor(p * step.steps.length)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else window.setTimeout(onNext, 480);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const R = 78;
  const C = 2 * Math.PI * R;
  return (
    <Shell t={t} bg={t.paper}>
      <Body style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ position: "relative", width: 196, height: 196, marginBottom: 30 }}>
          <svg width="196" height="196" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="98" cy="98" r={R} fill="none" stroke={t.accentSoft} strokeWidth="14" />
            <circle cx="98" cy="98" r={R} fill="none" stroke={t.accent} strokeWidth="14" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .1s linear" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <Mascot variant="search" size={86} />
          </div>
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, color: t.accentStrong, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{pct}%</div>
        <h1 style={{ margin: "14px 0 0", fontSize: 24, lineHeight: 1.34, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line" }}>{step.title}</h1>
        <div style={{ marginTop: 14, height: 24, position: "relative", width: "100%" }}>
          {step.steps.map((s, i) => (
            <p key={s} style={{ position: "absolute", inset: 0, margin: 0, fontSize: 15, color: t.sub, wordBreak: "keep-all", opacity: idx === i ? 1 : 0, transform: idx === i ? "translateY(0)" : "translateY(6px)", transition: "opacity .4s ease, transform .4s ease" }}>{s}</p>
          ))}
        </div>
      </Body>
    </Shell>
  );
}

// ── 결과 (개인화 인사이트) ────────────────────────────────
export function ResultScreen({ step, t, userName, onNext }) {
  const insights = step.insights || [];
  return (
    <Shell t={t} bg={t.paper}>
      <Body style={{ paddingTop: 26 }}>
        <div style={{ textAlign: "center" }}>
          <Mascot variant="cheer" size={104} />
          <span style={{ display: "block", marginTop: 4, fontSize: 13, fontWeight: 700, color: t.accentStrong }}>분석 완료</span>
          <h1 style={{ margin: "8px 0 0", fontSize: 27, lineHeight: 1.3, fontWeight: 800, letterSpacing: "-0.02em", color: t.text, wordBreak: "keep-all", whiteSpace: "pre-line" }}>
            {(userName ? userName + "님을 위한\n" : "당신을 위한\n") + "시작점을 찾았어요"}
          </h1>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 24 }}>
          {insights.map((ins, i) => (
            <div key={ins.tag} className="chd-rise" style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "15px 16px", borderRadius: 16, background: "#fff", border: `1px solid ${t.line}`, boxShadow: t.shadow, animationDelay: `${0.1 + i * 0.13}s` }}>
              <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: t.accentTint, color: t.accentStrong }}>
                <Icon icon={ins.icon} size={23} />
              </span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: t.accentStrong }}>{ins.tag}</span>
                <p style={{ margin: "3px 0 0", fontSize: 14.5, lineHeight: 1.5, color: t.text, wordBreak: "keep-all" }}>{ins.text}</p>
              </div>
            </div>
          ))}
        </div>
        {step.routine && (
          <div style={{ marginTop: 16, padding: "16px 18px", borderRadius: 16, background: t.accent, display: "flex", alignItems: "center", gap: 12 }}>
            <Icon icon="solar:star-bold" size={22} color="#2A2620" />
            <span style={{ fontSize: 15, fontWeight: 700, color: "#2A2620", wordBreak: "keep-all" }}>{step.routine}</span>
          </div>
        )}
        {step.points > 0 && (
          <p style={{ margin: "14px 0 0", textAlign: "center", fontSize: 13.5, fontWeight: 600, color: t.accentStrong }}>
            설문 완료 보상 +{step.points}P 적립됐어요
          </p>
        )}
        <div style={{ flex: 1 }} />
      </Body>
      <Footer><PrimaryButton t={t} label={step.cta} onClick={onNext} /></Footer>
    </Shell>
  );
}

import { Copy, Ticket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api/api";

/* 가입 초대코드 관리.
 *
 * 앱은 프로덕션에 공개돼 있어도 코드가 없으면 가입이 안 된다.
 * 코드는 '계정을 만들 때'만 쓰이므로, 코드를 막아도 이미 가입한 사람은
 * 그대로 쓸 수 있다.
 */

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ko-KR");
}

/** 정원 표시 — 무제한이면 사용 인원만 보여준다. */
function usageText(item) {
  if (item.max_uses === null) return `${item.used_count}명 (무제한)`;
  return `${item.used_count} / ${item.max_uses}명`;
}

export default function InviteCodes() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // 발급 폼
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    api
      .inviteCodes()
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (isBusy) return;
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await api.createInviteCode({
        code: code.trim(),
        label: label.trim(),
        // 빈칸이면 무제한 / 무기한
        maxUses: maxUses.trim() ? Number(maxUses) : null,
        // <input type="date"> 는 날짜만 주므로 그날 끝(23:59)까지 유효하게 만든다
        expiresAt: expiresAt ? `${expiresAt}T23:59:59` : null,
      });
      setNotice(`${created.code} 코드를 발급했어요.`);
      setCode("");
      setLabel("");
      setMaxUses("");
      setExpiresAt("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function toggleActive(item) {
    setError("");
    try {
      await api.updateInviteCode(item.id, { isActive: !item.is_active });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function copyCode(value) {
    navigator.clipboard
      ?.writeText(value)
      .then(() => setNotice(`${value} 복사했어요.`))
      .catch(() => setNotice("복사하지 못했어요. 직접 선택해 복사해 주세요."));
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>초대코드</h1>
        <p className="page-desc">
          이 코드가 있어야 신규 가입이 됩니다. 아이디 가입과 카카오 첫 로그인
          모두에 적용돼요. 이미 가입한 회원은 코드를 막아도 계속 이용합니다.
        </p>
      </header>

      {error && <p className="error-banner">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      <form className="invite-form" onSubmit={handleCreate}>
        <div className="invite-form-row">
          <label>
            코드
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="비우면 자동 생성"
            />
          </label>
          <label>
            메모
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="예: 1차 참여자"
            />
          </label>
          <label>
            인원 제한
            <input
              type="number"
              min="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="비우면 무제한"
            />
          </label>
          <label>
            만료일
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>
          <button className="btn-primary" type="submit" disabled={isBusy}>
            {isBusy ? "발급 중…" : "발급"}
          </button>
        </div>
      </form>

      {!items ? (
        <p className="muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          발급된 코드가 없어요. 코드가 하나도 없으면 아무도 가입할 수 없습니다.
        </p>
      ) : (
        <div className="safety-list">
          {items.map((it) => (
            <div
              key={it.id}
              className="safety-card"
              style={{ borderLeftColor: it.usable ? "#4c9a6a" : "#9aa0a6" }}
            >
              <div className="safety-main">
                <div className="safety-top">
                  <span
                    className="risk-badge"
                    style={
                      it.usable
                        ? { color: "#2f6b4a", background: "#e6f2ea" }
                        : { color: "#6b6b6b", background: "#eeeeee" }
                    }
                  >
                    <Ticket size={13} /> {it.usable ? "사용 가능" : "사용 불가"}
                  </span>
                </div>

                <button
                  className="safety-user invite-code-value"
                  onClick={() => copyCode(it.code)}
                  title="클릭하면 복사됩니다"
                >
                  {it.code} <Copy size={13} />
                </button>

                <p style={{ margin: "6px 0" }}>{it.label || "—"}</p>
                <p className="safety-meta">
                  {usageText(it)} · 만료 {formatDate(it.expires_at)} · 발급{" "}
                  {formatDate(it.created_at)}
                  {!it.is_active && " · 차단됨"}
                </p>
              </div>

              <div className="safety-actions">
                <button
                  className={it.is_active ? "btn-ghost" : "btn-primary"}
                  onClick={() => toggleActive(it)}
                >
                  {it.is_active ? "차단" : "다시 열기"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/*5-6. Ranking.jsx: 홈의 "랭킹" 카드에서 진입. 전체 환자 XP 랭킹 화면.
 * 랭킹 기준은 CP가 아니라 XP(누적 경험치) — 백엔드 GET /api/points/ranking.
 * 화면에는 XP를 "경험치"라는 이름으로 표시한다(순위 산정 근거이므로 노출).
 */
import { useEffect, useState } from "react";

// 상위 3명 메달 — 1·2·3위 순서.
const MEDALS = ["🥇", "🥈", "🥉"];

// 아바타 배경색 — user_id를 해시해 일관된 색을 입힌다(생동감 + 식별성).
const AVATAR_COLORS = [
  "linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)",
  "linear-gradient(135deg, #43C6AC 0%, #19867E 100%)",
  "linear-gradient(135deg, #6A8DFF 0%, #3F5CD6 100%)",
  "linear-gradient(135deg, #FF8FB1 0%, #E2548A 100%)",
  "linear-gradient(135deg, #B06AFF 0%, #7B3FD6 100%)",
  "linear-gradient(135deg, #5BD2FF 0%, #1E9FD6 100%)",
];

function avatarStyle(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
}

// 아바타에 표시할 머리글자 (한글/영문 첫 글자, 없으면 ?)
function initial(userId) {
  const ch = (userId || "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function Ranking({ onBack }) {
  const [data, setData] = useState(null);        // { me, top }
  const [status, setStatus] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/points/ranking", { credentials: "include" });
        if (!res.ok) throw new Error(`ranking ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setStatus("ok");
        }
      } catch (err) {
        console.error("[Ranking] load failed:", err);
        if (!cancelled) setStatus("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const top = data?.top ?? [];
  const podium = top.slice(0, 3);   // 1~3위 — 시상대 포디움
  const rest = top.slice(3);        // 4~100위 — 아래 리스트
  const me = data?.me ?? null;
  // 내가 상위 100위 밖이면 리스트 맨 아래에 내 순위를 따로 표시
  const meOutsideList = me != null && !top.some((e) => e.is_me);

  return (
    <div className="ranking-page">
      <header className="ranking-header">
        <button
          type="button"
          className="ranking-back"
          onClick={onBack}
          aria-label="뒤로 가기"
        >
          ‹
        </button>
        <h1 className="ranking-title">랭킹</h1>
        <span className="ranking-header-spacer" aria-hidden="true" />
      </header>

      <p className="ranking-sub">랭킹 순위는 경험치(XP)를 기반으로 정해집니다</p>

      {status === "loading" && (
        <p className="ranking-state">랭킹을 불러오는 중…</p>
      )}
      {status === "error" && (
        <p className="ranking-state">랭킹을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>
      )}
      {status === "ok" && top.length === 0 && (
        <p className="ranking-state">아직 랭킹 데이터가 없어요.</p>
      )}

      {status === "ok" && top.length > 0 && (
        <>
          {/* 상위 3명 — 시상대 포디움 (2위 - 1위 - 3위, 막대 높이 차등) */}
          <section className="ranking-podium" aria-label="상위 3위">
            {podium.map((entry, idx) => (
              <div
                key={entry.rank}
                className={
                  `podium-col podium-${entry.rank}` +
                  (entry.is_me ? " is-me" : "")
                }
              >
                <div className="podium-info">
                  {/* 1위 머리 위 왕관 — 둥실 떠오르는 애니메이션 */}
                  {entry.rank === 1 && (
                    <span className="podium-crown" aria-hidden="true">👑</span>
                  )}
                  {/* 아바타 — 프로필 사진 있으면 사진, 없으면 머리글자 + 색상 */}
                  <span className="podium-avatar-wrap">
                    {entry.profile_image_path ? (
                      <span className="podium-avatar podium-avatar--photo">
                        <img
                          className="podium-avatar-img"
                          src={entry.profile_image_path}
                          alt={`${entry.user_id} 프로필 사진`}
                        />
                      </span>
                    ) : (
                      <span className="podium-avatar" style={avatarStyle(entry.user_id)}>
                        {initial(entry.user_id)}
                      </span>
                    )}
                    <span className="podium-medal" aria-hidden="true">
                      {MEDALS[idx]}
                    </span>
                  </span>
                  <span className="podium-user" title={entry.user_id}>
                    {entry.user_id}
                  </span>
                  <span className="podium-level">Lv.{entry.level}</span>
                  <span className="podium-xp">
                    {entry.xp.toLocaleString()} 경험치
                  </span>
                </div>
                {/* 시상대 막대 — 1위가 가장 높고 가운데, 2위·3위 순으로 낮아짐 */}
                <div className="podium-bar">
                  <span className="podium-bar-shine" aria-hidden="true" />
                  <span className="podium-bar-rank">{entry.rank}</span>
                </div>
              </div>
            ))}
          </section>

          {/* 4위 이하 전체 리스트 — 스크롤하며 100위까지 확인 */}
          {rest.length > 0 && (
            <section className="ranking-list" aria-label="4위 이하 순위">
              <div className="ranking-list-head">
                <span className="ranking-rank">순위</span>
                <span className="ranking-user">환자</span>
                <span className="ranking-level">레벨</span>
                <span className="ranking-xp">경험치</span>
              </div>
              {rest.map((entry) => (
                <div
                  key={entry.rank}
                  className={"ranking-row" + (entry.is_me ? " is-me" : "")}
                >
                  <span className="ranking-rank">{entry.rank}</span>
                  <span className="ranking-user" title={entry.user_id}>
                    {entry.user_id}
                    {entry.is_me && <span className="ranking-me-tag">나</span>}
                  </span>
                  <span className="ranking-level">Lv.{entry.level}</span>
                  <span className="ranking-xp">
                    {entry.xp.toLocaleString()}
                  </span>
                </div>
              ))}
            </section>
          )}

          {/* 내가 100위 밖이면 따로 표시 */}
          {meOutsideList && (
            <section className="ranking-list ranking-me-floating">
              <p className="ranking-me-label">내 순위</p>
              <div className="ranking-row is-me">
                <span className="ranking-rank">{me.rank}</span>
                <span className="ranking-user" title={me.user_id}>
                  {me.user_id}
                  <span className="ranking-me-tag">나</span>
                </span>
                <span className="ranking-level">Lv.{me.level}</span>
                <span className="ranking-xp">{me.xp.toLocaleString()}</span>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default Ranking;

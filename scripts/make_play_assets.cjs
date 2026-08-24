/* Google Play 스토어 등록물 생성.
 *   assets/play/play-icon-512.png              앱 아이콘 (512x512, 투명 없음)
 *   assets/play/feature-graphic-1024x500.png   그래픽 이미지 (스토어 상단 배너)
 *
 * 실행: node scripts/make_play_assets.cjs
 * 소스: public/cheese/happy_normal.svg (앱 아이콘과 같은 체다 마스코트)
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MASCOT_SVG = path.join(ROOT, "public/cheese/happy_normal.svg");
const OUT = path.join(ROOT, "assets/play");

// 앱 테마 색 (src/index.css 와 동일 계열)
const CREAM = "#FAF7EF";
const CREAM_DEEP = "#F1EADA"; // 치즈 구멍 장식
const TEXT_MAIN = "#33302A";
const TEXT_SUB = "#6B665C";
const ACCENT_BG = "#FFF0B8";
const ACCENT_LINE = "rgba(209,169,22,0.35)";

// 한글이 있는 시스템 폰트 우선 — 없으면 sans-serif 로 폴백
const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";

fs.mkdirSync(OUT, { recursive: true });
const mascotSvg = fs.readFileSync(MASCOT_SVG);

/** 마스코트를 지정 크기의 투명 PNG 버퍼로 렌더 */
function mascot(size) {
  return sharp(mascotSvg, { density: 1200 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** 1) 스토어 아이콘 512x512 — 투명도 없이 크림 배경에 마스코트 */
async function buildIcon() {
  const SIZE = 512;
  const out = path.join(OUT, "play-icon-512.png");

  const composed = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: CREAM,
    },
  })
    .composite([{ input: await mascot(Math.round(SIZE * 0.72)), gravity: "center" }])
    .png()
    .toBuffer();

  // flatten 은 composite 보다 먼저 적용되므로 반드시 두 번째 패스에서 눌러야
  // 알파가 실제로 사라진다 (Play 아이콘은 투명 영역이 없는 편이 안전).
  await sharp(composed).flatten({ background: CREAM }).png().toFile(out);

  return out;
}

/** 2) 그래픽 이미지 1024x500 — 좌측 마스코트 + 우측 문구 */
async function buildFeatureGraphic() {
  const W = 1024;
  const H = 500;
  const out = path.join(OUT, "feature-graphic-1024x500.png");

  // 배경 + 장식 + 텍스트를 한 장의 SVG 로 그린다.
  // (스토어가 가장자리를 살짝 잘라낼 수 있어 내용은 안쪽에 모아둔다)
  const bg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>

  <!-- 치즈 구멍 느낌의 장식 -->
  <circle cx="60"  cy="70"  r="46" fill="${CREAM_DEEP}"/>
  <circle cx="150" cy="430" r="30" fill="${CREAM_DEEP}"/>
  <circle cx="960" cy="90"  r="38" fill="${CREAM_DEEP}"/>
  <circle cx="900" cy="420" r="24" fill="${CREAM_DEEP}"/>
  <circle cx="520" cy="40"  r="18" fill="${CREAM_DEEP}"/>

  <!-- 앱 이름 -->
  <text x="450" y="212"
        font-family="${FONT}" font-size="96" font-weight="800"
        fill="${TEXT_MAIN}" letter-spacing="-2">Cheddar</text>

  <!-- 한 줄 소개 -->
  <text x="454" y="272"
        font-family="${FONT}" font-size="35" font-weight="600"
        fill="${TEXT_SUB}">먹고, 기록하고, 응원받고</text>

  <!-- 기능 요약 배지 -->
  <rect x="450" y="312" width="452" height="62" rx="31"
        fill="${ACCENT_BG}" stroke="${ACCENT_LINE}" stroke-width="2"/>
  <text x="676" y="352" text-anchor="middle"
        font-family="${FONT}" font-size="27" font-weight="700"
        fill="${TEXT_MAIN}">AI 식단 분석 · 마음 돌봄 · 포인트</text>
</svg>`);

  // 텍스트를 또렷하게 얻으려고 4배로 렌더한 뒤 정확히 1024x500 으로 줄인다
  const composed = await sharp(bg, { density: 288 })
    .resize(W, H)
    .composite([{ input: await mascot(340), top: 80, left: 70 }])
    .png()
    .toBuffer();

  await sharp(composed).flatten({ background: CREAM }).png().toFile(out);

  return out;
}

(async () => {
  const files = [await buildIcon(), await buildFeatureGraphic()];
  for (const f of files) {
    const meta = await sharp(f).metadata();
    console.log(
      `${path.relative(ROOT, f)}  ${meta.width}x${meta.height}  ` +
        `alpha=${meta.hasAlpha}  ${(fs.statSync(f).size / 1024).toFixed(0)}KB`,
    );
  }
})();

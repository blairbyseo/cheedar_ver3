/* 체다 마스코트(public/cheese/normal.svg) → 안드로이드 알림 작은 아이콘(ic_stat_cheddar) 생성.
 *
 * 안드로이드 상태바/알림 아이콘은 색을 무시하고 알파(모양)만 쓴다. 그래서
 * - 캐릭터 실루엣을 흰색으로 채우고
 * - 어두운 이목구비(눈·입·외곽선 안쪽)는 구멍으로 뚫어 체다 얼굴이 보이게 하고
 * - 발밑 회색 그림자는 뺀다(채도 낮은 밝은 회색 픽셀).
 * 색종이가 있는 happy_* 대신 normal.svg — 24dp 에선 색종이가 잡티로 보인다.
 *
 * 실행: node scripts/make_notification_icon.cjs
 * 쓰는 곳: capacitor.config.json plugins.LocalNotifications.smallIcon
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SVG = path.join(ROOT, "public/cheese/normal.svg");
const RES = path.join(ROOT, "android/app/src/main/res");
// 24dp 기준. 안드로이드 권장대로 사방 2dp 여백(내용 20dp).
const DENSITIES = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };

async function iconPng(size) {
  const inner = Math.round(size * (20 / 24));
  const { data, info } = await sharp(fs.readFileSync(SVG), { density: 1200 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let a = data[i * 4 + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum < 90) a = 0; // 눈·입·외곽선 → 구멍
    if (sat < 45 && lum >= 90) a = 0; // 회색 그림자(반투명 가장자리 포함)
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255;
    out[i * 4 + 3] = a;
  }
  const pad = Math.floor((size - info.width) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: out, raw: { width: info.width, height: info.height, channels: 4 }, left: pad, top: pad }])
    .png()
    .toBuffer();
}

(async () => {
  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `drawable-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ic_stat_cheddar.png"), await iconPng(size));
    console.log(`drawable-${density}/ic_stat_cheddar.png (${size}px)`);
  }
})();

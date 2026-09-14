/* 체다 마스코트(public/cheese/happy_normal.svg) → 앱 아이콘 소스 3종 생성.
 * @capacitor/assets 가 먹는 규격:
 *   assets/icon-foreground.png  적응형 전경(투명 배경, 캐릭터를 안전영역에)
 *   assets/icon-background.png  적응형 배경(단색 크림)
 *   assets/icon.png             레거시/원형 아이콘(크림 배경 + 캐릭터)
 * 생성 후: npx @capacitor/assets generate --android
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SVG = path.join(ROOT, "public/cheese/happy_normal.svg");
const OUT = path.join(ROOT, "assets");
const SIZE = 1024;
const CREAM = { r: 0xfa, g: 0xf7, b: 0xef, alpha: 1 }; // #FAF7EF (앱 테마 배경)

fs.mkdirSync(OUT, { recursive: true });
const svg = fs.readFileSync(SVG);

// SVG를 지정 크기의 투명 PNG 버퍼로 렌더(density 높여 선명하게)
async function mascot(pxRatio) {
  const target = Math.round(SIZE * pxRatio);
  return sharp(svg, { density: 1200 })
    .resize(target, target, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}
function canvas(bg) {
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: bg } });
}

(async () => {
  // 적응형 전경: 캐릭터를 안전영역(≈62%)에 중앙 배치, 배경 투명
  await canvas({ r: 0, g: 0, b: 0, alpha: 0 })
    .composite([{ input: await mascot(0.62), gravity: "center" }])
    .png()
    .toFile(path.join(OUT, "icon-foreground.png"));

  // 적응형 배경: 단색 크림
  await canvas(CREAM).png().toFile(path.join(OUT, "icon-background.png"));

  // 레거시/원형: 크림 배경 + 캐릭터(원형은 모서리만 잘리므로 조금 크게 ≈72%)
  await canvas(CREAM)
    .composite([{ input: await mascot(0.72), gravity: "center" }])
    .png()
    .toFile(path.join(OUT, "icon.png"));

  console.log("생성 완료:", fs.readdirSync(OUT).join(", "));
})();

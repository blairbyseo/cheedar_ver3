/* iOS 앱 아이콘 + 실행 화면(스플래시) 생성.
 *   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024x1024
 *   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png   2732x2732 (3장)
 *
 * 실행: node scripts/make_ios_assets.cjs
 * 소스: public/cheese/normal.svg — 효과 없는 기본 표정. 축하 효과(색종이)가 있는
 *       happy_normal.svg 는 아이콘 크기에서 산만해 보여 쓰지 않는다.
 *       배경색은 Play 아이콘(make_play_assets.cjs)과 같은 크림색.
 *
 * 왜 따로 있나: `npx cap add ios` 가 만든 기본 아이콘·스플래시(Capacitor 로고)가
 * 그대로 남아 있었다. 크기·알파 검사는 통과하므로 눈으로 보기 전엔 모르고,
 * 그대로 내면 애플이 임시 아이콘으로 반려한다(2.3.8).
 *
 * 아이콘: 1024x1024, 알파 채널 없음(있으면 업로드 거부). 모서리는 iOS 가 깎으므로
 *         정사각형 그대로. Contents.json 이 단일 1024(universal)만 가리키므로
 *         파일명은 유지한다.
 * 스플래시: LaunchScreen.storyboard 가 scaleAspectFill 로 띄운다. 세로 폰에서는
 *         가운데 약 45% 폭만 보이므로 마스코트를 작게(23%) 가운데 둔다.
 *         Contents.json 이 1x/2x/3x 를 같은 2732 이미지로 가리키므로 3장 다 쓴다.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MASCOT_SVG = path.join(ROOT, "public/cheese/normal.svg");
const ASSETS = path.join(ROOT, "ios/App/App/Assets.xcassets");

const CREAM = "#FAF7EF"; // make_play_assets.cjs 와 동일

const mascotSvg = fs.readFileSync(MASCOT_SVG);

/** 크림 배경 정사각형 가운데에 마스코트를 얹고 알파 없이 저장 */
async function render(size, mascotRatio, outPaths) {
  const m = Math.round(size * mascotRatio);
  // SVG 라 해상도 손실 없이 크게 렌더한 뒤 줄인다
  const mascot = await sharp(mascotSvg, { density: 1200 })
    .resize(m, m, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const composed = await sharp({
    create: { width: size, height: size, channels: 4, background: CREAM },
  })
    .composite([{ input: mascot, gravity: "center" }])
    .png()
    .toBuffer();

  // flatten 은 composite 보다 먼저 적용되므로 두 번째 패스에서 눌러야 알파가
  // 실제로 사라진다. removeAlpha 로 RGB 3채널로 떨어뜨린다.
  const flat = await sharp(composed)
    .flatten({ background: CREAM })
    .removeAlpha()
    .png()
    .toBuffer();

  for (const out of outPaths) {
    fs.writeFileSync(out, flat);
    const meta = await sharp(out).metadata();
    console.log(
      `${path.relative(ROOT, out)}  ${meta.width}x${meta.height}  alpha=${meta.hasAlpha}`,
    );
    if (meta.width !== size || meta.height !== size || meta.hasAlpha) {
      console.error("크기 또는 알파 채널이 요구사항과 다릅니다.");
      process.exit(1);
    }
  }
}

(async () => {
  // 1) 앱 아이콘 — 마스코트가 가로로 팔을 벌린 모양이라 폭 기준 80%
  await render(1024, 0.8, [
    path.join(ASSETS, "AppIcon.appiconset/AppIcon-512@2x.png"),
  ]);

  // 2) 실행 화면
  await render(
    2732,
    0.23,
    ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"].map(
      (f) => path.join(ASSETS, "Splash.imageset", f),
    ),
  );
})();

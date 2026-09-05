/* App Store(iOS)용 스크린샷 생성.
 *
 * 입력: assets/appstore/raw/*.png   (iPhone 17 Pro 원본 1206x2622)
 * 출력: assets/appstore/*.png       (1320x2868 = App Store 6.9인치 필수 규격)
 *
 * 왜 이렇게 하나:
 *   - App Store Connect 는 아이폰 스크린샷을 6.9인치(1320x2868) 기준으로 요구하고
 *     나머지 크기는 애플이 자동 축소해 쓴다. 원본(6.3인치)은 규격이 맞지 않는다.
 *   - 원본과 목표의 가로세로비가 0.45996 vs 0.46025 로 사실상 같아서
 *     확대해도 잘림/왜곡이 없다.
 *   - 상태바(시계·와이파이)는 잘라낸다. 스크롤된 화면에서는 본문과 겹쳐 지저분하고,
 *     스토어 스크린샷에 실제 기기 상태바가 보일 이유도 없다.
 *
 * 실행: node scripts/make_appstore_screenshots.cjs
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "assets/appstore/raw");
const OUT = path.join(ROOT, "assets/appstore");

// App Store Connect 는 디스플레이 크기별로 슬롯이 나뉘고 요구 픽셀이 다르다.
// 둘 다 만들어두면 어느 슬롯에 올리든 맞는다.
const SIZES = [
  { name: "6.9-inch", W: 1320, H: 2868, shotH: 2330, shotTop: 420, title: 82, sub: 46, titleY: 196, subY: 286 },
  { name: "6.5-inch", W: 1284, H: 2778, shotH: 2250, shotTop: 410, title: 80, sub: 45, titleY: 190, subY: 278 },
];

// 원본에서 잘라낼 시스템 영역 (원본 1206x2622 기준 픽셀)
const CROP_TOP = 180; // 상태바 + 다이나믹 아일랜드
//   iPhone 17 Pro 의 상단 안전영역은 59pt, @3x 라 177px. 여유를 둬 180 으로 자른다.
//   150 으로는 다이나믹 아일랜드 아랫부분이 검게 남았다.
const CROP_BOTTOM = 30; // 홈 인디케이터

const RADIUS = 48;

const CREAM = "#FAF7EF";
const TEXT_MAIN = "#33302A";
const TEXT_SUB = "#6B665C";
const FONT = "'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";

// 파일명 → [제목, 부제]
const CAPTIONS = {
  "01-home": ["기록할수록 쌓이는 재미", "포인트와 레벨로 매일이 이어져요"],
  "02-diet": ["사진 한 장이면 끝", "AI가 음식을 항목별로 나눠 분석해요"],
  "03-chat": ["오늘 하루, 편하게 이야기해요", "내 기분을 아는 AI 체다"],
  "04-point": ["모은 포인트는 현금으로", "목표를 채우면 보상을 받아요"],
};

/** 상태바를 잘라내고 둥근 모서리를 씌운 화면 이미지 */
async function roundedShot(file, SHOT_H) {
  const src = sharp(file);
  const { width, height } = await src.metadata();

  const cropped = await src
    .extract({
      left: 0,
      top: CROP_TOP,
      width,
      height: height - CROP_TOP - CROP_BOTTOM,
    })
    .toBuffer();

  const resized = await sharp(cropped).resize({ height: SHOT_H }).png().toBuffer();
  const meta = await sharp(resized).metadata();

  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">
       <rect width="${meta.width}" height="${meta.height}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/>
     </svg>`,
  );

  const rounded = await sharp(resized)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  return { buffer: rounded, width: meta.width, height: meta.height };
}

/** 배경 + 문구 레이어 */
function background(title, subtitle, S) {
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${S.W}" height="${S.H}">
  <rect width="${S.W}" height="${S.H}" fill="${CREAM}"/>
  <text x="${S.W / 2}" y="${S.titleY}" text-anchor="middle"
        font-family="${FONT}" font-size="${S.title}" font-weight="800"
        fill="${TEXT_MAIN}" letter-spacing="-1.5">${title}</text>
  <text x="${S.W / 2}" y="${S.subY}" text-anchor="middle"
        font-family="${FONT}" font-size="${S.sub}" font-weight="500"
        fill="${TEXT_SUB}">${subtitle}</text>
</svg>`);
}

(async () => {
  if (!fs.existsSync(RAW)) {
    console.error(`원본 폴더가 없습니다: ${RAW}`);
    process.exit(1);
  }

  const files = fs.readdirSync(RAW).filter((f) => f.endsWith(".png")).sort();
  if (files.length === 0) {
    console.error("원본 스크린샷이 없습니다.");
    process.exit(1);
  }

  for (const S of SIZES) {
    const outDir = path.join(OUT, S.name);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n[${S.name}] ${S.W}x${S.H}`);

    for (const f of files) {
      const key = path.basename(f, ".png");
      const [title, subtitle] = CAPTIONS[key] ?? ["Cheddar", ""];
      const shot = await roundedShot(path.join(RAW, f), S.shotH);

      // 앱 배경도 크림색이라 그냥 얹으면 캔버스와 경계가 안 보인다 → 옅은 테두리
      const border = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${shot.width}" height="${shot.height}">
           <rect x="1.5" y="1.5" width="${shot.width - 3}" height="${shot.height - 3}"
                 rx="${RADIUS}" ry="${RADIUS}"
                 fill="none" stroke="rgba(51,48,42,0.16)" stroke-width="3"/>
         </svg>`,
      );
      const shotLeft = Math.round((S.W - shot.width) / 2);

      const out = path.join(outDir, `${key}.png`);
      const composed = await sharp(background(title, subtitle, S), { density: 72 })
        .composite([
          { input: shot.buffer, top: S.shotTop, left: shotLeft },
          { input: border, top: S.shotTop, left: shotLeft },
        ])
        .png()
        .toBuffer();

      await sharp(composed).flatten({ background: CREAM }).png().toFile(out);

      const meta = await sharp(out).metadata();
      const ok = meta.width === S.W && meta.height === S.H;
      console.log(`  ${ok ? "✓" : "✗"} ${key}.png  ${meta.width}x${meta.height}`);
      if (!ok) process.exitCode = 1;
    }
  }

  console.log(`\n출력: ${OUT}/<규격>/`);
  console.log("App Store Connect 의 해당 디스플레이 슬롯에 그대로 업로드하면 됩니다.");
})();

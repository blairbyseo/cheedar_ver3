/* Play 스토어용 휴대전화 스크린샷 생성.
 *
 * 입력: assets/play/screenshots/raw/*.png  (에뮬레이터 원본 1280x2856)
 * 출력: assets/play/screenshots/*.png      (1440x2560 = 9:16, 문구 포함)
 *
 * 왜 그대로 안 올리나:
 *   원본은 세로가 너무 길어(2.23:1) Play 가 권장하는 9:16 을 벗어난다.
 *   그래서 크림색 캔버스(9:16) 위에 얹고, 상단에 한 줄 설명을 넣는다.
 *
 * 실행: node scripts/make_play_screenshots.cjs
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "assets/play/screenshots/raw");
const OUT = path.join(ROOT, "assets/play/screenshots");

// 출력 캔버스 — 9:16
const W = 1440;
const H = 2560;

// 원본에서 잘라낼 시스템 영역 (상태바 / 제스처바)
const CROP_TOP = 100;
const CROP_BOTTOM = 55;

// 화면 이미지 배치
const SHOT_H = 2120; // 화면 높이
const SHOT_TOP = 350; // 캔버스 위에서부터의 위치
const RADIUS = 44; // 모서리 둥글기

const CREAM = "#FAF7EF";
const TEXT_MAIN = "#33302A";
const TEXT_SUB = "#6B665C";
const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";

// 파일명 → 상단 문구 (제목, 부제)
const CAPTIONS = {
  "01-home": ["기록할수록 쌓이는 재미", "포인트와 레벨로 매일이 이어져요"],
  "02-diet": ["사진 한 장이면 끝", "AI가 음식을 항목별로 분석해요"],
  "03-chat": ["오늘 하루, 편하게 이야기해요", "내 식단과 기분을 아는 AI 체다"],
  "04-ranking": ["혼자보다 같이", "함께 참여하는 사람들과 순위 비교"],
  "05-settings": ["알림도 탈퇴도 내 마음대로", "필요 없으면 언제든 끄고 지울 수 있어요"],
};

/** 둥근 모서리 마스크를 씌운 화면 이미지 버퍼 */
async function roundedShot(file) {
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

  // 잘라낸 비율 그대로 높이를 SHOT_H 에 맞춘다
  const resized = await sharp(cropped)
    .resize({ height: SHOT_H })
    .png()
    .toBuffer();
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
function background(title, subtitle) {
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <text x="${W / 2}" y="170" text-anchor="middle"
        font-family="${FONT}" font-size="76" font-weight="800"
        fill="${TEXT_MAIN}" letter-spacing="-1.5">${title}</text>
  <text x="${W / 2}" y="252" text-anchor="middle"
        font-family="${FONT}" font-size="42" font-weight="500"
        fill="${TEXT_SUB}">${subtitle}</text>
</svg>`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs
    .readdirSync(RAW)
    .filter((f) => f.endsWith(".png"))
    .sort();

  for (const f of files) {
    const key = path.basename(f, ".png");
    const [title, subtitle] = CAPTIONS[key] ?? ["Cheddar", ""];
    const shot = await roundedShot(path.join(RAW, f));

    const out = path.join(OUT, `${key}.png`);
    // 앱 배경도 크림색이라 그냥 얹으면 캔버스와 경계가 안 보인다 → 옅은 테두리
    const border = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${shot.width}" height="${shot.height}">
         <rect x="1" y="1" width="${shot.width - 2}" height="${shot.height - 2}"
               rx="${RADIUS}" ry="${RADIUS}"
               fill="none" stroke="rgba(51,48,42,0.16)" stroke-width="3"/>
       </svg>`,
    );
    const shotLeft = Math.round((W - shot.width) / 2);

    const composed = await sharp(background(title, subtitle), { density: 72 })
      .composite([
        { input: shot.buffer, top: SHOT_TOP, left: shotLeft },
        { input: border, top: SHOT_TOP, left: shotLeft },
      ])
      .png()
      .toBuffer();

    await sharp(composed).flatten({ background: CREAM }).png().toFile(out);

    const meta = await sharp(out).metadata();
    console.log(
      `${path.relative(ROOT, out)}  ${meta.width}x${meta.height}  ` +
        `alpha=${meta.hasAlpha}  ${(fs.statSync(out).size / 1024).toFixed(0)}KB`,
    );
  }
})();

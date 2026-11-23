/* 식단 사진의 촬영 시각 읽기 + 그 시각으로 날짜/끼니 제안하기.
 *
 * 촬영 시각은 사진 파일 안의 EXIF(DateTimeOriginal)에 "2026:11:22 19:12:05" 형태로
 * 적혀 있다. 시간대 없는 '기기 현지 벽시계 시각'이라, 우리도 시간대 없이
 * "YYYY-MM-DDTHH:mm:ss" 문자열로만 다룬다 (Date 로 바꾸면 UTC 변환이 끼어든다).
 *
 * 위치(GPS) 등 다른 EXIF 값은 읽지 않는다 — 촬영 시각만 쓴다.
 * JPEG 만 지원한다. PNG/WebP(스크린샷·받은 사진)는 시각 정보가 없는 게 보통이라 null.
 */
import { isViewOnlyDate, todayStr, toDateStr } from "./recordDate";

// EXIF 는 파일 맨 앞쪽에 있다. 썸네일이 커도 이 정도면 충분하다.
const HEAD_BYTES = 256 * 1024;

const TAG_EXIF_IFD = 0x8769;          // IFD0 → Exif 하위 IFD 위치
const TAG_DATETIME = 0x0132;          // 파일 수정 시각 (촬영 시각이 없을 때 차선)
const TAG_DATETIME_ORIGINAL = 0x9003; // 촬영 시각
const TAG_DATETIME_DIGITIZED = 0x9004;

// IFD(태그 목록) 하나에서 원하는 태그들의 값을 찾는다. ASCII·LONG 만 다룬다.
function readIfd(view, tiffStart, ifdOffset, little, wanted) {
  const found = {};
  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return found;
  const count = view.getUint16(base, little);
  for (let i = 0; i < count; i += 1) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    if (!wanted.includes(tag)) continue;
    const type = view.getUint16(entry + 2, little);
    const n = view.getUint32(entry + 4, little);
    if (type === 4) {
      found[tag] = view.getUint32(entry + 8, little);
    } else if (type === 2) {
      // 4바이트 이하면 값이 칸 안에, 넘으면 다른 위치에 있다.
      const pos = n <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little);
      if (pos + n > view.byteLength) continue;
      let s = "";
      for (let k = 0; k < n; k += 1) {
        const c = view.getUint8(pos + k);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      found[tag] = s;
    }
  }
  return found;
}

// JPEG 앞부분에서 EXIF 촬영 시각 원문("YYYY:MM:DD HH:MM:SS")을 꺼낸다. 없으면 null.
export function readExifDateString(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // JPEG 아님

  let pos = 2;
  while (pos + 4 <= view.byteLength) {
    if (view.getUint8(pos) !== 0xff) return null;
    const marker = view.getUint8(pos + 1);
    if (marker === 0xda || marker === 0xd9) return null; // 이미지 본문 시작 — 더 볼 것 없음
    const size = view.getUint16(pos + 2);
    const isExif =
      marker === 0xe1 &&
      pos + 10 <= view.byteLength &&
      view.getUint32(pos + 4) === 0x45786966 && // "Exif"
      view.getUint16(pos + 8) === 0;
    if (!isExif) {
      pos += 2 + size;
      continue;
    }

    const tiff = pos + 10;
    if (tiff + 8 > view.byteLength) return null;
    const order = view.getUint16(tiff);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;
    if (view.getUint16(tiff + 2, little) !== 42) return null;

    const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, little), little, [
      TAG_EXIF_IFD,
      TAG_DATETIME,
    ]);
    const sub =
      typeof ifd0[TAG_EXIF_IFD] === "number"
        ? readIfd(view, tiff, ifd0[TAG_EXIF_IFD], little, [
            TAG_DATETIME_ORIGINAL,
            TAG_DATETIME_DIGITIZED,
          ])
        : {};
    return sub[TAG_DATETIME_ORIGINAL] || sub[TAG_DATETIME_DIGITIZED] || ifd0[TAG_DATETIME] || null;
  }
  return null;
}

const pad = (n) => String(n).padStart(2, "0");

// Date → 시간대 없는 현지 시각 문자열
export function toLocalStamp(d) {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// EXIF 원문 → "YYYY-MM-DDTHH:mm:ss". 형식이 깨졌거나 있을 수 없는 날짜면 null.
export function exifDateToStamp(raw) {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw || "");
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null; // 2월 31일 같은 값
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/* 사진의 촬영 시각("YYYY-MM-DDTHH:mm:ss") — 알 수 없으면 null.
 *
 * dataUrl: 미리보기용으로 이미 읽어 둔 파일 내용(FileReader.readAsDataURL 결과).
 * 파일을 따로 한 번 더 읽지 않고 미리보기와 같은 데이터에서 꺼낸다 — 안드로이드 앱에서
 * 같은 사진을 동시에 두 번 읽는 일을 없애고, 화면에 보이는 사진과 시각이 항상 짝이 맞게 한다.
 *
 * fromCamera: '카메라로 촬영' 버튼으로 방금 찍은 사진인지. 이 경우 EXIF 가 없어도
 * 지금 시각이 곧 촬영 시각이다. 갤러리 사진은 EXIF 가 없으면 추측하지 않는다
 * (파일 수정 시각은 다운로드·복사 시각일 수 있어 믿을 수 없다).
 * 미래 시각(기기 시계 오류)은 버린다.
 */
export function photoTakenAtFromDataUrl(dataUrl, { fromCamera = false } = {}) {
  let stamp = null;
  try {
    const comma = typeof dataUrl === "string" ? dataUrl.indexOf(",") : -1;
    if (comma > 0 && dataUrl.slice(0, comma).endsWith(";base64")) {
      // base64 는 4글자 = 3바이트. 앞부분만 4의 배수 길이로 잘라 디코딩한다.
      const chars = Math.ceil(HEAD_BYTES / 3) * 4;
      const bin = atob(dataUrl.slice(comma + 1, comma + 1 + chars));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      stamp = exifDateToStamp(readExifDateString(bytes.buffer));
    }
  } catch (err) {
    console.warn("[photoTime] EXIF read failed:", err);
  }
  const now = toLocalStamp(new Date());
  if (stamp && stamp.slice(0, 10) > now.slice(0, 10)) stamp = null;
  if (!stamp && fromCamera) stamp = now;
  return stamp;
}

// 촬영 시각이 분명한 식사 시간대일 때만 끼니를 제안한다. 애매한 시간은 null
// (오후 3시 사진을 '간식'이라고 단정하지 않는다 — 늦은 점심일 수 있다).
export function mealTypeForHour(hour) {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return null;
}

// "19:12" → "저녁 7:12" 처럼 읽기 쉬운 말로
export function formatClock(stamp) {
  const h = Number(stamp.slice(11, 13));
  const mm = stamp.slice(14, 16);
  const period = h < 5 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${mm}`;
}

/* 촬영 시각과 지금 고른 날짜·끼니가 어긋나면 옮길 곳을 제안한다. 어긋나지 않으면 null.
 *
 * - 날짜: 촬영 날짜가 기록 가능한 범위(최근 7일~오늘)일 때만 제안한다.
 *   그보다 오래된 사진은 어차피 그 날짜로 기록할 수 없으므로 지금 날짜를 그대로 둔다.
 * - 끼니: 분명한 식사 시간대일 때만 제안한다.
 * 반환: { date, mealType } — 바꿀 필요 없는 쪽은 현재 값 그대로.
 */
export function suggestPlacement(stamp, currentDate, currentMealType) {
  if (!stamp) return null;
  const photoDate = stamp.slice(0, 10);
  const canMoveDate = photoDate <= todayStr() && !isViewOnlyDate(photoDate);
  const date = canMoveDate ? photoDate : currentDate;
  // 사진 날짜로 기록하지 못하는 경우엔 시각도 그날 식사와 무관하므로 끼니를 건드리지 않는다.
  const mealType =
    (photoDate === date && mealTypeForHour(Number(stamp.slice(11, 13)))) || currentMealType;
  if (date === currentDate && mealType === currentMealType) return null;
  return { date, mealType };
}

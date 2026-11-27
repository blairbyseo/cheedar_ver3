/**
 * 체다 → 구글시트 '체다 사용자 데이터' 자동 동기화 (Google Apps Script)
 *
 * 설치 (시트에서 한 번만):
 *  1) 시트 메뉴 [확장 프로그램] → [Apps Script] → 이 파일 내용을 통째로 붙여넣고 저장
 *  2) 왼쪽 톱니바퀴 [프로젝트 설정] → 맨 아래 [스크립트 속성] → 속성 추가
 *       SYNC_TOKEN = (서버 .env 의 SHEET_SYNC_TOKEN 값)
 *  3) 위쪽 함수 선택에서 setupTrigger 고르고 [실행] → 권한 허용
 *     → 바로 한 번 동기화하고, 그 뒤로 10분마다 자동 실행
 *
 * 동작:
 *  - '참여율' 시트: A~C열(아이디·닉네임·XP)만 덮어쓴다. D열부터 적어 둔 메모는 건드리지 않는다
 *    (단, 순서가 XP 순으로 바뀌므로 줄 옆 메모는 다른 회원 옆으로 밀릴 수 있다).
 *  - '건강 데이터' 시트: 전체를 지우고 다시 쓴다.
 *  - 두 시트 모두 매번 예전 서식을 지우고 같은 글꼴·크기·색·테두리로 다시 칠한다.
 *  - 각 시트 A1 셀 메모에 마지막 동기화 시각을 남긴다.
 */

const SYNC_URL = 'https://api.cheddar-care.com/api/sheet-sync';
const PARTICIPATION_SHEET = '참여율';
const HEALTH_SHEET = '건강 데이터';
const INTERVAL_MINUTES = 10;

function syncCheddar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return; // 이전 실행이 아직 도는 중

  try {
    const token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (!token) throw new Error('스크립트 속성 SYNC_TOKEN 이 비어 있어요.');

    const res = UrlFetchApp.fetch(SYNC_URL, {
      headers: { 'X-Sync-Token': token },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      throw new Error('체다 서버 응답 ' + code + ': ' + res.getContentText().slice(0, 200));
    }
    const data = JSON.parse(res.getContentText());
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1) 참여율 — A~C열만 (D열부터 적어 둔 메모는 그대로)
    const p = getOrCreateSheet_(ss, PARTICIPATION_SHEET);
    const pRows = data.participation;
    const pLast = Math.max(p.getLastRow(), pRows.length);
    p.getRange(1, 1, pLast, 3).clear(); // 값 + 예전 서식까지 지움
    writeTable_(p, pRows);
    p.getRange('A1').setNote('마지막 동기화: ' + data.updated_at);

    // 2) 건강 데이터 — 시트 전체
    const h = getOrCreateSheet_(ss, HEALTH_SHEET);
    h.clear(); // 값 + 예전 서식까지 지움
    writeTable_(h, data.health);
    h.getRange('A1').setNote('마지막 동기화: ' + data.updated_at);
  } finally {
    lock.releaseLock();
  }
}

/** 10분마다 syncCheddar 가 돌도록 트리거를 (다시) 만든다. 처음 한 번만 실행. */
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncCheddar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCheddar').timeBased().everyMinutes(INTERVAL_MINUTES).create();
  syncCheddar();
}

/** 자동 동기화를 끄고 싶을 때 실행. */
function removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncCheddar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

// ---- 표 스타일 (두 시트 공통) -------------------------------------------------
const STYLE = {
  font: 'Arial',
  size: 10,
  color: '#202124',
  headerBg: '#f1f3f4',
  border: '#dadce0',
  // 머리글 색 — 걸음/수면 열을 한눈에 구분 (관리자 화면의 걸음 청록·수면 남보라와 같은 계열)
  stepsHeaderBg: '#d9f2ee',
  stepsHeaderColor: '#0f766e',
  sleepHeaderBg: '#e4e3fb',
  sleepHeaderColor: '#4338ca',
};

/** 머리글 이름으로 걸음/수면 열을 가른다. 둘 다 아니면 공통 열(회색). */
function headerKind_(name) {
  if (/걸음/.test(name)) return 'steps';
  if (/수면|잠든|일어난/.test(name)) return 'sleep';
  return 'common';
}

/** 표를 쓰고 같은 스타일을 입힌다. 숫자는 숫자로, 나머지(날짜·시각 포함)는 글자 그대로 둔다. */
function writeTable_(sheet, rows) {
  const nRows = rows.length;
  const nCols = rows[0].length;
  const range = sheet.getRange(1, 1, nRows, nCols);

  // 날짜·시각 문자열을 시트가 멋대로 날짜로 바꿔 모양이 들쭉날쭉해지지 않게 '텍스트'로 고정
  range.setNumberFormats(
    rows.map((r) => r.map((v) => (typeof v === 'number' ? '#,##0' : '@')))
  );
  range.setValues(rows);

  range
    .setFontFamily(STYLE.font)
    .setFontSize(STYLE.size)
    .setFontColor(STYLE.color)
    .setFontWeight('normal')
    .setFontStyle('normal')
    .setBackground(null)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false)
    .setBorder(true, true, true, true, true, true, STYLE.border, SpreadsheetApp.BorderStyle.SOLID);

  const header = sheet.getRange(1, 1, 1, nCols);
  header.setFontWeight('bold').setWrap(true);
  const kinds = rows[0].map((name) => headerKind_(String(name)));
  header.setBackgrounds([
    kinds.map((k) =>
      k === 'steps' ? STYLE.stepsHeaderBg : k === 'sleep' ? STYLE.sleepHeaderBg : STYLE.headerBg
    ),
  ]);
  header.setFontColors([
    kinds.map((k) =>
      k === 'steps' ? STYLE.stepsHeaderColor : k === 'sleep' ? STYLE.sleepHeaderColor : STYLE.color
    ),
  ]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, nCols);
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

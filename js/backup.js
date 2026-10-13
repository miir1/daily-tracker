// 백업: JSON 내보내기·가져오기(병합), CSV 내보내기, 백업 알림 판단.
// 파일은 사용자 기기에 직접 저장될 뿐, 어디로도 전송하지 않는다.
import { STORES, getAllFrom, putInto, getSetting, setSetting, getAllDays } from './db.js';
import { todaySeoul, addDays, nowSeoulISO } from './date.js';

const APP_ID = 'daily-tracker';

// 브라우저에서 파일 다운로드를 일으키는 도우미.
// 메모리에 파일(Blob)을 만들고, 보이지 않는 링크를 눌러 저장시킨다.
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- JSON 내보내기 ----------
// 저장소 4개를 통째로 한 파일에 담는다. 다시 가져올 수 있는 유일한 형식.
export async function exportJSON() {
  const data = { app: APP_ID, version: 1, exportedAt: nowSeoulISO() };
  for (const store of STORES) {
    let rows = await getAllFrom(store);
    // 마지막 백업 날짜는 기기마다 다른 값이라 백업에 넣지 않는다.
    if (store === 'settings') rows = rows.filter(r => r.key !== 'lastBackup');
    data[store] = rows;
  }
  const today = todaySeoul();
  download(`daily-tracker-${today}.json`, JSON.stringify(data, null, 1), 'application/json');
  await setSetting('lastBackup', today);
  return today;
}

// ---------- JSON 가져오기 (병합) ----------
// 규칙: 날짜별로 합친다. 같은 날짜가 양쪽에 있으면 updatedAt이 더 최신인 쪽을 남긴다.
// 이 기기에만 있는 기록은 그대로 둔다 (지우지 않음).
const KEY = { days: 'date', weeks: 'weekStart', ideas: 'id', settings: 'key' };

export async function importJSON(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('파일이 손상됐거나 JSON 형식이 아닙니다.'); }
  if (!data || data.app !== APP_ID || !Array.isArray(data.days)) {
    throw new Error('데일리 체크 백업 파일이 아닙니다.');
  }
  const result = { added: 0, updated: 0, kept: 0 };
  for (const store of STORES) {
    const incoming = Array.isArray(data[store]) ? data[store] : [];
    const keyName = KEY[store];
    const existing = new Map((await getAllFrom(store)).map(r => [r[keyName], r]));
    for (const rec of incoming) {
      if (rec == null || rec[keyName] == null) continue;
      if (store === 'settings' && rec.key === 'lastBackup') continue;
      const mine = existing.get(rec[keyName]);
      let take;
      if (!mine) take = true;
      // updatedAt은 "2026-10-12T21:35:00+09:00" 형식이라 글자 비교만으로 시간 순서가 맞다.
      else take = (rec.updatedAt || '') > (mine.updatedAt || '');
      if (take) await putInto(store, rec);
      if (store === 'days') {
        if (!mine) result.added++;
        else if (take) result.updated++;
        else result.kept++;
      }
    }
  }
  return result;
}

// ---------- CSV 내보내기 ----------
// 한 줄 = 하루. 스프레드시트(엑셀, 구글 시트)에서 열어 보기용. 가져오기는 안 됨.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // 쉼표·따옴표·줄바꿈이 들어 있으면 따옴표로 감싸고, 안의 따옴표는 두 번 쓴다.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCSV(config) {
  const days = (await getAllDays()).sort((a, b) => a.date.localeCompare(b.date));
  // 체크 열: 설정 순서대로 + 지금은 목록에 없지만 옛 기록에 남은 항목
  const checkIds = config.checks.map(c => c.id);
  for (const d of days) for (const id of Object.keys(d.checks || {})) if (!checkIds.includes(id)) checkIds.push(id);
  const numIds = ['tasks_done', 'rule_violations', 'game_hours', 'sleep_hours', 'coding_minutes', 'weight'];

  const header = ['date', ...checkIds, ...numIds, 'tasks', 'meals', 'note', 'updatedAt'];
  const lines = [header.join(',')];
  for (const d of days) {
    const row = [
      d.date,
      // 체크: 했으면 1, 안 했으면 0, 기록 자체가 없으면 빈칸
      ...checkIds.map(id => (id in (d.checks || {}) ? (d.checks[id] ? 1 : 0) : '')),
      ...numIds.map(id => d.numbers?.[id]),
      (d.tasks || []).filter(t => t.text).map(t => (t.done ? '[v] ' : '[ ] ') + t.text).join(' / '),
      (d.meals || []).map(m => `${m.time || '--:--'} ${m.kind} ${m.text}`).join(' / '),
      d.note,
      d.updatedAt,
    ];
    lines.push(row.map(csvCell).join(','));
  }
  // 맨 앞 ﻿(BOM): 엑셀이 한글을 깨뜨리지 않게 UTF-8임을 알려주는 표시
  download(`daily-tracker-${todaySeoul()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

// ---------- 백업 알림 ----------
// 마지막 백업 후 7일이 지났으면 지난 일수를, 아니면 null.
// 한 번도 백업하지 않았다면 가장 오래된 기록 날짜부터 센다 (기록이 없으면 알림 없음).
export async function backupOverdueDays() {
  const today = todaySeoul();
  let since = await getSetting('lastBackup');
  if (!since) {
    const days = await getAllDays();
    if (days.length === 0) return null;
    since = days.map(d => d.date).sort()[0];
  }
  let n = 0;
  for (let d = since; d < today && n < 9999; d = addDays(d, 1)) n++;
  return n >= 7 ? n : null;
}

export function lastBackupDate() {
  return getSetting('lastBackup');
}

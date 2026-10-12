// 앱 시작점: 오늘 탭 화면 + 탭 전환 + 백업·비공개 항목 연결.
// 공통 로직은 core.js, 각 탭은 workout.js / weekly.js / stats.js / settings.js.
import { todaySeoul, addDays, weekday, formatKo, nowSeoulHM } from './date.js';
import { getAllDays, requestPersist, getSetting, setSetting } from './db.js';
import { exportJSON, importJSON, exportCSV, backupOverdueDays, lastBackupDate } from './backup.js';
import { state, loadRecord, save, buildConfig, visibleChecks, completion } from './core.js';
import { renderWorkoutCard, walkTarget, isWorkoutDay } from './workout.js';
import { renderWeekly, initWeekly } from './weekly.js';
import { renderStats, initStats } from './stats.js';
import { renderSettings, initSettings, applyTheme } from './settings.js';

const $ = sel => document.querySelector(sel);

let viewDate = null;    // 지금 보고 있는 날짜
let record = null;      // viewDate의 하루 기록
let nextRecord = null;  // viewDate+1의 하루 기록 ('내일 할 일 3개'가 여기에 저장됨)
let currentView = 'view-today';

// ---------- 계산 ----------

// 연속 달성일: 완료율 70% 이상인 날이 끊기지 않고 이어진 일수.
// 오늘이 아직 70% 미만이면(하루가 안 끝났을 수 있으니) 어제부터 센다.
async function streak() {
  const all = await getAllDays();
  const byDate = new Map(all.map(r => [r.date, r]));
  const ok = d => completion(byDate.get(d), d) >= 0.7;
  let d = ok(state.today) ? state.today : addDays(state.today, -1);
  let count = 0;
  while (ok(d)) { count++; d = addDays(d, -1); }
  return count;
}

// ---------- 그리기 ----------

async function renderHeader() {
  $('#date-label').textContent = formatKo(viewDate) + (viewDate === state.today ? ' · 오늘' : '');
  $('#next-day').disabled = viewDate >= state.today;
  $('#go-today').hidden = viewDate === state.today;

  const pct = Math.round(completion(record, viewDate) * 100);
  $('#progress-fill').style.width = pct + '%';
  $('#progress-text').textContent = pct + '%';
  $('#streak').textContent = `연속 ${await streak()}일`;
}

function renderTodayTasks() {
  const box = $('#today-tasks');
  box.innerHTML = '';
  const tasks = record.tasks.filter(t => t.text);
  if (tasks.length === 0) {
    box.innerHTML = '<p class="muted">전날 적은 할 일 없음</p>';
    return;
  }
  record.tasks.forEach((t, i) => {
    if (!t.text) return;
    box.appendChild(checkRow(`task-${i}`, t.text, t.done, async checked => {
      record.tasks[i].done = checked;
      await save(record);
      renderHeader();
    }));
  });
}

function checkRow(id, label, checked, onChange, desc) {
  const row = document.createElement('label');
  row.className = 'check-row';
  row.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.className = 'check-text';
  const main = document.createElement('span');
  main.textContent = label;
  text.appendChild(main);
  if (desc) {
    const small = document.createElement('small');
    small.textContent = desc;
    text.appendChild(small);
  }
  row.append(input, text);
  return row;
}

// 그룹 접힘 상태는 이 기기의 화면 편의 설정이라 localStorage에 둔다 (없어도 동작).
function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem('collapsedGroups') || '[]'); } catch { return []; }
}
function saveCollapsed(list) {
  try { localStorage.setItem('collapsedGroups', JSON.stringify(list)); } catch { /* 무시 */ }
}

async function renderChecks() {
  const box = $('#checks');
  const items = visibleChecks(viewDate);
  const walkMin = await walkTarget(viewDate);
  box.innerHTML = '';
  for (const group of state.config.groups) {
    const inGroup = items.filter(c => c.group === group);
    if (inGroup.length === 0) continue; // 주말엔 매매 그룹 통째로 사라짐
    const det = document.createElement('details');
    det.open = !loadCollapsed().includes(group);
    det.addEventListener('toggle', () => {
      const list = loadCollapsed().filter(g => g !== group);
      if (!det.open) list.push(group);
      saveCollapsed(list);
    });
    const sum = document.createElement('summary');
    const count = document.createElement('span');
    count.className = 'group-count';
    sum.append(group, count);
    det.appendChild(sum);
    const updateCount = () => {
      count.textContent = `${inGroup.filter(c => record.checks[c.id]).length}/${inGroup.length}`;
    };
    for (const c of inGroup) {
      // 걷기는 오늘의 목표 시간을 이름에 붙인다 (2주마다 +5분)
      const label = c.id === 'walk' && walkMin ? `걷기 ${walkMin}분` : c.label;
      det.appendChild(checkRow(`chk-${c.id}`, label, record.checks[c.id], async checked => {
        record.checks[c.id] = checked;
        updateCount();
        await save(record);
        renderHeader();
      }, c.desc));
    }
    updateCount();
    box.appendChild(det);
  }
}

// 운동 요일에만 보이는 운동 카드
async function renderWorkout() {
  const card = $('#workout-card');
  const show = isWorkoutDay(viewDate, weekday(viewDate)) && (state.config.workout?.exercises || []).length;
  card.hidden = !show;
  if (!show) return;
  await renderWorkoutCard($('#workout-list'), record, async rec => {
    await save(rec);
    await renderWorkout();
    await renderChecks();
    renderHeader();
  });
}

// ---------- 예상 시간표 ----------

// 지금 시각이 이 칸 안에 있는가. 취침(23:00–07:30)처럼 자정을 넘는 칸도 처리한다.
function inSlot(slot, hm) {
  return slot.start <= slot.end
    ? hm >= slot.start && hm < slot.end
    : hm >= slot.start || hm < slot.end;
}

function renderSchedule() {
  const slots = (state.config.schedule || [])
    .filter(s => s.days.includes(weekday(viewDate)))
    .sort((a, b) => a.start.localeCompare(b.start));
  const card = $('#schedule');
  card.hidden = slots.length === 0;
  if (!slots.length) return;

  // '지금 / 다음'은 오늘을 볼 때만 의미가 있다
  const hm = nowSeoulHM();
  const nowIdx = viewDate === state.today ? slots.findIndex(s => inSlot(s, hm)) : -1;
  if (nowIdx >= 0) {
    const cur = slots[nowIdx];
    const next = slots[(nowIdx + 1) % slots.length];
    $('#schedule-now').textContent = `지금 ${cur.label} ~${cur.end} · 다음 ${next.label}`;
  } else {
    $('#schedule-now').textContent = `시간표 ${slots.length}칸`;
  }

  const list = $('#schedule-list');
  list.innerHTML = '';
  slots.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'slot' + (i === nowIdx ? ' now' : '');
    const time = document.createElement('span');
    time.className = 'slot-time';
    time.textContent = `${s.start}–${s.end}`;
    const text = document.createElement('span');
    text.className = 'check-text';
    const main = document.createElement('span');
    main.textContent = s.label;
    text.appendChild(main);
    if (s.desc) {
      const small = document.createElement('small');
      small.textContent = s.desc;
      text.appendChild(small);
    }
    row.append(time, text);
    list.appendChild(row);
  });
}

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function renderNumbers() {
  const box = $('#numbers');
  box.innerHTML = '';
  for (const n of state.config.numbers) {
    const row = document.createElement('div');
    row.className = 'num-row';
    const name = document.createElement('span');
    name.className = 'num-label';
    name.textContent = n.label;
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `${n.label} 줄이기`);
    const val = document.createElement('span');
    val.className = 'num-value';
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `${n.label} 늘리기`);

    const show = () => { val.textContent = `${fmtNum(record.numbers[n.id] ?? 0)} ${n.unit}`; };
    const change = async delta => {
      // 0.5 단위 소수 오차(0.1+0.2 문제)를 막으려고 반올림해서 저장
      const next = Math.round(((record.numbers[n.id] ?? 0) + delta) * 10) / 10;
      record.numbers[n.id] = Math.max(n.min ?? 0, next);
      show();
      await save(record);
    };
    minus.addEventListener('click', () => change(-n.step));
    plus.addEventListener('click', () => change(n.step));
    show();
    row.append(name, minus, val, plus);
    box.appendChild(row);
  }

  // 체중: 측정 요일에만 입력칸 표시
  if (state.config.weightDays.includes(weekday(viewDate))) {
    const row = document.createElement('div');
    row.className = 'num-row';
    row.innerHTML = '<label class="num-label" for="weight">체중</label>';
    const input = document.createElement('input');
    input.id = 'weight';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.step = '0.1';
    input.min = '0';
    input.placeholder = 'kg';
    input.value = record.numbers.weight ?? '';
    input.addEventListener('change', async () => {
      const v = parseFloat(input.value);
      record.numbers.weight = Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
      input.value = record.numbers.weight ?? '';
      await save(record);
    });
    const unit = document.createElement('span');
    unit.className = 'muted';
    unit.textContent = 'kg';
    row.append(input, unit);
    box.appendChild(row);
  }
}

function renderBottom() {
  // '내일 할 일 3개'는 다음 날 기록의 tasks에 저장된다 → 다음 날 화면 맨 위에 체크박스로 나타남.
  const box = $('#tomorrow-tasks');
  box.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `${i + 1}.`;
    input.maxLength = 60;
    input.value = nextRecord.tasks[i]?.text ?? '';
    input.addEventListener('input', async () => {
      const tasks = [0, 1, 2].map(j => nextRecord.tasks[j] ?? { text: '', done: false });
      tasks[i] = { text: input.value.trim(), done: tasks[i].done };
      nextRecord.tasks = tasks;
      await save(nextRecord);
    });
    box.appendChild(input);
  }

  const note = $('#note');
  note.value = record.note;
  note.oninput = async () => {
    record.note = note.value;
    await save(record);
  };
}

async function openDate(date) {
  viewDate = date;
  [record, nextRecord] = await Promise.all([loadRecord(date), loadRecord(addDays(date, 1))]);
  renderTodayTasks();
  renderSchedule();
  await renderWorkout();
  await renderChecks();
  renderNumbers();
  renderBottom();
  await renderHeader();
}

async function showView(viewId) {
  currentView = viewId;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== viewId; });
  window.scrollTo(0, 0);
  if (viewId === 'view-today') { renderBackupBanner(); await openDate(viewDate); }
  if (viewId === 'view-weekly') await renderWeekly();
  if (viewId === 'view-stats') await renderStats();
  if (viewId === 'view-settings') { renderLastBackup(); renderPrivateStatus(); await renderSettings(); }
}

// ---------- 백업 (설정 탭) ----------

async function renderBackupBanner() {
  const days = await backupOverdueDays();
  $('#backup-banner').hidden = days === null;
  if (days !== null) $('#backup-banner-text').textContent = `마지막 백업 후 ${days}일 지남`;
}

async function renderLastBackup() {
  $('#last-backup').textContent = (await lastBackupDate()) || '없음';
}

function showResult(text) {
  const p = $('#backup-result');
  p.textContent = text;
  p.hidden = false;
}

function initBackup() {
  $('#backup-banner-btn').addEventListener('click', () => showView('view-settings'));

  $('#export-json').addEventListener('click', async () => {
    const date = await exportJSON();
    renderLastBackup();
    renderBackupBanner();
    showResult(`백업 파일 저장: daily-tracker-${date}.json`);
  });

  $('#export-csv').addEventListener('click', async () => {
    await exportCSV(state.config);
    showResult('CSV 파일 저장 완료');
  });

  // 가져오기 버튼 → 숨겨진 파일 선택창을 연다
  $('#import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = ''; // 같은 파일을 다시 골라도 동작하게 비워 둔다
    if (!file) return;
    try {
      const r = await importJSON(file);
      showResult(`가져오기 완료 · 새로 추가 ${r.added}일 · 갱신 ${r.updated}일 · 기존 유지 ${r.kept}일`);
      // 백업에 비공개 항목·항목 편집·설정이 들어 있었을 수 있으니 항목 목록도 다시 만든다
      await buildConfig();
      applyTheme();
      renderPrivateStatus();
      await renderSettings();
    } catch (err) {
      showResult(`가져오기 실패: ${err.message}`);
    }
  });
}

// ---------- 비공개 항목 (설정 탭) ----------

async function renderPrivateStatus() {
  const priv = await getSetting('privateItems');
  const n = priv?.checks?.length || 0;
  $('#private-status').textContent = n ? `${n}개 적용 중 (${(priv.groups || []).join(', ')})` : '없음';
  $('#private-clear').hidden = !n;
}

function showPrivateResult(text) {
  const p = $('#private-result');
  p.textContent = text;
  p.hidden = false;
}

function initPrivateItems() {
  $('#private-load').addEventListener('click', () => $('#private-file').click());
  $('#private-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      let data;
      try { data = JSON.parse(await file.text()); } catch { throw new Error('JSON 형식이 아닙니다.'); }
      if (data.app !== 'daily-tracker-private-items' || !Array.isArray(data.checks)) {
        throw new Error('비공개 항목 파일(private_items.json)이 아닙니다.');
      }
      // 필요한 필드만 골라 저장 (id, group, label, days가 모두 있어야 함)
      const checks = data.checks.filter(c => c.id && c.group && c.label && Array.isArray(c.days))
        .map(({ id, group, label, desc, days, hidden }) => ({ id, group, label, desc, days, hidden: !!hidden }));
      await setSetting('privateItems', { insertAfter: data.insertAfter, groups: data.groups || [], checks });
      await buildConfig();
      renderPrivateStatus();
      await renderSettings();
      showPrivateResult(`비공개 항목 ${checks.length}개 적용 완료. 원본 파일은 지워도 됩니다.`);
    } catch (err) {
      showPrivateResult(`불러오기 실패: ${err.message}`);
    }
  });
  $('#private-clear').addEventListener('click', async () => {
    if (!confirm('비공개 항목을 이 기기에서 지울까요? (이미 체크한 기록은 남습니다)')) return;
    await setSetting('privateItems', null);
    await buildConfig();
    renderPrivateStatus();
    await renderSettings();
    showPrivateResult('비공개 항목을 지웠습니다.');
  });
}

// ---------- 시작 ----------

async function init() {
  state.baseConfig = await fetch('items.json', { cache: 'no-cache' }).then(r => r.json());
  state.today = todaySeoul();
  await buildConfig();
  applyTheme();
  requestPersist();

  // 오프라인 동작용 서비스 워커 등록 (sw.js)
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // 새 버전의 서비스 워커가 자리를 잡으면 한 번 새로고침해서 최신 파일로 화면을 다시 그린다.
    // (입력은 즉시 저장되므로 새로고침해도 잃는 것 없음)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
    });
  }

  $('#prev-day').addEventListener('click', () => openDate(addDays(viewDate, -1)));
  $('#next-day').addEventListener('click', () => { if (viewDate < state.today) openDate(addDays(viewDate, 1)); });
  $('#go-today').addEventListener('click', () => openDate(state.today));

  // 하단 탭 전환
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  initBackup();
  initPrivateItems();
  initWeekly();
  // 달력에서 날짜를 누르면 오늘 탭에서 그날 기록을 연다
  initStats(async date => { viewDate = date; await showView('view-today'); });
  // 설정이 바뀌면 (항목·요일·목표) 오늘 탭 내용도 다시 그린다
  initSettings(async () => { await openDate(viewDate); });
  renderBackupBanner();

  // 앱을 켜 둔 채 자정이 지나면, 다시 화면을 볼 때 날짜를 새로 맞춘다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = todaySeoul();
    if (now !== state.today) {
      const wasToday = viewDate === state.today;
      state.today = now;
      if (wasToday) viewDate = now;
      showView(currentView);
    }
  });

  // 시간표의 '지금' 칸은 1분마다 갱신
  setInterval(() => { if (viewDate === state.today) renderSchedule(); }, 60 * 1000);

  await openDate(state.today);
}

init().catch(err => {
  document.body.innerHTML = `<p style="padding:16px">불러오기 실패: ${err.message}<br>
    items.json을 읽으려면 파일을 직접 열지 말고 serve.bat으로 실행하세요.</p>`;
});

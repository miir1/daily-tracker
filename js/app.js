// 오늘 탭 화면과 동작.
import { todaySeoul, addDays, weekday, formatKo, nowSeoulISO } from './date.js';
import { getDay, putDay, getAllDays, requestPersist } from './db.js';

const $ = sel => document.querySelector(sel);

let config = null;      // items.json 내용
let today = null;       // 서울 기준 오늘
let viewDate = null;    // 지금 보고 있는 날짜
let record = null;      // viewDate의 하루 기록
let nextRecord = null;  // viewDate+1의 하루 기록 ('내일 할 일 3개'가 여기에 저장됨)

// ---------- 하루 기록 ----------

function emptyRecord(date) {
  return {
    date,
    checks: {},
    numbers: { tasks_done: 0, rule_violations: 0, game_hours: 0, sleep_hours: 0, coding_minutes: 0, weight: null },
    tasks: [],
    workout: {},
    note: '',
    updatedAt: null,
  };
}

async function loadRecord(date) {
  const saved = await getDay(date);
  // 저장본이 있으면 빈 틀 위에 덮어써서, 나중에 필드가 추가돼도 빠진 값이 없게 한다.
  if (!saved) return emptyRecord(date);
  const base = emptyRecord(date);
  return { ...base, ...saved, numbers: { ...base.numbers, ...saved.numbers } };
}

// 저장: 체크·입력이 바뀔 때마다 바로 호출된다 (저장 버튼 없음).
// tasks_done은 사람이 입력하지 않고 할 일 체크 수로 자동 계산해 같이 저장한다.
async function save(rec) {
  rec.numbers.tasks_done = rec.tasks.filter(t => t.text && t.done).length;
  rec.updatedAt = nowSeoulISO();
  await putDay(rec);
}

// ---------- 계산 ----------

// 그 날짜(요일)에 보여줄 체크 항목들. 숨김 항목, 해당 요일이 아닌 항목은 빠진다.
function visibleChecks(date) {
  const wd = weekday(date);
  return config.checks.filter(c => !c.hidden && c.days.includes(wd));
}

// 완료율 = 그날 표시된 항목 중 완료 수 ÷ 전체 수. 기록이 없으면 0.
function completion(rec, date) {
  const items = visibleChecks(date);
  if (!rec || items.length === 0) return 0;
  const done = items.filter(c => rec.checks[c.id]).length;
  return done / items.length;
}

// 연속 달성일: 완료율 70% 이상인 날이 끊기지 않고 이어진 일수.
// 오늘이 아직 70% 미만이면(하루가 안 끝났을 수 있으니) 어제부터 센다.
async function streak() {
  const all = await getAllDays();
  const byDate = new Map(all.map(r => [r.date, r]));
  const ok = d => completion(byDate.get(d), d) >= 0.7;
  let d = ok(today) ? today : addDays(today, -1);
  let count = 0;
  while (ok(d)) { count++; d = addDays(d, -1); }
  return count;
}

// ---------- 그리기 ----------

async function renderHeader() {
  $('#date-label').textContent = formatKo(viewDate) + (viewDate === today ? ' · 오늘' : '');
  $('#next-day').disabled = viewDate >= today;
  $('#go-today').hidden = viewDate === today;

  const pct = Math.round(completion(record, viewDate) * 100);
  $('#progress-fill').style.width = pct + '%';
  $('#progress-text').textContent = pct + '%';
  $('#streak').textContent = `연속 ${await streak()}일`;

  // 판단 규칙: 그날 tasks_done이 0이면 당일 화면에 '게임 시간 절반' 표시.
  const tasksDone = record.tasks.filter(t => t.text && t.done).length;
  $('#game-half').hidden = tasksDone !== 0;
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

function checkRow(id, label, checked, onChange) {
  const row = document.createElement('label');
  row.className = 'check-row';
  row.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = label;
  row.append(input, span);
  return row;
}

function renderChecks() {
  const box = $('#checks');
  box.innerHTML = '';
  const items = visibleChecks(viewDate);
  for (const group of config.groups) {
    const inGroup = items.filter(c => c.group === group);
    if (inGroup.length === 0) continue; // 주말엔 매매 그룹 통째로 사라짐
    const det = document.createElement('details');
    det.open = true;
    const sum = document.createElement('summary');
    const count = document.createElement('span');
    count.className = 'group-count';
    sum.append(group, count);
    det.appendChild(sum);
    const updateCount = () => {
      count.textContent = `${inGroup.filter(c => record.checks[c.id]).length}/${inGroup.length}`;
    };
    for (const c of inGroup) {
      det.appendChild(checkRow(`chk-${c.id}`, c.label, record.checks[c.id], async checked => {
        record.checks[c.id] = checked;
        updateCount();
        await save(record);
        renderHeader();
      }));
    }
    updateCount();
    box.appendChild(det);
  }
}

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function renderNumbers() {
  const box = $('#numbers');
  box.innerHTML = '';
  for (const n of config.numbers) {
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
  if (config.weightDays.includes(weekday(viewDate))) {
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
  renderChecks();
  renderNumbers();
  renderBottom();
  await renderHeader();
}

// ---------- 시작 ----------

async function init() {
  config = await fetch('items.json', { cache: 'no-cache' }).then(r => r.json());
  today = todaySeoul();
  requestPersist();

  // 오프라인 동작용 서비스 워커 등록 (sw.js)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  $('#prev-day').addEventListener('click', () => openDate(addDays(viewDate, -1)));
  $('#next-day').addEventListener('click', () => { if (viewDate < today) openDate(addDays(viewDate, 1)); });
  $('#go-today').addEventListener('click', () => openDate(today));

  // 하단 탭: 1단계에서는 '오늘'만 동작, 나머지는 준비 중 안내
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== btn.dataset.view; });
    });
  });

  // 앱을 켜 둔 채 자정이 지나면, 다시 화면을 볼 때 날짜를 새로 맞춘다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = todaySeoul();
    if (now !== today) {
      const wasToday = viewDate === today;
      today = now;
      openDate(wasToday ? today : viewDate);
    }
  });

  await openDate(today);
}

init().catch(err => {
  document.body.innerHTML = `<p style="padding:16px">불러오기 실패: ${err.message}<br>
    items.json을 읽으려면 파일을 직접 열지 말고 serve.bat으로 실행하세요.</p>`;
});

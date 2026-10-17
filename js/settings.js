// 7단계: 설정 탭 — 체크 항목 추가·수정·숨김·순서, 운동 목표 수동 조정, 요일·테마 설정.
// 고친 내용은 IndexedDB settings에만 저장된다 (items.json 파일은 그대로).
import { state, buildConfig } from './core.js';
import { getSetting, setSetting } from './db.js';
import { getBase, computeTarget, walkTarget } from './workout.js';
import { getAllDays } from './db.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 화면에는 월요일부터

let onChanged = null; // 설정이 바뀌면 오늘 탭 등을 다시 그리게 하는 함수
let editingId = null; // 편집 중인 항목 id ('__new__' = 새 항목)

export function daysText(days) {
  const s = [...days].sort().join(',');
  if (s === '0,1,2,3,4,5,6') return '매일';
  if (s === '1,2,3,4,5') return '평일';
  if (s === '0,6') return '주말';
  if (!days.length) return '표시 안 함';
  return DAY_ORDER.filter(d => days.includes(d)).map(d => DAY_KO[d]).join('·');
}

// 요일 토글 버튼 7개를 만든다. 고를 때마다 onPick(새 요일 배열)
function dayPicker(selected, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'day-picker';
  const cur = new Set(selected);
  for (const d of DAY_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = DAY_KO[d];
    b.className = 'day-btn' + (cur.has(d) ? ' on' : '');
    b.setAttribute('aria-pressed', cur.has(d));
    b.addEventListener('click', () => {
      cur.has(d) ? cur.delete(d) : cur.add(d);
      b.classList.toggle('on', cur.has(d));
      b.setAttribute('aria-pressed', cur.has(d));
      onPick([...cur].sort());
    });
    wrap.appendChild(b);
  }
  return wrap;
}

async function getEdits() {
  return (await getSetting('itemEdits')) || { overrides: {}, added: [], order: [], groups: [] };
}

async function changed() {
  await buildConfig();
  applyTheme();
  if (onChanged) await onChanged();
  await renderSettings();
}

// ---------- 테마 ----------
export function applyTheme() {
  const t = state.prefs?.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

async function savePrefs(patch) {
  const prefs = { ...((await getSetting('prefs')) || {}), ...patch };
  await setSetting('prefs', prefs);
  await changed();
}

function renderPrefs() {
  const box = $('#prefs');
  box.innerHTML = '';

  const themeRow = document.createElement('div');
  themeRow.className = 'pref-row';
  themeRow.innerHTML = '<span class="pref-label">화면 모드</span>';
  const seg = document.createElement('div');
  seg.className = 'day-picker';
  for (const [val, text] of [['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day-btn wide' + (state.prefs.theme === val ? ' on' : '');
    b.textContent = text;
    b.addEventListener('click', () => savePrefs({ theme: val }));
    seg.appendChild(b);
  }
  themeRow.appendChild(seg);

  const weightRow = document.createElement('div');
  weightRow.className = 'pref-row';
  weightRow.innerHTML = '<span class="pref-label">체중 측정 요일</span>';
  weightRow.appendChild(dayPicker(state.prefs.weightDays, days => savePrefs({ weightDays: days })));

  const workoutRow = document.createElement('div');
  workoutRow.className = 'pref-row';
  workoutRow.innerHTML = '<span class="pref-label">근력 운동 요일</span>';
  workoutRow.appendChild(dayPicker(state.prefs.workoutDays, days => savePrefs({ workoutDays: days })));

  const restRow = document.createElement('div');
  restRow.className = 'pref-row';
  restRow.innerHTML = '<span class="pref-label">쉬는 요일 <small class="muted">기상·복약·취침과 비공개 약물 항목만 표시, 연속 기록·준수율 계산에서 제외</small></span>';
  restRow.appendChild(dayPicker(state.prefs.restDays, days => savePrefs({ restDays: days })));

  box.append(themeRow, restRow, weightRow, workoutRow);
}

// ---------- 운동 목표 수동 조정 ----------
async function renderTargets() {
  const box = $('#targets');
  box.innerHTML = '';
  const exercises = state.config.workout?.exercises || [];
  const days = (await getAllDays()).sort((a, b) => a.date.localeCompare(b.date));
  const base = await getBase();

  const row = (label, value, unit, step, onSet) => {
    const r = document.createElement('div');
    r.className = 'num-row';
    r.innerHTML = `<span class="num-label">${esc(label)}</span>`;
    const minus = document.createElement('button');
    minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', `${label} 목표 줄이기`);
    const val = document.createElement('span');
    val.className = 'num-value'; val.textContent = `${value}${unit}`;
    const plus = document.createElement('button');
    plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', `${label} 목표 늘리기`);
    minus.addEventListener('click', () => onSet(Math.max(step, value - step)));
    plus.addEventListener('click', () => onSet(value + step));
    r.append(minus, val, plus);
    box.appendChild(r);
  };

  // 수동으로 바꾸면 "오늘부터 이 값에서 다시 시작"으로 저장된다
  const setBase = async (id, value) => {
    const b = await getBase();
    b[id] = { value, since: state.today };
    await setSetting('workoutBase', b);
    await changed();
  };

  const walk = state.config.workout?.walk;
  if (walk) row('걷기', await walkTarget(state.today), '분', walk.step, v => setBase('walk', Math.min(walk.max, v)));
  for (const ex of exercises) {
    const { target } = computeTarget(ex, state.today, days, base);
    row(ex.label, target, ex.unit, ex.step, v => setBase(ex.id, v));
  }
}

// ---------- 체크 항목 편집 ----------
function renderItemList() {
  const box = $('#item-list');
  box.innerHTML = '';
  for (const group of state.config.groups) {
    const items = state.config.checks.filter(c => c.group === group);
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'item-group';
    h.textContent = group;
    box.appendChild(h);
    items.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'item-row' + (c.hidden ? ' is-hidden' : '');
      row.innerHTML = `<div class="check-text"><span>${esc(c.label)}</span>
        <small>${daysText(c.days)}${c.hidden ? ' · 숨김' : ''}${c.private ? ' · 비공개' : ''}${c.custom ? ' · 추가함' : ''}</small></div>`;
      const btns = document.createElement('div');
      btns.className = 'item-btns';
      const mk = (text, label, fn, disabled) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'icon-btn'; b.textContent = text;
        b.setAttribute('aria-label', label); b.disabled = !!disabled;
        b.addEventListener('click', fn);
        btns.appendChild(b);
      };
      mk('↑', `${c.label} 위로`, () => move(c.id, -1), i === 0);
      mk('↓', `${c.label} 아래로`, () => move(c.id, 1), i === items.length - 1);
      mk('편집', `${c.label} 편집`, () => { editingId = c.id; renderEditor(); });
      row.appendChild(btns);
      box.appendChild(row);
    });
  }
}

// 같은 그룹 안에서 한 칸 위/아래로
async function move(id, dir) {
  const ids = state.config.checks.map(c => c.id);
  const me = state.config.checks.find(c => c.id === id);
  const sameGroup = state.config.checks.filter(c => c.group === me.group).map(c => c.id);
  const neighbor = sameGroup[sameGroup.indexOf(id) + dir];
  if (!neighbor) return;
  const a = ids.indexOf(id), b = ids.indexOf(neighbor);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  const edits = await getEdits();
  edits.order = ids;
  await setSetting('itemEdits', edits);
  await changed();
}

function renderEditor() {
  const box = $('#item-editor');
  if (!editingId) { box.hidden = true; box.innerHTML = ''; return; }
  const isNew = editingId === '__new__';
  const c = isNew
    ? { id: '', label: '', desc: '', group: state.config.groups[0], days: [0, 1, 2, 3, 4, 5, 6], hidden: false, custom: true }
    : { ...state.config.checks.find(x => x.id === editingId) };
  let days = [...c.days];

  box.hidden = false;
  box.innerHTML = `
    <h2>${isNew ? '새 항목' : '항목 편집'}</h2>
    <label class="field"><span>이름</span><input id="ed-label" type="text" maxlength="60" value="${esc(c.label)}"></label>
    <label class="field"><span>설명 (선택)</span><input id="ed-desc" type="text" maxlength="100" value="${esc(c.desc || '')}"></label>
    <label class="field"><span>그룹</span><select id="ed-group">
      ${state.config.groups.map(g => `<option ${g === c.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}
      <option value="__new__">+ 새 그룹</option></select></label>
    <label class="field" id="ed-newgroup-wrap" hidden><span>새 그룹 이름</span><input id="ed-newgroup" type="text" maxlength="20"></label>
    <div class="field"><span>표시 요일</span><div id="ed-days"></div></div>
    <label class="check-row"><input id="ed-hidden" type="checkbox" ${c.hidden ? 'checked' : ''}><span>숨김 (오늘 탭에 안 보임, 기록은 남음)</span></label>
    <div class="editor-btns">
      <button id="ed-save" class="btn primary" type="button">저장</button>
      <button id="ed-cancel" class="btn" type="button">취소</button>
      ${c.custom && !isNew ? '<button id="ed-delete" class="btn" type="button">삭제</button>' : ''}
    </div>
    <p id="ed-msg" class="status" hidden></p>`;
  $('#ed-days').appendChild(dayPicker(days, d => { days = d; }));
  $('#ed-group').addEventListener('change', e => { $('#ed-newgroup-wrap').hidden = e.target.value !== '__new__'; });
  $('#ed-cancel').addEventListener('click', () => { editingId = null; renderEditor(); });

  $('#ed-save').addEventListener('click', async () => {
    const label = $('#ed-label').value.trim();
    let group = $('#ed-group').value;
    const msg = $('#ed-msg');
    if (group === '__new__') group = $('#ed-newgroup').value.trim();
    if (!label || !group) { msg.textContent = '이름과 그룹을 입력하세요.'; msg.hidden = false; return; }
    const patch = { label, desc: $('#ed-desc').value.trim() || undefined, group, days, hidden: $('#ed-hidden').checked };
    const edits = await getEdits();
    if (!state.config.groups.includes(group)) edits.groups = [...(edits.groups || []), group];
    if (isNew) {
      const id = `custom_${Date.now().toString(36)}`;
      edits.added = [...(edits.added || []), { id, ...patch }];
    } else if (c.custom) {
      edits.added = (edits.added || []).map(a => (a.id === c.id ? { ...a, ...patch } : a));
    } else {
      edits.overrides = { ...(edits.overrides || {}), [c.id]: patch };
    }
    await setSetting('itemEdits', edits);
    editingId = null;
    renderEditor();
    await changed();
  });

  const del = $('#ed-delete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`'${c.label}' 항목을 지울까요? (이미 체크한 기록은 남습니다)`)) return;
    const edits = await getEdits();
    edits.added = (edits.added || []).filter(a => a.id !== c.id);
    await setSetting('itemEdits', edits);
    editingId = null;
    renderEditor();
    await changed();
  });

  box.scrollIntoView({ block: 'start' });
}

export async function renderSettings() {
  renderPrefs();
  await renderTargets();
  renderItemList();
}

export function initSettings(onChangedCallback) {
  onChanged = onChangedCallback;
  $('#item-add').addEventListener('click', () => { editingId = '__new__'; renderEditor(); });
  $('#items-reset').addEventListener('click', async () => {
    if (!confirm('항목 순서·이름·숨김·추가한 항목을 모두 처음 상태로 되돌릴까요? (체크 기록은 남습니다)')) return;
    await setSetting('itemEdits', null);
    await changed();
  });
}

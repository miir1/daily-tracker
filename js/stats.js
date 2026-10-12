// 6단계: 기록·통계 탭 — 월 달력, 그래프(체중·수면·게임), 항목별 준수율.
// 그래프는 외부 라이브러리 없이 SVG로 직접 그린다 (오프라인에서도 동작).
import { state, completion, visibleChecks, dateRange } from './core.js';
import { addDays, weekday } from './date.js';
import { getAllDays } from './db.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt1 = n => (Math.round(n * 10) / 10).toString();

let viewMonth = null;   // "YYYY-MM"
let onOpenDate = null;  // 달력 날짜를 누르면 호출 (오늘 탭에서 그날 열기)

// ---------- 월 달력 ----------
function renderCalendar(byDate) {
  const [y, m] = viewMonth.split('-').map(Number);
  $('#month-label').textContent = `${y}년 ${m}월`;
  $('#month-next').disabled = viewMonth >= state.today.slice(0, 7);

  const first = `${viewMonth}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (weekday(first) + 6) % 7; // 월요일 시작 달력에서 1일 앞의 빈칸 수
  const grid = $('#calendar');
  grid.innerHTML = ['월', '화', '수', '목', '금', '토', '일'].map(d => `<div class="cal-head">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');

  for (let d = 1; d <= lastDay; d++) {
    const date = `${viewMonth}-${String(d).padStart(2, '0')}`;
    const rec = byDate.get(date);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    cell.textContent = d;
    if (date > state.today) {
      cell.disabled = true;
      cell.classList.add('future');
    } else if (rec) {
      // 완료율을 색 농도 5단계로 (한 가지 색, 연함 → 진함). 기록 없는 날은 빈 칸.
      const p = completion(rec, date);
      const level = p === 0 ? 0 : Math.min(4, Math.floor(p * 4) + 1);
      cell.classList.add(`lv${level}`);
      cell.title = `${date} · 완료율 ${Math.round(p * 100)}%`;
    } else {
      cell.title = `${date} · 기록 없음`;
    }
    if (date === state.today) cell.classList.add('is-today');
    cell.addEventListener('click', () => onOpenDate && onOpenDate(date));
    grid.appendChild(cell);
  }
}

// ---------- 그래프 공통 ----------
// points: [{label, value}] (value가 null이면 그 자리는 비움). 한 그래프에 한 가지 값만 (축은 하나).
function chartSVG(points, { kind = 'line', unit = '', yMax, ref, refLabel } = {}) {
  const W = 320, H = 150, L = 30, R = 10, T = 12, B = 22;
  const vals = points.map(p => p.value).filter(v => v != null);
  if (!vals.length) return '<p class="muted">기록 없음</p>';
  let lo = kind === 'bar' ? 0 : Math.min(...vals);
  let hi = Math.max(...vals, ref ?? -Infinity, yMax ?? -Infinity);
  if (kind === 'line' && yMax == null) { const pad = Math.max(0.5, (hi - lo) * 0.2); lo -= pad; hi += pad; }
  if (hi === lo) hi = lo + 1;
  const x = i => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));

  let g = '';
  // 가로 눈금 3개 (흐린 선)
  for (let k = 0; k <= 2; k++) {
    const v = lo + ((hi - lo) * k) / 2;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    g += `<text x="${L - 4}" y="${y(v) + 3}" class="axis" text-anchor="end">${fmt1(v)}</text>`;
  }
  // 기준선 (예: 수면 6시간, 게임 2시간) — 설명 글자는 그래프 제목 옆에 둔다 (막대·선과 겹치지 않게)
  if (ref != null) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(ref)}" y2="${y(ref)}" class="ref"/>`;
  }
  // x축 라벨: 처음·가운데·끝만 (양 끝은 잘리지 않게 안쪽 정렬)
  const last = points.length - 1;
  const ticks = [...new Set([0, Math.floor(last / 2), last])];
  for (const i of ticks) {
    const anchor = points.length > 1 && i === 0 ? 'start' : i === last && last > 0 ? 'end' : 'middle';
    const tx = anchor === 'start' ? x(i) - 4 : anchor === 'end' ? x(i) + 4 : x(i);
    g += `<text x="${tx}" y="${H - 6}" class="axis" text-anchor="${anchor}">${esc(points[i].label)}</text>`;
  }

  if (kind === 'bar') {
    const bw = Math.max(3, Math.min(14, (W - L - R) / points.length - 2));
    points.forEach((p, i) => {
      if (p.value == null) return;
      const h = Math.max(0, y(lo) - y(p.value));
      g += `<rect x="${x(i) - bw / 2}" y="${y(p.value)}" width="${bw}" height="${h}" rx="2" class="bar"><title>${esc(p.label)} · ${fmt1(p.value)}${unit}</title></rect>`;
    });
  } else {
    // 기록 없는 날에서 선을 끊는다
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      if (p.value == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
      pen = true;
    });
    g += `<path d="${d}" class="line"/>`;
    points.forEach((p, i) => {
      if (p.value == null) return;
      g += `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" class="dot"><title>${esc(p.label)} · ${fmt1(p.value)}${unit}</title></circle>`;
    });
    // 마지막 값만 숫자로 표시
    const lastI = points.map(p => p.value).lastIndexOf(vals[vals.length - 1]);
    g += `<text x="${Math.min(x(lastI), W - R - 2)}" y="${y(vals[vals.length - 1]) - 8}" class="val" text-anchor="end">${fmt1(vals[vals.length - 1])}${unit}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${g}</svg>`;
}

const mmdd = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// ---------- 그리기 ----------
export async function renderStats() {
  if (!viewMonth) viewMonth = state.today.slice(0, 7);
  const days = await getAllDays();
  const byDate = new Map(days.map(r => [r.date, r]));
  renderCalendar(byDate);

  // 최근 28일 (첫 기록일 이전은 제외)
  const firstDate = days.length ? days.map(d => d.date).sort()[0] : state.today;
  // 오늘 기록이 아직 없으면 오늘은 빼고 어제까지 본다 (하루가 안 끝났으니)
  const end = byDate.has(state.today) ? state.today : addDays(state.today, -1);
  let from = addDays(end, -27);
  if (from < firstDate) from = firstDate;
  const range = from <= end ? dateRange(from, end) : [];

  // 체중 추이 (측정한 날만, 최근 12회)
  const weights = days.filter(r => r.numbers?.weight != null).sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  const wDiff = weights.length >= 2 ? weights[weights.length - 1].numbers.weight - weights[weights.length - 2].numbers.weight : null;
  $('#chart-weight-note').textContent = wDiff == null ? '' : `직전 측정 대비 ${wDiff > 0 ? '+' : ''}${fmt1(wDiff)}kg`;
  $('#chart-weight').innerHTML = chartSVG(weights.map(r => ({ label: mmdd(r.date), value: r.numbers.weight })), { unit: 'kg' });

  // 수면 시간·게임 시간 (일별) — 기록 없는 날은 비움
  const series = id => range.map(d => {
    const r = byDate.get(d);
    return { label: mmdd(d), value: r ? Number(r.numbers?.[id]) || 0 : null };
  });
  $('#chart-sleep').innerHTML = chartSVG(series('sleep_hours'), { unit: '시간', yMax: 10, ref: 6, refLabel: '6시간' });
  $('#chart-game').innerHTML = chartSVG(series('game_hours'), { kind: 'bar', unit: '시간' });

  // 항목별 준수율: 그 항목이 표시된 날 대비 완료한 날 비율, 낮은 순
  const stats = new Map();
  for (const d of range) {
    const rec = byDate.get(d);
    for (const c of visibleChecks(d)) {
      const s = stats.get(c.id) || { label: c.label, shown: 0, done: 0 };
      s.shown++;
      if (rec?.checks?.[c.id]) s.done++;
      stats.set(c.id, s);
    }
  }
  const rows = [...stats.values()].map(s => ({ ...s, rate: s.done / s.shown })).sort((a, b) => a.rate - b.rate);
  $('#compliance-range').textContent = range.length ? `${mmdd(from)}–${mmdd(end)} (${range.length}일)` : '';
  $('#compliance').innerHTML = rows.map(s => `
    <div class="comp-row" title="${esc(s.label)} · ${s.done}/${s.shown}일">
      <span class="comp-label">${esc(s.label)}</span>
      <span class="comp-bar"><span style="width:${Math.round(s.rate * 100)}%"></span></span>
      <span class="comp-pct">${Math.round(s.rate * 100)}%</span>
    </div>`).join('') || '<p class="muted">기록 없음</p>';
}

export function initStats(openDateCallback) {
  onOpenDate = openDateCallback;
  const shift = n => {
    const [y, m] = viewMonth.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + n, 1));
    viewMonth = dt.toISOString().slice(0, 7);
    renderStats();
  };
  $('#month-prev').addEventListener('click', () => shift(-1));
  $('#month-next').addEventListener('click', () => shift(1));
}

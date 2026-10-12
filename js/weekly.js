// 5단계: 주간 점검 탭 — 주간 지표, 쿨다운 아이디어, 다음 주 개선 항목.
// 지표는 저장하지 않고 하루 기록에서 그때그때 계산한다.
import { state, weekStart, dateRange, daysBetween } from './core.js';
import { addDays, formatKo, nowSeoulISO, weekday } from './date.js';
import { getAllDays, getAllFrom, putInto } from './db.js';

const $ = sel => document.querySelector(sel);
const TRADE_IDS = ['prep', 'hts_close', 'no_trade_sleepy', 'entry_note'];
const COOLDOWN_DAYS = 7;

let viewWeek = null; // 보고 있는 주의 월요일

// 사용자가 입력한 글자를 HTML에 넣을 때 태그로 해석되지 않게 바꾼다
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const fmt1 = n => (Math.round(n * 10) / 10).toString();

// ---------- 지표 계산 ----------
export function weekMetrics(ws, days, today) {
  const byDate = new Map(days.map(r => [r.date, r]));
  const firstDate = days.length ? days.map(d => d.date).sort()[0] : today;
  const week = dateRange(ws, addDays(ws, 6));
  const upToToday = week.filter(d => d <= today);
  const recs = upToToday.map(d => byDate.get(d)).filter(Boolean);

  // 체중: 매일 재면 하루하루 오르내림이 크니까 주 평균으로 보고, 지난주 평균과 비교한다
  const avgWeight = (from, to) => {
    const vals = days.filter(r => r.date >= from && r.date <= to && r.numbers?.weight != null).map(r => r.numbers.weight);
    return vals.length ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
  };
  const wNow = avgWeight(ws, addDays(ws, 6));
  const wPrev = avgWeight(addDays(ws, -7), addDays(ws, -1));

  // 운동 완료율: workout 체크한 날 ÷ 7
  const workoutDays = recs.filter(r => r.checks?.workout).length;

  // 매매 규칙 준수율: 평일 매매 항목 4개 완료 수 ÷ 전체 수 (오늘까지 지난 평일만)
  const tradeDays = upToToday.filter(d => weekday(d) >= 1 && weekday(d) <= 5);
  const tradeTotal = tradeDays.length * TRADE_IDS.length;
  const tradeDone = tradeDays.reduce((n, d) => n + TRADE_IDS.filter(id => byDate.get(d)?.checks?.[id]).length, 0);

  // 복약 누락: 지난 날(오늘 제외, 첫 기록일 이후) 중 meds 체크 안 된 날
  const medsMissed = week.filter(d => d < today && d >= firstDate && !byDate.get(d)?.checks?.meds).length;

  const sum = id => recs.reduce((n, r) => n + (Number(r.numbers?.[id]) || 0), 0);
  return {
    weight: wNow ? wNow.avg : null,
    weightCount: wNow ? wNow.n : 0,
    weightDiff: wNow && wPrev ? wNow.avg - wPrev.avg : null,
    workoutDays, workoutRate: pct(workoutDays, 7),
    tradeDone, tradeTotal, tradeRate: pct(tradeDone, tradeTotal),
    codingHours: sum('coding_minutes') / 60,
    gameHours: sum('game_hours'),
    medsMissed,
  };
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
}

// ---------- 그리기 ----------
export async function renderWeekly() {
  const today = state.today;
  if (!viewWeek) viewWeek = weekStart(today);
  const thisWeek = weekStart(today);
  $('#week-label').textContent = `${formatKo(viewWeek).replace(/ \(.\)/, '')} 주` + (viewWeek === thisWeek ? ' · 이번 주' : '');
  $('#week-next').disabled = viewWeek >= thisWeek;

  const days = await getAllDays();
  const m = weekMetrics(viewWeek, days, today);
  const diff = m.weightDiff == null ? `${m.weightCount}회 측정` : `지난주 대비 ${m.weightDiff > 0 ? '+' : ''}${fmt1(m.weightDiff)}kg · ${m.weightCount}회`;
  $('#week-metrics').innerHTML = [
    tile('체중 (주 평균)', m.weight == null ? '—' : `${fmt1(m.weight)}kg`, m.weight == null ? '' : diff),
    tile('운동 완료율', `${m.workoutRate}%`, `${m.workoutDays}/7일`),
    tile('매매 규칙 준수율', m.tradeRate == null ? '—' : `${m.tradeRate}%`, m.tradeTotal ? `${m.tradeDone}/${m.tradeTotal}` : '평일 기록 없음'),
    tile('코딩 합계', `${fmt1(m.codingHours)}시간`),
    tile('게임 합계', `${fmt1(m.gameHours)}시간`),
    tile('복약 누락', `${m.medsMissed}회`, viewWeek === thisWeek ? '어제까지' : ''),
  ].join('');

  // 주간 점검 입력 (weeks 저장소)
  const weeks = await getAllFrom('weeks');
  const cur = weeks.find(w => w.weekStart === viewWeek) || { weekStart: viewWeek, checks: {}, nextImprove: '' };
  const prevWeek = weeks.find(w => w.weekStart === addDays(viewWeek, -7));
  $('#week-improve-now').textContent = prevWeek?.nextImprove || '지난주에 정한 항목 없음';

  const ideas = await getAllFrom('ideas');
  const doneThisWeek = ideas.filter(i => i.status === 'done' && i.decidedAt >= viewWeek && i.decidedAt <= addDays(viewWeek, 6)).length;

  const reviewItems = [
    { id: 'one_change', label: '이번 주 실행할 변경 1개 이하', desc: `이번 주 실행으로 정한 아이디어 ${doneThisWeek}개` },
    { id: 'projects_two', label: '진행 중 프로젝트 2개 이하 확인', desc: '수익용 1 + 학습용 1' },
    { id: 'waitlist_only', label: '대기 목록의 새 프로젝트는 추가만, 시작 안 함' },
    { id: 'weight_same', label: '체중은 매일 기상 직후 같은 조건에서 측정' },
  ];
  const box = $('#week-review');
  box.innerHTML = '';
  for (const it of reviewItems) {
    const row = document.createElement('label');
    row.className = 'check-row';
    row.innerHTML = `<input type="checkbox"><span class="check-text"><span>${esc(it.label)}</span>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</span>`;
    const input = row.querySelector('input');
    input.checked = !!cur.checks[it.id];
    input.addEventListener('change', async () => {
      cur.checks[it.id] = input.checked;
      cur.updatedAt = nowSeoulISO();
      await putInto('weeks', cur);
    });
    box.appendChild(row);
  }

  const next = $('#week-next-improve');
  next.value = cur.nextImprove || '';
  next.oninput = async () => {
    cur.nextImprove = next.value;
    cur.updatedAt = nowSeoulISO();
    await putInto('weeks', cur);
  };

  renderIdeas(ideas);
}

function renderIdeas(ideas) {
  const today = state.today;
  const list = $('#idea-list');
  list.innerHTML = '';
  const active = ideas.filter(i => i.status === 'cooldown').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const decided = ideas.filter(i => i.status !== 'cooldown').sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || '')).slice(0, 10);

  if (!active.length) list.innerHTML = '<p class="muted">쿨다운 중인 아이디어 없음</p>';
  for (const idea of active) {
    const age = daysBetween(idea.createdAt, today);
    const ready = age >= COOLDOWN_DAYS;
    const row = document.createElement('div');
    row.className = 'idea-row';
    row.innerHTML = `<div class="check-text"><span>${esc(idea.text)}</span>
      <small>${idea.createdAt} 적음 · ${age}일 지남${ready ? ' · <b>결정 가능</b>' : ` · ${COOLDOWN_DAYS - age}일 남음`}</small></div>`;
    if (ready) {
      const btns = document.createElement('div');
      btns.className = 'idea-btns';
      for (const [status, text] of [['done', '실행'], ['dropped', '폐기']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small-btn';
        b.textContent = text;
        b.addEventListener('click', async () => {
          idea.status = status;
          idea.decidedAt = today;
          idea.updatedAt = nowSeoulISO();
          await putInto('ideas', idea);
          renderWeekly();
        });
        btns.appendChild(b);
      }
      row.appendChild(btns);
    }
    list.appendChild(row);
  }

  const past = $('#idea-decided');
  past.innerHTML = decided.map(i =>
    `<div class="idea-row"><div class="check-text"><span>${esc(i.text)}</span><small>${i.status === 'done' ? '실행' : '폐기'} · ${i.decidedAt}</small></div></div>`).join('');
  $('#idea-decided-wrap').hidden = !decided.length;
}

export function initWeekly() {
  $('#week-prev').addEventListener('click', () => { viewWeek = addDays(viewWeek, -7); renderWeekly(); });
  $('#week-next').addEventListener('click', () => { viewWeek = addDays(viewWeek, 7); renderWeekly(); });
  $('#idea-add').addEventListener('click', async () => {
    const input = $('#idea-text');
    const text = input.value.trim();
    if (!text) return;
    // id는 기기 간 백업 병합 때 겹치지 않도록 시간+무작위 문자열로 만든다
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await putInto('ideas', { id, text, createdAt: state.today, status: 'cooldown', updatedAt: nowSeoulISO() });
    input.value = '';
    renderWeekly();
  });
}

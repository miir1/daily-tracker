// 여러 탭(오늘·주간·통계·설정)이 같이 쓰는 핵심 로직.
// - 항목 목록 만들기 (items.json + 비공개 항목 + 설정 탭에서 고친 내용)
// - 하루 기록 불러오기/저장
// - 완료율 계산
import { addDays, weekday, nowSeoulISO } from './date.js';
import { getDay, putDay, getSetting } from './db.js';

// 앱 전체가 공유하는 상태. 다른 파일에서 state.config 처럼 읽는다.
export const state = {
  baseConfig: null, // items.json 원본
  config: null,     // 실제로 쓰는 항목 목록
  prefs: null,      // 표시 설정 (체중 요일, 운동 요일, 테마)
  today: null,      // 서울 기준 오늘
};

export const DEFAULT_PREFS = { weightDays: [0, 1, 2, 3, 4, 5, 6], workoutDays: [1, 3, 5], restDays: [0, 6], theme: 'auto' };

// ---------- 하루 기록 ----------

export function emptyRecord(date) {
  return {
    date,
    checks: {},
    numbers: { tasks_done: 0, rule_violations: 0, game_hours: 0, sleep_hours: 0, coding_minutes: 0, weight: null },
    tasks: [],
    meals: [],      // 식사 기록 [{ time: "08:00", kind: "아침", text: "계란 2개" }]
    workout: {},
    note: '',
    updatedAt: null,
  };
}

export async function loadRecord(date) {
  const saved = await getDay(date);
  // 저장본이 있으면 빈 틀 위에 덮어써서, 나중에 필드가 추가돼도 빠진 값이 없게 한다.
  if (!saved) return emptyRecord(date);
  const base = emptyRecord(date);
  return { ...base, ...saved, numbers: { ...base.numbers, ...saved.numbers }, workout: saved.workout || {} };
}

// 저장: 체크·입력이 바뀔 때마다 바로 호출된다 (저장 버튼 없음).
// tasks_done은 사람이 입력하지 않고 할 일 체크 수로 자동 계산해 같이 저장한다.
export async function save(rec) {
  rec.numbers.tasks_done = rec.tasks.filter(t => t.text && t.done).length;
  rec.updatedAt = nowSeoulISO();
  await putDay(rec);
}

// ---------- 항목 목록 ----------
// 만드는 순서:
//   1) items.json (공개)
//   2) + 비공개 항목 (settings 'privateItems', 약물 등 — GitHub에 올라가지 않음)
//   3) + 설정 탭에서 고친 내용 (settings 'itemEdits')
//        overrides: 항목별로 바꾼 값(이름·설명·그룹·요일·숨김)
//        added:     새로 추가한 항목
//        order:     항목 순서 (id 목록)
//        groups:    새로 만든 그룹 이름
export async function buildConfig() {
  const [priv, edits, prefs] = await Promise.all([
    getSetting('privateItems'), getSetting('itemEdits'), getSetting('prefs'),
  ]);
  const cfg = structuredClone(state.baseConfig);

  if (priv && Array.isArray(priv.checks)) {
    const newGroups = (priv.groups || []).filter(g => !cfg.groups.includes(g));
    const at = cfg.groups.indexOf(priv.insertAfter);
    cfg.groups.splice(at === -1 ? cfg.groups.length : at + 1, 0, ...newGroups);
    const ids = new Set(cfg.checks.map(c => c.id));
    cfg.checks.push(...priv.checks.filter(c => !ids.has(c.id)).map(c => ({ hidden: false, ...c, private: true })));
  }

  if (edits) {
    for (const g of edits.groups || []) if (!cfg.groups.includes(g)) cfg.groups.push(g);
    cfg.checks = cfg.checks.map(c => ({ ...c, ...(edits.overrides?.[c.id] || {}) }));
    const ids = new Set(cfg.checks.map(c => c.id));
    cfg.checks.push(...(edits.added || []).filter(c => !ids.has(c.id)).map(c => ({ ...c, custom: true })));
    if (Array.isArray(edits.order) && edits.order.length) {
      // order에 있는 항목은 그 순서대로, 없는 항목(새로 생긴 것)은 원래 자리 순서대로 뒤에.
      const pos = new Map(edits.order.map((id, i) => [id, i]));
      const orig = new Map(cfg.checks.map((c, i) => [c.id, i]));
      const key = c => (pos.has(c.id) ? pos.get(c.id) : edits.order.length + orig.get(c.id));
      cfg.checks.sort((a, b) => key(a) - key(b));
    }
  }

  state.prefs = { ...DEFAULT_PREFS, weightDays: cfg.weightDays || DEFAULT_PREFS.weightDays, ...(prefs || {}) };
  cfg.weightDays = state.prefs.weightDays;

  // 운동 요일을 따라가는 항목·시간표 칸 (설정 탭에서 운동 요일을 바꾸면 같이 바뀜)
  //   on = 운동하는 요일, off = 운동 없는 요일, eve = 운동 전날(운동복 꺼내두기)
  const wdays = state.prefs.workoutDays;
  const follow = mode => mode === 'on' ? [...wdays]
    : mode === 'off' ? [0, 1, 2, 3, 4, 5, 6].filter(d => !wdays.includes(d))
    : wdays.map(d => (d + 6) % 7).sort();
  for (const c of cfg.checks) {
    if (c.followWorkoutDays && !edits?.overrides?.[c.id]?.days) c.days = follow(c.followWorkoutDays);
  }
  // 쉬는 요일: rest 칸은 쉬는 요일에만, 나머지 칸은 쉬는 요일에는 숨긴다
  const rest = state.prefs.restDays || [];
  for (const s of cfg.schedule || []) {
    if (s.followWorkoutDays) s.days = follow(s.followWorkoutDays);
    s.days = s.rest ? [...rest] : s.days.filter(d => !rest.includes(d));
  }
  state.config = cfg;
  return cfg;
}

// ---------- 계산 ----------

// 쉬는 날인가 (설정 탭의 쉬는 요일, 기본 토·일)
export function isRestDay(date) {
  return (state.prefs?.restDays || []).includes(weekday(date));
}

// 그 날짜(요일)에 보여줄 체크 항목들. 숨김 항목, 해당 요일이 아닌 항목은 빠진다.
// 쉬는 날에는 restKeep 항목(기상·복약·취침)과 비공개 항목(약물)만 남는다.
export function visibleChecks(date) {
  const wd = weekday(date);
  const rest = isRestDay(date);
  return state.config.checks.filter(c => !c.hidden && c.days.includes(wd) && (!rest || c.restKeep || c.private));
}

// 완료율 = 그날 표시된 항목 중 완료 수 ÷ 전체 수. 기록이 없으면 0.
export function completion(rec, date) {
  const items = visibleChecks(date);
  if (!rec || items.length === 0) return 0;
  const done = items.filter(c => rec.checks[c.id]).length;
  return done / items.length;
}

// 주 시작일(월요일). 명세서: 주는 월요일 시작.
export function weekStart(date) {
  const wd = weekday(date);           // 0=일 … 6=토
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

// from부터 to까지(둘 다 포함) 날짜 목록
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// 두 날짜 사이 일수 (to - from)
export function daysBetween(from, to) {
  const ms = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(to) - ms(from)) / 86400000);
}

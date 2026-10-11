// 4단계: 운동 카드, 증량 규칙, 걷기 증량.
//
// 목표 횟수는 따로 저장하지 않고, 저장된 하루 기록들을 날짜순으로 훑어서 그때그때 계산한다.
// (명세서: 통계는 기록에서 계산하고 따로 저장하지 않음 → 지난 기록을 고쳐도 목표가 저절로 맞춰짐)
//
// 증량 규칙: 같은 운동에서 2회 연속으로 모든 세트를 목표 횟수만큼 완료하면 목표 +step
//           (팔굽혀펴기 등 +2회, 플랭크 +5초). 한 번이라도 못 채우면 연속 횟수는 0부터 다시.
// 걷기: 시작일부터 14일마다 +5분, 최대 40분.
// 수동 조정: 설정 탭에서 바꾸면 settings 'workoutBase'에 {value, since}로 저장되고,
//           그날부터는 그 값을 출발점으로 다시 계산한다.
import { state, daysBetween } from './core.js';
import { getAllDays, getSetting, setSetting } from './db.js';

export async function getBase() {
  return (await getSetting('workoutBase')) || {};
}

// 한 운동의 date 시점 목표와 연속 완료 횟수
export function computeTarget(ex, date, days, base) {
  const b = base[ex.id] || { value: ex.start, since: '0000-00-00' };
  let target = b.value;
  let streak = 0;
  for (const rec of days) {
    if (rec.date < b.since || rec.date >= date) continue;
    const w = rec.workout?.[ex.id];
    if (!w || !Array.isArray(w.sets) || !w.sets.some(v => v != null)) continue; // 기록 없는 날은 건너뜀
    const done = w.sets.length >= ex.sets && w.sets.every(v => v != null && v >= target);
    if (done) {
      streak++;
      if (streak >= 2) { target += ex.step; streak = 0; }
    } else {
      streak = 0;
    }
  }
  return { target, streak };
}

// 걷기 목표(분). 시작일이 없으면 오늘을 시작일로 저장한다.
export async function walkTarget(date) {
  const w = state.config.workout?.walk;
  if (!w) return null;
  const base = await getBase();
  if (!base.walk) {
    base.walk = { value: w.start, since: state.today };
    await setSetting('workoutBase', base);
  }
  const { value, since } = base.walk;
  if (date < since) return value;
  return Math.min(w.max, value + w.step * Math.floor(daysBetween(since, date) / w.everyDays));
}

export function isWorkoutDay(date, wd) {
  return (state.prefs.workoutDays || []).includes(wd);
}

// 운동 카드 그리기. onSave(record)는 저장 + 화면 갱신을 맡는 함수.
export async function renderWorkoutCard(box, record, onSave) {
  const exercises = state.config.workout?.exercises || [];
  box.innerHTML = '';
  const days = (await getAllDays()).sort((a, b) => a.date.localeCompare(b.date));
  const base = await getBase();

  for (const ex of exercises) {
    const { target, streak } = computeTarget(ex, record.date, days, base);
    // 오늘 기록 틀 (세트 수만큼 빈칸)
    const w = record.workout[ex.id] || { sets: Array(ex.sets).fill(null) };
    while (w.sets.length < ex.sets) w.sets.push(null);

    const row = document.createElement('div');
    row.className = 'ex-row';

    const info = document.createElement('div');
    info.className = 'check-text ex-info';
    const name = document.createElement('span');
    name.textContent = ex.label;
    const sub = document.createElement('small');
    const allDone = w.sets.every(v => v != null && v >= target);
    // 오늘 다 채우면 연속 횟수가 하나 늘어난 상태로 보여 준다
    const nowStreak = allDone ? streak + 1 : streak;
    sub.textContent = nowStreak >= 2
      ? `목표 ${target}${ex.unit} × ${ex.sets}세트 · 2회 연속 완료 → 다음 목표 ${target + ex.step}${ex.unit}`
      : `목표 ${target}${ex.unit} × ${ex.sets}세트 · 연속 완료 ${nowStreak}/2`;
    info.append(name, sub);

    const sets = document.createElement('div');
    sets.className = 'ex-sets';
    w.sets.forEach((v, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set-btn' + (v != null ? ' filled' : '');
      btn.textContent = v != null ? `${v}` : `${i + 1}세트`;
      btn.setAttribute('aria-label', `${ex.label} ${i + 1}세트`);
      // 첫 탭: 목표만큼 완료로 기록. 기록된 세트를 다시 누르면 실제 횟수를 고치거나 지울 수 있다.
      btn.addEventListener('click', async () => {
        if (w.sets[i] == null) {
          w.sets[i] = target;
        } else {
          const ans = prompt(`${ex.label} ${i + 1}세트 실제 ${ex.unit === '초' ? '시간(초)' : '횟수'} (비우면 지움)`, w.sets[i]);
          if (ans === null) return;
          const n = parseInt(ans, 10);
          w.sets[i] = Number.isFinite(n) && n >= 0 ? n : null;
        }
        w.target = target;
        w.done = w.sets.every(s => s != null && s >= target);
        record.workout[ex.id] = w;
        // 모든 운동이 끝나면 '근력 운동' 체크도 자동으로 맞춘다
        const everyDone = exercises.every(e => record.workout[e.id]?.done);
        record.checks.strength = everyDone;
        await onSave(record);
      });
      sets.appendChild(btn);
    });

    row.append(info, sets);
    box.appendChild(row);
  }
}

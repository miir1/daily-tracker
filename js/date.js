// 날짜 계산 모음.
// 핵심 아이디어: 날짜는 항상 "YYYY-MM-DD" 문자열로 다룬다.
// 폰의 시간대 설정과 상관없이 "서울 기준 오늘"을 얻기 위해 Intl(국제화 API)에 시간대를 직접 지정한다.

const SEOUL = 'Asia/Seoul';

// 서울 기준 오늘 날짜 문자열. 예: "2026-10-12"
// 'en-CA' 형식은 마침 YYYY-MM-DD 순서로 찍어주기 때문에 그대로 쓴다.
export function todaySeoul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// "YYYY-MM-DD" → UTC 자정의 Date 객체.
// 날짜 더하기/요일 계산은 UTC로만 하면 서머타임·시간대 영향 없이 정확하다.
function toUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt) {
  return dt.toISOString().slice(0, 10);
}

// 날짜에 n일 더하기 (n이 음수면 빼기). 예: addDays("2026-10-31", 1) → "2026-11-01"
export function addDays(dateStr, n) {
  const dt = toUTC(dateStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

// 요일 번호. 0=일, 1=월 … 6=토
export function weekday(dateStr) {
  return toUTC(dateStr).getUTCDay();
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 화면 표시용. 예: "10월 12일 (월)"
export function formatKo(dateStr) {
  const dt = toUTC(dateStr);
  return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${WEEKDAY_KO[dt.getUTCDay()]})`;
}

// updatedAt용 서울 시간 타임스탬프. 예: "2026-10-12T21:35:00+09:00"
// 서울은 서머타임이 없어서 항상 +09:00 이다.
export function nowSeoulISO() {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19) + '+09:00';
}

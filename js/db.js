// IndexedDB 저장 담당.
// IndexedDB는 브라우저 안에 있는 작은 데이터베이스다. 서버로 아무것도 보내지 않는다.
// 명세서의 저장소 4개(days, weeks, ideas, settings)를 처음부터 만들어 두고,
// 1단계에서는 days만 쓴다.

const DB_NAME = 'daily-tracker';
const DB_VERSION = 1;

let dbPromise = null;

// DB 열기. 처음 열 때(또는 버전이 오를 때) onupgradeneeded에서 저장소를 만든다.
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // keyPath: 문서 안의 어떤 필드를 "열쇠"로 쓸지. days는 date 필드가 열쇠.
      if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('weeks')) db.createObjectStore('weeks', { keyPath: 'weekStart' });
      if (!db.objectStoreNames.contains('ideas')) db.createObjectStore('ideas', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// IndexedDB의 콜백식 요청을 await로 쓸 수 있게 감싸는 도우미.
function run(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

// 하루 기록 1개 읽기. 없으면 undefined.
export function getDay(date) {
  return run('days', 'readonly', s => s.get(date));
}

// 하루 기록 저장(같은 날짜가 있으면 덮어씀).
export function putDay(record) {
  return run('days', 'readwrite', s => s.put(record));
}

// 모든 하루 기록 (연속 달성일 계산, 이후 단계의 백업·통계에서 사용).
export function getAllDays() {
  return run('days', 'readonly', s => s.getAll());
}

// ---- 백업용: 저장소 이름을 받아 통째로 읽기/쓰기 ----

export const STORES = ['days', 'weeks', 'ideas', 'settings'];

export function getAllFrom(storeName) {
  return run(storeName, 'readonly', s => s.getAll());
}

export function putInto(storeName, record) {
  return run(storeName, 'readwrite', s => s.put(record));
}

// 설정값 1개 읽기/쓰기. settings 저장소는 { key, value } 형태로 저장한다.
export async function getSetting(key) {
  const row = await run('settings', 'readonly', s => s.get(key));
  return row ? row.value : undefined;
}

export function setSetting(key, value) {
  return run('settings', 'readwrite', s => s.put({ key, value }));
}

// 브라우저가 공간이 부족할 때 데이터를 지우지 않도록 "영구 저장"을 요청한다.
// 지원하지 않는 브라우저면 조용히 넘어간다.
export async function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}

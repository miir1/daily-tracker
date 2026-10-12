// 서비스 워커: 앱 파일을 폰에 보관해 두었다가, 인터넷이 없을 때(비행기 모드 등) 대신 내준다.
// 기록 데이터는 여기서 다루지 않는다 (기록은 IndexedDB에 따로 있음).
//
// 방식: "네트워크 먼저, 안 되면 보관본"
// - 인터넷이 되면 항상 최신 파일을 받아오고, 받은 걸 보관본으로 갱신한다 → 코드 수정이 바로 반영됨
// - 인터넷이 안 되면 보관본을 쓴다 → 오프라인에서도 체크 가능

const CACHE = 'daily-tracker-v7';
const FILES = [
  './', 'index.html', 'style.css', 'items.json', 'manifest.json',
  'js/app.js', 'js/date.js', 'js/db.js', 'js/backup.js',
  'js/core.js', 'js/workout.js', 'js/weekly.js', 'js/stats.js', 'js/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

// 처음 설치될 때 앱 파일 전부를 미리 보관
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

// 버전(CACHE 이름)이 바뀌면 옛 보관본 삭제
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    // cache: 'no-cache' → 브라우저의 임시 보관본을 그냥 쓰지 말고 서버에 "바뀌었나?"를 꼭 확인.
    // 이게 없으면 새 버전 배포 직후 옛 파일과 새 파일이 섞여 앱이 깨질 수 있다.
    fetch(url.href, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

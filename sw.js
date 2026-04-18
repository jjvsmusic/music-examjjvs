// ══════════════════════════════════════════════
// sw.js — 音樂術科評量系統 Service Worker
// 功能：離線快取 + 恢復網路時自動觸發 Firestore 同步
// 使用方式：放在 repository 根目錄（與 index.html 同層）
// ══════════════════════════════════════════════

const CACHE_NAME = 'music-exam-v2';

// 需要預先快取的資源
// ★ 如果你的 GitHub Pages 網址有子路徑（例如 /music-exam/），
//   請把 '/' 改成 '/music-exam/'，'index.html' 改成 '/music-exam/index.html'
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  // Firebase SDK（確保離線時也能載入）
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  // Google Fonts（離線時若無快取會用系統字型，不影響功能）
  'https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@300;400;500;600;700&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap',
];

// ──────────────────────────────────────────────
// 安裝（install）：預先快取所有必要資源
// ──────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] 安裝中，版本：', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // 逐一快取，單一失敗不影響其他資源
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] 快取失敗（不影響功能）：', url, err.message)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] 安裝完成 ✓');
        // 安裝後立刻接管頁面，不需要使用者重新整理
        return self.skipWaiting();
      })
  );
});

// ──────────────────────────────────────────────
// 啟動（activate）：清除舊版快取
// ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] 啟動，清理舊快取...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] 刪除舊快取：', key);
            return caches.delete(key);
          })
      ))
      .then(() => {
        console.log('[SW] 已接管所有頁面 ✓');
        return self.clients.claim();
      })
  );
});

// ──────────────────────────────────────────────
// 攔截網路請求（fetch）
// 策略：Cache First（有快取就用快取，確保離線可用）
//        Firestore API 請求不攔截（讓 SDK 自己處理）
// ──────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firestore / Firebase Auth API 請求不攔截，讓 SDK 自行處理離線佇列
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('firebase.googleapis.com')
  ) {
    return; // 讓瀏覽器直接處理
  }

  // 其他資源：快取優先
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // 快取沒有就去網路拿，並存入快取
        return fetch(event.request)
          .then(networkResponse => {
            // 只快取成功的 GET 請求
            if (
              networkResponse.ok &&
              event.request.method === 'GET' &&
              !url.startsWith('chrome-extension')
            ) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseToCache));
            }
            return networkResponse;
          })
          .catch(() => {
            // 網路也沒有（完全離線）
            // 若請求的是頁面，回傳快取的 index.html
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            // 其他資源離線時回傳空 Response，避免報錯
            return new Response('', { status: 503, statusText: 'Offline' });
          });
      })
  );
});

// ──────────────────────────────────────────────
// 監聽主頁面訊息
// ──────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ──────────────────────────────────────────────
// 背景同步（Background Sync）
// 當瀏覽器恢復網路連線時，通知主頁面執行 Firestore 同步
// 注意：Background Sync API 目前僅 Chrome/Edge 支援
// ──────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'firebase-sync') {
    console.log('[SW] Background Sync 觸發：firebase-sync');
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
        .then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'SW_SYNC_REQUEST' });
          });
        })
    );
  }
});

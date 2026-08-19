// web/sw.js —— 纯推送 PWA Service Worker
// 不做任何 fetch 缓存/拦截（预警控器必须联网连电脑，离线不重要；避免缓存 API 或页面导致白屏）。
// 仅提供：① Web Push 通知 ② 满足 PWA 可安装性（有 sw 即可安装）。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  // 清掉此前可能残留的缓存（v1/v2 壳缓存），避免旧缓存导致白屏
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  self.clients.claim();
});

// ---- Web Push 通知 ----
self.addEventListener('push', function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* 非 JSON 忽略 */ }
  const title = data.title || 'DeepSeek Harness';
  const body = data.body || '';
  const kind = data.kind || '';
  const tag = 'ph-' + (data.sessionId || kind || Date.now());
  const options = {
    body: body.slice(0, 200),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: tag,
    renotify: true,
    data: { url: data.url || '/', sessionId: data.sessionId || '' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (const c of list) { if ('focus' in c) { c.focus(); c.navigate(target).catch(() => {}); return; } }
    return clients.openWindow(target);
  }));
});

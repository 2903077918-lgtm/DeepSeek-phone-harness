// web/sw.js —— PWA 通知 + 离线壳缓存
const CACHE = 'dsh-phone-v1';
const SHELL = ['/', '/relay.html', '/manifest.webmanifest', '/whale-logo.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// 离线兜底：请求失败时回退到缓存的 App 壳
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate' || url.pathname === '/') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/relay.html')));
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
    return r;
  }).catch(() => caches.match('/relay.html'))));
});

// ---- Web Push 通知（原有） ----
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

// web/sw.js —— Web Push 通知 Service Worker
self.addEventListener('push', function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* 非 JSON 忽略 */ }
  const title = data.title || 'DeepSeek Harness';
  const body = data.body || '';
  const kind = data.kind || '';
  const tag = 'ph-' + (data.sessionId || kind || Date.now());
  const options = {
    body: body.slice(0, 200),
    icon: null,
    badge: null,
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

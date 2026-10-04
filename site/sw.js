self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  const url = typeof payload.url === 'string' && payload.url.startsWith('/') && !payload.url.startsWith('//') ? payload.url : '/';
  event.waitUntil(self.registration.showNotification(payload.title || '卡牌行情', {
    body: payload.body || '關注價格有更新', icon: '/icon.png', badge: '/icon.png',
    tag: payload.tag || undefined, data: { url }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    for (const window of windows) {
      if (window.url.startsWith(self.location.origin)) {
        await window.focus();
        if ('navigate' in window) await window.navigate(target);
        return;
      }
    }
    return clients.openWindow(target);
  }));
});

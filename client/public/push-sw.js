// Imported into the generated service worker (see vite.config.js): shows card reminders
// and opens the card when the notification is tapped.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Напоминание', {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/icon.svg',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  const cardId = url.searchParams.get('card');

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if (cardId) open.postMessage({ type: 'open-card', id: cardId });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});

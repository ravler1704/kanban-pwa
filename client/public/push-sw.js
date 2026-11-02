// Imported into the generated service worker (see vite.config.js): shows card reminders, comments
// and chat messages, and opens the card or the chat when the notification is tapped.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '', {
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
  // A folder's chat ('folder:<id>') or direct messages ('dm:<user id>').
  const chat = url.searchParams.get('chat');
  // The board the card or chat is on (the owner's id); the app switches to it if needed.
  const board = url.searchParams.get('board');

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if (cardId) open.postMessage({ type: 'open-card', id: cardId, board });
      else if (chat) open.postMessage({ type: 'open-chat', chat, board });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});

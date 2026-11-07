// Server-Sent Events: tells the devices showing a board there is something new to pull.
// Each stream is kept with the board it shows and the user who opened it.
const clients = new Map();

export function broadcast(board, payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [client, { board: clientBoard }] of clients) {
    if (clientBoard === board) client.write(message);
  }
}

/** To every open app of the user, whatever board it shows. */
export function notifyUser(userId, payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [client, { user }] of clients) {
    if (user === userId) client.write(message);
  }
}

/**
 * Closes the board's streams (except the ones of user `except`); browsers reconnect and
 * the server checks their access again.
 */
export function disconnect(board, { except } = {}) {
  for (const [client, { board: clientBoard, user }] of clients) {
    if (clientBoard === board && user !== except) client.end();
  }
}

/** Closes every stream of the user; browsers reconnect and pick up the session's new owner. */
export function disconnectUser(userId) {
  for (const [client, { user }] of clients) {
    if (user === userId) client.end();
  }
}

/** Users with the app open right now. */
export function onlineUsers() {
  return new Set([...clients.values()].map((c) => c.user).filter(Boolean));
}

/** Routes expect `req.owner` and `req.user` (set by requireAuth). */
export function registerEvents(app) {
  app.get('/api/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    clients.set(res, { board: req.owner, user: req.user });
    req.on('close', () => clients.delete(res));
  });

  setInterval(() => {
    for (const client of clients.keys()) client.write(': ping\n\n');
  }, 25_000).unref();
}

// Server-Sent Events: tells the owner's other devices there is something new to pull.
const clients = new Map();

export function broadcast(owner, payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [client, clientOwner] of clients) {
    if (clientOwner === owner) client.write(message);
  }
}

/** Closes the owner's streams; browsers reconnect and pick up the session's new owner. */
export function disconnect(owner) {
  for (const [client, clientOwner] of clients) {
    if (clientOwner === owner) client.end();
  }
}

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
    clients.set(res, req.owner);
    req.on('close', () => clients.delete(res));
  });

  setInterval(() => {
    for (const client of clients.keys()) client.write(': ping\n\n');
  }, 25_000).unref();
}

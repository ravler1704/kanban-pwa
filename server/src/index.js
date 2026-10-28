import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { authEnabled, registerAuthRoutes, requireAuth } from './auth.js';
import { EPOCH } from './db.js';
import { push, pull, ValidationError } from './sync.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || undefined;
const CLIENT_DIST = path.join(import.meta.dirname, '..', '..', 'client', 'dist');

const app = express();
// Caddy terminates HTTPS in front of the app; trust its X-Forwarded-Proto so cookies get `Secure`.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

registerAuthRoutes(app);
app.use(['/api/sync', '/api/events'], requireAuth);

// The epoch identifies the board, not just the database: a device that holds another
// user's board (e.g. signed in with a different account) discards it and resyncs.
const boardEpoch = (owner) => (owner ? `${EPOCH}:${owner}` : EPOCH);

app.get('/api/sync', (req, res) => {
  const since = Number.parseInt(req.query.since ?? '0', 10);
  res.json({ epoch: boardEpoch(req.owner), ...pull(req.owner, Number.isFinite(since) ? since : 0) });
});

app.post('/api/sync', (req, res) => {
  const { deviceId, changes, epoch } = req.body ?? {};
  if (typeof deviceId !== 'string' || deviceId.length > 64) {
    return res.status(400).json({ error: 'invalid deviceId' });
  }
  const expected = boardEpoch(req.owner);
  if (epoch != null && epoch !== expected) {
    return res.status(409).json({ error: 'epoch mismatch', epoch: expected });
  }
  try {
    const result = push(req.owner, deviceId, changes);
    if (result.modified) broadcast(req.owner, { seq: result.seq, from: deviceId });
    res.json({ epoch: expected, results: result.results, seq: result.seq });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// Server-Sent Events: tells the owner's other devices there is something new to pull.
const clients = new Map();

function broadcast(owner, payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [client, clientOwner] of clients) {
    if (clientOwner === owner) client.write(message);
  }
}

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

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, {
    setHeaders(res, filePath) {
      if (['sw.js', 'index.html', 'version.json'].some((name) => filePath.endsWith(name))) {
        res.set('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Kanban server listening on http://${HOST ?? 'localhost'}:${PORT}`);
  console.log(authEnabled ? 'Google sign-in is required' : 'Auth is disabled (GOOGLE_CLIENT_ID is not set)');
});

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { authEnabled, registerAuthRoutes, requireAuth, requireAuthOrPublic } from './auth.js';
import { EPOCH } from './db.js';
import { broadcast, registerEvents } from './events.js';
import { registerPushRoutes, startReminders } from './push.js';
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
app.use(['/api/sync', '/api/events'], requireAuthOrPublic);
app.use('/api/push', requireAuth);
registerPushRoutes(app);
startReminders();

// The epoch identifies the board, not just the database: a device that holds another
// user's board (e.g. signed in with a different account) discards it and resyncs.
// A member's epoch also changes with their access (projects opened or closed to them).
const boardEpoch = (req) => {
  const board = req.owner ? `${EPOCH}:${req.owner}` : EPOCH;
  return req.access ? `${board}:${req.access.key}` : board;
};

app.get('/api/sync', (req, res) => {
  const since = Number.parseInt(req.query.since ?? '0', 10);
  res.json({ epoch: boardEpoch(req), ...pull(req.owner, Number.isFinite(since) ? since : 0, 500, req.access) });
});

app.post('/api/sync', (req, res) => {
  const { deviceId, changes, epoch } = req.body ?? {};
  if (typeof deviceId !== 'string' || deviceId.length > 64) {
    return res.status(400).json({ error: 'invalid deviceId' });
  }
  const expected = boardEpoch(req);
  if (epoch != null && epoch !== expected) {
    return res.status(409).json({ error: 'epoch mismatch', epoch: expected });
  }
  try {
    const result = push(req.owner, deviceId, changes, req.access);
    if (result.modified) broadcast(req.owner, { seq: result.seq, from: deviceId });
    res.json({ epoch: expected, results: result.results, seq: result.seq });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

registerEvents(app);

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, {
    setHeaders(res, filePath) {
      if (['sw.js', 'index.html', 'version.json'].some((name) => filePath.endsWith(name))) {
        // Also covers push-sw.js, which the service worker imports.
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
  console.log(authEnabled ? 'Sign-in is required' : 'Auth is disabled (no GOOGLE_CLIENT_ID / YANDEX_CLIENT_ID)');
});

import webpush from 'web-push';
import {
  deletePushSubscription, getDueReminders, getMeta, getPushSubscriptions, getRecord, markReminderSent,
  pruneRemindersSent, savePushSubscription, setMeta,
} from './db.js';

// Card reminders delivered with Web Push. The VAPID key pair identifies this server to the
// browsers' push services; it is generated once and kept in the database, because
// replacing it invalidates every existing subscription.
const CHECK_INTERVAL_MS = 15_000;
// A reminder whose time passed more than this long ago (server was down) is not sent.
const MAX_LATE_MS = 6 * 60 * 60 * 1000;

let publicKey = getMeta('vapidPublicKey');
let privateKey = getMeta('vapidPrivateKey');
if (!publicKey || !privateKey) {
  ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
  setMeta('vapidPublicKey', publicKey);
  setMeta('vapidPrivateKey', privateKey);
}
// Apple rejects subjects that are not a real URL or e-mail domain (e.g. localhost).
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:kanban@example.com', publicKey, privateKey);

const isBase64Url = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w-]+=*$/.test(v);

function parseSubscription(body) {
  const { endpoint, keys } = body?.subscription ?? {};
  if (typeof endpoint !== 'string' || endpoint.length > 1024 || !endpoint.startsWith('https://')) return null;
  if (!isBase64Url(keys?.p256dh, 200) || !isBase64Url(keys?.auth, 100)) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** Routes expect `req.owner` (set by requireAuth). */
export function registerPushRoutes(app) {
  app.get('/api/push/key', (_req, res) => {
    res.json({ publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const subscription = parseSubscription(req.body);
    if (!subscription) return res.status(400).json({ error: 'invalid subscription' });
    savePushSubscription(req.owner, subscription);
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string') return res.status(400).json({ error: 'invalid endpoint' });
    deletePushSubscription(endpoint, req.owner);
    res.json({ ok: true });
  });
}

async function send(owner, payload) {
  await Promise.all(getPushSubscriptions(owner).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 24 * 60 * 60, urgency: 'high' },
      );
    } catch (err) {
      // 404/410: the browser dropped the subscription (app removed, permission revoked).
      if (err.statusCode === 404 || err.statusCode === 410) deletePushSubscription(s.endpoint);
      else console.error('Push failed:', err.statusCode ?? '', err.body || err.message);
    }
  }));
}

function reminderPayload(owner, { id, card }) {
  const project = getRecord(owner, card.projectId);
  const details = [project && !project.deleted ? project.name : null, card.description.split('\n')[0]]
    .filter(Boolean).join(' · ');
  return {
    title: card.title || 'Напоминание',
    body: details || 'Напоминание по карточке',
    tag: `card-${id}`,
    url: `/?card=${encodeURIComponent(id)}`,
  };
}

let checking = false;

async function checkReminders() {
  if (checking) return;
  checking = true;
  try {
    const now = Date.now();
    for (const reminder of getDueReminders(now, MAX_LATE_MS)) {
      if (!markReminderSent(reminder.owner, reminder.id, reminder.remindAt)) continue;
      await send(reminder.owner, reminderPayload(reminder.owner, reminder));
    }
    pruneRemindersSent(now - 30 * 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('Reminder check failed:', err);
  } finally {
    checking = false;
  }
}

export function startReminders() {
  checkReminders();
  setInterval(checkReminders, CHECK_INTERVAL_MS).unref();
}

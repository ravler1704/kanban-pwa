import webpush from 'web-push';
import {
  deletePushSubscription, folderUsers, getCardsWithReminders, getMeta, getPushSubscriptions, getRecord, isReminderSent,
  markReminderSent,
  pruneRemindersSent, savePushSubscription, setMeta,
} from './db.js';
import { folderAncestors, isInbox } from './folders.js';
import { cardReminders, nextTime } from './reminders.js';
import { onSettingsChange, settings } from './settings.js';

// Card reminders delivered with Web Push. The VAPID key pair identifies this server to the
// browsers' push services; it is generated once and kept in the database, because
// replacing it invalidates every existing subscription.
const CHECK_INTERVAL_MS = 15_000;
// A reminder whose time passed more than this long ago (server was down) is not sent.
const MAX_LATE_MS = 6 * 60 * 60 * 1000;

/** Markdown links [text](address) shown as their text: notifications have no links. */
export const withoutLinks = (text) => (text ?? '').replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1');

let publicKey = getMeta('vapidPublicKey');
let privateKey = getMeta('vapidPrivateKey');
if (!publicKey || !privateKey) {
  ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
  setMeta('vapidPublicKey', publicKey);
  setMeta('vapidPrivateKey', privateKey);
}
// Apple rejects subjects that are not a real URL or e-mail domain (e.g. localhost).
const applyVapid = () => webpush.setVapidDetails(settings().vapidSubject || 'mailto:kanban@example.com', publicKey, privateKey);
applyVapid();
onSettingsChange(applyVapid);

const isBase64Url = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w-]+=*$/.test(v);

function parseSubscription(body) {
  const { endpoint, keys } = body?.subscription ?? {};
  if (typeof endpoint !== 'string' || endpoint.length > 1024 || !endpoint.startsWith('https://')) return null;
  if (!isBase64Url(keys?.p256dh, 200) || !isBase64Url(keys?.auth, 100)) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** Routes expect `req.user` (set by requireAuth): a device subscribes for its user, not a board. */
export function registerPushRoutes(app) {
  app.get('/api/push/key', (_req, res) => {
    res.json({ publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const subscription = parseSubscription(req.body);
    if (!subscription) return res.status(400).json({ error: 'invalid subscription' });
    savePushSubscription(req.user, subscription);
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string') return res.status(400).json({ error: 'invalid endpoint' });
    deletePushSubscription(endpoint, req.user);
    res.json({ ok: true });
  });
}

/** Sends to every device of everyone who sees the folder. */
function send(board, folder, payload) {
  return sendToUsers(folderUsers(board, folder), payload);
}

/** Sends to every device of the users. */
export async function sendToUsers(users, payload) {
  const subscriptions = users.flatMap((user) => getPushSubscriptions(user));
  await Promise.all(subscriptions.map(async (s) => {
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

/** Title is the folder path, body is the card title. */
function reminderPayload(owner, { id, card }) {
  const name = (recordId) => {
    const record = recordId ? getRecord(owner, recordId) : null;
    return record && !record.deleted ? record.name : null;
  };
  const path = isInbox(card.folderId) ? 'Входящие' : [...folderAncestors(owner, card.folderId).reverse(), card.folderId]
    .map(name).filter(Boolean).join(' / ');
  const title = withoutLinks(card.title);
  return {
    title: path || title,
    body: path ? title : '',
    tag: `card-${id}`,
    url: `/?${new URLSearchParams({ ...(owner && { board: owner }), card: id })}`,
  };
}

let checking = false;

async function checkReminders() {
  if (checking) return;
  checking = true;
  try {
    const now = Date.now();
    for (const entry of getCardsWithReminders(now - MAX_LATE_MS)) {
      // The latest time of each reminder within the last MAX_LATE_MS that is not sent yet.
      const due = new Set();
      for (const r of cardReminders(entry.card)) {
        let latest = null;
        for (let t = nextTime(r, now - MAX_LATE_MS); t !== null && t <= now; t = nextTime(r, t + 1)) latest = t;
        if (latest !== null && !isReminderSent(entry.owner, entry.id, latest)) due.add(latest);
      }
      for (const time of due) {
        if (!markReminderSent(entry.owner, entry.id, time)) continue;
        await send(entry.owner, entry.card.folderId, reminderPayload(entry.owner, entry));
      }
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

import { adminIds, isAdmin } from './auth.js';
import {
  addSupportMessage, changeSupportMessage, getSupportMessage, markSupportThreadRead, setSupportStatus, supportSummary,
  supportThread, supportTicket, supportTickets, userProfile,
} from './db.js';
import { messageBody, preview, validEdit } from './chat.js';
import { notifyUser } from './events.js';
import { sendToUsers } from './push.js';

// Support: a user writes to the administrators from the chats; any administrator answers. Each user has one
// conversation (`:user` is 'me' for the user's own, or a user's id for an administrator), open or solved.

const STATUSES = new Set(['open', 'solved']);
const validId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** Whose conversation the request is about, and whether the requester answers as the support; null: not allowed. */
function conversation(req) {
  const asked = req.params.user;
  if (asked === 'me' || asked === req.user) return { userId: req.user, bySupport: false };
  return validId(asked) && isAdmin(req.user) ? { userId: asked, bySupport: true } : null;
}

/** Tells the user and every administrator that the conversation changed. */
function changed(userId) {
  notifyUser(userId, { support: 'me' });
  for (const id of adminIds()) if (id !== userId) notifyUser(id, { support: userId });
}

const author = (id) => {
  const p = userProfile(id);
  return { id, name: p.name, picture: p.picture };
};

/** Routes expect `req.user` (set by requireAuth). */
export function registerSupportRoutes(app) {
  app.get('/api/support', (req, res) => {
    const admin = isAdmin(req.user);
    res.json({
      admin,
      me: supportSummary(req.user),
      tickets: admin
        ? supportTickets().filter((t) => t.userId !== req.user).map((t) => ({ ...t, user: userProfile(t.userId) }))
        : null,
    });
  });

  app.get('/api/support/:user', (req, res) => {
    const c = conversation(req);
    if (!c) return res.status(403).json({ error: 'not admin' });
    const before = Number.parseInt(req.query.before ?? '', 10);
    const limit = 100;
    const messages = supportThread(c.userId, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, limit + 1);
    const hasMore = messages.length > limit;
    if (hasMore) messages.shift();
    const authors = {};
    for (const m of messages) authors[m.author] ??= author(m.author);
    res.json({
      user: userProfile(c.userId), status: supportTicket(c.userId)?.status ?? null, messages, hasMore, authors,
    });
  });

  app.post('/api/support/:user', (req, res) => {
    const c = conversation(req);
    if (!c) return res.status(403).json({ error: 'not admin' });
    const { id } = req.body ?? {};
    const body = messageBody(req.body ?? {});
    if (!validId(id) || !body) return res.status(400).json({ error: 'invalid message' });
    const { text, images, reply } = body;
    const existing = getSupportMessage(id);
    if (existing) {
      if (existing.author !== req.user) return res.status(409).json({ error: 'id taken' });
      return res.json({ message: existing });
    }
    const message = addSupportMessage({
      id, userId: c.userId, author: req.user, fromSupport: c.bySupport, text, images, reply, createdAt: Date.now(),
    });
    changed(c.userId);
    if (c.bySupport) {
      sendToUsers([c.userId], {
        title: 'Техподдержка', body: preview(text, images), tag: 'support', url: `/?${new URLSearchParams({ chat: 'support:me' })}`,
      }).catch((err) => console.error('Push failed:', err));
    } else {
      const from = userProfile(c.userId);
      sendToUsers(adminIds().filter((a) => a !== req.user), {
        title: `Поддержка: ${from.name || from.email || 'пользователь'}`,
        body: preview(text, images),
        tag: `support-${c.userId}`,
        url: `/?${new URLSearchParams({ chat: `support:${c.userId}` })}`,
      }).catch((err) => console.error('Push failed:', err));
    }
    res.json({ message });
  });

  const ownMessage = (req, res) => {
    const c = conversation(req);
    const message = c && getSupportMessage(req.params.id);
    if (!message || message.author !== req.user || message.userId !== c.userId) {
      res.status(404).json({ error: 'no message' });
      return null;
    }
    return message;
  };

  app.post('/api/support/:user/:id/edit', (req, res) => {
    const { text } = req.body ?? {};
    const message = ownMessage(req, res);
    if (!message) return;
    if (!validEdit(text, message)) return res.status(400).json({ error: 'invalid text' });
    if (message.deleted) return res.status(409).json({ error: 'deleted' });
    const next = changeSupportMessage(message.id, { text });
    changed(message.userId);
    res.json({ message: next });
  });

  app.post('/api/support/:user/:id/delete', (req, res) => {
    const message = ownMessage(req, res);
    if (!message) return;
    const next = changeSupportMessage(message.id, { deleted: true });
    changed(message.userId);
    res.json({ message: next });
  });

  app.post('/api/support/:user/read', (req, res) => {
    const c = conversation(req);
    if (!c) return res.status(403).json({ error: 'not admin' });
    const at = Number(req.body?.at);
    if (!Number.isInteger(at) || at <= 0) return res.status(400).json({ error: 'invalid time' });
    markSupportThreadRead(c.userId, Math.min(at, Date.now()), c.bySupport);
    if (c.bySupport) changed(c.userId);
    else notifyUser(req.user, { support: 'me' });
    res.json({ ok: true });
  });

  // Administrators mark a conversation solved or open; the user's next message opens it again.
  app.post('/api/support/:user/status', (req, res) => {
    const c = conversation(req);
    if (!c?.bySupport) return res.status(403).json({ error: 'not admin' });
    const { status } = req.body ?? {};
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
    if (!setSupportStatus(c.userId, status)) return res.status(404).json({ error: 'no ticket' });
    changed(c.userId);
    res.json({ status });
  });
}

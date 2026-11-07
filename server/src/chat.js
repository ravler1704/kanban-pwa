import {
  addDm, boardOwner, changeDm, clearDm, contactIds, dmConversations, dmThread, folderInvitees, folderUsers, getDm, getRecord,
  liveFolderIds, markDmRead, userProfile,
} from './db.js';
import { notifyUser } from './events.js';
import { validImages } from './imageList.js';
import { sendToUsers, withoutLinks } from './push.js';

// People of a board, direct messages between them, and notifications about comments.

const MAX_TEXT = 4000;
const validId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const validText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;
/** Text and images of a new message: either may be empty, not both; null if invalid. */
export function messageBody({ text, images }) {
  const list = images ?? [];
  if (!validImages(list) || typeof (text ?? '') !== 'string' || (text ?? '').length > MAX_TEXT) return null;
  return validText(text) || list.length > 0 ? { text: text ?? '', images: list } : null;
}
/** A message's text may be emptied when it has images. */
export const validEdit = (text, message) => validText(text)
  || (typeof text === 'string' && text.trim() === '' && message.images.length > 0);
export const preview = (text, images = []) => {
  const plain = withoutLinks(text).trim() || (images.length ? (images.length > 1 ? `Фото: ${images.length}` : 'Фото') : '');
  return plain.length > 200 ? `${plain.slice(0, 199)}…` : plain;
};

/** Who sees the folders of the board: [{ id, name, email, picture, owner, folders }]. */
function boardPeople(owner, access) {
  const folders = access ? [...access.folders] : liveFolderIds(owner);
  const ownerId = boardOwner(owner);
  const people = new Map();
  const add = (id) => {
    if (!people.has(id)) people.set(id, { ...userProfile(id), owner: id === ownerId, folders: [] });
    return people.get(id);
  };
  if (ownerId != null) add(ownerId);
  for (const folder of folders) {
    for (const id of folderUsers(owner, folder)) add(id).folders.push(folder);
  }
  // Direct folder invites (for chat headers), even when the invitee is already listed.
  if (!access) {
    for (const { user, folder } of folderInvitees(owner)) {
      if (!add(user).folders.includes(folder)) add(user).folders.push(folder);
    }
  }
  return [...people.values()];
}

/** Routes expect `req.user` (set by requireAuth); /api/people also `req.owner` and `req.access`. */
export function registerChatRoutes(app) {
  app.get('/api/people', (req, res) => {
    res.json({ me: req.user, owner: req.owner, people: boardPeople(req.owner, req.access) });
  });

  // Conversations: everyone the user shares a project with, and whoever the user wrote with before.
  app.get('/api/dm', (req, res) => {
    const contacts = new Set(contactIds(req.user));
    const conversations = dmConversations(req.user);
    const ids = new Set([...contacts, ...Object.keys(conversations)]);
    ids.delete(req.user);
    res.json({
      contacts: [...ids].map((id) => ({
        ...userProfile(id),
        canWrite: contacts.has(id),
        last: conversations[id]?.last ?? null,
        unread: conversations[id]?.unread ?? 0,
      })),
    });
  });

  app.get('/api/dm/:peer', (req, res) => {
    const before = Number.parseInt(req.query.before ?? '', 10);
    const limit = 100;
    const messages = dmThread(req.user, req.params.peer, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, limit + 1);
    const hasMore = messages.length > limit;
    if (hasMore) messages.shift();
    res.json({
      peer: userProfile(req.params.peer),
      canWrite: contactIds(req.user).includes(req.params.peer),
      messages,
      hasMore,
    });
  });

  app.post('/api/dm/:peer', (req, res) => {
    const { peer } = req.params;
    const { id } = req.body ?? {};
    const body = messageBody(req.body ?? {});
    if (!validId(id) || !body) return res.status(400).json({ error: 'invalid message' });
    const { text, images } = body;
    const existing = getDm(id);
    if (existing) {
      if (existing.sender !== req.user) return res.status(409).json({ error: 'id taken' });
      return res.json({ message: existing });
    }
    if (!contactIds(req.user).includes(peer)) return res.status(403).json({ error: 'no shared project' });
    const message = addDm({ id, sender: req.user, recipient: peer, text, images, createdAt: Date.now() });
    markDmRead(req.user, peer, message.createdAt);
    notifyUser(peer, { dm: req.user });
    notifyUser(req.user, { dm: peer });
    const sender = userProfile(req.user);
    sendToUsers([peer], {
      title: sender.name || sender.email || 'Сообщение',
      body: preview(text, images),
      tag: `dm-${req.user}`,
      url: `/?${new URLSearchParams({ chat: `dm:${req.user}` })}`,
    }).catch((err) => console.error('Push failed:', err));
    res.json({ message });
  });

  const ownMessage = (req, res) => {
    const message = getDm(req.params.id);
    if (!message || message.sender !== req.user || message.recipient !== req.params.peer) {
      res.status(404).json({ error: 'no message' });
      return null;
    }
    return message;
  };
  const changed = (req, message) => {
    notifyUser(message.recipient, { dm: req.user });
    notifyUser(req.user, { dm: message.recipient });
  };

  app.post('/api/dm/:peer/:id/edit', (req, res) => {
    const { text } = req.body ?? {};
    const message = ownMessage(req, res);
    if (!message) return;
    if (!validEdit(text, message)) return res.status(400).json({ error: 'invalid text' });
    if (message.deleted) return res.status(409).json({ error: 'deleted' });
    const next = changeDm(message.id, { text });
    changed(req, next);
    res.json({ message: next });
  });

  app.post('/api/dm/:peer/:id/delete', (req, res) => {
    const message = ownMessage(req, res);
    if (!message) return;
    const next = changeDm(message.id, { deleted: true });
    changed(req, next);
    res.json({ message: next });
  });

  // The whole conversation: for the user only, or `forBoth`.
  app.post('/api/dm/:peer/clear', (req, res) => {
    const { peer } = req.params;
    if (!validId(peer) || peer === req.user) return res.status(400).json({ error: 'invalid peer' });
    const forBoth = req.body?.forBoth === true;
    clearDm(req.user, peer, forBoth);
    notifyUser(req.user, { dm: peer });
    if (forBoth) notifyUser(peer, { dm: req.user });
    res.json({ ok: true });
  });

  app.post('/api/dm/:peer/read', (req, res) => {
    const at = Number(req.body?.at);
    if (!Number.isInteger(at) || at <= 0) return res.status(400).json({ error: 'invalid time' });
    markDmRead(req.user, req.params.peer, Math.min(at, Date.now()));
    notifyUser(req.user, { dm: req.params.peer });
    res.json({ ok: true });
  });
}

/** Push to the others who see the folder: comments just added on the board (records from push). */
export function notifyComments(owner, comments) {
  for (const c of comments) {
    if (!c.folderId) continue;
    const recipients = folderUsers(owner, c.folderId).filter((id) => id !== c.authorId);
    if (recipients.length === 0) continue;
    const board = owner ? { board: owner } : {};
    const author = c.authorName || 'Комментарий';
    let payload;
    if (c.cardId) {
      const card = getRecord(owner, c.cardId);
      payload = {
        title: `${author} · ${withoutLinks(card?.title) || 'Карточка'}`,
        tag: `comment-${c.cardId}`,
        url: `/?${new URLSearchParams({ ...board, card: c.cardId })}`,
      };
    } else {
      const folder = getRecord(owner, c.folderId);
      payload = {
        title: `${author} · Чат «${folder?.name || 'Доска'}»`,
        tag: `chat-${c.folderId}`,
        url: `/?${new URLSearchParams({ ...board, chat: `folder:${c.folderId}` })}`,
      };
    }
    sendToUsers(recipients, { ...payload, body: preview(c.text, c.images ?? []) })
      .catch((err) => console.error('Push failed:', err));
  }
}

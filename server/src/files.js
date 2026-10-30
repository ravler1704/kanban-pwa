import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DB_DIR, findCardByFile, keptFileIds, userProfile } from './db.js';
import { broadcast } from './events.js';
import { changeAttachments, visibleCard } from './sync.js';

// Files attached to cards, one file per attachment id. The card's `attachments` list them;
// access to a file is access to its card (owner, member of its project, public link).
const FILES_DIR = path.resolve(process.env.FILES_DIR || path.join(DB_DIR, 'files'));
fs.mkdirSync(FILES_DIR, { recursive: true });

// Uploads stop when the disk would get this full: the database needs room too.
const MIN_FREE_BYTES = 1024 ** 3;
// A deleted card may be restored (conflict dialog) for a while; its files stay that long.
const KEEP_DELETED_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;
// Files not yet listed in a card (an upload finishing) are left alone for this long.
const GRACE_MS = 60 * 60 * 1000;

const filePath = (id) => path.join(FILES_DIR, id);
const FILE_ID = /^[0-9a-f-]{36}$/;

// Shown in the browser; anything else (HTML, SVG, …) is downloaded so it can't run as our page.
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/[\w.+-]+|application\/pdf|text\/plain)$/;

function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const canWrite = (access) => !access?.readOnly;
const actorOf = (req) => (req.user == null ? null : userProfile(req.user));

async function freeBytes() {
  const s = await fs.promises.statfs(FILES_DIR);
  return s.bavail * s.bsize;
}

export function removeFiles(ids) {
  for (const id of ids) if (FILE_ID.test(id)) fs.rm(filePath(id), { force: true }, () => {});
}

/** Deletes files no card lists any more (and stale partial uploads). */
export async function cleanupFiles() {
  const kept = keptFileIds(Date.now() - KEEP_DELETED_MS);
  const now = Date.now();
  for (const name of await fs.promises.readdir(FILES_DIR)) {
    if (kept.has(name)) continue;
    const stat = await fs.promises.stat(filePath(name)).catch(() => null);
    if (stat && now - stat.mtimeMs > GRACE_MS) await fs.promises.rm(filePath(name), { force: true });
  }
}

/** Routes expect `req.owner` and `req.access` (requireAuthOrPublic). */
export function registerFileRoutes(app) {
  // The body is the file itself (sent as application/octet-stream); `name` and `type` are in the query.
  app.post('/api/cards/:cardId/files', async (req, res) => {
    const card = visibleCard(req.owner, req.params.cardId, req.access);
    if (!card) return res.status(404).json({ error: 'no card' });
    if (!canWrite(req.access)) return res.status(403).json({ error: 'read only' });
    const name = String(req.query.name ?? '').trim().slice(0, 255) || 'file';
    const type = String(req.query.type ?? '').slice(0, 255) || 'application/octet-stream';
    const expected = Number(req.get('content-length')) || 0;
    if (await freeBytes() - expected < MIN_FREE_BYTES) return res.status(507).json({ error: 'disk full' });

    const id = crypto.randomUUID();
    const part = filePath(`${id}.part`);
    const out = fs.createWriteStream(part);
    let size;
    try {
      await pipeline(req, out);
      size = out.bytesWritten;
      await fs.promises.rename(part, filePath(id));
    } catch {
      await fs.promises.rm(part, { force: true });
      if (!res.headersSent) res.status(400).json({ error: 'upload failed' });
      return;
    }
    // The card may have been deleted or moved out of reach during a long upload.
    if (!visibleCard(req.owner, card.id, req.access)) {
      removeFiles([id]);
      return res.status(404).json({ error: 'no card' });
    }
    const file = { id, name, size, type, addedAt: Date.now() };
    const seq = changeAttachments(req.owner, card.id, (list) => [...list, file], actorOf(req), { k: 'card.file.add', name });
    broadcast(req.owner, { seq, from: null });
    res.json({ file });
  });

  app.post('/api/cards/:cardId/files/:fileId/delete', (req, res) => {
    const card = visibleCard(req.owner, req.params.cardId, req.access);
    const { fileId } = req.params;
    if (!card || !card.attachments.some((f) => f.id === fileId)) return res.status(404).json({ error: 'not found' });
    if (!canWrite(req.access)) return res.status(403).json({ error: 'read only' });
    const removed = card.attachments.find((f) => f.id === fileId);
    const seq = changeAttachments(req.owner, card.id, (list) => list.filter((f) => f.id !== fileId),
      actorOf(req), { k: 'card.file.remove', name: removed.name });
    removeFiles([fileId]);
    broadcast(req.owner, { seq, from: null });
    res.json({ ok: true });
  });

  // `?download` saves the file instead of showing it.
  app.get('/api/files/:fileId', (req, res) => {
    const { fileId } = req.params;
    const cardId = FILE_ID.test(fileId) && findCardByFile(req.owner, fileId);
    const file = cardId && visibleCard(req.owner, cardId, req.access)?.attachments.find((f) => f.id === fileId);
    if (!file) return res.status(404).json({ error: 'not found' });
    const inline = INLINE_TYPES.test(file.type) && !('download' in req.query);
    res.set({
      'Content-Type': inline ? file.type : 'application/octet-stream',
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', file.name),
      'X-Content-Type-Options': 'nosniff',
      // A file must never act as a page of this site (its scripts would run with the user's session).
      ...(file.type !== 'application/pdf' && { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'" }),
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.sendFile(filePath(fileId), { cacheControl: false }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
    });
  });
}

export function startFileCleanup() {
  const run = () => cleanupFiles().catch((err) => console.error('File cleanup failed:', err));
  run();
  setInterval(run, CLEANUP_EVERY_MS).unref();
}

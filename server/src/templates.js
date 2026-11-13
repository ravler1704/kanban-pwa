import crypto from 'node:crypto';
import { authEnabled, requireAuth } from './auth.js';
import { BUILTIN_AUTHOR, seedBuiltinTemplates } from './builtinTemplates.js';
import { db, userProfile } from './db.js';

// Public board templates: column sets and board options, with author attribution.

const MAX_TITLE = 120;
const MAX_DESC = 2000;
const MAX_COLUMNS = 30;

db.exec(`
  CREATE TABLE IF NOT EXISTS board_templates (
    id              TEXT PRIMARY KEY,
    author_user_id  TEXT NOT NULL,
    author_name     TEXT,
    author_picture  TEXT,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    payload         TEXT NOT NULL,
    uses_count      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_board_templates_updated ON board_templates(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_board_templates_author ON board_templates(author_user_id);
`);

seedBuiltinTemplates(db);

const column = (c) => c && typeof c === 'object'
  && typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 100
  && typeof c.addToTop === 'boolean'
  && (c.wipLimit === null || (Number.isInteger(c.wipLimit) && c.wipLimit > 0 && c.wipLimit <= 999))
  && (c.color === null || (typeof c.color === 'string' && /^[a-z0-9-]{1,30}$/.test(c.color)));

/** Exported column-set shape the client applies. */
function validPayload(v) {
  if (!v || typeof v !== 'object') return false;
  const setName = v.setName;
  if (typeof setName !== 'string' || !setName.trim() || setName.length > 100) return false;
  if (!Array.isArray(v.columns) || v.columns.length < 1 || v.columns.length > MAX_COLUMNS) return false;
  if (!v.columns.every(column)) return false;
  if (v.doneMarks != null && typeof v.doneMarks !== 'boolean') return false;
  if (v.background != null && typeof v.background !== 'string') return false;
  if (v.background != null && v.background.length > 80) return false;
  return true;
}

function rowOf(t) {
  let payload;
  try {
    payload = JSON.parse(t.payload);
  } catch {
    return null;
  }
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    author: {
      id: t.author_user_id,
      name: t.author_name ?? 'Автор',
      picture: t.author_picture ?? null,
    },
    usesCount: t.uses_count,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    payload: {
      setName: payload.setName,
      columns: payload.columns.map((c) => ({
        name: c.name,
        addToTop: !!c.addToTop,
        wipLimit: c.wipLimit ?? null,
        color: c.color ?? null,
      })),
      doneMarks: payload.doneMarks ?? null,
      background: payload.background ?? null,
    },
  };
}

function listTemplates({ q, authorId, limit }) {
  const needle = (q ?? '').trim().toLowerCase();
  let sql = 'SELECT * FROM board_templates';
  const args = [];
  if (authorId) {
    sql += ' WHERE author_user_id = ?';
    args.push(authorId);
  }
  sql += ` ORDER BY CASE WHEN author_user_id = '${BUILTIN_AUTHOR}' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?`;
  args.push(limit);
  let rows = db.prepare(sql).all(...args);
  if (needle) {
    rows = rows.filter((t) => [t.title, t.description, t.author_name].some(
      (s) => (s ?? '').toLowerCase().includes(needle),
    ) || t.payload.toLowerCase().includes(needle));
  }
  return rows.map(rowOf).filter(Boolean);
}

function getTemplate(id) {
  const t = db.prepare('SELECT * FROM board_templates WHERE id = ?').get(id);
  return t ? rowOf(t) : null;
}

export function registerTemplateRoutes(app) {
  app.get('/api/templates', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit ?? '50', 10) || 50));
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    if (mine) {
      if (!req.user) return res.status(401).json({ error: 'sign in required' });
      return res.json({ templates: listTemplates({ authorId: req.user, limit }) });
    }
    res.json({ templates: listTemplates({ q: req.query.q, limit }) });
  });

  app.get('/api/templates/:id', (req, res) => {
    const t = getTemplate(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json(t);
  });

  app.post('/api/templates/:id/use', (req, res) => {
    const row = db.prepare('SELECT id FROM board_templates WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE board_templates SET uses_count = uses_count + 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true, usesCount: getTemplate(req.params.id).usesCount });
  });

  if (!authEnabled) {
    app.post('/api/templates', (_req, res) => res.status(503).json({ error: 'auth required' }));
    return;
  }

  app.post('/api/templates', requireAuth, (req, res) => {
    const { id, title, description, payload } = req.body ?? {};
    const titleTrim = String(title ?? '').trim().slice(0, MAX_TITLE);
    if (!titleTrim || !validPayload(payload)) return res.status(400).json({ error: 'invalid template' });
    const descTrim = String(description ?? '').trim().slice(0, MAX_DESC);
    const profile = userProfile(req.user);
    const now = Date.now();
    const body = JSON.stringify({
      setName: payload.setName.trim().slice(0, 100),
      columns: payload.columns.map((c, i) => ({
        name: c.name.trim().slice(0, 100),
        addToTop: !!c.addToTop,
        wipLimit: c.wipLimit ?? null,
        color: c.color ?? null,
        position: i + 1,
      })),
      doneMarks: payload.doneMarks ?? null,
      background: payload.background ?? null,
    });
    const templateId = typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : crypto.randomUUID();
    const existing = db.prepare('SELECT author_user_id FROM board_templates WHERE id = ?').get(templateId);
    if (existing) {
      if (existing.author_user_id !== req.user) return res.status(403).json({ error: 'not author' });
      db.prepare(`
        UPDATE board_templates SET title = ?, description = ?, payload = ?, updated_at = ?,
          author_name = ?, author_picture = ?
        WHERE id = ?
      `).run(titleTrim, descTrim, body, now, profile.name ?? null, profile.picture ?? null, templateId);
    } else {
      db.prepare(`
        INSERT INTO board_templates (
          id, author_user_id, author_name, author_picture, title, description, payload,
          uses_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        templateId, req.user, profile.name ?? null, profile.picture ?? null,
        titleTrim, descTrim, body, now, now,
      );
    }
    res.json(getTemplate(templateId));
  });

  app.delete('/api/templates/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT author_user_id FROM board_templates WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.author_user_id === BUILTIN_AUTHOR) return res.status(403).json({ error: 'builtin' });
    if (row.author_user_id !== req.user) return res.status(403).json({ error: 'not author' });
    db.prepare('DELETE FROM board_templates WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

}

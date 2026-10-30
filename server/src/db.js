import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.join(import.meta.dirname, '..', 'data', 'kanban.db');
export const DB_DIR = path.dirname(DB_PATH);
fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

const hasColumn = (table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Every record belongs to one board owner (the signed-in user; '' when auth is off).
// Ids are unique per owner only: the default columns have the same ids on every board.
const RECORDS_SCHEMA = `
  CREATE TABLE records (
    owner       TEXT    NOT NULL DEFAULT '',
    id          TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    data        TEXT    NOT NULL,
    version     INTEGER NOT NULL,
    seq         INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    updated_by  TEXT,
    PRIMARY KEY (owner, id)
  );
`;

if (!hasColumn('records', 'id')) {
  db.exec(RECORDS_SCHEMA);
} else if (!hasColumn('records', 'owner')) {
  // Single-board databases: existing records keep the auth-off owner ''.
  db.exec(`
    BEGIN;
    ALTER TABLE records RENAME TO records_single;
    ${RECORDS_SCHEMA}
    INSERT INTO records (owner, id, type, data, version, seq, updated_at, updated_by)
      SELECT '', id, type, data, version, seq, updated_at, updated_by FROM records_single;
    DROP TABLE records_single;
    COMMIT;
  `);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_records_owner_seq ON records(owner, seq)');

// No sessions existed before user_id was added, so the table can simply be recreated.
if (hasColumn('sessions', 'token_hash') && !hasColumn('sessions', 'user_id')) db.exec('DROP TABLE sessions');
db.exec(`
  -- token_hash is sha256 of the cookie value, so a leaked database does not leak sessions.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT    NOT NULL,
    email       TEXT    NOT NULL,
    name        TEXT,
    picture     TEXT,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
`);
// The account used to sign in ('dev' sessions are accepted from this machine only).
if (!hasColumn('sessions', 'provider')) {
  db.exec(`
    ALTER TABLE sessions ADD COLUMN provider TEXT;
    UPDATE sessions SET provider = substr(user_id, 1, instr(user_id, ':') - 1) WHERE instr(user_id, ':') > 0;
  `);
}

// Sign-in accounts (Google, Yandex, …) linked to a user; the user id is the board owner.
db.exec(`
  CREATE TABLE IF NOT EXISTS identities (
    provider    TEXT    NOT NULL,
    subject     TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    email       TEXT,
    name        TEXT,
    picture     TEXT,
    linked_at   INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);
`);
// Before identities existed, the user id was "<provider>:<subject>" of the only account.
// Users created since have ids "u:<uuid>", which are not accounts.
db.exec(`
  DELETE FROM identities WHERE provider = 'u' AND user_id = 'u:' || subject;
  INSERT OR IGNORE INTO identities (provider, subject, user_id, email, name, picture, linked_at)
    SELECT substr(user_id, 1, instr(user_id, ':') - 1), substr(user_id, instr(user_id, ':') + 1),
           user_id, email, name, picture, MIN(created_at)
    FROM sessions WHERE instr(user_id, ':') > 0 AND user_id NOT LIKE 'u:%' GROUP BY user_id;
`);

// Web Push: browsers (devices) subscribed to a user's reminders, and reminders already sent.
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint    TEXT PRIMARY KEY,
    owner       TEXT    NOT NULL,
    p256dh      TEXT    NOT NULL,
    auth        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_owner ON push_subscriptions(owner);
  CREATE TABLE IF NOT EXISTS reminders_sent (
    owner       TEXT    NOT NULL,
    card_id     TEXT    NOT NULL,
    remind_at   INTEGER NOT NULL,
    sent_at     INTEGER NOT NULL,
    PRIMARY KEY (owner, card_id, remind_at)
  );
`);

// Sign-in by e-mail: the last code sent to each address (empty `code_hash` once used) and how many
// codes the address got since `window_start`, which limits guessing.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_codes (
    email         TEXT PRIMARY KEY,
    code_hash     TEXT    NOT NULL,
    sent_at       INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    attempts      INTEGER NOT NULL,
    window_start  INTEGER NOT NULL,
    sends         INTEGER NOT NULL
  );
`);

// People invited to projects of a board. Access follows the e-mail: whoever signs in with an
// account that has this address (or links one) gets these projects.
db.exec(`
  CREATE TABLE IF NOT EXISTS project_members (
    board       TEXT    NOT NULL,
    project     TEXT    NOT NULL,
    email       TEXT    NOT NULL,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (board, project, email)
  );
  CREATE INDEX IF NOT EXISTS idx_project_members_email ON project_members(email);
  CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(email);
`);
// Public links: anyone with the link opens the project without signing in.
// mode: 'view' (read only) or 'edit' (cards and sections, like a member).
db.exec(`
  CREATE TABLE IF NOT EXISTS public_links (
    token       TEXT    PRIMARY KEY,
    board       TEXT    NOT NULL,
    project     TEXT    NOT NULL,
    mode        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (board, project)
  );
`);
// Members of whole boards (before access per project) keep every project the board had.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'board_members'").get()) {
  db.exec(`
    BEGIN;
    INSERT OR IGNORE INTO project_members (board, project, email, added_at)
      SELECT m.board, r.id, m.email, m.added_at
      FROM board_members m JOIN records r ON r.owner = m.board AND r.type = 'project'
      WHERE json_extract(r.data, '$.deleted') = 0;
    DROP TABLE board_members;
    COMMIT;
  `);
}

// Direct messages between users who share a project (they may be on different boards), and
// until when each user has read their conversation with each peer.
db.exec(`
  CREATE TABLE IF NOT EXISTS direct_messages (
    id          TEXT    PRIMARY KEY,
    sender      TEXT    NOT NULL,
    recipient   TEXT    NOT NULL,
    text        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    edited_at   INTEGER,
    deleted     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender, recipient, created_at);
  CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient, created_at);
  CREATE TABLE IF NOT EXISTS dm_reads (
    user_id     TEXT    NOT NULL,
    peer        TEXT    NOT NULL,
    read_at     INTEGER NOT NULL,
    PRIMARY KEY (user_id, peer)
  );
`);

// Identifies this database instance. Clients holding data from another epoch
// (e.g. after the database was wiped or restored) discard it and resync.
db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('epoch', crypto.randomUUID());
export const EPOCH = db.prepare("SELECT value FROM meta WHERE key = 'epoch'").get().value;

const selectRecord = db.prepare('SELECT * FROM records WHERE owner = ? AND id = ?');
const selectSince = db.prepare('SELECT * FROM records WHERE owner = ? AND seq > ? ORDER BY seq LIMIT ?');
const selectMaxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM records');
const selectOwnerMaxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM records WHERE owner = ?');
const upsertRecord = db.prepare(`
  INSERT INTO records (owner, id, type, data, version, seq, updated_at, updated_by)
  VALUES (:owner, :id, :type, :data, :version, :seq, :updatedAt, :updatedBy)
  ON CONFLICT(owner, id) DO UPDATE SET
    data = excluded.data,
    version = excluded.version,
    seq = excluded.seq,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
`);

function toRecord(row) {
  if (!row) return null;
  return {
    ...JSON.parse(row.data),
    id: row.id,
    type: row.type,
    version: row.version,
    seq: row.seq,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

const selectMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const upsertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

export function getMeta(key) {
  return selectMeta.get(key)?.value ?? null;
}

export function setMeta(key, value) {
  upsertMeta.run(key, value);
}

export function getRecord(owner, id) {
  return toRecord(selectRecord.get(owner, id));
}

/** Highest seq of the owner's records. Seq values come from one counter shared by all boards. */
export function getMaxSeq(owner) {
  return selectOwnerMaxSeq.get(owner).seq;
}

export function getRecordsSince(owner, since, limit) {
  return selectSince.all(owner, since, limit).map(toRecord);
}

export function saveRecord(owner, type, id, data, { version, deviceId }) {
  upsertRecord.run({
    owner,
    id,
    type,
    data: JSON.stringify(data),
    version,
    seq: selectMaxSeq.get().seq + 1,
    updatedAt: Date.now(),
    updatedBy: deviceId ?? null,
  });
  return getRecord(owner, id);
}

// ---- files attached to cards (the ids are file names in the files directory) ----

const CARD_FILES = `FROM records r, json_each(r.data, '$.attachments') j WHERE r.type = 'card'`;
const selectCardByFile = db.prepare(`SELECT r.id ${CARD_FILES} AND r.owner = ? AND json_extract(j.value, '$.id') = ? LIMIT 1`);
const selectKeptFiles = db.prepare(`
  SELECT json_extract(j.value, '$.id') AS id ${CARD_FILES} AND (json_extract(r.data, '$.deleted') = 0 OR r.updated_at > ?)
`);
const selectOwnerFiles = db.prepare(`SELECT json_extract(j.value, '$.id') AS id ${CARD_FILES} AND r.owner = ?`);

export function findCardByFile(owner, fileId) {
  return selectCardByFile.get(owner, fileId)?.id ?? null;
}

/** Files of live cards and of cards deleted after `deletedSince` (they may still be restored). */
export function keptFileIds(deletedSince) {
  return new Set(selectKeptFiles.all(deletedSince).map((r) => r.id));
}

export function ownerFileIds(owner) {
  return selectOwnerFiles.all(owner).map((r) => r.id);
}

// Once: «Завершено» of the template sets puts cards first unless the user chose otherwise.
if (!getMeta('doneColumnsOnTop')) {
  transaction(() => {
    const rows = db.prepare(`
      SELECT owner, id, data, version FROM records
      WHERE type = 'column' AND id IN ('done', 'simple-done') AND json_extract(data, '$.addToTop') IS NULL
    `).all();
    for (const row of rows) {
      const data = { ...JSON.parse(row.data), addToTop: true };
      saveRecord(row.owner, 'column', row.id, data, { version: row.version + 1, deviceId: 'server' });
    }
    setMeta('doneColumnsOnTop', '1');
  });
}

const insertSession = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, provider, email, name, picture, created_at, expires_at)
  VALUES (:tokenHash, :userId, :provider, :email, :name, :picture, :createdAt, :expiresAt)
`);
const selectSession = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?');
const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const removeExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

export function createSession(session) {
  removeExpiredSessions.run(Date.now());
  insertSession.run(session);
}

export function getSession(tokenHash) {
  return selectSession.get(tokenHash, Date.now()) ?? null;
}

export function deleteSession(tokenHash) {
  removeSession.run(tokenHash);
}

const selectIdentityUser = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?');
const upsertIdentityStmt = db.prepare(`
  INSERT INTO identities (provider, subject, user_id, email, name, picture, linked_at)
  VALUES (:provider, :subject, :userId, :email, :name, :picture, :linkedAt)
  ON CONFLICT(provider, subject) DO UPDATE SET
    user_id = excluded.user_id, email = excluded.email, name = excluded.name, picture = excluded.picture
`);
const selectIdentities = db.prepare(
  'SELECT provider, subject, email, name, picture FROM identities WHERE user_id = ? ORDER BY linked_at',
);
const removeIdentity = db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ? AND subject = ?');

const selectAnyRecord = db.prepare('SELECT 1 FROM records WHERE owner = ? LIMIT 1');

export function getIdentityUser(provider, subject) {
  const row = selectIdentityUser.get(provider, subject);
  if (row) return row.user_id;
  // Boards created before identities existed are owned by "<provider>:<subject>".
  const legacy = `${provider}:${subject}`;
  return selectAnyRecord.get(legacy) ? legacy : null;
}

/** Creates the identity or refreshes its profile; `userId` (re)assigns its owner. */
export function saveIdentity({ provider, subject, userId, email, name, picture }) {
  upsertIdentityStmt.run({
    provider, subject, userId, email: email ?? null, name: name ?? null, picture: picture ?? null, linkedAt: Date.now(),
  });
}

export function listIdentities(userId) {
  return selectIdentities.all(userId);
}

export function deleteIdentity(userId, provider, subject) {
  return removeIdentity.run(userId, provider, subject).changes > 0;
}

const selectUserByEmail = db.prepare('SELECT user_id FROM identities WHERE email = ? ORDER BY linked_at LIMIT 1');

/** The user who has an account with this e-mail (the earliest linked one), or null. */
export function findUserByEmail(email) {
  return selectUserByEmail.get(email)?.user_id ?? null;
}

const selectEmailCode = db.prepare('SELECT * FROM email_codes WHERE email = ?');
const upsertEmailCode = db.prepare(`
  INSERT INTO email_codes (email, code_hash, sent_at, expires_at, attempts, window_start, sends)
  VALUES (:email, :codeHash, :sentAt, :expiresAt, 0, :windowStart, :sends)
  ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, sent_at = excluded.sent_at,
    expires_at = excluded.expires_at, attempts = 0, window_start = excluded.window_start, sends = excluded.sends
`);
const addEmailCodeAttempt = db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? RETURNING attempts');
const clearEmailCode = db.prepare("UPDATE email_codes SET code_hash = '' WHERE email = ?");
const removeOldEmailCodes = db.prepare('DELETE FROM email_codes WHERE window_start < ?');

export function getEmailCode(email) {
  return selectEmailCode.get(email) ?? null;
}

export function saveEmailCode(code) {
  upsertEmailCode.run(code);
}

/** Counts a wrong guess; returns how many were made. */
export function countEmailCodeAttempt(email) {
  return addEmailCodeAttempt.get(email)?.attempts ?? 0;
}

export function useEmailCode(email) {
  clearEmailCode.run(email);
}

export function pruneEmailCodes(before) {
  removeOldEmailCodes.run(before);
}

const selectLiveRecords = db.prepare('SELECT type, data FROM records WHERE owner = ?');

/** What the user would bring into a merge: live projects and cards. */
export function boardSummary(owner) {
  const summary = { projects: 0, cards: 0 };
  for (const row of selectLiveRecords.all(owner)) {
    if (JSON.parse(row.data).deleted) continue;
    if (row.type === 'project') summary.projects += 1;
    if (row.type === 'card') summary.cards += 1;
  }
  return summary;
}

/**
 * Moves everything of user `from` to user `to`: records, linked accounts and sessions.
 * Records get fresh seq values so `to`'s devices pull them. Where both boards have a record
 * with the same id (the default columns), `to` keeps its own.
 */
export function mergeUsers(from, to) {
  return transaction(() => {
    const rows = db.prepare('SELECT id FROM records WHERE owner = ? ORDER BY seq').all(from);
    const exists = db.prepare('SELECT 1 FROM records WHERE owner = ? AND id = ?');
    const move = db.prepare('UPDATE records SET owner = ?, seq = ? WHERE owner = ? AND id = ?');
    let seq = selectMaxSeq.get().seq;
    for (const { id } of rows) {
      if (!exists.get(to, id)) move.run(to, ++seq, from, id);
    }
    db.prepare('DELETE FROM records WHERE owner = ?').run(from);
    db.prepare('UPDATE identities SET user_id = ? WHERE user_id = ?').run(to, from);
    db.prepare('UPDATE sessions SET user_id = ? WHERE user_id = ?').run(to, from);
    db.prepare('UPDATE push_subscriptions SET owner = ? WHERE owner = ?').run(to, from);
    db.prepare('UPDATE OR IGNORE reminders_sent SET owner = ? WHERE owner = ?').run(to, from);
    db.prepare('UPDATE OR IGNORE project_members SET board = ? WHERE board = ?').run(to, from);
    db.prepare('DELETE FROM project_members WHERE board = ?').run(from);
    db.prepare('UPDATE OR IGNORE public_links SET board = ? WHERE board = ?').run(to, from);
    db.prepare('DELETE FROM public_links WHERE board = ?').run(from);
    db.prepare('UPDATE direct_messages SET sender = ? WHERE sender = ?').run(to, from);
    db.prepare('UPDATE direct_messages SET recipient = ? WHERE recipient = ?').run(to, from);
    db.prepare('DELETE FROM direct_messages WHERE sender = recipient').run();
    db.prepare('UPDATE OR IGNORE dm_reads SET user_id = ? WHERE user_id = ?').run(to, from);
    db.prepare('UPDATE OR IGNORE dm_reads SET peer = ? WHERE peer = ?').run(to, from);
    db.prepare('DELETE FROM dm_reads WHERE user_id = ? OR peer = ? OR user_id = peer').run(from, from);
    return seq;
  });
}

/**
 * Deletes the user and everything of theirs: the board, linked accounts, sessions, reminders,
 * invitations to their projects, their public links and direct messages. Invitations of their addresses to other
 * boards go too, unless another user's account has the same address.
 */
export function deleteUser(userId) {
  transaction(() => {
    const emails = db.prepare('SELECT DISTINCT lower(email) AS email FROM identities WHERE user_id = ? AND email IS NOT NULL')
      .all(userId).map((r) => r.email);
    db.prepare('DELETE FROM records WHERE owner = ?').run(userId);
    db.prepare('DELETE FROM identities WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM push_subscriptions WHERE owner = ?').run(userId);
    db.prepare('DELETE FROM reminders_sent WHERE owner = ?').run(userId);
    db.prepare('DELETE FROM project_members WHERE board = ?').run(userId);
    db.prepare('DELETE FROM public_links WHERE board = ?').run(userId);
    db.prepare('DELETE FROM meta WHERE key IN (?, ?)').run(`columnsSeeded:${userId}`, `simpleSetSeeded:${userId}`);
    db.prepare('DELETE FROM direct_messages WHERE sender = ? OR recipient = ?').run(userId, userId);
    db.prepare('DELETE FROM dm_reads WHERE user_id = ? OR peer = ?').run(userId, userId);
    const usedElsewhere = db.prepare('SELECT 1 FROM identities WHERE lower(email) = ?');
    for (const email of emails) {
      db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
      if (!usedElsewhere.get(email)) db.prepare('DELETE FROM project_members WHERE email = ?').run(email);
    }
  });
}

// Invitations to deleted projects stay in the table but give no access.
const LIVE_PROJECT = `JOIN records r ON r.owner = m.board AND r.id = m.project AND json_extract(r.data, '$.deleted') = 0`;
const selectMembers = db.prepare(`
  SELECT m.email, m.project, MIN(m.added_at) OVER (PARTITION BY m.email) AS first_added,
    (SELECT i.name FROM identities i WHERE i.email = m.email ORDER BY i.linked_at LIMIT 1) AS name,
    EXISTS (SELECT 1 FROM identities i WHERE i.email = m.email) AS joined
  FROM project_members m ${LIVE_PROJECT}
  WHERE m.board = ? ORDER BY first_added, m.email
`);
const insertMember = db.prepare(
  'INSERT OR IGNORE INTO project_members (board, project, email, added_at) VALUES (?, ?, ?, ?)',
);
const removeMember = db.prepare('DELETE FROM project_members WHERE board = ? AND email = ?');
const removeProjectMember = db.prepare('DELETE FROM project_members WHERE board = ? AND email = ? AND project = ?');
const selectUserBoards = db.prepare(`
  SELECT DISTINCT m.board FROM project_members m
  JOIN identities i ON i.email = m.email ${LIVE_PROJECT}
  WHERE i.user_id = ? AND m.board != ?
`);
const selectUserProjects = db.prepare(`
  SELECT DISTINCT m.project FROM project_members m JOIN identities i ON i.email = m.email ${LIVE_PROJECT}
  WHERE m.board = ? AND i.user_id = ? ORDER BY m.project
`);
const selectProjectUsers = db.prepare(`
  SELECT DISTINCT i.user_id FROM project_members m JOIN identities i ON i.email = m.email
  WHERE m.board = ? AND m.project = ?
`);
const selectInvited = db.prepare('SELECT 1 FROM project_members WHERE email = ? LIMIT 1');
const selectOwnerProfile = db.prepare(
  'SELECT email, name, picture FROM identities WHERE user_id = ? ORDER BY linked_at LIMIT 1',
);
const removeUserMemberships = db.prepare(`
  DELETE FROM project_members WHERE board = ? AND email IN (SELECT email FROM identities WHERE user_id = ?)
`);

/**
 * People invited to the board's projects: [{ email, name, joined, projects: [projectId] }];
 * `name` comes from the account with this e-mail once someone signed in with it.
 */
export function listMembers(board) {
  const byEmail = new Map();
  for (const row of selectMembers.all(board)) {
    if (!byEmail.has(row.email)) {
      byEmail.set(row.email, { email: row.email, name: row.name ?? null, joined: Boolean(row.joined), projects: [] });
    }
    byEmail.get(row.email).projects.push(row.project);
  }
  return [...byEmail.values()];
}

export function addMember(board, project, email) {
  insertMember.run(board, project, email, Date.now());
}

/** Without `project`, from every project of the board. */
export function deleteMember(board, email, project) {
  const result = project ? removeProjectMember.run(board, email, project) : removeMember.run(board, email);
  return result.changes > 0;
}

/** Other people's boards the user was invited to, with the owner's name, e-mail and photo. */
export function sharedBoards(userId) {
  return selectUserBoards.all(userId, userId).map(({ board }) => {
    const owner = selectOwnerProfile.get(board);
    return { id: board, name: owner?.name ?? null, email: owner?.email ?? null, picture: owner?.picture ?? null };
  });
}

/** Ids of the board's projects the user was invited to (sorted). */
export function memberProjects(board, userId) {
  return selectUserProjects.all(board, userId).map((r) => r.project);
}

/** Users who see the project: the board's owner and everyone who signed in with an invited e-mail. */
export function projectUsers(board, project) {
  return [...new Set([board, ...selectProjectUsers.all(board, project).map((r) => r.user_id)])];
}

export function isInvited(email) {
  return Boolean(email) && Boolean(selectInvited.get(email.toLowerCase()));
}

export function leaveBoard(board, userId) {
  return removeUserMemberships.run(board, userId).changes > 0;
}

/** { id, name, email, picture } from the user's first linked account. */
export function userProfile(userId) {
  const p = selectOwnerProfile.get(userId);
  return { id: userId, name: p?.name ?? null, email: p?.email ?? null, picture: p?.picture ?? null };
}

const selectLiveProjects = db.prepare(`
  SELECT id FROM records WHERE owner = ? AND type = 'project' AND json_extract(data, '$.deleted') = 0
`);

export function liveProjectIds(owner) {
  return selectLiveProjects.all(owner).map((r) => r.id);
}

const selectCommentsOfCard = db.prepare(`
  SELECT id FROM records WHERE owner = ? AND type = 'comment' AND json_extract(data, '$.cardId') = ?
`);

export function commentIdsOfCard(owner, cardId) {
  return selectCommentsOfCard.all(owner, cardId).map((r) => r.id);
}

// People sharing a live project with the user: whoever joined the user's projects, the owners of
// boards the user joined, and others who joined the same projects there.
const selectContactsOnOwnBoard = db.prepare(`
  SELECT DISTINCT i.user_id AS id FROM project_members m JOIN identities i ON i.email = m.email ${LIVE_PROJECT}
  WHERE m.board = ?
`);
const selectContactsOnOtherBoards = db.prepare(`
  SELECT DISTINCT m.board AS owner, i2.user_id AS member
  FROM project_members m JOIN identities i ON i.email = m.email ${LIVE_PROJECT}
  LEFT JOIN project_members m2 ON m2.board = m.board AND m2.project = m.project
  LEFT JOIN identities i2 ON i2.email = m2.email
  WHERE i.user_id = ?
`);

export function contactIds(userId) {
  const ids = new Set(selectContactsOnOwnBoard.all(userId).map((r) => r.id));
  for (const { owner, member } of selectContactsOnOtherBoards.all(userId)) {
    ids.add(owner);
    if (member) ids.add(member);
  }
  ids.delete(userId);
  return [...ids];
}

// ---- direct messages ----

const toMessage = (row) => ({
  id: row.id,
  sender: row.sender,
  recipient: row.recipient,
  text: row.text,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  deleted: Boolean(row.deleted),
});

const selectDmPeers = db.prepare(`
  SELECT CASE WHEN sender = :user THEN recipient ELSE sender END AS peer, MAX(created_at) AS last_at
  FROM direct_messages WHERE sender = :user OR recipient = :user GROUP BY peer
`);
const selectLastDm = db.prepare(`
  SELECT * FROM direct_messages
  WHERE (sender = :user AND recipient = :peer) OR (sender = :peer AND recipient = :user)
  ORDER BY created_at DESC, id DESC LIMIT 1
`);
const selectDmUnread = db.prepare(`
  SELECT d.sender AS peer, COUNT(*) AS unread FROM direct_messages d
  LEFT JOIN dm_reads r ON r.user_id = d.recipient AND r.peer = d.sender
  WHERE d.recipient = ? AND d.deleted = 0 AND d.created_at > COALESCE(r.read_at, 0)
  GROUP BY d.sender
`);
const selectDmThread = db.prepare(`
  SELECT * FROM direct_messages
  WHERE ((sender = :user AND recipient = :peer) OR (sender = :peer AND recipient = :user)) AND created_at < :before
  ORDER BY created_at DESC, id DESC LIMIT :limit
`);
const selectDm = db.prepare('SELECT * FROM direct_messages WHERE id = ?');
const insertDm = db.prepare(`
  INSERT OR IGNORE INTO direct_messages (id, sender, recipient, text, created_at) VALUES (?, ?, ?, ?, ?)
`);
const updateDm = db.prepare('UPDATE direct_messages SET text = ?, edited_at = ?, deleted = ? WHERE id = ?');
const upsertDmRead = db.prepare(`
  INSERT INTO dm_reads (user_id, peer, read_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id, peer) DO UPDATE SET read_at = MAX(read_at, excluded.read_at)
`);

/** The user's conversations: { [peer]: { last (message), unread } }. */
export function dmConversations(userId) {
  const unread = new Map(selectDmUnread.all(userId).map((r) => [r.peer, r.unread]));
  const out = {};
  for (const { peer } of selectDmPeers.all({ user: userId })) {
    out[peer] = { last: toMessage(selectLastDm.get({ user: userId, peer })), unread: unread.get(peer) ?? 0 };
  }
  return out;
}

/** Up to `limit` messages before `before`, oldest first. */
export function dmThread(userId, peer, before, limit) {
  return selectDmThread.all({ user: userId, peer, before, limit }).reverse().map(toMessage);
}

export function getDm(id) {
  const row = selectDm.get(id);
  return row ? toMessage(row) : null;
}

/** Returns the message, also when this id was saved before (a repeated request). */
export function addDm({ id, sender, recipient, text, createdAt }) {
  insertDm.run(id, sender, recipient, text, createdAt);
  return getDm(id);
}

export function changeDm(id, { text, deleted }) {
  updateDm.run(deleted ? '' : text, Date.now(), deleted ? 1 : 0, id);
  return getDm(id);
}

export function markDmRead(userId, peer, at) {
  upsertDmRead.run(userId, peer, at);
}

// Links to deleted projects stay in the table but open nothing.
const selectPublicLink = db.prepare(`
  SELECT m.token, m.board, m.project, m.mode, json_extract(r.data, '$.name') AS name
  FROM public_links m ${LIVE_PROJECT} WHERE m.token = ?
`);
const selectPublicLinks = db.prepare(`
  SELECT m.token, m.project, m.mode FROM public_links m ${LIVE_PROJECT} WHERE m.board = ? ORDER BY m.created_at
`);
const upsertPublicLink = db.prepare(`
  INSERT INTO public_links (token, board, project, mode, created_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(board, project) DO UPDATE SET mode = excluded.mode
`);
const removePublicLink = db.prepare('DELETE FROM public_links WHERE board = ? AND project = ?');

/** { token, board, project, mode, name (the project's), owner: { name, picture } } or null. */
export function getPublicLink(token) {
  const link = selectPublicLink.get(token);
  if (!link) return null;
  const owner = selectOwnerProfile.get(link.board);
  return { ...link, owner: { name: owner?.name ?? null, picture: owner?.picture ?? null } };
}

/** Public links of the board's projects: [{ token, project, mode }]. */
export function listPublicLinks(board) {
  return selectPublicLinks.all(board);
}

/** Creates the project's link, or changes its mode (the link itself stays). */
export function savePublicLink(board, project, mode) {
  upsertPublicLink.run(randomBytes(18).toString('base64url'), board, project, mode, Date.now());
}

export function deletePublicLink(board, project) {
  return removePublicLink.run(board, project).changes > 0;
}

const upsertSubscription = db.prepare(`
  INSERT INTO push_subscriptions (endpoint, owner, p256dh, auth, created_at)
  VALUES (:endpoint, :owner, :p256dh, :auth, :createdAt)
  ON CONFLICT(endpoint) DO UPDATE SET owner = excluded.owner, p256dh = excluded.p256dh, auth = excluded.auth
`);
const selectSubscriptions = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE owner = ?');
const removeSubscription = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
const removeOwnSubscription = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND owner = ?');

/** A device's subscription follows whoever signed in on it last. */
export function savePushSubscription(owner, { endpoint, p256dh, auth }) {
  upsertSubscription.run({ endpoint, owner, p256dh, auth, createdAt: Date.now() });
}

export function getPushSubscriptions(owner) {
  return selectSubscriptions.all(owner);
}

export function deletePushSubscription(endpoint, owner) {
  if (owner === undefined) removeSubscription.run(endpoint);
  else removeOwnSubscription.run(endpoint, owner);
}

// Cards whose reminder time has come, skipping ones far in the past (e.g. set before the
// server was down for a long time) and ones already sent for this exact time.
const selectDueReminders = db.prepare(`
  SELECT r.owner, r.id, r.data, json_extract(r.data, '$.remindAt') AS remind_at
  FROM records r
  WHERE r.type = 'card'
    AND json_extract(r.data, '$.remindAt') BETWEEN ? AND ?
    AND json_extract(r.data, '$.deleted') = 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent s
      WHERE s.owner = r.owner AND s.card_id = r.id AND s.remind_at = json_extract(r.data, '$.remindAt')
    )
`);
const insertReminderSent = db.prepare(
  'INSERT OR IGNORE INTO reminders_sent (owner, card_id, remind_at, sent_at) VALUES (?, ?, ?, ?)',
);
const removeOldRemindersSent = db.prepare('DELETE FROM reminders_sent WHERE remind_at < ?');

export function getDueReminders(now, maxAgeMs) {
  return selectDueReminders.all(now - maxAgeMs, now).map((row) => ({
    owner: row.owner, id: row.id, remindAt: row.remind_at, card: JSON.parse(row.data),
  }));
}

/** Returns false if another check already claimed this reminder. */
export function markReminderSent(owner, cardId, remindAt) {
  return insertReminderSent.run(owner, cardId, remindAt, Date.now()).changes > 0;
}

export function pruneRemindersSent(before) {
  removeOldRemindersSent.run(before);
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

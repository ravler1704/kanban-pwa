import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DB_PATH = process.env.DB_PATH || path.join(import.meta.dirname, '..', 'data', 'kanban.db');
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

// People invited to folders of a board (the folder and its descendants). Access follows the e-mail.
db.exec(`
  CREATE TABLE IF NOT EXISTS folder_members (
    board       TEXT    NOT NULL,
    folder      TEXT    NOT NULL,
    email       TEXT    NOT NULL,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (board, folder, email)
  );
  CREATE INDEX IF NOT EXISTS idx_folder_members_email ON folder_members(email);
  CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(email);
`);
// Public links: anyone with the link opens the folder without signing in.
// mode: 'view' (read only) or 'edit' (cards and folders, like a member).
// Column name `project` is historical; the value is a folder id.
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
// Members of whole boards (before access per folder) keep every folder the board had.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'board_members'").get()) {
  db.exec(`
    BEGIN;
    INSERT OR IGNORE INTO folder_members (board, folder, email, added_at)
      SELECT m.board, r.id, m.email, m.added_at
      FROM board_members m JOIN records r ON r.owner = m.board AND r.type IN ('folder', 'project')
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
  -- A user deleted the conversation for themselves: messages up to cleared_at are hidden from them.
  CREATE TABLE IF NOT EXISTS dm_cleared (
    user_id     TEXT    NOT NULL,
    peer        TEXT    NOT NULL,
    cleared_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, peer)
  );
`);

// The name a user gave themselves; without it the name of their first linked account is shown.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_names (
    user_id     TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL
  );
`);

// Spaces: boards of a user besides the main one, whose id is the user's id (so boards from before
// spaces keep their records). A row with the user's own id only names the main space.
db.exec(`
  CREATE TABLE IF NOT EXISTS spaces (
    id          TEXT PRIMARY KEY,
    owner       TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner);
`);
// Cards can be marked done (as Trello's) on boards that don't say otherwise: 0 / 1, null → on.
if (!hasColumn('spaces', 'done_marks')) db.exec('ALTER TABLE spaces ADD COLUMN done_marks INTEGER');

// Support: each user has one conversation with the administrators (all of them answer as «Поддержка»).
// `from_support`: written by an administrator in someone's conversation. The ticket keeps its status and
// until when the user and the support (one mark shared by the administrators) have read it.
db.exec(`
  CREATE TABLE IF NOT EXISTS support_messages (
    id            TEXT    PRIMARY KEY,
    user_id       TEXT    NOT NULL,
    author        TEXT    NOT NULL,
    from_support  INTEGER NOT NULL,
    text          TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    edited_at     INTEGER,
    deleted       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages(user_id, created_at);
  CREATE TABLE IF NOT EXISTS support_tickets (
    user_id       TEXT    PRIMARY KEY,
    status        TEXT    NOT NULL,
    updated_at    INTEGER NOT NULL,
    user_read     INTEGER NOT NULL DEFAULT 0,
    support_read  INTEGER NOT NULL DEFAULT 0
  );
`);

// Images of direct and support messages (JSON, see imageList.js).
if (!hasColumn('direct_messages', 'images')) db.exec("ALTER TABLE direct_messages ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");
if (!hasColumn('support_messages', 'images')) db.exec("ALTER TABLE support_messages ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");
// What a direct or support message answers (JSON, see reply.js), or null.
if (!hasColumn('direct_messages', 'reply')) db.exec('ALTER TABLE direct_messages ADD COLUMN reply TEXT');
if (!hasColumn('support_messages', 'reply')) db.exec('ALTER TABLE support_messages ADD COLUMN reply TEXT');

// When each user last used the app (any request with their session), for the administrators' overview.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_seen (
    user_id     TEXT    PRIMARY KEY,
    seen_at     INTEGER NOT NULL
  );
`);
const upsertSeen = db.prepare(`
  INSERT INTO user_seen (user_id, seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at
`);
const SEEN_EVERY_MS = 5 * 60 * 1000;
const seenWritten = new Map();

/** Notes that the user is active; written at most once per a few minutes. */
export function touchUser(userId) {
  const now = Date.now();
  if (now - (seenWritten.get(userId) ?? 0) < SEEN_EVERY_MS) return;
  seenWritten.set(userId, now);
  upsertSeen.run(userId, now);
}

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
// Deleted cards stay in the archive with their files until they are deleted for good (then they list none).
const selectKeptFiles = db.prepare(`SELECT json_extract(j.value, '$.id') AS id ${CARD_FILES}`);
const selectOwnerFiles = db.prepare(`SELECT json_extract(j.value, '$.id') AS id ${CARD_FILES} AND r.owner = ?`);

// Board backgrounds uploaded by users: a folder's `background` is `file-<file id>`.
const BACKGROUND_PREFIX = 'file-';
const FOLDER_BACKGROUNDS = `FROM records WHERE type = 'folder' AND json_extract(data, '$.background') LIKE '${BACKGROUND_PREFIX}%'`;
const BACKGROUND_ID = `substr(json_extract(data, '$.background'), ${BACKGROUND_PREFIX.length + 1})`;
const selectFoldersByBackground = db.prepare(`SELECT id ${FOLDER_BACKGROUNDS} AND owner = ? AND json_extract(data, '$.background') = ?`);
const selectKeptBackgrounds = db.prepare(`
  SELECT ${BACKGROUND_ID} AS id ${FOLDER_BACKGROUNDS} AND (json_extract(data, '$.deleted') = 0 OR updated_at > ?)
`);
const selectOwnerBackgrounds = db.prepare(`SELECT ${BACKGROUND_ID} AS id ${FOLDER_BACKGROUNDS} AND owner = ?`);

export function findCardByFile(owner, fileId) {
  return selectCardByFile.get(owner, fileId)?.id ?? null;
}

/** Folders of the board whose background is the uploaded image `fileId`. */
export function foldersWithBackground(owner, fileId) {
  return selectFoldersByBackground.all(owner, `${BACKGROUND_PREFIX}${fileId}`).map((r) => r.id);
}

// Images of chat messages: comments (records), direct and support messages; deleted messages keep none.
const IMAGE_FILE = "(json_extract(j.value, '$.id') = :file OR json_extract(j.value, '$.preview') = :file)";
const selectCommentsByImage = db.prepare(`
  SELECT r.id, j.value AS image FROM records r, json_each(r.data, '$.images') j
  WHERE r.owner = :owner AND r.type = 'comment' AND ${IMAGE_FILE}
`);
const selectDmByImage = db.prepare(`
  SELECT d.sender, d.recipient, j.value AS image FROM direct_messages d, json_each(d.images) j
  WHERE d.deleted = 0 AND ${IMAGE_FILE}
`);
const selectSupportByImage = db.prepare(`
  SELECT s.user_id, j.value AS image FROM support_messages s, json_each(s.images) j WHERE s.deleted = 0 AND ${IMAGE_FILE}
`);
const KEPT_IMAGES = (from) => `
  SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.preview') AS preview FROM ${from}, json_each(images) j
`;
const selectKeptChatImages = db.prepare(`
  SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.preview') AS preview
    FROM records r, json_each(r.data, '$.images') j WHERE r.type = 'comment'
  UNION ALL ${KEPT_IMAGES('direct_messages')} WHERE deleted = 0
  UNION ALL ${KEPT_IMAGES('support_messages')} WHERE deleted = 0
`);

/** The board's comments that have the image file: [{ id, image }]. */
export function commentsWithImage(owner, fileId) {
  return selectCommentsByImage.all({ owner, file: fileId }).map((r) => ({ id: r.id, image: JSON.parse(r.image) }));
}

/** Direct messages with the image file: [{ sender, recipient, image }]. */
export function dmsWithImage(fileId) {
  return selectDmByImage.all({ file: fileId }).map((r) => ({ ...r, image: JSON.parse(r.image) }));
}

/** Support messages with the image file: [{ userId, image }] (`userId`: whose conversation). */
export function supportWithImage(fileId) {
  return selectSupportByImage.all({ file: fileId }).map((r) => ({ userId: r.user_id, image: JSON.parse(r.image) }));
}

/** Files of cards (archived too) and of live folders, and of folders deleted after `deletedSince` (they may still be restored). */
export function keptFileIds(deletedSince) {
  const images = selectKeptChatImages.all().flatMap((r) => (r.preview ? [r.id, r.preview] : [r.id]));
  return new Set([...selectKeptFiles.all(), ...selectKeptBackgrounds.all(deletedSince)].map((r) => r.id).concat(images));
}

export function ownerFileIds(owner) {
  return [...selectOwnerFiles.all(owner), ...selectOwnerBackgrounds.all(owner)].map((r) => r.id);
}

/** Files of all the user's spaces. */
export function userFileIds(userId) {
  return ownSpaces(userId).flatMap((s) => ownerFileIds(s.id));
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

const selectUsersByEmail = db.prepare('SELECT DISTINCT user_id FROM identities WHERE email = ?');

/** Every user who has an account with an e-mail. */
export function usersWithAnyEmail() {
  return db.prepare('SELECT DISTINCT user_id FROM identities WHERE email IS NOT NULL').all().map((r) => r.user_id);
}

/** Every user with an account that has this e-mail. */
export function usersWithEmail(email) {
  return selectUsersByEmail.all(email).map((r) => r.user_id);
}

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
    if (row.type === 'folder' || row.type === 'project') summary.projects += 1;
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
    db.prepare('UPDATE OR IGNORE folder_members SET board = ? WHERE board = ?').run(to, from);
    db.prepare('DELETE FROM folder_members WHERE board = ?').run(from);
    db.prepare('UPDATE OR IGNORE public_links SET board = ? WHERE board = ?').run(to, from);
    db.prepare('DELETE FROM public_links WHERE board = ?').run(from);
    db.prepare('UPDATE direct_messages SET sender = ? WHERE sender = ?').run(to, from);
    db.prepare('UPDATE direct_messages SET recipient = ? WHERE recipient = ?').run(to, from);
    db.prepare('DELETE FROM direct_messages WHERE sender = recipient').run();
    db.prepare('UPDATE OR IGNORE dm_reads SET user_id = ? WHERE user_id = ?').run(to, from);
    db.prepare('UPDATE OR IGNORE dm_reads SET peer = ? WHERE peer = ?').run(to, from);
    db.prepare('DELETE FROM dm_reads WHERE user_id = ? OR peer = ? OR user_id = peer').run(from, from);
    db.prepare('UPDATE OR IGNORE dm_cleared SET user_id = ? WHERE user_id = ?').run(to, from);
    db.prepare('UPDATE OR IGNORE dm_cleared SET peer = ? WHERE peer = ?').run(to, from);
    db.prepare('DELETE FROM dm_cleared WHERE user_id = ? OR peer = ? OR user_id = peer').run(from, from);
    db.prepare('UPDATE OR IGNORE user_names SET user_id = ? WHERE user_id = ?').run(to, from);
    db.prepare('DELETE FROM user_names WHERE user_id = ?').run(from);
    db.prepare('DELETE FROM user_seen WHERE user_id = ?').run(from);
    db.prepare('UPDATE support_messages SET user_id = ? WHERE user_id = ?').run(to, from);
    db.prepare('UPDATE support_messages SET author = ? WHERE author = ?').run(to, from);
    if (db.prepare('SELECT 1 FROM support_tickets WHERE user_id = ?').get(to)) {
      db.prepare('DELETE FROM support_tickets WHERE user_id = ?').run(from);
    } else {
      db.prepare('UPDATE support_tickets SET user_id = ? WHERE user_id = ?').run(to, from);
    }
    // The other spaces come along as they are; the main one has just been merged.
    db.prepare('UPDATE spaces SET owner = ? WHERE owner = ? AND id != ?').run(to, from, from);
    db.prepare('DELETE FROM spaces WHERE id = ?').run(from);
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
    for (const space of ownSpaces(userId)) deleteBoardData(space.id);
    db.prepare('DELETE FROM spaces WHERE owner = ?').run(userId);
    db.prepare('DELETE FROM records WHERE owner = ?').run(userId);
    db.prepare('DELETE FROM identities WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM push_subscriptions WHERE owner = ?').run(userId);
    db.prepare('DELETE FROM reminders_sent WHERE owner = ?').run(userId);
    db.prepare('DELETE FROM folder_members WHERE board = ?').run(userId);
    db.prepare('DELETE FROM public_links WHERE board = ?').run(userId);
    db.prepare('DELETE FROM meta WHERE key IN (?, ?)').run(`columnsSeeded:${userId}`, `simpleSetSeeded:${userId}`);
    db.prepare('DELETE FROM direct_messages WHERE sender = ? OR recipient = ?').run(userId, userId);
    db.prepare('DELETE FROM dm_reads WHERE user_id = ? OR peer = ?').run(userId, userId);
    db.prepare('DELETE FROM dm_cleared WHERE user_id = ? OR peer = ?').run(userId, userId);
    db.prepare('DELETE FROM user_names WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_seen WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM support_messages WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM support_tickets WHERE user_id = ?').run(userId);
    const usedElsewhere = db.prepare('SELECT 1 FROM identities WHERE lower(email) = ?');
    for (const email of emails) {
      db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
      if (!usedElsewhere.get(email)) {
        db.prepare('DELETE FROM folder_members WHERE email = ?').run(email);
      }
    }
  });
}

// Invitations to deleted folders stay in the table but give no access (member_access filters them).
db.exec(`
  DROP VIEW IF EXISTS member_access;
  CREATE VIEW member_access AS
  WITH RECURSIVE tree AS (
    SELECT m.board, m.folder AS folder, m.email, m.added_at FROM folder_members m
    UNION ALL
    SELECT t.board, r.id, t.email, t.added_at
    FROM tree t
    JOIN records r ON r.owner = t.board AND r.type = 'folder'
      AND json_extract(r.data, '$.parentId') = t.folder
      AND json_extract(r.data, '$.deleted') = 0
  )
  SELECT t.board, t.folder, t.email, t.added_at
  FROM tree t
  JOIN records r ON r.owner = t.board AND r.id = t.folder AND r.type = 'folder'
    AND json_extract(r.data, '$.deleted') = 0;
`);

const LIVE_FOLDER = `JOIN records r ON r.owner = m.board AND r.id = m.folder AND r.type = 'folder' AND json_extract(r.data, '$.deleted') = 0`;
const selectMembers = db.prepare(`
  SELECT m.email, m.folder, MIN(m.added_at) OVER (PARTITION BY m.email) AS first_added,
    COALESCE(
      (SELECT n.name FROM identities i JOIN user_names n ON n.user_id = i.user_id WHERE i.email = m.email
        ORDER BY i.linked_at LIMIT 1),
      (SELECT i.name FROM identities i WHERE i.email = m.email ORDER BY i.linked_at LIMIT 1)) AS name,
    (SELECT i.picture FROM identities i WHERE i.email = m.email AND i.picture IS NOT NULL
      ORDER BY i.linked_at LIMIT 1) AS picture,
    EXISTS (SELECT 1 FROM identities i WHERE i.email = m.email) AS joined
  FROM folder_members m ${LIVE_FOLDER}
  WHERE m.board = ? ORDER BY first_added, m.email
`);
const insertMember = db.prepare(
  'INSERT OR IGNORE INTO folder_members (board, folder, email, added_at) VALUES (?, ?, ?, ?)',
);
const removeMember = db.prepare('DELETE FROM folder_members WHERE board = ? AND email = ?');
const removeFolderMember = db.prepare('DELETE FROM folder_members WHERE board = ? AND email = ? AND folder = ?');
const selectUserBoards = db.prepare(`
  SELECT DISTINCT m.board FROM member_access m
  JOIN identities i ON i.email = m.email ${LIVE_FOLDER}
  WHERE i.user_id = ? AND m.board != ?
`);
const selectUserFolders = db.prepare(`
  SELECT DISTINCT m.folder FROM member_access m JOIN identities i ON i.email = m.email ${LIVE_FOLDER}
  WHERE m.board = ? AND i.user_id = ? ORDER BY m.folder
`);
const selectFolderUsers = db.prepare(`
  SELECT DISTINCT i.user_id FROM member_access m JOIN identities i ON i.email = m.email
  WHERE m.board = ? AND m.folder = ?
`);
const selectInvited = db.prepare('SELECT 1 FROM folder_members WHERE email = ? LIMIT 1');
const selectOwnerProfile = db.prepare(`
  SELECT i.email, COALESCE(n.name, i.name) AS name, i.picture FROM identities i
  LEFT JOIN user_names n ON n.user_id = i.user_id
  WHERE i.user_id = ? ORDER BY i.linked_at LIMIT 1
`);
const selectUserName = db.prepare('SELECT name FROM user_names WHERE user_id = ?');
const upsertUserName = db.prepare(`
  INSERT INTO user_names (user_id, name) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET name = excluded.name
`);
const deleteUserName = db.prepare('DELETE FROM user_names WHERE user_id = ?');

/** The name the user gave themselves, null if none. */
export function customName(userId) {
  return selectUserName.get(userId)?.name ?? null;
}

/** `name` null: back to the name of the linked account. */
export function setCustomName(userId, name) {
  if (name) upsertUserName.run(userId, name);
  else deleteUserName.run(userId);
}
const removeUserMemberships = db.prepare(`
  DELETE FROM folder_members WHERE board = ? AND email IN (SELECT email FROM identities WHERE user_id = ?)
`);

/**
 * People invited to the board's folders: [{ email, name, joined, folders: [folderId] }].
 * `folders` are the direct invitations (not expanded descendants).
 */
export function listMembers(board) {
  const byEmail = new Map();
  for (const row of selectMembers.all(board)) {
    if (!byEmail.has(row.email)) {
      byEmail.set(row.email, {
        email: row.email, name: row.name ?? null, picture: row.picture ?? null, joined: Boolean(row.joined), folders: [],
      });
    }
    byEmail.get(row.email).folders.push(row.folder);
  }
  return [...byEmail.values()];
}

export function addMember(board, folder, email) {
  insertMember.run(board, folder, email, Date.now());
}

/** @deprecated alias */
export function addSpaceMember(board, folder, email) {
  addMember(board, folder, email);
}

/** Without `folder`, from every folder of the board. `project` / `space` accepted as aliases. */
export function deleteMember(board, email, { folder, project, space } = {}) {
  const id = folder ?? project ?? space;
  if (id) return removeFolderMember.run(board, email, id).changes > 0;
  return removeMember.run(board, email).changes > 0;
}

/**
 * Other people's spaces the user was invited to: the owner's name, e-mail and photo, and `space` (its name).
 */
export function sharedBoards(userId) {
  return selectUserBoards.all(userId, userId).flatMap(({ board }) => {
    const ownerId = boardOwner(board);
    if (!ownerId || ownerId === userId) return [];
    const owner = selectOwnerProfile.get(ownerId);
    return [{
      id: board, name: owner?.name ?? null, email: owner?.email ?? null, picture: owner?.picture ?? null,
      space: spaceName(board), doneMarks: spaceDoneMarks(board), inboxDoneMarks: inboxDoneMarks(board, userId),
    }];
  });
}

/** Ids of the board's folders the user may see (invited + descendants, sorted). */
export function memberFolders(board, userId) {
  return selectUserFolders.all(board, userId).map((r) => r.folder);
}

/** @deprecated use memberFolders */
export function memberProjects(board, userId) {
  return memberFolders(board, userId);
}

/** Users who see the folder: the board's owner and everyone invited (via this folder or an ancestor). */
export function folderUsers(board, folder) {
  // A member's own «Входящие» (see folders.js): that member only.
  if (typeof folder === 'string' && folder.startsWith('inbox:')) return [folder.slice('inbox:'.length)];
  const owner = boardOwner(board);
  return [...new Set([...(owner == null ? [] : [owner]), ...selectFolderUsers.all(board, folder).map((r) => r.user_id)])];
}

/** @deprecated use folderUsers */
export function projectUsers(board, folder) {
  return folderUsers(board, folder);
}

/** Users with a direct invitation to a folder of the board: [{ user, folder }]. */
export function folderInvitees(board) {
  return db.prepare(`
    SELECT DISTINCT i.user_id AS user, m.folder FROM folder_members m JOIN identities i ON i.email = m.email
    WHERE m.board = ?
  `).all(board);
}

/** @deprecated */
export function spaceUsers(board) {
  return folderInvitees(board).map(({ user, folder }) => ({ user, space: folder }));
}

export function isInvited(email) {
  return Boolean(email) && Boolean(selectInvited.get(email.toLowerCase()));
}

export function leaveBoard(board, userId) {
  return removeUserMemberships.run(board, userId).changes > 0;
}

// ---- spaces ----

export const MAIN_SPACE_NAME = 'Моё пространство';
const SPACE_PREFIX = 's:';
const selectSpace = db.prepare('SELECT * FROM spaces WHERE id = ?');
const selectOwnSpaces = db.prepare('SELECT id, name, done_marks FROM spaces WHERE owner = ? ORDER BY created_at, id');
const insertSpace = db.prepare('INSERT INTO spaces (id, owner, name, created_at) VALUES (?, ?, ?, ?)');
const upsertMainSpace = db.prepare(`
  INSERT INTO spaces (id, owner, name, created_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name
`);
const updateSpaceName = db.prepare('UPDATE spaces SET name = ? WHERE id = ? AND owner = ?');
const updateSpaceDoneMarks = db.prepare('UPDATE spaces SET done_marks = ? WHERE id = ? AND owner = ?');
const doneMarksOf = (row) => row?.done_marks == null ? true : Boolean(row.done_marks);

/** The user who owns the board: the board id itself for main spaces, null for a space that is gone. */
export function boardOwner(board) {
  if (typeof board !== 'string' || !board.startsWith(SPACE_PREFIX)) return board;
  return selectSpace.get(board)?.owner ?? null;
}

/** The user's spaces, the main one first: [{ id, name, doneMarks, inboxDoneMarks, main? }]. */
export function ownSpaces(userId) {
  const rows = selectOwnSpaces.all(userId);
  const main = rows.find((r) => r.id === userId);
  const space = (id, row) => ({ id, name: row.name, doneMarks: doneMarksOf(row), inboxDoneMarks: inboxDoneMarks(id, userId) });
  return [
    { ...space(userId, { name: MAIN_SPACE_NAME, ...main }), main: true },
    ...rows.filter((r) => r.id !== userId).map((r) => space(r.id, r)),
  ];
}

// The user's own «Входящие» of the board (personal): whether its cards can be marked done; null → as the space.
// The key ends with the board, so it goes with the board's data.
const inboxDoneMarksKey = (board, userId) => `inboxDoneMarks:${userId}:${board}`;

export function inboxDoneMarks(board, userId) {
  const value = getMeta(inboxDoneMarksKey(board, userId));
  return value == null ? null : value === '1';
}

export function setInboxDoneMarks(board, userId, on) {
  if (on === null) db.prepare('DELETE FROM meta WHERE key = ?').run(inboxDoneMarksKey(board, userId));
  else setMeta(inboxDoneMarksKey(board, userId), on ? '1' : '0');
}

/** Whether the board's cards can be marked done where its boards don't say otherwise. */
export function spaceDoneMarks(board) {
  return doneMarksOf(selectSpace.get(board));
}

/** False if the space is not the user's. */
export function setSpaceDoneMarks(owner, id, on) {
  if (id === owner) {
    upsertMainSpace.run(id, owner, spaceName(id), 0);
  }
  return updateSpaceDoneMarks.run(on ? 1 : 0, id, owner).changes > 0;
}

export function spaceName(board) {
  return selectSpace.get(board)?.name ?? (boardOwner(board) === board ? MAIN_SPACE_NAME : null);
}

export function createSpace(owner, name) {
  const id = `${SPACE_PREFIX}${crypto.randomUUID()}`;
  insertSpace.run(id, owner, name, Date.now());
  return id;
}

/** False if the space is not the user's. */
export function renameSpace(owner, id, name) {
  if (id === owner) {
    upsertMainSpace.run(id, owner, name, 0);
    return true;
  }
  return updateSpaceName.run(name, id, owner).changes > 0;
}

/** Everything of a board: records, invitations, links, sent reminders and its counters. */
function deleteBoardData(board) {
  db.prepare('DELETE FROM records WHERE owner = ?').run(board);
  db.prepare('DELETE FROM folder_members WHERE board = ?').run(board);
  db.prepare('DELETE FROM public_links WHERE board = ?').run(board);
  db.prepare('DELETE FROM reminders_sent WHERE owner = ?').run(board);
  db.prepare('DELETE FROM meta WHERE key LIKE ?').run(`%:${board}`);
}

/** Deletes one of the user's spaces other than the main one; false if there is no such space. */
export function deleteSpace(owner, id) {
  if (id === owner || boardOwner(id) !== owner) return false;
  transaction(() => {
    deleteBoardData(id);
    db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
  });
  return true;
}

/** E-mails invited to the board's folders. */
export function boardMemberEmails(board) {
  return db.prepare('SELECT DISTINCT email FROM folder_members WHERE board = ?').all(board).map((r) => r.email);
}

/** { id, name, email, picture } from the user's first linked account. */
export function userProfile(userId) {
  const p = selectOwnerProfile.get(userId);
  return { id: userId, name: p?.name ?? null, email: p?.email ?? null, picture: p?.picture ?? null };
}

const selectLiveFolders = db.prepare(`
  SELECT id FROM records WHERE owner = ? AND type = 'folder' AND json_extract(data, '$.deleted') = 0
`);

export function liveFolderIds(owner) {
  return selectLiveFolders.all(owner).map((r) => r.id);
}

/** @deprecated use liveFolderIds */
export function liveProjectIds(owner) {
  return liveFolderIds(owner);
}

const selectCommentsOfCard = db.prepare(`
  SELECT id FROM records WHERE owner = ? AND type = 'comment' AND json_extract(data, '$.cardId') = ?
`);

const selectCardIds = db.prepare("SELECT id FROM records WHERE owner = ? AND type = 'card' ORDER BY rowid");

/** The board's cards (deleted too) in the order they were created. */
const selectCardCreations = db.prepare(`
  SELECT json_extract(event, '$.card.id') AS card, author FROM (
    SELECT json_extract(data, '$.event') AS event, json_extract(data, '$.authorId') AS author
    FROM records WHERE owner = ? AND type = 'comment' AND json_extract(data, '$.event') LIKE '{%'
  ) WHERE CASE WHEN json_valid(event) THEN json_extract(event, '$.k') END = 'card.create'
`);

/** Card id → id of the user who created it, from the notes in the chats. */
export function cardCreators(owner) {
  return new Map(selectCardCreations.all(owner).filter((r) => r.card && r.author).map((r) => [r.card, r.author]));
}

export function cardIdsInOrder(owner) {
  return selectCardIds.all(owner).map((r) => r.id);
}

export function commentIdsOfCard(owner, cardId) {
  return selectCommentsOfCard.all(owner, cardId).map((r) => r.id);
}

const selectEventsOfCard = db.prepare(`
  SELECT id FROM (
    SELECT id, json_extract(data, '$.event') AS event
    FROM records WHERE owner = ? AND type = 'comment' AND json_extract(data, '$.event') LIKE '{%'
  ) WHERE CASE WHEN json_valid(event) THEN json_extract(event, '$.card.id') END = ?
`);

/** The notes about the card in the chats of the board's folders. */
export function eventIdsOfCard(owner, cardId) {
  return selectEventsOfCard.all(owner, cardId).map((r) => r.id);
}

// People sharing a live folder with the user.
const selectContactsOnOwnBoard = db.prepare(`
  SELECT DISTINCT i.user_id AS id FROM member_access m JOIN identities i ON i.email = m.email ${LIVE_FOLDER}
  WHERE m.board = ?
`);
const selectContactsOnOtherBoards = db.prepare(`
  SELECT DISTINCT m.board AS owner, i2.user_id AS member
  FROM member_access m JOIN identities i ON i.email = m.email ${LIVE_FOLDER}
  LEFT JOIN member_access m2 ON m2.board = m.board AND m2.folder = m.folder
  LEFT JOIN identities i2 ON i2.email = m2.email
  WHERE i.user_id = ?
`);

export function contactIds(userId) {
  const ids = new Set(ownSpaces(userId).flatMap((s) => selectContactsOnOwnBoard.all(s.id).map((r) => r.id)));
  for (const { owner, member } of selectContactsOnOtherBoards.all(userId)) {
    const ownerId = boardOwner(owner);
    if (ownerId) ids.add(ownerId);
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
  images: JSON.parse(row.images ?? '[]'),
  reply: row.reply ? JSON.parse(row.reply) : null,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  deleted: Boolean(row.deleted),
});

const NOT_CLEARED = `created_at > COALESCE(
  (SELECT cleared_at FROM dm_cleared WHERE user_id = :user AND peer = :peer), 0)`;
const selectDmPeers = db.prepare(`
  SELECT d.peer, MAX(d.created_at) AS last_at FROM (
    SELECT CASE WHEN sender = :user THEN recipient ELSE sender END AS peer, created_at
    FROM direct_messages WHERE sender = :user OR recipient = :user
  ) d LEFT JOIN dm_cleared c ON c.user_id = :user AND c.peer = d.peer
  WHERE d.created_at > COALESCE(c.cleared_at, 0)
  GROUP BY d.peer
`);
const selectLastDm = db.prepare(`
  SELECT * FROM direct_messages
  WHERE ((sender = :user AND recipient = :peer) OR (sender = :peer AND recipient = :user)) AND ${NOT_CLEARED}
  ORDER BY created_at DESC, id DESC LIMIT 1
`);
const selectDmUnread = db.prepare(`
  SELECT d.sender AS peer, COUNT(*) AS unread FROM direct_messages d
  LEFT JOIN dm_reads r ON r.user_id = d.recipient AND r.peer = d.sender
  LEFT JOIN dm_cleared c ON c.user_id = d.recipient AND c.peer = d.sender
  WHERE d.recipient = ? AND d.deleted = 0 AND d.created_at > MAX(COALESCE(r.read_at, 0), COALESCE(c.cleared_at, 0))
  GROUP BY d.sender
`);
const selectDmThread = db.prepare(`
  SELECT * FROM direct_messages
  WHERE ((sender = :user AND recipient = :peer) OR (sender = :peer AND recipient = :user))
    AND created_at < :before AND ${NOT_CLEARED}
  ORDER BY created_at DESC, id DESC LIMIT :limit
`);
const upsertDmCleared = db.prepare(`
  INSERT INTO dm_cleared (user_id, peer, cleared_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id, peer) DO UPDATE SET cleared_at = MAX(cleared_at, excluded.cleared_at)
`);
const deleteDmPair = db.prepare(`
  DELETE FROM direct_messages WHERE (sender = :a AND recipient = :b) OR (sender = :b AND recipient = :a)
`);
const deleteDmClearedPair = db.prepare(`
  DELETE FROM dm_cleared WHERE (user_id = :a AND peer = :b) OR (user_id = :b AND peer = :a)
`);
const selectDm = db.prepare('SELECT * FROM direct_messages WHERE id = ?');
const insertDm = db.prepare(`
  INSERT OR IGNORE INTO direct_messages (id, sender, recipient, text, images, reply, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const updateDm = db.prepare(`
  UPDATE direct_messages SET text = ?, edited_at = ?, deleted = ?, images = CASE WHEN ? THEN '[]' ELSE images END,
    reply = CASE WHEN ? THEN NULL ELSE reply END WHERE id = ?
`);
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
export function addDm({ id, sender, recipient, text, images = [], reply = null, createdAt }) {
  insertDm.run(id, sender, recipient, text, JSON.stringify(images), reply && JSON.stringify(reply), createdAt);
  return getDm(id);
}

export function changeDm(id, { text, deleted }) {
  updateDm.run(deleted ? '' : text, Date.now(), deleted ? 1 : 0, deleted ? 1 : 0, deleted ? 1 : 0, id);
  return getDm(id);
}

export function markDmRead(userId, peer, at) {
  upsertDmRead.run(userId, peer, at);
}

/**
 * Deletes the conversation with `peer`: for the user only (the messages so far are hidden from them,
 * the peer keeps theirs), or `forBoth` — the messages are gone for both.
 */
export function clearDm(userId, peer, forBoth) {
  if (forBoth) {
    deleteDmPair.run({ a: userId, b: peer });
    deleteDmClearedPair.run({ a: userId, b: peer });
  } else {
    upsertDmCleared.run(userId, peer, Date.now());
  }
}

// ---- support ----

const toSupportMessage = (row) => ({
  id: row.id,
  userId: row.user_id,
  author: row.author,
  fromSupport: Boolean(row.from_support),
  text: row.text,
  images: JSON.parse(row.images ?? '[]'),
  reply: row.reply ? JSON.parse(row.reply) : null,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  deleted: Boolean(row.deleted),
});
const selectSupportMessage = db.prepare('SELECT * FROM support_messages WHERE id = ?');
const selectSupportThread = db.prepare(`
  SELECT * FROM support_messages WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?
`);
const insertSupportMessage = db.prepare(`
  INSERT OR IGNORE INTO support_messages (id, user_id, author, from_support, text, images, reply, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateSupportMessage = db.prepare(`
  UPDATE support_messages SET text = ?, edited_at = ?, deleted = ?, images = CASE WHEN ? THEN '[]' ELSE images END,
    reply = CASE WHEN ? THEN NULL ELSE reply END WHERE id = ?
`);
const selectTicket = db.prepare('SELECT * FROM support_tickets WHERE user_id = ?');
const upsertTicket = db.prepare(`
  INSERT INTO support_tickets (user_id, status, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
`);
const selectTickets = db.prepare(`
  SELECT t.*,
    (SELECT COUNT(*) FROM support_messages m WHERE m.user_id = t.user_id AND m.deleted = 0 AND m.from_support = 0
      AND m.created_at > t.support_read) AS unread
  FROM support_tickets t ORDER BY t.updated_at DESC
`);
const selectLastSupport = db.prepare(`
  SELECT * FROM support_messages WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC, id DESC LIMIT 1
`);
const selectUserUnread = db.prepare(`
  SELECT COUNT(*) AS n FROM support_messages WHERE user_id = ? AND deleted = 0 AND from_support = 1 AND created_at > ?
`);
const markUserRead = db.prepare('UPDATE support_tickets SET user_read = MAX(user_read, ?) WHERE user_id = ?');
const markSupportRead = db.prepare('UPDATE support_tickets SET support_read = MAX(support_read, ?) WHERE user_id = ?');

function lastSupportMessage(userId) {
  const row = selectLastSupport.get(userId);
  return row ? toSupportMessage(row) : null;
}

/** The user's own conversation with the support: { status, last, unread } (status null: never written). */
export function supportSummary(userId) {
  const ticket = selectTicket.get(userId);
  return {
    status: ticket?.status ?? null,
    last: ticket ? lastSupportMessage(userId) : null,
    unread: ticket ? selectUserUnread.get(userId, ticket.user_read).n : 0,
  };
}

/** Every conversation, for the administrators: [{ userId, status, updatedAt, last, unread }], the latest first. */
export function supportTickets() {
  return selectTickets.all().map((t) => ({
    userId: t.user_id, status: t.status, updatedAt: t.updated_at, last: lastSupportMessage(t.user_id), unread: t.unread,
  }));
}

export function supportTicket(userId) {
  const t = selectTicket.get(userId);
  return t ? { status: t.status, updatedAt: t.updated_at } : null;
}

/** Up to `limit` messages of the user's conversation before `before`, oldest first. */
export function supportThread(userId, before, limit) {
  return selectSupportThread.all(userId, before, limit).reverse().map(toSupportMessage);
}

export function getSupportMessage(id) {
  const row = selectSupportMessage.get(id);
  return row ? toSupportMessage(row) : null;
}

/** A user's message opens the ticket again; the support's answer keeps its status. */
export function addSupportMessage({ id, userId, author, fromSupport, text, images = [], reply = null, createdAt }) {
  transaction(() => {
    insertSupportMessage.run(id, userId, author, fromSupport ? 1 : 0, text, JSON.stringify(images), reply && JSON.stringify(reply), createdAt);
    const ticket = selectTicket.get(userId);
    upsertTicket.run(userId, fromSupport ? (ticket?.status ?? 'open') : 'open', createdAt);
    if (fromSupport) markSupportRead.run(createdAt, userId);
    else markUserRead.run(createdAt, userId);
  });
  return getSupportMessage(id);
}

export function changeSupportMessage(id, { text, deleted }) {
  updateSupportMessage.run(deleted ? '' : text, Date.now(), deleted ? 1 : 0, deleted ? 1 : 0, deleted ? 1 : 0, id);
  return getSupportMessage(id);
}

export function setSupportStatus(userId, status) {
  return db.prepare('UPDATE support_tickets SET status = ? WHERE user_id = ?').run(status, userId).changes > 0;
}

/** `bySupport`: the administrators read it (one mark for all of them), else the user. */
export function markSupportThreadRead(userId, at, bySupport) {
  (bySupport ? markSupportRead : markUserRead).run(at, userId);
}

// Links to deleted folders stay in the table but open nothing.
// `project` column holds the folder id.
const LIVE_LINK = `JOIN records r ON r.owner = m.board AND r.id = m.project AND r.type = 'folder' AND json_extract(r.data, '$.deleted') = 0`;
const selectPublicLink = db.prepare(`
  SELECT m.token, m.board, m.project, m.mode, json_extract(r.data, '$.name') AS name
  FROM public_links m ${LIVE_LINK} WHERE m.token = ?
`);
const selectPublicLinks = db.prepare(`
  SELECT m.token, m.project, m.mode FROM public_links m ${LIVE_LINK} WHERE m.board = ? ORDER BY m.created_at
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
  const owner = selectOwnerProfile.get(boardOwner(link.board));
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

// Cards with reminders; push.js picks the ones whose time has come.
const selectCardsWithReminders = db.prepare(`
  SELECT owner, id, data FROM records
  WHERE type = 'card'
    AND json_extract(data, '$.deleted') = 0
    AND (json_array_length(data, '$.reminders') > 0 OR json_extract(data, '$.remindAt') >= ?)
`);
const selectReminderSent = db.prepare(
  'SELECT 1 FROM reminders_sent WHERE owner = ? AND card_id = ? AND remind_at = ?',
);
const insertReminderSent = db.prepare(
  'INSERT OR IGNORE INTO reminders_sent (owner, card_id, remind_at, sent_at) VALUES (?, ?, ?, ?)',
);
const removeOldRemindersSent = db.prepare('DELETE FROM reminders_sent WHERE remind_at < ?');

/** Cards that may have a reminder at or after `since`: { owner, id, card }. */
export function getCardsWithReminders(since) {
  return selectCardsWithReminders.all(since).map((row) => ({ owner: row.owner, id: row.id, card: JSON.parse(row.data) }));
}

export function isReminderSent(owner, cardId, remindAt) {
  return Boolean(selectReminderSent.get(owner, cardId, remindAt));
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

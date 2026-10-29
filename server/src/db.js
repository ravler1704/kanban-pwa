import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.join(import.meta.dirname, '..', 'data', 'kanban.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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
db.exec(`
  INSERT OR IGNORE INTO identities (provider, subject, user_id, email, name, picture, linked_at)
    SELECT substr(user_id, 1, instr(user_id, ':') - 1), substr(user_id, instr(user_id, ':') + 1),
           user_id, email, name, picture, MIN(created_at)
    FROM sessions WHERE instr(user_id, ':') > 0 GROUP BY user_id;
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

// People invited to a board. Membership follows the e-mail: whoever signs in with an account
// that has this address (or links one) gets the board.
db.exec(`
  CREATE TABLE IF NOT EXISTS board_members (
    board       TEXT    NOT NULL,
    email       TEXT    NOT NULL,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (board, email)
  );
  CREATE INDEX IF NOT EXISTS idx_board_members_email ON board_members(email);
  CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(email);
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
    db.prepare('UPDATE OR IGNORE board_members SET board = ? WHERE board = ?').run(to, from);
    db.prepare('DELETE FROM board_members WHERE board = ?').run(from);
    return seq;
  });
}

const selectMembers = db.prepare(`
  SELECT m.email, m.added_at,
    (SELECT i.name FROM identities i WHERE i.email = m.email ORDER BY i.linked_at LIMIT 1) AS name,
    EXISTS (SELECT 1 FROM identities i WHERE i.email = m.email) AS joined
  FROM board_members m WHERE m.board = ? ORDER BY m.added_at
`);
const insertMember = db.prepare('INSERT OR IGNORE INTO board_members (board, email, added_at) VALUES (?, ?, ?)');
const removeMember = db.prepare('DELETE FROM board_members WHERE board = ? AND email = ?');
const selectUserBoards = db.prepare(`
  SELECT DISTINCT m.board FROM board_members m
  JOIN identities i ON i.email = m.email
  WHERE i.user_id = ? AND m.board != ?
`);
const selectMembership = db.prepare(`
  SELECT 1 FROM board_members m JOIN identities i ON i.email = m.email
  WHERE m.board = ? AND i.user_id = ? LIMIT 1
`);
const selectMemberUsers = db.prepare(`
  SELECT DISTINCT i.user_id FROM board_members m JOIN identities i ON i.email = m.email WHERE m.board = ?
`);
const selectInvited = db.prepare('SELECT 1 FROM board_members WHERE email = ? LIMIT 1');
const selectOwnerProfile = db.prepare(
  'SELECT email, name FROM identities WHERE user_id = ? ORDER BY linked_at LIMIT 1',
);
const removeUserMemberships = db.prepare(`
  DELETE FROM board_members WHERE board = ? AND email IN (SELECT email FROM identities WHERE user_id = ?)
`);

/** Invited e-mails of the board, with the name of the account that has it once someone signed in. */
export function listMembers(board) {
  return selectMembers.all(board).map((m) => ({ email: m.email, name: m.name ?? null, joined: Boolean(m.joined) }));
}

export function addMember(board, email) {
  insertMember.run(board, email, Date.now());
}

export function deleteMember(board, email) {
  return removeMember.run(board, email).changes > 0;
}

/** Other people's boards the user was invited to, with the owner's name and e-mail. */
export function sharedBoards(userId) {
  return selectUserBoards.all(userId, userId).map(({ board }) => {
    const owner = selectOwnerProfile.get(board);
    return { id: board, name: owner?.name ?? null, email: owner?.email ?? null };
  });
}

export function isMember(board, userId) {
  return Boolean(selectMembership.get(board, userId));
}

/** Users who see the board: its owner and everyone who signed in with an invited e-mail. */
export function boardUsers(board) {
  return [...new Set([board, ...selectMemberUsers.all(board).map((r) => r.user_id)])];
}

export function isInvited(email) {
  return Boolean(email) && Boolean(selectInvited.get(email.toLowerCase()));
}

export function leaveBoard(board, userId) {
  return removeUserMemberships.run(board, userId).changes > 0;
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

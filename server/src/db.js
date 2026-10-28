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
  INSERT INTO sessions (token_hash, user_id, email, name, picture, created_at, expires_at)
  VALUES (:tokenHash, :userId, :email, :name, :picture, :createdAt, :expiresAt)
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

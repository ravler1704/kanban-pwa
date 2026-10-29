import crypto from 'node:crypto';
import { getMaxSeq, getMeta, getRecord, getRecordsSince, saveRecord, setMeta, transaction } from './db.js';

const string = (max) => (v) => typeof v === 'string' && v.length <= max;
const ref = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const optionalRef = (v) => v === null || ref(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v);
const boolean = (v) => typeof v === 'boolean';
const optionalTime = (v) => v === null || (Number.isInteger(v) && v > 0);

/**
 * textFields — merged field-by-field; concurrent edits of the same field become a
 *   conflict the user resolves. Other fields are last-writer-wins.
 * deleteConflicts — whether delete-vs-edit is reported as a conflict; otherwise
 *   deletion wins.
 */
export const DEFAULT_SET_ID = 'default';

export const SCHEMAS = {
  // A named list of columns; every project (board) uses one set.
  columnSet: {
    fields: { name: string(100), position: number, deleted: boolean },
    defaults: { name: '', position: 0, deleted: false },
    textFields: [],
    deleteConflicts: false,
  },
  column: {
    fields: { setId: ref, name: string(100), position: number, deleted: boolean },
    defaults: { setId: DEFAULT_SET_ID, name: '', position: 0, deleted: false },
    textFields: [],
    deleteConflicts: false,
  },
  // hidden (projects, sections): unchecked by default in the board's project / section filter.
  project: {
    fields: { columnSetId: ref, name: string(200), position: number, deleted: boolean, hidden: boolean },
    defaults: { columnSetId: DEFAULT_SET_ID, name: '', position: 0, deleted: false, hidden: false },
    textFields: [],
    deleteConflicts: false,
  },
  section: {
    fields: { projectId: ref, name: string(200), position: number, deleted: boolean, hidden: boolean },
    defaults: { name: '', position: 0, deleted: false, hidden: false },
    textFields: [],
    deleteConflicts: false,
  },
  card: {
    // sectionId is null for cards that belong to the project directly.
    fields: {
      projectId: ref,
      sectionId: optionalRef,
      columnId: ref,
      title: string(500),
      description: string(10_000),
      position: number,
      deleted: boolean,
      // Unix time in ms when a push reminder is sent to the owner's devices.
      remindAt: optionalTime,
    },
    defaults: {
      sectionId: null, columnId: 'todo', title: '', description: '', position: 0, deleted: false, remindAt: null,
    },
    textFields: ['title', 'description'],
    deleteConflicts: true,
  },
};

export class ValidationError extends Error {}

function validateFields(schema, fields, { partial }) {
  if (!fields || typeof fields !== 'object') throw new ValidationError('fields must be an object');
  const names = Object.keys(schema.fields);
  for (const key of Object.keys(fields)) {
    if (!names.includes(key)) throw new ValidationError(`unknown field "${key}"`);
  }
  const out = {};
  for (const key of names) {
    if (!(key in fields)) {
      if (partial) continue;
      // Clients that synced before a field existed send bases without it.
      if (key in schema.defaults) {
        out[key] = schema.defaults[key];
        continue;
      }
      throw new ValidationError(`missing field "${key}"`);
    }
    if (!schema.fields[key](fields[key])) throw new ValidationError(`invalid ${key}`);
    out[key] = fields[key];
  }
  return out;
}

function validateChange(change) {
  if (!change || typeof change !== 'object') throw new ValidationError('change must be an object');
  const { type, id, baseVersion } = change;
  const schema = SCHEMAS[type];
  if (!schema) throw new ValidationError('invalid type');
  if (!ref(id)) throw new ValidationError('invalid id');
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new ValidationError('invalid baseVersion');
  return {
    type,
    id,
    baseVersion,
    fields: validateFields(schema, change.fields, { partial: true }),
    base: change.base == null ? null : validateFields(schema, change.base, { partial: false }),
  };
}

function pickData(schema, record) {
  const out = {};
  for (const f of Object.keys(schema.fields)) out[f] = record[f];
  return out;
}

/** Records stored before a field existed get its default. */
const withDefaults = (record) => (record && SCHEMAS[record.type] ? { ...SCHEMAS[record.type].defaults, ...record } : record);

// ---- members: access to some projects of someone else's board ----

/**
 * What a member of the board may see: `projects` (ids the member was invited to) and `sets`,
 * the column sets these projects use. `key` changes whenever either changes; it is part of the
 * member's epoch, so their devices then download the board again (records of newly opened
 * projects are older than what the device already has). With `readOnly` (a public link for
 * viewing) nothing may be changed.
 */
export function memberAccess(owner, projectIds, { readOnly = false } = {}) {
  const projects = new Set(projectIds);
  const sets = new Set();
  for (const id of projectIds) sets.add(withDefaults(getRecord(owner, id))?.columnSetId ?? DEFAULT_SET_ID);
  const key = crypto.createHash('sha256').update(JSON.stringify([projectIds, [...sets].sort()])).digest('hex').slice(0, 16);
  return { projects, sets, key, readOnly };
}

function visibleTo(access, record) {
  switch (record.type) {
    case 'project': return access.projects.has(record.id);
    case 'section':
    case 'card': return access.projects.has(record.projectId);
    case 'columnSet': return access.sets.has(record.id);
    case 'column': return access.sets.has(record.setId);
    default: return false;
  }
}

/** A deleted stand-in: hides a record that left the member's projects (e.g. a card moved out). */
function tombstone(type, id, record) {
  return {
    ...SCHEMAS[type].defaults,
    id,
    type,
    deleted: true,
    version: record?.version ?? 0,
    seq: record?.seq ?? 0,
    updatedAt: record?.updatedAt ?? 0,
    updatedBy: record?.updatedBy ?? null,
  };
}

/** Members edit cards and sections of their projects; projects and columns are the owner's. */
function memberMayChange(access, type, current, fields) {
  if (access.readOnly || (type !== 'card' && type !== 'section')) return false;
  if (current && !access.projects.has(current.projectId)) return false;
  return access.projects.has(fields.projectId ?? current?.projectId);
}

function applyChange(owner, deviceId, { type, id, baseVersion, fields, base }, access) {
  const schema = SCHEMAS[type];
  const current = withDefaults(getRecord(owner, id));
  const result = (status, record, conflicts) => ({ type, id, status, record, ...(conflicts && { conflicts }) });
  const save = (data, version) => saveRecord(owner, type, id, pickData(schema, data), { version, deviceId });

  if (access && !memberMayChange(access, type, current, fields)) {
    // Not applied; the device takes back what the member may see.
    return result('merged', current && visibleTo(access, current) ? current : tombstone(type, id, current));
  }

  if (!current) {
    const data = { ...schema.defaults, ...fields };
    for (const f of Object.keys(schema.fields)) {
      if (!(f in data)) throw new ValidationError(`missing field "${f}" for new ${type}`);
    }
    return result('applied', save(data, 1));
  }
  if (current.type !== type) throw new ValidationError(`record ${id} is not a ${type}`);

  const changed = Object.keys(fields).filter((f) => fields[f] !== current[f]);
  if (changed.length === 0) return result('applied', current);

  if (baseVersion === current.version) {
    return result('applied', save({ ...current, ...fields }, current.version + 1));
  }

  // The client edited an outdated version: three-way merge against `base`
  // (the server state the client last saw).
  const b = base ?? current;

  if (current.deleted && fields.deleted === true) return result('merged', current);

  if (current.deleted && !('deleted' in fields)) {
    // Edited locally, but deleted on another device.
    return schema.deleteConflicts
      ? result('conflict', current, { deleted: { mine: false, theirs: true } })
      : result('merged', current);
  }

  if (schema.deleteConflicts && fields.deleted === true && !current.deleted
      && schema.textFields.some((f) => current[f] !== b[f])) {
    // Deleted locally, but the content was edited on another device.
    return result('conflict', current, { deleted: { mine: true, theirs: false } });
  }

  const next = { ...current };
  const conflicts = {};
  for (const f of changed) {
    const remoteChanged = current[f] !== b[f];
    if (!schema.textFields.includes(f) || !remoteChanged) {
      next[f] = fields[f];
    } else {
      conflicts[f] = { mine: fields[f], theirs: current[f] };
    }
  }

  const modified = Object.keys(schema.fields).some((f) => next[f] !== current[f]);
  const record = modified ? save(next, current.version + 1) : current;
  return Object.keys(conflicts).length
    ? result('conflict', record, conflicts)
    : result('merged', record);
}

/** `access` (see memberAccess) limits a member's changes; null for the board's owner. */
export function push(owner, deviceId, rawChanges, access = null) {
  if (!Array.isArray(rawChanges) || rawChanges.length > 1000) {
    throw new ValidationError('changes must be an array of at most 1000 items');
  }
  const changes = rawChanges.map(validateChange);
  return transaction(() => {
    const before = getMaxSeq(owner);
    const results = changes.map((c) => applyChange(owner, deviceId, c, access));
    const seq = getMaxSeq(owner);
    return { results, seq, modified: seq !== before };
  });
}

// The first three ids predate editable columns; existing cards reference them.
const DEFAULT_COLUMNS = [
  { id: 'backlog', name: 'Входящие' },
  { id: 'todo', name: 'Запланировано' },
  { id: 'doing', name: 'В работе' },
  { id: 'review', name: 'На проверке' },
  { id: 'done', name: 'Завершено' },
];

// The template new projects get (the client picks it while it exists).
const SIMPLE_SET_ID = 'simple';
const SIMPLE_COLUMNS = [
  { id: 'simple-todo', name: 'Запланировано' },
  { id: 'simple-doing', name: 'В работе' },
  { id: 'simple-done', name: 'Завершено' },
];

const seeded = new Set();

/**
 * Creates the column set templates once per board: «3 колонки» and the default set with five columns.
 * Columns and projects from before column sets belong to the default set (see the schema defaults).
 */
export function seedColumns(owner) {
  if (seeded.has(owner)) return;
  // '' is the board from before per-user boards; it keeps its original flags.
  const flag = owner ? `columnsSeeded:${owner}` : 'columnsSeeded';
  const simpleFlag = `simpleSetSeeded:${owner}`;
  const server = { version: 1, deviceId: 'server' };
  const addColumns = (setId, columns) => columns.forEach(({ id, name }, i) => {
    if (!getRecord(owner, id)) saveRecord(owner, 'column', id, { setId, name, position: i + 1, deleted: false }, server);
  });
  transaction(() => {
    if (!getRecord(owner, DEFAULT_SET_ID)) {
      // Boards from before the templates keep the name their set always had.
      const name = getMeta(flag) ? 'Основной' : '5 колонок';
      saveRecord(owner, 'columnSet', DEFAULT_SET_ID, { name, position: 2, deleted: false }, server);
    }
    if (!getMeta(flag)) {
      addColumns(DEFAULT_SET_ID, DEFAULT_COLUMNS);
      setMeta(flag, '1');
    }
    // Once: a set the user deleted stays deleted.
    if (!getMeta(simpleFlag)) {
      if (!getRecord(owner, SIMPLE_SET_ID)) {
        saveRecord(owner, 'columnSet', SIMPLE_SET_ID, { name: '3 колонки', position: 1, deleted: false }, server);
      }
      addColumns(SIMPLE_SET_ID, SIMPLE_COLUMNS);
      setMeta(simpleFlag, '1');
    }
  });
  seeded.add(owner);
}

/** `access` (see memberAccess) limits what a member gets; null for the board's owner. */
export function pull(owner, since, limit = 500, access = null) {
  seedColumns(owner);
  let records = getRecordsSince(owner, since, limit + 1).map(withDefaults);
  const hasMore = records.length > limit;
  if (hasMore) records.pop();
  const seq = records.length ? records[records.length - 1].seq : Math.max(since, 0);
  if (access) {
    // A device downloading from scratch has nothing to hide yet.
    records = records.flatMap((r) => {
      if (visibleTo(access, r)) return [r];
      return since > 0 && (r.type === 'card' || r.type === 'section') ? [tombstone(r.type, r.id, r)] : [];
    });
  }
  return { records, seq, hasMore };
}

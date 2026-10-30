import crypto from 'node:crypto';
import {
  commentIdsOfCard, getMaxSeq, getMeta, getRecord, getRecordsSince, saveRecord, setMeta, transaction,
} from './db.js';

const string = (max) => (v) => typeof v === 'string' && v.length <= max;
const ref = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const optionalRef = (v) => v === null || ref(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v);
const boolean = (v) => typeof v === 'boolean';
const optionalTime = (v) => v === null || (Number.isInteger(v) && v > 0);
const attachment = (v) => v !== null && typeof v === 'object' && ref(v.id) && string(255)(v.name)
  && Number.isInteger(v.size) && v.size >= 0 && string(255)(v.type) && Number.isInteger(v.addedAt);
const attachments = (v) => Array.isArray(v) && v.length <= 1000 && v.every(attachment);

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
    // addToTop: cards added or moved here (other than by dragging) go first instead of last.
    fields: { setId: ref, name: string(100), position: number, deleted: boolean, addToTop: boolean },
    defaults: { setId: DEFAULT_SET_ID, name: '', position: 0, deleted: false, addToTop: false },
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
      // Files ({ id, name, size, type, addedAt }); only the server changes them (see files.js).
      attachments,
    },
    defaults: {
      sectionId: null, columnId: 'todo', title: '', description: '', position: 0, deleted: false, remindAt: null,
      attachments: [],
    },
    textFields: ['title', 'description'],
    serverFields: ['attachments'],
    deleteConflicts: true,
  },
  // A comment on a card, or (cardId null) a message in the project's chat. The server sets the
  // author and keeps projectId equal to the card's; only the author edits, the author or the
  // board's owner deletes (see applyComment).
  comment: {
    fields: {
      cardId: optionalRef,
      projectId: ref,
      text: string(4000),
      authorId: string(200),
      authorName: string(200),
      authorPicture: string(2000),
      createdAt: (v) => Number.isInteger(v) && v >= 0,
      editedAt: optionalTime,
      deleted: boolean,
    },
    defaults: {
      cardId: null, text: '', authorId: '', authorName: '', authorPicture: '', createdAt: 0, editedAt: null, deleted: false,
    },
    textFields: [],
    serverFields: ['authorId', 'authorName', 'authorPicture', 'editedAt'],
    deleteConflicts: false,
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
  const fields = validateFields(schema, change.fields, { partial: true });
  for (const f of schema.serverFields ?? []) delete fields[f];
  return {
    type,
    id,
    baseVersion,
    fields,
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
    case 'card':
    case 'comment': return access.projects.has(record.projectId);
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

/**
 * Comments are not merged: the author writes them as `actor` ({ id, name, picture }; null through
 * a public link, which can't comment). Fields other than text and deleted can't be changed.
 */
function applyComment(owner, deviceId, { id, fields }, access, actor) {
  const schema = SCHEMAS.comment;
  const current = withDefaults(getRecord(owner, id));
  const result = (status, record, extra) => ({ type: 'comment', id, status, record, ...extra });
  const save = (data, version) => saveRecord(owner, 'comment', id, pickData(schema, data), { version, deviceId });
  const reject = () => result('merged', current && (!access || visibleTo(access, current))
    ? current : tombstone('comment', id, current));
  if (!actor || access?.readOnly) return reject();

  if (!current) {
    const data = { ...schema.defaults, ...fields };
    if (!data.text.trim() || data.deleted) return reject();
    let projectId = data.projectId;
    if (data.cardId) {
      const card = getRecord(owner, data.cardId);
      if (card?.type !== 'card') return reject();
      projectId = card.projectId;
    } else if (!ref(projectId) || getRecord(owner, projectId)?.type !== 'project') {
      return reject();
    }
    if (access && !access.projects.has(projectId)) return reject();
    const now = Date.now();
    const record = save({
      ...data,
      projectId,
      authorId: actor.id,
      authorName: actor.name ?? '',
      authorPicture: actor.picture ?? '',
      createdAt: data.createdAt > 0 ? Math.min(data.createdAt, now) : now,
      editedAt: null,
    }, 1);
    return result('applied', record, { created: true });
  }
  if (current.type !== 'comment') throw new ValidationError(`record ${id} is not a comment`);
  if (access && !visibleTo(access, current)) return reject();

  const own = current.authorId === actor.id;
  const next = { ...current };
  if (fields.deleted === true) {
    if (current.deleted) return result('applied', current);
    if (!own && actor.id !== owner) return reject();
    next.deleted = true;
    next.text = '';
  } else if ('text' in fields && fields.text !== current.text) {
    if (!own || current.deleted || !fields.text.trim()) return reject();
    next.text = fields.text;
    next.editedAt = Date.now();
  }
  if (next.text === current.text && next.deleted === current.deleted) return result('applied', current);
  return result('applied', save(next, current.version + 1));
}

/** Comments follow their card into another project. */
function moveComments(owner, cardId, projectId) {
  for (const commentId of commentIdsOfCard(owner, cardId)) {
    const comment = withDefaults(getRecord(owner, commentId));
    if (comment.projectId === projectId) continue;
    saveRecord(owner, 'comment', commentId, pickData(SCHEMAS.comment, { ...comment, projectId }), {
      version: comment.version + 1, deviceId: 'server',
    });
  }
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

/** The live card, or null; with `access` (a member or a public link) only one of its projects. */
export function visibleCard(owner, cardId, access) {
  const card = withDefaults(getRecord(owner, cardId));
  if (card?.type !== 'card' || card.deleted) return null;
  return access && !access.projects.has(card.projectId) ? null : card;
}

/** Applies `change` (attachments → attachments) to the card as the server; returns the new seq. */
export function changeAttachments(owner, cardId, change) {
  return transaction(() => {
    const card = withDefaults(getRecord(owner, cardId));
    const next = { ...card, attachments: change(card.attachments) };
    saveRecord(owner, 'card', cardId, pickData(SCHEMAS.card, next), { version: card.version + 1, deviceId: 'server' });
    return getMaxSeq(owner);
  });
}

/**
 * `access` (see memberAccess) limits a member's changes; null for the board's owner. `actor`
 * ({ id, name, picture }) is who writes comments; null through a public link.
 */
export function push(owner, deviceId, rawChanges, access = null, actor = null) {
  if (!Array.isArray(rawChanges) || rawChanges.length > 1000) {
    throw new ValidationError('changes must be an array of at most 1000 items');
  }
  const changes = rawChanges.map(validateChange);
  return transaction(() => {
    const before = getMaxSeq(owner);
    const results = changes.map((c) => {
      if (c.type === 'comment') return applyComment(owner, deviceId, c, access, actor);
      const previous = c.type === 'card' ? getRecord(owner, c.id) : null;
      const r = applyChange(owner, deviceId, c, access);
      if (previous && r.record.projectId && r.record.projectId !== previous.projectId) {
        moveComments(owner, c.id, r.record.projectId);
      }
      return r;
    });
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
  { id: 'done', name: 'Завершено', addToTop: true },
];

// The template new projects get (the client picks it while it exists).
const SIMPLE_SET_ID = 'simple';
const SIMPLE_COLUMNS = [
  { id: 'simple-todo', name: 'Запланировано' },
  { id: 'simple-doing', name: 'В работе' },
  { id: 'simple-done', name: 'Завершено', addToTop: true },
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
  const addColumns = (setId, columns) => columns.forEach(({ id, name, addToTop = false }, i) => {
    if (!getRecord(owner, id)) {
      saveRecord(owner, 'column', id, { setId, name, position: i + 1, deleted: false, addToTop }, server);
    }
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
      return since > 0 && ['card', 'section', 'comment'].includes(r.type) ? [tombstone(r.type, r.id, r)] : [];
    });
  }
  return { records, seq, hasMore };
}

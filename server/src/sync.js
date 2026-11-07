import crypto from 'node:crypto';
import {
  boardOwner, cardCreators, cardIdsInOrder, commentIdsOfCard, getMaxSeq, getMeta, getRecord, getRecordsSince, saveRecord,
  setMeta, transaction, userProfile,
} from './db.js';
import { folderAncestors, folderColumnSet, isInbox, isMemberInbox, memberInboxId } from './folders.js';
import { cardReminders, isReminderList, nextTime } from './reminders.js';
import { textDiff } from './textDiff.js';

const string = (max) => (v) => typeof v === 'string' && v.length <= max;
const ref = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const optionalRef = (v) => v === null || ref(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v);
const boolean = (v) => typeof v === 'boolean';
const optionalTime = (v) => v === null || (Number.isInteger(v) && v > 0);
const optionalKey = (v) => v === null || (typeof v === 'string' && /^[a-z0-9-]{1,30}$/.test(v));
const optionalUser = (v) => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 200);
const attachment = (v) => v !== null && typeof v === 'object' && ref(v.id) && string(255)(v.name)
  && Number.isInteger(v.size) && v.size >= 0 && string(255)(v.type) && Number.isInteger(v.addedAt);
const attachments = (v) => Array.isArray(v) && v.length <= 1000 && v.every(attachment);
const checkItem = (v) => v !== null && typeof v === 'object' && ref(v.id) && string(500)(v.text) && boolean(v.done);
const checklist = (v) => Array.isArray(v) && v.length <= 200 && v.every(checkItem);

/**
 * textFields — merged field-by-field; concurrent edits of the same field become a
 *   conflict the user resolves. Other fields are last-writer-wins.
 * deleteConflicts — whether delete-vs-edit is reported as a conflict; otherwise
 *   deletion wins.
 */
export const DEFAULT_SET_ID = 'default';
// Root folder «Личное» (and the former default space id).
export const DEFAULT_FOLDER_ID = 'personal';
/** @deprecated use DEFAULT_FOLDER_ID */
export const DEFAULT_SPACE_ID = DEFAULT_FOLDER_ID;

export const SCHEMAS = {
  // A named list of columns; a folder may point at one (or inherit from an ancestor).
  columnSet: {
    fields: { name: string(100), position: number, deleted: boolean },
    defaults: { name: '', position: 0, deleted: false },
    textFields: [],
    deleteConflicts: false,
  },
  column: {
    // addToTop: cards added or moved here (other than by dragging) go first instead of last.
    // color: an id of the client's palette (as card covers), or null.
    fields: { setId: ref, name: string(100), position: number, deleted: boolean, addToTop: boolean, color: optionalKey },
    defaults: { setId: DEFAULT_SET_ID, name: '', position: 0, deleted: false, addToTop: false, color: null },
    textFields: [],
    deleteConflicts: false,
  },
  // Nested folders of any depth; parentId null is a root. columnSetId null → inherit.
  // hidden: unchecked by default in the board's folder filter.
  folder: {
    fields: {
      parentId: optionalRef,
      columnSetId: optionalRef,
      name: string(200),
      position: number,
      deleted: boolean,
      hidden: boolean,
      // Background of the board: an id of the client's presets or `file-<id>` (an uploaded image); null → the parent's.
      background: (v) => optionalKey(v) || (typeof v === 'string' && /^file-[0-9a-f-]{36}$/.test(v)),
      // Cards can be marked done (as Trello's); null → as the parent, on at the top.
      doneMarks: (v) => v === null || boolean(v),
    },
    defaults: {
      parentId: null, columnSetId: null, name: '', position: 0, deleted: false, hidden: false, background: null,
      doneMarks: null,
    },
    textFields: [],
    deleteConflicts: false,
  },
  card: {
    fields: {
      folderId: ref,
      columnId: ref,
      title: string(500),
      description: string(10_000),
      position: number,
      deleted: boolean,
      // A single reminder of cards saved before `reminders` (see reminders.js).
      remindAt: optionalTime,
      reminders: isReminderList,
      // User ids: who made the card and who has it now (null: the author).
      authorId: optionalUser,
      assigneeId: optionalUser,
      attachments,
      // Subtasks: [{ id, text, done }], in order.
      checklist,
      number: (v) => v === null || (Number.isInteger(v) && v > 0),
      // Cover colour (an id of the client's palette), or null.
      color: optionalKey,
      // Marked complete (as Trello's), wherever the card is.
      done: (v) => v === null || boolean(v),
    },
    defaults: {
      columnId: 'todo', title: '', description: '', position: 0, deleted: false, remindAt: null,
      reminders: [], authorId: null, assigneeId: null, attachments: [], checklist: [], number: null, color: null,
      done: false,
    },
    textFields: ['title', 'description'],
    serverFields: ['attachments', 'number'],
    deleteConflicts: true,
  },
  // A comment on a card, or (cardId null) a message in the folder's chat. The server sets the
  // author and keeps folderId equal to the card's; only the author edits, the author or the
  // board's owner deletes. `event` (JSON) is a note of a change, written by the server.
  comment: {
    fields: {
      cardId: optionalRef,
      folderId: optionalRef,
      text: string(4000),
      authorId: string(200),
      authorName: string(200),
      authorPicture: string(2000),
      createdAt: (v) => Number.isInteger(v) && v >= 0,
      editedAt: optionalTime,
      deleted: boolean,
      event: string(4000),
    },
    defaults: {
      cardId: null, folderId: null, text: '', authorId: '', authorName: '', authorPicture: '',
      createdAt: 0, editedAt: null, deleted: false, event: '',
    },
    textFields: [],
    serverFields: ['authorId', 'authorName', 'authorPicture', 'editedAt', 'event'],
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
  // Fields only the server sets are ignored, whatever the client sends in them.
  const withoutServerFields = (values) => {
    if (!values || typeof values !== 'object') return values;
    const out = { ...values };
    for (const f of schema.serverFields ?? []) delete out[f];
    return out;
  };
  const fields = validateFields(schema, withoutServerFields(change.fields), { partial: true });
  return {
    type,
    id,
    baseVersion,
    fields,
    base: change.base == null ? null : validateFields(schema, withoutServerFields(change.base), { partial: false }),
  };
}

function pickData(schema, record) {
  const out = {};
  for (const f of Object.keys(schema.fields)) out[f] = record[f];
  return out;
}

/** Records stored before a field existed get its default. */
const withDefaults = (record) => (record && SCHEMAS[record.type] ? { ...SCHEMAS[record.type].defaults, ...record } : record);

// ---- members: access to some folders of someone else's board ----

/**
 * What a member may see: `folders` (invited folder + descendants), `ancestors` (parents of those,
 * shown in the tree without their cards), `sets` (column sets in use). `key` changes whenever any
 * of them changes (member epoch). With `readOnly` nothing may be changed. `userId` (a member, not a
 * public link) also has `inbox`: their own «Входящие» on this board.
 */
export function memberAccess(owner, folderIds, { readOnly = false, userId = null } = {}) {
  const folders = new Set(folderIds);
  const ancestors = new Set();
  const sets = new Set();
  for (const id of folderIds) {
    sets.add(folderColumnSet(owner, id));
    for (const a of folderAncestors(owner, id)) {
      if (!folders.has(a)) ancestors.add(a);
    }
  }
  const key = crypto.createHash('sha256')
    .update(JSON.stringify([[...folders].sort(), [...ancestors].sort(), [...sets].sort()]))
    .digest('hex').slice(0, 16);
  // `projects` alias kept for older call sites during the switch.
  const inbox = userId && !readOnly ? memberInboxId(userId) : null;
  return { folders, ancestors, sets, projects: folders, key, readOnly, inbox };
}

/** Cards (and their comments) in a member's own «Входящие» are not the owner's to see. */
const hiddenFromOwner = (record) => Boolean(record) && (record.type === 'card' || record.type === 'comment')
  && isMemberInbox(record.folderId);

/** Cards and comments the member may see and change: in their folders or their own «Входящие». */
const holdsCards = (access, folderId) => access.folders.has(folderId) || (access.inbox != null && folderId === access.inbox);

function visibleTo(access, record) {
  switch (record.type) {
    case 'folder': return access.folders.has(record.id) || access.ancestors.has(record.id);
    case 'card': return holdsCards(access, record.folderId);
    case 'comment': return holdsCards(access, record.folderId);
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

/** Members edit cards and folders inside their access; column sets stay the owner's. */
function memberMayChange(access, type, current, fields) {
  if (access.readOnly || (type !== 'card' && type !== 'folder')) return false;
  if (type === 'card') {
    if (current && !holdsCards(access, current.folderId)) return false;
    return holdsCards(access, fields.folderId ?? current?.folderId);
  }
  // New folder: parent must be accessible; root folders are the owner's.
  const parentId = fields.parentId !== undefined ? fields.parentId : current?.parentId;
  if (current) {
    if (!access.folders.has(current.id) && !access.folders.has(current.parentId)) return false;
  } else if (!parentId || !access.folders.has(parentId)) return false;
  // Members may not reassign column sets or reparent outside their tree.
  if (fields.columnSetId != null && fields.columnSetId !== (current?.columnSetId ?? null)) return false;
  if (fields.parentId !== undefined) {
    const nextParent = fields.parentId;
    if (nextParent && !access.folders.has(nextParent)) return false;
    if (!nextParent) return false;
  }
  return true;
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
    let folderId = data.folderId;
    if (data.cardId) {
      const card = getRecord(owner, data.cardId);
      if (card?.type !== 'card') return reject();
      folderId = card.folderId;
    } else if (!ref(folderId) || getRecord(owner, folderId)?.type !== 'folder') {
      return reject();
    }
    if (access ? !holdsCards(access, folderId) : isMemberInbox(folderId)) return reject();
    const now = Date.now();
    const record = save({
      ...data,
      folderId,
      authorId: actor.id,
      authorName: actor.name ?? '',
      authorPicture: actor.picture ?? '',
      createdAt: data.createdAt > 0 ? Math.min(data.createdAt, now) : now,
      editedAt: null,
    }, 1);
    return result('applied', record, { created: true });
  }
  if (current.type !== 'comment') throw new ValidationError(`record ${id} is not a comment`);
  if (current.event || (access ? !visibleTo(access, current) : isMemberInbox(current.folderId))) return reject();

  const own = current.authorId === actor.id;
  const next = { ...current };
  if (fields.deleted === true) {
    if (current.deleted) return result('applied', current);
    if (!own && actor.id !== boardOwner(owner)) return reject();
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

// Who changed something through a public link.
const GUEST = { id: '', name: 'Гость по ссылке', picture: null };
// Notes of one change keep their order in the chat (sorted by time).
let lastEventAt = 0;

/** A note in the chat of a folder ({ folderId }). */
function addEvent(owner, folderId, actor, event) {
  if (isInbox(folderId)) return;
  const who = actor ?? GUEST;
  lastEventAt = Math.max(Date.now(), lastEventAt + 1);
  saveRecord(owner, 'comment', crypto.randomUUID(), pickData(SCHEMAS.comment, {
    ...SCHEMAS.comment.defaults,
    folderId,
    authorId: who.id,
    authorName: who.name || who.email || '',
    authorPicture: who.picture ?? '',
    createdAt: lastEventAt,
    event: JSON.stringify(event),
  }), { version: 1, deviceId: 'server' });
}

const nameOf = (owner, id) => (isInbox(id) ? 'Входящие'
  : id ? withDefaults(getRecord(owner, id))?.name ?? null : null);

/**
 * Notes in the folder's chat of what `actor` changed (`before` → `after`). Reordering is not noted.
 */
function recordEvents(owner, actor, type, before, after) {
  if (!after || after.type !== type || (before && after.version === before.version)) return;
  const note = (folderId, e) => folderId && addEvent(owner, folderId, actor, e);
  if (type === 'card') {
    const card = { id: after.id, title: after.title, number: after.number };
    const at = after.folderId;
    if (!before) {
      if (!after.deleted) note(at, { k: 'card.create', card, column: nameOf(owner, after.columnId) });
      return;
    }
    if (after.deleted !== before.deleted) note(at, { k: after.deleted ? 'card.delete' : 'card.restore', card });
    if (after.deleted) return;
    if (after.folderId !== before.folderId) {
      note(before.folderId, { k: 'card.out', card, folder: nameOf(owner, after.folderId) });
      note(at, { k: 'card.in', card, folder: nameOf(owner, before.folderId) });
    } else if (after.columnId !== before.columnId) {
      note(at, { k: 'card.column', card, from: nameOf(owner, before.columnId), to: nameOf(owner, after.columnId) });
    }
    if (after.title !== before.title) note(at, { k: 'card.rename', card, from: before.title });
    if (Boolean(after.done) !== Boolean(before.done)) note(at, { k: 'card.done', card, done: Boolean(after.done) });
    if (after.description !== before.description) {
      const diff = textDiff(before.description, after.description, 3000 - JSON.stringify(card).length);
      note(at, { k: 'card.description', card, ...(diff && { diff }) });
    }
    const holder = (r) => r.assigneeId || r.authorId || null;
    const personName = (userId) => {
      const p = userId ? userProfile(userId) : null;
      return p?.name || p?.email || null;
    };
    if (holder(after) !== holder(before)) note(at, { k: 'card.assignee', card, to: personName(holder(after)) });
    if (after.authorId !== before.authorId && before.authorId) {
      note(at, { k: 'card.author', card, to: personName(after.authorId) });
    }
    const reminders = cardReminders(after);
    if (JSON.stringify(reminders) !== JSON.stringify(cardReminders(before))) {
      note(at, { k: 'card.remind', card, reminders: reminders.map((r) => ({ at: nextTime(r, Date.now()) ?? r.at, repeat: r.repeat })) });
    }
    const wasChecked = new Map((before.checklist ?? []).map((i) => [i.id, i]));
    for (const item of after.checklist ?? []) {
      const was = wasChecked.get(item.id);
      if (was && was.done !== item.done) note(at, { k: 'card.check', card, item: item.text, done: item.done });
    }
  } else if (type === 'folder') {
    const parent = after.parentId;
    if (!before) {
      if (!after.deleted) {
        note(after.id, { k: 'folder.create', name: after.name });
        if (parent) note(parent, { k: 'folder.child', name: after.name });
      }
      return;
    }
    if (after.deleted !== before.deleted) {
      note(parent ?? after.id, { k: after.deleted ? 'folder.delete' : 'folder.restore', name: after.name });
    }
    if (after.deleted) return;
    if (after.name !== before.name) note(after.id, { k: 'folder.rename', name: after.name, from: before.name });
    if (after.columnSetId !== before.columnSetId) {
      note(after.id, { k: 'folder.columns', name: nameOf(owner, after.columnSetId) });
    }
    if (after.parentId !== before.parentId) {
      note(before.parentId ?? before.id, { k: 'folder.out', name: after.name, folder: nameOf(owner, after.parentId) });
      note(after.parentId ?? after.id, { k: 'folder.in', name: after.name, folder: nameOf(owner, before.parentId) });
    }
  }
}

/** Comments follow their card into another folder. */
function moveComments(owner, cardId, folderId) {
  for (const commentId of commentIdsOfCard(owner, cardId)) {
    const comment = withDefaults(getRecord(owner, commentId));
    if (comment.folderId === folderId) continue;
    saveRecord(owner, 'comment', commentId, pickData(SCHEMAS.comment, { ...comment, folderId }), {
      version: comment.version + 1, deviceId: 'server',
    });
  }
}

function nextCardNumber(owner) {
  const key = `cardNumber:${owner}`;
  const number = Number(getMeta(key) ?? 0) + 1;
  setMeta(key, String(number));
  return number;
}

const numbered = new Set();

/** Once per board: numbers for the cards from before numbers existed, in order of creation. */
function numberCards(owner) {
  if (numbered.has(owner)) return;
  const flag = `cardsNumbered:${owner}`;
  if (!getMeta(flag)) {
    transaction(() => {
      for (const id of cardIdsInOrder(owner)) {
        const card = withDefaults(getRecord(owner, id));
        if (card.number) continue;
        saveRecord(owner, 'card', id, pickData(SCHEMAS.card, { ...card, number: nextCardNumber(owner) }), {
          version: card.version + 1, deviceId: 'server',
        });
      }
      setMeta(flag, '1');
    });
  }
  // Authors of the cards from before authors existed: who created them (from the chat notes), else the owner.
  const authorsFlag = `cardAuthors:${owner}`;
  if (!getMeta(authorsFlag)) {
    transaction(() => {
      const creators = cardCreators(owner);
      for (const id of cardIdsInOrder(owner)) {
        const card = withDefaults(getRecord(owner, id));
        if (card.authorId) continue;
        const authorId = creators.get(id) || boardOwner(owner) || null;
        if (!authorId) continue;
        saveRecord(owner, 'card', id, pickData(SCHEMAS.card, { ...card, authorId }), {
          version: card.version + 1, deviceId: 'server',
        });
      }
      setMeta(authorsFlag, '1');
    });
  }
  numbered.add(owner);
}

function applyChange(owner, deviceId, { type, id, baseVersion, fields, base }, access, actor) {
  const schema = SCHEMAS[type];
  const current = withDefaults(getRecord(owner, id));
  const result = (status, record, conflicts) => ({ type, id, status, record, ...(conflicts && { conflicts }) });
  const save = (data, version) => saveRecord(owner, type, id, pickData(schema, data), { version, deviceId });

  if (access && !memberMayChange(access, type, current, fields)) {
    // Not applied; the device takes back what the member may see.
    return result('merged', current && visibleTo(access, current) ? current : tombstone(type, id, current));
  }
  // Members' own «Входящие» are theirs alone, also on the owner's board.
  if (!access && type === 'card' && (hiddenFromOwner(current) || isMemberInbox(fields.folderId))) {
    return result('merged', current && !hiddenFromOwner(current) ? current : tombstone(type, id, current));
  }

  if (!current) {
    const data = { ...schema.defaults, ...fields };
    for (const f of Object.keys(schema.fields)) {
      if (!(f in data)) throw new ValidationError(`missing field "${f}" for new ${type}`);
    }
    if (type === 'card') {
      data.number = nextCardNumber(owner);
      if (!data.authorId) data.authorId = actor?.id ?? (boardOwner(owner) || null);
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

/** The live card, or null; with `access` only one of its folders. */
/** Whether the folder is a live one of the board that `access` (null: the owner's) may see. */
export function visibleFolder(owner, folderId, access) {
  const folder = withDefaults(getRecord(owner, folderId));
  if (folder?.type !== 'folder' || folder.deleted) return false;
  return !access || visibleTo(access, folder);
}

export function visibleCard(owner, cardId, access) {
  const card = withDefaults(getRecord(owner, cardId));
  if (card?.type !== 'card' || card.deleted) return null;
  if (access) return holdsCards(access, card.folderId) ? card : null;
  return isMemberInbox(card.folderId) ? null : card;
}

/**
 * Applies `change` (attachments → attachments) to the card as the server, noting `event`
 * ({ k, name }) by `actor` in the folder's chat; returns the new seq.
 */
export function changeAttachments(owner, cardId, change, actor, event) {
  return transaction(() => {
    const card = withDefaults(getRecord(owner, cardId));
    const next = { ...card, attachments: change(card.attachments) };
    saveRecord(owner, 'card', cardId, pickData(SCHEMAS.card, next), { version: card.version + 1, deviceId: 'server' });
    addEvent(owner, card.folderId, actor, { ...event, card: { id: card.id, title: card.title, number: card.number } });
    return getMaxSeq(owner);
  });
}

/**
 * `access` (see memberAccess) limits a member's changes; null for the board's owner. `actor`
 * ({ id, name, picture }) is who writes comments and changes; null through a public link.
 */
export function push(owner, deviceId, rawChanges, access = null, actor = null) {
  if (!Array.isArray(rawChanges) || rawChanges.length > 1000) {
    throw new ValidationError('changes must be an array of at most 1000 items');
  }
  const changes = rawChanges.map(validateChange);
  numberCards(owner);
  return transaction(() => {
    const before = getMaxSeq(owner);
    const results = changes.map((c) => {
      if (c.type === 'comment') return applyComment(owner, deviceId, c, access, actor);
      const previous = withDefaults(getRecord(owner, c.id));
      const r = applyChange(owner, deviceId, c, access, actor);
      if (c.type === 'card' && previous && r.record.folderId && r.record.folderId !== previous.folderId) {
        moveComments(owner, c.id, r.record.folderId);
      }
      recordEvents(owner, actor, c.type, previous, r.record);
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
 * Creates the root folder (`rootName`, «Личное» in the main space) and the column set templates once per board.
 */
export function seedColumns(owner, { rootName = 'Личное' } = {}) {
  if (seeded.has(owner)) return;
  const flag = owner ? `columnsSeeded:${owner}` : 'columnsSeeded';
  const simpleFlag = `simpleSetSeeded:${owner}`;
  const server = { version: 1, deviceId: 'server' };
  const addColumns = (setId, columns) => columns.forEach(({ id, name, addToTop = false }, i) => {
    if (!getRecord(owner, id)) {
      saveRecord(owner, 'column', id, { setId, name, position: i + 1, deleted: false, addToTop }, server);
    }
  });
  transaction(() => {
    if (!getRecord(owner, DEFAULT_FOLDER_ID)) {
      saveRecord(owner, 'folder', DEFAULT_FOLDER_ID, {
        parentId: null, columnSetId: DEFAULT_SET_ID, name: rootName, position: 1, deleted: false, hidden: false,
      }, server);
    }
    if (!getRecord(owner, DEFAULT_SET_ID)) {
      const name = getMeta(flag) ? 'Основной' : '5 колонок';
      saveRecord(owner, 'columnSet', DEFAULT_SET_ID, { name, position: 2, deleted: false }, server);
    }
    if (!getMeta(flag)) {
      addColumns(DEFAULT_SET_ID, DEFAULT_COLUMNS);
      setMeta(flag, '1');
    }
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
  numberCards(owner);
  let records = getRecordsSince(owner, since, limit + 1).map(withDefaults);
  const hasMore = records.length > limit;
  if (hasMore) records.pop();
  const seq = records.length ? records[records.length - 1].seq : Math.max(since, 0);
  // A device downloading from scratch has nothing to hide yet.
  const hide = (r) => (since > 0 && ['card', 'folder', 'comment'].includes(r.type) ? [tombstone(r.type, r.id, r)] : []);
  records = records.flatMap((r) => {
    if (access ? visibleTo(access, r) : !hiddenFromOwner(r)) return [r];
    return hide(r);
  });
  return { records, seq, hasMore };
}

import {
  db, DEFAULT_COLUMNS, DEFAULT_SET_ID, isDirty, newId, pickFields, tableOf, TYPES,
} from './db.js';
import { columnModel, matchColumn } from './columnSets.js';
import { descendants, folderColumnSetId, folderTree, inheritingFolders } from './folders.js';
import { requestSync } from './sync.js';

const alive = (r) => !r.deleted;
const maxPosition = (records) => records.filter(alive).reduce((max, r) => Math.max(max, r.position), 0);

let lastCreated = 0;

async function insert(type, fields) {
  // createdLocally (not synced): new records go to the server in the order they were made,
  // which is the order cards get their numbers in.
  lastCreated = Math.max(Date.now(), lastCreated + 1);
  const record = { id: newId(), ...fields, deleted: false, server: null, conflict: null, createdLocally: lastCreated };
  record.dirty = isDirty(type, record);
  await tableOf(type).add(record);
  return record;
}

/**
 * Applies a local edit. `base` is the state the user started editing from:
 * if a field changed underneath (e.g. synced from another device while the editor
 * was open) and the user changed it too, a conflict is recorded instead of
 * silently overwriting the remote value.
 */
async function update(type, id, patch, base = null) {
  const table = tableOf(type);
  const record = await table.get(id);
  if (!record) return;

  const next = { ...record };
  const conflictFields = {};
  for (const [f, value] of Object.entries(patch)) {
    if (!TYPES[type].fields.includes(f) || value === record[f]) continue;
    if (base && f in base && record[f] !== base[f] && value !== base[f]) {
      conflictFields[f] = { mine: value, theirs: record[f] };
    } else {
      next[f] = value;
    }
  }

  if (Object.keys(conflictFields).length) {
    next.conflict = {
      fields: { ...(record.conflict?.fields ?? {}), ...conflictFields },
      local: { ...pickFields(type, record), ...patch },
    };
  }
  next.dirty = isDirty(type, next);
  await table.put(next);
}

/** Live cards in the folder itself (not in its subfolders). */
async function cardsIn(folderId) {
  return (await db.cards.where('folderId').equals(folderId).toArray()).filter(alive);
}

const liveFolderList = async () => (await db.folders.toArray()).filter(alive);

// ---- column sets ----

const setOfColumn = (c) => c.setId ?? DEFAULT_SET_ID;

const liveColumns = async (setId) => (await db.columns.toArray())
  .filter((c) => alive(c) && setOfColumn(c) === setId)
  .sort((a, b) => a.position - b.position);

/** New set with a copy of the columns of `copyFromSetId`. Returns the new set id. */
export async function createColumnSet(name, copyFromSetId) {
  let id;
  await db.transaction('rw', db.columnSets, db.columns, async () => {
    const set = await insert('columnSet', { name, position: maxPosition(await db.columnSets.toArray()) + 1 });
    id = set.id;
    for (const c of await liveColumns(copyFromSetId)) {
      await insert('column', { setId: id, name: c.name, position: c.position, addToTop: !!c.addToTop });
    }
  });
  requestSync();
  return id;
}

export async function renameColumnSet(id, name) {
  await update('columnSet', id, { name });
  requestSync();
}

/** Only sets no folder uses can be deleted; their columns go with them. */
export async function deleteColumnSet(id) {
  await db.transaction('rw', db.columnSets, db.columns, db.folders, async () => {
    const folders = await liveFolderList();
    if (folders.some((f) => folderColumnSetId(f, folders) === id)) throw new Error('Набор используется папками');
    for (const c of await liveColumns(id)) await update('column', c.id, { deleted: true });
    await update('columnSet', id, { deleted: true });
  });
  requestSync();
}

/** Live cards of the folders (the first one and the rest that take its column set). */
async function cardsOfGroup(group) {
  const cards = [];
  for (const f of group) cards.push(...await cardsIn(f.id));
  return cards;
}

/**
 * Gives the folder another column set (`setId`; null: take the nearest ancestor's). `mapping` maps each
 * old column id to a column of the new set; cards in columns missing from it go to the first new column.
 * The cards of the folder's subfolders that take their set from it follow.
 */
export async function changeFolderColumnSet(folderId, setId, mapping = {}) {
  await db.transaction('rw', db.folders, db.columns, db.cards, async () => {
    const folders = await liveFolderList();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const before = folderColumnSetId(folder, folders);
    const changed = folders.map((f) => (f.id === folderId ? { ...f, columnSetId: setId } : f));
    const after = folderColumnSetId(changed.find((f) => f.id === folderId), changed);
    if (after !== before) {
      const target = await liveColumns(after);
      if (!target.length) throw new Error('В наборе нет колонок');
      for (const c of await cardsOfGroup(inheritingFolders(folder, folders))) {
        const columnId = mapping[c.columnId] ?? target[0].id;
        if (columnId !== c.columnId) await update('card', c.id, { columnId });
      }
    }
    await update('folder', folderId, { columnSetId: setId });
  });
  requestSync();
}

/** Live cards of the folder and the subfolders that take its column set. */
export async function countInheritingCards(folderId) {
  const folders = await liveFolderList();
  const folder = folders.find((f) => f.id === folderId);
  return folder ? (await cardsOfGroup(inheritingFolders(folder, folders))).length : 0;
}

// ---- columns ----

export async function createColumn(setId, name) {
  await insert('column', { setId, name, position: maxPosition(await liveColumns(setId)) + 1, addToTop: false });
  requestSync();
}

export async function renameColumn(id, name) {
  await update('column', id, { name });
  requestSync();
}

export async function setColumnAddToTop(id, addToTop) {
  await update('column', id, { addToTop });
  requestSync();
}

/** Swaps the column with its neighbour; `direction` is -1 (left) or 1 (right). */
export async function moveColumn(id, direction) {
  await db.transaction('rw', db.columns, async () => {
    const column = await db.columns.get(id);
    if (!column) return;
    const columns = await liveColumns(setOfColumn(column));
    const index = columns.findIndex((c) => c.id === id);
    const other = columns[index + direction];
    if (index < 0 || !other) return;
    await update('column', id, { position: other.position });
    await update('column', other.id, { position: columns[index].position });
  });
  requestSync();
}

export async function countColumnCards(id) {
  return db.cards.filter((c) => alive(c) && c.columnId === id).count();
}

/** Deletes the column; its cards move to the end of `targetId`. */
export async function deleteColumn(id, targetId) {
  await db.transaction('rw', db.columns, db.cards, async () => {
    const cards = (await db.cards.filter((c) => alive(c) && c.columnId === id).toArray())
      .sort((a, b) => a.position - b.position);
    let position = maxPosition(await db.cards.filter((c) => c.columnId === targetId).toArray());
    for (const c of cards) await update('card', c.id, { columnId: targetId, position: ++position });
    await update('column', id, { deleted: true });
  });
  requestSync();
}

// ---- folders ----

const siblingsOf = (folders, parentId) => folders.filter((f) => (f.parentId ?? null) === parentId);

/**
 * New folder under `parentId` (null: a root, which needs its own `columnSetId`; a child without one takes
 * its ancestor's). Returns its id.
 */
export async function createFolder(name, { parentId = null, columnSetId = null } = {}) {
  const siblings = siblingsOf(await db.folders.toArray(), parentId);
  const folder = await insert('folder', {
    parentId,
    columnSetId: parentId ? columnSetId : columnSetId ?? DEFAULT_SET_ID,
    name,
    hidden: false,
    position: maxPosition(siblings) + 1,
  });
  requestSync();
  return folder.id;
}

export async function renameFolder(id, name) {
  await update('folder', id, { name });
  requestSync();
}

/** Swaps the folder with its neighbour among the folders of the same parent; `direction` is -1 (up) or 1 (down). */
export async function reorderFolder(id, direction) {
  await db.transaction('rw', db.folders, async () => {
    const folders = await liveFolderList();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const siblings = siblingsOf(folders, folder.parentId ?? null)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const index = siblings.findIndex((f) => f.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    // Renumbered rather than swapped: older folders may share a position.
    for (const [i, f] of siblings.entries()) {
      if (f.position !== i + 1) await update('folder', f.id, { position: i + 1 });
    }
  });
  requestSync();
}

/**
 * Moves the folder with everything in it under `parentId` (null: to the top level). A folder that takes
 * its column set from its ancestors may get another one there: with `keepColumns` it keeps the old set,
 * otherwise its cards (and those of the subfolders taking the set from it) move to the columns of the
 * new set with the same names.
 */
export async function moveFolder(id, parentId, { keepColumns = true } = {}) {
  await db.transaction('rw', db.folders, db.cards, db.columns, db.columnSets, async () => {
    const folders = await liveFolderList();
    const folder = folders.find((f) => f.id === id);
    if (!folder || (folder.parentId ?? null) === parentId) return;
    if (parentId && (!folders.some((f) => f.id === parentId) || parentId === id
      || descendants(folders, id).some((f) => f.id === parentId))) {
      throw new Error('Папку нельзя перенести в неё саму или во вложенную в неё');
    }
    const patch = { parentId, position: maxPosition(siblingsOf(folders, parentId)) + 1 };
    if (!folder.columnSetId) {
      const before = folderColumnSetId(folder, folders);
      const moved = folders.map((f) => (f.id === id ? { ...f, parentId } : f));
      const after = folderColumnSetId(moved.find((f) => f.id === id), moved);
      if (after !== before) {
        if (keepColumns) {
          patch.columnSetId = before;
        } else {
          const columnFor = await columnMatcher();
          for (const c of await cardsOfGroup(inheritingFolders(folder, folders))) {
            const columnId = columnFor(c.columnId, after);
            if (columnId !== c.columnId) await update('card', c.id, { columnId, position: await arrivalPosition(columnId, c.id) });
          }
        }
      }
    }
    await update('folder', id, patch);
  });
  requestSync();
}

/** What deleting the folder touches: its own cards, the cards below it and the number of subfolders. */
export async function folderStats(id) {
  const folders = await liveFolderList();
  const folder = folders.find((f) => f.id === id);
  const below = folder ? descendants(folders, id) : [];
  return {
    cards: (await cardsIn(id)).length,
    subCards: (await cardsOfGroup(below)).length,
    folders: below.length,
  };
}

/**
 * Deletes the folder. By default its subfolders and all the cards in them are deleted too. With
 * `keepCards` the subfolders move to the folder's parent and the folder's own cards to the folder
 * `targetId` (required if it has cards).
 */
export async function deleteFolder(id, { keepCards = false, targetId = null } = {}) {
  await db.transaction('rw', db.folders, db.cards, db.columns, db.columnSets, async () => {
    const folders = await liveFolderList();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    const below = descendants(folders, id);

    if (!keepCards) {
      for (const f of [folder, ...below]) {
        for (const c of await cardsIn(f.id)) await update('card', c.id, { deleted: true });
        await update('folder', f.id, { deleted: true });
      }
      return;
    }

    const own = await cardsIn(id);
    const target = folders.find((f) => f.id === targetId && f.id !== id);
    if (own.length && !target) throw new Error('Выберите папку для карточек');

    // Subfolders go up a level; those taking their column set from the folder keep the one they have.
    const tree = folderTree(folders);
    const parentId = tree.parentOf(folder);
    const children = tree.children.get(id) ?? [];
    const after = folders.filter((f) => f.id !== id).map((f) => (children.includes(f) ? { ...f, parentId } : f));
    let position = maxPosition(siblingsOf(folders, parentId));
    for (const child of children) {
      const patch = { parentId, position: ++position };
      if (!child.columnSetId) {
        const before = folderColumnSetId(child, folders);
        if (folderColumnSetId(after.find((f) => f.id === child.id), after) !== before) patch.columnSetId = before;
      }
      await update('folder', child.id, patch);
    }

    if (own.length) {
      const columnFor = await columnMatcher();
      const setId = folderColumnSetId(after.find((f) => f.id === target.id), after);
      for (const c of own) {
        const columnId = columnFor(c.columnId, setId);
        await update('card', c.id, {
          folderId: target.id,
          ...(columnId !== c.columnId && { columnId, position: await arrivalPosition(columnId, c.id) }),
        });
      }
    }
    await update('folder', id, { deleted: true });
  });
  requestSync();
}

/** Maps a card's column to the best match in the column set `setId` (same id, same name, or the first). */
async function columnMatcher() {
  const model = columnModel(await db.columnSets.toArray(), await db.columns.toArray(), []);
  return (columnId, setId) => {
    const from = model.columns.find((c) => c.id === columnId);
    return matchColumn(from, model.columnsOf(setId))?.id ?? columnId;
  };
}

// ---- cards ----

// Card order is one per column across all folders, so filtered views show the same
// relative order as the combined one.
/** Where a card added to the column goes: first or last, as the column is set up. */
async function arrivalPosition(columnId, cardId = null) {
  const cards = (await db.cards.filter((c) => c.columnId === columnId && c.id !== cardId).toArray()).filter(alive);
  const column = await db.columns.get(columnId) ?? DEFAULT_COLUMNS.find((c) => c.id === columnId);
  if (!column?.addToTop) return cards.reduce((max, c) => Math.max(max, c.position), 0) + 1;
  return cards.reduce((min, c) => Math.min(min, c.position), 1) - 1;
}

export async function createCard({ folderId }, columnId, title, description = '', reminders = []) {
  await insert('card', {
    folderId,
    columnId,
    title,
    description,
    remindAt: null,
    reminders,
    attachments: [],
    position: await arrivalPosition(columnId),
  });
  requestSync();
}

export async function updateCard(id, patch, base = null) {
  await db.transaction('rw', db.cards, () => update('card', id, patch, base));
  requestSync();
}

export function deleteCard(id) {
  return updateCard(id, { deleted: true });
}

export function moveCard(id, columnId, position) {
  return updateCard(id, { columnId, position });
}

/** Moves the card to another column, first or last as that column is set up. */
export async function moveCardToColumn(id, columnId) {
  return moveCard(id, columnId, await arrivalPosition(columnId, id));
}

/** Moves the cards (`ids`, in their order) to another column, keeping that order. */
export async function moveCardsToColumn(ids, columnId) {
  await db.transaction('rw', db.cards, db.columns, async () => {
    const column = await db.columns.get(columnId) ?? DEFAULT_COLUMNS.find((c) => c.id === columnId);
    const order = column?.addToTop ? [...ids].reverse() : ids;
    for (const id of order) await update('card', id, { columnId, position: await arrivalPosition(columnId, id) });
  });
  requestSync();
}

/** Moves the card to another folder; the caller picks the column when that folder uses another set. */
export async function moveCardToFolder(id, folderId) {
  const card = await db.cards.get(id);
  if (!card || card.folderId === folderId) return;
  return updateCard(id, { folderId });
}

// ---- comments and folder chats ----

/**
 * A comment on the card `cardId`, or with cardId null a message of the chat of the folder `folderId`.
 * `author` is the signed-in user; the server sets the author fields itself, these show
 * until it answers.
 */
export async function addComment({ cardId = null, folderId = null }, text, author) {
  await insert('comment', {
    cardId,
    folderId,
    text,
    authorId: author?.id ?? '',
    authorName: author?.name || author?.email || '',
    authorPicture: author?.picture ?? '',
    createdAt: Date.now(),
    editedAt: null,
    event: '',
  });
  requestSync();
}

export async function editComment(id, text) {
  await db.transaction('rw', db.comments, () => update('comment', id, { text, editedAt: Date.now() }));
  requestSync();
}

export async function deleteComment(id) {
  await db.transaction('rw', db.comments, () => update('comment', id, { deleted: true, text: '' }));
  requestSync();
}

/** `resolution` is a set of field values to apply; the conflict is cleared. */
export async function resolveConflict(id, resolution) {
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(id);
    if (!card) return;
    const next = { ...card, ...resolution, conflict: null };
    next.dirty = isDirty('card', next);
    await db.cards.put(next);
  });
  requestSync();
}

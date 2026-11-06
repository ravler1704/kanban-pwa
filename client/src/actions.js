import {
  db, DEFAULT_COLUMNS, DEFAULT_SET_ID, INBOX_ID, isDirty, newId, pickFields, tableOf, TYPES,
} from './db.js';
import { columnModel, matchColumn } from './columnSets.js';
import { descendants, folderColumnSetId, folderTree, inheritingFolders, liveFolders } from './folders.js';
import { authState } from './auth.js';
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
      await insert('column', { setId: id, name: c.name, position: c.position, addToTop: !!c.addToTop, color: c.color ?? null });
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
    if (folders.some((f) => folderColumnSetId(f, folders) === id)) throw new Error('Набор используется досками');
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

/** A new column at `index` (0: first) of the set. */
export async function insertColumn(setId, name, index) {
  await db.transaction('rw', db.columns, async () => {
    const columns = await liveColumns(setId);
    const at = Math.max(0, Math.min(index, columns.length));
    for (const [i, c] of columns.entries()) {
      const position = i < at ? i + 1 : i + 2;
      if (c.position !== position) await update('column', c.id, { position });
    }
    await insert('column', { setId, name, position: at + 1, addToTop: false });
  });
  requestSync();
}

export async function renameColumn(id, name) {
  await update('column', id, { name });
  requestSync();
}

/** `color`: an id of CARD_COLORS, or null. */
export async function setColumnColor(id, color) {
  await update('column', id, { color });
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

/** Puts the column at `index` among its set's columns (counted without it). */
export async function moveColumnTo(id, index) {
  await db.transaction('rw', db.columns, async () => {
    const column = await db.columns.get(id);
    if (!column) return;
    const others = (await liveColumns(setOfColumn(column))).filter((c) => c.id !== id);
    const order = [...others.slice(0, index), column, ...others.slice(index)];
    for (const [i, c] of order.entries()) {
      if (c.position !== i + 1) await update('column', c.id, { position: i + 1 });
    }
  });
  requestSync();
}

const resolveRow = (rows, ids, key) => ids.get(key) ?? ids.get(rows[0].key);

/**
 * Applies edited columns to the set itself, so every folder using it gets them. `rows` are
 * { key, id (null: new), name, addToTop } in their new order; `moves` maps each removed column id
 * to the key of the row its cards go to.
 */
export async function editColumnSet(setId, rows, moves) {
  await db.transaction('rw', db.columns, db.cards, async () => {
    const ids = new Map();
    for (const [i, r] of rows.entries()) {
      if (r.id) {
        ids.set(r.key, r.id);
        await update('column', r.id, { name: r.name, addToTop: !!r.addToTop, position: i + 1 });
      } else {
        const c = await insert('column', { setId, name: r.name, position: i + 1, addToTop: !!r.addToTop });
        ids.set(r.key, c.id);
      }
    }
    const kept = new Set(ids.values());
    for (const c of await liveColumns(setId)) {
      if (kept.has(c.id)) continue;
      const targetId = resolveRow(rows, ids, moves[c.id]);
      const cards = (await db.cards.filter((x) => alive(x) && x.columnId === c.id).toArray())
        .sort((a, b) => a.position - b.position);
      let position = maxPosition(await db.cards.filter((x) => x.columnId === targetId).toArray());
      for (const card of cards) await update('card', card.id, { columnId: targetId, position: ++position });
      await update('column', c.id, { deleted: true });
    }
  });
  requestSync();
}

/**
 * A new set named `name` with the edited columns (as in editColumnSet) for the folder and the subfolders
 * that take its set; `fromSetId` stays as it is for the other folders.
 */
export async function forkColumnSet(folderId, name, fromSetId, rows, moves) {
  let setId;
  const mapping = {};
  await db.transaction('rw', db.columnSets, db.columns, async () => {
    const set = await insert('columnSet', { name, position: maxPosition(await db.columnSets.toArray()) + 1 });
    setId = set.id;
    const ids = new Map();
    for (const [i, r] of rows.entries()) {
      const c = await insert('column', { setId, name: r.name, position: i + 1, addToTop: !!r.addToTop });
      ids.set(r.key, c.id);
      if (r.id) mapping[r.id] = c.id;
    }
    for (const c of await liveColumns(fromSetId)) {
      if (!mapping[c.id]) mapping[c.id] = resolveRow(rows, ids, moves[c.id]);
    }
  });
  await changeFolderColumnSet(folderId, setId, mapping);
  return setId;
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

/** `background`: an id of BOARD_BACKGROUNDS, 'none', or null (the parent's). */
export async function setFolderBackground(id, background) {
  await update('folder', id, { background });
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
      throw new Error('Доску нельзя перенести в неё саму или во вложенную в неё');
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
    if (own.length && !target) throw new Error('Выберите доску для карточек');

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

export async function createCard(
  { folderId }, columnId, title, description = '', reminders = [],
  { authorId = null, assigneeId = null, checklist = [], color = null } = {},
) {
  await insert('card', {
    color,
    folderId,
    columnId,
    title,
    description,
    remindAt: null,
    reminders,
    authorId: authorId ?? authState.get().user?.id ?? null,
    assigneeId,
    attachments: [],
    checklist,
    position: await arrivalPosition(columnId),
  });
  requestSync();
}

/** A card in «Входящие», last in it; its column is the first of the default set, kept for when it goes to a board. */
export async function createInboxCard(title) {
  const model = columnModel(await db.columnSets.toArray(), await db.columns.toArray(), []);
  const columnId = model.columnsOfFolder(INBOX_ID)[0]?.id ?? DEFAULT_COLUMNS[0].id;
  const inbox = (await db.cards.where('folderId').equals(INBOX_ID).toArray()).filter(alive);
  await insert('card', {
    folderId: INBOX_ID,
    columnId,
    title,
    description: '',
    remindAt: null,
    reminders: [],
    authorId: authState.get().user?.id ?? null,
    assigneeId: null,
    attachments: [],
    checklist: [],
    position: inbox.reduce((max, c) => Math.max(max, c.position), 0) + 1,
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

/** With `folderId` the card goes to that folder too (from «Входящие»). */
export function moveCard(id, columnId, position, folderId = null) {
  return updateCard(id, folderId ? { folderId, columnId, position } : { columnId, position });
}

/** Moves the card to another column, first or last as that column is set up. */
export async function moveCardToColumn(id, columnId) {
  return moveCard(id, columnId, await arrivalPosition(columnId, id));
}

/** Moves the card to the top (`top`) or the bottom of its column. */
export async function moveCardToEdge(id, top) {
  const card = await db.cards.get(id);
  if (!card) return;
  const others = (await db.cards.filter((c) => c.columnId === card.columnId && c.id !== id).toArray()).filter(alive);
  if (!others.length) return;
  const position = top
    ? Math.min(...others.map((c) => c.position)) - 1
    : Math.max(...others.map((c) => c.position)) + 1;
  await moveCard(id, card.columnId, position);
}

/** A new card with the title, description, reminders and assignee of the card `id`, in its column. */
export async function duplicateCard(id) {
  const card = await db.cards.get(id);
  if (!card) return;
  await createCard({ folderId: card.folderId }, card.columnId, card.title, card.description ?? '',
    card.reminders ?? [], { assigneeId: card.assigneeId ?? null, checklist: card.checklist ?? [], color: card.color ?? null });
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

/**
 * Moves the card to the folder and column, first or last as the column is set up; into «Входящие» it goes last.
 * Without `columnId`, the column like the card's present one (in «Входящие», that very one).
 */
export async function moveCardTo(id, folderId, columnId = null) {
  const card = await db.cards.get(id);
  if (!card) return;
  if (!columnId && folderId === INBOX_ID) columnId = card.columnId;
  if (!columnId) {
    const folders = liveFolders(await db.folders.toArray(), { standIn: false });
    const model = columnModel(await db.columnSets.toArray(), await db.columns.toArray(), folders);
    const from = model.columns.find((c) => c.id === card.columnId);
    columnId = matchColumn(from, model.columnsOfFolder(folderId))?.id ?? card.columnId;
  }
  const position = folderId === INBOX_ID
    ? (await db.cards.where('folderId').equals(INBOX_ID).toArray()).filter((c) => alive(c) && c.id !== id)
      .reduce((max, c) => Math.max(max, c.position), 0) + 1
    : await arrivalPosition(columnId, id);
  return updateCard(id, { folderId, columnId, position });
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

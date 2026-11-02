import {
  db, DEFAULT_COLUMNS, DEFAULT_SET_ID, DEFAULT_SPACE_ID, isDirty, newId, pickFields, tableOf, TYPES,
} from './db.js';
import { columnModel, matchColumn } from './columnSets.js';
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

/** Live cards of a project that are in `sectionId` (null = cards without a section). */
async function cardsIn(projectId, sectionId) {
  const cards = await db.cards.where('projectId').equals(projectId).toArray();
  return cards.filter((c) => alive(c) && c.sectionId === sectionId);
}

// ---- column sets ----

const setOfColumn = (c) => c.setId ?? DEFAULT_SET_ID;
const setOfProject = (p) => p.columnSetId ?? DEFAULT_SET_ID;

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

/** Only sets no project uses can be deleted; their columns go with them. */
export async function deleteColumnSet(id) {
  await db.transaction('rw', db.columnSets, db.columns, db.projects, async () => {
    const used = (await db.projects.toArray()).some((p) => alive(p) && setOfProject(p) === id);
    if (used) throw new Error('Набор используется досками');
    for (const c of await liveColumns(id)) await update('column', c.id, { deleted: true });
    await update('columnSet', id, { deleted: true });
  });
  requestSync();
}

/**
 * Switches the project to another column set. `mapping` maps each old column id to a
 * column of the new set; cards in columns missing from it go to the first new column.
 */
export async function changeProjectColumnSet(projectId, setId, mapping) {
  await db.transaction('rw', db.projects, db.columns, db.cards, async () => {
    const target = await liveColumns(setId);
    if (!target.length) throw new Error('В наборе нет колонок');
    const cards = (await db.cards.where('projectId').equals(projectId).toArray()).filter(alive);
    for (const c of cards) {
      const columnId = mapping[c.columnId] ?? target[0].id;
      if (columnId !== c.columnId) await update('card', c.id, { columnId });
    }
    await update('project', projectId, { columnSetId: setId });
  });
  requestSync();
}

export async function countProjectCards(projectId) {
  return (await db.cards.where('projectId').equals(projectId).toArray()).filter(alive).length;
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

// ---- spaces ----

export const spaceOfProject = (p) => p.spaceId ?? DEFAULT_SPACE_ID;

export async function createSpace(name) {
  const space = await insert('space', { name, position: maxPosition(await db.spaces.toArray()) + 1 });
  requestSync();
  return space.id;
}

export async function renameSpace(id, name) {
  await update('space', id, { name });
  requestSync();
}

/** Swaps the space with its neighbour; `direction` is -1 (up) or 1 (down). */
export async function moveSpace(id, direction) {
  await db.transaction('rw', db.spaces, async () => {
    const spaces = (await db.spaces.toArray()).filter(alive)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const index = spaces.findIndex((s) => s.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= spaces.length) return;
    [spaces[index], spaces[target]] = [spaces[target], spaces[index]];
    for (const [i, s] of spaces.entries()) {
      if (s.position !== i + 1) await update('space', s.id, { position: i + 1 });
    }
  });
  requestSync();
}

/** Deletes the space; its projects move to `targetId`. The last space can't be deleted. */
export async function deleteSpace(id, targetId) {
  await db.transaction('rw', db.spaces, db.projects, async () => {
    const others = (await db.spaces.toArray()).filter((s) => alive(s) && s.id !== id);
    if (!others.some((s) => s.id === targetId)) throw new Error('Нужно другое пространство для его проектов');
    for (const p of await db.projects.toArray()) {
      if (alive(p) && spaceOfProject(p) === id) await update('project', p.id, { spaceId: targetId });
    }
    await update('space', id, { deleted: true });
  });
  requestSync();
}

// ---- projects ----

export async function createProject(name, columnSetId = DEFAULT_SET_ID, spaceId = DEFAULT_SPACE_ID) {
  const project = await insert('project', {
    name, spaceId, columnSetId, hidden: false, position: maxPosition(await db.projects.toArray()) + 1,
  });
  requestSync();
  return project.id;
}

export async function renameProject(id, name) {
  await update('project', id, { name });
  requestSync();
}

/**
 * Swaps the project with its neighbour; `direction` is -1 (up) or 1 (down). With `siblings` (ids) the
 * neighbour is the nearest of them, e.g. of the same space.
 */
export async function moveProject(id, direction, siblings = null) {
  await db.transaction('rw', db.projects, async () => {
    const projects = (await db.projects.toArray()).filter(alive)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const index = projects.findIndex((p) => p.id === id);
    let target = index + direction;
    while (siblings && target >= 0 && target < projects.length && !siblings.includes(projects[target].id)) {
      target += direction;
    }
    if (index < 0 || target < 0 || target >= projects.length) return;
    [projects[index], projects[target]] = [projects[target], projects[index]];
    // Renumbered rather than swapped: older projects may share a position.
    for (const [i, p] of projects.entries()) {
      if (p.position !== i + 1) await update('project', p.id, { position: i + 1 });
    }
  });
  requestSync();
}

export async function deleteProject(id) {
  await db.transaction('rw', db.projects, db.sections, db.cards, async () => {
    const cards = await db.cards.where('projectId').equals(id).toArray();
    for (const c of cards) if (alive(c)) await update('card', c.id, { deleted: true });
    const sections = await db.sections.where('projectId').equals(id).toArray();
    for (const s of sections) if (alive(s)) await update('section', s.id, { deleted: true });
    await update('project', id, { deleted: true });
  });
  requestSync();
}

// ---- sections ----

export function countCards(projectId, sectionId) {
  return cardsIn(projectId, sectionId).then((cards) => cards.length);
}

export async function createSection(projectId, name) {
  const siblings = await db.sections.where('projectId').equals(projectId).toArray();
  const section = await insert('section', { projectId, name, hidden: false, position: maxPosition(siblings) + 1 });
  requestSync();
  return section.id;
}

export async function renameSection(id, name) {
  await update('section', id, { name });
  requestSync();
}

/** `keepCards` moves the section's cards to the project itself instead of deleting them. */
export async function deleteSection(id, { keepCards }) {
  await db.transaction('rw', db.sections, db.cards, async () => {
    const section = await db.sections.get(id);
    if (!section) return;
    const patch = keepCards ? { sectionId: null } : { deleted: true };
    for (const c of await cardsIn(section.projectId, id)) await update('card', c.id, patch);
    await update('section', id, { deleted: true });
  });
  requestSync();
}

// ---- cards ----

// Card order is one per column across all projects and sections, so filtered views
// (a project, a section) show the same relative order as the combined one.
/** Where a card added to the column goes: first or last, as the column is set up. */
async function arrivalPosition(columnId, cardId = null) {
  const cards = (await db.cards.filter((c) => c.columnId === columnId && c.id !== cardId).toArray()).filter(alive);
  const column = await db.columns.get(columnId) ?? DEFAULT_COLUMNS.find((c) => c.id === columnId);
  if (!column?.addToTop) return cards.reduce((max, c) => Math.max(max, c.position), 0) + 1;
  return cards.reduce((min, c) => Math.min(min, c.position), 1) - 1;
}

export async function createCard({ projectId, sectionId }, columnId, title, description = '', remindAt = null) {
  await insert('card', {
    projectId,
    sectionId,
    columnId,
    title,
    description,
    remindAt,
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

/** Moves the card to another project and/or section (`sectionId` null for the project itself). */
export async function moveCardToGroup(id, { projectId, sectionId }) {
  const card = await db.cards.get(id);
  if (!card || (card.projectId === projectId && card.sectionId === sectionId)) return;
  return updateCard(id, { projectId, sectionId });
}

// ---- restructuring: spaces, projects and sections moved to another level ----

const RESTRUCTURE_TABLES = [db.spaces, db.projects, db.sections, db.cards, db.columns, db.columnSets];
const liveIn = async (table, index, value) => (await table.where(index).equals(value).toArray()).filter(alive);

/** Maps a card's column to the best match in the column set `setId` (same id, same name, or the first). */
async function columnMatcher() {
  const model = columnModel(await db.columnSets.toArray(), await db.columns.toArray(), []);
  return (columnId, setId) => {
    const from = model.columns.find((c) => c.id === columnId);
    return matchColumn(from, model.columnsOf(setId))?.id ?? columnId;
  };
}

/** Moves the cards into the project `projectId` (column set `setId`) and `sectionId`. */
async function moveCardsInto(cards, { projectId, sectionId }, setId, columnFor) {
  for (const c of cards) {
    const columnId = columnFor(c.columnId, setId);
    await update('card', c.id, {
      projectId,
      sectionId,
      ...(columnId !== c.columnId && { columnId, position: await arrivalPosition(columnId, c.id) }),
    });
  }
}

const setOfProjectId = async (projectId) => setOfProject(await db.projects.get(projectId));

async function newSpace(name) {
  return (await insert('space', { name, position: maxPosition(await db.spaces.toArray()) + 1 })).id;
}

async function newProject(name, spaceId, columnSetId) {
  const position = maxPosition(await db.projects.toArray()) + 1;
  return (await insert('project', { name, spaceId, columnSetId, hidden: false, position })).id;
}

async function newSection(projectId, name) {
  const position = maxPosition(await db.sections.where('projectId').equals(projectId).toArray()) + 1;
  return (await insert('section', { projectId, name, hidden: false, position })).id;
}

/** The section moves to another project with its cards. */
async function sectionIntoProject(sectionId, projectId, columnFor, name) {
  const section = await db.sections.get(sectionId);
  if (!section || section.projectId === projectId) return;
  const cards = await cardsIn(section.projectId, sectionId);
  const position = maxPosition(await db.sections.where('projectId').equals(projectId).toArray()) + 1;
  await update('section', sectionId, { projectId, position, ...(name && { name }) });
  await moveCardsInto(cards, { projectId, sectionId }, await setOfProjectId(projectId), columnFor);
}

/** The section becomes a project of the space; its cards go to the project itself. */
async function sectionIntoSpace(sectionId, spaceId, columnFor) {
  const section = await db.sections.get(sectionId);
  if (!section) return;
  const setId = await setOfProjectId(section.projectId);
  const projectId = await newProject(section.name, spaceId, setId);
  await moveCardsInto(await cardsIn(section.projectId, sectionId), { projectId, sectionId: null }, setId, columnFor);
  await update('section', sectionId, { deleted: true });
}

/**
 * The project becomes a section of another one: its own cards go to a section named after it,
 * its sections follow as «Project / Section».
 */
async function projectIntoProject(projectId, targetId, columnFor) {
  const project = await db.projects.get(projectId);
  if (!project || projectId === targetId) return;
  const setId = await setOfProjectId(targetId);
  const own = await cardsIn(projectId, null);
  if (own.length) {
    const sectionId = await newSection(targetId, project.name);
    await moveCardsInto(own, { projectId: targetId, sectionId }, setId, columnFor);
  }
  for (const s of await liveIn(db.sections, 'projectId', projectId)) {
    await sectionIntoProject(s.id, targetId, columnFor, `${project.name} / ${s.name}`);
  }
  await update('project', projectId, { deleted: true });
}

/** Moves the section (`kind` 'section'), project or space: `to` is { top: true }, { spaceId } or { projectId }. */
export async function restructure(kind, id, to) {
  await db.transaction('rw', RESTRUCTURE_TABLES, async () => {
    const columnFor = await columnMatcher();
    if (kind === 'section') {
      if (to.projectId) await sectionIntoProject(id, to.projectId, columnFor);
      else {
        const section = await db.sections.get(id);
        await sectionIntoSpace(id, to.spaceId ?? await newSpace(section.name), columnFor);
      }
    } else if (kind === 'project') {
      if (to.projectId) await projectIntoProject(id, to.projectId, columnFor);
      else if (to.spaceId) await update('project', id, { spaceId: to.spaceId });
      else {
        // A space named after the project: the project goes there and its sections become projects beside it.
        const project = await db.projects.get(id);
        const spaceId = await newSpace(project.name);
        await update('project', id, { spaceId });
        for (const s of await liveIn(db.sections, 'projectId', id)) await sectionIntoSpace(s.id, spaceId, columnFor);
      }
    } else if (kind === 'space') {
      const projects = (await db.projects.toArray()).filter((p) => alive(p) && spaceOfProject(p) === id);
      for (const p of projects) {
        if (to.projectId) await projectIntoProject(p.id, to.projectId, columnFor);
        else await update('project', p.id, { spaceId: to.spaceId });
      }
      await update('space', id, { deleted: true });
    }
  });
  requestSync();
}

// ---- comments and project chats ----

/**
 * A comment on the card `cardId`, or with cardId null a message of the chat of `projectId` or
 * `spaceId`. `author` is the signed-in user; the server sets the author fields itself, these show
 * until it answers.
 */
export async function addComment({ cardId = null, projectId = null, spaceId = null }, text, author) {
  await insert('comment', {
    cardId,
    projectId,
    spaceId,
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

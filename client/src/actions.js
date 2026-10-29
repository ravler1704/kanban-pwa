import { db, DEFAULT_SET_ID, isDirty, newId, pickFields, tableOf, TYPES } from './db.js';
import { requestSync } from './sync.js';

const alive = (r) => !r.deleted;
const maxPosition = (records) => records.filter(alive).reduce((max, r) => Math.max(max, r.position), 0);

async function insert(type, fields) {
  const record = { id: newId(), ...fields, deleted: false, server: null, conflict: null };
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
      await insert('column', { setId: id, name: c.name, position: c.position });
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

// ---- columns ----

export async function createColumn(setId, name) {
  await insert('column', { setId, name, position: maxPosition(await liveColumns(setId)) + 1 });
  requestSync();
}

export async function renameColumn(id, name) {
  await update('column', id, { name });
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

// ---- projects ----

export async function createProject(name, columnSetId = DEFAULT_SET_ID) {
  const project = await insert('project', {
    name, columnSetId, position: maxPosition(await db.projects.toArray()) + 1,
  });
  requestSync();
  return project.id;
}

export async function renameProject(id, name) {
  await update('project', id, { name });
  requestSync();
}

/** Swaps the project with its neighbour; `direction` is -1 (up) or 1 (down). */
export async function moveProject(id, direction) {
  await db.transaction('rw', db.projects, async () => {
    const projects = (await db.projects.toArray()).filter(alive)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const index = projects.findIndex((p) => p.id === id);
    const target = index + direction;
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
  const section = await insert('section', { projectId, name, position: maxPosition(siblings) + 1 });
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
async function lastCardPosition(columnId) {
  return maxPosition(await db.cards.filter((c) => c.columnId === columnId).toArray());
}

export async function createCard({ projectId, sectionId }, columnId, title, description = '', remindAt = null) {
  await insert('card', {
    projectId,
    sectionId,
    columnId,
    title,
    description,
    remindAt,
    position: (await lastCardPosition(columnId)) + 1,
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

export async function moveCardToEnd(id, columnId) {
  return moveCard(id, columnId, (await lastCardPosition(columnId)) + 1);
}

/** Moves the card to another project and/or section (`sectionId` null for the project itself). */
export async function moveCardToGroup(id, { projectId, sectionId }) {
  const card = await db.cards.get(id);
  if (!card || (card.projectId === projectId && card.sectionId === sectionId)) return;
  return updateCard(id, { projectId, sectionId });
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

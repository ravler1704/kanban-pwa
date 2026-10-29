import Dexie from 'dexie';
import { dbName } from './board.js';

/**
 * Every synced record (project, section, card) stores:
 *   ...fields   — current local values
 *   server      — last state confirmed by the server (null if never synced)
 *   dirty       — 1 when local values differ from `server` (IndexedDB can't index booleans)
 *   conflict    — { fields: { [field]: { mine, theirs } }, local: {...} } or null
 */
export const db = new Dexie(dbName);

db.version(1).stores({
  cards: 'id, columnId, dirty',
  meta: 'key',
});

db.version(2).stores({
  projects: 'id, dirty',
  sections: 'id, projectId, dirty',
  cards: 'id, sectionId, columnId, dirty',
  meta: 'key',
});

// v3: cards belong to a project, the section is optional. Earlier data was discarded.
db.version(3)
  .stores({
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, projectId, sectionId, dirty',
    meta: 'key',
  })
  .upgrade((tx) => Promise.all(['projects', 'sections', 'cards', 'meta'].map((t) => tx.table(t).clear())));

// v4: editable board columns.
db.version(4).stores({
  columns: 'id, dirty',
  projects: 'id, dirty',
  sections: 'id, projectId, dirty',
  cards: 'id, projectId, sectionId, dirty',
  meta: 'key',
});

// v5: column sets. Columns and projects synced before them belong to the default set.
export const DEFAULT_SET_ID = 'default';

db.version(5)
  .stores({
    columnSets: 'id, dirty',
    columns: 'id, dirty',
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, projectId, sectionId, dirty',
    meta: 'key',
  })
  .upgrade((tx) => Promise.all([
    tx.table('columns').toCollection().modify((c) => {
      c.setId ??= DEFAULT_SET_ID;
      if (c.server) c.server.setId ??= DEFAULT_SET_ID;
    }),
    tx.table('projects').toCollection().modify((p) => {
      p.columnSetId ??= DEFAULT_SET_ID;
      if (p.server) p.server.columnSetId ??= DEFAULT_SET_ID;
    }),
  ]));

// v6: hidden projects. The server rejects null for the flag, so older records get false.
db.version(6)
  .stores({
    columnSets: 'id, dirty',
    columns: 'id, dirty',
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, projectId, sectionId, dirty',
    meta: 'key',
  })
  .upgrade((tx) => tx.table('projects').toCollection().modify((p) => {
    p.hidden ??= false;
    if (p.server) p.server.hidden ??= false;
  }));

// Push order matters: parents are created on the server before their children.
export const TYPES = {
  columnSet: { table: 'columnSets', fields: ['name', 'position', 'deleted'] },
  column: { table: 'columns', fields: ['setId', 'name', 'position', 'deleted'] },
  // hidden: its cards are left out of the «all projects» view.
  project: { table: 'projects', fields: ['columnSetId', 'name', 'position', 'deleted', 'hidden'] },
  section: { table: 'sections', fields: ['projectId', 'name', 'position', 'deleted'] },
  card: {
    table: 'cards',
    // sectionId is null for cards that belong to the project directly.
    // remindAt: Unix time in ms of the push reminder, or null.
    fields: ['projectId', 'sectionId', 'columnId', 'title', 'description', 'position', 'deleted', 'remindAt'],
  },
};

export async function clearLocalData() {
  const tables = [db.columnSets, db.columns, db.projects, db.sections, db.cards, db.meta];
  await db.transaction('rw', tables, () => Promise.all(tables.map((t) => t.clear())));
}

// New projects get this set while it exists.
export const SIMPLE_SET_ID = 'simple';

// Same ids as the sets and columns the server creates, so cards added before the first sync land in them.
export const DEFAULT_COLUMNS = [
  ...[
    { id: 'simple-todo', name: 'Запланировано', position: 1 },
    { id: 'simple-doing', name: 'В работе', position: 2 },
    { id: 'simple-done', name: 'Завершено', position: 3 },
  ].map((c) => ({ ...c, setId: SIMPLE_SET_ID })),
  ...[
    { id: 'backlog', name: 'Входящие', position: 1 },
    { id: 'todo', name: 'Запланировано', position: 2 },
    { id: 'doing', name: 'В работе', position: 3 },
    { id: 'review', name: 'На проверке', position: 4 },
    { id: 'done', name: 'Завершено', position: 5 },
  ].map((c) => ({ ...c, setId: DEFAULT_SET_ID })),
];
export const DEFAULT_SETS = [
  { id: SIMPLE_SET_ID, name: '3 колонки', position: 1 },
  { id: DEFAULT_SET_ID, name: '5 колонок', position: 2 },
];

export function tableOf(type) {
  return db.table(TYPES[type].table);
}

// Records saved before a field existed lack it; treat a missing value as null.
export const sameValue = (a, b) => (a ?? null) === (b ?? null);

export function pickFields(type, source) {
  const out = {};
  for (const f of TYPES[type].fields) out[f] = source[f] ?? null;
  return out;
}

export function isDirty(type, record) {
  if (!record.server) return 1;
  return TYPES[type].fields.some((f) => !sameValue(record[f], record.server[f])) ? 1 : 0;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = newId();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

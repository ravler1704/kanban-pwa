import Dexie from 'dexie';

/**
 * Every synced record (project, section, card) stores:
 *   ...fields   — current local values
 *   server      — last state confirmed by the server (null if never synced)
 *   dirty       — 1 when local values differ from `server` (IndexedDB can't index booleans)
 *   conflict    — { fields: { [field]: { mine, theirs } }, local: {...} } or null
 */
export const db = new Dexie('kanban');

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

// Push order matters: parents are created on the server before their children.
export const TYPES = {
  column: { table: 'columns', fields: ['name', 'position', 'deleted'] },
  project: { table: 'projects', fields: ['name', 'position', 'deleted'] },
  section: { table: 'sections', fields: ['projectId', 'name', 'position', 'deleted'] },
  card: {
    table: 'cards',
    // sectionId is null for cards that belong to the project directly.
    fields: ['projectId', 'sectionId', 'columnId', 'title', 'description', 'position', 'deleted'],
  },
};

export async function clearLocalData() {
  const tables = [db.columns, db.projects, db.sections, db.cards, db.meta];
  await db.transaction('rw', tables, () => Promise.all(tables.map((t) => t.clear())));
}

// Same ids as the columns the server creates, so cards added before the first sync land in them.
export const DEFAULT_COLUMNS = [
  { id: 'backlog', name: 'Входящие', position: 1 },
  { id: 'todo', name: 'Запланировано', position: 2 },
  { id: 'doing', name: 'В работе', position: 3 },
  { id: 'review', name: 'На проверке', position: 4 },
  { id: 'done', name: 'Завершено', position: 5 },
];

export function tableOf(type) {
  return db.table(TYPES[type].table);
}

export function pickFields(type, source) {
  const out = {};
  for (const f of TYPES[type].fields) out[f] = source[f];
  return out;
}

export function isDirty(type, record) {
  if (!record.server) return 1;
  return TYPES[type].fields.some((f) => record[f] !== record.server[f]) ? 1 : 0;
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

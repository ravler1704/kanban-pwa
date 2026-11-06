import Dexie from 'dexie';
import { dbName, inboxId } from './board.js';

/**
 * Every synced record (folder, card, comment, column set, column) stores:
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

// v6: the `hidden` flag of projects. The server rejects null for it, so older records get false.
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

// v7: the same flag for sections.
db.version(7)
  .stores({
    columnSets: 'id, dirty',
    columns: 'id, dirty',
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, projectId, sectionId, dirty',
    meta: 'key',
  })
  .upgrade((tx) => tx.table('sections').toCollection().modify((s) => {
    s.hidden ??= false;
    if (s.server) s.server.hidden ??= false;
  }));

// v8: where cards added to a column go.
db.version(8)
  .stores({
    columnSets: 'id, dirty',
    columns: 'id, dirty',
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, projectId, sectionId, dirty',
    meta: 'key',
  })
  .upgrade((tx) => tx.table('columns').toCollection().modify((c) => {
    c.addToTop ??= false;
    if (c.server) c.server.addToTop ??= false;
  }));

// v9: files attached to cards.
db.version(9)
  .stores({
    columnSets: 'id, dirty',
    columns: 'id, dirty',
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, projectId, sectionId, dirty',
    meta: 'key',
  })
  .upgrade((tx) => tx.table('cards').toCollection().modify((c) => {
    c.attachments ??= [];
    if (c.server) c.server.attachments ??= [];
  }));

// v10: comments on cards and messages of project chats.
db.version(10).stores({
  columnSets: 'id, dirty',
  columns: 'id, dirty',
  projects: 'id, dirty',
  sections: 'id, projectId, dirty',
  cards: 'id, projectId, sectionId, dirty',
  comments: 'id, cardId, projectId, dirty',
  meta: 'key',
});

// v11: spaces, the top level of the board. Projects synced before them are in «Личное».
export const DEFAULT_FOLDER_ID = 'personal';
// «Входящие»: cards dumped there quickly, not on any board yet. No folder record has this id, so the cards
// stay out of boards, filters and sharing; the server knows the id too (on someone else's space it is the user's own).
export const INBOX_ID = inboxId;

db.version(11)
  .stores({
    spaces: 'id, dirty',
    columnSets: 'id, dirty',
    columns: 'id, dirty',
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, projectId, sectionId, dirty',
    comments: 'id, cardId, projectId, dirty',
    meta: 'key',
  })
  .upgrade((tx) => tx.table('projects').toCollection().modify((p) => {
    p.spaceId ??= DEFAULT_FOLDER_ID;
    if (p.server) p.server.spaceId ??= DEFAULT_FOLDER_ID;
  }));

/**
 * The folder record made of an old space (parent null), project (parent: its space, keeps the column set)
 * or section (parent: its project). Ids stay the same as on the server, which converted the same way.
 */
function toFolder(record, parentOf, columnSetOf) {
  const fields = (r) => ({
    parentId: parentOf(r), columnSetId: columnSetOf(r), name: r.name ?? '', position: r.position ?? 0,
    deleted: !!r.deleted, hidden: !!r.hidden,
  });
  const { spaceId, projectId, ...rest } = record;
  const folder = { ...rest, ...fields(record) };
  if (record.server) {
    const { spaceId: s, projectId: p, ...server } = record.server;
    folder.server = { ...server, ...fields(record.server) };
  }
  return folder;
}

// v12: nested folders replace spaces, projects and sections; cards and comments point at a folder.
// The old tables stay in this version so the upgrade can read them and are dropped in v13.
db.version(12)
  .stores({
    folders: 'id, parentId, dirty',
    spaces: 'id, dirty',
    columnSets: 'id, dirty',
    columns: 'id, dirty',
    projects: 'id, dirty',
    sections: 'id, projectId, dirty',
    cards: 'id, folderId, dirty',
    comments: 'id, cardId, folderId, dirty',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    const folders = [];
    for (const s of await tx.table('spaces').toArray()) folders.push(toFolder(s, () => null, () => null));
    for (const p of await tx.table('projects').toArray()) {
      folders.push(toFolder(p, (r) => r.spaceId ?? DEFAULT_FOLDER_ID, (r) => r.columnSetId ?? DEFAULT_SET_ID));
    }
    for (const s of await tx.table('sections').toArray()) folders.push(toFolder(s, (r) => r.projectId, () => null));
    for (const f of folders) {
      const server = f.server ?? null;
      f.dirty = !server || FOLDER_FIELDS.some((k) => !sameValue(f[k], server[k])) ? 1 : 0;
    }
    await tx.table('folders').bulkPut(folders);

    // A card of a section lives in that folder, otherwise in the project's.
    await tx.table('cards').toCollection().modify((c) => {
      const folderOf = (r) => r.sectionId || r.projectId;
      c.folderId ??= folderOf(c);
      if (c.server) c.server.folderId ??= folderOf(c.server);
      for (const r of [c, c.server]) {
        if (r) {
          delete r.projectId;
          delete r.sectionId;
        }
      }
      if (c.server) c.dirty = CARD_FIELDS.some((k) => !sameValue(c[k], c.server[k])) ? 1 : 0;
    });
    await tx.table('comments').toCollection().modify((c) => {
      const folderOf = (r) => r.spaceId || r.projectId || null;
      c.folderId ??= folderOf(c);
      if (c.server) c.server.folderId ??= folderOf(c.server);
      for (const r of [c, c.server]) {
        if (r) {
          delete r.projectId;
          delete r.spaceId;
        }
      }
    });
    // The schema changed: the next pull starts over and brings the server's folders.
    await tx.table('meta').delete('schema');
  });

// v13: the old tables are gone.
db.version(13).stores({
  folders: 'id, parentId, dirty',
  spaces: null,
  columnSets: 'id, dirty',
  columns: 'id, dirty',
  projects: null,
  sections: null,
  cards: 'id, folderId, dirty',
  comments: 'id, cardId, folderId, dirty',
  meta: 'key',
});

// background (folder), color (card): ids of the presets in appearance.js.
const FOLDER_FIELDS = ['parentId', 'columnSetId', 'name', 'position', 'deleted', 'hidden', 'background'];
const CARD_FIELDS = ['folderId', 'columnId', 'title', 'description', 'position', 'deleted', 'remindAt', 'reminders', 'authorId', 'assigneeId',
  'attachments', 'checklist', 'number', 'color'];

// Push order matters: columns and sets before the folders that use them, folders before their cards.
// Folders among themselves go parents first (see sortFolders in sync.js).
export const TYPES = {
  columnSet: { table: 'columnSets', fields: ['name', 'position', 'deleted'] },
  column: { table: 'columns', fields: ['setId', 'name', 'position', 'deleted', 'addToTop'] },
  // Folders nest to any depth: parentId null is a root. columnSetId null: the set of the nearest
  // ancestor that has one (see folders.js). hidden: no longer set; read once to convert an older selection.
  folder: { table: 'folders', fields: FOLDER_FIELDS },
  card: {
    table: 'cards',
    // reminders: [{ at, repeat, off }] (see reminders.js); remindAt: the single reminder of older cards.
    // authorId, assigneeId: user ids of who made the card and who has it now (null: the author).
    // attachments: [{ id, name, size, type, addedAt }], changed by the server only (files.js).
    // checklist: subtasks [{ id, text, done }], in order.
    // number: #1, #2, … within the board, given by the server (null until the card is synced).
    fields: CARD_FIELDS,
  },
  // A comment on a card, or (cardId null) a message of the folder's chat. The server sets the author
  // fields and editedAt; `event` (JSON, see chatEvents.jsx) is the server's note of a change in the folder.
  comment: {
    table: 'comments',
    fields: ['cardId', 'folderId', 'text', 'authorId', 'authorName', 'authorPicture', 'createdAt', 'editedAt', 'deleted', 'event'],
  },
};

export async function clearLocalData() {
  const tables = [db.folders, db.columnSets, db.columns, db.cards, db.comments, db.meta];
  await db.transaction('rw', tables, () => Promise.all(tables.map((t) => t.clear())));
}

// New root folders get this set while it exists.
export const SIMPLE_SET_ID = 'simple';

// Same ids as the sets and columns the server creates, so cards added before the first sync land in them.
export const DEFAULT_COLUMNS = [
  ...[
    { id: 'simple-todo', name: 'Запланировано', position: 1 },
    { id: 'simple-doing', name: 'В работе', position: 2 },
    { id: 'simple-done', name: 'Завершено', position: 3, addToTop: true },
  ].map((c) => ({ addToTop: false, ...c, setId: SIMPLE_SET_ID })),
  ...[
    { id: 'backlog', name: 'Входящие', position: 1 },
    { id: 'todo', name: 'Запланировано', position: 2 },
    { id: 'doing', name: 'В работе', position: 3 },
    { id: 'review', name: 'На проверке', position: 4 },
    { id: 'done', name: 'Завершено', position: 5, addToTop: true },
  ].map((c) => ({ addToTop: false, ...c, setId: DEFAULT_SET_ID })),
];
export const DEFAULT_SETS = [
  { id: SIMPLE_SET_ID, name: '3 колонки', position: 1 },
  { id: DEFAULT_SET_ID, name: '5 колонок', position: 2 },
];

export function tableOf(type) {
  return db.table(TYPES[type].table);
}

// Records saved before a field existed lack it; treat a missing value as null.
// Lists (attachments) are copies after a round trip through IndexedDB: compared by content.
export const sameValue = (a, b) => (typeof a === 'object' && a && typeof b === 'object' && b
  ? JSON.stringify(a) === JSON.stringify(b)
  : (a ?? null) === (b ?? null));

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

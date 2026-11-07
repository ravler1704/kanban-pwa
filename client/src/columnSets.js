import { DEFAULT_COLUMNS, DEFAULT_SET_ID, DEFAULT_SETS, SIMPLE_SET_ID } from './db.js';
import { folderColumnSetId } from './folders.js';

const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);

/**
 * Live column sets and their columns. Until the first sync brings the server's data,
 * the default set and columns are used (same ids as on the server).
 * A folder takes the set of the nearest ancestor that has one; a set that is gone (deleted
 * on another device) falls back to the first set.
 * `folders` are the live folders (see folders.js).
 */
export function columnModel(rawSets, rawColumns, folders) {
  const liveSets = rawSets.filter((s) => !s.deleted).sort(byPosition);
  const sets = liveSets.length ? liveSets : DEFAULT_SETS;
  const setIds = new Set(sets.map((s) => s.id));
  const liveColumns = rawColumns.filter((c) => !c.deleted).map((c) => ({ ...c, setId: c.setId ?? DEFAULT_SET_ID }));
  const columns = (rawColumns.length ? liveColumns : [...DEFAULT_COLUMNS]).sort(byPosition);

  const columnsOf = (setId) => columns.filter((c) => c.setId === setId);
  const setIdOf = (folder) => {
    const id = folder ? folderColumnSetId(folder, folders) : DEFAULT_SET_ID;
    return setIds.has(id) ? id : sets[0].id;
  };
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const columnsOfFolder = (folderId) => columnsOf(setIdOf(folderById.get(folderId)));
  const foldersOf = (setId) => folders.filter((f) => setIdOf(f) === setId);

  // For a new root folder: the «Канбан (3 колонки)» template unless the user deleted it.
  const newFolderSetId = setIds.has(SIMPLE_SET_ID) ? SIMPLE_SET_ID : sets[0].id;

  return { sets, columns, columnsOf, setIdOf, columnsOfFolder, foldersOf, newFolderSetId };
}

/** Column of `columns` that best matches `column` from another set: same id, same name, or the first. */
export function matchColumn(column, columns) {
  if (!columns.length) return null;
  if (!column) return columns[0];
  return columns.find((c) => c.id === column.id)
    ?? columns.find((c) => c.name.trim().toLowerCase() === column.name.trim().toLowerCase())
    ?? columns[0];
}

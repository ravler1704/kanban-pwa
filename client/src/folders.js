import { DEFAULT_FOLDER_ID, DEFAULT_SET_ID, SIMPLE_SET_ID } from './db.js';

export const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);

// Until the first sync the device has no folders yet; the server creates «Личное» with this id.
const STAND_IN = {
  id: DEFAULT_FOLDER_ID, parentId: null, columnSetId: SIMPLE_SET_ID, name: 'Личное', position: 1, deleted: false, hidden: false,
};

/** Live folders in order; with `standIn`, «Личное» stands in while the board has none synced. */
export function liveFolders(records, { standIn = true } = {}) {
  const live = records.filter((f) => !f.deleted).sort(byPosition);
  if (live.length || !standIn) return live;
  return records.some((f) => f.id === DEFAULT_FOLDER_ID) ? live : [STAND_IN];
}

const trees = new WeakMap();

/**
 * Index of a list of live folders: { byId, parentOf(folder) → id | null, children: Map(parentId | null → folders) }.
 * A folder whose parent is not in the list (deleted, or not shared with this user) and the folders
 * in a loop (concurrent moves) count as roots. Cached per list.
 */
export function folderTree(folders) {
  let tree = trees.get(folders);
  if (tree) return tree;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parents = new Map();
  for (const f of folders) {
    const parent = f.parentId ?? null;
    parents.set(f.id, parent && byId.has(parent) ? parent : null);
  }
  // Break loops: walking up from a folder must reach a root.
  for (const f of folders) {
    const seen = new Set([f.id]);
    for (let id = parents.get(f.id); id; id = parents.get(id)) {
      if (seen.has(id)) {
        parents.set(f.id, null);
        break;
      }
      seen.add(id);
    }
  }
  const children = new Map();
  for (const f of [...folders].sort(byPosition)) {
    const parent = parents.get(f.id);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(f);
  }
  tree = { byId, parentOf: (f) => parents.get(f.id) ?? null, children };
  trees.set(folders, tree);
  return tree;
}

/** Direct children of `parentId` (null: the roots), in order. */
export const childrenOf = (folders, parentId = null) => folderTree(folders).children.get(parentId ?? null) ?? [];

/** Everything below the folder, parents before children. */
export function descendants(folders, id) {
  const { children } = folderTree(folders);
  const out = [];
  const walk = (parent) => {
    for (const child of children.get(parent) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** The folders from the root down to `folder` itself. */
export function folderPath(folder, folders) {
  const tree = folderTree(folders);
  const path = [];
  for (let f = folder; f; f = tree.byId.get(tree.parentOf(f))) path.unshift(f);
  return path;
}

/** «Личное / Работа / Проект» */
export const folderPathName = (folder, folders, separator = ' / ') => folderPath(folder, folders)
  .map((f) => f.name).join(separator);

/** Whether `ancestorId` is above `folder`. */
export const isInside = (folder, ancestorId, folders) => folderPath(folder, folders)
  .some((f) => f.id === ancestorId && f.id !== folder.id);

/** The tree as a flat list in display order: [{ folder, depth }]. */
export function flattenFolders(folders) {
  const { children } = folderTree(folders);
  const out = [];
  const walk = (parent, depth) => {
    for (const folder of children.get(parent) ?? []) {
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The column set of the folder: its own, or of the nearest ancestor that has one. */
export function folderColumnSetId(folder, folders) {
  const path = folderPath(folder, folders);
  for (let i = path.length - 1; i >= 0; i -= 1) if (path[i].columnSetId) return path[i].columnSetId;
  return DEFAULT_SET_ID;
}

/** The folder with the descendants that take their column set from it (up to those with their own). */
export function inheritingFolders(folder, folders) {
  const { children } = folderTree(folders);
  const out = [folder];
  const walk = (parent) => {
    for (const child of children.get(parent) ?? []) {
      if (child.columnSetId) continue;
      out.push(child);
      walk(child.id);
    }
  };
  walk(folder.id);
  return out;
}

/** The ids of `ids` whose parent is not among them: the tops of the selection. */
export function topFolderIds(ids, folders) {
  const tree = folderTree(folders);
  const set = new Set(ids);
  return ids.filter((id) => {
    const folder = tree.byId.get(id);
    return folder && !set.has(tree.parentOf(folder));
  });
}

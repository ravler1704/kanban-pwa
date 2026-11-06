import { getRecord } from './db.js';

export const DEFAULT_FOLDER_ID = 'personal';
export const DEFAULT_SET_ID = 'default';
// «Входящие» of the owner: cards not on any board yet. No folder has this id; it has no chat.
export const INBOX_ID = 'inbox';

/** Live folder, or null. */
export function folderOf(owner, id) {
  const r = getRecord(owner, id);
  return r?.type === 'folder' && !r.deleted ? r : null;
}

/** Ancestor chain from the folder up to the root, closest parent first. */
export function folderAncestors(owner, folderId) {
  const out = [];
  const seen = new Set();
  let id = folderId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = getRecord(owner, id);
    if (folder?.type !== 'folder') break;
    const parentId = folder.parentId ?? null;
    if (!parentId) break;
    out.push(parentId);
    id = parentId;
  }
  return out;
}

/** Column set of this folder or the nearest ancestor that has one. */
export function folderColumnSet(owner, folderId) {
  let id = folderId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = getRecord(owner, id);
    if (folder?.type !== 'folder') break;
    if (folder.columnSetId) return folder.columnSetId;
    id = folder.parentId ?? null;
  }
  return DEFAULT_SET_ID;
}

/** Direct children of `parentId` (null = roots), live only, sorted. */
export function childFolders(owner, parentId, allFolders) {
  return allFolders
    .filter((f) => !f.deleted && (f.parentId ?? null) === parentId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

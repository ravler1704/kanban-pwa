import {
  db, getMeta, getRecord, saveRecord, setMeta, transaction,
} from './db.js';
import { DEFAULT_FOLDER_ID, DEFAULT_SET_ID } from './folders.js';

const selectByType = db.prepare('SELECT owner, id, type, data, version FROM records WHERE type = ?');
const selectOwners = db.prepare("SELECT DISTINCT owner FROM records WHERE type IN ('space','project','section','folder','card')");
const updateTypeData = db.prepare(`
  UPDATE records SET type = ?, data = ?, version = ?, seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM records),
    updated_at = ?, updated_by = 'server' WHERE owner = ? AND id = ?
`);

function write(owner, type, id, data, version) {
  updateTypeData.run(type, JSON.stringify(data), version + 1, Date.now(), owner, id);
}

/**
 * Once per board: space / project / section → folder (same ids), cards get folderId,
 * comments get folderId, memberships move to folder_members.
 */
export function migrateFolders() {
  if (getMeta('foldersMigrated')) return;

  transaction(() => {
    // Membership tables: project_members + space_members → folder_members.
    db.exec(`
      CREATE TABLE IF NOT EXISTS folder_members (
        board       TEXT    NOT NULL,
        folder      TEXT    NOT NULL,
        email       TEXT    NOT NULL,
        added_at    INTEGER NOT NULL,
        PRIMARY KEY (board, folder, email)
      );
      CREATE INDEX IF NOT EXISTS idx_folder_members_email ON folder_members(email);
    `);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_members'").get()) {
      db.exec(`
        INSERT OR IGNORE INTO folder_members (board, folder, email, added_at)
          SELECT board, project, email, added_at FROM project_members;
      `);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'space_members'").get()) {
      db.exec(`
        INSERT OR IGNORE INTO folder_members (board, folder, email, added_at)
          SELECT board, space, email, added_at FROM space_members;
      `);
    }

    for (const { owner } of selectOwners.all()) {
      const spaces = selectByType.all('space').filter((r) => r.owner === owner);
      const projects = selectByType.all('project').filter((r) => r.owner === owner);
      const sections = selectByType.all('section').filter((r) => r.owner === owner);
      const folders = selectByType.all('folder').filter((r) => r.owner === owner);
      if (!spaces.length && !projects.length && !sections.length) {
        // Already folders-only, or empty board: ensure «Личное» exists later via seed.
        continue;
      }
      if (folders.length && !spaces.length && !projects.length && !sections.length) continue;

      for (const row of spaces) {
        const d = JSON.parse(row.data);
        write(owner, 'folder', row.id, {
          parentId: null, name: d.name ?? '', position: d.position ?? 0, deleted: !!d.deleted,
          columnSetId: null, hidden: false,
        }, row.version);
      }
      for (const row of projects) {
        const d = JSON.parse(row.data);
        write(owner, 'folder', row.id, {
          parentId: d.spaceId ?? DEFAULT_FOLDER_ID,
          name: d.name ?? '',
          position: d.position ?? 0,
          deleted: !!d.deleted,
          columnSetId: d.columnSetId ?? DEFAULT_SET_ID,
          hidden: !!d.hidden,
        }, row.version);
      }
      for (const row of sections) {
        const d = JSON.parse(row.data);
        write(owner, 'folder', row.id, {
          parentId: d.projectId,
          name: d.name ?? '',
          position: d.position ?? 0,
          deleted: !!d.deleted,
          columnSetId: null,
          hidden: !!d.hidden,
        }, row.version);
      }

      const cards = db.prepare("SELECT id, data, version FROM records WHERE owner = ? AND type = 'card'").all(owner);
      for (const row of cards) {
        const d = JSON.parse(row.data);
        if (d.folderId) continue;
        const folderId = d.sectionId || d.projectId;
        if (!folderId) continue;
        const { projectId, sectionId, ...rest } = d;
        write(owner, 'card', row.id, { ...rest, folderId }, row.version);
      }

      const comments = db.prepare("SELECT id, data, version FROM records WHERE owner = ? AND type = 'comment'").all(owner);
      for (const row of comments) {
        const d = JSON.parse(row.data);
        if (d.folderId != null || (d.folderId === null && !d.projectId && !d.spaceId)) {
          if (d.folderId !== undefined && !('projectId' in d) && !('spaceId' in d)) continue;
        }
        let folderId = d.folderId ?? null;
        if (!folderId && d.cardId) {
          const card = getRecord(owner, d.cardId);
          folderId = card?.folderId ?? card?.sectionId ?? card?.projectId ?? null;
        }
        if (!folderId) folderId = d.spaceId ?? d.projectId ?? null;
        const { projectId, spaceId, ...rest } = d;
        write(owner, 'comment', row.id, { ...rest, folderId }, row.version);
      }
    }

    // Drop old membership tables and rebuild the access view.
    db.exec(`
      DROP VIEW IF EXISTS member_access;
      DROP TABLE IF EXISTS project_members;
      DROP TABLE IF EXISTS space_members;
    `);
    // member_access: invited folder + every descendant folder (not deleted).
    db.exec(`
      CREATE VIEW member_access AS
      WITH RECURSIVE tree AS (
        SELECT m.board, m.folder AS folder, m.email, m.added_at
        FROM folder_members m
        UNION ALL
        SELECT t.board, r.id, t.email, t.added_at
        FROM tree t
        JOIN records r ON r.owner = t.board AND r.type = 'folder'
          AND COALESCE(json_extract(r.data, '$.parentId'), '') = t.folder
          AND json_extract(r.data, '$.deleted') = 0
      )
      SELECT t.board, t.folder, t.email, t.added_at
      FROM tree t
      JOIN records r ON r.owner = t.board AND r.id = t.folder AND r.type = 'folder'
        AND json_extract(r.data, '$.deleted') = 0;
    `);

    setMeta('foldersMigrated', '1');
  });
}

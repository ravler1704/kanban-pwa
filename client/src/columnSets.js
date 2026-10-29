import { DEFAULT_COLUMNS, DEFAULT_SET_ID, DEFAULT_SETS } from './db.js';

const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);

/**
 * Live column sets and their columns. Until the first sync brings the server's data,
 * the default set and columns are used (same ids as on the server).
 * A project whose set is gone (deleted on another device) falls back to the first set.
 */
export function columnModel(rawSets, rawColumns, projects) {
  const liveSets = rawSets.filter((s) => !s.deleted).sort(byPosition);
  const sets = liveSets.length ? liveSets : DEFAULT_SETS;
  const setIds = new Set(sets.map((s) => s.id));
  const liveColumns = rawColumns.filter((c) => !c.deleted).map((c) => ({ ...c, setId: c.setId ?? DEFAULT_SET_ID }));
  const columns = (rawColumns.length ? liveColumns : [...DEFAULT_COLUMNS]).sort(byPosition);

  const columnsOf = (setId) => columns.filter((c) => c.setId === setId);
  const setIdOf = (project) => {
    const id = project?.columnSetId ?? DEFAULT_SET_ID;
    return setIds.has(id) ? id : sets[0].id;
  };
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const columnsOfProject = (projectId) => columnsOf(setIdOf(projectById.get(projectId)));
  const projectsOf = (setId) => projects.filter((p) => setIdOf(p) === setId);

  return { sets, columns, columnsOf, setIdOf, columnsOfProject, projectsOf };
}

/** Column of `columns` that best matches `column` from another set: same id, same name, or the first. */
export function matchColumn(column, columns) {
  if (!columns.length) return null;
  if (!column) return columns[0];
  return columns.find((c) => c.id === column.id)
    ?? columns.find((c) => c.name.trim().toLowerCase() === column.name.trim().toLowerCase())
    ?? columns[0];
}

import { DEFAULT_SPACE_ID } from './db.js';

// Until the first sync the device has no spaces yet; the server creates «Личное» with this id.
const DEFAULT_SPACE = { id: DEFAULT_SPACE_ID, name: 'Личное', position: 1, deleted: false };

/** Live spaces in order; «Личное» stands in while the board has none synced. */
export function liveSpaces(records) {
  const live = records.filter((s) => !s.deleted)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (live.length) return live;
  return records.some((s) => s.id === DEFAULT_SPACE_ID) ? live : [DEFAULT_SPACE];
}

/** The space a project is shown in: its own, or the first one if that is gone. */
export function spaceIdOf(project, spaces) {
  const id = project.spaceId ?? DEFAULT_SPACE_ID;
  return spaces.some((s) => s.id === id) ? id : spaces[0]?.id ?? DEFAULT_SPACE_ID;
}

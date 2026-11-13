import { updateCard } from './actions.js';
import { CARD_COLORS } from './appearance.js';

export const SWIMLANE_KEY = 'swimlaneMode';

export const SWIMLANE_MODES = [
  { id: 'none', label: 'Без дорожек', icon: 'M4 4h16v16H4zM9.3 4v16M14.7 4v16' },
  { id: 'holder', label: 'По исполнителю', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
  { id: 'folder', label: 'По доске', icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { id: 'color', label: 'По цвету', icon: 'M12 3a9 9 0 0 0 0 18c1.4 0 2.2-1 2.2-2.1 0-.7-.5-1.2-1.1-1.2h-1.6a2.2 2.2 0 0 1 0-4.4H14a2.6 2.6 0 0 0 2.6-2.6A6.7 6.7 0 0 0 12 3z' },
];

/** Saved mode, or null if the user never chose one in the board menu. */
export function savedSwimlaneMode() {
  const id = localStorage.getItem(SWIMLANE_KEY);
  return SWIMLANE_MODES.some((m) => m.id === id) ? id : null;
}

export function swimlaneMode() {
  return savedSwimlaneMode() ?? 'none';
}

export function setSwimlaneMode(id) {
  localStorage.setItem(SWIMLANE_KEY, id);
}

/** Lane id a card belongs to for the given grouping mode. */
export function cardLaneId(card, mode) {
  if (mode === 'holder') return card.assigneeId || card.authorId || '_none';
  if (mode === 'folder') return card.folderId;
  if (mode === 'color') return card.color ?? '_none';
  return null;
}

export function laneLabel(id, mode, ctx = {}) {
  const { folderName, personName } = ctx;
  if (mode === 'holder') return id === '_none' ? 'Без исполнителя' : (personName?.(id) ?? id);
  if (mode === 'folder') return folderName?.(id) ?? id;
  if (mode === 'color') {
    if (id === '_none') return 'Без цвета';
    return CARD_COLORS.find((c) => c.id === id)?.name ?? id;
  }
  return id;
}

/**
 * Lanes for cards on the board: one row per distinct lane id, sorted by label; «Без …» goes last.
 */
export function buildSwimlanes(cards, mode, ctx) {
  if (mode === 'none') return [];
  const byId = new Map();
  for (const card of cards) {
    if (card.deleted && !card.conflict) continue;
    const id = cardLaneId(card, mode);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        label: laneLabel(id, mode, ctx),
        count: 0,
        color: mode === 'color' && id !== '_none' ? CARD_COLORS.find((c) => c.id === id)?.value : null,
      });
    }
    byId.get(id).count += 1;
  }
  const lanes = [...byId.values()];
  const tail = (id) => (id === '_none' ? 1 : 0);
  return lanes.sort((a, b) => tail(a.id) - tail(b.id) || a.label.localeCompare(b.label, 'ru'));
}

/** After a card lands in a lane cell, update the field that defines the lane. */
export function applySwimlaneMove(card, laneId, mode) {
  if (mode === 'holder') {
    if (laneId === '_none') return updateCard(card.id, { assigneeId: null });
    return updateCard(card.id, { assigneeId: laneId === card.authorId ? null : laneId });
  }
  if (mode === 'color') {
    const color = laneId === '_none' ? null : laneId;
    if (color !== (card.color ?? null)) return updateCard(card.id, { color });
  }
  return undefined;
}

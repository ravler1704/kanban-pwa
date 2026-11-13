import { updateCard } from './actions.js';
import { CARD_COLORS } from './appearance.js';

export const SWIMLANE_KEY = 'swimlaneMode';

export const SWIMLANE_MODES = [
  { id: 'none', label: 'Без дорожек' },
  { id: 'holder', label: 'По исполнителю' },
  { id: 'folder', label: 'По доске' },
  { id: 'color', label: 'По цвету' },
];

export function swimlaneMode() {
  const id = localStorage.getItem(SWIMLANE_KEY);
  return SWIMLANE_MODES.some((m) => m.id === id) ? id : 'none';
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

export function laneLabel(id, mode, { folderName, personName }) {
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

import { INBOX_ID } from './db.js';
import { withoutLinks } from './links.js';

const MAX_DEPENDS = 20;

/** Ordered card ids this task waits on (they must be done first). */
export function dependsOnOf(card) {
  const raw = card?.dependsOn;
  return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string' && id) : [];
}

export function columnIndex(columns, columnId) {
  const i = columns.findIndex((c) => c.id === columnId);
  return i < 0 ? 0 : i;
}

/** Dependencies that are not done yet (missing or archived cards are ignored). */
export function pendingDependencies(card, cardById) {
  const ids = dependsOnOf(card);
  return ids.filter((id) => {
    const dep = typeof cardById === 'function' ? cardById(id) : cardById.get(id);
    if (!dep || dep.purged || dep.deleted) return false;
    return !dep.done;
  });
}

export function dependencyTitle(dep) {
  if (!dep) return 'Карточка';
  const title = withoutLinks(dep.title).trim();
  if (title) return title;
  return dep.number ? `Карточка #${dep.number}` : 'Без названия';
}

/** User-facing list of blocker titles. */
export function blockersMessage(card, cardById) {
  const pending = pendingDependencies(card, cardById);
  if (!pending.length) return null;
  const titles = pending.map((id) => {
    const dep = typeof cardById === 'function' ? cardById(id) : cardById.get(id);
    return `«${dependencyTitle(dep)}»`;
  });
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} и ${titles[1]}`;
  return `${titles.slice(0, -1).join(', ')} и ${titles.at(-1)}`;
}

function moveKind(fromIndex, toIndex, columnCount) {
  const last = columnCount - 1;
  const starting = fromIndex === 0 && toIndex > 0;
  const finishing = last > 0 && toIndex === last && toIndex !== fromIndex;
  return { starting, finishing };
}

/**
 * Whether the move should be blocked (start from first column or move into the last one).
 * Returns a Russian message or null.
 */
export function moveBlockedMessage(card, fromColumnId, toColumnId, columns, cardById) {
  if (!card || card.folderId === INBOX_ID || fromColumnId === toColumnId) return null;
  if (!columns?.length) return null;
  const msg = blockersMessage(card, cardById);
  if (!msg) return null;
  const from = columnIndex(columns, fromColumnId);
  const to = columnIndex(columns, toColumnId);
  const { starting, finishing } = moveKind(from, to, columns.length);
  if (starting && finishing) {
    return `Нельзя начать или завершить задачу: сначала выполните ${msg}.`;
  }
  if (starting) return `Нельзя начать задачу: сначала выполните ${msg}.`;
  if (finishing) return `Нельзя завершить задачу: сначала выполните ${msg}.`;
  return null;
}

/** Marking done or moving to the last column counts as finishing; leaving the first column as starting. */
export function finishBlockedMessage(card, columns, cardById) {
  const msg = blockersMessage(card, cardById);
  return msg ? `Нельзя завершить задачу: сначала выполните ${msg}.` : null;
}

export function startBlockedMessage(card, columns, cardById) {
  const msg = blockersMessage(card, cardById);
  return msg ? `Нельзя начать задачу: сначала выполните ${msg}.` : null;
}

/** True if the card still waits on at least one open dependency. */
export function isWaitingOnDependencies(card, cardById) {
  return pendingDependencies(card, cardById).length > 0;
}

/** Adding `depId` would create a cycle via dependsOn chains. */
export function wouldCreateCycle(cardId, depId, cardById) {
  const seen = new Set();
  const walk = (id) => {
    if (id === cardId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const node = typeof cardById === 'function' ? cardById(id) : cardById.get(id);
    if (!node) return false;
    for (const next of dependsOnOf(node)) {
      if (walk(next)) return true;
    }
    return false;
  };
  return walk(depId);
}

export function canAddDependency(cardId, depId, cardById) {
  if (!depId || depId === cardId) return false;
  const dep = typeof cardById === 'function' ? cardById(depId) : cardById.get(depId);
  if (!dep || dep.purged || dep.deleted) return false;
  if (wouldCreateCycle(cardId, depId, cardById)) return false;
  const self = typeof cardById === 'function' ? cardById(cardId) : cardById.get(cardId);
  if (dependsOnOf(self).includes(depId)) return false;
  if (dependsOnOf(self).length >= MAX_DEPENDS) return false;
  return true;
}

export { MAX_DEPENDS };

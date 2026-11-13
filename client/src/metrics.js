import { isDeadlineOverdue } from './deadlines.js';
import { cardReminders, nextReminder } from './reminders.js';

const DAY = 86_400_000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function daysFromToday(at, now = new Date()) {
  return Math.round((startOfDay(new Date(at)) - startOfDay(now)) / DAY);
}

/** KPI numbers for the cards that pass the current filters (live cards only). */
export function computeMetrics(cards, { columnsOfFolder, folderName, now = Date.now() } = {}) {
  const live = cards.filter((c) => !c.deleted);
  const total = live.length;
  const done = live.filter((c) => c.done).length;
  const inWork = total - done;
  const conflicts = live.filter((c) => c.conflict).length;
  const overdue = live.filter((c) => isDeadlineOverdue(c.dueAt, now, c.done)).length;
  const dueToday = live.filter((c) => c.dueAt && !c.done && daysFromToday(c.dueAt, new Date(now)) === 0).length;
  const dueWeek = live.filter((c) => {
    if (!c.dueAt || c.done) return false;
    const d = daysFromToday(c.dueAt, new Date(now));
    return d >= 0 && d < 7;
  }).length;
  const noAssignee = live.filter((c) => !c.assigneeId).length;
  const withDeadline = live.filter((c) => c.dueAt).length;
  const withReminder = live.filter((c) => cardReminders(c).length > 0).length;
  const reminderSoon = live.filter((c) => {
    const next = nextReminder(c, now);
    return next && !next.past && next.time - now < 7 * DAY;
  }).length;

  let checklistItems = 0;
  let checklistDone = 0;
  let cardsWithChecklist = 0;
  for (const card of live) {
    const items = card.checklist ?? [];
    if (!items.length) continue;
    cardsWithChecklist += 1;
    checklistItems += items.length;
    checklistDone += items.filter((i) => i.done).length;
  }

  const byColumn = new Map();
  for (const card of live) {
    const cols = columnsOfFolder?.(card.folderId) ?? [];
    const col = cols.find((c) => c.id === card.columnId);
    const id = col?.id ?? card.columnId;
    const name = col?.name ?? '—';
    const row = byColumn.get(id) ?? { id, name, count: 0, done: 0 };
    row.count += 1;
    if (card.done) row.done += 1;
    byColumn.set(id, row);
  }
  const columns = [...byColumn.values()].sort((a, b) => b.count - a.count);

  const byFolder = new Map();
  for (const card of live) {
    const name = folderName?.(card.folderId) ?? card.folderId;
    const row = byFolder.get(card.folderId) ?? { id: card.folderId, name, count: 0, done: 0 };
    row.count += 1;
    if (card.done) row.done += 1;
    byFolder.set(card.folderId, row);
  }
  const folders = [...byFolder.values()].sort((a, b) => b.count - a.count);

  const byHolder = new Map();
  for (const card of live) {
    const id = card.assigneeId || card.authorId || '_none';
    const row = byHolder.get(id) ?? { id, count: 0, done: 0 };
    row.count += 1;
    if (card.done) row.done += 1;
    byHolder.set(id, row);
  }
  const holders = [...byHolder.values()].sort((a, b) => b.count - a.count);

  return {
    total,
    done,
    inWork,
    donePct: total ? Math.round((done / total) * 100) : 0,
    conflicts,
    overdue,
    dueToday,
    dueWeek,
    noAssignee,
    withDeadline,
    withReminder,
    reminderSoon,
    checklistItems,
    checklistDone,
    checklistPct: checklistItems ? Math.round((checklistDone / checklistItems) * 100) : null,
    cardsWithChecklist,
    columns,
    folders,
    holders,
  };
}

import { db, INBOX_ID } from './db.js';
import { columnModel } from './columnSets.js';
import { flattenFolders, folderPathName } from './folders.js';
import { MD_LINK_RE, safeHref } from './links.js';
import { cardReminders, nextReminder, REPEAT_LABELS } from './reminders.js';
import { tagNames } from './tags.js';

// What the Excel and the PDF export (exportXlsx.js, exportPdf.js) are built from.

const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);

export const formatTime = (time) => new Date(time).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** «Kanban — Проект — 2026-11-08.xlsx», without characters file systems reject. */
export function exportFileName(title, extension = 'xlsx', now = new Date()) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // eslint-disable-next-line no-control-regex
  const name = (title ?? '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
    .replace(/[. ]+$/, '');
  return `Kanban — ${name || 'доски'} — ${day}.${extension}`;
}

/** «1/3» for a checklist, '' without one. */
export const progress = (checklist) => (checklist.length ? `${checklist.filter((i) => i.done).length}/${checklist.length}` : '');

/** Card Markdown (see Markdown.jsx) as plain text: no markup, list items with «•», links as «text (address)». */
export function plainText(text) {
  const out = [];
  let code = false;
  for (const line of (text ?? '').split('\n')) {
    if (/^\s*```/.test(line)) {
      code = !code;
      continue;
    }
    if (code) {
      out.push(line);
      continue;
    }
    out.push(line
      .replace(/^(\s*)[-*+]\s+/, '$1• ')
      .replace(/^\s*>\s?/, '')
      .replace(/^#{1,3}\s+(?=\S)/, '')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(MD_LINK_RE, (whole, label, url) => (safeHref(url) && label !== url ? `${label} (${url})` : label))
      .replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|~~([^~\n]+?)~~/g, (m, a, b, c) => a ?? b ?? c)
      .replace(/(?<![\p{L}\p{N}*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![\p{L}\p{N}*])/gu, '$1')
      .replace(/(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*[^_\s])?)_(?![\p{L}\p{N}_])/gu, '$1'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The cards of `folderIds` (and of «Входящие» with `inbox`), in the order of the boards, their columns and the
 * cards in them. `folders`: the live folders (for the paths and the order); `names`: user id → name.
 * Returns { boards: [{ id, name, path, columns }], rows: [{ folderId, board, column, columnIndex, card, … }] };
 * times are milliseconds or null.
 */
export async function cardRows({ folders, folderIds, inbox = false, includeArchived = false, names = new Map() }) {
  const ids = new Set(folderIds);
  const people = new Map(names);
  const where = [...ids, ...(inbox ? [INBOX_ID] : [])];
  const [columnSets, columns, cards, comments] = await Promise.all([
    db.columnSets.toArray(),
    db.columns.toArray(),
    db.cards.where('folderId').anyOf(where).toArray(),
    db.comments.where('folderId').anyOf(where).filter((c) => c.cardId && !c.deleted).toArray(),
  ]);
  const model = columnModel(columnSets, columns, folders);
  const commentCount = new Map();
  for (const c of comments) {
    commentCount.set(c.cardId, (commentCount.get(c.cardId) ?? 0) + 1);
    if (c.authorId && c.authorName && !people.has(c.authorId)) people.set(c.authorId, c.authorName);
  }
  const nameOf = (id) => (id ? people.get(id) ?? '' : '');
  const now = Date.now();

  const order = flattenFolders(folders).map(({ folder }) => folder).filter((f) => ids.has(f.id));
  const boards = order.map((f) => ({ id: f.id, name: f.name, path: folderPathName(f, folders), columns: model.columnsOfFolder(f.id) }));
  if (inbox) boards.push({ id: INBOX_ID, name: 'Входящие', path: 'Входящие', columns: [] });

  const live = cards.filter((c) => !c.purged && (includeArchived || !c.deleted));
  const rows = [];
  for (const board of boards) {
    const columnIndex = new Map(board.columns.map((c, i) => [c.id, i]));
    const at = (card) => columnIndex.get(card.columnId) ?? 0;
    const own = live.filter((c) => c.folderId === board.id).sort((a, b) => at(a) - at(b) || byPosition(a, b));
    for (const card of own) {
      const next = nextReminder(card, now);
      rows.push({
        folderId: board.id,
        boardName: board.name,
        board: board.path,
        columnIndex: at(card),
        column: board.columns[at(card)]?.name ?? '',
        card,
        tags: [...new Set(tagNames(`${card.title ?? ''}\n${card.description ?? ''}`))],
        holder: nameOf(card.assigneeId || card.authorId),
        author: nameOf(card.authorId),
        nextReminder: next ? next.time : null,
        reminders: cardReminders(card).map((r) => [formatTime(r.at), r.repeat && REPEAT_LABELS[r.repeat]].filter(Boolean).join(', ')),
        checklist: card.checklist ?? [],
        attachments: (card.attachments ?? []).map((a) => a.name),
        comments: commentCount.get(card.id) ?? 0,
        updated: card.server?.updatedAt ?? null,
      });
    }
  }
  return { rows, boards };
}

export function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

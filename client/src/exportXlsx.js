import writeExcelFile from 'write-excel-file/browser';
import { db, INBOX_ID } from './db.js';
import { columnModel } from './columnSets.js';
import { flattenFolders, folderPathName } from './folders.js';
import { cardReminders, nextReminder, REPEAT_LABELS } from './reminders.js';
import { tagNames } from './tags.js';

// Loaded on demand (see ExportDialog.jsx): the Excel writer stays out of the main bundle.

const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
// Excel keeps at most this many characters in a cell.
const MAX_TEXT = 32_767;
const ALL_SHEET = 'Все карточки';
const DATE_FORMAT = 'dd.mm.yyyy hh:mm';

const text = (value) => {
  const s = (value ?? '').toString();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;
};
// Excel dates have no time zone: the wall-clock time of this device is written.
const excelDate = (time) => new Date(time - new Date(time).getTimezoneOffset() * 60_000);
const formatTime = (time) => new Date(time).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** A sheet name Excel accepts, unique among `taken` (lowercased names, updated). */
export function sheetName(name, taken) {
  const base = (name ?? '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '') || 'Доска';
  let candidate = base.slice(0, 31).trim();
  for (let n = 2; taken.has(candidate.toLowerCase()) || candidate.toLowerCase() === 'history'; n += 1) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** «Kanban — Проект — 2026-11-08.xlsx», without characters file systems reject. */
export function exportFileName(title, now = new Date()) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // eslint-disable-next-line no-control-regex
  const name = (title ?? '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
    .replace(/[. ]+$/, '');
  return `Kanban — ${name || 'доски'} — ${day}.xlsx`;
}

/**
 * The columns of a sheet: { header, width, value(row) → cell value | null, ...cell options }.
 * `board`: the board's path is a column (the sheet of all cards); `archived`: archived cards are in it.
 */
function sheetColumns({ board, archived }) {
  const wrap = { wrap: true };
  return [
    { header: '№', width: 7, value: (r) => r.card.number ?? null, type: Number },
    board && { header: 'Доска', width: 28, value: (r) => r.board, ...wrap },
    { header: 'Колонка', width: 18, value: (r) => r.column },
    { header: 'Название', width: 40, value: (r) => r.card.title, ...wrap },
    { header: 'Описание', width: 60, value: (r) => r.card.description, ...wrap },
    { header: 'Метки', width: 16, value: (r) => r.tags, ...wrap },
    { header: 'Выполнена', width: 12, value: (r) => (r.card.done ? 'Да' : '') },
    { header: 'Исполнитель', width: 22, value: (r) => r.holder },
    { header: 'Автор', width: 22, value: (r) => r.author },
    { header: 'Ближайшее напоминание', width: 20, value: (r) => r.nextReminder, type: Date, format: DATE_FORMAT },
    { header: 'Напоминания', width: 32, value: (r) => r.reminders, ...wrap },
    { header: 'Подзадачи', width: 11, value: (r) => r.progress },
    { header: 'Список подзадач', width: 40, value: (r) => r.checklist, ...wrap },
    { header: 'Вложения', width: 30, value: (r) => r.attachments, ...wrap },
    { header: 'Комментарии', width: 13, value: (r) => r.comments || null, type: Number },
    { header: 'Изменена', width: 18, value: (r) => r.updated, type: Date, format: DATE_FORMAT },
    archived && { header: 'В архиве', width: 10, value: (r) => (r.card.deleted ? 'Да' : '') },
  ].filter(Boolean);
}

function sheet(name, rows, options) {
  const columns = sheetColumns(options);
  const header = columns.map((c) => ({ value: c.header, fontWeight: 'bold', backgroundColor: '#E8EDF3', alignVertical: 'center' }));
  const data = [header, ...rows.map((row) => columns.map(({ header: _, width: __, value, ...cell }) => {
    const v = value(row);
    if (v === null || v === undefined || v === '') return null;
    return { ...cell, value: typeof v === 'string' ? text(v) : v, alignVertical: 'top' };
  }))];
  return {
    data,
    sheet: name,
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1,
    autoFilter: `A1:${columnLetter(columns.length - 1)}${data.length}`,
  };
}

function columnLetter(index) {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const quoteSheet = (name) => `'${name.replace(/'/g, "''")}'`;
const absolute = (ref) => ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');

// write-excel-file has no autofilter: the sheet gets <autoFilter> after its data, and the workbook
// the hidden name Excel keeps the filtered range in.
const autoFilterFeature = {
  files: {
    transform: {
      'xl/worksheets/sheet{id}.xml': {
        transform(xml, options) {
          if (!options.autoFilter || xml.includes('<autoFilter')) return xml;
          const tag = `<autoFilter ref="${options.autoFilter}"/>`;
          return xml.includes('</sheetData>') ? xml.replace('</sheetData>', `</sheetData>${tag}`)
            : xml.replace(/<sheetData\s*\/>/, (m) => `${m}${tag}`);
        },
      },
      'xl/workbook.xml': {
        transform(xml, sheetsOptions) {
          if (xml.includes('_xlnm._FilterDatabase')) return xml;
          const names = sheetsOptions.map((o, i) => (o.autoFilter
            ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${
              quoteSheet(o.sheet).replace(/&/g, '&amp;').replace(/</g, '&lt;')}!${absolute(o.autoFilter)}</definedName>`
            : '')).join('');
          if (!names) return xml;
          if (/<definedNames\s*\/>/.test(xml)) return xml.replace(/<definedNames\s*\/>/, `<definedNames>${names}</definedNames>`);
          if (xml.includes('</definedNames>')) return xml.replace('</definedNames>', `${names}</definedNames>`);
          return xml.replace('</sheets>', `</sheets><definedNames>${names}</definedNames>`);
        },
      },
    },
  },
};

/**
 * The rows of the cards of `folderIds` (and of «Входящие» with `inbox`), in the order of the boards, their columns
 * and the cards in them: { folderId, board, column, card, … }. `names`: user id → name.
 */
async function cardRows({ folders, folderIds, inbox, includeArchived, names }) {
  const ids = new Set(folderIds);
  const [columnSets, columns, cards, comments] = await Promise.all([
    db.columnSets.toArray(),
    db.columns.toArray(),
    db.cards.where('folderId').anyOf([...ids, ...(inbox ? [INBOX_ID] : [])]).toArray(),
    db.comments.where('folderId').anyOf([...ids, ...(inbox ? [INBOX_ID] : [])]).filter((c) => c.cardId && !c.deleted).toArray(),
  ]);
  const model = columnModel(columnSets, columns, folders);
  const commentCount = new Map();
  for (const c of comments) {
    commentCount.set(c.cardId, (commentCount.get(c.cardId) ?? 0) + 1);
    if (c.authorId && c.authorName && !names.has(c.authorId)) names.set(c.authorId, c.authorName);
  }
  const nameOf = (id) => (id ? names.get(id) ?? '' : '');
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
      const reminders = cardReminders(card);
      const next = nextReminder(card, now);
      const checklist = card.checklist ?? [];
      rows.push({
        folderId: board.id,
        boardName: board.name,
        board: board.path,
        column: board.columns[at(card)]?.name ?? '',
        card,
        tags: [...new Set(tagNames(`${card.title ?? ''}\n${card.description ?? ''}`))].map((t) => `#${t}`).join(', '),
        holder: nameOf(card.assigneeId || card.authorId),
        author: nameOf(card.authorId),
        nextReminder: next ? excelDate(next.time) : null,
        reminders: reminders.map((r) => [formatTime(r.at), r.repeat && REPEAT_LABELS[r.repeat]].filter(Boolean).join(', ')).join('\n'),
        progress: checklist.length ? `${checklist.filter((i) => i.done).length}/${checklist.length}` : '',
        checklist: checklist.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n'),
        attachments: (card.attachments ?? []).map((a) => a.name).join('\n'),
        comments: commentCount.get(card.id) ?? 0,
        updated: card.server?.updatedAt ? excelDate(card.server.updatedAt) : null,
      });
    }
  }
  return { rows, boards };
}

/**
 * The workbook of the cards of `folderIds`: the sheet of all cards and, with several boards, a sheet per board
 * that has cards. `folders`: the live folders (for the paths and the order). Returns a Blob.
 */
export async function buildWorkbook({ folders, folderIds, inbox = false, includeArchived = false, names = new Map() }) {
  const { rows, boards } = await cardRows({ folders, folderIds, inbox, includeArchived, names: new Map(names) });
  const taken = new Set([ALL_SHEET.toLowerCase()]);
  const sheets = [sheet(ALL_SHEET, rows, { board: true, archived: includeArchived })];
  if (boards.length > 1) {
    for (const board of boards) {
      const own = rows.filter((r) => r.folderId === board.id);
      if (own.length) sheets.push(sheet(sheetName(board.name, taken), own, { board: false, archived: includeArchived }));
    }
  }
  const blob = await writeExcelFile(sheets, { fontFamily: 'Calibri', fontSize: 11, features: [autoFilterFeature] }).toBlob();
  return { blob, cards: rows.length, sheets: sheets.length };
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

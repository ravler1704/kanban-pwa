import writeExcelFile from 'write-excel-file/browser';
import { cardRows, progress } from './exportData.js';

// Loaded on demand (see ExportDialog.jsx): the Excel writer stays out of the main bundle.

// Excel keeps at most this many characters in a cell.
const MAX_TEXT = 32_767;
const ALL_SHEET = 'Все карточки';
const DATE_FORMAT = 'dd.mm.yyyy hh:mm';

const text = (value) => {
  const s = (value ?? '').toString();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;
};
// Excel dates have no time zone: the wall-clock time of this device is written.
const excelDate = (time) => (time ? new Date(time - new Date(time).getTimezoneOffset() * 60_000) : null);

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
    { header: 'Метки', width: 16, value: (r) => r.tags.map((t) => `#${t}`).join(', '), ...wrap },
    { header: 'Выполнена', width: 12, value: (r) => (r.card.done ? 'Да' : '') },
    { header: 'Исполнитель', width: 22, value: (r) => r.holder },
    { header: 'Автор', width: 22, value: (r) => r.author },
    { header: 'Ближайшее напоминание', width: 20, value: (r) => excelDate(r.nextReminder), type: Date, format: DATE_FORMAT },
    { header: 'Напоминания', width: 32, value: (r) => r.reminders.join('\n'), ...wrap },
    { header: 'Подзадачи', width: 11, value: (r) => progress(r.checklist) },
    { header: 'Список подзадач', width: 40, value: (r) => r.checklist.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n'), ...wrap },
    { header: 'Вложения', width: 30, value: (r) => r.attachments.join('\n'), ...wrap },
    { header: 'Комментарии', width: 13, value: (r) => r.comments || null, type: Number },
    { header: 'Изменена', width: 18, value: (r) => excelDate(r.updated), type: Date, format: DATE_FORMAT },
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
 * The workbook of the cards of `folderIds`: the sheet of all cards and, with several boards, a sheet per board
 * that has cards. `folders`: the live folders (for the paths and the order). Returns a Blob.
 */
export async function buildWorkbook({ folders, folderIds, inbox = false, includeArchived = false, names = new Map() }) {
  const { rows, boards } = await cardRows({ folders, folderIds, inbox, includeArchived, names });
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

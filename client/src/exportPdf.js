import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { cardRows, formatTime, plainText, progress } from './exportData.js';

// Loaded on demand (see ExportDialog.jsx), like the Excel writer. The font (Roboto, Latin + Cyrillic, with ✓ ☐ ☑
// added; public/fonts/roboto) is precached, so the PDF is built offline too.

const FONT = 'Roboto';
const FONT_FILES = { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Bold.ttf' };
const MARGIN = 12;
const FOOTER = 7;
const MAX_DESCRIPTION = 4000;
const INK = [30, 41, 59];
const MUTED = [100, 116, 139];
const RULE = [214, 221, 230];
const HEAD_FILL = [232, 237, 243];
const DONE = [22, 163, 74];

const binary = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
};

async function addFonts(doc) {
  await Promise.all(Object.entries(FONT_FILES).map(async ([style, file]) => {
    const res = await fetch(`${import.meta.env.BASE_URL}fonts/roboto/${file}`);
    if (!res.ok) throw new Error('Не удалось загрузить шрифт для PDF');
    doc.addFileToVFS(file, binary(await res.arrayBuffer()));
    doc.addFont(file, FONT, style);
  }));
}

const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const lineHeight = (size) => size * 0.3528 * 1.2;

function tableColumns(archived) {
  return [
    { key: 'number', header: '№', width: 11 },
    { key: 'title', header: 'Название', width: 52, style: { fontStyle: 'bold' } },
    { key: 'done', header: 'Готово', width: 13, style: { halign: 'center', fontStyle: 'bold', textColor: DONE, fontSize: 10 } },
    { key: 'holder', header: 'Исполнитель', width: 28 },
    { key: 'reminder', header: 'Напоминание', width: 25 },
    { key: 'tags', header: 'Метки', width: 22 },
    { key: 'checklist', header: 'Подзадачи', width: 40 },
    { key: 'description', header: 'Описание', width: 'auto' },
    { key: 'counts', header: 'Влож. / комм.', width: 17, style: { halign: 'center' } },
    archived && { key: 'archived', header: 'Архив', width: 17, style: { textColor: MUTED } },
  ].filter(Boolean);
}

function cells(row) {
  const { card } = row;
  const attachments = row.attachments.length;
  return {
    number: card.number ?? '',
    title: plainText(card.title) || 'Без названия',
    done: card.done ? '✓' : '',
    holder: row.holder,
    reminder: row.nextReminder ? formatTime(row.nextReminder) : '',
    tags: row.tags.map((t) => `#${t}`).join(', '),
    checklist: row.checklist.length
      ? [progress(row.checklist), ...row.checklist.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`)].join('\n') : '',
    description: clip(plainText(card.description), MAX_DESCRIPTION),
    counts: attachments || row.comments ? `${attachments} / ${row.comments}` : '',
    archived: card.deleted ? 'в архиве' : '',
  };
}

/**
 * The PDF (A4 landscape) of the cards of `folderIds`: a heading, then per board its columns with tables of their
 * cards. `title`: the board or space name; `scope`: what was chosen, for the heading. Returns { blob, pages }.
 */
export async function buildPdf({ folders, folderIds, inbox = false, includeArchived = false, names, title, scope }) {
  const { rows, boards } = await cardRows({ folders, folderIds, inbox, includeArchived, names });
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  await addFonts(doc);
  const heading = `Kanban — ${title || 'доски'}`;
  doc.setProperties({ title: heading, creator: 'Kanban' });
  doc.setLanguage('ru-RU');

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - 2 * MARGIN;
  const bottom = pageHeight - MARGIN - FOOTER;
  let y = MARGIN;

  const write = (text, { size, bold = false, color = INK, gap = 0 }) => {
    doc.setFont(FONT, bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, width);
    doc.text(lines, MARGIN, y, { baseline: 'top', lineHeightFactor: 1.2 });
    y += lines.length * lineHeight(size) + gap;
  };
  const ensure = (height) => {
    if (y + height > bottom) {
      doc.addPage();
      y = MARGIN;
    }
  };

  write(heading, { size: 18, bold: true, gap: 1.5 });
  write(`Выгружено ${formatTime(Date.now())} · ${scope}`, { size: 9.5, color: MUTED, gap: 0.5 });
  write(`Досок: ${boards.length} · карточек: ${rows.length}${includeArchived ? ' · включая карточки из архива' : ''}`,
    { size: 9.5, color: MUTED, gap: 2.5 });
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 5;

  const columns = tableColumns(includeArchived);
  const columnStyles = Object.fromEntries(columns.map((c, i) => [i, { cellWidth: c.width, ...c.style }]));
  for (const board of boards) {
    const own = rows.filter((r) => r.folderId === board.id);
    ensure(own.length ? 32 : 14);
    write(board.path || board.name || 'Без названия', { size: 13, bold: true, gap: 0.5 });
    write(`Карточек: ${own.length}`, { size: 8.5, color: MUTED, gap: 2.5 });
    if (!own.length) {
      write('Нет карточек', { size: 9, color: MUTED, gap: 4 });
      continue;
    }
    const groups = [];
    for (const row of own) {
      if (groups.at(-1)?.index !== row.columnIndex) groups.push({ index: row.columnIndex, name: row.column, rows: [] });
      groups.at(-1).rows.push(row);
    }
    for (const group of groups) {
      ensure(22);
      const label = board.columns.length ? group.name || 'Без названия' : 'Карточки';
      write(`${label} — ${group.rows.length}`, { size: 10.5, bold: true, gap: 1.2 });
      autoTable(doc, {
        startY: y,
        margin: { top: MARGIN + 6, right: MARGIN, bottom: MARGIN + FOOTER, left: MARGIN },
        theme: 'grid',
        rowPageBreak: 'avoid',
        showHead: 'everyPage',
        head: [columns.map((c) => c.header)],
        body: group.rows.map((row) => {
          const values = cells(row);
          return columns.map((c) => values[c.key]);
        }),
        styles: {
          font: FONT, fontStyle: 'normal', fontSize: 8, textColor: INK, cellPadding: 1.4, valign: 'top',
          overflow: 'linebreak', lineColor: RULE, lineWidth: 0.15,
        },
        headStyles: { fillColor: HEAD_FILL, textColor: INK, fontStyle: 'bold', valign: 'middle' },
        columnStyles,
        didParseCell: (data) => {
          if (data.section === 'head') Object.assign(data.cell.styles, { halign: 'left', fontSize: 8, textColor: INK });
        },
        didDrawPage: (data) => {
          if (data.pageNumber === 1) return;
          doc.setFont(FONT, 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(...MUTED);
          doc.text(clip(`${board.path} · ${label} (продолжение)`, 160), MARGIN, MARGIN + 1, { baseline: 'top' });
        },
      });
      y = doc.lastAutoTable.finalY + 5;
    }
    y += 2;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const footerY = pageHeight - MARGIN + 1;
    doc.text(clip(heading, 120), MARGIN, footerY);
    doc.text(`Стр. ${page} из ${pages}`, pageWidth - MARGIN, footerY, { align: 'right' });
  }
  return { blob: doc.output('blob'), pages, cards: rows.length };
}

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { updateCard } from '../actions.js';
import { matchColumn } from '../columnSets.js';
import { db } from '../db.js';
import { flattenFolders, folderPathName, folderTree } from '../folders.js';
import { withoutLinks } from '../links.js';
import { folderIdsOf } from '../people.js';
import { ReminderBadge } from './Card.jsx';
import { personLabel, personOf, useBoardPeople } from './CardPeople.jsx';
import { plural } from './ManageFields.jsx';

const byNumber = (a, b) => (b.number ?? 0) - (a.number ?? 0) || b.position - a.position;

/** «12», «#12»: a card number; else words that all have to be in the title or description. */
function matches(card, needle) {
  const number = needle.match(/^#?(\d+)$/);
  if (number && card.number != null && String(card.number).startsWith(number[1])) return true;
  const text = `${card.title} ${card.description ?? ''}`.toLowerCase();
  return needle.split(/\s+/).every((word) => text.includes(word));
}

const OpenIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

/** The title cell: edited in place, saved on Enter or leaving it, Esc puts it back. */
function TitleCell({ card, readOnly }) {
  const [draft, setDraft] = useState(null);
  const shown = withoutLinks(card.title).trim();
  if (readOnly) return <span className="lt-text">{shown || 'Без названия'}</span>;
  const save = () => {
    const title = draft?.trim();
    if (draft !== null && title && title !== card.title) updateCard(card.id, { title }, { title: card.title });
    setDraft(null);
  };
  return (
    <input className="lt-input" value={draft ?? card.title} placeholder="Без названия" aria-label="Название"
      onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
          setTimeout(() => e.target.blur());
        }
      }} />
  );
}

function SelectCell({ value, options, label, disabled, onChange }) {
  return (
    <select className="lt-select" value={value ?? ''} aria-label={label} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/**
 * The cards as a table whose cells can be edited. `cards` are those the filters leave on the board; `query`
 * (the header's search) looks through every card of the space, on any board. `folders` are all live
 * folders, `targets` those cards may be moved to, `columnsOfFolder` gives a folder's columns.
 */
export default function ListView({ cards, query = '', folders, targets = folders, columnsOfFolder, readOnly, onOpen }) {
  const needle = query.trim().toLowerCase();
  const all = useLiveQuery(() => db.cards.filter((c) => !c.deleted || !!c.conflict).toArray(), []);
  const { people, meId } = useBoardPeople();
  const tree = folderTree(folders);
  const writable = new Set(targets.map((f) => f.id));

  const list = (needle ? (all ?? []).filter((c) => tree.byId.has(c.folderId) && matches(c, needle)) : cards)
    .slice().sort(byNumber);

  const folderOptions = flattenFolders(folders)
    .filter(({ folder }) => writable.has(folder.id))
    .map(({ folder, depth }) => ({ value: folder.id, label: `${'\u00a0\u00a0'.repeat(depth)}${folder.name}` }));
  const peopleOf = (card, current) => {
    const sees = people.filter((p) => p.owner || p.id === meId || folderIdsOf(p).includes(card.folderId));
    const list = current && !sees.some((p) => p.id === current) ? [...sees, personOf(people, current)] : sees;
    return list.map((p) => ({ value: p.id, label: personLabel(p, meId) }));
  };

  function moveTo(card, folderId) {
    const columns = columnsOfFolder(folderId);
    const current = columnsOfFolder(card.folderId).find((c) => c.id === card.columnId);
    const columnId = columns.some((c) => c.id === card.columnId) ? card.columnId : matchColumn(current, columns)?.id;
    updateCard(card.id, { folderId, ...(columnId && { columnId }) });
  }

  return (
    <main className="list-view">
      <p className="list-count">
        {needle
          ? (all ? `Найдено ${list.length} на всех досках` : 'Поиск на всех досках…')
          : `${list.length} ${plural(list.length, 'карточка', 'карточки', 'карточек')} по фильтрам`}
      </p>
      <div className="lt-wrap">
        <table className="lt">
          <thead>
            <tr>
              <th className="lt-num">№</th>
              <th className="lt-title">Название</th>
              <th>Доска</th>
              <th>Колонка</th>
              <th>На ком</th>
              <th>Автор</th>
              <th>Напоминание</th>
              <th className="lt-open" aria-label="Открыть" />
            </tr>
          </thead>
          <tbody>
            {list.map((card) => {
              const folder = tree.byId.get(card.folderId);
              const columns = columnsOfFolder(card.folderId);
              const column = columns.find((c) => c.id === card.columnId) ?? columns[0];
              const locked = readOnly || !!card.conflict || !writable.has(card.folderId);
              const holderId = card.assigneeId || card.authorId;
              return (
                <tr key={card.id} className={card.conflict ? 'lt-conflict' : undefined}>
                  <td className="lt-num">{card.number != null ? `#${card.number}` : ''}</td>
                  <td className="lt-title"><TitleCell card={card} readOnly={locked} /></td>
                  <td>
                    {locked ? <span className="lt-text">{folder && folderPathName(folder, folders, ' › ')}</span> : (
                      <SelectCell label="Доска" value={card.folderId} options={folderOptions}
                        onChange={(id) => moveTo(card, id)} />
                    )}
                  </td>
                  <td>
                    {locked ? <span className="lt-text">{column?.name}</span> : (
                      <SelectCell label="Колонка" value={column?.id}
                        options={columns.map((c) => ({ value: c.id, label: c.name }))}
                        onChange={(columnId) => updateCard(card.id, { columnId })} />
                    )}
                  </td>
                  <td>
                    {locked || !holderId ? <span className="lt-text">{holderId ? personLabel(personOf(people, holderId), meId) : ''}</span> : (
                      <SelectCell label="На ком" value={holderId} options={peopleOf(card, holderId)}
                        onChange={(id) => updateCard(card.id, { assigneeId: id === card.authorId ? null : id })} />
                    )}
                  </td>
                  <td>
                    {locked || !card.authorId ? <span className="lt-text">{card.authorId ? personLabel(personOf(people, card.authorId), meId) : ''}</span> : (
                      <SelectCell label="Автор" value={card.authorId} options={peopleOf(card, card.authorId)}
                        onChange={(id) => updateCard(card.id, { authorId: id, ...(card.assigneeId === id && { assigneeId: null }) })} />
                    )}
                  </td>
                  <td className="lt-reminder"><ReminderBadge card={card} /></td>
                  <td className="lt-open">
                    <button type="button" className="btn btn-small btn-icon-only" title="Открыть карточку"
                      aria-label="Открыть карточку" onClick={() => onOpen(card.id)}><OpenIcon /></button>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (all || !needle) && (
              <tr><td className="list-empty" colSpan={8}>{needle ? 'Ничего не найдено' : 'Карточек нет'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

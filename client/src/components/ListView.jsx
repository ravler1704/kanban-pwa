import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { folderPathName, folderTree } from '../folders.js';
import { withoutLinks } from '../links.js';
import { plural } from './ManageFields.jsx';

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

const byNumber = (a, b) => (b.number ?? 0) - (a.number ?? 0) || b.position - a.position;

/** «12», «#12»: a card number; else words that all have to be in the title or description. */
function matches(card, needle) {
  const number = needle.match(/^#?(\d+)$/);
  if (number && card.number != null && String(card.number).startsWith(number[1])) return true;
  const text = `${card.title} ${card.description ?? ''}`.toLowerCase();
  return needle.split(/\s+/).every((word) => text.includes(word));
}

/**
 * The cards as one list, without columns. `cards` are those the filters leave on the board; a search looks
 * through every card of the board, in any folder. `folders` are all live folders, `columnsOfFolder` gives
 * a folder's columns.
 */
export default function ListView({ cards, folders, columnsOfFolder, onOpen }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const all = useLiveQuery(() => db.cards.filter((c) => !c.deleted || !!c.conflict).toArray(), []);
  const tree = folderTree(folders);

  const list = (needle ? (all ?? []).filter((c) => tree.byId.has(c.folderId) && matches(c, needle)) : cards)
    .slice().sort(byNumber);
  const columnName = (card) => {
    const columns = columnsOfFolder(card.folderId);
    return (columns.find((c) => c.id === card.columnId) ?? columns[0])?.name;
  };

  return (
    <main className="list-view">
      <label className="fp-search list-search">
        <SearchIcon />
        <input type="search" placeholder="Найти карточку: номер, название или описание" value={query}
          aria-label="Найти карточку" onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className="list-count">
        {needle
          ? `Найдено ${list.length} во всех папках`
          : `${list.length} ${plural(list.length, 'карточка', 'карточки', 'карточек')} по фильтрам · поиск ищет во всех папках`}
      </p>
      <ul className="list-cards">
        {list.map((card) => {
          const folder = tree.byId.get(card.folderId);
          const title = withoutLinks(card.title).trim() || 'Без названия';
          return (
            <li key={card.id}>
              <button type="button" className={`list-card ${card.conflict ? 'list-card-conflict' : ''}`}
                onClick={() => onOpen(card.id)}>
                {card.number != null && <span className="list-card-number">#{card.number}</span>}
                <span className="list-card-body">
                  <span className="list-card-title">{title}</span>
                  <span className="list-card-meta">
                    {[folder && folderPathName(folder, folders, ' › '), columnName(card)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="list-empty">{needle ? 'Ничего не найдено' : 'Карточек нет'}</li>
        )}
      </ul>
    </main>
  );
}

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { childrenOf, flattenFolders, folderPath } from '../folders.js';
import Modal from './Modal.jsx';

const SEARCH_FROM = 7;
const COLLAPSED_KEY = 'folderFilterCollapsed';

const svg = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 16);

function readCollapsed() {
  try {
    const ids = JSON.parse(localStorage.getItem(COLLAPSED_KEY));
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

/** A round check like in iOS: true, false or 'mixed'. */
function RoundCheck({ state }) {
  return (
    <span className={`ff-check ${state ? 'ff-check-on' : ''}`} aria-hidden="true">
      {state === 'mixed' ? svg(<path d="M7 12h10" />, 14) : state ? svg(<path d="m6 12 4 4 8-9" />, 14) : null}
    </span>
  );
}

/**
 * Which folders the board shows, like «Календари» in iOS: one list with the nesting as indents, a tap
 * checks or unchecks a folder with everything inside it, the arrow folds a branch in place; changes apply
 * at once. `filter` is { selected, indeterminate, onToggle, onSetAll } over folder ids.
 */
function FolderFilterDialog({ folders, filter, onClose }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const fold = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    return next;
  });
  const stateOf = (id) => (filter.indeterminate.includes(id) ? 'mixed' : filter.selected.includes(id));

  const rows = [];
  if (needle) {
    for (const { folder } of flattenFolders(folders)) {
      if (folder.name.toLowerCase().includes(needle)) rows.push({ folder, depth: 0, search: true });
    }
  } else {
    const hiddenUnder = new Set();
    for (const { folder, depth } of flattenFolders(folders)) {
      if (hiddenUnder.has(folder.parentId)) {
        hiddenUnder.add(folder.id);
        continue;
      }
      if (collapsed.has(folder.id)) hiddenUnder.add(folder.id);
      rows.push({ folder, depth });
    }
  }
  const allOn = filter.selected.length === folders.length;

  return (
    <Modal title="Папки" onClose={onClose} className="folder-picker folder-filter-sheet" closeButton>
      {folders.length >= SEARCH_FROM && (
        <label className="fp-search">
          <SearchIcon />
          <input type="search" placeholder="Поиск папки" value={query} aria-label="Поиск папки"
            onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      <ul className="fp-list ff-list">
        {rows.map(({ folder, depth, search }) => {
          const state = stateOf(folder.id);
          const parent = !search && childrenOf(folders, folder.id).length > 0;
          const open = parent && !collapsed.has(folder.id);
          const where = search && folderPath(folder, folders).slice(0, -1).map((p) => p.name).join(' › ');
          return (
            <li key={folder.id} className="fp-row">
              <button type="button" className="fp-pick ff-pick" role="checkbox" aria-checked={state}
                style={{ paddingLeft: `${0.8 + depth * 1.4}rem` }} onClick={() => filter.onToggle(folder.id)}>
                <RoundCheck state={state} />
                <span className="fp-text">
                  <span className="fp-name">{folder.name}</span>
                  {where && <span className="fp-meta">{where}</span>}
                </span>
              </button>
              {parent && (
                <button type="button" className={`ff-fold ${open ? 'ff-fold-open' : ''}`} onClick={() => fold(folder.id)}
                  aria-expanded={open} aria-label={open ? `Свернуть «${folder.name}»` : `Развернуть «${folder.name}»`}
                  title={open ? 'Свернуть' : 'Развернуть'}>
                  {svg(<path d="m9 6 6 6-6 6" />)}
                </button>
              )}
            </li>
          );
        })}
        {rows.length === 0 && <li className="fp-empty">Ничего не найдено</li>}
      </ul>
      <div className="actions fp-actions ff-actions">
        <button type="button" className="btn" onClick={() => filter.onSetAll(!allOn)}>
          {allOn ? 'Скрыть все' : 'Показать все'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

/** The «Папки» field of the board: shows `filter.summary` and opens the list of folders. */
export default function FolderFilter({ folders, filter }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field folder-filter">
      <button type="button" className="select folder-field" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="picker-label">Папки</span>
        <span className="picker-value">{filter.summary}</span>
      </button>
      {open && createPortal(
        <FolderFilterDialog folders={folders} filter={filter} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </div>
  );
}

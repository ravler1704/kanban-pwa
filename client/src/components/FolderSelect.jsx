import { useState } from 'react';
import { createPortal } from 'react-dom';
import { childrenOf, descendants, flattenFolders, folderPath, folderPathName, folderTree } from '../folders.js';
import { Chevron } from './ManageFields.jsx';
import Modal from './Modal.jsx';

const SEARCH_FROM = 7;

function FolderIcon() {
  return (
    <svg className="tree-folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

/**
 * The folders one level at a time, like in the board settings: a row picks the folder, its arrow opens it.
 * Folders in `exclude` can't be picked but can be opened when something inside them can.
 */
function FolderPickerDialog({ title, folders, value, exclude, topLabel, onPick, onClose }) {
  const tree = folderTree(folders);
  const selected = value ? tree.byId.get(value) : null;
  const [currentId, setCurrentId] = useState(() => (selected ? tree.parentOf(selected) : null));
  const current = currentId ? tree.byId.get(currentId) ?? null : null;
  const path = current ? folderPath(current, folders) : [];
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const pickable = (f) => !exclude?.has(f.id);
  const openable = (f) => descendants(folders, f.id).some(pickable);
  const list = needle
    ? flattenFolders(folders).map(({ folder }) => folder).filter((f) => pickable(f) && f.name.toLowerCase().includes(needle))
    : childrenOf(folders, current?.id ?? null).filter((f) => pickable(f) || openable(f));
  const pick = (id) => {
    onPick(id);
    onClose();
  };
  const open = (id) => {
    setQuery('');
    setCurrentId(id);
  };

  return (
    <Modal title={title} onClose={onClose} className="folder-picker" closeButton>
      {folders.length >= SEARCH_FROM && (
        <input type="search" className="manage-search" placeholder="Поиск папки" autoFocus value={query}
          onChange={(e) => setQuery(e.target.value)} />
      )}
      {!needle && (
        <nav className="breadcrumbs" aria-label="Путь">
          <button type="button" className="crumb" disabled={!current} onClick={() => open(null)}>Все папки</button>
          {path.map((f, i) => (
            <span key={f.id} className="crumb-item">
              <span className="crumb-sep" aria-hidden="true">›</span>
              <button type="button" className="crumb" disabled={i === path.length - 1} onClick={() => open(f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div className="picker-list">
        {!needle && !current && topLabel && (
          <div className={`picker-row ${value === '' ? 'picker-row-selected' : ''}`}>
            <button type="button" className="picker-pick" onClick={() => pick('')}>
              <span className="tree-label">{topLabel}</span>
            </button>
          </div>
        )}
        {list.map((f) => {
          const kids = childrenOf(folders, f.id).length;
          const where = needle && folderPath(f, folders).slice(0, -1).map((p) => p.name).join(' › ');
          return (
            <div key={f.id} className={`picker-row ${f.id === value ? 'picker-row-selected' : ''}`}>
              <button type="button" className="picker-pick" disabled={!pickable(f)}
                title={pickable(f) ? 'Выбрать эту папку' : 'Эту папку выбрать нельзя'} onClick={() => pick(f.id)}>
                <FolderIcon />
                <span className="tree-title">
                  <span className="tree-label">{f.name}</span>
                  {(where || kids > 0) && <span className="tree-meta">{where || `вложенных: ${kids}`}</span>}
                </span>
              </button>
              {!needle && openable(f) && (
                <button type="button" className="btn btn-small btn-icon-only picker-open" title="Открыть папку"
                  aria-label={`Открыть «${f.name}»`} onClick={() => open(f.id)}>
                  <Chevron />
                </button>
              )}
            </div>
          );
        })}
        {list.length === 0 && <p className="muted">{needle ? 'Ничего не найдено.' : 'Здесь нет папок для выбора.'}</p>}
      </div>
    </Modal>
  );
}

/**
 * A labelled folder field (`value` is the id) that opens the folder picker. `exclude` is a set of ids that
 * can't be picked; with `topLabel` the top level ('') can be picked too.
 */
export default function FolderSelect({ label = 'Папка', folders, value, onChange, exclude, topLabel, className = '' }) {
  const [open, setOpen] = useState(false);
  const folder = value ? folderTree(folders).byId.get(value) : null;
  const text = folder ? folderPathName(folder, folders, ' › ') : (value === '' && topLabel) || 'Не выбрана';
  return (
    <div className={`field ${className}`}>
      <button type="button" className="select folder-field" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="picker-label">{label}</span>
        <span className="picker-value">{text}</span>
      </button>
      {open && createPortal(
        <FolderPickerDialog title={label} folders={folders} value={value} exclude={exclude} topLabel={topLabel}
          onPick={onChange} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </div>
  );
}

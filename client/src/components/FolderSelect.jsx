import { useState } from 'react';
import { createPortal } from 'react-dom';
import { childrenOf, descendants, flattenFolders, folderPath, folderPathName, folderTree } from '../folders.js';
import { Chevron, plural } from './ManageFields.jsx';
import Modal from './Modal.jsx';

const SEARCH_FROM = 7;

const svg = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const FolderIcon = () => svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />);
const AllIcon = () => svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
  <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>);
const CheckIcon = () => svg(<path d="m5 12 5 5 9-10" />);
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 16);
const BackIcon = () => svg(<path d="m15 18-6-6 6-6" />);

/** One line of the picker: picks on click; `onOpen` adds an arrow that opens the folder. */
function PickerRow({ icon, name, meta, selected, disabled, onPick, onOpen, openLabel, accent = false }) {
  return (
    <li className={`fp-row ${selected ? 'fp-row-selected' : ''} ${accent ? 'fp-row-accent' : ''}`}>
      <button type="button" className="fp-pick" disabled={disabled} onClick={onPick}>
        <span className="fp-icon">{icon}</span>
        <span className="fp-text">
          <span className="fp-name">{name}</span>
          {meta && <span className="fp-meta">{meta}</span>}
        </span>
        {selected && <span className="fp-check"><CheckIcon /></span>}
      </button>
      {onOpen && (
        <button type="button" className="fp-open" title="Открыть папку" aria-label={openLabel} onClick={onOpen}>
          <Chevron />
        </button>
      )}
    </li>
  );
}

const countLabel = (n) => `${n} ${plural(n, 'папка', 'папки', 'папок')}`;

/**
 * The folders one level at a time, like in the board settings: a row picks the folder, its arrow opens it;
 * inside a folder the first row picks the folder itself. Folders in `exclude` can't be picked but can be
 * opened when something inside them can.
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
        <label className="fp-search">
          <SearchIcon />
          <input type="search" placeholder="Поиск папки" value={query} aria-label="Поиск папки"
            onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {!needle && (
        <nav className="fp-nav" aria-label="Путь">
          <button type="button" className="fp-back" disabled={!current} title="Назад" aria-label="Назад"
            onClick={() => open(tree.parentOf(current))}>
            <BackIcon />
          </button>
          <div className="breadcrumbs">
            <button type="button" className="crumb" disabled={!current} onClick={() => open(null)}>Все папки</button>
            {path.map((f, i) => (
              <span key={f.id} className="crumb-item">
                <span className="crumb-sep" aria-hidden="true">›</span>
                <button type="button" className="crumb" disabled={i === path.length - 1} onClick={() => open(f.id)}>
                  {f.name}
                </button>
              </span>
            ))}
          </div>
        </nav>
      )}
      <ul className="fp-list">
        {!needle && !current && topLabel && (
          <PickerRow accent icon={<AllIcon />} name={topLabel} selected={value === ''} onPick={() => pick('')} />
        )}
        {!needle && current && pickable(current) && (
          <PickerRow accent icon={<FolderIcon />} name={`Вся папка «${current.name}»`}
            meta={descendants(folders, current.id).length ? 'вместе со всем, что внутри' : null}
            selected={value === current.id} onPick={() => pick(current.id)} />
        )}
        {list.map((f) => {
          const kids = childrenOf(folders, f.id).length;
          const where = needle && folderPath(f, folders).slice(0, -1).map((p) => p.name).join(' › ');
          return (
            <PickerRow key={f.id} icon={<FolderIcon />} name={f.name}
              meta={where || (kids ? countLabel(kids) : null)}
              selected={f.id === value} disabled={!pickable(f)} onPick={() => pick(f.id)}
              onOpen={!needle && openable(f) ? () => open(f.id) : null} openLabel={`Открыть «${f.name}»`} />
          );
        })}
        {list.length === 0 && (
          <li className="fp-empty">{needle ? 'Ничего не найдено' : 'Вложенных папок нет'}</li>
        )}
      </ul>
    </Modal>
  );
}

/**
 * A labelled folder field (`value` is the id) that opens the folder picker. `exclude` is a set of ids that
 * can't be picked; with `topLabel` the top level ('') can be picked too. `text` replaces the shown value.
 */
export default function FolderSelect({
  label = 'Папка', folders, value, onChange, exclude, topLabel, className = '', text: textOverride,
}) {
  const [open, setOpen] = useState(false);
  const folder = value ? folderTree(folders).byId.get(value) : null;
  const text = textOverride ?? (folder ? folderPathName(folder, folders, ' › ') : (value === '' && topLabel) || 'Не выбрана');
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

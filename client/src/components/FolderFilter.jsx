import { useState } from 'react';
import { createPortal } from 'react-dom';
import { childrenOf, descendants, flattenFolders, folderPath, folderTree } from '../folders.js';
import { Chevron } from './ManageFields.jsx';
import Modal from './Modal.jsx';

const svg = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 16);
const BackIcon = () => svg(<path d="m15 18-6-6 6-6" />, 20);

/** The dialogs show a search from this many items. */
export const SEARCH_FROM = 7;

export function SearchField({ placeholder, value, onChange }) {
  return (
    <label className="fp-search">
      <SearchIcon />
      <input type="search" placeholder={placeholder} value={value} aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** An iOS-like switch: the whole line is the control. */
export function SwitchRow({ label, meta, on, onChange, strong = false }) {
  return (
    <li className="fp-row">
      <button type="button" role="switch" aria-checked={on} className="fp-pick ff-row" onClick={() => onChange(!on)}>
        <span className="fp-text">
          <span className={`fp-name ${strong ? 'ff-strong' : ''}`}>{label}</span>
          {meta && <span className="fp-meta">{meta}</span>}
        </span>
        <span className={`ff-switch ${on ? 'ff-switch-on' : ''}`} aria-hidden="true"><span className="ff-knob" /></span>
      </button>
    </li>
  );
}

/** A folder with subfolders: the line opens it, its own switch shows or hides it with everything inside. */
function GroupRow({ label, meta, on, onChange, onOpen }) {
  return (
    <li className="fp-row">
      <button type="button" className="fp-pick ff-row ff-open" onClick={onOpen} title="Открыть">
        <span className="fp-text">
          <span className="fp-name">{label}</span>
          {meta && <span className="fp-meta">{meta}</span>}
        </span>
      </button>
      <button type="button" role="switch" aria-checked={on} aria-label={`Показывать «${label}»`}
        className="ff-switch-btn" onClick={() => onChange(!on)}>
        <span className={`ff-switch ${on ? 'ff-switch-on' : ''}`} aria-hidden="true"><span className="ff-knob" /></span>
      </button>
      <button type="button" className="ff-chevron-btn" onClick={onOpen} aria-label={`Открыть «${label}»`}>
        <Chevron />
      </button>
    </li>
  );
}

/** «Фильмы, Субару и ещё 2» */
function names(list) {
  const shown = list.slice(0, 3).map((f) => f.name).join(', ');
  return list.length > 3 ? `${shown} и ещё ${list.length - 3}` : shown;
}

/**
 * Which folders the board shows, like the iOS settings: one level per screen; a folder with subfolders
 * opens (its state on the right), one without them is a switch; inside a folder the first switch shows or
 * hides it with everything inside. Changes apply at once. `filter` is { selected, onSetFolder(id, on),
 * onSetAll(on) } over folder ids; onSetFolder checks or unchecks the folder with everything inside it.
 */
function FolderFilterDialog({ folders, filter, onClose }) {
  const tree = folderTree(folders);
  const [currentId, setCurrentId] = useState(null);
  const current = currentId ? tree.byId.get(currentId) ?? null : null;
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const on = (id) => filter.selected.includes(id);
  const subtree = (id) => [id, ...descendants(folders, id).map((f) => f.id)];
  // What differs inside a folder from the folder itself: the topmost folders switched the other way.
  const insideOf = (id) => {
    const value = on(id);
    const differ = descendants(folders, id).filter((f) => on(f.id) !== value && on(tree.parentOf(f)) === value);
    if (!differ.length) return null;
    return value ? `кроме ${names(differ)}` : `только ${names(differ)}`;
  };
  const allOn = filter.selected.length === folders.length;
  const open = (id) => {
    setQuery('');
    setCurrentId(id);
  };

  const list = needle
    ? flattenFolders(folders).map(({ folder }) => folder).filter((f) => f.name.toLowerCase().includes(needle))
    : childrenOf(folders, currentId);
  const row = (f) => {
    const where = needle && folderPath(f, folders).slice(0, -1).map((p) => p.name).join(' › ');
    const set = (v) => filter.onSetFolder(f.id, v);
    if (!childrenOf(folders, f.id).length) {
      return <SwitchRow key={f.id} label={f.name} meta={where} on={on(f.id)} onChange={set} />;
    }
    const inside = insideOf(f.id);
    return (
      <GroupRow key={f.id} label={f.name} meta={[where, inside].filter(Boolean).join(' · ')} on={on(f.id)}
        onChange={set} onOpen={() => open(f.id)} />
    );
  };
  const parent = current ? tree.byId.get(tree.parentOf(current)) : null;

  return (
    <Modal title={current ? current.name : 'Папки'} onClose={onClose} className="folder-picker folder-filter-sheet" closeButton>
      {current && (
        <button type="button" className="ff-back" onClick={() => open(parent?.id ?? null)}>
          <BackIcon />
          <span>{parent ? parent.name : 'Папки'}</span>
        </button>
      )}
      {!current && folders.length >= SEARCH_FROM && (
        <SearchField placeholder="Поиск папки" value={query} onChange={setQuery} />
      )}
      {!needle && (
        <ul className="fp-list ff-group">
          {current ? (
            <SwitchRow strong label={`Показывать «${current.name}»`} on={on(current.id)}
              meta={childrenOf(folders, current.id).length ? insideOf(current.id) ?? 'вместе со всем, что внутри' : null}
              onChange={(v) => filter.onSetFolder(current.id, v)} />
          ) : (
            <SwitchRow strong label="Показывать все папки" on={allOn} meta={allOn ? null : `Сейчас: ${filter.summary}`}
              onChange={(v) => filter.onSetAll(v)} />
          )}
        </ul>
      )}
      <ul className="fp-list ff-list">
        {list.map(row)}
        {list.length === 0 && <li className="fp-empty">{needle ? 'Ничего не найдено' : 'Вложенных папок нет'}</li>}
      </ul>
      <div className="actions fp-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

/** A field of the board's filters: shows `value` and opens `dialog(onClose)`. */
export function DialogField({ label, value, title, dialog }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field folder-filter">
      <button type="button" className="select folder-field" aria-haspopup="dialog" title={title}
        onClick={() => setOpen(true)}>
        <span className="picker-label">{label}</span>
        <span className="picker-value">{value}</span>
      </button>
      {open && createPortal(dialog(() => setOpen(false)), document.body)}
    </div>
  );
}

/** The «Папки» field of the board: shows `filter.summary` and opens the folder settings. */
export default function FolderFilter({ folders, filter }) {
  return (
    <DialogField label="Папки" value={filter.summary}
      dialog={(onClose) => <FolderFilterDialog folders={folders} filter={filter} onClose={onClose} />} />
  );
}

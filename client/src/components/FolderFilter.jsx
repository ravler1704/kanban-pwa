import { useState } from 'react';
import { createPortal } from 'react-dom';
import { childrenOf, descendants, flattenFolders, folderPath, folderTree } from '../folders.js';
import { Chevron } from './ManageFields.jsx';
import Modal from './Modal.jsx';

const SEARCH_FROM = 7;

const svg = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 16);
const BackIcon = () => svg(<path d="m15 18-6-6 6-6" />, 20);

/** An iOS-like switch: the whole line is the control. */
function SwitchRow({ label, meta, on, onChange, strong = false }) {
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

/** A line that opens a folder; `status` is said on the right, like a value in iOS settings. */
function GroupRow({ label, meta, status, onOpen }) {
  return (
    <li className="fp-row">
      <button type="button" className="fp-pick ff-row" onClick={onOpen}>
        <span className="fp-text">
          <span className="fp-name">{label}</span>
          {meta && <span className="fp-meta">{meta}</span>}
        </span>
        <span className="ff-status">{status}</span>
        <span className="fp-chevron"><Chevron /></span>
      </button>
    </li>
  );
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
  const statusOf = (id) => {
    const ids = subtree(id);
    const n = ids.filter(on).length;
    return n === ids.length ? 'Все' : n === 0 ? 'Выкл.' : `${n} из ${ids.length}`;
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
    return childrenOf(folders, f.id).length
      ? <GroupRow key={f.id} label={f.name} meta={where} status={statusOf(f.id)} onOpen={() => open(f.id)} />
      : <SwitchRow key={f.id} label={f.name} meta={where} on={on(f.id)} onChange={(v) => filter.onSetFolder(f.id, v)} />;
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
        <label className="fp-search">
          <SearchIcon />
          <input type="search" placeholder="Поиск папки" value={query} aria-label="Поиск папки"
            onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {!needle && (
        <ul className="fp-list ff-group">
          {current ? (
            <SwitchRow strong label={`Показывать «${current.name}»`} on={on(current.id)}
              meta={!childrenOf(folders, current.id).length ? null
                : statusOf(current.id) === 'Все' || statusOf(current.id) === 'Выкл.' ? 'вместе со всем, что внутри'
                  : `показано ${statusOf(current.id)}`}
              onChange={(v) => filter.onSetFolder(current.id, v)} />
          ) : (
            <SwitchRow strong label="Показывать все папки" on={allOn} onChange={(v) => filter.onSetAll(v)} />
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

/** The «Папки» field of the board: shows `filter.summary` and opens the folder settings. */
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

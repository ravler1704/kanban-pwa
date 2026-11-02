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
const CheckIcon = () => svg(<path d="m5 12 5 5 9-10" />);
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 16);
const BackIcon = () => svg(<path d="m15 18-6-6 6-6" />);

/** A tri-state checkbox; `checked` is true, false or 'mixed'. */
function CheckBox({ checked, label, onToggle }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} title={label}
      className={`fp-checkbox ${checked ? 'fp-checkbox-on' : ''}`} onClick={onToggle}>
      {checked === 'mixed' ? svg(<path d="M6 12h12" />, 14) : checked ? svg(<path d="m5 12 5 5 9-10" />, 14) : null}
    </button>
  );
}

/**
 * One line of the picker; `openable` shows the arrow of a folder that opens on click. With `checked` the
 * line starts with a checkbox.
 */
function PickerRow({ name, meta, chosen, openable, onClick, checked, onCheck }) {
  return (
    <li className={`fp-row ${chosen ? 'fp-row-selected' : ''}`}>
      {checked !== undefined && (
        <span className="fp-checkcell">
          <CheckBox checked={checked} label={checked === true ? `Исключить «${name}»` : `Включить «${name}»`}
            onToggle={onCheck} />
        </span>
      )}
      <button type="button" className="fp-pick" onClick={(e) => e.detail < 2 && onClick()}>
        <span className="fp-icon"><FolderIcon /></span>
        <span className="fp-text">
          <span className="fp-name">{name}</span>
          {meta && <span className="fp-meta">{meta}</span>}
        </span>
        {chosen && <span className="fp-check"><CheckIcon /></span>}
        {openable && <span className="fp-chevron"><Chevron /></span>}
      </button>
    </li>
  );
}

const countLabel = (n) => `${n} ${plural(n, 'папка', 'папки', 'папок')}`;

/**
 * The folders one level at a time, like «Переместить» in file managers: a folder with subfolders opens on
 * click, one without them is picked at once; the button at the bottom picks the open folder (the top level
 * with `topLabel`). Folders in `exclude` can't be picked but can be opened when something inside them can.
 */
function FolderPickerDialog({ title, folders, value, exclude, topLabel, checks, onPick, onClose }) {
  const tree = folderTree(folders);
  const selected = value ? tree.byId.get(value) : null;
  const [currentId, setCurrentId] = useState(() => (selected && !checks ? tree.parentOf(selected) : null));
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
  const click = (f) => {
    if (openable(f)) open(f.id);
    else if (checks) checks.onToggle(f.id);
    else pick(f.id);
  };
  const checkedOf = (f) => (checks?.indeterminate.includes(f.id) ? 'mixed' : checks?.selected.includes(f.id) ?? false);
  const allOn = checks && checks.selected.length === folders.length;

  const targetId = current ? current.id : topLabel ? '' : null;
  const canPick = targetId === '' || (current != null && pickable(current));
  const targetName = current ? `«${current.name}»` : topLabel ? `«${topLabel}»` : '';

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
        {list.map((f) => {
          const kids = childrenOf(folders, f.id).length;
          const where = needle && folderPath(f, folders).slice(0, -1).map((p) => p.name).join(' › ');
          return (
            <PickerRow key={f.id} name={f.name} meta={where || (kids ? countLabel(kids) : null)}
              chosen={!checks && f.id === value} openable={openable(f)} onClick={() => click(f)}
              checked={checks ? checkedOf(f) : undefined} onCheck={() => checks.onToggle(f.id)} />
          );
        })}
        {list.length === 0 && (
          <li className="fp-empty">{needle ? 'Ничего не найдено' : 'Вложенных папок нет'}</li>
        )}
      </ul>
      {checks ? (
        <div className="actions fp-actions fp-actions-split">
          <button type="button" className="btn" onClick={() => checks.onSetAll(!allOn)}>
            {allOn ? 'Снять все' : 'Выбрать все'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
        </div>
      ) : (
        <div className="actions fp-actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary fp-confirm" disabled={!canPick} onClick={() => pick(targetId)}>
            {canPick ? `Выбрать ${targetName}` : 'Выберите папку'}
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * A labelled folder field (`value` is the id) that opens the folder picker. `exclude` is a set of ids that
 * can't be picked; with `topLabel` the top level ('') can be picked too. `text` replaces the shown value.
 * With `checks` ({ selected, indeterminate, onToggle, onSetAll } over folder ids) the picker shows
 * checkboxes that apply at once instead of picking one folder.
 */
export default function FolderSelect({
  label = 'Папка', folders, value, onChange, exclude, topLabel, checks, className = '', text: textOverride,
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
          checks={checks} onPick={onChange} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </div>
  );
}

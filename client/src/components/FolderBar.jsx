import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import { publicToken } from '../board.js';
import ColumnSetFilter from './ColumnSetFilter.jsx';
import FolderFilter, { SwitchRow } from './FolderFilter.jsx';
import Modal from './Modal.jsx';
import PersonFilter from './PersonFilter.jsx';
import TagFilter from './TagFilter.jsx';

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8.5V19l-4 2v-7.5Z" />
    </svg>
  );
}

// The filters behind the toggle are shown while it is on; the main ones always are.
function SlidersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
    </svg>
  );
}

const FILTERS_OPEN_KEY = 'filtersOpen';
const MAIN_FILTERS_KEY = 'mainFilters';
const DEFAULT_MAIN = ['folders'];

const FILTERS = [
  { id: 'folders', label: 'Папки' },
  { id: 'columns', label: 'Колонки', note: 'Когда в виду папки с разными наборами колонок' },
  { id: 'tags', label: 'Теги', note: 'Когда у карточек есть теги' },
  { id: 'author', label: 'Автор' },
  { id: 'holder', label: 'На ком' },
];

function readMain() {
  try {
    const list = JSON.parse(localStorage.getItem(MAIN_FILTERS_KEY));
    return Array.isArray(list) ? list : DEFAULT_MAIN;
  } catch {
    return DEFAULT_MAIN;
  }
}

function FilterSettings({ main, onChange, onClose }) {
  return (
    <Modal title="Фильтры" onClose={onClose} className="folder-picker folder-filter-sheet" closeButton>
      <p className="fp-hint">Основные фильтры всегда на виду, остальные открываются кнопкой фильтров.</p>
      <ul className="fp-list ff-list">
        {FILTERS.filter((f) => f.id !== 'folders' || !publicToken).map((f) => (
          <SwitchRow key={f.id} label={f.label} on={main.includes(f.id)}
            meta={[main.includes(f.id) ? 'Основной' : 'Под кнопкой', f.note].filter(Boolean).join(' · ')}
            onChange={(on) => onChange(on ? [...main, f.id] : main.filter((id) => id !== f.id))} />
        ))}
      </ul>
      <div className="actions fp-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

const VIEWS = [
  { id: 'board', label: 'Доска', Icon: BoardIcon },
  { id: 'calendar', label: 'Календарь', Icon: CalendarIcon },
  { id: 'list', label: 'Список', Icon: ListIcon },
];

/**
 * `folderFilter` is { selected, indeterminate, onToggle, onSetFolder, onSetAll, onClear, summary } over the ids of
 * `folders` (all live folders). `conflictsByFolder` is { [folderId]: number of cards
 * with a conflict }. Without `onManage` / `onAddCard` (read only) their buttons are not shown.
 */
export default function FolderBar({
  folders, folderFilter, conflictsByFolder, columnSets, columnSetId, onSelectColumnSet, tagFilter, authorFilter, holderFilter,
  view, onView, onManage, onAddCard, children,
}) {
  const [filtersOpen, setFiltersOpen] = useState(() => localStorage.getItem(FILTERS_OPEN_KEY) === '1');
  const toggleFilters = () => {
    localStorage.setItem(FILTERS_OPEN_KEY, filtersOpen ? '0' : '1');
    setFiltersOpen(!filtersOpen);
  };
  const [main, setMain] = useState(readMain);
  const changeMain = (next) => {
    setMain(next);
    localStorage.setItem(MAIN_FILTERS_KEY, JSON.stringify(next));
  };
  const [configuring, setConfiguring] = useState(false);

  const hasPeople = (f) => f && (f.counts.size > 0 || f.selected.length > 0);
  const filters = [
    !publicToken && {
      id: 'folders', active: Boolean(folderFilter.onClear),
      node: <FolderFilter folders={folders} filter={folderFilter} />,
    },
    columnSets && {
      id: 'columns', active: false,
      node: <ColumnSetFilter columnSets={columnSets} value={columnSetId} onChange={onSelectColumnSet} />,
    },
    tagFilter && { id: 'tags', active: tagFilter.selected.length > 0, node: <TagFilter {...tagFilter} /> },
    hasPeople(authorFilter) && {
      id: 'author', active: authorFilter.selected.length > 0,
      node: <PersonFilter label="Автор" title="Автор" {...authorFilter} />,
    },
    hasPeople(holderFilter) && {
      id: 'holder', active: holderFilter.selected.length > 0,
      node: <PersonFilter label="На ком" title="На ком карточка" {...holderFilter} />,
    },
  ].filter(Boolean);
  const shown = filters.filter((f) => filtersOpen || main.includes(f.id));
  // A hidden filter that narrows the board: marked on the toggle.
  const filtered = !filtersOpen && filters.some((f) => f.active && !main.includes(f.id));

  const filterRow = (
    <div className="projectbar-row">
      {shown.map((f) => <Fragment key={f.id}>{f.node}</Fragment>)}
      {filtersOpen && (
        <button type="button" className="btn btn-small btn-icon-only filters-settings" title="Настроить фильтры"
          aria-label="Настроить фильтры" onClick={() => setConfiguring(true)}>
          <SlidersIcon />
        </button>
      )}
      {configuring && createPortal(
        <FilterSettings main={main} onChange={changeMain} onClose={() => setConfiguring(false)} />,
        document.body,
      )}
    </div>
  );

  return (
    <nav className="projectbar">
      <div className="projectbar-row projectbar-actions">
        <button type="button" className={`btn btn-small btn-icon-only filters-toggle ${filtersOpen ? 'active' : ''}`}
          aria-pressed={filtersOpen} onClick={toggleFilters}
          title={filtersOpen ? 'Скрыть дополнительные фильтры'
            : `Все фильтры${filtered ? ' (доска отфильтрована скрытым фильтром)' : ''}`}
          aria-label={filtersOpen ? 'Скрыть дополнительные фильтры' : 'Все фильтры'}>
          <FilterIcon />
          {filtered && <span className="filters-dot" aria-hidden="true" />}
        </button>

        {children}

        <div className="view-switch" role="group" aria-label="Вид">
          {VIEWS.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={`view-switch-btn ${view === id ? 'active' : ''}`}
              title={label} aria-label={label} aria-pressed={view === id} onClick={() => onView(id)}>
              <Icon />
            </button>
          ))}
        </div>
        {onManage && (
          <button className="btn btn-small btn-icon-only" title="Настройки доски" aria-label="Настройки доски"
            onClick={onManage}>
            <SettingsIcon />
          </button>
        )}
        {onAddCard && (
          <button className="btn btn-primary btn-small btn-icon-only btn-add-card" title="Новая карточка" aria-label="Новая карточка"
            onClick={onAddCard}>
            <PlusIcon />
          </button>
        )}
      </div>

      {filterRow}
    </nav>
  );
}

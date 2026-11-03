import { useState } from 'react';
import { publicToken } from '../board.js';
import FolderFilter from './FolderFilter.jsx';
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

const FILTERS_HIDDEN_KEY = 'filtersHidden';

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
  folders, folderFilter, conflictsByFolder, columnSets, columnSetId, onSelectColumnSet, tagFilter,
  view, onView, onManage, onAddCard, children,
}) {
  const [filtersHidden, setFiltersHidden] = useState(() => localStorage.getItem(FILTERS_HIDDEN_KEY) === '1');
  const toggleFilters = () => {
    localStorage.setItem(FILTERS_HIDDEN_KEY, filtersHidden ? '0' : '1');
    setFiltersHidden(!filtersHidden);
  };

  // A filter that narrows the board: shown on the toggle while the filters are hidden.
  const filtered = Boolean(folderFilter.onClear || tagFilter?.selected.length);

  const filters = !filtersHidden && (
    <div className="projectbar-row">
      {!publicToken && (
        <FolderFilter folders={folders} filter={folderFilter} />
      )}

      {columnSets && (
        <div className="picker">
          <label className="picker-label" htmlFor="column-set-select">Колонки</label>
          <select id="column-set-select" className="select" value={columnSetId}
            title="Папки с разными наборами колонок показываются по отдельности"
            onChange={(e) => onSelectColumnSet(e.target.value)}>
            {columnSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {tagFilter && <TagFilter {...tagFilter} />}
    </div>
  );

  return (
    <nav className="projectbar">
      <div className="projectbar-row projectbar-actions">
        <button type="button" className={`btn btn-small btn-icon-only filters-toggle ${filtersHidden ? '' : 'active'}`}
          aria-pressed={!filtersHidden} onClick={toggleFilters}
          title={filtersHidden ? `Показать фильтры${filtered ? ' (доска отфильтрована)' : ''}` : 'Скрыть фильтры'}
          aria-label={filtersHidden ? 'Показать фильтры' : 'Скрыть фильтры'}>
          <FilterIcon />
          {filtersHidden && filtered && <span className="filters-dot" aria-hidden="true" />}
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

      {filters}
    </nav>
  );
}

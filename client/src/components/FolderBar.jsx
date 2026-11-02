import { useState } from 'react';
import { publicToken } from '../board.js';
import CheckPicker from './CheckPicker.jsx';
import FolderSelect from './FolderSelect.jsx';
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
];

/**
 * `folderFilter` is the CheckPicker props ({ selected, onToggle, onSetAll, onClear, summary }) over the ids
 * of `folders` (all live folders, shown as a tree). `conflictsByFolder` is { [folderId]: number of cards
 * with a conflict }. Without `onManage` / `onAddCard` (read only) their buttons are not shown.
 */
export default function FolderBar({
  folders, folderFilter, conflictsByFolder, columnSets, columnSetId, onSelectColumnSet, tagFilter, cardFilter,
  view, onView, onManage, onAddCard, children,
}) {
  const [filtersHidden, setFiltersHidden] = useState(() => localStorage.getItem(FILTERS_HIDDEN_KEY) === '1');
  const toggleFilters = () => {
    localStorage.setItem(FILTERS_HIDDEN_KEY, filtersHidden ? '0' : '1');
    setFiltersHidden(!filtersHidden);
  };

  // A filter that narrows the board: shown on the toggle while the filters are hidden.
  const filtered = Boolean(folderFilter.onClear || tagFilter?.selected.length || cardFilter?.selected.length);

  const filters = !filtersHidden && (
    <div className="projectbar-row">
      {!publicToken && (
        <FolderSelect label="Папки" className="folder-filter" folders={folders} value={folderFilter.value}
          topLabel="Все папки" text={folderFilter.value == null ? folderFilter.summary ?? 'Не выбраны' : undefined}
          onChange={(id) => (id ? folderFilter.onOnly(id) : folderFilter.onSetAll(true))} />
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

      {cardFilter && (
        <CheckPicker label="Карточки" emptyLabel="Все" clearLabel="Показать все карточки" className="card-filter"
          searchPlaceholder="Номер или название" notFound="Карточек не найдено" {...cardFilter} />
      )}
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

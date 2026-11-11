import { Fragment, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { publicToken } from '../board.js';
import ColumnSetFilter from './ColumnSetFilter.jsx';
import ContextMenu, { useMenuButton } from './ContextMenu.jsx';
import FolderFilter, { FilterNav } from './FolderFilter.jsx';
import Modal from './Modal.jsx';
import PersonFilter from './PersonFilter.jsx';
import ColorFilter from './ColorFilter.jsx';
import TagFilter from './TagFilter.jsx';

export function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
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
const VIEWS = [
  { id: 'board', label: 'Колонки', icon: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 4v16M15 4v16' },
  { id: 'calendar', label: 'Календарь', icon: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3 10h18M8 3v4M16 3v4' },
  { id: 'gantt', label: 'Гант', icon: 'M4 6h16M4 12h11M4 18h7M3 3v18' },
  { id: 'list', label: 'Список', icon: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01' },
];

const VIEW_MENU_WIDTH = 180;

/**
 * One button with the current view's icon; its menu lists the views. With `sets` ({ sets: [{ id, name, count (cards in
 * view), boards (names) }], value, onChange }) the board's item has a submenu of the column sets.
 */
function ViewSwitch({ view, onView, sets }) {
  const [menu, , closeMenu, buttonProps] = useMenuButton(VIEW_MENU_WIDTH);
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const currentSet = sets && (sets.sets.find((s) => s.id === sets.value) ?? sets.sets[0]);
  const label = `Вид: ${current.label}${view === 'board' && currentSet ? ` — ${currentSet.name}` : ''}`;
  return (
    <>
      <button type="button" className="btn btn-small btn-icon-only view-toggle" title={label} aria-label={label}
        {...buttonProps}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={current.icon} /></svg>
      </button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}
          items={VIEWS.map(({ id, label: name, icon }) => (id === 'board' && sets ? {
            label: name, icon, active: id === view,
            submenu: sets.sets.map((s) => ({
              label: s.name, hint: s.count, title: `Доски: ${s.boards.join(', ')}`,
              active: view === 'board' && s.id === sets.value,
              run: () => {
                sets.onChange(s.id);
                onView('board');
              },
            })),
          } : { label: name, icon, active: id === view, run: () => onView(id) }))} />
      )}
    </>
  );
}

/**
 * `folderFilter` is { selected, indeterminate, onToggle, onSetFolder, onSetAll, onClear, summary } over the ids of
 * `folders` (all live folders). `conflictsByFolder` is { [folderId]: number of cards
 * with a conflict }. Without `onAddCard` (read only, or the board, where each column has one) its button is not shown.
 * `title` goes beside the filters button; `children` go on the right of the same row. `setSwitch` ({ sets, value, onChange }, see
 * ViewSwitch) picks the column set the board shows.
 */
export default function FolderBar({
  folders, folderFilter, conflictsByFolder, columnSets, columnSetId, onSelectColumnSet, tagFilter, colorFilter,
  authorFilter, holderFilter,
  view, onView, onAddCard, title, setSwitch, children,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  // A filter opened inside the filters dialog: its screen replaces the list of filters.
  const [screen, setScreen] = useState(null);
  const [screenOpen, setScreenOpen] = useState(false);
  const nav = useMemo(() => ({ target: screen, setActive: setScreenOpen, closeAll: () => setFiltersOpen(false) }), [screen]);

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
    colorFilter && { id: 'colors', active: colorFilter.selected.length > 0, node: <ColorFilter {...colorFilter} /> },
    hasPeople(authorFilter) && {
      id: 'author', active: authorFilter.selected.length > 0,
      node: <PersonFilter label="Автор" title="Автор" {...authorFilter} />,
    },
    hasPeople(holderFilter) && {
      id: 'holder', active: holderFilter.selected.length > 0,
      node: <PersonFilter label="На ком" title="На ком карточка" {...holderFilter} />,
    },
  ].filter(Boolean);
  // A filter that narrows the board: marked on the filters button.
  const filtered = filters.some((f) => f.active);
  const clearers = [folderFilter.onClear, tagFilter?.selected.length && tagFilter.onClear,
    colorFilter?.selected.length && colorFilter.onClear,
    authorFilter?.selected.length && authorFilter.onClear, holderFilter?.selected.length && holderFilter.onClear]
    .filter(Boolean);

  const filtersDialog = filtersOpen && createPortal(
    <Modal title="Фильтры" onClose={() => setFiltersOpen(false)} className="filters-dialog" closeButton
      header={!screenOpen}>
      <FilterNav.Provider value={nav}>
        <div className="filters-dialog-list" hidden={screenOpen}>
          {filters.map((f) => <Fragment key={f.id}>{f.node}</Fragment>)}
        </div>
      </FilterNav.Provider>
      <div ref={setScreen} />
      <div className="actions">
        {!screenOpen && clearers.length > 0 && (
          <button type="button" className="btn filters-reset" onClick={() => clearers.forEach((clear) => clear())}>
            Сбросить все
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => setFiltersOpen(false)}>Готово</button>
      </div>
    </Modal>,
    document.body,
  );

  return (
    <nav className="projectbar">
      <div className="projectbar-row projectbar-head">
        <ViewSwitch view={view} onView={onView} sets={setSwitch} />
        <button type="button" className="btn btn-small btn-icon-only filters-toggle" aria-haspopup="dialog"
          onClick={() => setFiltersOpen(true)}
          title={filtered ? 'Фильтры (включены)' : 'Фильтры'} aria-label="Фильтры">
          <FilterIcon />
          {filtered && <span className="filters-dot" aria-hidden="true" />}
        </button>

        {title}
        <div className="projectbar-end">
          {children}
          {onAddCard && (
            <button className="btn btn-primary btn-small btn-icon-only btn-add-card" title="Новая карточка" aria-label="Новая карточка"
              onClick={onAddCard}>
              <PlusIcon />
            </button>
          )}
        </div>
      </div>

      {filtersDialog}
    </nav>
  );
}

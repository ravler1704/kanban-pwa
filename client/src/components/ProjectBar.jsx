import { publicToken } from '../board.js';
import CheckPicker from './CheckPicker.jsx';
import TagFilter from './TagFilter.jsx';

const withConflicts = (name, n) => (n ? `${name} (конфликты: ${n})` : name);

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

const VIEWS = [
  { id: 'board', label: 'Доска', Icon: BoardIcon },
  { id: 'calendar', label: 'Календарь', Icon: CalendarIcon },
];

/**
 * `projectFilter` / `sectionFilter` are CheckPicker props ({ selected, onToggle, onSetAll, onClear,
 * summary }) over project / section ids. `sectionGroups` ({ project, sections }) are the projects
 * whose sections can be picked. `conflictsBySection` is keyed by
 * `${projectId}|${sectionId ?? ''}`. Without `onManage` / `onAddCard` (read only) their buttons are not shown.
 */
export default function ProjectBar({
  projects, sectionGroups, projectFilter, sectionFilter, conflictsBySection,
  columnSets, columnSetId, onSelectColumnSet, tagFilter, view, onView, onManage, onAddCard, children,
}) {
  const allKeys = Object.keys(conflictsBySection);
  const projectConflicts = (p) => allKeys
    .filter((key) => key.startsWith(`${p.id}|`))
    .reduce((sum, key) => sum + conflictsBySection[key], 0);
  const projectItems = projects.map((p) => ({ key: p.id, name: withConflicts(p.name, projectConflicts(p)) }));
  const sectionItems = sectionGroups.flatMap(({ project, sections }) => sections.map((s) => ({
    key: s.id,
    name: withConflicts(s.name, conflictsBySection[`${project.id}|${s.id}`]),
    group: sectionGroups.length > 1 ? project.name : undefined,
  })));

  return (
    <nav className="projectbar">
      <div className="projectbar-row">
        {!publicToken && (
          <CheckPicker label="Проекты" emptyLabel="Не выбраны" clearLabel="Как по умолчанию"
            searchPlaceholder="Поиск проекта" notFound="Проектов не найдено" items={projectItems} {...projectFilter} />
        )}

        {sectionItems.length > 0 && (
          <CheckPicker label="Разделы" emptyLabel="Не выбраны" clearLabel="Как по умолчанию"
            searchPlaceholder="Поиск раздела" notFound="Разделов не найдено" items={sectionItems} {...sectionFilter} />
        )}

        {columnSets && (
          <div className="picker">
            <label className="picker-label" htmlFor="column-set-select">Колонки</label>
            <select id="column-set-select" className="select" value={columnSetId}
              title="Доски с разными наборами колонок показываются по отдельности"
              onChange={(e) => onSelectColumnSet(e.target.value)}>
              {columnSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {tagFilter && <TagFilter {...tagFilter} />}
      </div>

      <div className="projectbar-row projectbar-actions">
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
    </nav>
  );
}

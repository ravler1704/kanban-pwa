import TagFilter from './TagFilter.jsx';

export const ALL = 'all';

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

function ClearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * `project` is null when no project is selected (all projects are shown);
 * `section` is null when no section is selected (the whole project is shown).
 * `conflictsBySection` is keyed by `${projectId}|${sectionId ?? ''}`.
 */
export default function ProjectBar({
  projects, sections, project, section, conflictsBySection, onSelectProject, onSelectSection,
  columnSets, columnSetId, onSelectColumnSet, tagFilter, view, onView, onManage, onAddCard,
}) {
  const sumConflicts = (keys) => keys.reduce((sum, key) => sum + (conflictsBySection[key] ?? 0), 0);
  const allKeys = Object.keys(conflictsBySection);
  const projectConflicts = (p) => sumConflicts(allKeys.filter((key) => key.startsWith(`${p.id}|`)));
  const projectOption = (p) => <option key={p.id} value={p.id}>{withConflicts(p.name, projectConflicts(p))}</option>;
  const hidden = projects.filter((p) => p.hidden);

  return (
    <nav className="projectbar">
      <div className="picker">
        <label className="picker-label" htmlFor="project-select">Проект</label>
        <select
          id="project-select"
          className={`select ${project ? '' : 'select-empty'}`}
          value={project?.id ?? ALL}
          onChange={(e) => onSelectProject(e.target.value)}
        >
          <option value={ALL}>{withConflicts('Все проекты', sumConflicts(allKeys))}</option>
          {projects.filter((p) => !p.hidden).map(projectOption)}
          {hidden.length > 0 && <optgroup label="Скрытые">{hidden.map(projectOption)}</optgroup>}
        </select>
        {project && (
          <button className="btn-clear" title="Показать все проекты" aria-label="Очистить проект"
            onClick={() => onSelectProject(ALL)}><ClearIcon /></button>
        )}
      </div>

      {project && sections.length > 0 && (
        <div className="picker">
          <label className="picker-label" htmlFor="section-select">Раздел</label>
          <select
            id="section-select"
            className={`select ${section ? '' : 'select-empty'}`}
            value={section?.id ?? ''}
            onChange={(e) => onSelectSection(e.target.value || null)}
          >
            <option value="">{withConflicts('Не выбран', conflictsBySection[`${project.id}|`])}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {withConflicts(s.name, conflictsBySection[`${project.id}|${s.id}`])}
              </option>
            ))}
          </select>
          {section && (
            <button className="btn-clear" title="Весь проект" aria-label="Очистить раздел"
              onClick={() => onSelectSection(null)}><ClearIcon /></button>
          )}
        </div>
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

      <div className="view-switch" role="group" aria-label="Вид">
        {VIEWS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={`view-switch-btn ${view === id ? 'active' : ''}`}
            title={label} aria-label={label} aria-pressed={view === id} onClick={() => onView(id)}>
            <Icon />
          </button>
        ))}
      </div>
      <button className="btn btn-small btn-icon-only" title="Настройки доски" aria-label="Настройки доски"
        onClick={onManage}>
        <SettingsIcon />
      </button>
      <button className="btn btn-primary btn-small btn-icon-only btn-add-card" title="Новая карточка" aria-label="Новая карточка"
        onClick={onAddCard}>
        <PlusIcon />
      </button>
    </nav>
  );
}

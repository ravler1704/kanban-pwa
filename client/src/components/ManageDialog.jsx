import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  changeProjectColumnSet, countCards, countColumnCards, createColumn, createColumnSet, createProject, createSection,
  deleteColumn, deleteColumnSet, deleteProject, deleteSection, moveColumn, moveProject, renameColumn, renameColumnSet,
  renameProject, renameSection, setProjectHidden,
} from '../actions.js';
import { currentBoard } from '../board.js';
import { matchColumn } from '../columnSets.js';
import { db } from '../db.js';
import Modal from './Modal.jsx';
import { ProjectMembers, useCanShare } from './SharingSection.jsx';

// On someone else's board only sections of the shared projects can be changed.
const isOwnBoard = !currentBoard;

/** Text input that saves on Enter / blur and reverts on Escape. */
function NameInput({ value, onSave, className = '', label, maxLength = 200 }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    // Renamed elsewhere (e.g. synced from another device).
    setPrev(value);
    setDraft(value);
  }

  function commit() {
    const name = draft.trim();
    if (name && name !== value) onSave(name);
    else setDraft(value);
  }

  return (
    <label className="field manage-field">
      <span className="field-label">{label}</span>
      <input
        className={`manage-input ${className}`}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value);
          }
        }}
      />
    </label>
  );
}

function AddForm({ label, onAdd }) {
  const [name, setName] = useState('');
  return (
    <form
      className="manage-add"
      onSubmit={(e) => {
        e.preventDefault();
        const value = name.trim();
        if (!value) return;
        onAdd(value);
        setName('');
      }}
    >
      <label className="field manage-field">
        <span className="field-label">{label}</span>
        <input
          className="manage-input"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-small" disabled={!name.trim()}>Добавить</button>
    </form>
  );
}

/** Deleting a column that still has cards: they move to the chosen column. */
function DeleteColumnDialog({ column, count, columns, onClose }) {
  const others = columns.filter((c) => c.id !== column.id);
  const [targetId, setTargetId] = useState(others[0].id);

  async function submit(e) {
    e.preventDefault();
    await deleteColumn(column.id, targetId);
    onClose();
  }

  return (
    <Modal title="Удалить колонку" onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <p>В колонке «{column.name}» карточек: {count}. Куда их перенести?</p>
        <label className="field">
          <span className="field-label">Перенести карточки в</span>
          <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-danger">Перенести и удалить</button>
        </div>
      </form>
    </Modal>
  );
}

const projectList = (projects) => projects.map((p) => `«${p.name}»`).join(', ');

/** Which boards a change of the set affects; shown above its columns so it is never a surprise. */
function SetUsage({ projects }) {
  if (projects.length === 0) {
    return <p className="set-usage set-usage-unused">Этот набор пока не использует ни одна доска.</p>;
  }
  return (
    <p className="set-usage">
      {projects.length === 1
        ? <>Набор использует доска {projectList(projects)}. Изменения колонок сразу применятся к ней.</>
        : <>Набор используют доски: {projectList(projects)}. Изменения колонок сразу применятся ко всем этим доскам.</>}
    </p>
  );
}

function ColumnSetsEditor({ model, synced, initialSetId }) {
  const [picked, setPicked] = useState(initialSetId);
  const set = model.sets.find((s) => s.id === picked) ?? model.sets[0];
  const users = model.projectsOf(set.id);

  if (!synced) {
    return <p className="muted">Колонки можно будет изменить после первой синхронизации с сервером.</p>;
  }

  async function addSet() {
    const name = prompt('Название нового набора колонок (колонки скопируются из текущего):', `${set.name} — копия`);
    if (!name?.trim()) return;
    setPicked(await createColumnSet(name.trim().slice(0, 100), set.id));
  }

  async function removeSet() {
    if (!confirm(`Удалить набор «${set.name}» вместе с его колонками?`)) return;
    await deleteColumnSet(set.id);
    setPicked(null);
  }

  return (
    <div className="manage">
      <div className="manage-row">
        <label className="field set-picker">
          <span className="field-label">Набор колонок</span>
          <select className="select" value={set.id} onChange={(e) => setPicked(e.target.value)}>
            {model.sets.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({model.projectsOf(s.id).length})</option>
            ))}
          </select>
        </label>
        <button className="btn btn-small" onClick={addSet}>Новый набор</button>
      </div>
      <div className="manage-row">
        <NameInput key={set.id} value={set.name} className="manage-project-name" label="Название набора"
          maxLength={100} onSave={(name) => renameColumnSet(set.id, name)} />
        <button className="btn btn-small btn-danger" disabled={users.length > 0 || model.sets.length === 1}
          title={users.length > 0 ? 'Сначала переключите доски на другой набор' : undefined}
          onClick={removeSet}>Удалить набор</button>
      </div>
      <SetUsage projects={users} />
      <ColumnsEditor setId={set.id} columns={model.columnsOf(set.id)} />
    </div>
  );
}

function ColumnsEditor({ setId, columns }) {
  const [deleting, setDeleting] = useState(null);

  async function remove(column) {
    const count = await countColumnCards(column.id);
    if (count > 0) setDeleting({ column, count });
    else if (confirm(`Удалить колонку «${column.name}»?`)) await deleteColumn(column.id, null);
  }

  return (
    <div className="manage-columns">
      {columns.map((c, i) => (
        <div key={c.id} className="manage-row">
          <NameInput value={c.name} label="Название колонки" maxLength={100}
            onSave={(name) => renameColumn(c.id, name)} />
          <button className="btn btn-small" title="Выше" aria-label="Выше" disabled={i === 0}
            onClick={() => moveColumn(c.id, -1)}>↑</button>
          <button className="btn btn-small" title="Ниже" aria-label="Ниже" disabled={i === columns.length - 1}
            onClick={() => moveColumn(c.id, 1)}>↓</button>
          <button className="btn btn-small btn-danger" disabled={columns.length === 1}
            title={columns.length === 1 ? 'Нужна хотя бы одна колонка' : undefined}
            onClick={() => remove(c)}>Удалить</button>
        </div>
      ))}
      <AddForm label="Новая колонка" onAdd={(name) => createColumn(setId, name)} />
      {deleting && (
        <DeleteColumnDialog column={deleting.column} count={deleting.count} columns={columns}
          onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

/** Switching a project to another column set: where the cards of each current column go. */
function ChangeSetDialog({ model, project, setId, onClose }) {
  const from = model.columnsOf(model.setIdOf(project));
  const to = model.columnsOf(setId);
  const set = model.sets.find((s) => s.id === setId);
  const counts = useLiveQuery(async () => {
    const cards = await db.cards.where('projectId').equals(project.id).toArray();
    const out = {};
    for (const c of cards) if (!c.deleted) out[c.columnId] = (out[c.columnId] ?? 0) + 1;
    return out;
  }, [project.id]);
  const [mapping, setMapping] = useState(() => Object.fromEntries(from.map((c) => [c.id, matchColumn(c, to)?.id])));

  async function submit(e) {
    e.preventDefault();
    await changeProjectColumnSet(project.id, setId, mapping);
    onClose();
  }

  return (
    <Modal title="Сменить набор колонок" onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        <p>
          У доски «{project.name}» будут колонки набора «{set.name}»: {to.map((c) => c.name).join(', ')}.
          Выберите, куда перенести карточки из текущих колонок.
        </p>
        {to.length === 0 && <p className="notice">В наборе «{set.name}» нет колонок — сначала добавьте их.</p>}
        {to.length > 0 && from.map((c) => (
          <label key={c.id} className="field">
            <span className="field-label">«{c.name}» — карточек: {counts?.[c.id] ?? 0}</span>
            <select className="select" value={mapping[c.id]}
              onChange={(e) => setMapping((m) => ({ ...m, [c.id]: e.target.value }))}>
              {to.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ))}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={to.length === 0}>Сменить набор</button>
        </div>
      </form>
    </Modal>
  );
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const SEARCH_FROM = 7;

function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ProjectItem({ model, project, sections, columnsSynced, expanded, onToggle, canMoveUp, canMoveDown,
  onChangeSet, onRemove, onRemoveSection, canShare }) {
  const setName = model.sets.find((s) => s.id === model.setIdOf(project))?.name;
  const meta = [
    project.hidden && 'скрыт',
    sections.length ? `${sections.length} ${plural(sections.length, 'раздел', 'раздела', 'разделов')}` : 'без разделов',
    columnsSynced && setName && `набор «${setName}»`,
  ].filter(Boolean).join(' · ');

  return (
    <section className={`manage-project ${expanded ? 'manage-project-open' : ''} ${project.hidden ? 'manage-project-hidden' : ''}`}>
      <div className="manage-project-head">
        <button type="button" className="manage-project-toggle" aria-expanded={expanded} onClick={onToggle}>
          <Chevron />
          <span className="manage-project-title">
            <span className="manage-project-label">{project.name}</span>
            <span className="manage-project-meta">{meta}</span>
          </span>
        </button>
        {isOwnBoard && (
          <button className="btn btn-small" aria-pressed={!!project.hidden}
            title={project.hidden ? 'Показывать карточки в «Все проекты»' : 'Не показывать карточки в «Все проекты»'}
            onClick={() => setProjectHidden(project.id, !project.hidden)}>
            {project.hidden ? 'Показать' : 'Скрыть'}
          </button>
        )}
        {isOwnBoard && canMoveUp !== null && (
          <>
            <button className="btn btn-small" title="Выше" aria-label="Выше" disabled={!canMoveUp}
              onClick={() => moveProject(project.id, -1)}>↑</button>
            <button className="btn btn-small" title="Ниже" aria-label="Ниже" disabled={!canMoveDown}
              onClick={() => moveProject(project.id, 1)}>↓</button>
          </>
        )}
      </div>
      {expanded && (
        <div className="manage-project-body">
          {isOwnBoard && (
            <div className="manage-row">
              <NameInput value={project.name} className="manage-project-name" label="Название проекта"
                onSave={(name) => renameProject(project.id, name)} />
              <button className="btn btn-small btn-danger" onClick={onRemove}>Удалить</button>
            </div>
          )}
          {isOwnBoard && columnsSynced && (
            <label className="field">
              <span className="field-label">Набор колонок</span>
              <select className="select" value={model.setIdOf(project)} onChange={(e) => onChangeSet(e.target.value)}>
                {model.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <div className="manage-sections">
            <h4 className="manage-heading">Разделы</h4>
            {sections.map((s) => (
              <div key={s.id} className="manage-row">
                <NameInput value={s.name} label="Название раздела" onSave={(name) => renameSection(s.id, name)} />
                <button className="btn btn-small btn-danger" onClick={() => onRemoveSection(s)}>Удалить</button>
              </div>
            ))}
            <AddForm label="Новый раздел" onAdd={(name) => createSection(project.id, name)} />
          </div>
          {canShare && <ProjectMembers project={project} />}
        </div>
      )}
    </section>
  );
}

function ProjectsEditor({ model, projects, sections, columnsSynced, onChangeSet, onRemove, onRemoveSection }) {
  const [expandedId, setExpandedId] = useState(() => (projects.length === 1 ? projects[0].id : null));
  const [query, setQuery] = useState('');
  const canShare = useCanShare();
  const sectionsOf = (id) => sections.filter((s) => s.projectId === id);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? projects.filter((p) => p.name.toLowerCase().includes(needle)
      || sectionsOf(p.id).some((s) => s.name.toLowerCase().includes(needle)))
    : projects;

  return (
    <div className="manage">
      {isOwnBoard
        ? <AddForm label="Новый проект"
            onAdd={async (name) => setExpandedId(await createProject(name, model.newProjectSetId))} />
        : <p className="muted">Проекты и колонки настраивает владелец доски, здесь можно менять разделы.</p>}
      {projects.length >= SEARCH_FROM && (
        <label className="field">
          <span className="field-label">Поиск проекта</span>
          <input type="search" className="manage-search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {projects.length === 0 && (
        <p className="muted">{isOwnBoard ? 'Пока нет ни одного проекта.' : 'Вам пока не открыт ни один проект.'}</p>
      )}
      {projects.length > 0 && visible.length === 0 && <p className="muted">Ничего не найдено.</p>}
      <div className="manage-projects">
        {visible.map((p, i) => (
          <ProjectItem key={p.id} model={model} project={p} sections={sectionsOf(p.id)} columnsSynced={columnsSynced}
            expanded={expandedId === p.id} onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
            canMoveUp={needle ? null : i > 0} canMoveDown={i < visible.length - 1}
            onChangeSet={(setId) => onChangeSet(p, setId)} onRemove={() => onRemove(p)}
            onRemoveSection={onRemoveSection} canShare={canShare} />
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'projects', label: 'Проекты и разделы' },
  ...(isOwnBoard ? [{ id: 'columns', label: 'Колонки' }] : []),
];
const TAB_KEY = 'manageDialogTab';

/** `initialSetId` is the column set opened on the «Колонки» tab (the one of the current board). */
export default function ManageDialog({ model, columnsSynced, initialSetId, projects, sections, onClose }) {
  const [deleting, setDeleting] = useState(null);
  const [changingSet, setChangingSet] = useState(null);
  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? saved : TABS[0].id;
  });

  function selectTab(id) {
    setTab(id);
    localStorage.setItem(TAB_KEY, id);
  }

  async function removeProject(project) {
    if (!confirm(`Удалить проект «${project.name}» со всеми разделами и карточками?`)) return;
    await deleteProject(project.id);
  }

  async function removeSection(section) {
    const count = await countCards(section.projectId, section.id);
    if (count > 0) {
      setDeleting({ section, count });
    } else if (confirm(`Удалить раздел «${section.name}»?`)) {
      await deleteSection(section.id, { keepCards: false });
    }
  }

  async function finishDelete(keepCards) {
    await deleteSection(deleting.section.id, { keepCards });
    setDeleting(null);
  }

  return (
    <Modal title="Настройки доски" onClose={onClose}>
      {TABS.length > 1 && <div className="tabs-bar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>}
      {tab === 'projects' && (
        <div role="tabpanel">
          <ProjectsEditor model={model} projects={projects} sections={sections} columnsSynced={columnsSynced}
            onChangeSet={(project, setId) => setChangingSet({ project, setId })}
            onRemove={removeProject} onRemoveSection={removeSection} />
        </div>
      )}
      {tab === 'columns' && (
        <div role="tabpanel">
          <ColumnSetsEditor model={model} synced={columnsSynced} initialSetId={initialSetId} />
        </div>
      )}
      {changingSet && (
        <ChangeSetDialog model={model} project={changingSet.project} setId={changingSet.setId}
          onClose={() => setChangingSet(null)} />
      )}
      <div className="actions">
        <button className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>

      {deleting && (
        <Modal title="Удалить раздел" onClose={() => setDeleting(null)}>
          <p>В разделе «{deleting.section.name}» карточек: {deleting.count}. Что с ними сделать?</p>
          <div className="actions">
            <button className="btn" onClick={() => setDeleting(null)}>Отмена</button>
            <button className="btn" onClick={() => finishDelete(true)}>Оставить в проекте</button>
            <button className="btn btn-danger" onClick={() => finishDelete(false)}>Удалить вместе с карточками</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

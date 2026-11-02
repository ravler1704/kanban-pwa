import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  changeProjectColumnSet, countCards, countColumnCards, countProjectCards, createColumn, createColumnSet, createSection,
  deleteColumn, deleteColumnSet, deleteProject, deleteSection, moveColumn, renameColumn, renameColumnSet, renameSection,
  setColumnAddToTop,
} from '../actions.js';
import { isOwnBoard } from '../board.js';
import { matchColumn } from '../columnSets.js';
import { db } from '../db.js';
import { AddForm, NameInput } from './ManageFields.jsx';
import Modal from './Modal.jsx';
import PublicLinkSettings from './PublicLinkSettings.jsx';
import { ProjectMembers, useCanShare } from './SharingSection.jsx';
import StructureEditor from './StructureEditor.jsx';

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
      <p className="manage-hint muted">
        Новые и перенесённые в колонку карточки ставятся в её начало или в конец.
        Перетаскиванием карточку можно поставить в любое место.
      </p>
      {columns.map((c, i) => (
        <div key={c.id} className="manage-row">
          <NameInput value={c.name} label="Название колонки" maxLength={100}
            onSave={(name) => renameColumn(c.id, name)} />
          <label className="field manage-place">
            <span className="field-label">Новые карточки</span>
            <select className="select" value={c.addToTop ? 'top' : 'bottom'}
              title="Куда ставить новые и перенесённые карточки"
              onChange={(e) => setColumnAddToTop(c.id, e.target.value === 'top')}>
              <option value="bottom">В конец</option>
              <option value="top">В начало</option>
            </select>
          </label>
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

/** Which project the «Разделы» and «Доступ» tabs show. */
function ProjectPicker({ projects, project, onChange }) {
  return (
    <label className="field">
      <span className="field-label">Проект</span>
      <select className="select" value={project.id} onChange={(e) => onChange(e.target.value)}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

function SectionsEditor({ projects, project, sections, onProject, onRemoveSection }) {
  const own = sections.filter((s) => s.projectId === project.id);
  return (
    <div className="manage">
      {!isOwnBoard && <p className="muted">Проекты и колонки настраивает владелец доски, здесь можно менять разделы.</p>}
      <ProjectPicker projects={projects} project={project} onChange={onProject} />
      {own.length === 0 && <p className="muted">В проекте нет разделов — все карточки лежат в нём самом.</p>}
      {own.map((s) => (
        <div key={s.id} className="manage-row">
          <NameInput value={s.name} label="Название раздела" onSave={(name) => renameSection(s.id, name)} />
          <button className="btn btn-small btn-danger" onClick={() => onRemoveSection(s)}>Удалить</button>
        </div>
      ))}
      <AddForm label="Новый раздел" onAdd={(name) => createSection(project.id, name)} />
    </div>
  );
}

function AccessEditor({ projects, project, onProject }) {
  return (
    <div className="manage manage-access">
      <ProjectPicker projects={projects} project={project} onChange={onProject} />
      <ProjectMembers project={project} />
      <PublicLinkSettings project={project} />
    </div>
  );
}

const TAB_KEY = 'manageDialogTab';

/**
 * `initialSetId` is the column set opened on the «Колонки» tab and `initialProjectId` the project
 * of the «Разделы» and «Доступ» tabs (those of the current board; null with all projects shown).
 * The board's owner arranges spaces, projects and sections on «Структура», members only sections.
 */
export default function ManageDialog({
  model, columnsSynced, initialSetId, initialProjectId, projects, spaces, spacesSynced, sections, onSpaceDeleted, onClose,
}) {
  const canShare = useCanShare();
  const tabs = [
    isOwnBoard ? { id: 'structure', label: 'Структура' } : { id: 'sections', label: 'Разделы' },
    ...(canShare ? [{ id: 'access', label: 'Доступ' }] : []),
    ...(isOwnBoard ? [{ id: 'columns', label: 'Колонки' }] : []),
  ];
  const [deleting, setDeleting] = useState(null);
  const [changingSet, setChangingSet] = useState(null);
  const [savedTab, setTab] = useState(() => localStorage.getItem(TAB_KEY));
  const tab = tabs.some((t) => t.id === savedTab) ? savedTab : tabs[0].id;
  const [projectId, setProjectId] = useState(initialProjectId);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

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

  // Cards have to be placed in the new columns; an empty project just switches.
  async function changeSet(project, setId) {
    if (await countProjectCards(project.id)) setChangingSet({ project, setId });
    else await changeProjectColumnSet(project.id, setId, {});
  }

  async function finishDelete(keepCards) {
    await deleteSection(deleting.section.id, { keepCards });
    setDeleting(null);
  }

  return (
    <Modal title="Настройки доски" onClose={onClose}>
      {tabs.length > 1 && <div className="tabs-bar">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => selectTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>}
      {tab === 'structure' && (
        <div role="tabpanel">
          <StructureEditor model={model} spaces={spaces} projects={projects} sections={sections} synced={spacesSynced}
            columnsSynced={columnsSynced} onChangeSet={changeSet} onRemoveProject={removeProject}
            onRemoveSection={removeSection} onSpaceDeleted={onSpaceDeleted} />
        </div>
      )}
      {(tab === 'sections' || tab === 'access') && !project && (
        <p className="muted">
          {isOwnBoard ? 'Сначала создайте проект на вкладке «Структура».' : 'Вам пока не открыт ни один проект.'}
        </p>
      )}
      {tab === 'sections' && project && (
        <div role="tabpanel">
          <SectionsEditor projects={projects} project={project} sections={sections} onProject={setProjectId}
            onRemoveSection={removeSection} />
        </div>
      )}
      {tab === 'access' && project && (
        <div role="tabpanel">
          <AccessEditor projects={projects} project={project} onProject={setProjectId} />
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

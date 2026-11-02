import { useState } from 'react';
import {
  createProject, createSection, createSpace, deleteSpace, moveProject, moveSpace, renameProject, renameSection,
  renameSpace, restructure,
} from '../actions.js';
import { spaceIdOf } from '../spaces.js';
import { AddButton, Chevron, NameInput, plural } from './ManageFields.jsx';
import Modal from './Modal.jsx';
import { SpaceMembers, useCanShare } from './SharingSection.jsx';

const KIND_NAMES = { space: 'пространство', project: 'проект', section: 'раздел' };
const SEARCH_FROM = 7;

/** Where a space, project or section can go, and what becomes of it there. */
function MoveDialog({ node, model, spaces, projects, sections, onMoved, onClose }) {
  const { kind, item } = node;
  const spaceOf = (p) => spaceIdOf(p, spaces);
  const spaceName = (id) => spaces.find((s) => s.id === id)?.name;
  const ownSections = kind === 'project' ? sections.filter((s) => s.projectId === item.id) : [];

  const groups = [];
  if (kind !== 'space') {
    groups.push({ label: 'Сделать пространством', options: [{ value: 'top', label: 'Новое пространство' }] });
  }
  const spaceTargets = spaces.filter((s) => (kind === 'space' ? s.id !== item.id : kind !== 'project' || s.id !== spaceOf(item)));
  if (spaceTargets.length) {
    groups.push({
      label: { space: 'Объединить с пространством', project: 'Перенести в пространство', section: 'Сделать проектом в пространстве' }[kind],
      options: spaceTargets.map((s) => ({ value: `space:${s.id}`, label: s.name })),
    });
  }
  const projectTargets = projects.filter((p) => {
    if (kind === 'project') return p.id !== item.id;
    if (kind === 'section') return p.id !== item.projectId;
    return spaceOf(p) !== item.id;
  });
  if (projectTargets.length) {
    groups.push({
      label: kind === 'section' ? 'Перенести в проект' : 'Сделать разделом проекта',
      options: projectTargets.map((p) => ({
        value: `project:${p.id}`, label: spaces.length > 1 ? `${spaceName(spaceOf(p))} / ${p.name}` : p.name,
      })),
    });
  }
  const [value, setValue] = useState(groups[0]?.options[0].value ?? '');
  const [busy, setBusy] = useState(false);

  const [targetKind, targetId] = value === 'top' ? ['top', null] : value.split(':');
  const target = targetKind === 'space' ? spaceName(targetId) : projects.find((p) => p.id === targetId)?.name;
  const name = `«${item.name}»`;

  // Sets of the projects whose cards move, to warn about columns matched by name.
  const sourceProjects = kind === 'space' ? projects.filter((p) => spaceOf(p) === item.id)
    : [projects.find((p) => p.id === (kind === 'project' ? item.id : item.projectId))].filter(Boolean);
  const otherColumns = targetKind === 'project'
    && sourceProjects.some((p) => model.setIdOf(p) !== model.setIdOf(projects.find((t) => t.id === targetId)));

  function describe() {
    if (kind === 'section') {
      if (targetKind === 'top') return `Появится пространство ${name} с проектом ${name}, в который перейдут карточки раздела.`;
      if (targetKind === 'space') return `В пространстве «${target}» появится проект ${name} с карточками раздела, а раздел исчезнет.`;
      return `Раздел со всеми карточками перейдёт в проект «${target}».`;
    }
    if (kind === 'project') {
      const asProjects = ownSections.length ? ', а его разделы станут проектами рядом с ним' : '';
      if (targetKind === 'top') return `Появится пространство ${name}, проект перейдёт в него${asProjects}.`;
      if (targetKind === 'space') return `Проект со всеми разделами и карточками перейдёт в пространство «${target}».`;
      const asSections = ownSections.length ? `, его разделы — разделами «${item.name} / …»` : '';
      return `Карточки проекта станут разделом ${name} проекта «${target}»${asSections}. `
        + `Проект ${name} будет удалён вместе с его чатом и доступом участников.`;
    }
    if (targetKind === 'space') {
      return `Все проекты перейдут в пространство «${target}», а пространство ${name} будет удалено вместе с его чатом и доступом участников.`;
    }
    return `Каждый проект пространства станет разделом проекта «${target}», `
      + `а пространство ${name} и его проекты будут удалены вместе с чатами и доступом участников.`;
  }

  async function submit(e) {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    try {
      await restructure(kind, item.id, targetKind === 'top' ? { top: true }
        : targetKind === 'space' ? { spaceId: targetId } : { projectId: targetId });
      onMoved?.(kind, item.id, targetKind === 'space' ? targetId : null);
      onClose();
    } catch (err) {
      alert(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Перенести ${KIND_NAMES[kind]} ${name}`} onClose={onClose}>
      <form className="editor" onSubmit={submit}>
        {groups.length === 0 ? <p className="muted">Переносить некуда.</p> : (
          <>
            <label className="field">
              <span className="field-label">Куда</span>
              <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
                {groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <p className="move-result">{describe()}</p>
            {otherColumns && (
              <p className="muted move-note">
                У проекта «{target}» другой набор колонок: карточки встанут в колонки с теми же названиями, остальные — в первую.
              </p>
            )}
          </>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={!value || busy}>Перенести</button>
        </div>
      </form>
    </Modal>
  );
}

function OrderButtons({ onMove, canUp, canDown }) {
  return (
    <>
      <button className="btn btn-small" title="Выше" aria-label="Выше" disabled={!canUp} onClick={() => onMove(-1)}>↑</button>
      <button className="btn btn-small" title="Ниже" aria-label="Ниже" disabled={!canDown} onClick={() => onMove(1)}>↓</button>
    </>
  );
}

function NodeHead({ kind, name, meta, open, onToggle, children }) {
  return (
    <div className="tree-head">
      <button type="button" className="tree-toggle" aria-expanded={open} onClick={onToggle}>
        <Chevron />
        <span className="tree-title">
          <span className="tree-label"><span className={`tree-kind tree-kind-${kind}`}>{KIND_NAMES[kind]}</span>{name}</span>
          {meta && <span className="tree-meta">{meta}</span>}
        </span>
      </button>
      {children}
    </div>
  );
}

function SectionNode({ section, onMove, onRemove }) {
  return (
    <div className="manage-row tree-section">
      <NameInput value={section.name} label="Раздел" onSave={(name) => renameSection(section.id, name)} />
      <button className="btn btn-small" onClick={onMove}>Перенести…</button>
      <button className="btn btn-small btn-danger" onClick={onRemove}>Удалить</button>
    </div>
  );
}

function ProjectNode({ model, project, sections, columnsSynced, open, onToggle, order, onMove, onMoveSection,
  onChangeSet, onRemove, onRemoveSection }) {
  const setName = model.sets.find((s) => s.id === model.setIdOf(project))?.name;
  const meta = [
    sections.length ? `${sections.length} ${plural(sections.length, 'раздел', 'раздела', 'разделов')}` : 'без разделов',
    columnsSynced && setName && `набор «${setName}»`,
  ].filter(Boolean).join(' · ');

  return (
    <section className={`tree-node tree-project ${open ? 'tree-node-open' : ''}`}>
      <NodeHead kind="project" name={project.name} meta={meta} open={open} onToggle={onToggle}>
        {order}
      </NodeHead>
      {open && (
        <div className="tree-body">
          <div className="manage-row">
            <NameInput value={project.name} className="manage-project-name" label="Название проекта"
              onSave={(name) => renameProject(project.id, name)} />
            <button className="btn btn-small" onClick={onMove}>Перенести…</button>
            <button className="btn btn-small btn-danger" onClick={onRemove}>Удалить</button>
          </div>
          {columnsSynced && (
            <label className="field">
              <span className="field-label">Набор колонок</span>
              <select className="select" value={model.setIdOf(project)} onChange={(e) => onChangeSet(e.target.value)}>
                {model.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <div className="tree-children">
            {sections.map((s) => (
              <SectionNode key={s.id} section={s} onMove={() => onMoveSection(s)} onRemove={() => onRemoveSection(s)} />
            ))}
            <AddButton label="Новый раздел" onAdd={(name) => createSection(project.id, name)} />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Spaces → projects → sections of the own board in one tree: names, order, access and column sets;
 * any of them can be moved to another place, becoming a space, project or section there.
 */
export default function StructureEditor({
  model, spaces, projects, sections, synced, columnsSynced, onChangeSet, onRemoveProject, onRemoveSection, onSpaceDeleted,
}) {
  const canShare = useCanShare();
  const [openId, setOpenId] = useState(() => (projects.length === 1 ? `project:${projects[0].id}` : null));
  const [sharingId, setSharingId] = useState(null);
  const [moving, setMoving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [query, setQuery] = useState('');

  const toggle = (key) => setOpenId(openId === key ? null : key);
  const sectionsOf = (id) => sections.filter((s) => s.projectId === id);
  const projectsOf = (id) => projects.filter((p) => spaceIdOf(p, spaces) === id);
  const needle = query.trim().toLowerCase();
  const matches = (p) => !needle || p.name.toLowerCase().includes(needle)
    || sectionsOf(p.id).some((s) => s.name.toLowerCase().includes(needle));

  async function removeSpace(space) {
    const target = spaces.find((s) => s.id !== space.id);
    if (projectsOf(space.id).length) {
      setTargetId(target.id);
      setDeleting(space);
    } else if (confirm(`Удалить пространство «${space.name}»?`)) {
      await deleteSpace(space.id, target.id);
      onSpaceDeleted(space.id, target.id);
    }
  }

  async function finishDelete() {
    await deleteSpace(deleting.id, targetId);
    onSpaceDeleted(deleting.id, targetId);
    setDeleting(null);
  }

  if (!synced) return <p className="muted">Пространства и проекты появятся после синхронизации.</p>;
  return (
    <div className="manage tree">
      {projects.length >= SEARCH_FROM && (
        <label className="field">
          <span className="field-label">Поиск проекта или раздела</span>
          <input type="search" className="manage-search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {spaces.map((space, i) => {
        const own = projectsOf(space.id);
        const shown = own.filter(matches);
        if (needle && shown.length === 0) return null;
        const key = `space:${space.id}`;
        const open = openId === key;
        return (
          <section key={space.id} className={`tree-node tree-space ${open ? 'tree-node-open' : ''}`}>
            <NodeHead kind="space" name={space.name} open={open} onToggle={() => toggle(key)}
              meta={own.length ? `${own.length} ${plural(own.length, 'проект', 'проекта', 'проектов')}` : 'без проектов'}>
              {!needle && <OrderButtons canUp={i > 0} canDown={i < spaces.length - 1} onMove={(d) => moveSpace(space.id, d)} />}
            </NodeHead>
            {open && (
              <div className="tree-body">
                <div className="manage-row">
                  <NameInput value={space.name} label="Название пространства" maxLength={100}
                    onSave={(name) => renameSpace(space.id, name)} />
                  {canShare && (
                    <button className={`btn btn-small ${sharingId === space.id ? 'btn-primary' : ''}`}
                      aria-expanded={sharingId === space.id}
                      onClick={() => setSharingId(sharingId === space.id ? null : space.id)}>Доступ</button>
                  )}
                  <button className="btn btn-small" onClick={() => setMoving({ kind: 'space', item: space })}>Перенести…</button>
                  <button className="btn btn-small btn-danger" disabled={spaces.length < 2}
                    title={spaces.length < 2 ? 'Должно остаться хотя бы одно пространство' : undefined}
                    onClick={() => removeSpace(space)}>Удалить</button>
                </div>
                {canShare && sharingId === space.id && <SpaceMembers space={space} />}
              </div>
            )}
            <div className="tree-children">
              {shown.map((p, j) => (
                <ProjectNode key={p.id} model={model} project={p} sections={sectionsOf(p.id)} columnsSynced={columnsSynced}
                  open={openId === `project:${p.id}`} onToggle={() => toggle(`project:${p.id}`)}
                  order={!needle && (
                    <OrderButtons canUp={j > 0} canDown={j < shown.length - 1}
                      onMove={(d) => moveProject(p.id, d, own.map((o) => o.id))} />
                  )}
                  onMove={() => setMoving({ kind: 'project', item: p })}
                  onMoveSection={(s) => setMoving({ kind: 'section', item: s })}
                  onChangeSet={(setId) => onChangeSet(p, setId)}
                  onRemove={() => onRemoveProject(p)} onRemoveSection={onRemoveSection} />
              ))}
              {!needle && (
                <AddButton label="Новый проект" onAdd={async (name) => {
                  const id = await createProject(name, model.newProjectSetId, space.id);
                  setOpenId(`project:${id}`);
                }} />
              )}
            </div>
          </section>
        );
      })}
      {!needle && <AddButton label="Новое пространство" onAdd={(name) => createSpace(name)} />}

      {moving && (
        <MoveDialog node={moving} model={model} spaces={spaces} projects={projects} sections={sections}
          onMoved={(kind, id, spaceId) => kind === 'space' && onSpaceDeleted(id, spaceId)}
          onClose={() => setMoving(null)} />
      )}
      {deleting && (
        <Modal title="Удалить пространство" onClose={() => setDeleting(null)}>
          <p>В пространстве «{deleting.name}» проектов: {projectsOf(deleting.id).length}. Куда их перенести?</p>
          <label className="field">
            <span className="field-label">Пространство</span>
            <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {spaces.filter((s) => s.id !== deleting.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="actions">
            <button className="btn" onClick={() => setDeleting(null)}>Отмена</button>
            <button className="btn btn-danger" onClick={finishDelete}>Удалить и перенести</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

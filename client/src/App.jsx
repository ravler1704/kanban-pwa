import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_COLUMNS } from './db.js';
import StatusBar from './components/StatusBar.jsx';
import ProjectBar, { ALL } from './components/ProjectBar.jsx';
import Column from './components/Column.jsx';
import CardEditor from './components/CardEditor.jsx';
import ConflictDialog from './components/ConflictDialog.jsx';
import ManageDialog from './components/ManageDialog.jsx';
import NewCardDialog, { defaultTarget } from './components/NewCardDialog.jsx';

const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
const groupKey = (card) => `${card.projectId}|${card.sectionId ?? ''}`;

// Selection lives in the URL (?project=&section=) so it can be bookmarked and the
// back button works; localStorage keeps it between launches of the installed app.
function readSelection() {
  const params = new URLSearchParams(location.search);
  if (params.has('project')) {
    return { project: params.get('project'), section: params.get('section') };
  }
  return {
    project: localStorage.getItem('selectedProject'),
    section: localStorage.getItem('selectedSection'),
  };
}

function useSelection() {
  const [selection, setSelection] = useState(readSelection);

  useEffect(() => {
    const onPop = () => setSelection(readSelection());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const select = useCallback((next) => {
    setSelection(next);
    const url = new URL(location.href);
    for (const key of ['project', 'section']) {
      const storageKey = key === 'project' ? 'selectedProject' : 'selectedSection';
      if (next[key]) {
        localStorage.setItem(storageKey, next[key]);
        url.searchParams.set(key, next[key]);
      } else {
        localStorage.removeItem(storageKey);
        url.searchParams.delete(key);
      }
    }
    if (url.href !== location.href) history.pushState(null, '', url);
  }, []);

  return [selection, select];
}

export default function App() {
  const [selection, select] = useSelection();
  const [openCardId, setOpenCardId] = useState(null);
  const [managing, setManaging] = useState(false);
  const [addingCard, setAddingCard] = useState(false);

  // A tapped reminder opens its card: `?card=` when the app starts from the notification,
  // a message from the service worker when the app is already open.
  useEffect(() => {
    async function openFromReminder(id) {
      const card = await db.cards.get(id);
      if (!card) return;
      select({ project: card.projectId, section: null });
      setOpenCardId(id);
    }
    const params = new URLSearchParams(location.search);
    if (params.has('card')) {
      openFromReminder(params.get('card'));
      params.delete('card');
      history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
    }
    const onMessage = (e) => {
      if (e.data?.type === 'open-card') openFromReminder(e.data.id);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [select]);

  const data = useLiveQuery(async () => {
    const [columns, projects, sections, pending] = await Promise.all([
      db.columns.toArray(),
      db.projects.toArray(),
      db.sections.toArray(),
      Promise.all([db.columns, db.projects, db.sections, db.cards].map((t) => t.where('dirty').equals(1).count())),
    ]);
    const conflicted = await db.cards.filter((c) => !!c.conflict).toArray();
    return { columns, projects, sections, conflicted, pending: pending.reduce((a, b) => a + b, 0) };
  }, []);

  // Until the first sync brings the server's columns, show the defaults (same ids).
  const columns = data?.columns.length
    ? data.columns.filter((c) => !c.deleted).sort(byPosition)
    : DEFAULT_COLUMNS;
  const columnIds = new Set(columns.map((c) => c.id));

  // ---- resolve the selection against live data ----
  const projects = data?.projects.filter((p) => !p.deleted).sort(byPosition) ?? [];
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const allSections = (data?.sections ?? [])
    .filter((s) => !s.deleted && projectById.has(s.projectId))
    .sort(byPosition);
  const sectionById = new Map(allSections.map((s) => [s.id, s]));
  const sectionsOf = (projectId) => allSections.filter((s) => s.projectId === projectId);

  // No project selected: all projects. No section selected: the whole project.
  const project = selection.project === ALL ? null : projectById.get(selection.project) ?? projects[0] ?? null;
  const projectSections = project ? sectionsOf(project.id) : [];
  const section = project && sectionById.get(selection.section)?.projectId === project.id
    ? sectionById.get(selection.section)
    : null;

  const scopeProjectIds = (project ? [project] : projects).map((p) => p.id).join(',');
  const projectCards = useLiveQuery(
    () => db.cards.where('projectId').anyOf(scopeProjectIds ? scopeProjectIds.split(',') : []).toArray(),
    [scopeProjectIds],
  );

  if (!data || !projectCards) return <div className="loading">Загрузка…</div>;

  // Cards whose section is gone (e.g. deleted on another device) belong to the project itself;
  // cards whose column is gone show up in the first column.
  const cards = projectCards
    .filter((c) => projectById.has(c.projectId))
    .map((c) => ({
      ...c,
      sectionId: c.sectionId && sectionById.has(c.sectionId) ? c.sectionId : null,
      columnId: columnIds.has(c.columnId) ? c.columnId : columns[0]?.id,
    }));

  const conflictsBySection = {};
  for (const c of data.conflicted) conflictsBySection[groupKey(c)] = (conflictsBySection[groupKey(c)] ?? 0) + 1;

  // Cards deleted remotely stay visible while the user has an unresolved conflict on them.
  const visible = cards
    .filter((c) => (!c.deleted || c.conflict) && (!section || c.sectionId === section.id))
    .sort(byPosition);
  const openCard = cards.find((c) => c.id === openCardId);

  // What the current view does not already say about where a card belongs.
  const cardLabel = section ? null : (card) => {
    const s = card.sectionId && sectionById.get(card.sectionId);
    if (project) return s ? s.name : null;
    const p = projectById.get(card.projectId);
    return s ? `${p.name} / ${s.name}` : p.name;
  };

  const target = project ? { projectId: project.id, sectionId: section?.id ?? null } : null;
  const pickerGroups = projects.map((p) => ({ project: p, sections: sectionsOf(p.id) }));

  const selectProject = (id) => select({ project: id, section: null });
  const selectSection = (id) => select({ project: project?.id ?? null, section: id });
  const openGroup = (card) => select({ project: card.projectId, section: card.sectionId });

  return (
    <div className="app">
      <StatusBar pending={data.pending} conflicts={data.conflicted.length} />

      {projects.length === 0 ? (
        <div className="empty">
          <p>Пока нет ни одного проекта.</p>
          <button className="btn btn-primary" onClick={() => setManaging(true)}>Создать проект</button>
        </div>
      ) : (
        <>
          <ProjectBar
            projects={projects}
            sections={projectSections}
            project={project}
            section={section}
            conflictsBySection={conflictsBySection}
            onSelectProject={selectProject}
            onSelectSection={selectSection}
            onManage={() => setManaging(true)}
            onAddCard={() => setAddingCard(true)}
          />
          <main className="board" style={{ '--columns': columns.length }}>
            {columns.map((col, index) => (
              <Column
                key={col.id}
                target={target ?? defaultTarget(pickerGroups)}
                column={col}
                prevColumn={columns[index - 1]}
                nextColumn={columns[index + 1]}
                cards={visible.filter((c) => c.columnId === col.id)}
                cardLabel={cardLabel}
                onOpen={setOpenCardId}
                onOpenGroup={openGroup}
              />
            ))}
          </main>
        </>
      )}

      {openCard && (openCard.conflict
        ? <ConflictDialog card={openCard} onClose={() => setOpenCardId(null)} />
        : <CardEditor card={openCard} columns={columns} groups={pickerGroups}
          onClose={() => setOpenCardId(null)} />)}

      {addingCard && (
        <NewCardDialog groups={pickerGroups} columns={columns} target={target} onClose={() => setAddingCard(false)} />
      )}

      {managing && (
        <ManageDialog
          columns={columns}
          columnsSynced={data.columns.length > 0}
          projects={projects}
          sections={allSections}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

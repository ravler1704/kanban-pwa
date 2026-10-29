import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.js';
import { columnModel } from './columnSets.js';
import StatusBar from './components/StatusBar.jsx';
import ProjectBar, { ALL } from './components/ProjectBar.jsx';
import Column from './components/Column.jsx';
import CardEditor from './components/CardEditor.jsx';
import ConflictDialog from './components/ConflictDialog.jsx';
import ManageDialog from './components/ManageDialog.jsx';
import NewCardDialog, { defaultTarget } from './components/NewCardDialog.jsx';
import CalendarView from './components/CalendarView.jsx';

const VIEW_KEY = 'view';
const ALL_SET_KEY = 'allProjectsColumnSet';
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
  const [view, setView] = useState(() => (localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'board'));

  const changeView = (next) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };
  // With all projects shown and several column sets in use: the set whose boards are shown.
  const [allProjectsSet, setAllProjectsSet] = useState(() => localStorage.getItem(ALL_SET_KEY));
  const changeAllProjectsSet = (id) => {
    setAllProjectsSet(id);
    localStorage.setItem(ALL_SET_KEY, id);
  };

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
    const tables = [db.columnSets, db.columns, db.projects, db.sections, db.cards];
    const [columnSets, columns, projects, sections, pending] = await Promise.all([
      db.columnSets.toArray(),
      db.columns.toArray(),
      db.projects.toArray(),
      db.sections.toArray(),
      Promise.all(tables.map((t) => t.where('dirty').equals(1).count())),
    ]);
    const conflicted = await db.cards.filter((c) => !!c.conflict).toArray();
    return { columnSets, columns, projects, sections, conflicted, pending: pending.reduce((a, b) => a + b, 0) };
  }, []);

  // ---- resolve the selection against live data ----
  const projects = data?.projects.filter((p) => !p.deleted).sort(byPosition) ?? [];
  const model = columnModel(data?.columnSets ?? [], data?.columns ?? [], projects);
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

  // A board shows one column set: the project's, or with all projects shown, the chosen one
  // (only projects using it are on the board).
  const usedSets = model.sets.filter((s) => model.projectsOf(s.id).length > 0);
  const boardSetId = project
    ? model.setIdOf(project)
    : (usedSets.find((s) => s.id === allProjectsSet) ?? usedSets[0] ?? model.sets[0]).id;
  const columns = model.columnsOf(boardSetId);

  const scopeProjectIds = (project ? [project] : projects).map((p) => p.id).join(',');
  const projectCards = useLiveQuery(
    () => db.cards.where('projectId').anyOf(scopeProjectIds ? scopeProjectIds.split(',') : []).toArray(),
    [scopeProjectIds],
  );

  if (!data || !projectCards) return <div className="loading">Загрузка…</div>;

  // Cards whose section is gone (e.g. deleted on another device) belong to the project itself;
  // cards whose column is not in the project's set show up in its first column.
  const projectColumnIds = new Map(projects.map((p) => [p.id, model.columnsOfProject(p.id).map((c) => c.id)]));
  const cards = projectCards
    .filter((c) => projectById.has(c.projectId))
    .map((c) => {
      const columnIds = projectColumnIds.get(c.projectId);
      return {
        ...c,
        sectionId: c.sectionId && sectionById.has(c.sectionId) ? c.sectionId : null,
        columnId: columnIds.includes(c.columnId) ? c.columnId : columnIds[0],
      };
    });

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
  const boardGroups = pickerGroups.filter((g) => model.setIdOf(g.project) === boardSetId);
  const boardCards = visible.filter((c) => model.setIdOf(projectById.get(c.projectId)) === boardSetId);

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
            columnSets={!project && view === 'board' && usedSets.length > 1 ? usedSets : null}
            columnSetId={boardSetId}
            onSelectColumnSet={changeAllProjectsSet}
            view={view}
            onView={changeView}
            onManage={() => setManaging(true)}
            onAddCard={() => setAddingCard(true)}
          />
          {view === 'calendar' ? (
            <CalendarView cards={visible} columns={model.columns} cardLabel={cardLabel} onOpen={setOpenCardId} />
          ) : (
            <main className="board" style={{ '--columns': columns.length }}>
              {columns.map((col, index) => (
                <Column
                  key={col.id}
                  target={target ?? defaultTarget(boardGroups)}
                  column={col}
                  prevColumn={columns[index - 1]}
                  nextColumn={columns[index + 1]}
                  cards={boardCards.filter((c) => c.columnId === col.id)}
                  cardLabel={cardLabel}
                  onOpen={setOpenCardId}
                  onOpenGroup={openGroup}
                />
              ))}
            </main>
          )}
        </>
      )}

      {openCard && (openCard.conflict
        ? <ConflictDialog card={openCard} onClose={() => setOpenCardId(null)} />
        : <CardEditor card={openCard} columnsOfProject={model.columnsOfProject} groups={pickerGroups}
          onClose={() => setOpenCardId(null)} />)}

      {addingCard && (
        <NewCardDialog groups={pickerGroups}
          columnsOfProject={model.columnsOfProject} target={target} onClose={() => setAddingCard(false)} />
      )}

      {managing && (
        <ManageDialog
          model={model}
          columnsSynced={data.columns.length > 0}
          initialSetId={boardSetId}
          projects={projects}
          sections={allSections}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

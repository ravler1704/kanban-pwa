import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { isCurrentBoard, isOwnBoard, switchBoard } from './board.js';
import { useReadOnly } from './public.js';
import { db } from './db.js';
import { columnModel } from './columnSets.js';
import StatusBar from './components/StatusBar.jsx';
import ProjectBar from './components/ProjectBar.jsx';
import Column from './components/Column.jsx';
import CardEditor from './components/CardEditor.jsx';
import ConflictDialog from './components/ConflictDialog.jsx';
import ManageDialog from './components/ManageDialog.jsx';
import NewCardDialog, { defaultTarget } from './components/NewCardDialog.jsx';
import CalendarView from './components/CalendarView.jsx';
import { splitTags, tagKey, tagsOf } from './tags.js';

const VIEW_KEY = 'view';
const ALL_SET_KEY = 'allProjectsColumnSet';
const TAG_FILTER_KEY = 'tagFilter';
const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
const groupKey = (card) => `${card.projectId}|${card.sectionId ?? ''}`;

const SELECTION_KEYS = { projects: 'selectedProjects', sections: 'selectedSections' };
const LEGACY_KEYS = { projects: 'selectedProject', sections: 'selectedSection' };
const LEGACY_PARAMS = { projects: 'project', sections: 'section' };

const idList = (value) => (value ? value.split(',').filter((id) => id && id !== 'all') : []);

// Selection (checked projects and sections; none checked: all of them) lives in the URL
// (?projects=&sections=) so it can be bookmarked and the back button works; localStorage keeps it
// between launches of the installed app. Older builds kept a single ?project=&section=.
function readSelection() {
  const params = new URLSearchParams(location.search);
  const read = (key) => {
    if (params.has(key)) return idList(params.get(key));
    if (params.has(LEGACY_PARAMS.projects)) return idList(params.get(LEGACY_PARAMS[key]));
    try {
      const stored = JSON.parse(localStorage.getItem(SELECTION_KEYS[key]));
      if (Array.isArray(stored)) return stored.filter((id) => typeof id === 'string');
    } catch { /* unreadable: fall back below */ }
    return idList(localStorage.getItem(LEGACY_KEYS[key]));
  };
  return { projects: read('projects'), sections: read('sections') };
}

function readTagFilter() {
  try {
    const keys = JSON.parse(localStorage.getItem(TAG_FILTER_KEY));
    return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
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
    for (const key of ['projects', 'sections']) {
      localStorage.removeItem(LEGACY_KEYS[key]);
      url.searchParams.delete(LEGACY_PARAMS[key]);
      localStorage.setItem(SELECTION_KEYS[key], JSON.stringify(next[key]));
      if (next[key].length) url.searchParams.set(key, next[key].join(','));
      else url.searchParams.delete(key);
    }
    if (url.href !== location.href) history.pushState(null, '', url);
  }, []);

  return [selection, select];
}

export default function App() {
  const readOnly = useReadOnly();
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

  // Tag keys: only cards with any of them are shown.
  const [tagFilter, setTagFilter] = useState(readTagFilter);
  const changeTagFilter = (next) => {
    setTagFilter(next);
    localStorage.setItem(TAG_FILTER_KEY, JSON.stringify(next));
  };
  const toggleTag = (name) => {
    const key = tagKey(name);
    changeTagFilter(tagFilter.includes(key) ? tagFilter.filter((k) => k !== key) : [...tagFilter, key]);
  };

  // A tapped reminder opens its card: `?card=` when the app starts from the notification,
  // a message from the service worker when the app is already open.
  useEffect(() => {
    async function openFromReminder(id) {
      const card = await db.cards.get(id);
      if (!card) return;
      select({ projects: [card.projectId], sections: [] });
      setOpenCardId(id);
    }
    const params = new URLSearchParams(location.search);
    if (params.has('card')) {
      openFromReminder(params.get('card'));
      params.delete('card');
      history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
    }
    const onMessage = (e) => {
      if (e.data?.type !== 'open-card') return;
      if (e.data.board && !isCurrentBoard(e.data.board)) {
        switchBoard(e.data.board, `?${new URLSearchParams({ card: e.data.id })}`);
      } else {
        openFromReminder(e.data.id);
      }
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

  // No project checked: every project except hidden ones. Hiding is the owner's way of tidying
  // their own view, so on a board shared with you nothing is hidden.
  const selectedProjects = projects.filter((p) => selection.projects.includes(p.id));
  const shownProjects = selectedProjects.length
    ? selectedProjects
    : projects.filter((p) => !isOwnBoard || !p.hidden);
  // Sections are picked within the checked projects (or the only one shown, e.g. by a public link).
  // A project with checked sections shows only them, the others are shown whole.
  const sectionScope = selectedProjects.length ? selectedProjects : shownProjects.length === 1 ? shownProjects : [];
  const sectionGroups = sectionScope
    .map((p) => ({ project: p, sections: sectionsOf(p.id) }))
    .filter((g) => g.sections.length > 0);
  const selectedSections = sectionGroups.flatMap((g) => g.sections.filter((s) => selection.sections.includes(s.id)));
  const pickedSectionsOf = (projectId) => selectedSections.filter((s) => s.projectId === projectId);
  // The single project / section in view, if it comes to one.
  const project = shownProjects.length === 1 ? shownProjects[0] : null;
  const section = project && selectedSections.length === 1 ? selectedSections[0] : null;

  // A board shows one column set: the project's, or with all projects shown, the chosen one
  // (only projects using it are on the board).
  const usedSets = model.sets.filter((s) => shownProjects.some((p) => model.setIdOf(p) === s.id));
  const boardSetId = project
    ? model.setIdOf(project)
    : (usedSets.find((s) => s.id === allProjectsSet) ?? usedSets[0] ?? model.sets[0]).id;
  const columns = model.columnsOf(boardSetId);

  const scopeProjectIds = shownProjects.map((p) => p.id).join(',');
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
  const pickedSectionIds = new Set(selectedSections.map((s) => s.id));
  const filteredProjects = new Set(selectedSections.map((s) => s.projectId));
  const inScope = cards.filter((c) => (!c.deleted || c.conflict)
    && (!filteredProjects.has(c.projectId) || pickedSectionIds.has(c.sectionId)));

  // Tags of the cards in view (spelled as first met), and the filtered ones even if no card has them now.
  const tagStats = new Map();
  for (const card of inScope) {
    for (const text of [card.title, card.description]) {
      for (const part of splitTags(text)) {
        if (typeof part === 'string') continue;
        const key = tagKey(part.tag);
        if (!tagStats.has(key)) tagStats.set(key, { key, name: part.tag, cards: new Set() });
        tagStats.get(key).cards.add(card.id);
      }
    }
  }
  for (const key of tagFilter) if (!tagStats.has(key)) tagStats.set(key, { key, name: key, cards: new Set() });
  const tags = [...tagStats.values()]
    .map(({ key, name, cards: tagged }) => ({ key, name, count: tagged.size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const activeTags = new Set(tagFilter);

  const visible = (tagFilter.length
    ? inScope.filter((c) => [...tagsOf(c)].some((key) => activeTags.has(key)))
    : inScope
  ).sort(byPosition);
  const openCard = cards.find((c) => c.id === openCardId);

  // What the current view does not already say about where a card belongs.
  const cardLabel = section ? null : (card) => {
    const s = card.sectionId && sectionById.get(card.sectionId);
    if (project) return s ? s.name : null;
    const p = projectById.get(card.projectId);
    return s ? `${p.name} / ${s.name}` : p.name;
  };

  // Where new cards go: somewhere in view (a project filtered to sections is not shown whole).
  const target = project
    ? { projectId: project.id, sectionId: pickedSectionsOf(project.id)[0]?.id ?? null }
    : null;
  const pickerGroups = projects.map((p) => ({ project: p, sections: sectionsOf(p.id) }));
  const shownGroups = shownProjects.map((p) => {
    const picked = pickedSectionsOf(p.id);
    return picked.length ? { project: p, sections: picked, whole: false } : { project: p, sections: sectionsOf(p.id) };
  });
  const boardGroups = shownGroups.filter((g) => model.setIdOf(g.project) === boardSetId);
  const boardCards = visible.filter((c) => model.setIdOf(projectById.get(c.projectId)) === boardSetId);

  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const checkedProjects = selectedProjects.map((p) => p.id);
  const checkedSections = selectedSections.map((s) => s.id);
  const toggleProject = (id) => {
    const next = toggle(checkedProjects, id);
    select({ projects: next, sections: selectedSections.filter((s) => next.includes(s.projectId)).map((s) => s.id) });
  };
  const toggleSection = (id) => select({ projects: checkedProjects, sections: toggle(checkedSections, id) });
  const openGroup = (card) => select({ projects: [card.projectId], sections: card.sectionId ? [card.sectionId] : [] });

  return (
    <div className="app">
      <StatusBar pending={data.pending} conflicts={data.conflicted.length} />

      {projects.length === 0 ? (
        !isOwnBoard ? (
          <div className="empty">
            <p>Открытые вам проекты появятся здесь после синхронизации.</p>
          </div>
        ) : (
          <div className="empty">
            <p>Пока нет ни одного проекта.</p>
            <button className="btn btn-primary" onClick={() => setManaging(true)}>Создать проект</button>
          </div>
        )
      ) : (
        <>
          <ProjectBar
            projects={projects}
            sectionGroups={sectionGroups}
            projectFilter={{
              selected: checkedProjects,
              onToggle: toggleProject,
              onClear: () => select({ projects: [], sections: [] }),
            }}
            sectionFilter={{
              selected: checkedSections,
              onToggle: toggleSection,
              onClear: () => select({ projects: checkedProjects, sections: [] }),
            }}
            conflictsBySection={conflictsBySection}
            columnSets={!project && view === 'board' && usedSets.length > 1 ? usedSets : null}
            columnSetId={boardSetId}
            onSelectColumnSet={changeAllProjectsSet}
            tagFilter={tags.length ? {
              tags,
              selected: tagFilter,
              onToggle: toggleTag,
              onClear: () => changeTagFilter([]),
            } : null}
            view={view}
            onView={changeView}
            onManage={readOnly ? null : () => setManaging(true)}
            onAddCard={readOnly ? null : () => setAddingCard(true)}
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
                  activeTags={activeTags}
                  onTag={toggleTag}
                  readOnly={readOnly}
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
          readOnly={readOnly} onClose={() => setOpenCardId(null)} />)}

      {addingCard && (
        <NewCardDialog groups={pickerGroups} columnsOfProject={model.columnsOfProject}
          target={target ?? defaultTarget(shownGroups)} onClose={() => setAddingCard(false)} />
      )}

      {managing && (
        <ManageDialog
          model={model}
          columnsSynced={data.columns.length > 0}
          initialSetId={boardSetId}
          initialProjectId={shownProjects[0]?.id ?? null}
          projects={projects}
          sections={allSections}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

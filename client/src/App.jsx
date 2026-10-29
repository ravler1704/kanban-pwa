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

// Selection keys in the URL and in localStorage; `toggled` is the previous name of `projectsOff`.
const SELECTION_KEYS = ['projectsOff', 'sectionsOff'];
const OLD_PROJECTS_OFF = 'toggled';
// Earlier builds kept explicit lists of checked ids (an empty one meaning all), as
// ?projects=&sections= or a single ?project=&section=, and in localStorage.
const LEGACY_PARAMS = [['projects', 'sections'], ['project', 'section']];
const LEGACY_STORAGE = [['selectedProjects', 'selectedSections'], ['selectedProject', 'selectedSection']];

const idList = (value) => (value ? value.split(',').filter((id) => id && id !== 'all') : []);

function storedList(key) {
  const value = localStorage.getItem(key);
  try {
    const list = JSON.parse(value);
    if (Array.isArray(list)) return list.filter((id) => typeof id === 'string');
  } catch { /* a plain id of an older build */ }
  return value === null ? null : idList(value);
}

// Selection: unchecked projects (`projectsOff`) and sections (`sectionsOff`), so new ones show up
// checked. It lives in the URL so the back button works; localStorage keeps it between launches of
// the installed app. `legacy` is a selection of an older build ({ projects, sections }), replaced by
// the first change.
function readSelection() {
  const params = new URLSearchParams(location.search);
  const none = { projectsOff: [], sectionsOff: [], legacy: null };
  if ([...SELECTION_KEYS, OLD_PROJECTS_OFF].some((key) => params.has(key))) {
    return {
      ...none,
      projectsOff: idList(params.get('projectsOff') ?? params.get(OLD_PROJECTS_OFF)),
      sectionsOff: idList(params.get('sectionsOff')),
    };
  }
  for (const [projects, sections] of LEGACY_PARAMS) {
    if (params.has(projects)) {
      return { ...none, legacy: { projects: idList(params.get(projects)), sections: idList(params.get(sections)) } };
    }
  }
  const projectsOff = storedList('projectsOff') ?? storedList(OLD_PROJECTS_OFF);
  if (projectsOff) return { ...none, projectsOff, sectionsOff: storedList('sectionsOff') ?? [] };
  for (const [projects, sections] of LEGACY_STORAGE) {
    const list = storedList(projects);
    if (list?.length) return { ...none, legacy: { projects: list, sections: storedList(sections) ?? [] } };
  }
  return none;
}

/** Only `projectId` checked; with `sectionId` only that section of it, otherwise all of its sections. */
function focusOn(projects, sections, sectionsOff, projectId, sectionId) {
  const own = sections.filter((s) => s.projectId === projectId);
  return {
    projectsOff: projects.filter((p) => p.id !== projectId).map((p) => p.id),
    sectionsOff: [
      ...sectionsOff.filter((id) => !own.some((s) => s.id === id)),
      ...(sectionId ? own.filter((s) => s.id !== sectionId).map((s) => s.id) : []),
    ],
  };
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
    setSelection({ ...next, legacy: null });
    const url = new URL(location.href);
    for (const key of [...LEGACY_PARAMS.flat(), OLD_PROJECTS_OFF]) url.searchParams.delete(key);
    for (const key of [...LEGACY_STORAGE.flat(), OLD_PROJECTS_OFF]) localStorage.removeItem(key);
    for (const key of SELECTION_KEYS) {
      localStorage.setItem(key, JSON.stringify(next[key]));
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
      const [projects, sections] = await Promise.all([db.projects.toArray(), db.sections.toArray()]);
      select(focusOn(projects.filter((p) => !p.deleted), sections, [], card.projectId, null));
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

  // A checked project shows its own cards (those in no section) and those of its checked sections.
  // An older build's empty list meant all projects / the whole project.
  const { legacy } = selection;
  const isChecked = (p) => (legacy?.projects.length
    ? legacy.projects.includes(p.id)
    : !selection.projectsOff.includes(p.id));
  const isSectionChecked = (s) => (legacy?.sections.some((id) => sectionById.get(id)?.projectId === s.projectId)
    ? legacy.sections.includes(s.id)
    : !selection.sectionsOff.includes(s.id));
  const shownProjects = projects.filter(isChecked);
  const sectionGroups = shownProjects
    .map((p) => ({ project: p, sections: sectionsOf(p.id) }))
    .filter((g) => g.sections.length > 0);
  const pickableSections = sectionGroups.flatMap((g) => g.sections);
  const checkedSectionIds = new Set(allSections.filter(isSectionChecked).map((s) => s.id));
  // The single project in view, if it comes to one.
  const project = shownProjects.length === 1 ? shownProjects[0] : null;

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
  const inScope = cards.filter((c) => (!c.deleted || c.conflict) && (!c.sectionId || checkedSectionIds.has(c.sectionId)));

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
  const cardLabel = (card) => {
    const s = card.sectionId && sectionById.get(card.sectionId);
    if (project) return s ? s.name : null;
    const p = projectById.get(card.projectId);
    return s ? `${p.name} / ${s.name}` : p.name;
  };

  // Where new cards go: the project itself is always in view.
  const target = project ? { projectId: project.id, sectionId: null } : null;
  const pickerGroups = projects.map((p) => ({ project: p, sections: sectionsOf(p.id) }));
  const shownGroups = shownProjects.map((p) => ({
    project: p,
    sections: sectionsOf(p.id).filter((s) => checkedSectionIds.has(s.id)),
  }));
  const boardGroups = shownGroups.filter((g) => model.setIdOf(g.project) === boardSetId);
  const boardCards = visible.filter((c) => model.setIdOf(projectById.get(c.projectId)) === boardSetId);

  // Changes are saved as the unchecked ids (see readSelection).
  const checkedProjects = shownProjects.map((p) => p.id);
  const projectsOff = projects.filter((p) => !isChecked(p)).map((p) => p.id);
  const sectionsOff = allSections.filter((s) => !checkedSectionIds.has(s.id)).map((s) => s.id);
  const saveProjectsOff = (ids) => select({ projectsOff: ids, sectionsOff });
  const saveSectionsOff = (ids) => select({ projectsOff, sectionsOff: ids });
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const pickableIds = pickableSections.map((s) => s.id);
  const allSectionsOn = pickableSections.every((s) => checkedSectionIds.has(s.id));
  const projectFilter = {
    selected: checkedProjects,
    onToggle: (id) => saveProjectsOff(toggle(projectsOff, id)),
    onSetAll: (on) => saveProjectsOff(on ? [] : projects.map((p) => p.id)),
    onClear: projectsOff.length ? () => saveProjectsOff([]) : null,
    summary: projectsOff.length ? null : 'Все проекты',
  };
  const sectionFilter = {
    selected: pickableIds.filter((id) => checkedSectionIds.has(id)),
    onToggle: (id) => saveSectionsOff(toggle(sectionsOff, id)),
    onSetAll: (on) => saveSectionsOff(on
      ? sectionsOff.filter((id) => !pickableIds.includes(id))
      : [...new Set([...sectionsOff, ...pickableIds])]),
    onClear: allSectionsOn ? null : () => saveSectionsOff(sectionsOff.filter((id) => !pickableIds.includes(id))),
    summary: allSectionsOn ? 'Все разделы' : null,
  };
  const openGroup = (card) => select(focusOn(projects, allSections, sectionsOff, card.projectId, card.sectionId));

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
            projectFilter={projectFilter}
            sectionFilter={sectionFilter}
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
          {shownProjects.length === 0 ? (
            <div className="empty">
              <p>Не отмечен ни один проект — отметьте нужные в списке «Проекты».</p>
            </div>
          ) : view === 'calendar' ? (
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
          target={target ?? defaultTarget(shownGroups) ?? defaultTarget(pickerGroups)} onClose={() => setAddingCard(false)} />
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

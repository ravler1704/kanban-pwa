import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState } from './auth.js';
import { isUnread, seenStore } from './seen.js';
import { dbName, isCurrentBoard, isOwnBoard, publicToken, switchBoard } from './board.js';
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
import ChatDialog from './components/ChatDialog.jsx';
import PeopleBar from './components/People.jsx';
import { splitTags, tagKey, tagsOf } from './tags.js';
import { liveSpaces, spaceIdOf } from './spaces.js';

const VIEW_KEY = 'view';
const ALL_SET_KEY = 'allProjectsColumnSet';
const TAG_FILTER_KEY = 'tagFilter';
const CARD_FILTER_KEY = `cardFilter:${dbName}`;
const SPACES_OFF_KEY = `spacesOff:${dbName}`;
const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
const groupKey = (card) => `${card.projectId}|${card.sectionId ?? ''}`;

// Selection keys in the URL and in localStorage, with their earlier names: lists of unchecked ids,
// which match the toggles while every project and section was checked by default.
const SELECTION_KEYS = { projectToggles: ['projectsOff', 'toggled'], sectionToggles: ['sectionsOff'] };
const OLD_KEYS = Object.values(SELECTION_KEYS).flat();
// Earlier builds kept explicit lists of checked ids (an empty one meaning all), as
// ?projects=&sections= or a single ?project=&section=, and in localStorage.
const LEGACY_PARAMS = [['projects', 'sections'], ['project', 'section']];
const LEGACY_STORAGE = [['selectedProjects', 'selectedSections'], ['selectedProject', 'selectedSection']];

// Whether a project / section is checked when the user has not changed it. A public link opens
// a single project, so it is always shown there.
const projectCheckedByDefault = (p) => !!publicToken || !p.hidden;
const sectionCheckedByDefault = (s) => !s.hidden;

/** The selection storing exactly the given checked ids. */
function toggles(projects, sections, projectIds, sectionIds) {
  return {
    projectToggles: projects.filter((p) => projectCheckedByDefault(p) !== projectIds.includes(p.id)).map((p) => p.id),
    sectionToggles: sections.filter((s) => sectionCheckedByDefault(s) !== sectionIds.includes(s.id)).map((s) => s.id),
  };
}

const idList = (value) => (value ? value.split(',').filter((id) => id && id !== 'all') : []);

function storedList(key) {
  const value = localStorage.getItem(key);
  try {
    const list = JSON.parse(value);
    if (Array.isArray(list)) return list.filter((id) => typeof id === 'string');
  } catch { /* a plain id of an older build */ }
  return value === null ? null : idList(value);
}

// Selection: projects and sections whose checkbox differs from its default (`projectToggles`,
// `sectionToggles`), so new ones show up as their default says. It lives in the URL so the back
// button works; localStorage keeps it between launches of the installed app. `legacy` is a selection
// of an older build ({ projects, sections }), replaced by the first change.
function readSelection() {
  const params = new URLSearchParams(location.search);
  const read = (get) => Object.fromEntries(Object.entries(SELECTION_KEYS).map(([key, oldKeys]) => [
    key, [key, ...oldKeys].map(get).find((list) => list != null) ?? null,
  ]));
  const none = { projectToggles: [], sectionToggles: [], legacy: null };
  const fromUrl = read((key) => (params.has(key) ? idList(params.get(key)) : null));
  if (Object.values(fromUrl).some(Boolean)) {
    return { ...none, projectToggles: fromUrl.projectToggles ?? [], sectionToggles: fromUrl.sectionToggles ?? [] };
  }
  for (const [projects, sections] of LEGACY_PARAMS) {
    if (params.has(projects)) {
      return { ...none, legacy: { projects: idList(params.get(projects)), sections: idList(params.get(sections)) } };
    }
  }
  const stored = read(storedList);
  if (stored.projectToggles) return { ...none, projectToggles: stored.projectToggles, sectionToggles: stored.sectionToggles ?? [] };
  for (const [projects, sections] of LEGACY_STORAGE) {
    const list = storedList(projects);
    if (list?.length) return { ...none, legacy: { projects: list, sections: storedList(sections) ?? [] } };
  }
  return none;
}

/**
 * Checked ids with only `projectId` checked: with `sectionId` only that section of it, otherwise all of
 * its sections; the other projects' sections keep `checkedSections`.
 */
function focusOn(sections, checkedSections, projectId, sectionId) {
  const own = sections.filter((s) => s.projectId === projectId);
  return [[projectId], [
    ...checkedSections.filter((id) => !own.some((s) => s.id === id)),
    ...(sectionId ? [sectionId] : own.map((s) => s.id)),
  ]];
}

function readList(key) {
  try {
    const keys = JSON.parse(localStorage.getItem(key));
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
    for (const key of [...LEGACY_PARAMS.flat(), ...OLD_KEYS]) url.searchParams.delete(key);
    for (const key of [...LEGACY_STORAGE.flat(), ...OLD_KEYS]) localStorage.removeItem(key);
    for (const key of Object.keys(SELECTION_KEYS)) {
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
  const me = useSyncExternalStore(authState.subscribe, authState.get).user?.id ?? '';
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get);
  const [selection, select] = useSelection();
  const [openCardId, setOpenCardId] = useState(null);
  const [managing, setManaging] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  // The chats window: null closed, '' the list, 'project:<id>' or 'dm:<user id>' a conversation.
  const [chat, setChat] = useState(null);
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
  const [tagFilter, setTagFilter] = useState(() => readList(TAG_FILTER_KEY));
  const changeTagFilter = (next) => {
    setTagFilter(next);
    localStorage.setItem(TAG_FILTER_KEY, JSON.stringify(next));
  };
  const toggleTag = (name) => {
    const key = tagKey(name);
    changeTagFilter(tagFilter.includes(key) ? tagFilter.filter((k) => k !== key) : [...tagFilter, key]);
  };

  // Spaces unchecked in the filter: their projects are not shown (new spaces are checked).
  const [spacesOff, setSpacesOff] = useState(() => readList(SPACES_OFF_KEY));
  const changeSpacesOff = useCallback((next) => {
    setSpacesOff(next);
    localStorage.setItem(SPACES_OFF_KEY, JSON.stringify(next));
  }, []);

  // Card ids: only these cards are shown.
  const [cardFilter, setCardFilter] = useState(() => readList(CARD_FILTER_KEY));
  const changeCardFilter = (next) => {
    setCardFilter(next);
    localStorage.setItem(CARD_FILTER_KEY, JSON.stringify(next));
  };

  // A tapped reminder opens its card: `?card=` when the app starts from the notification,
  // a message from the service worker when the app is already open.
  // Opens a card, first showing its project (and space) if it is not on the board.
  const openFromReminder = useCallback(async (id) => {
    const card = await db.cards.get(id);
    if (!card || (card.deleted && !card.conflict)) return;
    const [projects, sections, spaces] = await Promise.all([db.projects.toArray(), db.sections.toArray(), db.spaces.toArray()]);
    const live = sections.filter((s) => !s.deleted);
    const checked = live.filter(sectionCheckedByDefault).map((s) => s.id);
    select(toggles(projects.filter((p) => !p.deleted), live, ...focusOn(live, checked, card.projectId, null)));
    const project = projects.find((p) => p.id === card.projectId);
    const spaceId = project && spaceIdOf(project, liveSpaces(spaces));
    const off = readList(SPACES_OFF_KEY);
    if (off.includes(spaceId)) changeSpacesOff(off.filter((s) => s !== spaceId));
    setOpenCardId(id);
  }, [select, changeSpacesOff]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('card') || params.has('chat')) {
      if (params.has('card')) openFromReminder(params.get('card'));
      if (params.has('chat')) setChat(params.get('chat'));
      params.delete('card');
      params.delete('chat');
      history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
    }
    const onMessage = (e) => {
      if (e.data?.type === 'open-chat') {
        // Direct messages open on any board; a project's chat on the project's board.
        if (e.data.board && !e.data.chat.startsWith('dm:') && !isCurrentBoard(e.data.board)) {
          switchBoard(e.data.board, `?${new URLSearchParams({ chat: e.data.chat })}`);
        } else {
          setChat(e.data.chat);
        }
        return;
      }
      if (e.data?.type !== 'open-card') return;
      if (e.data.board && !isCurrentBoard(e.data.board)) {
        switchBoard(e.data.board, `?${new URLSearchParams({ card: e.data.id })}`);
      } else {
        openFromReminder(e.data.id);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [openFromReminder]);

  const data = useLiveQuery(async () => {
    const tables = [db.spaces, db.columnSets, db.columns, db.projects, db.sections, db.cards];
    const [spaces, columnSets, columns, projects, sections, pending] = await Promise.all([
      db.spaces.toArray(),
      db.columnSets.toArray(),
      db.columns.toArray(),
      db.projects.toArray(),
      db.sections.toArray(),
      Promise.all(tables.map((t) => t.where('dirty').equals(1).count())),
    ]);
    const conflicted = await db.cards.filter((c) => !!c.conflict).toArray();
    return { spaces, columnSets, columns, projects, sections, conflicted, pending: pending.reduce((a, b) => a + b, 0) };
  }, []);

  // ---- resolve the selection against live data ----
  const projects = data?.projects.filter((p) => !p.deleted).sort(byPosition) ?? [];
  const spaces = liveSpaces(data?.spaces ?? []);
  const spaceOn = (id) => !spacesOff.includes(id);
  // Projects of the checked spaces: the «Проекты» list and the board show only them.
  const spaceProjects = projects.filter((p) => spaceOn(spaceIdOf(p, spaces)));
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
    : projectCheckedByDefault(p) !== selection.projectToggles.includes(p.id));
  const isSectionChecked = (s) => (legacy?.sections.some((id) => sectionById.get(id)?.projectId === s.projectId)
    ? legacy.sections.includes(s.id)
    : sectionCheckedByDefault(s) !== selection.sectionToggles.includes(s.id));
  const shownProjects = spaceProjects.filter(isChecked);
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

  const projectComments = useLiveQuery(
    () => db.comments.where('projectId').anyOf(scopeProjectIds ? scopeProjectIds.split(',') : [])
      .filter((c) => c.cardId && !c.deleted).toArray(),
    [scopeProjectIds],
  );

  if (!data || !projectCards) return <div className="loading">Загрузка…</div>;

  const commentStats = new Map();
  for (const c of projectComments ?? []) {
    const stats = commentStats.get(c.cardId) ?? { count: 0, unread: 0 };
    stats.count += 1;
    if (isUnread(seen, c, me)) stats.unread += 1;
    commentStats.set(c.cardId, stats);
  }

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
        comments: commentStats.get(c.id) ?? null,
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

  // Cards to pick: those in view and the picked ones even if their section is not shown now.
  const liveCards = new Map(cards.filter((c) => !c.deleted || c.conflict).map((c) => [c.id, c]));
  const pickedCards = cardFilter.filter((id) => liveCards.has(id));
  const picked = new Set(pickedCards);
  const cardItems = [...new Set([...inScope, ...pickedCards.map((id) => liveCards.get(id))])]
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || byPosition(a, b))
    .map((c) => ({ key: c.id, name: `${c.number ? `#${c.number} ` : ''}${c.title.trim() || 'Без названия'}` }));

  const visible = inScope
    .filter((c) => !tagFilter.length || [...tagsOf(c)].some((key) => activeTags.has(key)))
    .filter((c) => !picked.size || picked.has(c.id))
    .sort(byPosition);
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

  // Changes are saved as differences from the defaults (see readSelection). Projects of unchecked
  // spaces keep their checkboxes.
  const checkedProjects = shownProjects.map((p) => p.id);
  const checkedElsewhere = projects.filter((p) => !spaceProjects.includes(p) && isChecked(p)).map((p) => p.id);
  const checkedSections = [...checkedSectionIds];
  const save = (projectIds, sectionIds) => select(toggles(projects, allSections, projectIds, sectionIds));
  const saveProjects = (ids) => save([...checkedElsewhere, ...ids], checkedSections);
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const pickableIds = pickableSections.map((s) => s.id);
  const otherSections = checkedSections.filter((id) => !pickableIds.includes(id));
  const projectsAsDefault = spaceProjects.every((p) => isChecked(p) === projectCheckedByDefault(p));
  const sectionsAsDefault = pickableSections.every((s) => checkedSectionIds.has(s.id) === sectionCheckedByDefault(s));
  const projectFilter = {
    selected: checkedProjects,
    onToggle: (id) => saveProjects(toggle(checkedProjects, id)),
    onSetAll: (on) => saveProjects(on ? spaceProjects.map((p) => p.id) : []),
    onClear: projectsAsDefault ? null
      : () => saveProjects(spaceProjects.filter(projectCheckedByDefault).map((p) => p.id)),
    summary: checkedProjects.length === spaceProjects.length ? 'Все проекты' : null,
  };
  const checkedSpaces = spaces.filter((s) => spaceOn(s.id)).map((s) => s.id);
  const spaceFilter = {
    items: spaces.map((s) => ({
      key: s.id, name: s.name, count: projects.filter((p) => spaceIdOf(p, spaces) === s.id).length,
    })),
    selected: checkedSpaces,
    onToggle: (id) => changeSpacesOff(toggle(spacesOff.filter((x) => spaces.some((s) => s.id === x)), id)),
    onSetAll: (on) => changeSpacesOff(on ? [] : spaces.map((s) => s.id)),
    onClear: checkedSpaces.length === spaces.length ? null : () => changeSpacesOff([]),
    summary: checkedSpaces.length === spaces.length && spaces.length > 1 ? 'Все пространства' : null,
  };
  const sectionFilter = {
    selected: pickableIds.filter((id) => checkedSectionIds.has(id)),
    onToggle: (id) => save(checkedProjects, toggle(checkedSections, id)),
    onSetAll: (on) => save(checkedProjects, on ? [...otherSections, ...pickableIds] : otherSections),
    onClear: sectionsAsDefault ? null : () => save(checkedProjects, [
      ...otherSections,
      ...pickableSections.filter(sectionCheckedByDefault).map((s) => s.id),
    ]),
    summary: pickableIds.every((id) => checkedSectionIds.has(id)) ? 'Все разделы' : null,
  };
  const openGroup = (card) => save(...focusOn(allSections, checkedSections, card.projectId, card.sectionId));

  return (
    <div className="app">
      <StatusBar pending={data.pending} conflicts={data.conflicted.length} projects={projects} onChat={setChat} />

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
            projects={spaceProjects}
            sectionGroups={sectionGroups}
            spaceFilter={publicToken ? null : spaceFilter}
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
              onSetAll: (on) => changeTagFilter(on ? tags.map((t) => t.key) : []),
              onClear: () => changeTagFilter([]),
            } : null}
            cardFilter={cardItems.length ? {
              items: cardItems,
              selected: pickedCards,
              summary: pickedCards.length
                ? pickedCards.map((id) => liveCards.get(id)).map((c) => (c.number ? `#${c.number}` : c.title)).join(', ')
                : undefined,
              onToggle: (id) => changeCardFilter(picked.has(id) ? pickedCards.filter((k) => k !== id) : [...pickedCards, id]),
              onSetAll: (on) => changeCardFilter(on ? cardItems.map((i) => i.key) : []),
              onClear: pickedCards.length ? () => changeCardFilter([]) : null,
            } : null}
            view={view}
            onView={changeView}
            onManage={readOnly ? null : () => setManaging(true)}
            onAddCard={readOnly ? null : () => setAddingCard(true)}
          >
            {!publicToken && <PeopleBar projects={shownProjects} allProjects={projects} onChat={setChat} />}
          </ProjectBar>
          {shownProjects.length === 0 ? (
            <div className="empty">
              <p>
                {!checkedSpaces.length ? 'Не отмечено ни одно пространство — отметьте нужные в списке «Пространства».'
                  : !spaceProjects.length ? 'В отмеченных пространствах пока нет проектов.'
                    : 'Не отмечен ни один проект — отметьте нужные в списке «Проекты».'}
              </p>
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

      {chat !== null && !publicToken && (
        <ChatDialog key={chat} projects={projects} thread={chat} onClose={() => setChat(null)}
          onOpenCard={(id) => {
            setChat(null);
            openFromReminder(id);
          }} />
      )}

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
          spaces={spaces}
          spacesSynced={data.spaces.some((s) => !s.deleted)}
          newProjectSpaceId={checkedSpaces[0] ?? spaces[0].id}
          onSpaceDeleted={(id, targetId) => {
            // Its projects stay in view in the space they moved to.
            if (spaceOn(id)) changeSpacesOff(spacesOff.filter((s) => s !== targetId && s !== id));
          }}
          sections={allSections}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState } from './auth.js';
import { isUnread, seenStore } from './seen.js';
import { dbName, isCurrentBoard, isOwnBoard, publicToken, switchBoard } from './board.js';
import { useReadOnly } from './public.js';
import { db } from './db.js';
import { columnModel } from './columnSets.js';
import StatusBar from './components/StatusBar.jsx';
import FolderBar from './components/FolderBar.jsx';
import Column from './components/Column.jsx';
import CardEditor from './components/CardEditor.jsx';
import ConflictDialog from './components/ConflictDialog.jsx';
import ManageDialog from './components/ManageDialog.jsx';
import NewCardDialog, { defaultTarget } from './components/NewCardDialog.jsx';
import CalendarView from './components/CalendarView.jsx';
import ChatDialog from './components/ChatDialog.jsx';
import PeopleBar from './components/People.jsx';
import { tagKey, tagNames, tagsOf } from './tags.js';
import { descendants, folderPath, folderTree, liveFolders, topFolderIds } from './folders.js';
import { folderIdsOf, peopleStore } from './people.js';

const VIEW_KEY = 'view';
const ALL_SET_KEY = 'allProjectsColumnSet';
const TAG_FILTER_KEY = 'tagFilter';
const CARD_FILTER_KEY = `cardFilter:${dbName}`;
const byPosition = (a, b) => a.position - b.position || a.id.localeCompare(b.id);

// The folder filter is a list of unchecked folder ids (`folderToggles`), so new folders show up checked.
// It lives in the URL so the back button works; localStorage keeps it between launches of the installed app.
// Earlier builds kept the unchecked projects and sections in these keys (their ids are folder ids now).
const TOGGLES_KEY = 'folderToggles';
const LEGACY_TOGGLE_KEYS = ['projectToggles', 'sectionToggles', 'projectsOff', 'sectionsOff', 'toggled'];
// Spaces unchecked in an earlier build: their whole subtree is unchecked once, then this is dropped.
const SPACES_OFF_KEY = `spacesOff:${dbName}`;
// Earlier builds left projects and sections with `hidden` unchecked until the user changed them;
// a board's selection is converted once, keeping what was in view.
const OLD_DEFAULTS_KEY = `selectionWithoutDefaults:${dbName}`;

const idList = (value) => (value ? value.split(',').filter((id) => id && id !== 'all') : []);

function storedList(key) {
  const value = localStorage.getItem(key);
  try {
    const list = JSON.parse(value);
    if (Array.isArray(list)) return list.filter((id) => typeof id === 'string');
  } catch { /* a plain id of an older build */ }
  return value === null ? null : idList(value);
}

/** The unchecked folder ids: from the URL, else from localStorage; the lists of earlier builds are merged. */
function readSelection() {
  const params = new URLSearchParams(location.search);
  const keys = [TOGGLES_KEY, ...LEGACY_TOGGLE_KEYS];
  const fromUrl = keys.filter((key) => params.has(key)).flatMap((key) => idList(params.get(key)));
  if (keys.some((key) => params.has(key))) return [...new Set(fromUrl)];
  return [...new Set(keys.flatMap((key) => storedList(key) ?? []))];
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
    setSelection(next);
    const url = new URL(location.href);
    for (const key of LEGACY_TOGGLE_KEYS) {
      url.searchParams.delete(key);
      localStorage.removeItem(key);
    }
    localStorage.setItem(TOGGLES_KEY, JSON.stringify(next));
    if (next.length) url.searchParams.set(TOGGLES_KEY, next.join(','));
    else url.searchParams.delete(TOGGLES_KEY);
    if (url.href !== location.href) history.pushState(null, '', url);
  }, []);

  return [selection, select];
}

export default function App() {
  const readOnly = useReadOnly();
  const me = useSyncExternalStore(authState.subscribe, authState.get).user?.id ?? '';
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get);
  const people = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const [selection, select] = useSelection();
  const [openCardId, setOpenCardId] = useState(null);
  const [managing, setManaging] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  // The chats window: null closed, '' the list, 'folder:<id>' or 'dm:<user id>' a conversation.
  const [chat, setChat] = useState(null);
  const [view, setView] = useState(() => (localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'board'));

  const changeView = (next) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };
  // With several column sets in view: the set whose cards are shown.
  const [allFoldersSet, setAllFoldersSet] = useState(() => localStorage.getItem(ALL_SET_KEY));
  const changeAllFoldersSet = (id) => {
    setAllFoldersSet(id);
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

  // Card ids: only these cards are shown.
  const [cardFilter, setCardFilter] = useState(() => readList(CARD_FILTER_KEY));
  const changeCardFilter = (next) => {
    setCardFilter(next);
    localStorage.setItem(CARD_FILTER_KEY, JSON.stringify(next));
  };

  // A tapped reminder opens its card: `?card=` when the app starts from the notification,
  // a message from the service worker when the app is already open.
  // Opens a card, first checking its folder if it is not on the board.
  const openFromReminder = useCallback(async (id) => {
    const card = await db.cards.get(id);
    if (!card || (card.deleted && !card.conflict)) return;
    const off = readSelection();
    if (off.includes(card.folderId)) select(off.filter((x) => x !== card.folderId));
    setOpenCardId(id);
  }, [select]);

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
        // Direct messages open on any board; a folder's chat on the folder's board.
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
    const tables = [db.folders, db.columnSets, db.columns, db.cards];
    const [folders, columnSets, columns, pending] = await Promise.all([
      db.folders.toArray(),
      db.columnSets.toArray(),
      db.columns.toArray(),
      Promise.all(tables.map((t) => t.where('dirty').equals(1).count())),
    ]);
    const conflicted = await db.cards.filter((c) => !!c.conflict).toArray();
    return { folders, columnSets, columns, conflicted, pending: pending.reduce((a, b) => a + b, 0) };
  }, []);

  // ---- resolve the selection against live data ----
  const folders = liveFolders(data?.folders ?? [], { standIn: isOwnBoard });
  const tree = folderTree(folders);
  const model = columnModel(data?.columnSets ?? [], data?.columns ?? [], folders);

  // A card is shown if its folder is checked; folders are independent of those above and below them.
  // A public link shows everything it opens.
  const unchecked = publicToken ? [] : selection;
  const shownFolders = folders.filter((f) => !unchecked.includes(f.id));
  const scopeFolderIds = shownFolders.map((f) => f.id).join(',');
  const folderCards = useLiveQuery(
    () => db.cards.where('folderId').anyOf(scopeFolderIds ? scopeFolderIds.split(',') : []).toArray(),
    [scopeFolderIds],
  );
  const folderComments = useLiveQuery(
    () => db.comments.where('folderId').anyOf(scopeFolderIds ? scopeFolderIds.split(',') : [])
      .filter((c) => c.cardId && !c.deleted).toArray(),
    [scopeFolderIds],
  );

  // Selections of earlier builds are converted once: `hidden` projects and unchecked spaces (with their projects).
  useEffect(() => {
    if (!data || publicToken) return;
    const legacySpaces = localStorage.getItem(SPACES_OFF_KEY) !== null;
    const oldDefaults = !localStorage.getItem(OLD_DEFAULTS_KEY);
    if (!legacySpaces && !oldDefaults) return;
    const live = liveFolders(data.folders, { standIn: false });
    const extra = oldDefaults ? live.filter((f) => f.hidden).map((f) => f.id) : [];
    for (const id of readList(SPACES_OFF_KEY)) {
      if (live.some((f) => f.id === id)) extra.push(id, ...descendants(live, id).map((f) => f.id));
    }
    localStorage.setItem(OLD_DEFAULTS_KEY, '1');
    localStorage.removeItem(SPACES_OFF_KEY);
    if (extra.length) select([...new Set([...selection, ...extra])]);
  });

  if (!data || !folderCards) return <div className="loading">Загрузка…</div>;

  // What the user may add cards to: on someone else's board the folders opened to them
  // (the folders above are only there to show the way).
  const mine = !isOwnBoard && !publicToken ? folderIdsOf(people.find((p) => p.id === me)) : [];
  const writable = mine.length ? new Set(mine) : null;
  const usable = writable ? folders.filter((f) => writable.has(f.id)) : folders;
  const chatFolders = usable;

  const commentStats = new Map();
  for (const c of folderComments ?? []) {
    const stats = commentStats.get(c.cardId) ?? { count: 0, unread: 0 };
    stats.count += 1;
    if (isUnread(seen, c, me)) stats.unread += 1;
    commentStats.set(c.cardId, stats);
  }

  // Cards whose column is not in the folder's set show up in its first column.
  const folderColumnIds = new Map(folders.map((f) => [f.id, model.columnsOfFolder(f.id).map((c) => c.id)]));
  const cards = folderCards
    .filter((c) => tree.byId.has(c.folderId))
    .map((c) => {
      const columnIds = folderColumnIds.get(c.folderId);
      return {
        ...c,
        columnId: columnIds.includes(c.columnId) ? c.columnId : columnIds[0],
        comments: commentStats.get(c.id) ?? null,
      };
    });

  const conflictsByFolder = {};
  for (const c of data.conflicted) conflictsByFolder[c.folderId] = (conflictsByFolder[c.folderId] ?? 0) + 1;

  // Cards deleted remotely stay visible while the user has an unresolved conflict on them.
  const inScope = cards.filter((c) => !c.deleted || c.conflict);

  // Tags of the cards in view (spelled as first met), and the filtered ones even if no card has them now.
  const tagStats = new Map();
  for (const card of inScope) {
    for (const text of [card.title, card.description]) {
      for (const name of tagNames(text)) {
        const key = tagKey(name);
        if (!tagStats.has(key)) tagStats.set(key, { key, name, cards: new Set() });
        tagStats.get(key).cards.add(card.id);
      }
    }
  }
  for (const key of tagFilter) if (!tagStats.has(key)) tagStats.set(key, { key, name: key, cards: new Set() });
  const tags = [...tagStats.values()]
    .map(({ key, name, cards: tagged }) => ({ key, name, count: tagged.size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const activeTags = new Set(tagFilter);

  // Cards to pick: those in view and the picked ones even if their folder is not shown now.
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

  // Where new cards go: the only checked folder, else the last used one.
  const shownUsable = usable.filter((f) => shownFolders.includes(f));
  const target = shownFolders.length === 1 ? shownFolders[0].id : defaultTarget(shownUsable);

  // The folders on the board: the checked ones that have cards or are the target.
  const hasCards = new Set(inScope.map((c) => c.folderId));
  const groups = shownFolders.filter((f) => hasCards.has(f.id) || f.id === target);
  const activeFolders = groups.length ? groups : shownFolders;

  // A board shows one column set: the folder's, or with several in view, the chosen one
  // (only folders using it are on the board).
  const usedSets = model.sets.filter((s) => activeFolders.some((f) => model.setIdOf(f) === s.id));
  const boardSetId = (usedSets.find((s) => s.id === allFoldersSet) ?? usedSets[0] ?? model.sets[0]).id;
  const columns = model.columnsOf(boardSetId);
  const boardFolders = shownUsable.filter((f) => model.setIdOf(f) === boardSetId);
  const boardTarget = target && boardFolders.some((f) => f.id === target) ? target : defaultTarget(boardFolders);
  const boardCards = visible.filter((c) => model.setIdOf(tree.byId.get(c.folderId)) === boardSetId);

  // What the current view does not already say about where a card belongs: the path below the folders
  // all the folders in view share.
  const paths = activeFolders.map((f) => folderPath(f, folders));
  let common = 0;
  while (paths.length && paths.every((p) => p[common] && p[common].id === paths[0][common]?.id)) common += 1;
  const cardLabel = (card) => {
    const folder = tree.byId.get(card.folderId);
    const rest = folder ? folderPath(folder, folders).slice(common) : [];
    return rest.length ? rest.map((f) => f.name).join(' / ') : null;
  };

  // The last choice is kept (see readSelection).
  const checkedIds = shownFolders.map((f) => f.id);
  const saveChecked = (ids) => select(folders.filter((f) => !ids.includes(f.id)).map((f) => f.id));
  const allChecked = checkedIds.length === folders.length;
  // A folder is checked or unchecked together with everything inside it.
  const subtree = (id) => [id, ...descendants(folders, id).map((f) => f.id)];
  const toggleSubtree = (id) => {
    const ids = subtree(id);
    const on = !checkedIds.includes(id);
    saveChecked(on ? [...new Set([...checkedIds, ...ids])] : checkedIds.filter((x) => !ids.includes(x)));
  };
  const partial = folders
    .filter((f) => {
      const inside = descendants(folders, f.id);
      const n = inside.filter((d) => checkedIds.includes(d.id)).length;
      return n > 0 && (n < inside.length || !checkedIds.includes(f.id));
    })
    .map((f) => f.id);
  // The filter shows one folder with everything inside it, or all ('').
  const tops = topFolderIds(checkedIds, folders);
  const single = tops.length === 1 && subtree(tops[0]).length === checkedIds.length ? tops[0] : null;
  const folderFilter = {
    value: allChecked ? '' : single,
    selected: checkedIds,
    indeterminate: partial,
    onToggle: toggleSubtree,
    onOnly: (id) => saveChecked(subtree(id)),
    onSetAll: (on) => saveChecked(on ? folders.map((f) => f.id) : []),
    onClear: allChecked ? null : () => saveChecked(folders.map((f) => f.id)),
    summary: allChecked ? 'Все папки' : checkedIds.length
      ? topFolderIds(checkedIds, folders).map((id) => tree.byId.get(id)?.name).join(', ')
      : null,
  };
  const openGroup = (card) => saveChecked([card.folderId]);

  return (
    <div className="app">
      <StatusBar pending={data.pending} conflicts={data.conflicted.length} folders={chatFolders} onChat={setChat} />

      {folders.length === 0 ? (
        !isOwnBoard ? (
          <div className="empty">
            <p>Открытые вам папки появятся здесь после синхронизации.</p>
          </div>
        ) : (
          <div className="empty">
            <p>Пока нет ни одной папки.</p>
            <button className="btn btn-primary" onClick={() => setManaging(true)}>Создать папку</button>
          </div>
        )
      ) : (
        <>
          <FolderBar
            folders={folders}
            folderFilter={folderFilter}
            conflictsByFolder={conflictsByFolder}
            columnSets={shownFolders.length !== 1 && view === 'board' && usedSets.length > 1 ? usedSets : null}
            columnSetId={boardSetId}
            onSelectColumnSet={changeAllFoldersSet}
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
            {!publicToken && <PeopleBar folders={shownFolders} allFolders={folders} onChat={setChat} />}
          </FolderBar>
          {shownFolders.length === 0 ? (
            <div className="empty">
              <p>Не отмечена ни одна папка — отметьте нужные в списке «Папки».</p>
            </div>
          ) : view === 'calendar' ? (
            <CalendarView cards={visible} columns={model.columns} cardLabel={cardLabel} onOpen={setOpenCardId} />
          ) : (
            <main className="board" style={{ '--columns': columns.length }}>
              {columns.map((col, index) => (
                <Column
                  key={col.id}
                  target={boardTarget}
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
        : <CardEditor card={openCard} columnsOfFolder={model.columnsOfFolder} folders={usable}
          readOnly={readOnly} onClose={() => setOpenCardId(null)} />)}

      {chat !== null && !publicToken && (
        <ChatDialog key={chat} folders={chatFolders} thread={chat} onClose={() => setChat(null)}
          onOpenCard={(id) => {
            setChat(null);
            openFromReminder(id);
          }} />
      )}

      {addingCard && (
        <NewCardDialog folders={usable} columnsOfFolder={model.columnsOfFolder}
          target={target ?? defaultTarget(usable)} onClose={() => setAddingCard(false)} />
      )}

      {managing && (
        <ManageDialog
          model={model}
          columnsSynced={data.columns.length > 0}
          initialSetId={boardSetId}
          initialFolderId={shownFolders[0]?.id ?? folders[0]?.id ?? null}
          folders={folders}
          foldersSynced={data.folders.some((f) => !f.deleted)}
          writable={writable}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

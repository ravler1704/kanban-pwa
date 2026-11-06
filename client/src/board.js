import Dexie from 'dexie';

// Which board (space) this device shows: null for the user's main space, otherwise its id: another
// space of the user, or a space someone shared. Each board has its own local database, so switching
// keeps unsynced changes and works offline; a switch reloads the page to open the other one.

const BOARD_KEY = 'board';
const OWN_DB = 'kanban';
const SHARED_DB_PREFIX = 'kanban-board:';

const cachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem('authUser'));
  } catch {
    return null;
  }
};
const ownUserId = () => cachedUser()?.id ?? null;

const normalize = (board) => (board && board !== ownUserId() ? board : null);

function store(board) {
  if (board) localStorage.setItem(BOARD_KEY, board);
  else localStorage.removeItem(BOARD_KEY);
}

// A reminder opens `/?board=<owner>&card=<id>`: show that board.
function initialBoard() {
  const params = new URLSearchParams(location.search);
  if (params.has('board')) {
    store(normalize(params.get('board')));
    params.delete('board');
    history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }
  return localStorage.getItem(BOARD_KEY) || null;
}

// A public link `/p/<token>` opens one folder without signing in, apart from the own board.
const PUBLIC_DB_PREFIX = 'kanban-public:';
export const publicToken = location.pathname.match(/^\/p\/([\w-]{8,64})\/?$/)?.[1] ?? null;

export const currentBoard = publicToken ? null : initialBoard();
export const dbName = publicToken ? `${PUBLIC_DB_PREFIX}${publicToken}`
  : currentBoard ? `${SHARED_DB_PREFIX}${currentBoard}` : OWN_DB;
/** Whether `board` (null: the main space) is one of the user's own spaces. */
export const isOwnSpace = (board) => !board || (cachedUser()?.spaces ?? []).some((s) => s.id === board);

/** One of the own spaces: neither someone else's space nor a public link. */
export const isOwnBoard = !publicToken && isOwnSpace(currentBoard);

/** «Входящие» of this board: the own space's, or on someone else's space the user's own, seen by them only. */
export const inboxId = isOwnBoard || publicToken ? 'inbox' : `inbox:${ownUserId() ?? ''}`;

/** `board` is one of `user.boards`: { id, space (its name), name, email, picture (of its owner) }. */
export const boardName = (board) => board.space || 'Общее пространство';

export const boardOwnerName = (board) => board.name || board.email || 'без имени';

export const isCurrentBoard = (board) => normalize(board) === currentBoard;

/** Request headers that select the board on the server. */
export function boardHeaders() {
  if (publicToken) return { 'X-Public': publicToken };
  return currentBoard ? { 'X-Board': currentBoard } : {};
}

/** For EventSource, which can't send headers. */
export function boardQuery() {
  if (publicToken) return `?public=${publicToken}`;
  return currentBoard ? `?board=${encodeURIComponent(currentBoard)}` : '';
}

/** Opens another board (null: the own one); `search` is the query of the page to open. */
export function switchBoard(board, search = '') {
  store(normalize(board));
  // Folder ids belong to the board that is being left.
  for (const key of ['folderToggles', 'projectToggles', 'sectionToggles', 'projectsOff', 'sectionsOff', 'toggled', 'selectedProjects', 'selectedSections', 'selectedProject', 'selectedSection']) {
    localStorage.removeItem(key);
  }
  location.assign(`/${search}`);
}

/** The shared board is no longer available: its local copy is removed and the own board opens. */
export async function dropCurrentBoard() {
  if (!currentBoard) return;
  alert('Доступа к этому пространству больше нет. Открывается ваше пространство.');
  await Dexie.delete(dbName).catch(() => {});
  switchBoard(null);
}

/** Removes the local copies of all shared boards (signing out). */
export async function deleteSharedBoards() {
  const names = await Dexie.getDatabaseNames().catch(() => []);
  await Promise.all(names.filter((n) => n.startsWith(SHARED_DB_PREFIX) && n !== dbName).map((n) => Dexie.delete(n)));
  store(null);
}

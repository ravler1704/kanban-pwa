import Dexie from 'dexie';

// Which board this device shows: null for the user's own, otherwise the owner's user id
// (a board someone shared). Each board has its own local database, so switching keeps
// unsynced changes and works offline; a switch reloads the page to open the other one.

const BOARD_KEY = 'board';
const OWN_DB = 'kanban';
const SHARED_DB_PREFIX = 'kanban-board:';

const ownUserId = () => {
  try {
    return JSON.parse(localStorage.getItem('authUser'))?.id ?? null;
  } catch {
    return null;
  }
};

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

// A public link `/p/<token>` opens one project without signing in, apart from the own board.
const PUBLIC_DB_PREFIX = 'kanban-public:';
export const publicToken = location.pathname.match(/^\/p\/([\w-]{8,64})\/?$/)?.[1] ?? null;

export const currentBoard = publicToken ? null : initialBoard();
export const dbName = publicToken ? `${PUBLIC_DB_PREFIX}${publicToken}`
  : currentBoard ? `${SHARED_DB_PREFIX}${currentBoard}` : OWN_DB;
/** The own board: neither someone else's board nor a public link. */
export const isOwnBoard = !currentBoard && !publicToken;

/** `board` is one of `user.boards`: { id, name, email, picture } of its owner. */
export const boardName = (board) => `Доска: ${board.name || board.email || 'без имени'}`;

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
  // Project and section ids belong to the board that is being left.
  for (const key of ['selectedProjects', 'selectedSections', 'selectedProject', 'selectedSection']) {
    localStorage.removeItem(key);
  }
  location.assign(`/${search}`);
}

/** The shared board is no longer available: its local copy is removed and the own board opens. */
export async function dropCurrentBoard() {
  if (!currentBoard) return;
  alert('Доступа к этой доске больше нет. Открывается ваша доска.');
  await Dexie.delete(dbName).catch(() => {});
  switchBoard(null);
}

/** Removes the local copies of all shared boards (signing out). */
export async function deleteSharedBoards() {
  const names = await Dexie.getDatabaseNames().catch(() => []);
  await Promise.all(names.filter((n) => n.startsWith(SHARED_DB_PREFIX) && n !== dbName).map((n) => Dexie.delete(n)));
  store(null);
}

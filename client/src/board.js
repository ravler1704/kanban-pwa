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

export const currentBoard = initialBoard();
export const dbName = currentBoard ? `${SHARED_DB_PREFIX}${currentBoard}` : OWN_DB;

/** `board` is one of `user.boards`: { id, name, email, picture } of its owner. */
export const boardName = (board) => `Доска: ${board.name || board.email || 'без имени'}`;

export const isCurrentBoard = (board) => normalize(board) === currentBoard;

/** Request headers that select the board on the server. */
export const boardHeaders = () => (currentBoard ? { 'X-Board': currentBoard } : {});

/** For EventSource, which can't send headers. */
export const boardQuery = () => (currentBoard ? `?board=${encodeURIComponent(currentBoard)}` : '');

/** Opens another board (null: the own one); `search` is the query of the page to open. */
export function switchBoard(board, search = '') {
  store(normalize(board));
  // Project and section ids belong to the board that is being left.
  localStorage.removeItem('selectedProject');
  localStorage.removeItem('selectedSection');
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

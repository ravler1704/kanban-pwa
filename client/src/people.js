import { boardHeaders, dbName, publicToken } from './board.js';

// Who sees the folders of the board on this device: [{ id, name, email, picture, owner, folders }].
// Kept per board so the avatars and comment authors show offline too.

const KEY = `people:${dbName}`;
const REFRESH_MS = 5 * 60 * 1000;

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

let people = read();
let loadedAt = 0;
const listeners = new Set();

export const peopleStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => people,
};

export async function refreshPeople({ force = false } = {}) {
  if (publicToken || !navigator.onLine || (!force && Date.now() - loadedAt < REFRESH_MS)) return;
  loadedAt = Date.now();
  try {
    const res = await fetch('/api/people', { headers: boardHeaders(), cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    people = body.people;
    localStorage.setItem(KEY, JSON.stringify(people));
    for (const l of listeners) l();
  } catch {
    loadedAt = 0;
  }
}

export const personName = (p) => p?.name || p?.email || 'Без имени';

/** Ids of the folders the person sees (older servers sent `projects` and `spaces`). */
export const folderIdsOf = (p) => p?.folders ?? [...(p?.projects ?? []), ...(p?.spaces ?? [])];

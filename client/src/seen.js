import { dbName } from './board.js';

// Until when this device has read each thread of comments: `card:<id>` (a card's comments) and
// `project:<id>` (a project's chat). Comments from before the first start of this build count as
// read, so an existing board does not light up everywhere at once.

const KEY = `seen:${dbName}`;
const SINCE_KEY = `seenSince:${dbName}`;

if (!localStorage.getItem(SINCE_KEY)) localStorage.setItem(SINCE_KEY, String(Date.now()));
const since = Number(localStorage.getItem(SINCE_KEY)) || 0;

function read() {
  try {
    const map = JSON.parse(localStorage.getItem(KEY));
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

let seen = read();
const listeners = new Set();

export const seenStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => seen,
};

export function markSeen(thread, at) {
  if ((seen[thread] ?? 0) >= at) return;
  seen = { ...seen, [thread]: at };
  localStorage.setItem(KEY, JSON.stringify(seen));
  for (const l of listeners) l();
}

export const threadOf = (comment) => (comment.cardId ? `card:${comment.cardId}` : `project:${comment.projectId}`);

/** Whether `comment` is one the user (`me`) has not read yet. */
export const isUnread = (seenMap, comment, me) => !comment.deleted && comment.authorId !== me
  && comment.createdAt > Math.max(since, seenMap[threadOf(comment)] ?? 0);

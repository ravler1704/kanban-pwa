import { newId } from './db.js';

// Support: the user's conversation with the administrators, and for administrators everyone's (tickets).
// Kept on the server only, like direct messages. `me`: { status, last, unread }; `tickets` (administrators):
// [{ userId, user, status, updatedAt, last, unread }].

let state = { admin: false, me: null, tickets: null, loaded: false };
const listeners = new Set();
const threadListeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const supportStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => state,
};

async function request(url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(res.status === 403 ? 'Эти обращения видят только администраторы.' : 'Не удалось связаться с сервером.');
    err.status = res.status;
    throw err;
  }
  return data;
}

const path = (user) => `/api/support/${encodeURIComponent(user)}`;

export async function refreshSupport() {
  if (!navigator.onLine) return;
  try {
    const { admin, me, tickets } = await request('/api/support');
    setState({ admin, me, tickets, loaded: true });
  } catch {
    // shown again on the next change
  }
}

/** A conversation changed: 'me' (the user's own) or a user's id (administrators). */
export function supportChanged(user) {
  refreshSupport();
  for (const l of threadListeners) l(user);
}

export function onSupportThreadChange(listener) {
  threadListeners.add(listener);
  return () => threadListeners.delete(listener);
}

export const loadSupportThread = (user) => request(path(user));

export async function sendSupport(user, text, images = []) {
  const { message } = await request(path(user), { id: newId(), text, images });
  supportChanged(user);
  return message;
}

export async function editSupport(user, id, text) {
  await request(`${path(user)}/${encodeURIComponent(id)}/edit`, { text });
  supportChanged(user);
}

export async function deleteSupport(user, id) {
  await request(`${path(user)}/${encodeURIComponent(id)}/delete`, {});
  supportChanged(user);
}

export async function setSupportStatus(user, status) {
  await request(`${path(user)}/status`, { status });
  supportChanged(user);
}

export async function markSupportRead(user, at) {
  const unread = user === 'me' ? state.me?.unread : state.tickets?.find((t) => t.userId === user)?.unread;
  if (!unread) return;
  if (user === 'me') setState({ me: { ...state.me, unread: 0 } });
  else setState({ tickets: state.tickets.map((t) => (t.userId === user ? { ...t, unread: 0 } : t)) });
  await request(`${path(user)}/read`, { at }).catch(() => {});
}

/** Unread answers to the user and, for administrators, unread messages of all tickets. */
export const supportUnread = (s) => (s.me?.unread ?? 0) + (s.tickets ?? []).reduce((sum, t) => sum + t.unread, 0);

/** Open tickets that wait for an answer (administrators). */
export const openTickets = (s) => (s.tickets ?? []).filter((t) => t.status === 'open');

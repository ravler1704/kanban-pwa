import { newId } from './db.js';

// Direct messages: kept on the server only (the people may be on different boards), so they need
// the network. `contacts` are everyone the user shares a folder with or wrote with before:
// [{ id, name, email, picture, canWrite, last, unread }].

let state = { contacts: [], loaded: false, error: null };
const listeners = new Set();
// Open conversations reload when a message arrives (see the events in sync.js).
const threadListeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const dmStore = {
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
    const err = new Error(data.error === 'no shared project'
      ? 'У вас больше нет общих папок — написать нельзя.'
      : 'Не удалось связаться с сервером.');
    err.status = res.status;
    throw err;
  }
  return data;
}

const path = (peer) => `/api/dm/${encodeURIComponent(peer)}`;

export async function refreshDm() {
  if (!navigator.onLine) return;
  try {
    const { contacts } = await request('/api/dm');
    setState({ contacts, loaded: true, error: null });
  } catch (err) {
    if (err.status !== 401) setState({ error: err.message });
  }
}

/** A message for `peer` arrived or changed (`peer` undefined: any). */
export function dmChanged(peer) {
  refreshDm();
  for (const l of threadListeners) l(peer);
}

export function onDmThreadChange(listener) {
  threadListeners.add(listener);
  return () => threadListeners.delete(listener);
}

export const loadThread = (peer, before) => request(`${path(peer)}${before ? `?before=${before}` : ''}`);

export async function sendDm(peer, text) {
  const { message } = await request(path(peer), { id: newId(), text });
  dmChanged(peer);
  return message;
}

export async function editDm(peer, id, text) {
  await request(`${path(peer)}/${encodeURIComponent(id)}/edit`, { text });
  dmChanged(peer);
}

export async function deleteDm(peer, id) {
  await request(`${path(peer)}/${encodeURIComponent(id)}/delete`, {});
  dmChanged(peer);
}

export async function markDmRead(peer, at) {
  const contact = state.contacts.find((c) => c.id === peer);
  if (!contact?.unread) return;
  setState({ contacts: state.contacts.map((c) => (c.id === peer ? { ...c, unread: 0 } : c)) });
  await request(`${path(peer)}/read`, { at }).catch(() => {});
}

export const dmUnread = (contacts) => contacts.reduce((sum, c) => sum + c.unread, 0);

import { useSyncExternalStore } from 'react';
import { publicToken } from './board.js';

// What the public link this page was opened with gives: { project: { id, name }, mode, owner }; `project`
// is the folder (the wire name is historical). mode: 'view' (read only) or 'edit' (cards and folders). Cached so the page opens offline.
//   status: 'loading' (never fetched) | 'ready' | 'gone' (the owner removed the link)

const CACHE_KEY = publicToken ? `publicLink:${publicToken}` : null;

function cached() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

let state = { status: 'loading', info: null };
if (publicToken) {
  const info = cached();
  if (info) state = { status: 'ready', info };
}
const listeners = new Set();

function setState(next) {
  state = next;
  for (const l of listeners) l();
}

const publicState = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => state,
};

export const usePublicLink = () => useSyncExternalStore(publicState.subscribe, publicState.get);

/** Whether nothing can be changed: a public link for viewing (or one not known yet). */
export function useReadOnly() {
  const { info } = usePublicLink();
  return Boolean(publicToken) && info?.mode !== 'edit';
}

export const publicLinkGone = () => state.status === 'gone';

export function markLinkGone() {
  if (CACHE_KEY) localStorage.removeItem(CACHE_KEY);
  setState({ status: 'gone', info: null });
}

// ---- the owner's links: [{ token, project, mode }] (`project` is the folder's id), null until loaded ----

let links = null;
const linkListeners = new Set();

function setLinks(list) {
  links = list;
  for (const l of linkListeners) l();
}

const linksState = {
  subscribe(listener) {
    linkListeners.add(listener);
    return () => linkListeners.delete(listener);
  },
  get: () => links,
};

export const usePublicLinks = () => useSyncExternalStore(linksState.subscribe, linksState.get);

export const publicUrl = (token) => `${location.origin}/p/${token}`;

export async function loadPublicLinks() {
  const res = await fetch('/api/public-links', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось загрузить публичные ссылки.');
  setLinks((await res.json()).links);
}

async function postLinks(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404 && url === '/api/public-links') {
    throw new Error('Проект ещё не сохранён на сервере — подождите синхронизации.');
  }
  if (!res.ok) throw new Error('Не удалось изменить ссылку. Попробуйте ещё раз.');
  setLinks((await res.json()).links);
}

/** Creates the folder's link or changes what it allows (`mode`: 'view' | 'edit'). */
export const savePublicLink = (folderId, mode) => postLinks('/api/public-links', { project: folderId, mode });

export const removePublicLink = (folderId) => postLinks('/api/public-links/remove', { project: folderId });

/** Asks the server what the link opens; keeps the cached answer when it is unreachable. */
export async function loadPublicLink() {
  if (!publicToken) return;
  try {
    const res = await fetch(`/api/public/${publicToken}`, { cache: 'no-store' });
    if (res.status === 404) {
      markLinkGone();
      return;
    }
    if (!res.ok) return;
    const info = await res.json();
    localStorage.setItem(CACHE_KEY, JSON.stringify(info));
    setState({ status: 'ready', info });
  } catch {
    // Offline: keep what we know.
  }
}

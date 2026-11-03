import { useSyncExternalStore } from 'react';

// Which board filters are main (shown in the filters panel) and which open with «Ещё».
const KEY = 'mainFilters';
const DEFAULT_MAIN = ['folders'];

export const FILTERS = [
  { id: 'folders', label: 'Папки' },
  { id: 'columns', label: 'Колонки', note: 'Есть, когда в виду папки с разными наборами колонок' },
  { id: 'tags', label: 'Теги', note: 'Есть, когда у карточек есть теги' },
  { id: 'author', label: 'Автор' },
  { id: 'holder', label: 'На ком' },
];

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list : DEFAULT_MAIN;
  } catch {
    return DEFAULT_MAIN;
  }
}

let main = read();
const listeners = new Set();

const store = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => main,
};

export function setMainFilters(next) {
  main = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

export const useMainFilters = () => useSyncExternalStore(store.subscribe, store.get);

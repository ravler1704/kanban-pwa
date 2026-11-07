import { checkAuth, isSignedOut, markSignedOut } from './auth.js';
import { boardHeaders, boardQuery, dropCurrentBoard, publicToken } from './board.js';
import { markLinkGone, publicLinkGone } from './public.js';
import { clearLocalData, db, getDeviceId, isDirty, pickFields, sameValue, tableOf, TYPES } from './db.js';
import { dmChanged, refreshDm } from './dm.js';
import { refreshSupport, supportChanged } from './support.js';
import { refreshPeople } from './people.js';

const deviceId = getDeviceId();

// ---- status store (consumed via useSyncExternalStore) ----

let status = {
  online: navigator.onLine,
  syncing: false,
  serverReachable: true,
  lastSyncAt: null,
  error: null,
};
const listeners = new Set();

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

export const syncStatus = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => status,
};

// ---- network ----

async function api(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...boardHeaders() },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function serverSnapshot(type, record) {
  return { ...pickFields(type, record), version: record.version, updatedAt: record.updatedAt, updatedBy: record.updatedBy };
}

const typeNames = Object.keys(TYPES);
const allTables = () => typeNames.map(tableOf);

/**
 * Orders folders so that a folder comes after the dirty folder that is its parent: the server needs
 * the parent first (a new parent, or one a folder was just moved under). Others keep their order.
 */
function sortFolders(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const done = new Set();
  const out = [];
  const visit = (folder, path) => {
    if (done.has(folder.id) || path.has(folder.id)) return;
    path.add(folder.id);
    const parent = byId.get(folder.parentId);
    if (parent) visit(parent, path);
    done.add(folder.id);
    out.push(folder);
  };
  for (const f of folders) visit(f, new Set());
  folders.splice(0, folders.length, ...out);
}

// ---- push: send every dirty record as a diff against the last known server state ----

async function push() {
  const sent = new Map();
  const changes = [];

  for (const type of typeNames) {
    const dirty = await tableOf(type).where('dirty').equals(1).toArray();
    dirty.sort((a, b) => (a.createdLocally ?? 0) - (b.createdLocally ?? 0));
    if (type === 'folder') sortFolders(dirty);
    for (const rec of dirty) {
      sent.set(rec.id, rec);
      const fields = {};
      for (const f of TYPES[type].fields) {
        if (!rec.server || !sameValue(rec[f], rec.server[f])) fields[f] = rec[f] ?? null;
      }
      changes.push({
        type,
        id: rec.id,
        baseVersion: rec.server?.version ?? 0,
        fields,
        base: rec.server ? pickFields(type, rec.server) : null,
      });
    }
  }
  if (changes.length === 0) return;

  const epoch = (await db.meta.get('epoch'))?.value ?? null;
  let results;
  try {
    ({ results } = await api('/api/sync', { method: 'POST', body: { deviceId, epoch, changes } }));
  } catch (err) {
    // The server database was reset: local data refers to records that no longer exist.
    if (err.status === 409) {
      await clearLocalData();
      return;
    }
    throw err;
  }

  await db.transaction('rw', allTables(), async () => {
    for (const r of results) {
      const table = tableOf(r.type);
      const local = await table.get(r.id);
      const sentRec = sent.get(r.id);
      if (!local || !sentRec) continue;

      const next = { ...local, server: serverSnapshot(r.type, r.record) };
      for (const f of TYPES[r.type].fields) {
        // Keep edits the user made while the request was in flight.
        if (sameValue(local[f], sentRec[f])) next[f] = r.record[f];
      }
      if (r.status === 'conflict') {
        next.conflict = { fields: r.conflicts, local: pickFields(r.type, sentRec) };
      }
      next.dirty = isDirty(r.type, next);
      await table.put(next);
    }
  });
}

// ---- pull: fetch everything changed on the server since the last known seq ----

// An outdated build (still cached on a device) drops record types and fields it does not know,
// and the seq moves past them. So the first pull of a build with other types or fields starts over.
const SCHEMA = JSON.stringify(typeNames.map((type) => [type, TYPES[type].fields]));

async function pull() {
  const schemaChanged = (await db.meta.get('schema'))?.value !== SCHEMA;
  let since = schemaChanged ? 0 : (await db.meta.get('lastSeq'))?.value ?? 0;
  let hasMore = true;

  while (hasMore) {
    const res = await api(`/api/sync?since=${since}`);

    const epoch = (await db.meta.get('epoch'))?.value;
    if (epoch && epoch !== res.epoch) {
      await clearLocalData();
      since = 0;
      continue;
    }

    await db.transaction('rw', [...allTables(), db.meta], async () => {
      for (const rec of res.records) {
        if (!TYPES[rec.type]) continue;
        const table = tableOf(rec.type);
        const local = await table.get(rec.id);
        const fields = pickFields(rec.type, rec);
        const server = serverSnapshot(rec.type, rec);

        if (!local) {
          await table.put({ id: rec.id, ...fields, server, dirty: 0, conflict: null });
          continue;
        }
        // Local unsynced edits win here; the next push merges them on the server.
        if (local.dirty) continue;

        const next = { ...local, ...fields, server, dirty: 0 };
        if (local.conflict) {
          const conflictFields = {};
          for (const [f, v] of Object.entries(local.conflict.fields)) conflictFields[f] = { ...v, theirs: rec[f] };
          next.conflict = { ...local.conflict, fields: conflictFields };
        }
        await table.put(next);
      }
      await db.meta.bulkPut([
        { key: 'lastSeq', value: res.seq },
        { key: 'epoch', value: res.epoch },
        { key: 'schema', value: SCHEMA },
      ]);
    });

    since = res.seq;
    hasMore = res.hasMore;
  }
}

// ---- orchestration ----

let running = false;
let rerun = false;

export async function sync() {
  if (running) {
    rerun = true;
    return;
  }
  if (!navigator.onLine) {
    setStatus({ online: false });
    return;
  }
  if (!publicToken && isSignedOut()) return;
  if (publicLinkGone()) return;

  running = true;
  setStatus({ syncing: true, online: true });
  try {
    do {
      rerun = false;
      await push();
      await pull();
    } while (rerun);
    setStatus({ serverReachable: true, error: null, lastSyncAt: Date.now() });
  } catch (err) {
    if (err.status === 401) {
      // Local changes stay in IndexedDB and are pushed after signing in again.
      markSignedOut();
      setStatus({ serverReachable: true, error: null });
    } else if (err.status === 403) {
      await dropCurrentBoard();
    } else if (err.status === 404 && publicToken) {
      stopEvents();
      markLinkGone();
    } else {
      setStatus({ serverReachable: false, error: err.message || String(err) });
    }
  } finally {
    running = false;
    setStatus({ syncing: false });
  }
}

let debounceTimer = null;

export function requestSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sync, 400);
}

// Live updates from other devices. EventSource reconnects by itself after network errors,
// but mobile browsers may close it for good while the app is in the background, and it
// gives up on a 401 (not signed in).
let events = null;

function connectEvents() {
  if ((!publicToken && isSignedOut()) || publicLinkGone()) return;
  if (events && events.readyState !== EventSource.CLOSED) return;
  events = new EventSource(`/api/events${boardQuery()}`);
  events.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      // A direct message to or from the user (the peer's id), on whatever board.
      if ('dm' in data) dmChanged(data.dm);
      // A message to the support or from it: 'me' or the user's id (for administrators).
      else if ('support' in data) supportChanged(data.support);
      // Someone opened a board to the user or closed it.
      else if (data.boards) checkAuth();
      else if (data.from !== deviceId) requestSync();
    } catch {
      // ignore malformed messages
    }
  };
  events.onopen = () => {
    requestSync();
    if (!publicToken) {
      refreshDm();
      refreshSupport();
    }
  };
}

export function stopEvents() {
  events?.close();
  events = null;
}

/** Reconnects live updates and syncs, e.g. after returning to the app or signing in. */
export function resume() {
  connectEvents();
  requestSync();
  refreshPeople();
}

let started = false;

export function startSync() {
  if (started) return;
  started = true;

  window.addEventListener('offline', () => setStatus({ online: false }));
  connectEvents();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
  });
  // iOS restores pages from the back/forward cache without a visibilitychange.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) resume();
  });
  window.addEventListener('focus', resume);
  window.addEventListener('online', () => {
    setStatus({ online: true });
    resume();
  });

  setInterval(() => {
    connectEvents();
    sync();
    refreshPeople();
  }, 30_000);
  sync();
  refreshPeople({ force: true });
}

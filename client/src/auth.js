import { clearLocalData, db } from './db.js';
import { resume, stopEvents } from './sync.js';

// Sign-in state. The last known user is cached so the app opens offline with local data;
// the server is the authority whenever it is reachable (401 → signed out).
//   status: 'disabled' (server has no auth) | 'signedIn' | 'signedOut' | 'unknown' (never checked, offline)

const USER_KEY = 'authUser';
const CONFIG_KEY = 'authConfig';

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};

function initialState() {
  const config = readJson(CONFIG_KEY);
  const user = readJson(USER_KEY);
  if (config && !config.enabled) return { status: 'disabled', user: null, clientId: null, devLogin: false };
  return {
    status: user ? 'signedIn' : 'unknown',
    user,
    clientId: config?.clientId ?? null,
    devLogin: Boolean(config?.devLogin),
  };
}

let state = initialState();
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  if (patch.user !== undefined) {
    if (patch.user) localStorage.setItem(USER_KEY, JSON.stringify(patch.user));
    else localStorage.removeItem(USER_KEY);
  }
  for (const l of listeners) l();
}

export const authState = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => state,
};

export const isSignedOut = () => state.status === 'signedOut';

export function markSignedOut() {
  if (state.status === 'signedOut' || state.status === 'disabled') return;
  stopEvents();
  setState({ status: 'signedOut', user: null });
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Asks the server who we are; keeps the cached state when it is unreachable. */
export async function checkAuth() {
  try {
    const config = await getJson('/api/auth/config');
    if (config.status !== 200) return;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config.body));
    if (!config.body.enabled) {
      setState({ status: 'disabled', user: null, clientId: null, devLogin: false });
      return;
    }
    setState({ clientId: config.body.clientId, devLogin: Boolean(config.body.devLogin) });

    const me = await getJson('/api/auth/me');
    if (me.status === 200) {
      const wasSignedOut = state.status !== 'signedIn';
      setState({ status: 'signedIn', user: me.body.user });
      if (wasSignedOut) resume();
    } else if (me.status === 401) {
      markSignedOut();
    }
  } catch {
    // Offline: keep what we know.
  }
}

/** `credential` is the ID token from Google Identity Services. Throws with a user-facing message. */
export function signInWithGoogle(credential) {
  return signIn('/api/auth/google', { credential });
}

/** Local development: the server's test account, no Google involved. */
export function signInAsTestUser() {
  return signIn('/api/auth/dev', {});
}

async function signIn(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 403 && body.error === 'not allowed') {
    throw new Error(`У аккаунта ${body.email} нет доступа к этой доске.`);
  }
  if (!res.ok) throw new Error('Не удалось войти. Попробуйте ещё раз.');
  setState({ status: 'signedIn', user: body.user });
  resume();
}

/** Signs out and removes the board from this device. Returns false if the user cancelled. */
export async function signOut() {
  const pending = (await Promise.all(
    [db.columns, db.projects, db.sections, db.cards].map((t) => t.where('dirty').equals(1).count()),
  )).reduce((a, b) => a + b, 0);
  if (pending > 0 && !confirm(`Есть несинхронизированные изменения (${pending}). При выходе они пропадут. Выйти?`)) {
    return false;
  }
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  stopEvents();
  await clearLocalData();
  setState({ status: 'signedOut', user: null });
  return true;
}

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

const configFields = (config) => ({
  clientId: config?.clientId ?? null,
  yandexClientId: config?.yandexClientId ?? null,
  devLogin: Boolean(config?.devLogin),
});

function initialState() {
  const config = readJson(CONFIG_KEY);
  const user = readJson(USER_KEY);
  // `notice`: a sign-in error to show on the login screen (e.g. after a provider redirect).
  if (config && !config.enabled) return { status: 'disabled', user: null, notice: null, ...configFields(null) };
  return { status: user ? 'signedIn' : 'unknown', user, notice: null, ...configFields(config) };
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
      setState({ status: 'disabled', user: null, ...configFields(null) });
      return;
    }
    setState(configFields(config.body));

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
  return signIn('google', { credential });
}

/** Local development: the server's test account, no provider involved. */
export function signInAsTestUser() {
  return signIn('dev', {});
}

async function postAuth(provider, payload) {
  const res = await fetch(`/api/auth/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function authError({ status, body }, action) {
  if (status === 403 && body.error === 'not allowed') {
    return new Error(`У аккаунта ${body.email ?? ''} нет доступа к этой доске.`);
  }
  if (status === 502) return new Error('Сервис входа не отвечает. Попробуйте позже.');
  return new Error(`Не удалось ${action}. Попробуйте ещё раз.`);
}

async function signIn(provider, payload) {
  const res = await postAuth(provider, payload);
  if (res.status !== 200) throw authError(res, 'войти');
  setState({ status: 'signedIn', user: res.body.user, notice: null });
  resume();
}

const plural = (n, one, few, many) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

/**
 * Links another account to the signed-in user. If that account already has its own board,
 * asks whether to merge it into the current one. Returns false if the user declined.
 */
export async function linkAccount(provider, payload) {
  let res = await postAuth(provider, { ...payload, link: true });
  if (res.status === 409 && res.body.error === 'has board') {
    const { projects, cards } = res.body.board;
    const who = res.body.email ? `Аккаунт ${res.body.email}` : 'Этот аккаунт';
    const ok = confirm(
      `${who} уже входит в другую доску (${plural(projects, 'проект', 'проекта', 'проектов')}, `
      + `${plural(cards, 'карточка', 'карточки', 'карточек')}). Объединить её с текущей? `
      + 'Её проекты и карточки перейдут сюда, а вход через любой из аккаунтов будет открывать эту доску.',
    );
    if (!ok) return false;
    res = await postAuth(provider, { ...payload, link: true, merge: true });
  }
  if (res.status === 401 && res.body.error === 'unauthorized') {
    markSignedOut();
    throw new Error('Сессия истекла, войдите снова.');
  }
  if (res.status !== 200) throw authError(res, 'привязать аккаунт');
  setState({ user: res.body.user });
  resume();
  return true;
}

export async function unlinkAccount({ provider, subject }) {
  const res = await fetch('/api/auth/unlink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, subject }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Не удалось отвязать аккаунт.');
  setState({ user: body.user });
}

// Yandex OAuth (implicit flow): the page goes to Yandex and comes back with the access token
// in the URL fragment, which never reaches our server logs.
const YANDEX_PENDING_KEY = 'yandexAuth';

export function startYandexAuth({ link = false } = {}) {
  const state = crypto.randomUUID();
  localStorage.setItem(YANDEX_PENDING_KEY, JSON.stringify({ state, link, at: Date.now() }));
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: authState.get().yandexClientId,
    redirect_uri: `${location.origin}/`,
    state,
  });
  // Linking usually means another Yandex account: let the user pick it.
  if (link) params.set('force_confirm', 'yes');
  location.assign(`https://oauth.yandex.ru/authorize?${params}`);
}

/** Finishes a Yandex redirect if the page was opened with one. */
export async function completeYandexAuth() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('access_token') && !fragment.has('error')) return;
  history.replaceState(null, '', location.pathname + location.search);

  const pending = readJson(YANDEX_PENDING_KEY);
  localStorage.removeItem(YANDEX_PENDING_KEY);
  let error = null;
  if (fragment.has('error')) {
    if (fragment.get('error') !== 'access_denied') error = 'Яндекс отказал во входе.';
  } else if (!pending || pending.state !== fragment.get('state') || Date.now() - pending.at > 10 * 60 * 1000) {
    error = 'Вход через Яндекс устарел, попробуйте ещё раз.';
  } else {
    const payload = { token: fragment.get('access_token') };
    try {
      if (pending.link) await linkAccount('yandex', payload);
      else await signIn('yandex', payload);
    } catch (err) {
      error = err.message;
    }
  }
  if (!error) return;
  if (pending?.link && state.status === 'signedIn') alert(error);
  else setState({ notice: error });
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

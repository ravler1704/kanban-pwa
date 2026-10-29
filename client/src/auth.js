import Dexie from 'dexie';
import { currentBoard, deleteSharedBoards, dropCurrentBoard, switchBoard } from './board.js';
import { clearLocalData, db } from './db.js';
import { disablePush, refreshPush } from './push.js';
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
  emailLogin: Boolean(config?.emailLogin),
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
      const { user } = me.body;
      setState({ status: 'signedIn', user });
      if (currentBoard && !(user.boards ?? []).some((b) => b.id === currentBoard)) {
        // Signed in as the board's owner, or no longer invited to it.
        if (currentBoard === user.id) switchBoard(null);
        else await dropCurrentBoard();
        return;
      }
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
  if (body.error === 'invalid code') {
    return new Error(`Неверный код. Осталось попыток: ${body.attemptsLeft}.`);
  }
  if (body.error === 'code expired') return new Error('Код больше не действует — запросите новый.');
  if (status === 502) return new Error('Сервис входа не отвечает. Попробуйте позже.');
  return new Error(`Не удалось ${action}. Попробуйте ещё раз.`);
}

/**
 * Asks the server to mail a sign-in code (`link`: for linking the address to the signed-in user).
 * Resolves to the seconds before another code can be requested.
 */
export async function requestEmailCode(email, { link = false } = {}) {
  const res = await postAuth('email/code', { email, link });
  if (res.status === 200) return res.body.resendIn;
  if (res.status === 400) throw new Error('Проверьте адрес почты.');
  if (res.status === 403) throw authError(res, 'отправить код');
  if (res.body.error === 'too soon') throw new Error(`Новый код можно запросить через ${res.body.retryIn} с.`);
  if (res.body.error === 'too many') throw new Error('Слишком много запросов кода. Попробуйте позже.');
  if (res.body.error === 'mail failed') throw new Error('Не удалось отправить письмо. Попробуйте позже.');
  throw new Error('Не удалось отправить код. Попробуйте ещё раз.');
}

export function signInWithEmail(email, code) {
  return signIn('email', { email, code });
}

async function signIn(provider, payload) {
  const res = await postAuth(provider, payload);
  if (res.status !== 200) throw authError(res, 'войти');
  setState({ status: 'signedIn', user: res.body.user, notice: null });
  resume();
  refreshPush();
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
    [db.columnSets, db.columns, db.projects, db.sections, db.cards].map((t) => t.where('dirty').equals(1).count()),
  )).reduce((a, b) => a + b, 0);
  if (pending > 0 && !confirm(`Есть несинхронизированные изменения (${pending}). При выходе они пропадут. Выйти?`)) {
    return false;
  }
  // This device should not keep receiving the reminders of the account that signed out.
  await disablePush();
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  stopEvents();
  await clearLocalData();
  await deleteSharedBoards();
  setState({ status: 'signedOut', user: null });
  // The page holds the shared board's database open: reopen with the own one.
  if (currentBoard) switchBoard(null);
  return true;
}

/** Deletes the account with its board on the server, then everything of it on this device. */
export async function deleteAccount() {
  await disablePush();
  const res = await fetch('/api/auth/delete-account', { method: 'POST' });
  if (!res.ok) throw new Error('Не удалось удалить аккаунт.');
  stopEvents();
  await clearLocalData();
  await deleteSharedBoards();
  setState({ status: 'signedOut', user: null });
  if (currentBoard) switchBoard(null);
}

// ---- sharing the own board ----

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// People invited to projects of the own board: [{ email, name, joined, projects: [projectId] }],
// null until loaded. Shared by the «Доступ» tab and the project settings.
let members = null;
const memberListeners = new Set();

function setMembers(list) {
  members = list;
  for (const l of memberListeners) l();
}

export const membersState = {
  subscribe(listener) {
    memberListeners.add(listener);
    return () => memberListeners.delete(listener);
  },
  get: () => members,
};

export async function loadMembers() {
  const res = await fetch('/api/members', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось загрузить список участников.');
  setMembers((await res.json()).members);
}

export async function inviteMember(email, project) {
  const res = await postJson('/api/members', { email, project });
  if (res.status === 400 && res.body.error === 'own email') throw new Error('Это адрес вашего аккаунта.');
  if (res.status === 400) throw new Error('Проверьте адрес почты.');
  if (res.status === 404) throw new Error('Проект ещё не сохранён на сервере — подождите синхронизации.');
  if (res.status !== 200) throw new Error('Не удалось пригласить. Попробуйте ещё раз.');
  setMembers(res.body.members);
}

/** Without `project`, from every project. */
export async function removeMember(email, project) {
  const res = await postJson('/api/members/remove', { email, project });
  if (res.status !== 200) throw new Error('Не удалось убрать участника. Попробуйте ещё раз.');
  setMembers(res.body.members);
}

/** Leaves the shared board that is open now; the own board opens. */
export async function leaveCurrentBoard() {
  const res = await postJson('/api/boards/leave', { board: currentBoard });
  if (res.status !== 200 && res.status !== 404) throw new Error('Не удалось покинуть доску. Попробуйте ещё раз.');
  await Dexie.delete(db.name).catch(() => {});
  switchBoard(null);
}

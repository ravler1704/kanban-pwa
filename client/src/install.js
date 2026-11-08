// Installing the app: the browser's own prompt where there is one (Chrome, Edge, Android),
// the store and APK links for Android and steps for Safari elsewhere.

export const INSTALL_PAGE = '/install.html';
/** Google Play page of the Android app; null until it is published there. */
export const PLAY_URL = null;
export const APK_URL = 'https://github.com/ravler1704/kanban-pwa/releases/latest/download/offline-kanban.apk';

const ua = navigator.userAgent;
const isIos = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 'ios' | 'android' | 'desktop' */
export const platform = isIos ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';

let state = {
  installed: window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
    || document.referrer.startsWith('android-app://'),
  canPrompt: false,
};
let deferred = null;
const listeners = new Set();

function set(next) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// Fired once, early: kept until the user asks to install.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  set({ canPrompt: true });
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  set({ installed: true, canPrompt: false });
});

export const installStore = {
  get: () => state,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export async function promptInstall() {
  if (!deferred) return;
  const e = deferred;
  deferred = null;
  set({ canPrompt: false });
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') set({ installed: true });
}

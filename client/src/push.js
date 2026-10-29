// Push notifications for card reminders. The server sends them to every device of the user
// that subscribed here; the service worker (public/push-sw.js) shows them.

const SUBSCRIBED_KEY = 'pushSubscribed';

export const pushSupported = typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// iOS delivers Web Push only to apps added to the Home Screen.
const isIos = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/** 'enabled' | 'available' | 'denied' | 'needsInstall' (iOS browser tab) | 'unsupported' */
export function pushState() {
  if (!pushSupported) return isIos && !isStandalone ? 'needsInstall' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && localStorage.getItem(SUBSCRIBED_KEY)) return 'enabled';
  return 'available';
}

/**
 * Where to allow notifications again: once denied, the browser neither re-prompts nor lets the
 * page reset the permission, so this points the user at the right settings screen.
 */
function deniedHint() {
  const ua = navigator.userAgent;
  const prefix = 'Уведомления запрещены. Чтобы разрешить: ';
  if (isIos) {
    return `${prefix}«Настройки» телефона → «Уведомления» → Kanban → включите «Допуск уведомлений».`;
  }
  if (/Android/.test(ua)) {
    return isStandalone
      ? `${prefix}удерживайте значок Kanban → «О приложении» → «Уведомления» → включите их.`
      : `${prefix}меню браузера ⋮ → «Настройки» → «Настройки сайтов» → «Уведомления» → выберите этот сайт → «Разрешить».`;
  }
  if (/Firefox\//.test(ua)) {
    return `${prefix}нажмите значок слева от адреса сайта и уберите запрет у «Отправлять уведомления».`;
  }
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua)) {
    return isStandalone
      ? `${prefix}«Системные настройки» → «Уведомления» → Kanban → включите «Разрешить уведомления».`
      : `${prefix}Safari → «Настройки» → «Веб-сайты» → «Уведомления» → для этого сайта выберите «Разрешить».`;
  }
  return isStandalone
    ? `${prefix}меню приложения ⋮ → «Информация о приложении» → «Настройки сайта» → «Уведомления» → «Разрешить».`
    : `${prefix}нажмите значок слева от адреса сайта → «Уведомления» → «Разрешить».`;
}

/** Explanations for the states in which this device cannot be subscribed. */
export const PUSH_HINTS = {
  denied: deniedHint(),
  needsInstall: 'На iPhone уведомления приходят только в приложении: «Поделиться» → «На экран „Домой“», затем откройте его оттуда.',
  unsupported: 'Этот браузер не поддерживает уведомления; напоминания придут на другие ваши устройства.',
};

function keyToBytes(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function subscription({ create }) {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing || !create) return existing;
  const res = await fetch('/api/push/key', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { publicKey } = await res.json();
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
}

/** Must be called from a click: browsers only show the permission prompt for a user gesture. */
export async function enablePush() {
  if (!pushSupported) throw new Error('Этот браузер не поддерживает уведомления.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Уведомления запрещены. Разрешите их в настройках браузера или телефона.');
  }
  try {
    const sub = await subscription({ create: true });
    await post('/api/push/subscribe', { subscription: sub.toJSON() });
  } catch {
    throw new Error('Не удалось включить уведомления. Проверьте подключение и попробуйте ещё раз.');
  }
  localStorage.setItem(SUBSCRIBED_KEY, '1');
}

export async function disablePush() {
  const sub = pushSupported ? await subscription({ create: false }) : null;
  if (sub) {
    await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  localStorage.removeItem(SUBSCRIBED_KEY);
}

/**
 * Re-sends this device's subscription after sign-in: the server ties it to the signed-in
 * user, and the browser may have rotated it.
 */
export async function refreshPush() {
  if (pushState() !== 'enabled') return;
  try {
    const sub = await subscription({ create: true });
    await post('/api/push/subscribe', { subscription: sub.toJSON() });
  } catch {
    // Offline or signed out: retried on the next start.
  }
}

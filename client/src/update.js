// Safari web apps (Add to Dock / Home Screen) may keep running an outdated build:
// they rarely pick up a new service worker on their own. So compare the running build
// with the server's and, when it differs, drop the cached app shell and reload.
// Card data lives in IndexedDB and is not affected.

import { uploadStore } from './files.js';

const RELOADED_KEY = 'reloadedForBuild';
const uploading = () => uploadStore.get().some((u) => !u.error);

async function serverBuild() {
  const res = await fetch('/version.json', { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()).build ?? null;
}

let checking = false;

export async function checkForUpdate() {
  if (checking || !navigator.onLine) return;
  checking = true;
  try {
    const build = await serverBuild();
    if (!build || build === __BUILD_ID__) return;
    // A reload would cut uploads off; checked again once they finish.
    if (uploading()) return;
    // Do not loop if the reload did not bring the new build (e.g. a stale HTTP cache).
    if (sessionStorage.getItem(RELOADED_KEY) === build) return;
    sessionStorage.setItem(RELOADED_KEY, build);

    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
    if (globalThis.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    location.reload();
  } catch {
    // Offline or server unreachable: try again later.
  } finally {
    checking = false;
  }
}

export function startUpdateChecks() {
  checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('focus', checkForUpdate);
  window.addEventListener('online', checkForUpdate);
  setInterval(checkForUpdate, 60 * 60 * 1000);
  let wasUploading = false;
  uploadStore.subscribe(() => {
    const now = uploading();
    if (wasUploading && !now) checkForUpdate();
    wasUploading = now;
  });
}

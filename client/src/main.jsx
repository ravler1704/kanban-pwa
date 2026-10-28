import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { checkAuth, completeYandexAuth } from './auth.js';
import AuthGate from './components/AuthGate.jsx';
import { startSync } from './sync.js';
import { startUpdateChecks } from './update.js';
import './styles.css';

// The browser checks for a new service worker only on navigation, and an installed app
// resumed from the background does not navigate, so check explicitly.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 60 * 60 * 1000);
  },
});

// Trackpad pinch: Safari fires gesture events, Chromium and Firefox fire wheel events with ctrlKey.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

// Returning from Yandex sign-in: finish it before the first sync so that sync runs signed in.
completeYandexAuth().finally(() => {
  checkAuth();
  startSync();
});
startUpdateChecks();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);

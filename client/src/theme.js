// Light / dark theme: 'auto' follows the system, 'light' and 'dark' are chosen by hand.
// The choice is per device. The inline script in index.html applies it before the first
// paint; this module keeps it applied and follows system changes.

const THEME_KEY = 'theme';
const THEMES = ['auto', 'light', 'dark'];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return THEMES.includes(saved) ? saved : 'auto';
}

function apply() {
  const theme = getTheme();
  const resolved = theme === 'auto' ? (systemDark.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  // Browser UI around the app (address bar, status bar of the installed app).
  const color = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function setTheme(theme) {
  if (theme === 'auto') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, theme);
  apply();
}

export function startTheme() {
  apply();
  systemDark.addEventListener('change', apply);
  // Another tab changed the choice.
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) apply();
  });
}

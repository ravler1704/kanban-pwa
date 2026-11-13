/** Promo / ?template=: keep template id across login and board switches (full reload). */

export const PENDING_TEMPLATE_KEY = 'pendingBoardTemplate';
const KEY = PENDING_TEMPLATE_KEY;

export function captureTemplateFromUrl() {
  const id = new URLSearchParams(location.search).get('template');
  if (id) sessionStorage.setItem(KEY, id);
  return id;
}

export function peekPendingTemplate() {
  return sessionStorage.getItem(KEY);
}

export function clearPendingTemplate() {
  sessionStorage.removeItem(KEY);
}

export function consumePendingTemplate() {
  const id = sessionStorage.getItem(KEY);
  if (id) sessionStorage.removeItem(KEY);
  return id;
}

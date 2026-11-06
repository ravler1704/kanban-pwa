import { getMeta, setMeta } from './db.js';

// Server settings an administrator changes in the app, kept in the database. On the first start
// they are taken from the environment (GOOGLE_CLIENT_ID, YANDEX_CLIENT_ID, ALLOWED_EMAILS,
// ADMIN_EMAILS, VAPID_SUBJECT); after that the environment is not read for them, except that
// ADMIN_EMAILS stay administrators, so a server can always be taken back.
const META_KEY = 'serverSettings';

const emailList = (value) => [...new Set((value || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))];

const FROM_ENV = {
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  yandexClientId: process.env.YANDEX_CLIENT_ID || '',
  allowedEmails: emailList(process.env.ALLOWED_EMAILS),
  adminEmails: emailList(process.env.ADMIN_EMAILS),
  vapidSubject: process.env.VAPID_SUBJECT || '',
};
export const envAdminEmails = new Set(FROM_ENV.adminEmails);

function stored() {
  try {
    return JSON.parse(getMeta(META_KEY) || 'null');
  } catch {
    return null;
  }
}

if (!stored()) setMeta(META_KEY, JSON.stringify(FROM_ENV));
// Settings added later start from the environment too.
let current = { ...FROM_ENV, ...stored() };

const listeners = new Set();

export const settings = () => current;

/** `fn()` runs after every change of the settings. */
export function onSettingsChange(fn) {
  listeners.add(fn);
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+$/;
const CLIENT_ID = /^[\w.-]{1,200}$/;
// Browsers' push services want a real contact: a mailto: address or an https URL.
const VAPID_SUBJECT = /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/;

export class SettingsError extends Error {}

/** Checks the fields of `patch` (any of the settings) and returns them cleaned up, or throws SettingsError. */
export function cleanSettings(patch) {
  const out = {};
  for (const key of ['googleClientId', 'yandexClientId']) {
    if (patch[key] === undefined) continue;
    const value = typeof patch[key] === 'string' ? patch[key].trim() : null;
    if (value === null || (value && !CLIENT_ID.test(value))) throw new SettingsError(`invalid ${key}`);
    out[key] = value;
  }
  for (const key of ['allowedEmails', 'adminEmails']) {
    if (patch[key] === undefined) continue;
    const list = patch[key];
    if (!Array.isArray(list) || list.length > 1000) throw new SettingsError(`invalid ${key}`);
    const emails = [...new Set(list.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')))].filter(Boolean);
    if (emails.some((e) => e.length > 254 || !EMAIL.test(e))) throw new SettingsError(`invalid ${key}`);
    out[key] = emails;
  }
  if (patch.vapidSubject !== undefined) {
    const value = typeof patch.vapidSubject === 'string' ? patch.vapidSubject.trim() : null;
    if (value === null || value.length > 300 || (value && !VAPID_SUBJECT.test(value))) throw new SettingsError('invalid vapidSubject');
    out.vapidSubject = value;
  }
  return out;
}

export function saveSettings(cleaned) {
  current = { ...current, ...cleaned };
  setMeta(META_KEY, JSON.stringify(current));
  for (const fn of listeners) fn();
}

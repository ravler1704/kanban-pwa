import nodemailer from 'nodemailer';
import { getMeta, setMeta } from './db.js';

// Outgoing mail (sign-in codes) through an SMTP mailbox, set by an administrator in the app
// (stored in the database). SMTP_URL, e.g. smtps://login%40yandex.ru:app-password@smtp.yandex.ru:465,
// with MAIL_FROM, is taken over once when nothing is stored yet.
// The sender defaults to the mailbox itself (Yandex and Mail.ru reject other senders).
const META_KEY = 'smtp';

function stored() {
  try {
    return JSON.parse(getMeta(META_KEY) || 'null');
  } catch {
    return null;
  }
}

if (process.env.SMTP_URL && !stored()) {
  const url = new URL(process.env.SMTP_URL);
  setMeta(META_KEY, JSON.stringify({
    host: url.hostname,
    port: Number(url.port) || (url.protocol === 'smtps:' ? 465 : 587),
    secure: url.protocol === 'smtps:',
    user: decodeURIComponent(url.username),
    pass: decodeURIComponent(url.password),
    from: process.env.MAIL_FROM || '',
  }));
}

const senderOf = (settings) => settings.from || `"Канбан" <${settings.user}>`;

function createTransport(settings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
}

let cached = null;
function transport() {
  if (!cached && stored()) cached = { mailer: createTransport(stored()), from: senderOf(stored()) };
  return cached;
}

export const mailEnabled = () => Boolean(stored());

export async function sendMail({ to, subject, text }) {
  const { mailer, from } = transport();
  await mailer.sendMail({ from, to, subject, text });
}

/** For the settings form: never includes the password. */
export function mailSettings() {
  const settings = stored();
  if (!settings) return { source: null };
  const { pass, ...rest } = settings;
  return { source: 'app', ...rest, hasPassword: Boolean(pass) };
}

/** Checks that the server accepts the login before saving. Empty `pass` keeps the saved one. */
export async function saveMailSettings({ host, port, secure, user, pass, from }) {
  const settings = { host, port, secure, user, pass: pass || stored()?.pass || '', from };
  await createTransport(settings).verify();
  setMeta(META_KEY, JSON.stringify(settings));
  cached = null;
}

export function clearMailSettings() {
  setMeta(META_KEY, '');
  cached = null;
}

import nodemailer from 'nodemailer';
import { getMeta, setMeta } from './db.js';

// Outgoing mail (sign-in codes) through an SMTP mailbox. Set by an administrator in the app
// (stored in the database), or by SMTP_URL, which then takes precedence, e.g.
// SMTP_URL=smtps://login%40yandex.ru:app-password@smtp.yandex.ru:465
// The sender defaults to the mailbox itself (Yandex and Mail.ru reject other senders).
const SMTP_URL = process.env.SMTP_URL || '';
const META_KEY = 'smtp';

export const mailFromEnv = Boolean(SMTP_URL);

function stored() {
  try {
    return JSON.parse(getMeta(META_KEY) || 'null');
  } catch {
    return null;
  }
}

function envSettings() {
  const url = new URL(SMTP_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || (url.protocol === 'smtps:' ? 465 : 587),
    secure: url.protocol === 'smtps:',
    user: decodeURIComponent(url.username),
    from: process.env.MAIL_FROM || '',
  };
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
  if (cached) return cached;
  if (mailFromEnv) cached = { mailer: nodemailer.createTransport(SMTP_URL), from: senderOf(envSettings()) };
  else if (stored()) cached = { mailer: createTransport(stored()), from: senderOf(stored()) };
  return cached;
}

export const mailEnabled = () => mailFromEnv || Boolean(stored());

export async function sendMail({ to, subject, text }) {
  const { mailer, from } = transport();
  await mailer.sendMail({ from, to, subject, text });
}

/** For the settings form: never includes the password. */
export function mailSettings() {
  if (mailFromEnv) return { source: 'env', ...envSettings(), hasPassword: true };
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

import nodemailer from 'nodemailer';

// Outgoing mail (sign-in codes) through an SMTP mailbox, e.g.
// SMTP_URL=smtps://login%40yandex.ru:app-password@smtp.yandex.ru:465
// MAIL_FROM defaults to the mailbox itself (Yandex and Mail.ru reject other senders).
const SMTP_URL = process.env.SMTP_URL || '';

export const mailEnabled = Boolean(SMTP_URL);

const transport = mailEnabled ? nodemailer.createTransport(SMTP_URL) : null;
const from = process.env.MAIL_FROM
  || (mailEnabled ? `"Канбан" <${decodeURIComponent(new URL(SMTP_URL).username)}>` : '');

export async function sendMail({ to, subject, text }) {
  await transport.sendMail({ from, to, subject, text });
}

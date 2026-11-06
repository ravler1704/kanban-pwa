import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  addMember, boardMemberEmails, boardOwner, boardSummary, countEmailCodeAttempt, createSession, createSpace, customName, deleteIdentity,
  deleteMember, deletePublicLink, deleteSession, deleteSpace, deleteUser, findUserByEmail, getEmailCode, getIdentityUser,
  getPublicLink, getRecord, getSession, isInvited, leaveBoard, listIdentities, listMembers, listPublicLinks, memberProjects,
  mergeUsers, ownerFileIds, ownSpaces, pruneEmailCodes, renameSpace, saveEmailCode, saveIdentity, savePublicLink,
  setCustomName, sharedBoards, useEmailCode, userFileIds, usersWithEmail,
} from './db.js';
import { broadcast, disconnect, disconnectUser, notifyUser } from './events.js';
import { removeFiles } from './files.js';
import {
  clearMailSettings, mailEnabled, mailSettings, saveMailSettings, sendMail,
} from './mail.js';
import { cleanSettings, envAdminEmails, saveSettings, settings, SettingsError } from './settings.js';
import { memberAccess, seedColumns } from './sync.js';

// Sign-in with Google, Yandex and/or a code sent by e-mail. A user may link several accounts and
// gets one board; the owner may invite others to its projects by e-mail.
// The allowed e-mails (settings.js) optionally limit who may sign in (empty: anyone; invited e-mails and
// administrators may always). Auth is off when no way to sign in is set up at start (local development), and
// everyone shares the board of owner ''; while it is on, the last way to sign in can't be removed.
const signInWays = (s = settings()) => Boolean(s.googleClientId || s.yandexClientId || mailEnabled());
export const authEnabled = signInWays();
// Local development only: a "test account" button that signs in without a provider. Even when
// enabled, it is accepted only from this machine (behind Caddy req.ip is the real client).
const DEV_LOGIN = authEnabled && process.env.DEV_LOGIN === '1';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const devLoginAllowed = (req) => DEV_LOGIN && LOOPBACK.has(req.ip);
// Without SMTP the test setup prints sign-in codes to the server log instead of mailing them.
const emailLoginAllowed = (req) => mailEnabled() || devLoginAllowed(req);
// Administrators (e-mails of any of their linked accounts) set up the server in the app.
const isAdminEmail = (email) => Boolean(email)
  && (settings().adminEmails.includes(email.toLowerCase()) || envAdminEmails.has(email.toLowerCase()));
const emailsOf = (userId) => listIdentities(userId).map((i) => i.email).filter(Boolean);
const isAdmin = (userId) => emailsOf(userId).some(isAdminEmail);

const COOKIE = 'kanban_session';
// Browsers cap cookie lifetime at 400 days.
const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const isAllowed = (email) => settings().allowedEmails.length === 0
  || (Boolean(email) && settings().allowedEmails.includes(email.toLowerCase()))
  || isAdminEmail(email)
  || isInvited(email);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class AuthError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function cookieOptions(req) {
  return { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/' };
}

function currentSession(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const session = getSession(hash(token));
  if (!session) return null;
  if (session.provider === 'dev') return devLoginAllowed(req) ? session : null;
  // Removing an address from the allowed e-mails revokes its sessions immediately.
  return isAllowed(session.email) ? session : null;
}

const publicIdentity = (i) => ({
  provider: i.provider, subject: i.subject, email: i.email ?? null, name: i.name ?? null, picture: i.picture ?? null,
});

function publicUser(session) {
  return {
    id: session.user_id,
    email: session.email,
    name: customName(session.user_id) ?? session.name,
    // The name of the account signed in with, shown when the user's own name is cleared.
    accountName: session.name ?? null,
    customName: customName(session.user_id),
    picture: session.picture,
    identities: listIdentities(session.user_id).map(publicIdentity),
    spaces: ownSpaces(session.user_id),
    boards: sharedBoards(session.user_id),
    admin: isAdmin(session.user_id),
  };
}

/**
 * Sets `req.user` (the signed-in user) and `req.owner`: the board the request works with,
 * the user's own unless another board with projects shared with the user is asked for
 * (`X-Board` header, or `?board=` where headers can't be set, e.g. EventSource).
 * On another's board `req.access` lists what the user may see (see memberAccess), else null.
 */
export function requireAuth(req, res, next) {
  req.access = null;
  if (!authEnabled) {
    req.user = '';
    req.owner = '';
    return next();
  }
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.user = session.user_id;
  const board = req.get('x-board') || req.query.board;
  if (board && boardOwner(board) !== req.user) {
    const projects = memberProjects(board, req.user);
    if (projects.length === 0) return res.status(403).json({ error: 'no access' });
    req.access = memberAccess(board, projects);
  }
  req.owner = board || req.user;
  next();
}

/**
 * Like requireAuth, but a request made through a public link (`X-Public` header, or `?public=`
 * for EventSource) gets the link's project like a member, without signing in (`req.user` is null).
 */
export function requireAuthOrPublic(req, res, next) {
  const token = req.get('x-public') || req.query.public;
  if (!token) return requireAuth(req, res, next);
  const link = typeof token === 'string' ? getPublicLink(token) : null;
  if (!link) return res.status(404).json({ error: 'no link' });
  req.user = null;
  req.owner = link.board;
  req.access = memberAccess(link.board, [link.project], { readOnly: link.mode !== 'edit' });
  next();
}

// --- Providers: each turns the client's proof into a verified identity. ---

async function verifyGoogle(body) {
  const { googleClientId } = settings();
  if (!googleClientId) throw new AuthError(404, 'provider disabled');
  const credential = body?.credential;
  if (typeof credential !== 'string' || credential.length > 4096) throw new AuthError(400, 'invalid credential');
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(credential, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: googleClientId,
    }));
  } catch {
    throw new AuthError(401, 'invalid credential');
  }
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string' || claims.email_verified !== true) {
    throw new AuthError(403, 'email not verified');
  }
  return {
    provider: 'google',
    // Google's stable account id; the e-mail of an account can change.
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === 'string' ? claims.name : null,
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}

// Yandex OAuth implicit flow: the browser gets an access token; Yandex tells which app it
// was issued to, so a token obtained by another site is rejected.
async function verifyYandex(body) {
  const { yandexClientId } = settings();
  if (!yandexClientId) throw new AuthError(404, 'provider disabled');
  const token = body?.token;
  if (typeof token !== 'string' || token.length > 512) throw new AuthError(400, 'invalid token');
  let info;
  try {
    const res = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) throw new AuthError(401, 'invalid token');
    if (!res.ok) throw new Error(`Yandex responded ${res.status}`);
    info = await res.json();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error('Yandex sign-in failed:', err);
    throw new AuthError(502, 'provider unavailable');
  }
  if (info.client_id !== yandexClientId || typeof info.id !== 'string') throw new AuthError(401, 'invalid token');
  return {
    provider: 'yandex',
    subject: info.id,
    email: typeof info.default_email === 'string' ? info.default_email.toLowerCase() : null,
    name: info.display_name || info.real_name || info.login || null,
    picture: info.default_avatar_id && !info.is_avatar_empty
      ? `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-retina-50`
      : null,
  };
}

async function verifyDev(req) {
  if (!devLoginAllowed(req)) throw new AuthError(404, 'not found');
  return { provider: 'dev', subject: 'test', email: 'test@localhost', name: 'Тестовый аккаунт', picture: null };
}

// E-mail: a new 4-digit code at every sign-in. A code allows a few guesses and lives briefly;
// an address gets a limited number of codes a day and an IP a limited number an hour.
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ATTEMPTS = 5;
const RESEND_MS = 60 * 1000;
const CODES_PER_EMAIL = 10;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const CODES_PER_IP = 20;
const IP_WINDOW_MS = 60 * 60 * 1000;
const codesByIp = new Map();

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const codeHash = (email, code) => hash(`${email}:${code}`);

function takeIpQuota(ip, now) {
  if (codesByIp.size > 10_000) codesByIp.clear();
  const recent = (codesByIp.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= CODES_PER_IP) return false;
  codesByIp.set(ip, [...recent, now]);
  return true;
}

async function sendCode(req) {
  if (!emailLoginAllowed(req)) throw new AuthError(404, 'provider disabled');
  const email = normalizeEmail(req.body?.email);
  if (email.length > 254 || !EMAIL.test(email)) throw new AuthError(400, 'invalid email');
  if (req.body?.link === true) {
    if (!currentSession(req)) throw new AuthError(401, 'unauthorized');
  } else if (!isAllowed(email)) {
    throw new AuthError(403, 'not allowed', { email });
  }

  const now = Date.now();
  pruneEmailCodes(now - EMAIL_WINDOW_MS);
  const previous = getEmailCode(email);
  if (previous && now - previous.sent_at < RESEND_MS) {
    throw new AuthError(429, 'too soon', { retryIn: Math.ceil((previous.sent_at + RESEND_MS - now) / 1000) });
  }
  const sends = previous ? previous.sends : 0;
  if (sends >= CODES_PER_EMAIL || !takeIpQuota(req.ip, now)) throw new AuthError(429, 'too many');

  const code = String(crypto.randomInt(10_000)).padStart(4, '0');
  saveEmailCode({
    email,
    codeHash: codeHash(email, code),
    sentAt: now,
    expiresAt: now + CODE_TTL_MS,
    windowStart: previous?.window_start ?? now,
    sends: sends + 1,
  });
  if (!mailEnabled()) {
    console.log(`Sign-in code for ${email}: ${code}`);
    return;
  }
  try {
    await sendMail({
      to: email,
      subject: `Код для входа: ${code}`,
      text: `Ваш код для входа в Канбан: ${code}\n\nКод действует 10 минут. `
        + 'Если вы не пытались войти, просто не обращайте внимания на это письмо.',
    });
  } catch (err) {
    console.error('Sending the sign-in code failed:', err);
    useEmailCode(email);
    throw new AuthError(502, 'mail failed');
  }
}

/** The code stays valid until the sign-in completes (a merge confirmation re-sends it). */
async function verifyEmail(req) {
  if (!emailLoginAllowed(req)) throw new AuthError(404, 'provider disabled');
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code ?? '');
  const row = email ? getEmailCode(email) : null;
  if (!row?.code_hash || row.expires_at < Date.now() || row.attempts >= CODE_ATTEMPTS) {
    throw new AuthError(410, 'code expired');
  }
  const ok = /^\d{4}$/.test(code)
    && crypto.timingSafeEqual(Buffer.from(codeHash(email, code)), Buffer.from(row.code_hash));
  if (!ok) {
    const left = CODE_ATTEMPTS - countEmailCodeAttempt(email);
    throw left > 0 ? new AuthError(401, 'invalid code', { attemptsLeft: left }) : new AuthError(410, 'code expired');
  }
  return {
    provider: 'email', subject: email, email, name: null, picture: null, complete: () => useEmailCode(email),
  };
}

// --- Sign-in and linking ---

function startSession(req, res, userId, identity) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  // E-mail sign-in has no name or photo: those of another linked account are shown.
  const profile = listIdentities(userId).find((i) => i.name || i.picture);
  const session = {
    tokenHash: hash(token),
    userId,
    provider: identity.provider,
    email: identity.email ?? '',
    name: identity.name ?? profile?.name ?? null,
    picture: identity.picture ?? profile?.picture ?? null,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  createSession(session);
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
  res.json({ user: publicUser({ ...session, user_id: userId }) });
}

function signIn(req, res, identity) {
  if (identity.provider !== 'dev' && !isAllowed(identity.email)) {
    throw new AuthError(403, 'not allowed', { email: identity.email });
  }
  // A confirmed address opens the board of the account (e.g. Google) that has it.
  const userId = getIdentityUser(identity.provider, identity.subject)
    ?? (identity.provider === 'email' ? findUserByEmail(identity.email) : null)
    ?? `u:${crypto.randomUUID()}`;
  saveIdentity({ ...identity, userId });
  startSession(req, res, userId, identity);
}

/**
 * Links the identity to the signed-in user. If it already belongs to another user, that
 * user's board is merged in, but only once the client confirms (`merge: true`).
 */
function link(req, res, identity, session) {
  const me = session.user_id;
  const other = getIdentityUser(identity.provider, identity.subject);
  if (other && other !== me) {
    if (req.body?.merge !== true) {
      throw new AuthError(409, 'has board', { email: identity.email, board: boardSummary(other) });
    }
    const seq = mergeUsers(other, me);
    broadcast(me, { seq, from: null });
    disconnect(other);
    disconnectUser(other);
  }
  saveIdentity({ ...identity, userId: me });
  res.json({ user: publicUser(session) });
}

function authRoute(verify) {
  return async (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    try {
      const identity = await verify(req);
      if (req.body?.link === true) {
        const session = currentSession(req);
        if (!session) throw new AuthError(401, 'unauthorized');
        link(req, res, identity, session);
      } else {
        signIn(req, res, identity);
      }
      identity.complete?.();
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      res.status(err.status).json(err.body);
    }
  };
}

/** The open apps of the person with this e-mail reload the list of boards shared with them. */
function notifyBoardsChanged(email) {
  for (const userId of usersWithEmail(email)) notifyUser(userId, { boards: true });
}

export function registerAuthRoutes(app) {
  app.get('/api/auth/config', (req, res) => {
    res.json({
      enabled: authEnabled,
      clientId: settings().googleClientId || null,
      yandexClientId: settings().yandexClientId || null,
      devLogin: devLoginAllowed(req),
      emailLogin: authEnabled && emailLoginAllowed(req),
    });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!authEnabled) return res.json({ user: null, enabled: false });
    const session = currentSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    res.json({ user: publicUser(session), enabled: true });
  });

  app.post('/api/auth/google', authRoute((req) => verifyGoogle(req.body)));
  app.post('/api/auth/yandex', authRoute((req) => verifyYandex(req.body)));
  app.post('/api/auth/dev', authRoute(verifyDev));
  app.post('/api/auth/email', authRoute(verifyEmail));

  app.post('/api/auth/email/code', async (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    try {
      await sendCode(req);
      res.json({ ok: true, resendIn: RESEND_MS / 1000 });
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      res.status(err.status).json(err.body);
    }
  });

  app.post('/api/auth/unlink', (req, res) => {
    const session = authEnabled && currentSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const { provider, subject } = req.body ?? {};
    if (listIdentities(session.user_id).length < 2) {
      return res.status(400).json({ error: 'last identity' });
    }
    if (typeof provider !== 'string' || typeof subject !== 'string' || !deleteIdentity(session.user_id, provider, subject)) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ user: publicUser(session) });
  });

  // Sharing is the owner's: the space chosen with X-Board must be one of the user's own.
  const requireOwnSpace = (req, res, next) => {
    if (req.access) return res.status(403).json({ error: 'not owner' });
    next();
  };

  // People invited to folders of the open space.
  app.get('/api/members', requireAuth, requireOwnSpace, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    res.json({ members: listMembers(req.owner) });
  });

  app.post('/api/members', requireAuth, requireOwnSpace, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    // To a folder (and its descendants). `project` / `space` accepted as aliases for `folder`.
    const id = req.body?.folder ?? req.body?.project ?? req.body?.space;
    if (email.length > 254 || !EMAIL.test(email)) return res.status(400).json({ error: 'invalid email' });
    if (listIdentities(req.user).some((i) => i.email === email)) return res.status(400).json({ error: 'own email' });
    const record = typeof id === 'string' ? getRecord(req.owner, id) : null;
    if (record?.type !== 'folder' || record.deleted) return res.status(404).json({ error: 'no folder' });
    addMember(req.owner, id, email);
    // Open streams of members belong to the old access; reconnecting picks up the new one.
    disconnect(req.owner, { except: req.user });
    notifyBoardsChanged(email);
    res.json({ members: listMembers(req.owner) });
  });

  /** `project` and `space` omitted: from every project and space. */
  app.post('/api/members/remove', requireAuth, requireOwnSpace, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const { email, folder, project, space } = req.body ?? {};
    if (typeof email !== 'string'
      || ([folder, project, space].some((v) => v != null && typeof v !== 'string'))
      || !deleteMember(req.owner, email, {
        folder: folder ?? project ?? space ?? undefined,
      })) {
      return res.status(404).json({ error: 'not found' });
    }
    disconnect(req.owner, { except: req.user });
    notifyBoardsChanged(email);
    res.json({ members: listMembers(req.owner) });
  });

  // Public links to folders of the open space.
  app.get('/api/public-links', requireAuth, requireOwnSpace, (req, res) => {
    res.json({ links: listPublicLinks(req.owner) });
  });

  app.post('/api/public-links', requireAuth, requireOwnSpace, (req, res) => {
    const { project, mode } = req.body ?? {};
    if (mode !== 'view' && mode !== 'edit') return res.status(400).json({ error: 'invalid mode' });
    const record = typeof project === 'string' ? getRecord(req.owner, project) : null;
    if (record?.type !== 'folder' || record.deleted) return res.status(404).json({ error: 'no folder' });
    savePublicLink(req.owner, project, mode);
    // Open streams of visitors belong to the old mode; reconnecting picks up the new one.
    disconnect(req.owner, { except: req.user });
    res.json({ links: listPublicLinks(req.owner) });
  });

  app.post('/api/public-links/remove', requireAuth, requireOwnSpace, (req, res) => {
    const { project } = req.body ?? {};
    if (typeof project !== 'string' || !deletePublicLink(req.owner, project)) {
      return res.status(404).json({ error: 'not found' });
    }
    disconnect(req.owner, { except: req.user });
    res.json({ links: listPublicLinks(req.owner) });
  });

  // The user's spaces: the main one always stays, others are created, renamed and deleted.
  const cleanSpaceName = (v) => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 100 ? v.trim() : null);

  app.post('/api/spaces', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const name = cleanSpaceName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'invalid name' });
    if (ownSpaces(req.user).length >= 50) return res.status(409).json({ error: 'too many' });
    const id = createSpace(req.user, name);
    seedColumns(id, { rootName: 'Общее' });
    res.json({ id, spaces: ownSpaces(req.user) });
  });

  app.post('/api/spaces/rename', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const name = cleanSpaceName(req.body?.name);
    const { id } = req.body ?? {};
    if (!name || typeof id !== 'string') return res.status(400).json({ error: 'invalid name' });
    if (!renameSpace(req.user, id, name)) return res.status(404).json({ error: 'not found' });
    for (const email of boardMemberEmails(id)) notifyBoardsChanged(email);
    res.json({ spaces: ownSpaces(req.user) });
  });

  app.post('/api/spaces/delete', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const { id } = req.body ?? {};
    if (typeof id !== 'string' || id === req.user || boardOwner(id) !== req.user) {
      return res.status(404).json({ error: 'not found' });
    }
    const emails = boardMemberEmails(id);
    const files = ownerFileIds(id);
    deleteSpace(req.user, id);
    removeFiles(files);
    disconnect(id);
    for (const email of emails) notifyBoardsChanged(email);
    res.json({ spaces: ownSpaces(req.user) });
  });

  // What a public link opens; asked by visitors, who are not signed in.
  app.get('/api/public/:token', (req, res) => {
    const link = getPublicLink(req.params.token);
    if (!link) return res.status(404).json({ error: 'no link' });
    res.json({ project: { id: link.project, name: link.name }, mode: link.mode, owner: link.owner });
  });

  app.post('/api/boards/leave', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const board = req.body?.board;
    if (typeof board !== 'string' || !leaveBoard(board, req.user)) return res.status(404).json({ error: 'not found' });
    res.json({ boards: sharedBoards(req.user) });
  });

  // --- Server settings for administrators ---

  const requireAdmin = (req, res, next) => {
    const session = authEnabled && currentSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(session.user_id)) return res.status(403).json({ error: 'not admin' });
    req.session = session;
    next();
  };

  const adminSettings = (session) => ({
    ...settings(),
    envAdminEmails: [...envAdminEmails],
    myEmails: emailsOf(session.user_id).map((e) => e.toLowerCase()),
  });

  app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(adminSettings(req.session)));

  app.post('/api/admin/settings', requireAdmin, (req, res) => {
    let cleaned;
    try {
      cleaned = cleanSettings(req.body ?? {});
    } catch (err) {
      if (!(err instanceof SettingsError)) throw err;
      return res.status(400).json({ error: 'invalid settings', detail: err.message });
    }
    const next = { ...settings(), ...cleaned };
    if (authEnabled && !signInWays(next)) return res.status(409).json({ error: 'last sign-in way' });
    // An administrator doesn't take the server out of their own hands.
    const mine = emailsOf(req.session.user_id).map((e) => e.toLowerCase());
    if (!mine.some((e) => next.adminEmails.includes(e) || envAdminEmails.has(e))) {
      return res.status(409).json({ error: 'last admin' });
    }
    saveSettings(cleaned);
    res.json(adminSettings(req.session));
  });

  app.get('/api/admin/mail', requireAdmin, (req, res) => res.json(mailSettings()));

  app.post('/api/admin/mail', requireAdmin, async (req, res) => {
    const { host, port, secure, user, pass, from } = req.body ?? {};
    const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!text(host, 253) || !Number.isInteger(port) || port < 1 || port > 65535 || typeof secure !== 'boolean'
      || !text(user, 254) || (pass != null && typeof pass !== 'string') || (pass?.length ?? 0) > 500
      || (from != null && typeof from !== 'string') || (from?.length ?? 0) > 300) {
      return res.status(400).json({ error: 'invalid settings' });
    }
    try {
      await saveMailSettings({ host: host.trim(), port, secure, user: user.trim(), pass, from: from?.trim() ?? '' });
    } catch (err) {
      // The mail server's answer helps to fix the login or the password.
      return res.status(400).json({ error: 'smtp failed', detail: String(err.response ?? err.message).slice(0, 300) });
    }
    res.json(mailSettings());
  });

  app.post('/api/admin/mail/test', requireAdmin, async (req, res) => {
    if (!mailEnabled()) return res.status(409).json({ error: 'not configured' });
    const to = req.session.email || listIdentities(req.session.user_id).find((i) => i.email)?.email;
    if (!to) return res.status(400).json({ error: 'no email' });
    try {
      await sendMail({ to, subject: 'Канбан: проверка почты', text: 'Почта для кодов входа настроена — это письмо дошло.' });
    } catch (err) {
      return res.status(502).json({ error: 'smtp failed', detail: String(err.response ?? err.message).slice(0, 300) });
    }
    res.json({ to });
  });

  app.post('/api/admin/mail/remove', requireAdmin, (req, res) => {
    const { googleClientId, yandexClientId } = settings();
    if (authEnabled && !googleClientId && !yandexClientId) return res.status(409).json({ error: 'last sign-in way' });
    clearMailSettings();
    res.json(mailSettings());
  });

  // The user's own name; empty: back to the name of the linked account.
  app.post('/api/auth/name', (req, res) => {
    const session = authEnabled && currentSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const raw = req.body?.name;
    if (raw != null && typeof raw !== 'string') return res.status(400).json({ error: 'invalid name' });
    const name = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (name.length > 100) return res.status(400).json({ error: 'invalid name' });
    setCustomName(session.user_id, name || null);
    res.json({ user: publicUser(session) });
  });

  app.post('/api/auth/delete-account', (req, res) => {
    const session = authEnabled && currentSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const files = userFileIds(session.user_id);
    const spaces = ownSpaces(session.user_id);
    deleteUser(session.user_id);
    removeFiles(files);
    // Members' and visitors' streams of the spaces, then the user's own on any board.
    for (const space of spaces) disconnect(space.id);
    disconnectUser(session.user_id);
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) deleteSession(hash(token));
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });
}

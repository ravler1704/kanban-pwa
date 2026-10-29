import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  addMember, boardSummary, createSession, deleteIdentity, deleteMember, deleteSession, getIdentityUser, getSession,
  isInvited, isMember, leaveBoard, listIdentities, listMembers, mergeUsers, saveIdentity, sharedBoards,
} from './db.js';
import { broadcast, disconnect, disconnectUser } from './events.js';

// Sign-in with Google and/or Yandex. A user may link several accounts and gets one board;
// the owner may invite others to it by e-mail.
// ALLOWED_EMAILS optionally limits who may sign in (empty: anyone; invited e-mails may always). Auth is off when no
// provider is configured (local development), and everyone shares the board of owner ''.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID || '';
const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
);
export const authEnabled = Boolean(GOOGLE_CLIENT_ID || YANDEX_CLIENT_ID);
// Local development only: a "test account" button that signs in without a provider. Even when
// enabled, it is accepted only from this machine (behind Caddy req.ip is the real client).
const DEV_LOGIN = authEnabled && process.env.DEV_LOGIN === '1';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const devLoginAllowed = (req) => DEV_LOGIN && LOOPBACK.has(req.ip);

const COOKIE = 'kanban_session';
// Browsers cap cookie lifetime at 400 days.
const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const isAllowed = (email) => ALLOWED_EMAILS.size === 0
  || (Boolean(email) && ALLOWED_EMAILS.has(email.toLowerCase()))
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
  // Removing an address from ALLOWED_EMAILS revokes its sessions immediately.
  return isAllowed(session.email) ? session : null;
}

const publicIdentity = (i) => ({
  provider: i.provider, subject: i.subject, email: i.email ?? null, name: i.name ?? null,
});

function publicUser(session) {
  return {
    id: session.user_id,
    email: session.email,
    name: session.name,
    picture: session.picture,
    identities: listIdentities(session.user_id).map(publicIdentity),
    boards: sharedBoards(session.user_id),
  };
}

/**
 * Sets `req.user` (the signed-in user) and `req.owner`: the board the request works with,
 * the user's own unless another board the user is a member of is asked for
 * (`X-Board` header, or `?board=` where headers can't be set, e.g. EventSource).
 */
export function requireAuth(req, res, next) {
  if (!authEnabled) {
    req.user = '';
    req.owner = '';
    return next();
  }
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.user = session.user_id;
  const board = req.get('x-board') || req.query.board;
  if (board && board !== req.user && !isMember(board, req.user)) return res.status(403).json({ error: 'no access' });
  req.owner = board || req.user;
  next();
}

// --- Providers: each turns the client's proof into a verified identity. ---

async function verifyGoogle(body) {
  if (!GOOGLE_CLIENT_ID) throw new AuthError(404, 'provider disabled');
  const credential = body?.credential;
  if (typeof credential !== 'string' || credential.length > 4096) throw new AuthError(400, 'invalid credential');
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(credential, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: GOOGLE_CLIENT_ID,
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
  if (!YANDEX_CLIENT_ID) throw new AuthError(404, 'provider disabled');
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
  if (info.client_id !== YANDEX_CLIENT_ID || typeof info.id !== 'string') throw new AuthError(401, 'invalid token');
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

// --- Sign-in and linking ---

function startSession(req, res, userId, identity) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    tokenHash: hash(token),
    userId,
    provider: identity.provider,
    email: identity.email ?? '',
    name: identity.name,
    picture: identity.picture,
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
  const userId = getIdentityUser(identity.provider, identity.subject) ?? `u:${crypto.randomUUID()}`;
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
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      res.status(err.status).json(err.body);
    }
  };
}

export function registerAuthRoutes(app) {
  app.get('/api/auth/config', (req, res) => {
    res.json({
      enabled: authEnabled,
      clientId: GOOGLE_CLIENT_ID || null,
      yandexClientId: YANDEX_CLIENT_ID || null,
      devLogin: devLoginAllowed(req),
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

  // Members of the signed-in user's own board.
  app.get('/api/members', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    res.json({ members: listMembers(req.user) });
  });

  app.post('/api/members', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !EMAIL.test(email)) return res.status(400).json({ error: 'invalid email' });
    if (listIdentities(req.user).some((i) => i.email === email)) return res.status(400).json({ error: 'own email' });
    addMember(req.user, email);
    res.json({ members: listMembers(req.user) });
  });

  app.post('/api/members/remove', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    if (typeof req.body?.email !== 'string' || !deleteMember(req.user, req.body.email)) {
      return res.status(404).json({ error: 'not found' });
    }
    disconnect(req.user, { except: req.user });
    res.json({ members: listMembers(req.user) });
  });

  app.post('/api/boards/leave', requireAuth, (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const board = req.body?.board;
    if (typeof board !== 'string' || !leaveBoard(board, req.user)) return res.status(404).json({ error: 'not found' });
    res.json({ boards: sharedBoards(req.user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) deleteSession(hash(token));
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });
}

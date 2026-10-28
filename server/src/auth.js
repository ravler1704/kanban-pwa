import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSession, deleteSession, getSession } from './db.js';

// Sign-in with Google; every user gets their own board. ALLOWED_EMAILS optionally limits
// who may sign in (empty: any Google account). Auth is off when GOOGLE_CLIENT_ID is not set
// (local development), and everyone shares the single board of owner ''.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_EMAILS = new Set(
  (process.env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
);
export const authEnabled = Boolean(CLIENT_ID);
// Local development only: a "test account" button that signs in without Google. Even when
// enabled, it is accepted only from this machine (behind Caddy req.ip is the real client).
const DEV_LOGIN = authEnabled && process.env.DEV_LOGIN === '1';
const DEV_USER = { userId: 'dev:test', email: 'test@localhost', name: 'Тестовый аккаунт', picture: null };
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const devLoginAllowed = (req) => DEV_LOGIN && LOOPBACK.has(req.ip);

const COOKIE = 'kanban_session';
// Browsers cap cookie lifetime at 400 days.
const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const isAllowed = (email) => ALLOWED_EMAILS.size === 0 || ALLOWED_EMAILS.has(email.toLowerCase());

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
  // Removing an address from ALLOWED_EMAILS revokes its sessions immediately.
  if (!session) return null;
  if (session.user_id === DEV_USER.userId) return devLoginAllowed(req) ? session : null;
  return isAllowed(session.email) ? session : null;
}

function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = { ...user, tokenHash: hash(token), createdAt: now, expiresAt: now + SESSION_TTL_MS };
  createSession(session);
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
  res.json({ user: publicUser(session) });
}

const publicUser = (s) => ({ email: s.email, name: s.name, picture: s.picture });

/** Sets `req.owner`: the board the request works with. */
export function requireAuth(req, res, next) {
  if (!authEnabled) {
    req.owner = '';
    return next();
  }
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.owner = session.user_id;
  next();
}

export function registerAuthRoutes(app) {
  app.get('/api/auth/config', (req, res) => {
    res.json({ enabled: authEnabled, clientId: CLIENT_ID || null, devLogin: devLoginAllowed(req) });
  });

  app.post('/api/auth/dev', (req, res) => {
    if (!devLoginAllowed(req)) return res.status(404).json({ error: 'not found' });
    startSession(req, res, DEV_USER);
  });

  app.get('/api/auth/me', (req, res) => {
    if (!authEnabled) return res.json({ user: null, enabled: false });
    const session = currentSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    res.json({ user: publicUser(session), enabled: true });
  });

  app.post('/api/auth/google', async (req, res) => {
    if (!authEnabled) return res.status(404).json({ error: 'auth disabled' });
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || credential.length > 4096) {
      return res.status(400).json({ error: 'invalid credential' });
    }

    let claims;
    try {
      ({ payload: claims } = await jwtVerify(credential, googleKeys, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: CLIENT_ID,
      }));
    } catch {
      return res.status(401).json({ error: 'invalid credential' });
    }

    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string' || claims.email_verified !== true) {
      return res.status(403).json({ error: 'email not verified' });
    }
    if (!isAllowed(claims.email)) {
      return res.status(403).json({ error: 'not allowed', email: claims.email });
    }

    startSession(req, res, {
      // Google's stable account id; the e-mail of an account can change.
      userId: `google:${claims.sub}`,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name : null,
      picture: typeof claims.picture === 'string' ? claims.picture : null,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) deleteSession(hash(token));
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });
}

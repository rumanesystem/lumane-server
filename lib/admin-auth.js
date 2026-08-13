'use strict';

const crypto = require('crypto');

const DEFAULT_COOKIE_NAME = 'lumane_admin_session';
const DEFAULT_CSRF_COOKIE_NAME = 'lumane_admin_csrf';
const DEFAULT_IDLE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 20;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function secretsEqual(expectedHash, candidate) {
  if (!Buffer.isBuffer(expectedHash) || typeof candidate !== 'string' || candidate.length === 0) return false;
  return crypto.timingSafeEqual(expectedHash, hashSecret(candidate));
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function parseCookieHeader(header) {
  const cookies = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Malformed cookie values are ignored instead of reaching authentication.
    }
  }
  return cookies;
}

function sessionCookieOptions({ absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS } = {}) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: absoluteTtlMs,
  };
}

function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  };
}

function setSessionCookie(res, name, value, options) {
  res.cookie(name, value, options);
}

function clearSessionCookie(res, name) {
  res.clearCookie(name, clearSessionCookieOptions());
}

function csrfCookieOptions({ absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS } = {}) {
  return {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: absoluteTtlMs,
  };
}

function clearCsrfCookie(res, name) {
  res.clearCookie(name, {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
}

class AdminSessionManager {
  constructor({
    idleTtlMs = DEFAULT_IDLE_TTL_MS,
    absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    now = Date.now,
    tokenFactory = randomToken,
  } = {}) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new Error('maxSessions must be positive');
    this.idleTtlMs = idleTtlMs;
    this.absoluteTtlMs = absoluteTtlMs;
    this.maxSessions = maxSessions;
    this.now = now;
    this.tokenFactory = tokenFactory;
    this.sessions = new Map();
  }

  create(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Authenticated email is required');
    const now = this.now();
    this.#purgeExpired(now);
    while (this.sessions.size >= this.maxSessions) this.#deleteOldest();

    const token = this.tokenFactory();
    const csrfToken = this.tokenFactory();
    const tokenHash = hashSecret(token).toString('hex');
    this.sessions.set(tokenHash, {
      email: normalizedEmail,
      csrfHashes: [hashSecret(csrfToken)],
      createdAt: now,
      lastSeenAt: now,
    });
    return { token, csrfToken, email: normalizedEmail, expiresAt: now + this.absoluteTtlMs };
  }

  authenticate(token, { touch = true } = {}) {
    if (typeof token !== 'string' || token.length === 0) return null;
    const now = this.now();
    const tokenHash = hashSecret(token).toString('hex');
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (this.#isExpired(session, now)) {
      this.sessions.delete(tokenHash);
      return null;
    }
    if (touch) session.lastSeenAt = now;
    return {
      email: session.email,
      createdAt: session.createdAt,
      expiresAt: session.createdAt + this.absoluteTtlMs,
    };
  }

  verifyCsrf(token, csrfToken) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const session = this.sessions.get(hashSecret(token).toString('hex'));
    if (!session || this.#isExpired(session, this.now())) return false;
    return session.csrfHashes.some(expectedHash => secretsEqual(expectedHash, csrfToken));
  }

  rotateCsrf(token) {
    if (!this.authenticate(token)) return null;
    const session = this.sessions.get(hashSecret(token).toString('hex'));
    const csrfToken = this.tokenFactory();
    session.csrfHashes.push(hashSecret(csrfToken));
    if (session.csrfHashes.length > 10) session.csrfHashes.shift();
    return csrfToken;
  }

  destroy(token) {
    if (typeof token !== 'string' || token.length === 0) return false;
    return this.sessions.delete(hashSecret(token).toString('hex'));
  }

  #isExpired(session, now) {
    return now - session.lastSeenAt >= this.idleTtlMs || now - session.createdAt >= this.absoluteTtlMs;
  }

  #purgeExpired(now) {
    for (const [key, session] of this.sessions) {
      if (this.#isExpired(session, now)) this.sessions.delete(key);
    }
  }

  #deleteOldest() {
    let oldestKey;
    let oldestCreatedAt = Infinity;
    for (const [key, session] of this.sessions) {
      if (session.createdAt < oldestCreatedAt) {
        oldestKey = key;
        oldestCreatedAt = session.createdAt;
      }
    }
    if (oldestKey) this.sessions.delete(oldestKey);
  }
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function createAdminAuth({
  signInWithPassword,
  cookieName = DEFAULT_COOKIE_NAME,
  csrfCookieName = DEFAULT_CSRF_COOKIE_NAME,
  sessionManager = new AdminSessionManager(),
}) {
  if (typeof signInWithPassword !== 'function') throw new Error('signInWithPassword provider is required');

  function cookieToken(req) {
    return parseCookieHeader(req.headers.cookie)[cookieName] || '';
  }

  function rejectAuthentication(res) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }

  function authenticateRequest(req, options) {
    return sessionManager.authenticate(cookieToken(req), options);
  }

  function refreshCsrf(req, res) {
    const csrfToken = sessionManager.rotateCsrf(cookieToken(req));
    if (!csrfToken) return false;
    res.cookie(
      csrfCookieName,
      csrfToken,
      csrfCookieOptions({ absoluteTtlMs: sessionManager.absoluteTtlMs })
    );
    return true;
  }

  function requireAdmin(req, res, next) {
    const token = cookieToken(req);
    const session = sessionManager.authenticate(token);
    if (session) {
      if (!SAFE_METHODS.has(req.method)) {
        const origin = String(req.get('origin') || '');
        const csrfToken = String(req.get('x-csrf-token') || '');
        if (!origin || origin !== requestOrigin(req) || !sessionManager.verifyCsrf(token, csrfToken)) {
          return res.status(403).json({ error: '요청을 확인할 수 없습니다.' });
        }
      }
      req.adminAuth = { type: 'session', session };
      return next();
    }

    return rejectAuthentication(res);
  }

  async function login(req, res) {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return rejectAuthentication(res);

    try {
      const { data, error } = await signInWithPassword({ email, password });
      if (error || !data?.session || !data?.user) {
        return rejectAuthentication(res);
      }
      const role = String(data.user.app_metadata?.role || '').trim().toLowerCase();
      if (role !== 'admin' && role !== 'operator') return rejectAuthentication(res);
      const authenticatedEmail = String(data.user.email || email).trim().toLowerCase();
      const session = sessionManager.create(authenticatedEmail);
      setSessionCookie(
        res,
        cookieName,
        session.token,
        sessionCookieOptions({ absoluteTtlMs: sessionManager.absoluteTtlMs })
      );
      res.cookie(
        csrfCookieName,
        session.csrfToken,
        csrfCookieOptions({ absoluteTtlMs: sessionManager.absoluteTtlMs })
      );
      return res.status(200).json({ email: session.email, expiresAt: session.expiresAt });
    } catch {
      return rejectAuthentication(res);
    }
  }

  function currentSession(req, res) {
    const token = cookieToken(req);
    const session = sessionManager.authenticate(token);
    if (!session) return rejectAuthentication(res);
    refreshCsrf(req, res);
    return res.status(200).json(session);
  }

  function logout(req, res) {
    sessionManager.destroy(cookieToken(req));
    clearSessionCookie(res, cookieName);
    clearCsrfCookie(res, csrfCookieName);
    return res.status(204).end();
  }

  return {
    authenticateRequest,
    currentSession,
    login,
    logout,
    refreshCsrf,
    requireAdmin,
    sessionManager,
  };
}

function createAdminPageHandler({ adminAuth, rootDir, adminFile = 'admin.html', loginFile = 'admin-login.html' }) {
  if (!adminAuth || typeof adminAuth.authenticateRequest !== 'function') {
    throw new Error('adminAuth is required');
  }
  if (!rootDir) throw new Error('rootDir is required');

  return function serveAdminPage(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (!adminAuth.authenticateRequest(req)) return res.sendFile(loginFile, { root: rootDir });
    adminAuth.refreshCsrf(req, res);
    return res.sendFile(adminFile, { root: rootDir });
  };
}

module.exports = {
  AdminSessionManager,
  DEFAULT_ABSOLUTE_TTL_MS,
  DEFAULT_COOKIE_NAME,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_IDLE_TTL_MS,
  clearSessionCookie,
  clearSessionCookieOptions,
  createAdminPageHandler,
  createAdminAuth,
  csrfCookieOptions,
  parseCookieHeader,
  setSessionCookie,
  sessionCookieOptions,
};

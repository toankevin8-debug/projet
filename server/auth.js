import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;
export const COOKIE = 'ff_session';

// Format stocké : scrypt$<sel hex>$<hash hex>
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: '/',
  };
}

export async function startSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 day')`,
    [sha256(token), userId, SESSION_DAYS],
  );
  res.cookie(COOKIE, token, cookieOptions());
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// Charge l'utilisateur et son profil légal à partir du cookie de session.
export async function loadUser(req, _res, next) {
  try {
    const token = readCookie(req, COOKIE);
    req.user = null;
    if (token) {
      req.user = await one(
        `SELECT u.id, u.fullname, u.email, u.phone, u.plan, u.email_verified_at,
                to_jsonb(p) - 'user_id' AS profile
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN business_profiles p ON p.user_id = u.id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [sha256(token)],
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, res, next) {
  if (!req.user) return res.redirect(`/connexion?suite=${encodeURIComponent(req.originalUrl)}`);
  return next();
}

// Protection CSRF : tout POST doit venir de notre propre origine.
// Les cookies SameSite=Lax couvrent déjà l'essentiel ; ce contrôle ferme le reste.
export function sameOrigin(req, res, next) {
  if (req.method !== 'POST') return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch {
    // origine illisible : refusée ci-dessous
  }
  return res.status(403).send('Origine refusée');
}

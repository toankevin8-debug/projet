// Comptes : inscription, connexion (email ou Google), vérification d'email, mot de passe oublié.
import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { one, query } from './db.js';
import { hashPassword, readCookie, startSession, verifyPassword, endSession } from './auth.js';
import { text } from './forms.js';
import { baseUrl, sendMail } from './mailer.js';
import { signupPage, loginPage, forgotPage, resetPage, messagePage } from './views/auth.js';

export const router = Router();

const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GOOGLE_ENABLED = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// --- Limite de tentatives (mémoire du processus, suffisant pour une instance) ---------------
const attempts = new Map();
function tooManyAttempts(key, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 10000) attempts.clear();
  return list.length > max;
}

// --- Jetons envoyés par email --------------------------------------------------------------
async function createToken(userId, kind, hours) {
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, $3, now() + $4 * interval '1 hour')`,
    [sha256(token), userId, kind, hours],
  );
  return token;
}

async function consumeToken(token, kind) {
  if (typeof token !== 'string' || token.length < 20) return null;
  return one(
    `UPDATE email_tokens SET used_at = now()
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [sha256(token), kind],
  );
}

export async function sendVerification(req, user) {
  const token = await createToken(user.id, 'verify', 72);
  const link = `${baseUrl(req)}/verifier-email?jeton=${token}`;
  await sendMail({
    userId: user.id,
    to: user.email,
    subject: 'Confirmez votre adresse email · FreeFact',
    text: `Bonjour ${user.fullname},\n\nConfirmez votre adresse email pour activer l’envoi de vos factures par email :\n${link}\n\nCe lien est valable 72 heures. Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message.\n\nFreeFact`,
  });
}

// --- Inscription ------------------------------------------------------------------------------

router.get('/inscription', (req, res) => {
  if (req.user) return res.redirect('/app');
  return res.send(String(signupPage({ plan: req.query.plan, values: { email: text(req.query.email) || '' }, google: GOOGLE_ENABLED })));
});

router.post('/inscription', async (req, res) => {
  const values = {
    fullname: text(req.body.fullname),
    email: text(req.body.email)?.toLowerCase(),
    phone: text(req.body.phone),
    terms: req.body.terms === '1',
  };
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const fail = (error, field) => res.status(422).send(String(signupPage({ error, field, values, google: GOOGLE_ENABLED })));

  if (!values.fullname) return fail('Indiquez votre nom.', 'fullname');
  if (!values.email || !EMAIL.test(values.email)) return fail('Adresse email invalide.', 'email');
  if (password.length < 8) return fail('Le mot de passe doit faire au moins 8 caractères.', 'password');
  if (!values.terms) return fail('Cochez la case pour confirmer que vous avez compris le rôle de FreeFact.', 'terms');
  if (tooManyAttempts(`signup:${req.ip}`, 20, 60 * 60 * 1000)) return fail('Trop de tentatives. Réessayez dans une heure.');

  try {
    const user = await one(
      `INSERT INTO users (fullname, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, fullname, email`,
      [values.fullname, values.email, values.phone, await hashPassword(password)],
    );
    await sendVerification(req, user);
    await startSession(res, user.id);
    return res.redirect('/app/parametres');
  } catch (err) {
    if (err.code === '23505') return fail('Un compte existe déjà avec cet email. Connectez-vous.', 'email');
    throw err;
  }
});

router.get('/verifier-email', async (req, res) => {
  const row = await consumeToken(req.query.jeton, 'verify');
  if (!row) {
    return res.status(400).send(String(messagePage({
      title: 'Lien expiré ou déjà utilisé',
      message: 'Demandez un nouveau lien depuis votre espace : un bandeau vous le propose tant que l’email n’est pas confirmé.',
    })));
  }
  await query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [row.user_id]);
  return res.redirect(req.user ? '/app?ok=email_verifie' : '/connexion?ok=email_verifie');
});

// --- Connexion -----------------------------------------------------------------------------------

router.get('/connexion', (req, res) => {
  if (req.user) return res.redirect('/app');
  const notices = { email_verifie: 'Adresse email confirmée. Connectez-vous.', mdp: 'Mot de passe modifié. Connectez-vous.' };
  return res.send(String(loginPage({ next: req.query.suite, google: GOOGLE_ENABLED, info: notices[req.query.ok] })));
});

router.post('/connexion', async (req, res) => {
  const email = text(req.body.email)?.toLowerCase() || '';
  const fail = (error, status = 401) => res.status(status).send(String(loginPage({ error, email, next: req.body.suite, google: GOOGLE_ENABLED })));
  if (tooManyAttempts(`login:${req.ip}:${email}`)) return fail('Trop de tentatives. Patientez quelques minutes avant de réessayer.', 429);
  const user = await one('SELECT id, password_hash, google_id FROM users WHERE lower(email) = $1', [email]);
  if (user && !user.password_hash && user.google_id) return fail('Ce compte utilise la connexion Google.');
  const ok = user && (await verifyPassword(String(req.body.password || ''), user.password_hash));
  if (!ok) return fail('Email ou mot de passe incorrect.');
  await startSession(res, user.id);
  const next = typeof req.body.suite === 'string' && /^\/app(\/|$|\?)/.test(req.body.suite) ? req.body.suite : '/app';
  return res.redirect(next);
});

router.post('/deconnexion', async (req, res) => {
  await endSession(req, res);
  res.redirect('/');
});

// --- Mot de passe oublié ----------------------------------------------------------------------------

router.get('/mot-de-passe-oublie', (req, res) => res.send(String(forgotPage({}))));

router.post('/mot-de-passe-oublie', async (req, res) => {
  const email = text(req.body.email)?.toLowerCase() || '';
  if (tooManyAttempts(`forgot:${req.ip}`, 5, 15 * 60 * 1000)) {
    return res.status(429).send(String(forgotPage({ error: 'Trop de demandes. Réessayez dans quelques minutes.', email })));
  }
  const user = await one('SELECT id, fullname, email FROM users WHERE lower(email) = $1', [email]);
  if (user) {
    const token = await createToken(user.id, 'reset', 2);
    await sendMail({
      userId: user.id,
      to: user.email,
      subject: 'Réinitialiser votre mot de passe · FreeFact',
      text: `Bonjour ${user.fullname},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 2 heures) :\n${baseUrl(req)}/reinitialiser?jeton=${token}\n\nSi vous n’avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.\n\nFreeFact`,
    });
  }
  // Même réponse que le compte existe ou non : on ne révèle pas quels emails sont inscrits.
  return res.send(String(forgotPage({ sent: true, email })));
});

router.get('/reinitialiser', (req, res) => res.send(String(resetPage({ token: String(req.query.jeton || '') }))));

router.post('/reinitialiser', async (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const token = String(req.body.jeton || '');
  if (password.length < 8) return res.status(422).send(String(resetPage({ token, error: 'Le mot de passe doit faire au moins 8 caractères.' })));
  const row = await consumeToken(token, 'reset');
  if (!row) return res.status(400).send(String(resetPage({ token: '', error: 'Ce lien a expiré ou a déjà servi. Refaites une demande.' })));
  await query('UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [row.user_id, await hashPassword(password)]);
  // Toutes les sessions existantes sont fermées : si le compte était compromis, l'intrus est déconnecté.
  await query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
  return res.redirect('/connexion?ok=mdp');
});

// --- Connexion Google (OpenID Connect, flux « authorization code ») ------------------------------------

const googleRedirect = (req) => `${baseUrl(req)}/auth/google/retour`;

router.get('/auth/google', (req, res) => {
  if (!GOOGLE_ENABLED) return res.redirect('/connexion');
  const state = randomBytes(16).toString('base64url');
  res.cookie('ff_oauth', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000, path: '/' });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirect(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return res.redirect(url.toString());
});

router.get('/auth/google/retour', async (req, res) => {
  const state = readCookie(req, 'ff_oauth');
  res.clearCookie('ff_oauth', { path: '/' });
  const fail = () => res.status(400).send(String(loginPage({ error: 'La connexion Google a échoué. Réessayez, ou utilisez votre email.', google: GOOGLE_ENABLED })));
  if (!GOOGLE_ENABLED || !state || state !== req.query.state || typeof req.query.code !== 'string') return fail();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: req.query.code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirect(req),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return fail();
  const { access_token: accessToken } = await tokenRes.json();
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!infoRes.ok) return fail();
  const info = await infoRes.json();
  if (!info.sub || !info.email || !info.email_verified) return fail();

  const email = info.email.toLowerCase();
  let user = await one('SELECT id FROM users WHERE google_id = $1', [info.sub]);
  if (!user) {
    // Email déjà inscrit : on rattache le compte Google (l'email est vérifié par Google).
    user = await one(
      `UPDATE users SET google_id = $2, email_verified_at = coalesce(email_verified_at, now())
       WHERE lower(email) = $1 AND google_id IS NULL RETURNING id`,
      [email, info.sub],
    );
  }
  let isNew = false;
  if (!user) {
    user = await one(
      `INSERT INTO users (fullname, email, google_id, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id`,
      [info.name || email.split('@')[0], email, info.sub],
    );
    isNew = true;
  }
  await startSession(res, user.id);
  return res.redirect(isNew ? '/app/parametres' : '/app');
});

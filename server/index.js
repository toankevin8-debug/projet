import express from 'express';
import { fileURLToPath } from 'node:url';
import { one, userMessage } from './db.js';
import { migrate } from './migrate.js';
import { endSession, hashPassword, loadUser, requireUser, sameOrigin, startSession, verifyPassword } from './auth.js';
import { UUID, text } from './forms.js';
import { router as appRouter } from './app-routes.js';
import { landingPage } from './views/landing.js';
import { signupPage, loginPage } from './views/auth.js';
import { publicInvoicePage } from './views/invoices.js';
import { plainPage } from './views/layout.js';
import { html } from './html.js';
import { getPublicInvoice } from './data.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    next();
  });
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: true, limit: '200kb', parameterLimit: 5000 }));
  app.use(sameOrigin);
  app.use(loadUser);

  // --- Pages publiques ---------------------------------------------------------------

  app.get('/', (req, res) => res.send(String(landingPage({ user: req.user }))));

  app.get('/inscription', (req, res) => {
    if (req.user) return res.redirect('/app');
    return res.send(String(signupPage({ plan: req.query.plan, values: { email: text(req.query.email) || '' } })));
  });

  app.post('/inscription', async (req, res) => {
    const values = {
      fullname: text(req.body.fullname),
      email: text(req.body.email)?.toLowerCase(),
      phone: text(req.body.phone),
      terms: req.body.terms === '1',
    };
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const fail = (error) => res.status(422).send(String(signupPage({ error, values })));

    if (!values.fullname) return fail('Indiquez votre nom.');
    if (!values.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return fail('Adresse email invalide.');
    if (password.length < 8) return fail('Le mot de passe doit faire au moins 8 caractères.');
    if (!values.terms) return fail('Cochez la case pour confirmer que vous avez compris le rôle de FreeFact.');

    try {
      const user = await one(
        `INSERT INTO users (fullname, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
        [values.fullname, values.email, values.phone, await hashPassword(password)],
      );
      await startSession(res, user.id);
      return res.redirect('/app/parametres');
    } catch (err) {
      if (err.code === '23505') return fail('Un compte existe déjà avec cet email. Connectez-vous.');
      throw err;
    }
  });

  app.get('/connexion', (req, res) => {
    if (req.user) return res.redirect('/app');
    return res.send(String(loginPage({ next: req.query.suite })));
  });

  app.post('/connexion', async (req, res) => {
    const email = text(req.body.email)?.toLowerCase() || '';
    const user = await one('SELECT id, password_hash FROM users WHERE lower(email) = $1', [email]);
    const ok = user && (await verifyPassword(String(req.body.password || ''), user.password_hash));
    if (!ok) {
      return res.status(401).send(String(loginPage({ error: 'Email ou mot de passe incorrect.', email, next: req.body.suite })));
    }
    await startSession(res, user.id);
    const next = typeof req.body.suite === 'string' && req.body.suite.startsWith('/app') ? req.body.suite : '/app';
    return res.redirect(next);
  });

  app.post('/deconnexion', async (req, res) => {
    await endSession(req, res);
    res.redirect('/');
  });

  // Lien envoyé au client : seules les factures certifiées sont lisibles.
  app.get('/f/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).send(String(notFound()));
    const inv = await getPublicInvoice(req.params.id);
    if (!inv) return res.status(404).send(String(notFound()));
    res.setHeader('x-robots-tag', 'noindex');
    return res.send(String(publicInvoicePage({ inv })));
  });

  // --- Application ----------------------------------------------------------------------

  app.use('/app', requireUser, appRouter);

  app.use((_req, res) => res.status(404).send(String(notFound())));

  app.use((err, req, res, _next) => {
    const msg = userMessage(err);
    if (msg) return res.status(422).send(String(errorPage(msg)));
    console.error(err);
    return res.status(500).send(String(errorPage('Une erreur est survenue de notre côté. Réessayez dans un instant.')));
  });

  return app;
}

function notFound() {
  return errorPage('Cette page n’existe pas, ou plus.', 'Introuvable');
}

function errorPage(message, title = 'Oups') {
  return plainPage({
    title: `${title} · FreeFact`,
    content: html`<main class="wrap" style="padding-top:12vh;max-width:640px">
      <p class="eyebrow">${title}</p><h1 style="font-size:44px;margin:12px 0 18px">${message}</h1>
      <p><a href="/app">Retour à mon espace</a> · <a href="/">Accueil</a></p></main>`,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  await migrate();
  createApp().listen(port, () => console.log(`FreeFact sur http://localhost:${port}`));
}

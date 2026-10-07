import express from 'express';
import { fileURLToPath } from 'node:url';
import { one, userMessage } from './db.js';
import { migrate } from './migrate.js';
import { loadUser, requireUser, sameOrigin } from './auth.js';
import { router as accountRouter } from './account-routes.js';
import { LEGAL_PAGES } from './views/legal.js';
import { sendInvoicePdf } from './pdf.js';
import { startJobs } from './jobs.js';
import { UUID } from './forms.js';
import { router as appRouter } from './app-routes.js';
import { landingPage } from './views/landing.js';
import { publicInvoicePage, publicQuotePage } from './views/invoices.js';
import { plainPage } from './views/layout.js';
import { html } from './html.js';
import { getPublicInvoice, getPublicQuote } from './data.js';

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

  app.get('/sante', async (_req, res) => {
    await one('SELECT 1');
    res.json({ ok: true });
  });

  app.get('/', (req, res) => res.send(String(landingPage({ user: req.user }))));

  app.use(accountRouter);

  for (const [path, page] of Object.entries(LEGAL_PAGES)) app.get(path, (req, res) => res.send(String(page({ user: req.user }))));

  // Logo d'entreprise (plans Pro et Business), servi depuis la base.
  app.get('/logo/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).end();
    const logo = await one('SELECT mime, data, updated_at FROM business_logos WHERE user_id = $1', [req.params.id]);
    if (!logo) return res.status(404).end();
    res.setHeader('content-type', logo.mime);
    res.setHeader('cache-control', 'public, max-age=300');
    if (logo.mime === 'image/svg+xml') res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    return res.send(logo.data);
  });

  // Lien envoyé au client : seules les factures certifiées sont lisibles.
  app.get('/f/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).send(String(notFound()));
    const inv = await getPublicInvoice(req.params.id);
    if (!inv) return res.status(404).send(String(notFound()));
    res.setHeader('x-robots-tag', 'noindex');
    return res.send(String(publicInvoicePage({ inv })));
  });

  app.get('/f/:id/pdf', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).send(String(notFound()));
    const inv = await getPublicInvoice(req.params.id);
    if (!inv) return res.status(404).send(String(notFound()));
    return sendInvoicePdf(res, inv);
  });

  // Devis partagé avec le client : lisible dès qu'il a été envoyé.
  app.get('/d/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).send(String(notFound()));
    const quote = await getPublicQuote(req.params.id);
    if (!quote) return res.status(404).send(String(notFound()));
    res.setHeader('x-robots-tag', 'noindex');
    return res.send(String(publicQuotePage({ quote })));
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
  startJobs();
}

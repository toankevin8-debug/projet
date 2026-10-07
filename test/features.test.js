// Fonctions de compte, d'abonnement et de partage, par HTTP. Exige une base PostgreSQL :
//   DATABASE_URL=postgres://… npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.FNE_MODE = 'simulation';

const enabled = Boolean(process.env.DATABASE_URL);
let server;
let base;
let db;

function client() {
  let cookie = '';
  return async function req(method, path, form, headers = {}) {
    const isForm = form && !(form instanceof Buffer);
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { cookie, origin: base, ...(isForm ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: form ? (isForm ? new URLSearchParams(form).toString() : form) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith('ff_session=')) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    // Décodage manuel : res.text() retirerait le BOM UTF-8 des exports CSV, qu'on veut vérifier.
    const raw = Buffer.from(await res.arrayBuffer());
    const body = type.includes('pdf') ? raw : new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw);
    return { status: res.status, location: res.headers.get('location'), body, type };
  };
}

// Dernier lien envoyé par email à cette adresse (table outbox).
async function lastLink(email, path) {
  const row = await db.one('SELECT body_text FROM outbox WHERE to_address = $1 ORDER BY id DESC LIMIT 1', [email]);
  const m = row.body_text.match(new RegExp(`${path}\\?jeton=([A-Za-z0-9_-]+)`));
  return m && `${path}?jeton=${m[1]}`;
}

async function setupAccount(req, email, plan = 'gratuit') {
  await req('POST', '/inscription', { fullname: 'Koffi Yao', email, password: 'motdepasse', terms: '1' });
  await req('POST', '/app/parametres', {
    business_name: 'Studio Koffi', ncc: '1234567 A', address: 'Marcory, Abidjan', tax_regime: 'RNI', tax_center: 'Marcory',
    vat_applicable: '1', vat_rate: '18', invoice_prefix: 'FA', credit_note_prefix: 'AV', quote_prefix: 'DV', default_terms_days: '30',
  });
  if (plan !== 'gratuit') await req('POST', '/app/abonnement', { plan, method: 'wave' });
  const r = await req('POST', '/app/clients', { type: 'particulier', name: 'Mariam Touré', address: 'Cocody', phone: '0102030405' });
  assert.equal(r.status, 302);
  const clients = await req('GET', '/app/clients');
  return clients.body.match(/\/app\/clients\/([0-9a-f-]{36})/)[1];
}

async function emitInvoice(req, clientId, price = '50000') {
  const r = await req('POST', '/app/factures', {
    client_id: clientId, terms_days: '0', vat_applicable: '1', action: 'emit',
    'items[0][description]': 'Prestation', 'items[0][qty]': '1', 'items[0][unit_price]': price, 'items[0][vat_applicable]': '1',
  });
  assert.equal(r.status, 302, typeof r.body === 'string' ? r.body.slice(0, 300) : '');
  return r.location.match(/factures\/([0-9a-f-]{36})/)[1];
}

before(async () => {
  if (!enabled) return;
  await (await import('../server/migrate.js')).migrate();
  db = await import('../server/db.js');
  const { createApp } = await import('../server/index.js');
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!enabled) return;
  server.close();
  db.pool.end();
});

const skip = !enabled && 'DATABASE_URL non défini';

test('vérification d’email et mot de passe oublié', { skip }, async () => {
  const req = client();
  const email = `verif+${Date.now()}@example.ci`;
  await req('POST', '/inscription', { fullname: 'Awa', email, password: 'motdepasse', terms: '1' });
  await req('POST', '/app/parametres', { business_name: 'Awa Design' });
  let page = await req('GET', '/app');
  assert.match(page.body, /Confirmez votre adresse/);

  const verify = await lastLink(email, '/verifier-email');
  assert.ok(verify);
  assert.equal((await req('GET', verify)).location, '/app?ok=email_verifie');
  page = await req('GET', '/app');
  assert.doesNotMatch(page.body, /Confirmez votre adresse/);
  assert.equal((await req('GET', verify)).status, 400, 'un lien ne sert qu’une fois');

  // Réponse identique pour un email inconnu : on ne révèle pas les comptes existants.
  const unknown = await req('POST', '/mot-de-passe-oublie', { email: 'personne@example.ci' });
  assert.match(unknown.body, /Si un compte existe/);
  await req('POST', '/mot-de-passe-oublie', { email });
  const reset = await lastLink(email, '/reinitialiser');
  const token = reset.split('jeton=')[1];
  assert.equal((await req('POST', '/reinitialiser', { jeton: token, password: 'court' })).status, 422);
  assert.equal((await req('POST', '/reinitialiser', { jeton: token, password: 'nouveaumotdepasse' })).location, '/connexion?ok=mdp');
  // Les sessions existantes ont été fermées.
  assert.equal((await req('GET', '/app')).status, 302);

  const fresh = client();
  assert.equal((await fresh('POST', '/connexion', { email, password: 'motdepasse' })).status, 401);
  assert.equal((await fresh('POST', '/connexion', { email, password: 'nouveaumotdepasse' })).location, '/app');
});

test('limite de tentatives de connexion', { skip }, async () => {
  const req = client();
  let last;
  for (let i = 0; i < 12; i += 1) last = await req('POST', '/connexion', { email: 'cible@example.ci', password: 'mauvais' });
  assert.equal(last.status, 429);
});

test('abonnement, statistiques, exports CSV et logo', { skip }, async () => {
  const req = client();
  const clientId = await setupAccount(req, `biz+${Date.now()}@example.ci`);

  // Gratuit : statistiques et exports réservés, logo refusé.
  assert.match((await req('GET', '/app/statistiques')).body, /Passer au plan Business/);
  assert.equal((await req('GET', '/app/exports/factures.csv')).location, '/app/statistiques');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await req('POST', '/app/parametres/logo', png, { 'content-type': 'image/png' })).status, 403);

  // Passage en Business (paiement simulé, tracé).
  assert.equal((await req('POST', '/app/abonnement', { plan: 'business', method: 'wave' })).location, '/app/abonnement?ok=plan');
  const sub = await req('GET', '/app/abonnement?ok=plan');
  assert.match(sub.body, /Paiement simulé/);
  assert.match(sub.body, /Gratuit → Business/);

  assert.equal((await req('POST', '/app/parametres/logo', png, { 'content-type': 'image/png' })).status, 200);
  assert.equal((await req('POST', '/app/parametres/logo', Buffer.from('<svg onload="x()"/>'), { 'content-type': 'image/svg+xml' })).status, 415);
  const settings = await req('GET', '/app/parametres');
  const logoUrl = settings.body.match(/src="(\/logo\/[^"]+)"/)[1];
  const logo = await fetch(base + logoUrl.replace(/&amp;/g, '&'));
  assert.equal(logo.headers.get('content-type'), 'image/png');

  const invoiceId = await emitInvoice(req, clientId);
  const show = await req('GET', `/app/factures/${invoiceId}`);
  assert.match(show.body, /class="sheet-logo"/, 'le logo est photographié à l’émission');

  const stats = await req('GET', '/app/statistiques');
  assert.equal(stats.status, 200);
  assert.match(stats.body, /Mariam Touré/);
  const csv = await req('GET', '/app/exports/factures.csv');
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.body, /^﻿numero;type;statut/);
  assert.match(csv.body, /FA-\d{4}-0001;facture;emise/);

  // Retour en gratuit : le logo n'apparaît plus sur les nouvelles factures.
  await req('POST', '/app/abonnement', { plan: 'gratuit' });
  assert.doesNotMatch((await req('GET', '/app/parametres')).body, /class="logo-preview"/);
});

test('PDF, certification simulée et lien client', { skip }, async () => {
  const req = client();
  const clientId = await setupAccount(req, `pdf+${Date.now()}@example.ci`, 'business');
  const invoiceId = await emitInvoice(req, clientId, '120000');

  const pdf = await req('GET', `/app/factures/${invoiceId}/pdf`);
  assert.equal(pdf.type, 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await req('GET', `/f/${invoiceId}/pdf`)).status, 404, 'pas de PDF public avant certification');

  const notifs = await req('GET', '/app/notifications');
  assert.match(notifs.body, /À certifier/);

  assert.equal((await req('POST', `/app/factures/${invoiceId}/certifier-auto`, {})).location, `/app/factures/${invoiceId}?ok=certifiee`);
  const show = await req('GET', `/app/factures/${invoiceId}`);
  assert.match(show.body, /Certification simulée/);
  assert.match(show.body, /N° SIM-\d{4}-/);
  assert.equal((await req('GET', `/f/${invoiceId}/pdf`)).type, 'application/pdf');
});

test('devis partagé, fiche client et changement de mot de passe', { skip }, async () => {
  const req = client();
  const clientId = await setupAccount(req, `devis+${Date.now()}@example.ci`);
  const q = await req('POST', '/app/devis', {
    client_id: clientId, valid_until: '2099-12-31', 'items[0][description]': 'Site vitrine', 'items[0][qty]': '1', 'items[0][unit_price]': '450000', 'items[0][vat_applicable]': '1',
  });
  const quoteId = q.location.match(/devis\/([0-9a-f-]{36})/)[1];
  assert.equal((await fetch(`${base}/d/${quoteId}`)).status, 404, 'brouillon de devis non public');
  const sent = await req('POST', `/app/devis/${quoteId}/envoyer`, { phone: '0102030405' });
  assert.match(sent.location, /^https:\/\/wa\.me\/2250102030405\?text=/);
  const pub = await fetch(`${base}/d/${quoteId}`);
  assert.equal(pub.status, 200);
  const html = await pub.text();
  assert.match(html, /Devis/);
  assert.match(html, /531 000/, 'TTC calculé avec la TVA à 18 %');

  const detail = await req('GET', `/app/clients/${clientId}`);
  assert.match(detail.body, /Retard moyen/);
  assert.match(detail.body, /DV-\d{4}-0001/);

  assert.match((await req('POST', '/app/parametres/mot-de-passe', { current: 'faux', password: 'nouveau-mdp' })).location, /erreur=/);
  assert.match((await req('POST', '/app/parametres/mot-de-passe', { current: 'motdepasse', password: 'nouveau-mdp' })).location, /ok=mdp/);
  assert.equal((await req('GET', '/app')).status, 200, 'la session courante reste ouverte');
});

test('pages légales et récapitulatif quotidien', { skip }, async () => {
  for (const p of ['/cgu', '/confidentialite', '/mentions-legales']) assert.equal((await fetch(base + p)).status, 200);
  const req = client();
  const email = `notif+${Date.now()}@example.ci`;
  const clientId = await setupAccount(req, email);
  await emitInvoice(req, clientId);
  await db.query('UPDATE freefact.users SET email_verified_at = now() WHERE email = $1', [email]);
  const { sendDailyDigests } = await import('../server/jobs.js');
  assert.ok((await sendDailyDigests()) >= 1);
  const mail = await db.one('SELECT subject, body_text FROM freefact.outbox WHERE to_address = $1 ORDER BY id DESC LIMIT 1', [email]);
  assert.match(mail.subject, /à traiter aujourd’hui/);
  assert.match(mail.body_text, /À certifier sur la FNE/);
  const before = await db.one('SELECT count(*)::int AS n FROM freefact.outbox WHERE to_address = $1', [email]);
  await sendDailyDigests();
  const afterCount = await db.one('SELECT count(*)::int AS n FROM freefact.outbox WHERE to_address = $1', [email]);
  assert.equal(afterCount.n, before.n, 'un seul récapitulatif par jour');
});

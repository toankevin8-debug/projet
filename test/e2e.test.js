// Parcours complet par HTTP : inscription → identité légale → client → brouillon → émission
// → certification FNE → envoi → paiements → avoir. Exige une base PostgreSQL vide :
//   DATABASE_URL=postgres://… npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const enabled = Boolean(process.env.DATABASE_URL);
let server;
let base;
let cookie = '';

async function req(method, path, form) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      cookie,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded', origin: base } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

before(async () => {
  if (!enabled) return;
  const { migrate } = await import('../server/migrate.js');
  await migrate();
  const { createApp } = await import('../server/index.js');
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!enabled) return;
  server.close();
  (await import('../server/db.js')).pool.end();
});

test('parcours complet d’une facture', { skip: !enabled && 'DATABASE_URL non défini' }, async () => {
  const landing = await req('GET', '/');
  assert.equal(landing.status, 200);
  assert.match(landing.body, /Créer mon compte/);

  const email = `awa+${Date.now()}@example.ci`;
  let r = await req('POST', '/inscription', { fullname: 'Awa Koné', email, phone: '0707000000', password: 'motdepasse', terms: '1' });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/app/parametres');

  // Sans identité légale, l'application renvoie vers l'onboarding.
  r = await req('GET', '/app');
  assert.equal(r.location, '/app/parametres');

  r = await req('POST', '/app/parametres', {
    business_name: 'Atelier Nanan', ncc: '2204517 K', address: 'Cocody, Abidjan', tax_regime: 'RSI', tax_center: 'Cocody',
    vat_applicable: '1', vat_rate: '18', invoice_prefix: 'FA', credit_note_prefix: 'AV', quote_prefix: 'DV', default_terms_days: '15',
  });
  assert.equal(r.location, '/app/clients/nouveau?retour=facture');

  r = await req('POST', '/app/clients', { type: 'entreprise', name: 'Boulangerie des Deux-Plateaux', address: 'Bd Latrille', retour: 'facture' });
  assert.equal(r.status, 302);
  const clientId = new URL(r.location, base).searchParams.get('client');

  // Émission refusée : NCC du client entreprise manquant.
  r = await req('POST', '/app/factures', {
    client_id: clientId, terms_days: '15', vat_applicable: '1', action: 'emit',
    'items[0][description]': 'Affiches A2', 'items[0][qty]': '3', 'items[0][unit_price]': '25 000', 'items[0][vat_applicable]': '1',
    'items[1][description]': 'Logo', 'items[1][qty]': '1', 'items[1][unit_price]': '80000', 'items[1][vat_applicable]': '1',
  });
  assert.equal(r.status, 422);
  assert.match(r.body, /NCC obligatoire pour un client entreprise/);

  r = await req('POST', `/app/clients/${clientId}`, { type: 'entreprise', name: 'Boulangerie des Deux-Plateaux', address: 'Bd Latrille', ncc: '1907733 B' });
  assert.equal(r.status, 302);

  r = await req('GET', '/app/factures?filtre=brouillons');
  const draftId = r.body.match(/\/app\/factures\/([0-9a-f-]{36})/)[1];
  r = await req('POST', `/app/factures/${draftId}`, {
    client_id: clientId, terms_days: '15', vat_applicable: '1', action: 'emit',
    'items[0][description]': 'Affiches A2', 'items[0][qty]': '3', 'items[0][unit_price]': '25000', 'items[0][vat_applicable]': '1',
    'items[1][description]': 'Logo', 'items[1][qty]': '1', 'items[1][unit_price]': '80000', 'items[1][vat_applicable]': '1',
  });
  assert.equal(r.status, 302, r.body.slice(0, 400));
  const invoiceId = draftId;

  r = await req('GET', `/app/factures/${invoiceId}`);
  assert.match(r.body, new RegExp(`FA-${new Date().getFullYear()}-0001`));
  assert.match(r.body, /182 900/);
  assert.match(r.body, /cent quatre-vingt-deux mille neuf cents/);

  // Envoi refusé avant certification, lien public fermé.
  r = await req('POST', `/app/factures/${invoiceId}/envoyer`, { channel: 'whatsapp', phone: '0707000000' });
  assert.equal(r.status, 422);
  assert.match(r.body, /pas certifiée FNE/);
  assert.equal((await req('GET', `/f/${invoiceId}`)).status, 404);

  r = await req('POST', `/app/factures/${invoiceId}/certifier`, { fiscal_number: 'FNE-26-0047719', certified_at: new Date().toISOString().slice(0, 10) });
  assert.equal(r.status, 302);
  r = await req('POST', `/app/factures/${invoiceId}/envoyer`, { channel: 'whatsapp', phone: '07 07 00 00 00' });
  assert.match(r.location, /^https:\/\/wa\.me\/2250707000000\?text=/);
  assert.equal((await req('GET', `/f/${invoiceId}`)).status, 200);

  // Paiement partiel, dépassement refusé, avoir partiel, solde.
  r = await req('POST', `/app/factures/${invoiceId}/paiements`, { amount: '100000', payment_date: new Date().toISOString().slice(0, 10), method: 'wave' });
  assert.equal(r.status, 302);
  r = await req('POST', `/app/factures/${invoiceId}/paiements`, { amount: '90000', payment_date: new Date().toISOString().slice(0, 10), method: 'especes' });
  assert.equal(r.status, 422);
  assert.match(r.body, /supérieur au reste à payer/);

  r = await req('POST', `/app/factures/${invoiceId}/avoir`, {});
  const creditId = r.location.match(/factures\/([0-9a-f-]{36})/)[1];
  r = await req('POST', `/app/factures/${creditId}`, {
    client_id: clientId, terms_days: '0', vat_applicable: '1', action: 'emit',
    'items[0][description]': 'Affiche A2 non livrée', 'items[0][qty]': '1', 'items[0][unit_price]': '25000', 'items[0][vat_applicable]': '1',
  });
  assert.equal(r.status, 302, r.body.slice(0, 400));
  r = await req('GET', `/app/factures/${creditId}`);
  assert.match(r.body, new RegExp(`AV-${new Date().getFullYear()}-0001`));

  r = await req('POST', `/app/factures/${invoiceId}/paiements`, { amount: '53400', payment_date: new Date().toISOString().slice(0, 10), method: 'orange_money' });
  assert.equal(r.status, 302);
  r = await req('GET', `/app/factures/${invoiceId}`);
  assert.match(r.body, /tag--payee/);

  // Factures émises : ni modification, ni suppression ; client protégé.
  r = await req('POST', `/app/clients/${clientId}/supprimer`, {});
  assert.equal(r.status, 422);
  assert.match(r.body, /suppression refusée/);

  for (const path of ['/app', '/app/factures', '/app/devis', '/app/devis/nouveau', '/app/clients', '/app/paiements', '/app/conformite', '/app/parametres', '/app/export.json']) {
    assert.equal((await req('GET', path)).status, 200, path);
  }
});

test('un compte ne voit pas les factures d’un autre', { skip: !enabled && 'DATABASE_URL non défini' }, async () => {
  cookie = '';
  await req('POST', '/inscription', { fullname: 'Yao', email: `yao+${Date.now()}@example.ci`, password: 'motdepasse', terms: '1' });
  await req('POST', '/app/parametres', { business_name: 'Yao Studio' });
  const { one } = await import('../server/db.js');
  const other = await one("SELECT id FROM freefact.invoices WHERE status <> 'brouillon' LIMIT 1");
  const r = await req('GET', `/app/factures/${other.id}`);
  assert.equal(r.status, 404);
});

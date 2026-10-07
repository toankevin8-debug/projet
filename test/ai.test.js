// Fonctions IA testées contre un faux serveur de l'API Anthropic (ANTHROPIC_BASE_URL).
// On vérifie notre côté : forme des requêtes, quotas, données transmises, parcours dans l'application.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key';

const enabled = Boolean(process.env.DATABASE_URL);
const requests = [];
let fake;
let server;
let base;
let db;

// Réponse du faux modèle selon le schéma demandé.
function reply(body) {
  const schema = JSON.stringify(body.output_config?.format ?? {});
  let text;
  if (schema.includes('"lines"')) {
    text = JSON.stringify({ kind: 'facture', client_name: 'Boulangerie du Port', terms_days: 15, lines: [
      { description: 'Affiches', qty: 3, unit_price: 25000 }, { description: 'Logo', qty: 1, unit_price: 0 },
    ] });
  } else if (schema.includes('"relances"')) {
    const numbers = [...String(body.messages[0].content).matchAll(/Facture (\S+)/g)].map((m) => m[1]);
    text = JSON.stringify({ relances: numbers.map((n) => ({ numero: n, message: `Relance IA pour ${n}` })) });
  } else if (schema.includes('"message"')) {
    text = JSON.stringify({ message: 'Bonjour, petit rappel pour votre facture. Merci !' });
  } else {
    text = 'Réponse de l’assistant.';
  }
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function client() {
  let cookie = '';
  return async (method, path, form) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, origin: base, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith('ff_session=')) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  };
}

before(async () => {
  if (!enabled) return;
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ path: req.url, headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply(body)));
    });
  });
  await new Promise((resolve) => fake.listen(0, resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;

  await (await import('../server/migrate.js')).migrate();
  db = await import('../server/db.js');
  const { createApp } = await import('../server/index.js');
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!enabled) return;
  server.close();
  fake.close();
  db.pool.end();
});

test('facture express, relance, assistant et quotas', { skip: !enabled && 'DATABASE_URL non défini' }, async () => {
  const req = client();
  const email = `ia+${Date.now()}@example.ci`;
  await req('POST', '/inscription', { fullname: 'Ama', email, password: 'motdepasse', terms: '1' });
  await req('POST', '/app/parametres', { business_name: 'Studio Ama', ncc: '7654321 Z', address: 'Plateau', tax_regime: 'RSI', vat_applicable: '1', vat_rate: '18', default_terms_days: '30' });

  // Facture express : brouillon créé, client inconnu créé sans coordonnées, prix absent laissé à 0.
  const express = await req('POST', '/app/express', { sentence: '3 affiches à 25 000 et un logo pour la Boulangerie du Port, paiement sous 15 jours' });
  assert.match(express.location, /^\/app\/factures\/[0-9a-f-]{36}\?ok=brouillon$/);
  const draft = await req('GET', express.location);
  assert.match(draft.body, /value="Affiches"/);
  assert.match(draft.body, /value="25000"/);
  assert.match(draft.body, /value="0"/);
  assert.match(draft.body, /Boulangerie du Port/);
  const sent = requests.at(-1);
  assert.equal(sent.path, '/v1/messages?beta=true');
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);

  // Émission et certification pour pouvoir relancer.
  const invoiceId = express.location.match(/factures\/([0-9a-f-]{36})/)[1];
  await db.query("UPDATE freefact.clients SET address = 'Port-Bouët', phone = '0700000001', email = 'port@example.ci' WHERE name = 'Boulangerie du Port'");
  const clientId = (await db.one("SELECT id FROM freefact.clients WHERE name = 'Boulangerie du Port'")).id;
  const emit = await req('POST', `/app/factures/${invoiceId}`, {
    client_id: clientId, terms_days: '15', vat_applicable: '1', action: 'emit',
    'items[0][description]': 'Affiches', 'items[0][qty]': '3', 'items[0][unit_price]': '25000', 'items[0][vat_applicable]': '1',
  });
  assert.equal(emit.status, 302);
  await req('POST', `/app/factures/${invoiceId}/certifier`, { fiscal_number: 'FNE-TEST-1', certified_at: new Date().toISOString().slice(0, 10) });

  const draftReminder = await req('POST', `/app/factures/${invoiceId}/relance-ia`, { tone: 'cordial' });
  assert.match(draftReminder.body, /Relisez avant d’envoyer/);
  assert.match(draftReminder.body, /petit rappel pour votre facture/);
  const reminderPrompt = requests.at(-1).body.messages[0].content;
  assert.match(reminderPrompt, /ton : cordial/);
  assert.doesNotMatch(reminderPrompt, /0700000001|port@example\.ci|7654321/);

  const wa = await req('POST', `/app/factures/${invoiceId}/relance`, { tone: 'cordial', ai: '1', message: 'Message relu', phone: '0700000001' });
  assert.match(wa.location, /wa\.me\/2250700000001\?text=Message%20relu/);
  assert.equal((await db.one(`SELECT ai_generated FROM freefact.reminders WHERE invoice_id = $1`, [invoiceId])).ai_generated, true);

  // Assistant : la question et la réponse sont gardées ; aucune donnée sensible dans le contexte.
  const ask = await req('POST', '/app/assistant', { question: 'Qui me doit le plus ?' });
  assert.equal(ask.location, '/app/assistant');
  assert.match((await req('GET', '/app/assistant')).body, /Réponse de l’assistant/);
  const ctx = JSON.stringify(requests.at(-1).body.system);
  assert.match(ctx, /Boulangerie du Port/);
  assert.doesNotMatch(ctx, /0700000001|port@example\.ci|7654321/);

  // Quota du plan gratuit : 5 actions par mois (facture express, relance, assistant = 3).
  await req('POST', '/app/assistant', { question: 'Et ce mois-ci ?' });
  await req('POST', '/app/assistant', { question: 'Et le mois dernier ?' });
  const before = requests.length;
  const refused = await req('POST', '/app/assistant', { question: 'Encore une ?' });
  assert.equal(refused.status, 422);
  assert.match(refused.body, /Quota IA du mois atteint/);
  assert.equal(requests.length, before, 'aucun appel au modèle une fois le quota atteint');
});

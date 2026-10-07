import { Router } from 'express';
import { one, userMessage } from './db.js';
import * as data from './data.js';
import { amount, longDate } from './html.js';
import { UUID, FormError, bool, integer, isoDate, items, number, text, whatsappLink } from './forms.js';
import { dashboardPage } from './views/dashboard.js';
import { invoiceListPage, invoiceFormPage, invoiceShowPage } from './views/invoices.js';
import {
  clientListPage, clientFormPage, quoteListPage, quoteFormPage, paymentsPage, settingsPage, compliancePage,
} from './views/pages.js';
import { expressBlock, registerAiRoutes } from './ai.js';

export const router = Router();

const MESSAGES = {
  emise: 'Facture émise. Étape suivante : la certifier sur la plateforme FNE.',
  certifiee: 'Certification enregistrée. La facture peut partir chez le client.',
  paiement: 'Paiement enregistré.',
  client: 'Client enregistré.',
  client_supprime: 'Client supprimé.',
  brouillon: 'Brouillon enregistré.',
  brouillon_supprime: 'Brouillon supprimé.',
  devis: 'Devis enregistré.',
  profil: 'Paramètres enregistrés.',
  avoir: 'Avoir préparé : retirez ou ajustez les lignes pour un avoir partiel, puis émettez-le.',
  copie: 'Copie créée en brouillon.',
  convertie: 'Devis converti : voici le brouillon de facture.',
};
const flash = (req) => MESSAGES[req.query.ok] || null;

// Rejette les identifiants mal formés avant qu'ils n'atteignent la base.
router.param('id', (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).send('Introuvable')));

// Onboarding : sans identité légale, on commence par là.
router.use((req, res, next) => {
  if (!req.user.profile && !req.path.startsWith('/parametres')) return res.redirect('/app/parametres');
  return next();
});

// Compteur de la navigation (factures à certifier ou en retard).
router.use(async (req, _res, next) => {
  req.navCounts = req.user.profile ? await data.navCounts(req.user.id) : {};
  next();
});

// --- Tableau de bord ---------------------------------------------------------------

router.get('/', async (req, res) => {
  const dash = await data.dashboard(req.user.id);
  const usage = await data.aiUsageThisMonth(req.user.id);
  res.send(String(dashboardPage({
    user: req.user,
    data: dash,
    counts: req.navCounts,
    express: expressBlock({ usage }),
  })));
});

// --- Factures -------------------------------------------------------------------------

router.get('/factures', async (req, res) => {
  const filter = text(req.query.filtre);
  const [invoices, counts] = await Promise.all([data.listInvoices(req.user.id, filter), data.invoiceCounts(req.user.id)]);
  res.send(String(invoiceListPage({ user: req.user, invoices, counts, filter, navCounts: req.navCounts, message: flash(req) })));
});

router.get('/factures/nouvelle', async (req, res) => {
  const clients = await data.listClients(req.user.id);
  const pre = UUID.test(req.query.client || '') ? req.query.client : null;
  res.send(String(invoiceFormPage({ user: req.user, clients, navCounts: req.navCounts, preselectClient: pre })));
});

function readDraft(body) {
  const clientId = text(body.client_id);
  if (!clientId || !UUID.test(clientId)) throw new FormError('Choisissez un client.');
  const draft = {
    client_id: clientId,
    terms_days: integer(body.terms_days) ?? 30,
    vat_applicable: bool(body.vat_applicable),
    notes: text(body.notes),
    items: items(body.items),
  };
  if (Number.isNaN(draft.terms_days)) throw new FormError('Délai de paiement invalide.');
  return draft;
}

async function saveDraftAndMaybeEmit(req, res, id) {
  const clients = await data.listClients(req.user.id);
  let draft;
  try {
    draft = readDraft(req.body);
    const invoiceId = await data.saveInvoiceDraft(req.user.id, id, draft);
    if (req.body.action === 'emit') {
      try {
        await data.emitInvoice(req.user.id, invoiceId);
        return res.redirect(`/app/factures/${invoiceId}?ok=emise`);
      } catch (err) {
        const msg = userMessage(err);
        if (!msg) throw err;
        const invoice = await data.getInvoice(req.user.id, invoiceId);
        return res.status(422).send(String(invoiceFormPage({ user: req.user, invoice, clients, error: msg, navCounts: req.navCounts })));
      }
    }
    return res.redirect(`/app/factures/${invoiceId}?ok=brouillon`);
  } catch (err) {
    const msg = err instanceof FormError ? err.message : userMessage(err);
    if (!msg) throw err;
    const existing = id ? await data.getInvoice(req.user.id, id) : null;
    const invoice = { ...(existing || {}), ...(draft || {}), items: draft?.items || existing?.items || [] };
    return res.status(422).send(String(invoiceFormPage({ user: req.user, invoice, clients, error: msg, navCounts: req.navCounts })));
  }
}

router.post('/factures', (req, res) => saveDraftAndMaybeEmit(req, res, null));
router.post('/factures/:id', (req, res) => saveDraftAndMaybeEmit(req, res, req.params.id));

function publicUrl(req, id) {
  return `${req.protocol}://${req.get('host')}/f/${id}`;
}

async function showInvoice(req, res, { error, status = 200 } = {}) {
  const inv = await data.getInvoice(req.user.id, req.params.id);
  if (!inv) return res.status(404).send('Facture introuvable');
  if (inv.status === 'brouillon') {
    const clients = await data.listClients(req.user.id);
    return res.status(status).send(String(invoiceFormPage({ user: req.user, invoice: inv, clients, error, navCounts: req.navCounts })));
  }
  return res.status(status).send(String(invoiceShowPage({
    user: req.user, inv, error, message: error ? null : flash(req), navCounts: req.navCounts, publicUrl: publicUrl(req, inv.id),
  })));
}

router.get('/factures/:id', (req, res) => showInvoice(req, res));

// Actions sur une facture : en cas de refus métier, la page se réaffiche avec le message.
function action(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const msg = err instanceof FormError ? err.message : userMessage(err);
      if (!msg) throw err;
      await showInvoice(req, res, { error: msg, status: 422 });
    }
  };
}

router.post('/factures/:id/supprimer', async (req, res) => {
  await data.deleteDraft(req.user.id, req.params.id);
  res.redirect('/app/factures?ok=brouillon_supprime');
});

router.post('/factures/:id/certifier', action(async (req, res) => {
  const fiscal = text(req.body.fiscal_number);
  const at = isoDate(req.body.certified_at);
  if (!fiscal) throw new FormError('Saisissez le numéro fiscal attribué par la DGI.');
  if (!at) throw new FormError('Date de certification invalide.');
  await data.certifyInvoice(req.user.id, req.params.id, { fiscal_number: fiscal, certified_at: at, qr_reference: text(req.body.qr_reference) });
  res.redirect(`/app/factures/${req.params.id}?ok=certifiee`);
}));

router.post('/factures/:id/envoyer', action(async (req, res) => {
  const inv = await data.markSent(req.user.id, req.params.id);
  if (req.body.channel === 'email') return res.status(204).end();
  const msg = `Bonjour ${inv.buyer_snapshot.name},\n\nVoici la facture ${inv.number} de ${inv.seller_snapshot.business_name}, d’un montant de ${amount(inv.total_ttc)} FCFA${inv.kind === 'facture' ? `, payable avant le ${longDate(inv.due_date)}` : ''}.\n\n${publicUrl(req, inv.id)}\n\nMerci et bonne journée.`;
  return res.redirect(whatsappLink(text(req.body.phone), msg));
}));

router.post('/factures/:id/paiements', action(async (req, res) => {
  const amountValue = integer(req.body.amount);
  if (!amountValue || Number.isNaN(amountValue) || amountValue <= 0) throw new FormError('Montant invalide.');
  const date = isoDate(req.body.payment_date);
  if (!date) throw new FormError('Date de paiement invalide.');
  await data.addPayment(req.user.id, req.params.id, {
    amount: amountValue, payment_date: date, method: req.body.method, reference: text(req.body.reference),
  });
  res.redirect(`/app/factures/${req.params.id}?ok=paiement`);
}));

router.post('/factures/:id/avoir', action(async (req, res) => {
  const id = await data.createCreditNote(req.user.id, req.params.id);
  res.redirect(`/app/factures/${id}?ok=avoir`);
}));

router.post('/factures/:id/dupliquer', action(async (req, res) => {
  const id = await data.duplicateInvoice(req.user.id, req.params.id);
  res.redirect(`/app/factures/${id}?ok=copie`);
}));

const TONE_TEMPLATES = {
  amical: (i) => `Bonjour ${i.client},\n\nPetit rappel amical : la facture ${i.number} de ${i.amount} FCFA est arrivée à échéance le ${i.due}. Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.\n\n${i.url}\n\nBonne journée,\n${i.seller}`,
  cordial: (i) => `Bonjour ${i.client},\n\nSauf erreur de notre part, la facture ${i.number} de ${i.amount} FCFA, échue le ${i.due}, reste à régler. Pourriez-vous nous indiquer la date de paiement prévue ?\n\n${i.url}\n\nCordialement,\n${i.seller}`,
  ferme: (i) => `Bonjour ${i.client},\n\nLa facture ${i.number} de ${i.amount} FCFA est échue depuis le ${i.due} et n’a toujours pas été réglée. Merci de procéder au paiement dans les meilleurs délais.\n\n${i.url}\n\n${i.seller}`,
  dernier_rappel: (i) => `Bonjour ${i.client},\n\nMalgré nos précédents messages, la facture ${i.number} de ${i.amount} FCFA, échue le ${i.due}, reste impayée. Sans règlement de votre part, nous serons contraints d’appliquer les conditions prévues sur la facture.\n\n${i.url}\n\n${i.seller}`,
};

router.post('/factures/:id/relance', action(async (req, res) => {
  const inv = await data.getInvoice(req.user.id, req.params.id);
  if (!inv) return res.status(404).send('Facture introuvable');
  const tone = TONE_TEMPLATES[req.body.tone] ? req.body.tone : 'cordial';
  const message = TONE_TEMPLATES[tone]({
    client: inv.buyer_snapshot.name,
    number: inv.number,
    amount: amount(inv.remaining),
    due: longDate(inv.due_date),
    url: publicUrl(req, inv.id),
    seller: inv.seller_snapshot.business_name,
  });
  await data.addReminder(req.user.id, inv.id, { channel: 'whatsapp', tone, message });
  return res.redirect(whatsappLink(text(req.body.phone), message));
}));

// --- Clients ---------------------------------------------------------------------------

router.get('/clients', async (req, res) => {
  const clients = await data.listClients(req.user.id);
  res.send(String(clientListPage({ user: req.user, clients, navCounts: req.navCounts, message: flash(req) })));
});

router.get('/clients/nouveau', (req, res) => {
  res.send(String(clientFormPage({ user: req.user, navCounts: req.navCounts, back: text(req.query.retour) })));
});

router.get('/clients/:id', async (req, res) => {
  const client = await data.getClient(req.user.id, req.params.id);
  if (!client) return res.status(404).send('Client introuvable');
  return res.send(String(clientFormPage({ user: req.user, client, navCounts: req.navCounts })));
});

async function saveClient(req, res, id) {
  const c = {
    type: req.body.type === 'entreprise' ? 'entreprise' : 'particulier',
    name: text(req.body.name),
    ncc: text(req.body.ncc),
    phone: text(req.body.phone),
    email: text(req.body.email),
    address: text(req.body.address),
    notes: text(req.body.notes),
  };
  if (c.type === 'particulier') c.ncc = null;
  try {
    if (!c.name) throw new FormError('Le nom du client est obligatoire.');
    const saved = await data.saveClient(req.user.id, id, c);
    if (!saved) return res.status(404).send('Client introuvable');
    if (req.body.retour === 'facture') return res.redirect(`/app/factures/nouvelle?client=${saved.id}`);
    return res.redirect('/app/clients?ok=client');
  } catch (err) {
    const msg = err instanceof FormError ? err.message : userMessage(err);
    if (!msg) throw err;
    return res.status(422).send(String(clientFormPage({
      user: req.user, client: { ...c, id }, error: msg, navCounts: req.navCounts, back: req.body.retour,
    })));
  }
}

router.post('/clients', (req, res) => saveClient(req, res, null));
router.post('/clients/:id', (req, res) => saveClient(req, res, req.params.id));

router.post('/clients/:id/supprimer', async (req, res) => {
  try {
    await data.deleteClient(req.user.id, req.params.id);
    return res.redirect('/app/clients?ok=client_supprime');
  } catch (err) {
    const msg = userMessage(err);
    if (!msg) throw err;
    const clients = await data.listClients(req.user.id);
    return res.status(422).send(String(clientListPage({ user: req.user, clients, navCounts: req.navCounts, error: msg })));
  }
});

// --- Devis -----------------------------------------------------------------------------

router.get('/devis', async (req, res) => {
  const quotes = await data.listQuotes(req.user.id);
  res.send(String(quoteListPage({ user: req.user, quotes, navCounts: req.navCounts, message: flash(req) })));
});

router.get('/devis/nouveau', async (req, res) => {
  const clients = await data.listClients(req.user.id);
  res.send(String(quoteFormPage({ user: req.user, clients, navCounts: req.navCounts })));
});

router.get('/devis/:id', async (req, res) => {
  const [quote, clients] = await Promise.all([data.getQuote(req.user.id, req.params.id), data.listClients(req.user.id)]);
  if (!quote) return res.status(404).send('Devis introuvable');
  return res.send(String(quoteFormPage({ user: req.user, quote, clients, navCounts: req.navCounts })));
});

async function saveQuote(req, res, id) {
  const clients = await data.listClients(req.user.id);
  let q;
  try {
    const clientId = text(req.body.client_id);
    if (!clientId || !UUID.test(clientId)) throw new FormError('Choisissez un client.');
    q = { client_id: clientId, valid_until: isoDate(req.body.valid_until), notes: text(req.body.notes), items: items(req.body.items) };
    const quoteId = await data.saveQuote(req.user.id, id, q);
    return res.redirect(`/app/devis/${quoteId}?ok=devis`);
  } catch (err) {
    const msg = err instanceof FormError ? err.message : userMessage(err);
    if (!msg) throw err;
    const existing = id ? await data.getQuote(req.user.id, id) : null;
    return res.status(422).send(String(quoteFormPage({
      user: req.user, quote: { ...(existing || { status: 'brouillon' }), ...(q || {}), items: q?.items || existing?.items || [] },
      clients, error: msg, navCounts: req.navCounts,
    })));
  }
}

router.post('/devis', (req, res) => saveQuote(req, res, null));
router.post('/devis/:id', (req, res) => saveQuote(req, res, req.params.id));

router.post('/devis/:id/statut', async (req, res) => {
  if (['envoye', 'accepte', 'refuse', 'expire'].includes(req.body.status)) {
    await data.setQuoteStatus(req.user.id, req.params.id, req.body.status);
  }
  res.redirect(`/app/devis/${req.params.id}`);
});

router.post('/devis/:id/convertir', async (req, res) => {
  const id = await data.convertQuote(req.user.id, req.params.id);
  res.redirect(`/app/factures/${id}?ok=convertie`);
});

// --- Paiements, conformité, paramètres ------------------------------------------------------

router.get('/paiements', async (req, res) => {
  const [payments, open] = await Promise.all([data.listPayments(req.user.id), data.openInvoices(req.user.id)]);
  res.send(String(paymentsPage({ user: req.user, payments, open, navCounts: req.navCounts })));
});

router.get('/conformite', async (req, res) => {
  const stats = await one(
    `SELECT count(*) FILTER (WHERE status <> 'brouillon') AS emitted,
            count(*) FILTER (WHERE status <> 'brouillon' AND NOT to_certify) AS certified,
            count(*) FILTER (WHERE to_certify) AS to_certify
     FROM invoice_overview WHERE user_id = $1`,
    [req.user.id],
  );
  res.send(String(compliancePage({ user: req.user, navCounts: req.navCounts, stats })));
});

router.get('/parametres', async (req, res) => {
  const usage = await data.aiUsageThisMonth(req.user.id);
  res.send(String(settingsPage({
    user: req.user, navCounts: req.navCounts, onboarding: !req.user.profile, usage, message: flash(req),
  })));
});

router.post('/parametres', async (req, res) => {
  const b = req.body;
  const prefix = (v, d) => (text(v) || d).toUpperCase();
  const profile = {
    business_name: text(b.business_name),
    legal_form: text(b.legal_form),
    ncc: text(b.ncc),
    rccm: text(b.rccm),
    capital: integer(b.capital),
    tax_regime: ['RNI', 'RSI', 'RME', 'entreprenant'].includes(b.tax_regime) ? b.tax_regime : null,
    tax_center: text(b.tax_center),
    address: text(b.address),
    city: text(b.city),
    phone: text(b.phone),
    email_pro: text(b.email_pro),
    vat_applicable: bool(b.vat_applicable),
    vat_rate: number(b.vat_rate) ?? 18,
    payment_info: text(b.payment_info),
    late_penalty_text: text(b.late_penalty_text),
    signature_text: text(b.signature_text),
    invoice_prefix: prefix(b.invoice_prefix, 'FA'),
    credit_note_prefix: prefix(b.credit_note_prefix, 'AV'),
    quote_prefix: prefix(b.quote_prefix, 'DV'),
    default_terms_days: integer(b.default_terms_days) ?? 30,
    fne_registered: bool(b.fne_registered),
  };
  const onboarding = !req.user.profile;
  try {
    if (!profile.business_name) throw new FormError('Le nom commercial est obligatoire.');
    if ([profile.capital, profile.vat_rate, profile.default_terms_days].some(Number.isNaN)) {
      throw new FormError('Vérifiez les champs numériques (capital, taux, délai).');
    }
    await data.saveProfile(req.user.id, profile);
  } catch (err) {
    const msg = err instanceof FormError ? err.message
      : err.code === '23514' ? 'Valeur refusée : préfixes en majuscules (8 caractères max, tous différents), taux entre 0 et 100, délai entre 0 et 365 jours.'
      : userMessage(err);
    if (!msg) throw err;
    const usage = await data.aiUsageThisMonth(req.user.id);
    return res.status(422).send(String(settingsPage({
      user: { ...req.user, profile: { ...(req.user.profile || {}), ...profile } },
      navCounts: req.navCounts, onboarding, usage, error: msg,
    })));
  }
  if (onboarding) {
    const clients = await data.listClients(req.user.id);
    return res.redirect(clients.length ? '/app' : '/app/clients/nouveau?retour=facture');
  }
  return res.redirect('/app/parametres?ok=profil');
});

router.get('/export.json', async (req, res) => {
  const dump = await data.exportAll(req.user.id);
  res.setHeader('content-disposition', `attachment; filename="freefact-sauvegarde-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(dump);
});

registerAiRoutes(router);

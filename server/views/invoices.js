import { html, raw, amount, fcfa, date, longDate, isoDate, statusTag, options, METHOD_LABELS } from '../html.js';
import { appPage, notice, plainPage, wordmark } from './layout.js';
import { invoiceSheet } from './sheet.js';

const FILTERS = [
  ['', 'Toutes', 'tous'],
  ['brouillons', 'Brouillons', 'brouillons'],
  ['a_certifier', 'À certifier', 'a_certifier'],
  ['impayees', 'Impayées', 'impayees'],
  ['en_retard', 'En retard', 'en_retard'],
  ['payees', 'Payées', 'payees'],
  ['avoirs', 'Avoirs', 'avoirs'],
];

export function invoiceListPage({ user, invoices, counts, filter, navCounts, message }) {
  return appPage({
    title: 'Factures',
    user,
    active: 'factures',
    counts: navCounts,
    content: html`
<div class="page-head">
  <div><p class="eyebrow">Factures et avoirs</p><h1>Factures</h1></div>
  <div class="actions">${counts.en_retard > 0 ? html`<a class="btn btn--ghost" href="/app/relances">Relances en lot</a>` : ''}<a class="btn btn--accent" href="/app/factures/nouvelle">Nouvelle facture</a></div>
</div>
${notice(message, 'ok')}
<nav class="filters" aria-label="Filtrer">
  ${FILTERS.map(
    ([key, label, countKey]) => html`<a href="/app/factures${key ? `?filtre=${key}` : ''}" aria-current="${(filter || '') === key}">${label}<span class="n">${counts[countKey]}</span></a>`,
  )}
</nav>
${invoices.length === 0
  ? html`<p class="empty">${filter ? 'Aucune facture dans cette catégorie.' : html`Pas encore de facture. <a href="/app/factures/nouvelle">Créer la première</a>.`}</p>`
  : html`<div class="table-scroll"><table class="ledger">
  <thead><tr><th>Numéro</th><th>Client</th><th>Émise le</th><th>Échéance</th><th>État</th><th class="r">TTC</th><th class="r">Reste</th></tr></thead>
  <tbody>${invoices.map(
    (i) => html`<tr>
      <td><a class="row-link mono" href="/app/factures/${i.id}">${i.number || 'Brouillon'}</a>${i.kind === 'avoir' ? html` <span class="muted small">avoir</span>` : ''}</td>
      <td>${i.client_name}</td>
      <td class="tnum">${date(i.issue_date)}</td>
      <td class="tnum">${i.kind === 'facture' ? date(i.due_date) : '—'}</td>
      <td>${i.to_certify ? html`<span class="tag tag--a_certifier">À certifier</span>` : statusTag(i.display_status)}</td>
      <td class="r num">${i.status === 'brouillon' ? html`<span class="muted">${amount(i.draft_ht)} HT</span>` : amount(i.total_ttc)}</td>
      <td class="r num">${i.remaining > 0 ? amount(i.remaining) : '—'}</td>
    </tr>`,
  )}</tbody></table></div>`}`,
  });
}

// --- Éditeur de lignes (factures et devis) -------------------------------------

export function linesEditor(items, { vatApplicable, vatRate }) {
  const rows = items.length ? items : [{ description: '', qty: 1, unit_price: '', vat_applicable: true }];
  return html`
<div class="table-scroll">
<table class="lines" data-lines data-vat-rate="${vatRate}">
  <thead><tr><th class="c-desc">Désignation</th><th class="c-qty">Qté</th><th class="c-price">Prix unitaire HT</th><th class="c-vat" title="Soumis à TVA">TVA</th><th class="c-total">Montant HT</th><th class="c-del"></th></tr></thead>
  <tbody>
    ${rows.map((it, i) => lineRow(i, it))}
  </tbody>
</table>
</div>
<template data-line-template>${lineRow('__i__', { description: '', qty: 1, unit_price: '', vat_applicable: true })}</template>
<p style="margin-top:12px"><button type="button" class="btn btn--ghost btn--small" data-add-line>Ajouter une ligne</button></p>
<div class="totals num" data-totals data-vat-applicable="${vatApplicable ? '1' : '0'}">
  <div><span>Total HT</span><span data-total="ht">—</span></div>
  <div data-vat-row><span>TVA <span data-vat-label>${amount(vatRate)} %</span></span><span data-total="vat">—</span></div>
  <div class="ttc"><span>Total TTC</span><span data-total="ttc">—</span></div>
  <span class="words" data-total="words"></span>
</div>`;
}

function lineRow(i, it) {
  return html`<tr data-line>
    <td class="c-desc"><input name="items[${i}][description]" value="${it.description}" placeholder="Ex. Création d’affiches A2" aria-label="Désignation"></td>
    <td class="c-qty"><input name="items[${i}][qty]" value="${it.qty === '' ? '' : Number(it.qty)}" inputmode="decimal" aria-label="Quantité" data-qty></td>
    <td class="c-price"><input name="items[${i}][unit_price]" value="${it.unit_price}" inputmode="numeric" placeholder="0" aria-label="Prix unitaire HT en FCFA" data-price></td>
    <td class="c-vat"><input type="checkbox" name="items[${i}][vat_applicable]" value="1" ${it.vat_applicable ? raw('checked') : ''} aria-label="Soumis à TVA" data-vat></td>
    <td class="c-total" data-line-total>—</td>
    <td class="c-del"><button type="button" class="del" data-del-line aria-label="Supprimer la ligne">×</button></td>
  </tr>`;
}

const TERMS = [0, 7, 15, 30, 45, 60, 90];

export function invoiceFormPage({ user, invoice, clients, error, navCounts, preselectClient }) {
  const inv = invoice || { items: [], terms_days: user.profile?.default_terms_days ?? 30, vat_applicable: user.profile?.vat_applicable };
  const isNew = !inv.id;
  const isCredit = inv.kind === 'avoir';
  const vatRate = inv.vat_rate ?? user.profile?.vat_rate ?? 18;
  const selectedClient = inv.client_id || preselectClient;
  const blocking = (inv.compliance || []).filter((c) => c.level === 'bloquant');
  const warnings = (inv.compliance || []).filter((c) => c.level === 'avertissement');
  return appPage({
    title: isNew ? 'Nouvelle facture' : 'Brouillon',
    user,
    active: 'factures',
    counts: navCounts,
    content: html`
<a class="crumb" href="/app/factures">← Factures</a>
<div class="page-head">
  <div><p class="eyebrow">${isCredit ? `Avoir sur ${inv.ref_number}` : 'Brouillon · modifiable jusqu’à l’émission'}</p>
  <h1>${isNew ? 'Nouvelle facture' : isCredit ? 'Avoir en préparation' : 'Facture en préparation'}</h1></div>
</div>
${notice(error)}
${clients.length === 0
  ? html`<div class="notice notice--warn"><p>Ajoutez d’abord un client : <a href="/app/clients/nouveau?retour=facture">créer un client</a>.</p></div>`
  : html`
<form method="post" action="${isNew ? '/app/factures' : `/app/factures/${inv.id}`}" class="doc-layout" data-invoice-form>
  <div>
    <div class="grid-3">
      <label class="field" style="grid-column: span 2"><span>Client</span>
        <select name="client_id" required ${isCredit ? raw('disabled') : ''}>
          <option value="">Choisir…</option>
          ${clients.map((c) => html`<option value="${c.id}" ${c.id === selectedClient ? raw('selected') : ''}>${c.name}${c.type === 'entreprise' ? ' (entreprise)' : ''}</option>`)}
        </select>
        ${isCredit ? html`<input type="hidden" name="client_id" value="${inv.client_id}">` : html`<small><a href="/app/clients/nouveau?retour=facture">Nouveau client</a></small>`}
      </label>
      ${isCredit
        ? html`<input type="hidden" name="terms_days" value="0">`
        : html`<label class="field"><span>Délai de paiement</span>
        <select name="terms_days">${TERMS.map((t) => html`<option value="${t}" ${Number(inv.terms_days) === t ? raw('selected') : ''}>${t === 0 ? 'À réception' : `${t} jours`}</option>`)}</select>
        <small>L’échéance sera fixée le jour de l’émission.</small></label>`}
    </div>

    <label class="check"><input type="checkbox" name="vat_applicable" value="1" data-vat-toggle ${inv.vat_applicable ? raw('checked') : ''}>
      <span>Facturer la TVA (${amount(vatRate)}&nbsp;%)${inv.vat_applicable ? '' : html` <span class="muted small">— sinon la facture portera « TVA non applicable »</span>`}</span></label>

    ${linesEditor(inv.items, { vatApplicable: inv.vat_applicable, vatRate })}

    <label class="field" style="margin-top:24px"><span>Note sur la facture <span class="muted">(facultatif)</span></span>
      <textarea name="notes" rows="2" placeholder="Ex. Bon de commande n° 2026-114">${inv.notes || ''}</textarea></label>
  </div>

  <aside>
    <div class="side-box">
      <span class="eyebrow">Contrôle de conformité</span>
      ${isNew
        ? html`<p class="small muted">Enregistrez le brouillon pour lancer le contrôle : NCC, adresses, TVA selon votre régime.</p>`
        : blocking.length === 0 && warnings.length === 0
          ? html`<ul class="checks"><li class="ok">Prête à être émise.</li></ul>`
          : html`<ul class="checks">
              ${blocking.map((c) => html`<li class="bloquant">${c.message}</li>`)}
              ${warnings.map((c) => html`<li class="avertissement">${c.message}</li>`)}
            </ul>
            ${blocking.length ? html`<p class="small" style="margin:10px 0 0"><a href="/app/parametres">Compléter mon identité</a> · <a href="/app/clients/${inv.client_id}">Fiche client</a></p>` : ''}`}
    </div>
    <div class="side-box">
      <button class="btn" type="submit" name="action" value="save" style="width:100%;justify-content:center">Enregistrer le brouillon</button>
      <button class="btn btn--accent" type="submit" name="action" value="emit" style="width:100%;justify-content:center;margin-top:10px"
        data-confirm="Une fois émise, la facture reçoit son numéro et ne peut plus être modifiée. Émettre maintenant ?">Enregistrer et émettre</button>
      <p class="small muted" style="margin:12px 0 0">L’émission attribue le numéro définitif et fige la facture. Toute correction passera par un avoir.</p>
    </div>
  </aside>
</form>
${!isNew
  ? html`<form method="post" action="/app/factures/${inv.id}/supprimer" data-confirm="Supprimer ce brouillon ?">
      <button class="link-btn link-btn--danger small" type="submit">Supprimer ce brouillon</button></form>`
  : ''}`}`,
  });
}

// --- Facture émise -------------------------------------------------------------------

export function toSheet(inv) {
  return {
    ...inv,
    seller: inv.seller_snapshot,
    buyer: inv.buyer_snapshot,
    words: inv.amount_in_words,
  };
}

function track(inv) {
  const certified = Boolean(inv.certification);
  const steps = [
    ['Émise', `${inv.number}, le ${date(inv.issue_date)}`, true],
    ['Certifiée FNE', certified ? `N° ${inv.certification.fiscal_number}` : 'En attente du numéro fiscal', certified],
    ['Envoyée', inv.sent_at ? `Le ${date(inv.sent_at)}` : certified ? 'Prête à partir' : 'Bloquée avant certification', Boolean(inv.sent_at)],
    inv.kind === 'avoir'
      ? ['Imputée', `Sur ${inv.ref_number}`, true]
      : ['Encaissée', inv.status === 'payee' ? 'Soldée' : inv.status === 'annulee' ? 'Annulée par avoir' : `${fcfa(inv.remaining)} restent`, inv.status === 'payee' || inv.status === 'annulee'],
  ];
  const current = steps.findIndex((s) => !s[2]);
  return html`<ol class="track">${steps.map(
    ([label, detail, done], i) => html`<li class="${done ? 'done' : i === current ? 'current' : ''}"><b>${label}</b>${detail}</li>`,
  )}</ol>`;
}

function shareMessage(inv, publicUrl) {
  const s = inv.seller_snapshot;
  return `Bonjour ${inv.buyer_snapshot.name},\n\nVoici la facture ${inv.number} de ${s.business_name}, d’un montant de ${amount(inv.total_ttc)} FCFA, payable avant le ${longDate(inv.due_date)}.\n\n${publicUrl}\n\nMerci et bonne journée.`;
}

export const REMINDER_TONES = {
  amical: 'Amical',
  cordial: 'Cordial',
  ferme: 'Ferme',
  dernier_rappel: 'Dernier rappel',
};

export function suggestedTone(dueDate) {
  const days = Math.floor((Date.now() - new Date(`${isoDate(dueDate)}T00:00:00Z`).getTime()) / 86400000);
  if (days <= 7) return 'amical';
  if (days <= 21) return 'cordial';
  if (days <= 45) return 'ferme';
  return 'dernier_rappel';
}

export function invoiceShowPage({ user, inv, error, message, navCounts, publicUrl, features = {} }) {
  const simulated = inv.certification?.api_response?.simulation;
  const certified = Boolean(inv.certification);
  const isCredit = inv.kind === 'avoir';
  const canPay = !isCredit && inv.remaining > 0;
  const overdue = inv.display_status === 'en_retard';
  return appPage({
    title: inv.number,
    user,
    active: 'factures',
    counts: navCounts,
    content: html`
<a class="crumb no-print" href="/app/factures">← Factures</a>
<div class="page-head">
  <div><p class="eyebrow">${isCredit ? 'Facture d’avoir' : 'Facture'} · ${inv.buyer_snapshot.name}</p>
  <h1 class="mono" style="font-family:var(--mono);font-weight:500;letter-spacing:-0.02em">${inv.number}</h1></div>
  <div class="actions">
    ${statusTag(inv.display_status)}
    <a class="btn btn--ghost btn--small" href="/app/factures/${inv.id}/pdf" target="_blank">PDF</a>
    <button class="btn btn--ghost btn--small" type="button" data-print>Imprimer</button>
    ${!isCredit
      ? html`<form method="post" action="/app/factures/${inv.id}/dupliquer"><button class="btn btn--ghost btn--small">Dupliquer</button></form>`
      : ''}
    ${!isCredit && inv.status !== 'annulee' && inv.total_ttc - inv.credited > 0
      ? html`<form method="post" action="/app/factures/${inv.id}/avoir"><button class="btn btn--ghost btn--small">Créer un avoir</button></form>`
      : ''}
  </div>
</div>
${notice(error)}${notice(message, 'ok')}
${simulated ? html`<p class="sim-banner">Certification simulée (FNE_MODE=simulation) : numéro fictif, sans valeur fiscale.</p>` : ''}
${track(inv)}

<div class="doc-layout">
  ${invoiceSheet(toSheet(inv))}
  <aside>
    ${!certified
      ? html`<div class="side-box">
          <span class="eyebrow">Étape suivante</span>
          <h3>Certifier sur la FNE</h3>
          <ol class="small" style="padding-left:18px;margin:0 0 14px">
            <li>Ouvrez <a href="https://fne.dgi.gouv.ci" target="_blank" rel="noopener">fne.dgi.gouv.ci</a> et déclarez la facture ${inv.number} pour ${fcfa(inv.total_ttc)}.</li>
            <li>Reportez ici le numéro fiscal et la référence du QR code qui vous sont attribués.</li>
          </ol>
          ${features.autoCertify
            ? html`<form method="post" action="/app/factures/${inv.id}/certifier-auto" style="margin-bottom:16px">
                <button class="btn btn--accent" style="width:100%">Certifier automatiquement (API FNE)</button></form>
                <p class="small muted">Ou saisissez le numéro obtenu sur la plateforme :</p>`
            : ''}
          <form method="post" action="/app/factures/${inv.id}/certifier">
            <label class="field"><span>Numéro fiscal DGI</span><input name="fiscal_number" required autocomplete="off"></label>
            <label class="field"><span>Date de certification</span><input name="certified_at" type="date" required value="${isoDate(new Date())}"></label>
            <label class="field"><span>Référence du QR code <span class="muted">(facultatif)</span></span><input name="qr_reference" autocomplete="off"></label>
            <button class="btn btn--ok" style="width:100%;justify-content:center">Enregistrer la certification</button>
          </form>
          <p class="small muted" style="margin:12px 0 0">Tant que ce numéro n’est pas saisi, la facture ne peut pas être envoyée au client.</p>
        </div>`
      : html`<div class="side-box">
          <span class="eyebrow">Envoyer au client</span>
          <h3>${inv.sent_at ? `Envoyée le ${date(inv.sent_at)}` : 'Prête à partir'}</h3>
          <form method="post" action="/app/factures/${inv.id}/envoyer">
            <input type="hidden" name="channel" value="whatsapp">
            <label class="field"><span>Numéro WhatsApp du client</span>
              <input name="phone" type="tel" value="${inv.client.phone || ''}" placeholder="07 00 00 00 00"></label>
            <button class="btn btn--ok" style="width:100%;justify-content:center">Envoyer sur WhatsApp</button>
          </form>
          ${features.mail
            ? html`<form method="post" action="/app/factures/${inv.id}/email" style="margin-top:16px">
                <label class="field"><span>Email du client</span><input name="to" type="email" value="${inv.client.email || ''}" required></label>
                <button class="btn btn--ghost" style="width:100%">Envoyer par email, PDF joint</button>
              </form>
              <p class="small" style="margin:12px 0 0"><button type="button" class="link-btn" data-copy="${publicUrl}">Copier le lien</button></p>`
            : html`<p class="small" style="margin:12px 0 0">
                <a href="mailto:${inv.client.email || ''}?subject=${encodeURIComponent(`Facture ${inv.number}`)}&body=${encodeURIComponent(shareMessage(inv, publicUrl))}" data-mark-sent="/app/factures/${inv.id}/envoyer">Envoyer par email</a>
                · <button type="button" class="link-btn" data-copy="${publicUrl}">Copier le lien</button>
              </p>`}
        </div>`}

    ${canPay
      ? html`<div class="side-box">
          <span class="eyebrow">Encaisser</span>
          <h3>${fcfa(inv.remaining)} à recevoir</h3>
          <form method="post" action="/app/factures/${inv.id}/paiements">
            <div class="grid-2">
              <label class="field"><span>Montant</span><input name="amount" inputmode="numeric" required value="${inv.remaining}"></label>
              <label class="field"><span>Date</span><input name="payment_date" type="date" required value="${isoDate(new Date())}"></label>
            </div>
            <label class="field"><span>Moyen</span><select name="method">${options(METHOD_LABELS, 'wave')}</select></label>
            <label class="field"><span>Référence <span class="muted">(n° de transaction)</span></span><input name="reference" autocomplete="off"></label>
            <button class="btn" style="width:100%;justify-content:center">Enregistrer le paiement</button>
          </form>
        </div>`
      : ''}

    ${overdue && certified
      ? html`<div class="side-box">
          <span class="eyebrow">Relancer</span>
          <h3>Échue depuis le ${date(inv.due_date)}</h3>
          <form method="post" action="/app/factures/${inv.id}/relance">
            <label class="field"><span>Ton</span><select name="tone">${options(REMINDER_TONES, suggestedTone(inv.due_date))}</select></label>
            <input type="hidden" name="phone" value="${inv.client.phone || ''}">
            <button class="btn btn--ghost" style="width:100%;justify-content:center">Relancer avec le modèle standard</button>
            ${features.ai ? html`<button class="btn btn--accent" style="width:100%;margin-top:10px" formaction="/app/factures/${inv.id}/relance-ia">Faire rédiger par l’IA, puis relire</button>` : ''}
          </form>
          ${inv.reminders.length ? html`<p class="small muted" style="margin:10px 0 0">${inv.reminders.length} relance${inv.reminders.length > 1 ? 's' : ''}, la dernière le ${date(inv.reminders[0].sent_at)}.</p>` : ''}
        </div>`
      : ''}

    ${inv.payments.length || inv.credit_notes.length || isCredit
      ? html`<div class="side-box">
          <span class="eyebrow">Historique</span>
          <ul class="checks">
            ${isCredit ? html`<li class="ok">Avoir sur <a href="/app/factures/${inv.ref_invoice_id}">${inv.ref_number}</a></li>` : ''}
            ${inv.payments.map((p) => html`<li class="ok"><span class="num">${fcfa(p.amount)}</span> · ${METHOD_LABELS[p.method]} · ${date(p.payment_date)}${p.reference ? html`<br><span class="muted small">Réf. ${p.reference}</span>` : ''}</li>`)}
            ${inv.credit_notes.map((c) => html`<li class="${c.status === 'brouillon' ? 'avertissement' : 'ok'}"><a href="/app/factures/${c.id}">${c.number || 'Avoir en brouillon'}</a> · <span class="num">−${fcfa(c.total_ttc)}</span></li>`)}
          </ul>
        </div>`
      : ''}
  </aside>
</div>`,
  });
}

export function publicInvoicePage({ inv }) {
  return plainPage({
    title: `Facture ${inv.number} · ${inv.seller_snapshot.business_name}`,
    content: html`<main class="wrap" style="max-width:860px;padding-top:32px;padding-bottom:48px">
  <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px;flex-wrap:wrap">
    <span class="small muted">Document transmis par ${inv.seller_snapshot.business_name}</span>
    <button class="btn btn--small" type="button" data-print>Imprimer ou enregistrer en PDF</button>
  </div>
  ${invoiceSheet(toSheet(inv))}
  <p class="small muted no-print" style="margin-top:18px;display:flex;gap:8px;align-items:center">Facture éditée avec ${wordmark()}</p>
</main>
<script src="/js/words.js" defer></script>
<script src="/js/app.js" defer></script>`,
  });
}

// Devis partagé avec le client (lien /d/:id). Les totaux sont calculés à partir des lignes
// avec le taux de TVA actuel du profil : un devis n'est pas un document figé.
export function publicQuotePage({ quote }) {
  const seller = quote.seller;
  const vatOn = seller.vat_applicable;
  const ht = quote.items.reduce((sum, it) => sum + Math.round(Number(it.qty) * it.unit_price), 0);
  const taxable = quote.items.filter((it) => it.vat_applicable).reduce((sum, it) => sum + Math.round(Number(it.qty) * it.unit_price), 0);
  const vat = vatOn ? Math.round((taxable * Number(seller.vat_rate)) / 100) : 0;
  const doc = {
    kind: 'devis', number: quote.number, issue_date: quote.issue_date, valid_until: quote.valid_until,
    seller, buyer: quote.client, items: quote.items, vat_applicable: vatOn, vat_rate: seller.vat_rate,
    total_ht: ht, total_vat: vat, total_ttc: ht + vat, notes: quote.notes,
  };
  return plainPage({
    title: `Devis ${quote.number} · ${seller.business_name}`,
    content: html`<main class="wrap" style="max-width:860px;padding-top:32px;padding-bottom:48px">
  <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px;flex-wrap:wrap">
    <span class="small muted">Devis transmis par ${seller.business_name}</span>
    <button class="btn btn--small" type="button" data-print>Imprimer ou enregistrer en PDF</button>
  </div>
  ${invoiceSheet(doc, { showStamp: false })}
  <p class="small muted no-print" style="margin-top:18px;display:flex;gap:8px;align-items:center">Devis édité avec ${wordmark()}</p>
</main>
<script src="/js/words.js" defer></script>
<script src="/js/app.js" defer></script>`,
  });
}

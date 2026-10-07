import { html, raw, amount, fcfa, date, isoDate, options, statusTag, METHOD_LABELS, QUOTE_STATUS_LABELS, REGIME_LABELS } from '../html.js';
import { appPage, notice } from './layout.js';
import { linesEditor, REMINDER_TONES } from './invoices.js';
import { clientHistory } from './extra.js';

// --- Clients ---------------------------------------------------------------------

export function clientListPage({ user, clients, navCounts, message, error }) {
  return appPage({
    title: 'Clients',
    user,
    active: 'clients',
    counts: navCounts,
    content: html`
<div class="page-head">
  <div><p class="eyebrow">${clients.length} client${clients.length > 1 ? 's' : ''}</p><h1>Clients</h1></div>
  <div class="actions"><a class="btn btn--accent" href="/app/clients/nouveau">Nouveau client</a></div>
</div>
${notice(error)}${notice(message, 'ok')}
${clients.length === 0
  ? html`<p class="empty">Aucun client. Un client se crée en trente secondes : un nom, une adresse, et son NCC si c’est une entreprise.</p>`
  : html`<div class="table-scroll"><table class="ledger">
  <thead><tr><th>Nom</th><th>Type</th><th>Contact</th><th class="r">Factures</th><th class="r">Délai moyen</th><th class="r">Reste dû</th></tr></thead>
  <tbody>${clients.map(
    (c) => html`<tr>
      <td><a class="row-link" href="/app/clients/${c.id}">${c.name}</a>${c.type === 'entreprise' && !c.ncc ? html`<br><span class="tag tag--en_retard">NCC manquant</span>` : ''}</td>
      <td>${c.type === 'entreprise' ? 'Entreprise' : 'Particulier'}</td>
      <td class="small">${c.phone || ''}${c.phone && c.email ? html`<br>` : ''}${c.email || ''}</td>
      <td class="r num">${c.invoices}</td>
      <td class="r num">${c.avg_delay_days == null ? '—' : Number(c.avg_delay_days) <= 0 ? 'à l’heure' : `+${Math.round(c.avg_delay_days)} j`}</td>
      <td class="r num">${c.remaining > 0 ? amount(c.remaining) : '—'}</td>
    </tr>`,
  )}</tbody></table></div>`}`,
  });
}

export function clientFormPage({ user, client, error, navCounts, back }) {
  const c = client || { type: 'particulier' };
  return appPage({
    title: c.id ? c.name : 'Nouveau client',
    user,
    active: 'clients',
    counts: navCounts,
    content: html`
<a class="crumb" href="/app/clients">← Clients</a>
<div class="page-head"><div><p class="eyebrow">Fiche client</p><h1>${c.id ? c.name : 'Nouveau client'}</h1></div>
  ${c.id ? html`<div class="actions"><a class="btn btn--accent" href="/app/factures/nouvelle?client=${c.id}">Facturer ce client</a></div>` : ''}
</div>
${notice(error)}
${clientHistory(c)}
${c.summary ? html`<div class="panel-title"><h2>Coordonnées</h2></div>` : ''}
<form method="post" action="${c.id ? `/app/clients/${c.id}` : '/app/clients'}" style="max-width:640px">
  <input type="hidden" name="retour" value="${back || ''}">
  <div class="field"><span class="label">Type de client</span>
    <div class="segmented" data-client-type>
      <label><input type="radio" name="type" value="particulier" ${c.type === 'particulier' ? raw('checked') : ''}>Particulier</label>
      <label><input type="radio" name="type" value="entreprise" ${c.type === 'entreprise' ? raw('checked') : ''}>Entreprise</label>
    </div>
  </div>
  <label class="field"><span>Nom ou raison sociale</span><input name="name" required value="${c.name || ''}"></label>
  <label class="field" data-ncc-field><span>NCC du client</span><input name="ncc" value="${c.ncc || ''}" autocomplete="off">
    <small>Obligatoire pour facturer une entreprise.</small></label>
  <label class="field"><span>Adresse</span><input name="address" value="${c.address || ''}" placeholder="Quartier, commune, ville">
    <small>Exigée sur la facture.</small></label>
  <div class="grid-2">
    <label class="field"><span>Téléphone (WhatsApp)</span><input name="phone" type="tel" value="${c.phone || ''}"></label>
    <label class="field"><span>Email</span><input name="email" type="email" value="${c.email || ''}"></label>
  </div>
  <label class="field"><span>Notes internes</span><textarea name="notes" rows="2">${c.notes || ''}</textarea></label>
  <button class="btn" type="submit">${c.id ? 'Enregistrer' : 'Créer le client'}</button>
</form>
${c.id
  ? html`<form method="post" action="/app/clients/${c.id}/supprimer" style="margin-top:28px" data-confirm="Supprimer ce client ?">
      <button class="link-btn link-btn--danger small">Supprimer ce client</button>
      <span class="small muted"> — impossible dès qu’une facture lui a été émise.</span></form>`
  : ''}`,
  });
}

// --- Devis -------------------------------------------------------------------------

export function quoteListPage({ user, quotes, navCounts, message }) {
  return appPage({
    title: 'Devis',
    user,
    active: 'devis',
    counts: navCounts,
    content: html`
<div class="page-head">
  <div><p class="eyebrow">Factures proforma</p><h1>Devis</h1></div>
  <div class="actions"><a class="btn btn--accent" href="/app/devis/nouveau">Nouveau devis</a></div>
</div>
${notice(message, 'ok')}
${quotes.length === 0
  ? html`<p class="empty">Aucun devis. Un devis accepté se transforme en brouillon de facture en un clic.</p>`
  : html`<div class="table-scroll"><table class="ledger">
  <thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th>Valable jusqu’au</th><th>État</th><th class="r">HT</th></tr></thead>
  <tbody>${quotes.map(
    (q) => html`<tr>
      <td><a class="row-link mono" href="/app/devis/${q.id}">${q.number}</a></td>
      <td>${q.client_name}</td><td class="tnum">${date(q.issue_date)}</td><td class="tnum">${date(q.valid_until)}</td>
      <td><span class="tag tag--${q.status}">${QUOTE_STATUS_LABELS[q.status]}</span>${q.invoice_id ? html` <a class="small" href="/app/factures/${q.invoice_id}">→ facture</a>` : ''}</td>
      <td class="r num">${amount(q.total_ht)}</td>
    </tr>`,
  )}</tbody></table></div>`}`,
  });
}

export function quoteFormPage({ user, quote, clients, error, navCounts }) {
  const q = quote || { items: [], status: 'brouillon' };
  const editable = ['brouillon', 'envoye'].includes(q.status);
  const vatRate = user.profile?.vat_rate ?? 18;
  const in30 = new Date(Date.now() + 30 * 86400000);
  return appPage({
    title: q.number || 'Nouveau devis',
    user,
    active: 'devis',
    counts: navCounts,
    content: html`
<a class="crumb" href="/app/devis">← Devis</a>
<div class="page-head">
  <div><p class="eyebrow">Devis ${q.number ? html`<span class="mono">${q.number}</span>` : ''} · non numéroté fiscalement</p>
  <h1>${q.id ? q.client.name : 'Nouveau devis'}</h1></div>
  ${q.id
    ? html`<div class="actions">
        <span class="tag tag--${q.status}">${QUOTE_STATUS_LABELS[q.status]}</span>
        ${q.status !== 'brouillon' ? html`<a class="btn btn--ghost btn--small" href="/d/${q.id}" target="_blank">Version client</a>` : ''}
        ${['brouillon', 'envoye'].includes(q.status)
          ? html`<form method="post" action="/app/devis/${q.id}/envoyer"><input type="hidden" name="phone" value="${q.client.phone || ''}">
              <button class="btn btn--ghost btn--small">${q.status === 'brouillon' ? 'Envoyer sur WhatsApp' : 'Renvoyer sur WhatsApp'}</button></form>`
          : ''}
        ${q.invoice_id
          ? html`<a class="btn btn--small" href="/app/factures/${q.invoice_id}">Voir la facture</a>`
          : ['refuse', 'expire'].includes(q.status)
            ? ''
            : html`<form method="post" action="/app/devis/${q.id}/convertir"><button class="btn btn--accent btn--small">Convertir en facture</button></form>`}
      </div>`
    : ''}
</div>
${notice(error)}
${clients.length === 0
  ? html`<div class="notice notice--warn"><p>Ajoutez d’abord un client : <a href="/app/clients/nouveau">créer un client</a>.</p></div>`
  : html`<form method="post" action="${q.id ? `/app/devis/${q.id}` : '/app/devis'}" class="doc-layout" data-invoice-form>
  <fieldset style="border:0;padding:0;margin:0;min-width:0" ${editable ? '' : raw('disabled')}>
    <div class="grid-3">
      <label class="field" style="grid-column: span 2"><span>Client</span>
        <select name="client_id" required><option value="">Choisir…</option>
          ${clients.map((c) => html`<option value="${c.id}" ${c.id === q.client_id ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
      <label class="field"><span>Valable jusqu’au</span><input type="date" name="valid_until" value="${isoDate(q.valid_until || in30)}"></label>
    </div>
    ${linesEditor(q.items, { vatApplicable: user.profile?.vat_applicable, vatRate })}
    <label class="field" style="margin-top:24px"><span>Conditions, remarques</span><textarea name="notes" rows="2">${q.notes || ''}</textarea></label>
  </fieldset>
  <aside>
    <div class="side-box">
      ${editable ? html`<button class="btn" type="submit" style="width:100%;justify-content:center">Enregistrer le devis</button>` : html`<p class="small muted" style="margin:0">Ce devis n’est plus modifiable.</p>`}
      <p class="small muted" style="margin:12px 0 0">Le devis vaut facture proforma. Il n’entre pas dans la numérotation fiscale ; c’est la facture issue de sa conversion qui sera certifiée.</p>
    </div>
  </aside>
</form>
${q.id && editable
  ? html`<div class="side-box" style="max-width:640px"><span class="eyebrow">Suivi</span>
      <form method="post" action="/app/devis/${q.id}/statut" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="field" style="margin:0;flex:1"><span>Marquer comme</span><select name="status">${options({ envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré' }, q.status)}</select></label>
        <button class="btn btn--ghost">Mettre à jour</button>
      </form></div>`
  : ''}`}`,
  });
}

// --- Paiements ------------------------------------------------------------------------

export function paymentsPage({ user, payments, open, navCounts }) {
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const waiting = open.reduce((s, o) => s + o.remaining, 0);
  return appPage({
    title: 'Paiements',
    user,
    active: 'paiements',
    counts: navCounts,
    content: html`
<div class="page-head"><div><p class="eyebrow">Encaissements</p><h1>Paiements</h1></div></div>
<div class="figures" style="grid-template-columns:repeat(2,minmax(0,1fr))">
  <div class="figure"><span class="eyebrow">Encaissé, depuis le début</span><div class="value">${amount(total)}<small>FCFA</small></div></div>
  <div class="figure"><span class="eyebrow">En attente</span><div class="value">${amount(waiting)}<small>FCFA</small></div><div class="sub">${open.length} facture${open.length > 1 ? 's' : ''} ouverte${open.length > 1 ? 's' : ''}</div></div>
</div>
<div class="cols">
  <section>
    <div class="panel-title"><h2>Reçus</h2></div>
    ${payments.length === 0
      ? html`<p class="empty">Aucun paiement enregistré. Notez-les depuis la page de chaque facture.</p>`
      : html`<div class="table-scroll"><table class="ledger"><thead><tr><th>Date</th><th>Facture</th><th>Moyen</th><th class="r">Montant</th></tr></thead>
        <tbody>${payments.map((p) => html`<tr><td class="tnum">${date(p.payment_date)}</td>
          <td><a class="row-link mono" href="/app/factures/${p.invoice_id}">${p.number}</a><br><span class="small muted">${p.client_name}</span></td>
          <td>${METHOD_LABELS[p.method]}${p.reference ? html`<br><span class="small muted">${p.reference}</span>` : ''}</td>
          <td class="r num">${amount(p.amount)}</td></tr>`)}</tbody></table></div>`}
  </section>
  <section>
    <div class="panel-title"><h2>En attente</h2></div>
    ${open.length === 0
      ? html`<p class="empty">Tout est encaissé.</p>`
      : html`<ul class="todo">${open.map(
          (o) => html`<li><a href="/app/factures/${o.id}"><b class="mono">${o.number}</b> · ${o.client_name}</a>
            <span class="num">${amount(o.remaining)}</span>
            <span class="why">${statusTag(o.display_status)} · échéance ${date(o.due_date)}</span></li>`,
        )}</ul>`}
  </section>
</div>`,
  });
}

// --- Paramètres / onboarding ---------------------------------------------------------

export function settingsPage({ user, error, message, navCounts, onboarding, usage, account = {} }) {
  const p = user.profile || {};
  const v = (k, d = '') => (p[k] ?? d);
  return appPage({
    title: onboarding ? 'Votre identité légale' : 'Paramètres',
    user,
    active: 'parametres',
    counts: navCounts,
    content: html`
<div class="page-head">
  <div><p class="eyebrow">${onboarding ? 'Étape 1 sur 3 · avant votre première facture' : 'Paramètres'}</p>
  <h1>${onboarding ? 'Qui facture ?' : 'Identité et réglages'}</h1></div>
</div>
${onboarding ? html`<p style="max-width:44em;color:var(--ink-2);margin-bottom:28px">Ces informations apparaissent sur chacune de vos factures et sont recopiées au moment de l’émission. Le NCC et l’adresse sont indispensables ; le reste peut attendre, FreeFact vous le rappellera.</p>` : ''}
${notice(error)}${notice(message, 'ok')}
<form method="post" action="/app/parametres" class="doc-layout" data-settings>
  <div>
    <h2 style="font-size:26px;margin:0 0 16px">Identité légale</h2>
    <div class="grid-2">
      <label class="field"><span>Nom commercial ou raison sociale</span><input name="business_name" required value="${v('business_name', user.fullname)}"></label>
      <label class="field"><span>Forme juridique</span><input name="legal_form" value="${v('legal_form')}" placeholder="Entreprise individuelle, SARL…"></label>
      <label class="field"><span>NCC</span><input name="ncc" value="${v('ncc')}" autocomplete="off"><small>Numéro de compte contribuable, sur la déclaration d’existence.</small></label>
      <label class="field"><span>RCCM <span class="muted">(si immatriculé)</span></span><input name="rccm" value="${v('rccm')}" autocomplete="off"></label>
      <label class="field"><span>Régime d’imposition</span>
        <select name="tax_regime" data-regime><option value="">À préciser</option>${options(REGIME_LABELS, p.tax_regime)}</select></label>
      <label class="field"><span>Centre des impôts</span><input name="tax_center" value="${v('tax_center')}" placeholder="Ex. Cocody, Plateau, Yopougon…"></label>
      <label class="field"><span>Adresse</span><input name="address" value="${v('address')}" placeholder="Rue, quartier, commune"></label>
      <label class="field"><span>Ville</span><input name="city" value="${v('city', 'Abidjan')}"></label>
      <label class="field"><span>Téléphone professionnel</span><input name="phone" type="tel" value="${v('phone', user.phone || '')}"></label>
      <label class="field"><span>Email professionnel</span><input name="email_pro" type="email" value="${v('email_pro', user.email)}"></label>
      <label class="field"><span>Capital social <span class="muted">(FCFA, si société)</span></span><input name="capital" inputmode="numeric" value="${v('capital')}"></label>
    </div>
    <label class="check"><input type="checkbox" name="fne_registered" value="1" ${p.fne_registered ? raw('checked') : ''}>
      <span>Je suis inscrit sur la plateforme FNE de la DGI.</span></label>

    <h2 style="font-size:26px;margin:32px 0 16px">TVA</h2>
    <label class="check"><input type="checkbox" name="vat_applicable" value="1" data-vat-applicable ${p.vat_applicable ? raw('checked') : ''}>
      <span>Je facture la TVA <span class="small muted" data-vat-hint></span></span></label>
    <div class="grid-2">
      <label class="field"><span>Taux de TVA (%)</span><input name="vat_rate" inputmode="decimal" value="${v('vat_rate', 18)}"></label>
    </div>

    <h2 style="font-size:26px;margin:32px 0 16px">Factures</h2>
    <div class="grid-3">
      <label class="field"><span>Préfixe factures</span><input name="invoice_prefix" value="${v('invoice_prefix', 'FA')}" maxlength="8"></label>
      <label class="field"><span>Préfixe avoirs</span><input name="credit_note_prefix" value="${v('credit_note_prefix', 'AV')}" maxlength="8"></label>
      <label class="field"><span>Préfixe devis</span><input name="quote_prefix" value="${v('quote_prefix', 'DV')}" maxlength="8"></label>
    </div>
    <div class="grid-2">
      <label class="field"><span>Délai de paiement par défaut (jours)</span><input name="default_terms_days" inputmode="numeric" value="${v('default_terms_days', 30)}"></label>
    </div>
    <label class="field"><span>Coordonnées de paiement</span><input name="payment_info" value="${v('payment_info')}" placeholder="Wave : 07…, Orange Money : 07…, IBAN…"></label>
    <label class="field"><span>Mention de pénalités de retard</span><input name="late_penalty_text" value="${v('late_penalty_text')}" placeholder="Tout retard de paiement peut donner lieu à des pénalités de retard.">
      <small>FreeFact n’invente aucun taux : écrivez celui que vous appliquez, ou gardez la mention générale.</small></label>
    <label class="field"><span>Signature ou mention de fin</span><input name="signature_text" value="${v('signature_text')}"></label>
  </div>
  <aside>
    <div class="side-box">
      <button class="btn btn--accent" type="submit" style="width:100%;justify-content:center">${onboarding ? 'Enregistrer et continuer' : 'Enregistrer'}</button>
      <p class="small muted" style="margin:12px 0 0">Les factures déjà émises gardent les informations du jour de leur émission.</p>
    </div>
    ${onboarding
      ? ''
      : html`<div class="side-box">
          <span class="eyebrow">Abonnement</span>
          <h3>Plan ${user.plan}</h3>
          <p class="small">Actions IA ce mois : <b class="num">${usage.used}${usage.quota == null ? '' : ` / ${usage.quota}`}</b></p>
          <a class="btn btn--ghost btn--small" href="/app/abonnement">Gérer l’abonnement</a>
        </div>
        <div class="side-box">
          <span class="eyebrow">Sauvegarde</span>
          <p class="small">Exportez tout votre compte en JSON : clients, factures, certifications, paiements. Gardez vos factures 10 ans.</p>
          <a class="btn btn--ghost btn--small" href="/app/export.json">Télécharger la sauvegarde</a>
        </div>`}
  </aside>
</form>
${onboarding ? '' : accountSections(user, account)}`,
  });
}

// --- Conformité ------------------------------------------------------------------------

export function compliancePage({ user, navCounts, stats }) {
  const p = user.profile || {};
  const checks = [
    ['Nom ou raison sociale', Boolean(p.business_name), true],
    ['NCC', Boolean(p.ncc), true],
    ['Adresse', Boolean(p.address), true],
    ['Régime d’imposition', Boolean(p.tax_regime), false],
    ['Centre des impôts', Boolean(p.tax_center), false],
    ['Forme juridique', Boolean(p.legal_form), false],
    ['Inscription à la plateforme FNE', Boolean(p.fne_registered), false],
    ['TVA cohérente avec le régime', !p.tax_regime || p.vat_applicable === ['RNI', 'RSI'].includes(p.tax_regime), false],
    ['Coordonnées de paiement', Boolean(p.payment_info), false],
  ];
  const score = Math.round((checks.filter((c) => c[1]).length / checks.length) * 100);
  return appPage({
    title: 'Conformité',
    user,
    active: 'conformite',
    counts: navCounts,
    content: html`
<div class="page-head"><div><p class="eyebrow">Dossier légal et FNE</p><h1>Conformité</h1></div>
  <div class="actions"><a class="btn btn--ghost" href="/app/parametres">Compléter mon identité</a></div></div>
<div class="cols">
  <section>
    <div class="score">${score}<small> / 100</small></div>
    <div class="bar"><i style="width:${score}%"></i></div>
    <p class="small muted">Complétude de votre dossier légal.</p>
    <ul class="checks" style="margin-top:20px">
      ${checks.map(([label, ok, blocking]) => html`<li class="${ok ? 'ok' : blocking ? 'bloquant' : 'avertissement'}">${label}${!ok && blocking ? html` <span class="small muted">— bloque l’émission</span>` : ''}</li>`)}
    </ul>
    <div class="panel-title" style="margin-top:36px"><h2>Vos documents</h2></div>
    <table class="ledger"><tbody>
      <tr><td>Factures émises</td><td class="r num">${stats.emitted}</td></tr>
      <tr><td>Certifiées FNE</td><td class="r num">${stats.certified}</td></tr>
      <tr><td>En attente de certification</td><td class="r num">${stats.to_certify}</td></tr>
      <tr><td>Envoyées sans certification</td><td class="r num">0 <span class="small muted">— impossible par construction</span></td></tr>
    </tbody></table>
  </section>
  <section>
    <div class="side-box">
      <span class="eyebrow">Guide FNE</span>
      <h3>Certifier une facture, pas à pas</h3>
      <ol class="small" style="padding-left:18px">
        <li>Émettez la facture dans FreeFact : elle reçoit son numéro et devient non modifiable.</li>
        <li>Sur <a href="https://fne.dgi.gouv.ci" target="_blank" rel="noopener">fne.dgi.gouv.ci</a> (web ou application mobile), déclarez-la avec les mêmes montants.</li>
        <li>La DGI attribue un numéro fiscal, un cachet et un QR code.</li>
        <li>Reportez le numéro fiscal dans FreeFact : l’envoi au client se débloque.</li>
      </ol>
      <p class="small muted">La certification automatique par API demande l’autorisation du Directeur général des impôts ; FreeFact la prépare.</p>
    </div>
    <div class="side-box">
      <span class="eyebrow">Ce que FreeFact garantit</span>
      <ul class="checks">
        <li class="ok">Numérotation continue par année, sans trou</li>
        <li class="ok">Facture figée après émission, correction par avoir</li>
        <li class="ok">Vendeur, client et TVA photographiés à l’émission</li>
        <li class="ok">Envoi impossible avant certification</li>
        <li class="ok">Documents émis non supprimables</li>
      </ul>
      <p class="small muted" style="margin:10px 0 0">FreeFact est un outil de gestion : il ne remplace ni la DGI ni votre expert-comptable.</p>
    </div>
  </section>
</div>`,
  });
}

export { REMINDER_TONES };

// Sections hors du formulaire principal : logo, notifications, sécurité.
function accountSections(user, a) {
  return html`<div class="settings-more">
  <section id="logo">
    <h2>Logo sur vos factures</h2>
    ${a.canLogo
      ? html`<div class="logo-row">
          ${user.profile?.logo_url ? html`<img class="logo-preview" src="${user.profile.logo_url}" alt="Logo actuel">` : html`<p class="muted small">Aucun logo pour l’instant.</p>`}
          <div>
            <label class="btn btn--ghost btn--small" for="logo-file">${user.profile?.logo_url ? 'Remplacer le logo' : 'Ajouter un logo'}</label>
            <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden data-logo-upload>
            ${user.profile?.logo_url ? html`<form method="post" action="/app/parametres/logo/supprimer" style="display:inline"><button class="link-btn small link-btn--danger">Retirer</button></form>` : ''}
            <p class="small muted" data-logo-status>PNG, JPEG, WebP ou SVG, 300 Ko au plus. Il apparaît sur les factures émises à partir de maintenant.</p>
          </div>
        </div>`
      : html`<p class="small">Le logo est disponible à partir du plan Pro. <a href="/app/abonnement">Voir les plans</a></p>`}
  </section>
  <section id="notifications">
    <h2>Notifications</h2>
    <form method="post" action="/app/parametres/notifications">
      <label class="check"><input type="checkbox" name="notify_email" value="1" ${a.notifyEmail ? html`checked` : ''}>
        <span>Recevoir un récapitulatif par email, au plus une fois par jour, quand une facture est à certifier, en retard ou proche de l’échéance.</span></label>
      <button class="btn btn--ghost btn--small">Enregistrer</button>
    </form>
  </section>
  <section id="securite">
    <h2>Sécurité</h2>
    <p class="small">Compte : <b>${user.email}</b> · ${user.email_verified_at ? 'adresse confirmée' : 'adresse non confirmée'}${a.google ? ' · connexion Google active' : ''}</p>
    <form method="post" action="/app/parametres/mot-de-passe" class="grid-2" style="max-width:640px">
      ${a.hasPassword
        ? html`<label class="field"><span>Mot de passe actuel</span><input name="current" type="password" autocomplete="current-password" required></label>`
        : html`<p class="small muted" style="grid-column:1/-1">Vous vous connectez avec Google ; vous pouvez aussi définir un mot de passe.</p>`}
      <label class="field"><span>Nouveau mot de passe</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div><button class="btn btn--ghost btn--small">Changer le mot de passe</button></div>
    </form>
  </section>
</div>`;
}

import { html, amount, fcfa, date, longDate, statusTag, options, METHOD_LABELS, QUOTE_STATUS_LABELS } from '../html.js';
import { appPage, notice } from './layout.js';
import { REMINDER_TONES } from './invoices.js';

const PLAN_NAMES = { gratuit: 'Gratuit', pro: 'Pro', business: 'Business' };
const PLAN_PRICES = { gratuit: 0, pro: 2000, business: 5000 };

// Bloc « réservé au plan … » : explique ce que la fonction apporte et mène à l'abonnement.
export function upsell({ user, navCounts, active, title, plan, pitch, points }) {
  return appPage({
    title,
    user,
    active,
    counts: navCounts,
    content: html`<div class="page-head"><div><p class="eyebrow">Plan ${PLAN_NAMES[plan]}</p><h1>${title}</h1></div></div>
      <div class="upsell">
        <p class="lp-lede">${pitch}</p>
        <ul class="checks">${points.map((p) => html`<li class="ok">${p}</li>`)}</ul>
        <p><a class="btn btn--accent" href="/app/abonnement">Passer au plan ${PLAN_NAMES[plan]} · ${amount(PLAN_PRICES[plan])} FCFA / mois</a></p>
      </div>`,
  });
}

// --- Notifications ----------------------------------------------------------------------------

const NOTIF = {
  a_certifier: ['À certifier', 'a_certifier', (n) => `Émise le ${date(n.issue_date)}. Déclarez-la sur la FNE pour débloquer l’envoi.`],
  en_retard: ['En retard', 'en_retard', (n) => `Échue depuis ${n.days_late} jour${n.days_late > 1 ? 's' : ''} (${date(n.due_date)}). ${fcfa(n.remaining)} restent à payer.`],
  echeance: ['Échéance proche', 'emise', (n) => `Échéance le ${longDate(n.due_date)}. ${fcfa(n.remaining)} attendus.`],
};

export function notificationsPage({ user, items, navCounts, notifyEmail }) {
  const groups = Object.keys(NOTIF).map((k) => [k, items.filter((i) => i.type === k)]).filter(([, l]) => l.length);
  return appPage({
    title: 'Notifications',
    user,
    active: 'notifications',
    counts: navCounts,
    content: html`<div class="page-head"><div><p class="eyebrow">${items.length} élément${items.length > 1 ? 's' : ''} à traiter</p><h1>Notifications</h1></div>
      <div class="actions"><a class="btn btn--ghost btn--small" href="/app/parametres#notifications">Email quotidien : ${notifyEmail ? 'activé' : 'désactivé'}</a></div></div>
    ${groups.length === 0
      ? html`<p class="empty">Rien à signaler : aucune facture à certifier, en retard ou proche de l’échéance.</p>`
      : groups.map(([k, list]) => html`<section style="margin-bottom:32px">
          <div class="panel-title"><h2>${NOTIF[k][0]}</h2><span class="tag tag--${NOTIF[k][1]}">${list.length}</span></div>
          <ul class="todo">${list.map((n) => html`<li><a href="/app/factures/${n.id}"><b class="mono">${n.number}</b> · ${n.client_name}</a>
            <span class="num">${amount(k === 'a_certifier' ? n.total_ttc : n.remaining)}</span>
            <span class="why">${NOTIF[k][2](n)}</span></li>`)}</ul>
        </section>`)}`,
  });
}

// --- Abonnement -------------------------------------------------------------------------------------

const meter = (label, used, limit) => html`<div class="meter">
  <div class="meter-head"><span>${label}</span><span class="num">${used}${limit == null ? '' : ` / ${limit}`}</span></div>
  ${limit == null ? html`<div class="muted small">Illimité</div>` : html`<div class="bar"><i style="width:${Math.min(100, Math.round((used / limit) * 100))}%"></i></div>`}
</div>`;

export function subscriptionPage({ user, usage, history, navCounts, message, error, simulated }) {
  const plans = [
    ['gratuit', 'Pour démarrer', ['5 factures par mois', '20 clients', '5 actions IA par mois', 'Certification FNE guidée']],
    ['pro', 'Pour le freelance qui facture chaque semaine', ['Factures et clients illimités', 'Logo sur vos factures', '50 actions IA par mois', 'Certification FNE guidée']],
    ['business', 'Pour la petite entreprise', ['Tout Pro, IA sans limite', 'Relances IA en lot', 'Export Excel (CSV)', 'Statistiques avancées', 'Certification FNE par API (après agrément)']],
  ];
  return appPage({
    title: 'Abonnement',
    user,
    active: 'abonnement',
    counts: navCounts,
    content: html`<div class="page-head"><div><p class="eyebrow">Plan actuel</p><h1>${PLAN_NAMES[user.plan]}</h1></div></div>
    ${notice(error)}${notice(message, 'ok')}
    ${simulated ? html`<div class="notice notice--warn"><p><b>Paiement simulé.</b> L’agrégateur Mobile Money n’est pas encore branché : le changement de plan est appliqué sans débit, comme prévu dans le prototype.</p></div>` : ''}
    <section class="meters">
      ${meter('Factures créées ce mois', usage.invoices_month, usage.invoices_per_month)}
      ${meter('Clients', usage.clients_count, usage.clients)}
      ${meter('Actions IA ce mois', usage.ai_month, usage.ai_actions_per_month)}
    </section>
    <div class="plans" style="margin-top:32px">
      ${plans.map(([key, pitch, points]) => html`<form class="plan ${key === user.plan ? 'plan--focus' : ''}" method="post" action="/app/abonnement">
        <p class="eyebrow">${PLAN_NAMES[key]} ${key === user.plan ? html`<span class="plan-flag">Votre plan</span>` : ''}</p>
        <div class="price">${amount(PLAN_PRICES[key])} <small>FCFA / mois</small></div>
        <p class="muted small">${pitch}</p>
        <ul>${points.map((p) => html`<li>${p}</li>`)}</ul>
        <input type="hidden" name="plan" value="${key}">
        ${key === user.plan
          ? html`<button class="btn btn--ghost" type="button" disabled data-keep-disabled="1">Plan actuel</button>`
          : html`${PLAN_PRICES[key] > 0
              ? html`<label class="field"><span>Payer avec</span><select name="method">${options({ wave: 'Wave', orange_money: 'Orange Money', mtn_money: 'MTN Money', moov_money: 'Moov Money' }, 'wave')}</select></label>`
              : ''}
            <button class="btn ${PLAN_PRICES[key] > PLAN_PRICES[user.plan] ? 'btn--accent' : 'btn--ghost'}" type="submit">${PLAN_PRICES[key] > PLAN_PRICES[user.plan] ? `Passer au plan ${PLAN_NAMES[key]}` : `Revenir au plan ${PLAN_NAMES[key]}`}</button>`}
      </form>`)}
    </div>
    <p class="small muted" style="margin-top:14px">Un retour au plan gratuit ne supprime rien : les factures et clients existants restent accessibles, seuls les nouveaux ajouts sont limités.</p>
    ${history.length
      ? html`<div class="panel-title" style="margin-top:36px"><h2>Historique</h2></div>
        <table class="ledger"><thead><tr><th>Date</th><th>Changement</th><th>Paiement</th><th class="r">Montant</th></tr></thead><tbody>
        ${history.map((h) => html`<tr><td class="tnum">${date(h.at)}</td><td>${PLAN_NAMES[h.from_plan]} → ${PLAN_NAMES[h.to_plan]}</td>
          <td>${h.method ? METHOD_LABELS[h.method] || h.method : '—'}${h.simulated ? html` <span class="muted small">(simulé)</span>` : ''}</td><td class="r num">${amount(h.amount)}</td></tr>`)}
        </tbody></table>`
      : ''}`,
  });
}

// --- Statistiques avancées ------------------------------------------------------------------------------

const monthLabel = (m) => new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${m}T00:00:00Z`));

export function statsPage({ user, stats, navCounts, exports }) {
  const { byClient, months, methods, kpi } = stats;
  const totalBilled = byClient.reduce((s, c) => s + c.billed, 0) || 1;
  const totalCash = methods.reduce((s, m) => s + m.total, 0) || 1;
  return appPage({
    title: 'Statistiques',
    user,
    active: 'statistiques',
    counts: navCounts,
    content: html`<div class="page-head"><div><p class="eyebrow">Plan Business</p><h1>Statistiques</h1></div>
      <div class="actions">${Object.entries(exports).map(([k, e]) => html`<a class="btn btn--ghost btn--small" href="/app/exports/${k}.csv">${e.label} (CSV)</a>`)}</div></div>
    <div class="figures">
      <div class="figure"><span class="eyebrow">Facture moyenne</span><div class="value">${amount(kpi.avg_invoice)}<small>FCFA</small></div></div>
      <div class="figure"><span class="eyebrow">Retard moyen de paiement</span><div class="value">${kpi.avg_delay == null ? '—' : Math.round(kpi.avg_delay)}<small>jours</small></div><div class="sub">Après l’échéance, factures soldées</div></div>
      <div class="figure"><span class="eyebrow">Délai de recouvrement (DSO)</span><div class="value">${kpi.dso ?? '—'}<small>jours</small></div><div class="sub">Encours rapporté au facturé sur 90 jours</div></div>
    </div>
    <div class="panel-title"><h2>Par client</h2><span class="muted small">TTC, avoirs déduits</span></div>
    <div class="table-scroll"><table class="ledger"><thead><tr><th>Client</th><th class="r">Factures</th><th class="r">Facturé</th><th>Part</th><th class="r">Encaissé</th><th class="r">Reste</th><th class="r">Retard moyen</th></tr></thead>
    <tbody>${byClient.map((c) => html`<tr><td><a class="row-link" href="/app/clients/${c.id}">${c.name}</a></td><td class="r num">${c.invoices}</td>
      <td class="r num">${amount(c.billed)}</td><td style="min-width:120px"><div class="bar" style="margin:6px 0"><i style="width:${Math.round((c.billed / totalBilled) * 100)}%"></i></div><span class="small muted">${Math.round((c.billed / totalBilled) * 100)} %</span></td>
      <td class="r num">${amount(c.paid)}</td><td class="r num">${c.remaining ? amount(c.remaining) : '—'}</td>
      <td class="r num">${c.avg_delay_days == null ? '—' : `${Math.round(c.avg_delay_days)} j`}</td></tr>`)}</tbody></table></div>

    <div class="cols" style="margin-top:36px">
      <section>
        <div class="panel-title"><h2>Douze derniers mois</h2><span class="muted small">Base de la déclaration de TVA, à vérifier avec votre comptable</span></div>
        <div class="table-scroll"><table class="ledger"><thead><tr><th>Mois</th><th class="r">Factures</th><th class="r">HT</th><th class="r">TVA collectée</th><th class="r">TVA sur avoirs</th><th class="r">Encaissé</th></tr></thead>
        <tbody>${months.map((m) => html`<tr><td>${monthLabel(m.month)}</td><td class="r num">${m.count}</td><td class="r num">${amount(m.ht)}</td><td class="r num">${amount(m.vat)}</td><td class="r num">${m.vat_credited ? `−${amount(m.vat_credited)}` : '—'}</td><td class="r num">${amount(m.cashed)}</td></tr>`)}</tbody></table></div>
      </section>
      <section>
        <div class="panel-title"><h2>Moyens de paiement</h2></div>
        ${methods.length === 0
          ? html`<p class="empty">Aucun paiement enregistré.</p>`
          : html`<table class="ledger"><tbody>${methods.map((m) => html`<tr><td>${METHOD_LABELS[m.method]}<div class="bar" style="margin-top:6px"><i style="width:${Math.round((m.total / totalCash) * 100)}%"></i></div></td><td class="r num">${m.count}</td><td class="r num">${amount(m.total)}</td></tr>`)}</tbody></table>`}
      </section>
    </div>`,
  });
}

// --- Assistant financier -------------------------------------------------------------------------------------

const SUGGESTIONS = ['Qui me doit le plus en ce moment ?', 'Combien ai-je encaissé le mois dernier ?', 'Quels clients paient en retard ?', 'Quelles factures dois-je encore certifier ?'];

export function assistantPage({ user, messages, navCounts, error, usage }) {
  const left = usage.quota == null ? null : Math.max(0, usage.quota - usage.used);
  return appPage({
    title: 'Assistant',
    user,
    active: 'assistant',
    counts: navCounts,
    content: html`<div class="page-head"><div><p class="eyebrow">Assistant financier</p><h1>Posez une question sur vos chiffres</h1></div>
      ${messages.length ? html`<div class="actions"><form method="post" action="/app/assistant/effacer"><button class="btn btn--ghost btn--small">Nouvelle conversation</button></form></div>` : ''}</div>
    <div class="chat">
      ${messages.length === 0
        ? html`<p class="muted">L’assistant répond à partir de vos factures émises, paiements et relances. Il ne reçoit ni NCC, ni téléphone, ni email. Pour la fiscalité, il vous renverra vers la DGI ou un expert-comptable.</p>
          <div class="suggestions">${SUGGESTIONS.map((q) => html`<form method="post" action="/app/assistant"><input type="hidden" name="question" value="${q}"><button class="btn btn--ghost btn--small" ${left === 0 ? html`disabled` : ''}>${q}</button></form>`)}</div>`
        : messages.map((m) => html`<div class="msg msg--${m.role}"><span class="eyebrow">${m.role === 'user' ? 'Vous' : 'Assistant'}</span><div>${m.content}</div></div>`)}
    </div>
    ${notice(error)}
    <form method="post" action="/app/assistant" class="chat-form">
      <label class="visually-hidden" for="q">Votre question</label>
      <textarea id="q" name="question" rows="2" maxlength="500" required placeholder="Ex. Combien me doit la Boulangerie des Deux-Plateaux ?"></textarea>
      <button class="btn btn--accent" type="submit" ${left === 0 ? html`disabled` : ''}>Envoyer</button>
    </form>
    <p class="small muted">${left == null ? 'Questions illimitées sur votre plan.' : `${left} action${left > 1 ? 's' : ''} IA restante${left > 1 ? 's' : ''} ce mois.`} Chaque question compte pour une action.</p>`,
  });
}

// --- Relance rédigée par l'IA : relecture avant envoi ---------------------------------------------------

export function reminderDraftPage({ user, inv, message, tone, navCounts, error }) {
  return appPage({
    title: `Relance ${inv.number}`,
    user,
    active: 'factures',
    counts: navCounts,
    content: html`<a class="crumb" href="/app/factures/${inv.id}">← ${inv.number}</a>
    <div class="page-head"><div><p class="eyebrow">Relance · ton ${REMINDER_TONES[tone].toLowerCase()}</p><h1>Relisez avant d’envoyer</h1></div></div>
    ${notice(error)}
    <form method="post" action="/app/factures/${inv.id}/relance" style="max-width:640px">
      <input type="hidden" name="tone" value="${tone}">
      <input type="hidden" name="ai" value="1">
      <label class="field"><span>Message</span><textarea name="message" rows="9" required>${message}</textarea>
        <small>Rédigé par l’IA à partir du montant restant, de l’échéance et du ton. Modifiez-le librement.</small></label>
      <label class="field"><span>Numéro WhatsApp du client</span><input name="phone" type="tel" value="${inv.client.phone || ''}"></label>
      <button class="btn btn--accent" type="submit">Ouvrir WhatsApp avec ce message</button>
    </form>`,
  });
}

export function batchRemindersPage({ user, items, drafts, navCounts, error, aiEnabled }) {
  return appPage({
    title: 'Relances en lot',
    user,
    active: 'factures',
    counts: navCounts,
    content: html`<a class="crumb" href="/app/factures?filtre=en_retard">← Factures en retard</a>
    <div class="page-head"><div><p class="eyebrow">Plan Business</p><h1>Relances en lot</h1></div>
      ${items.length && aiEnabled && !drafts ? html`<div class="actions"><form method="post" action="/app/relances"><button class="btn btn--accent">Préparer toutes les relances (1 action IA)</button></form></div>` : ''}</div>
    ${notice(error)}
    ${items.length === 0
      ? html`<p class="empty">Aucune facture certifiée en retard : rien à relancer.</p>`
      : html`<p class="muted">Un message par facture, au ton adapté au retard. L’envoi reste manuel : chaque bouton ouvre WhatsApp avec le message, et la relance est enregistrée.</p>
        <div class="batch">${items.map((i) => {
          const draft = drafts?.find((d) => d.numero === i.number);
          return html`<form class="side-box" method="post" action="/app/factures/${i.id}/relance">
            <div class="panel-title"><h3><a href="/app/factures/${i.id}" class="mono">${i.number}</a> · ${i.client_name}</h3><span class="tag tag--en_retard">${i.days_late} j</span></div>
            <p class="small muted">${fcfa(i.remaining)} restants · échéance ${date(i.due_date)} · ton ${REMINDER_TONES[i.tone].toLowerCase()}</p>
            <input type="hidden" name="tone" value="${i.tone}"><input type="hidden" name="phone" value="${i.client_phone || ''}">
            ${draft ? html`<input type="hidden" name="ai" value="1"><textarea name="message" rows="6">${draft.message}</textarea>` : ''}
            <button class="btn btn--ghost btn--small" style="margin-top:10px">${draft ? 'Envoyer sur WhatsApp' : 'Relancer avec le modèle standard'}</button>
          </form>`;
        })}</div>`}`,
  });
}

// --- Fiche client : synthèse et historique -----------------------------------------------------------

export function clientHistory(c) {
  if (!c?.summary) return '';
  const s = c.summary;
  return html`<div class="figures" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="figure"><span class="eyebrow">Facturé</span><div class="value">${amount(s.billed)}<small>FCFA</small></div></div>
      <div class="figure"><span class="eyebrow">Encaissé</span><div class="value">${amount(s.paid)}<small>FCFA</small></div></div>
      <div class="figure ${s.remaining > 0 ? 'figure--warn' : ''}"><span class="eyebrow">Reste dû</span><div class="value">${amount(s.remaining)}<small>FCFA</small></div></div>
      <div class="figure"><span class="eyebrow">Retard moyen</span><div class="value">${s.avg_delay_days == null ? '—' : Math.round(s.avg_delay_days)}<small>jours</small></div></div>
    </div>
    <div class="cols" style="margin-bottom:36px">
      <section><div class="panel-title"><h2>Factures</h2><a class="small" href="/app/factures/nouvelle?client=${c.id}">Nouvelle facture</a></div>
        ${c.invoices.length === 0 ? html`<p class="empty">Aucune facture pour ce client.</p>`
          : html`<table class="ledger"><tbody>${c.invoices.map((i) => html`<tr><td><a class="row-link mono" href="/app/factures/${i.id}">${i.number || 'Brouillon'}</a><br><span class="small muted">${date(i.issue_date)}</span></td>
            <td>${i.to_certify ? html`<span class="tag tag--a_certifier">À certifier</span>` : statusTag(i.display_status)}</td><td class="r num">${amount(i.total_ttc)}</td></tr>`)}</tbody></table>`}
      </section>
      <section><div class="panel-title"><h2>Devis</h2></div>
        ${c.quotes.length === 0 ? html`<p class="empty">Aucun devis.</p>`
          : html`<table class="ledger"><tbody>${c.quotes.map((q) => html`<tr><td><a class="row-link mono" href="/app/devis/${q.id}">${q.number}</a></td><td><span class="tag tag--${q.status}">${QUOTE_STATUS_LABELS[q.status]}</span></td><td class="r small">${date(q.issue_date)}</td></tr>`)}</tbody></table>`}
      </section>
    </div>`;
}

export function forecastComment(text) {
  if (!text) return '';
  return html`<div class="side-box ai-comment"><span class="eyebrow">Lecture des prévisions par l’IA</span><p style="white-space:pre-line;margin:6px 0 0">${text}</p>
    <p class="small muted" style="margin:8px 0 0">Les chiffres viennent du calcul de FreeFact ; l’IA ne fait que les commenter.</p></div>`;
}


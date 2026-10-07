import { html, raw, amount, fcfa, date, statusTag } from '../html.js';
import { appPage } from './layout.js';

const SERIES = [
  { key: 'billed', label: 'Facturé', color: '#2f5f9a' },
  { key: 'cashed', label: 'Encaissé', color: '#b07a12' },
];

const monthLabel = (m) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}T00:00:00Z`)).replace('.', '');

// Barres groupées facturé / encaissé sur 6 mois. Un seul axe, grille discrète,
// infobulle native au survol d'une zone plus large que la barre, tableau équivalent.
function monthsChart(months) {
  const W = 640;
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 56 };
  const max = Math.max(1, ...months.flatMap((m) => [m.billed, m.cashed]));
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const y = (v) => pad.top + (H - pad.top - pad.bottom) * (1 - v / top);
  const band = (W - pad.left - pad.right) / months.length;
  const barW = Math.min(26, (band - 18) / 2);

  const parts = [];
  for (const t of ticks) {
    parts.push(`<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(t)}" y2="${y(t)}" stroke="#d4cbb9" stroke-width="1"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end">${amount(t)}</text>`);
  }
  months.forEach((m, i) => {
    const cx = pad.left + band * i + band / 2;
    SERIES.forEach((s, j) => {
      const v = m[s.key];
      const x = cx - barW - 1 + j * (barW + 2); // 2px d'écart entre les deux barres
      const h = Math.max(0, y(0) - y(v));
      const r = Math.min(4, h);
      if (h > 0) {
        // Extrémité arrondie en haut, ancrée à plat sur la ligne de base.
        parts.push(
          `<path d="M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z" fill="${s.color}"/>`,
        );
      }
    });
    const tip = `${monthLabel(m.month)} : facturé ${amount(m.billed)} FCFA, encaissé ${amount(m.cashed)} FCFA`;
    parts.push(
      `<rect x="${pad.left + band * i}" y="${pad.top}" width="${band}" height="${H - pad.top - pad.bottom}" fill="transparent"><title>${tip}</title></rect>`,
    );
    parts.push(`<text x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(m.month)}</text>`);
  });
  parts.push(`<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(0)}" y2="${y(0)}" stroke="#1c1b18" stroke-width="1"/>`);

  return html`<figure class="chart" style="margin:0">
    <div class="legend">${SERIES.map((s) => html`<span style="--k:${s.color}">${s.label}</span>`)}</div>
    ${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Facturé et encaissé par mois, six derniers mois">${parts.join('')}</svg>`)}
    <details class="small" style="margin-top:8px"><summary class="muted">Voir les chiffres</summary>
      <table class="ledger"><thead><tr><th>Mois</th><th class="r">Facturé</th><th class="r">Encaissé</th></tr></thead>
      <tbody>${months.map((m) => html`<tr><td>${monthLabel(m.month)}</td><td class="r num">${amount(m.billed)}</td><td class="r num">${amount(m.cashed)}</td></tr>`)}</tbody></table>
    </details>
  </figure>`;
}

function figure(label, value, sub, mod = '') {
  return html`<div class="figure ${mod}"><span class="eyebrow">${label}</span>
    <div class="value">${amount(value)}<small>FCFA</small></div>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>`;
}

function todoReason(t) {
  if (t.to_certify) return 'Émise, en attente du numéro fiscal FNE : l’envoi est bloqué.';
  if (t.display_status === 'en_retard') return `Échue le ${date(t.due_date)}, ${fcfa(t.remaining)} restent à payer.`;
  return `Échéance le ${date(t.due_date)}.`;
}

// Premiers pas : visible tant que le cycle complet n'a pas été parcouru une fois.
function onboarding(steps) {
  const items = [
    ['Identité légale', 'NCC, régime, centre des impôts', true, '/app/parametres', 'Modifier'],
    ['Un premier client', 'Avec son NCC si c’est une entreprise', steps.clients > 0, '/app/clients/nouveau', 'Ajouter'],
    ['Une facture émise', 'Numérotée et figée', steps.emitted > 0, '/app/factures/nouvelle', 'Créer'],
    ['Certifiée FNE', 'Numéro fiscal reporté, envoi débloqué', steps.certified > 0, '/app/factures?filtre=a_certifier', 'Voir'],
  ];
  if (items.every((i) => i[2])) return '';
  const done = items.filter((i) => i[2]).length;
  return html`<section class="onboard" aria-labelledby="ob-title">
    <div><p class="eyebrow">Premiers pas · ${done} sur ${items.length}</p><h2 id="ob-title">Votre première facture certifiée</h2></div>
    <ol>${items.map(([t, d, ok, href, cta]) => html`<li class="${ok ? 'done' : ''}"><b>${t}</b><span class="muted small">${d}</span>${ok ? '' : html`<br><a href="${href}">${cta}</a>`}</li>`)}</ol>
  </section>`;
}

export function dashboardPage({ user, data, counts, banner, express }) {
  const { figures: f, forecast, months, todo, recent, steps } = data;
  const first = user.fullname.split(' ')[0];
  return appPage({
    title: 'Tableau de bord',
    user,
    active: 'dashboard',
    counts,
    banner,
    content: html`
<div class="page-head">
  <div><p class="eyebrow">${new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
  <h1>Bonjour ${first}.</h1></div>
  <div class="actions"><a class="btn btn--accent" href="/app/factures/nouvelle">Nouvelle facture</a></div>
</div>

${onboarding(steps)}
<div class="figures">
  ${figure('Facturé ce mois', f.billed_month)}
  ${figure('Encaissé ce mois', f.cashed_month)}
  ${figure('Reste à encaisser', f.outstanding, `${f.outstanding_count} facture${f.outstanding_count > 1 ? 's' : ''} ouverte${f.outstanding_count > 1 ? 's' : ''}`)}
  ${figure('En retard', f.overdue, `${f.overdue_count} facture${f.overdue_count > 1 ? 's' : ''} échue${f.overdue_count > 1 ? 's' : ''}`, f.overdue > 0 ? 'figure--bad' : '')}
  ${figure('Attendu sous 7 jours', forecast.expected_7_days, 'Échéance + délai habituel du client')}
  ${figure('Attendu sous 30 jours', forecast.expected_30_days, 'Prévision, pas une promesse')}
</div>

<div class="cols">
  <section>
    ${express}
    <div class="panel-title" style="margin-top:8px"><h2>Facturé et encaissé</h2><span class="muted small">6 derniers mois, TTC</span></div>
    ${monthsChart(months)}
  </section>
  <section>
    <div class="panel-title"><h2>À traiter</h2>${f.to_certify > 0 ? html`<span class="tag tag--a_certifier">${f.to_certify} à certifier</span>` : ''}</div>
    ${todo.length === 0
      ? html`<p class="empty">Rien d’urgent. Les factures à certifier, en retard ou proches de l’échéance apparaîtront ici.</p>`
      : html`<ul class="todo">${todo.map(
          (t) => html`<li><a href="/app/factures/${t.id}"><b class="mono">${t.number}</b> · ${t.client_name}</a>
            ${t.to_certify ? html`<span class="tag tag--a_certifier">À certifier</span>` : statusTag(t.display_status)}
            <span class="why">${todoReason(t)}</span></li>`,
        )}</ul>`}

    <div class="panel-title" style="margin-top:32px"><h2>Dernières émises</h2><a class="small" href="/app/factures">Toutes</a></div>
    ${recent.length === 0
      ? html`<p class="empty">Aucune facture émise pour l’instant.</p>`
      : html`<table class="ledger"><tbody>${recent.map(
          (r) => html`<tr><td><a class="row-link mono" href="/app/factures/${r.id}">${r.number}</a><br><span class="muted small">${r.client_name}</span></td>
            <td>${statusTag(r.display_status)}</td><td class="r num">${amount(r.total_ttc)}</td></tr>`,
        )}</tbody></table>`}
  </section>
</div>`,
  });
}

import { html, raw, fcfa, amount, longDate, qty, REGIME_LABELS } from '../html.js';

// QR code factice pour la démonstration : motif déterministe, pas un vrai code.
// Les factures certifiées affichent la référence QR saisie depuis la FNE.
function qrPattern(seed) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const cells = [];
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const corner = (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5);
      h = (h * 1103515245 + 12345) >>> 0;
      if (corner ? !(x % 2 === 1 && y % 2 === 1 && (x === 1 || x === 7) && (y === 1 || y === 7)) : h % 3 === 0) {
        cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      }
    }
  }
  return raw(`<svg class="qr" viewBox="0 0 9 9" aria-hidden="true" fill="currentColor">${cells.join('')}</svg>`);
}

// Le motif de QR n'est dessiné que sur la facture de démonstration : sur une vraie facture,
// le QR code est celui de la DGI, dont FreeFact n'affiche que la référence saisie.
export function stamp(certification, { demo = false } = {}) {
  if (!certification) {
    return html`<div class="stamp stamp--pending"><span>En attente de<br>certification FNE</span></div>`;
  }
  return html`<div class="stamp ${demo ? '' : 'stamp--text'}" title="Facture certifiée par la DGI">
    ${demo ? qrPattern(certification.fiscal_number) : ''}
    <span>Certifiée FNE</span>
    <span>N° ${certification.fiscal_number}</span>
    <span>${longDate(certification.certified_at)}</span>
    ${certification.qr_reference ? html`<span>Réf. QR ${certification.qr_reference}</span>` : ''}
  </div>`;
}

const lineTotal = (it) => Math.round(Number(it.qty) * Number(it.unit_price));

// doc : { kind, number, issue_date, due_date, terms_days, seller, buyer, items,
//         vat_applicable, vat_rate, total_ht, total_vat, total_ttc, words, notes, certification }
export function invoiceSheet(doc, { className = '', showStamp = true } = {}) {
  const s = doc.seller || {};
  const b = doc.buyer || {};
  const isCredit = doc.kind === 'avoir';
  const isQuote = doc.kind === 'devis';
  return html`<article class="sheet ${className}">
    <header class="sheet-head">
      <div class="seller">
        ${s.logo_url ? html`<img class="sheet-logo" src="${s.logo_url}" alt="Logo ${s.business_name}">` : ''}
        <b>${s.business_name}${s.legal_form ? `, ${s.legal_form}` : ''}</b>
        ${s.address}${s.city ? `, ${s.city}` : ''}<br>
        NCC ${s.ncc || '—'}${s.rccm ? ` · RCCM ${s.rccm}` : ''}<br>
        ${REGIME_LABELS[s.tax_regime] || ''}${s.tax_center ? ` · Centre des impôts : ${s.tax_center}` : ''}
        ${s.phone || s.email ? html`<br>${[s.phone, s.email].filter(Boolean).join(' · ')}` : ''}
      </div>
      <div class="sheet-title">
        <div class="kind">${isQuote ? 'Devis' : isCredit ? 'Facture d’avoir' : 'Facture'}</div>
        <div class="no">${doc.number || 'BROUILLON'}</div>
        <div class="muted">${doc.issue_date ? `Émise le ${longDate(doc.issue_date)}` : 'Non émise'}</div>
      </div>
    </header>
    <div class="sheet-parties">
      <div>
        <span class="eyebrow">Client</span>
        <b>${b.name}</b><br>
        ${b.address || ''}
        ${b.ncc ? html`<br>NCC ${b.ncc}` : ''}
      </div>
      <div>
        <span class="eyebrow">${isQuote ? 'Validité' : isCredit ? 'Facture d’origine' : 'Échéance'}</span>
        ${isQuote
          ? html`<b>${doc.valid_until ? `Jusqu’au ${longDate(doc.valid_until)}` : '30 jours'}</b><br><span class="muted">Facture proforma, non numérotée fiscalement</span>`
          : isCredit
          ? html`<b class="mono">${doc.ref_number || ''}</b>`
          : html`<b>${doc.due_date ? longDate(doc.due_date) : `${doc.terms_days ?? 30} jours après émission`}</b>
                 ${doc.terms_days != null ? html`<br><span class="muted">Paiement à ${doc.terms_days} jours</span>` : ''}`}
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">P.U. HT</th><th class="r">Montant HT</th></tr></thead>
        <tbody>
          ${(doc.items || []).map(
            (it) => html`<tr>
              <td>${it.description}${doc.vat_applicable && !it.vat_applicable ? html` <span class="muted">(exonéré)</span>` : ''}</td>
              <td class="r num">${qty(it.qty)}</td>
              <td class="r num">${amount(it.unit_price)}</td>
              <td class="r num">${amount(lineTotal(it))}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <div class="sheet-totals num">
      <div><span>Total HT</span><span>${fcfa(doc.total_ht)}</span></div>
      ${doc.vat_applicable
        ? html`<div><span>TVA ${amount(doc.vat_rate)}&nbsp;%</span><span>${fcfa(doc.total_vat)}</span></div>`
        : html`<div><span>TVA non applicable</span><span>—</span></div>`}
      <div class="ttc"><span>Total TTC</span><span>${fcfa(doc.total_ttc)}</span></div>
    </div>
    ${doc.words ? html`<p class="sheet-words">${doc.words}</p>` : ''}
    <footer class="sheet-foot">
      <div>
        ${s.payment_info ? html`<div>${s.payment_info}</div>` : ''}
        ${!isCredit && !isQuote ? html`<div>${s.late_penalty_text || 'Tout retard de paiement peut donner lieu à des pénalités de retard.'}</div>` : ''}
        ${doc.notes ? html`<div>${doc.notes}</div>` : ''}
        ${s.signature_text ? html`<div>${s.signature_text}</div>` : ''}
      </div>
      ${showStamp && doc.number ? stamp(doc.certification, { demo: doc.demo }) : ''}
    </footer>
  </article>`;
}

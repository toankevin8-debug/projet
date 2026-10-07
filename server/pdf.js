// PDF natif d'une facture (A4), généré côté serveur avec pdfkit.
// Une facture non certifiée porte un filigrane : elle ne doit pas être remise au client.
import PDFDocument from 'pdfkit';
import { one } from './db.js';
import { amount, longDate, qty as fmtQty, REGIME_LABELS, METHOD_LABELS } from './html.js';

const INK = '#1c1b18';
const MUTED = '#6b665c';
const RULE = '#cfc6b4';
const OK = '#2f5d3a';

// pdfkit (polices standard, encodage WinAnsi) ne connaît pas l'espace fine insécable.
const t = (v) => String(v ?? '').replace(/[  ]/g, ' ');
const money = (n) => `${t(amount(n))} FCFA`;

async function logoBuffer(seller) {
  const match = /^\/logo\/([0-9a-f-]{36})/.exec(seller?.logo_url || '');
  if (!match) return null;
  const logo = await one(`SELECT mime, data FROM business_logos WHERE user_id = $1 AND mime IN ('image/png', 'image/jpeg')`, [match[1]]);
  return logo?.data ?? null;
}

export async function buildInvoicePdf(inv) {
  const s = inv.seller_snapshot || {};
  const b = inv.buyer_snapshot || {};
  const isCredit = inv.kind === 'avoir';
  const cert = inv.certification;
  const logo = await logoBuffer(s);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: true,
    info: { Title: `${isCredit ? 'Facture d’avoir' : 'Facture'} ${inv.number}`, Author: t(s.business_name), Creator: 'FreeFact' },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = 50;
  const right = 545;
  const width = right - left;

  // En-tête : vendeur à gauche, titre à droite.
  let y = 50;
  let sellerX = left;
  if (logo) {
    try { doc.image(logo, left, y, { fit: [56, 56] }); sellerX = left + 68; } catch { /* image illisible : ignorée */ }
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(t(`${s.business_name || ''}${s.legal_form ? `, ${s.legal_form}` : ''}`), sellerX, y, { width: 300 });
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  const sellerLines = [
    [s.address, s.city].filter(Boolean).join(', '),
    `NCC ${s.ncc || '—'}${s.rccm ? ` · RCCM ${s.rccm}` : ''}`,
    [REGIME_LABELS[s.tax_regime], s.tax_center ? `Centre des impôts : ${s.tax_center}` : null].filter(Boolean).join(' · '),
    [s.phone, s.email].filter(Boolean).join(' · '),
  ].filter(Boolean);
  for (const line of sellerLines) doc.text(t(line), sellerX, doc.y + 1, { width: 300 });
  const headerBottom = doc.y;

  doc.font('Times-Roman').fontSize(24).fillColor(INK).text(isCredit ? 'Facture d’avoir' : 'Facture', left, y - 2, { width, align: 'right' });
  doc.font('Courier-Bold').fontSize(11).text(t(inv.number), left, doc.y + 2, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(t(`Émise le ${longDate(inv.issue_date)}`), left, doc.y + 2, { width, align: 'right' });

  y = Math.max(headerBottom, doc.y) + 14;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();

  // Client et échéance.
  y += 12;
  const label = (txt, x, yy) => doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(txt.toUpperCase(), x, yy, { characterSpacing: 0.8 });
  label('Client', left, y);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(t(b.name), left, y + 12, { width: 260 });
  doc.font('Helvetica').fontSize(9);
  if (b.address) doc.text(t(b.address), left, doc.y + 1, { width: 260 });
  if (b.ncc) doc.text(t(`NCC ${b.ncc}`), left, doc.y + 1, { width: 260 });
  const clientBottom = doc.y;
  const col2 = left + width / 2 + 20;
  label(isCredit ? 'Facture d’origine' : 'Échéance', col2, y);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
    .text(t(isCredit ? inv.ref_number || '' : longDate(inv.due_date)), col2, y + 12);
  if (!isCredit) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Paiement à ${inv.terms_days} jours`, col2, doc.y + 1);

  y = Math.max(clientBottom, doc.y) + 16;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(RULE).stroke();

  // Lignes.
  const cols = [
    { key: 'description', label: 'Désignation', x: left, w: 275, align: 'left' },
    { key: 'qty', label: 'Qté', x: left + 280, w: 50, align: 'right' },
    { key: 'unit', label: 'P.U. HT', x: left + 335, w: 75, align: 'right' },
    { key: 'total', label: 'Montant HT', x: left + 415, w: 80, align: 'right' },
  ];
  y += 10;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
  for (const c of cols) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align, characterSpacing: 0.6 });
  y += 14;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();
  y += 6;
  doc.fontSize(9.5).fillColor(INK);
  for (const it of inv.items || []) {
    const desc = `${it.description}${inv.vat_applicable && !it.vat_applicable ? ' (exonéré)' : ''}`;
    const h = Math.max(doc.font('Helvetica').heightOfString(t(desc), { width: cols[0].w }), 12);
    if (y + h > 700) { doc.addPage(); y = 50; }
    doc.font('Helvetica').text(t(desc), cols[0].x, y, { width: cols[0].w });
    doc.font('Courier').fontSize(9.5);
    doc.text(t(fmtQty(it.qty)), cols[1].x, y, { width: cols[1].w, align: 'right' });
    doc.text(t(amount(it.unit_price)), cols[2].x, y, { width: cols[2].w, align: 'right' });
    doc.text(t(amount(Math.round(Number(it.qty) * Number(it.unit_price)))), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.fontSize(9.5);
    y += h + 7;
    doc.moveTo(left, y - 3).lineTo(right, y - 3).lineWidth(0.5).strokeColor(RULE).stroke();
  }

  // Totaux.
  y += 8;
  const tx = left + 300;
  const tw = width - 300;
  const totalRow = (lbl, val, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(INK);
    doc.text(lbl, tx, y, { width: tw / 2 });
    doc.font(bold ? 'Courier-Bold' : 'Courier').text(val, tx + tw / 2, y, { width: tw / 2, align: 'right' });
    y += bold ? 18 : 15;
  };
  totalRow('Total HT', money(inv.total_ht));
  totalRow(inv.vat_applicable ? `TVA ${t(amount(inv.vat_rate))} %` : 'TVA non applicable', inv.vat_applicable ? money(inv.total_vat) : '—');
  doc.moveTo(tx, y - 2).lineTo(right, y - 2).lineWidth(1).strokeColor(INK).stroke();
  y += 4;
  totalRow('Total TTC', money(inv.total_ttc), true);

  if (inv.amount_in_words) {
    y += 6;
    doc.font('Times-Italic').fontSize(11).fillColor(INK).text(t(inv.amount_in_words), left, y, { width });
    y = doc.y + 10;
  }

  // Paiements reçus (facture payée en partie ou en totalité).
  if (inv.payments?.length) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    for (const p of inv.payments) {
      doc.text(t(`Reçu le ${longDate(p.payment_date)} : ${money(p.amount)} par ${METHOD_LABELS[p.method]}${p.reference ? ` (réf. ${p.reference})` : ''}`), left, y, { width });
      y = doc.y + 2;
    }
    y += 6;
  }

  // Pied : conditions à gauche, cachet de certification à droite.
  if (y > 680) { doc.addPage(); y = 50; }
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(RULE).stroke();
  y += 10;
  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  const foot = [
    s.payment_info,
    !isCredit ? s.late_penalty_text || 'Tout retard de paiement peut donner lieu à des pénalités de retard.' : null,
    inv.notes,
    s.signature_text,
  ].filter(Boolean);
  doc.text(t(foot.join('\n')), left, y, { width: 280 });

  const bx = right - 200;
  if (cert) {
    doc.rect(bx, y - 2, 200, 58).lineWidth(1.5).strokeColor(OK).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(OK).text('CERTIFIÉE FNE · DGI', bx + 10, y + 6, { width: 180 });
    doc.font('Courier').fontSize(8.5).text(t(`N° fiscal ${cert.fiscal_number}`), bx + 10, doc.y + 3, { width: 180 });
    doc.text(t(`Le ${longDate(cert.certified_at)}`), bx + 10, doc.y + 1, { width: 180 });
    if (cert.qr_reference) doc.text(t(`Réf. QR ${cert.qr_reference}`), bx + 10, doc.y + 1, { width: 180 });
  } else {
    doc.rect(bx, y - 2, 200, 40).dash(3, { space: 3 }).lineWidth(1).strokeColor('#9a6400').stroke().undash();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#9a6400').text('EN ATTENTE DE CERTIFICATION FNE', bx + 10, y + 8, { width: 180 });
    // Filigrane diagonal sur chaque page.
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i += 1) {
      doc.switchToPage(i);
      doc.save().rotate(-35, { origin: [297, 421] }).font('Helvetica-Bold').fontSize(34).fillColor('#a12b1f').opacity(0.12)
        .text('NON CERTIFIÉE FNE', 60, 380, { width: 475, align: 'center' })
        .fontSize(16).text('NE PAS TRANSMETTRE AU CLIENT', 60, 425, { width: 475, align: 'center' }).restore();
      doc.opacity(1);
    }
  }

  // Pied de page sur chaque page, dans la marge basse (sans déclencher de saut de page).
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).opacity(1)
      .text(`${t(inv.number)} · page ${i - range.start + 1}/${range.count} · document établi avec FreeFact`, left, 812, { width, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

export async function sendInvoicePdf(res, inv) {
  const pdf = await buildInvoicePdf(inv);
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="${inv.number}.pdf"`);
  res.send(pdf);
}

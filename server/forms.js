// Lecture des formulaires : on nettoie ici, la base applique les règles.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const text = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

export const bool = (v) => v === '1' || v === 'on' || v === true;

// « 25 000 », « 25000 », « 1,5 » → nombre ; vide → null.
export function number(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function integer(v) {
  const n = number(v);
  return n === null || Number.isNaN(n) ? n : Math.round(n);
}

export function isoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Lignes d'une facture ou d'un devis. Les lignes entièrement vides sont ignorées.
export function items(raw) {
  const rows = Array.isArray(raw) ? raw : Object.values(raw || {});
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const description = text(r.description);
    const qty = number(r.qty);
    const price = integer(r.unit_price);
    if (!description && (price === null || price === 0)) continue;
    if (!description) throw new FormError('Chaque ligne doit avoir une désignation.');
    if (qty === null || Number.isNaN(qty) || qty <= 0) throw new FormError(`Quantité invalide pour « ${description} ».`);
    if (Number.isNaN(price) || (price ?? 0) < 0) throw new FormError(`Prix invalide pour « ${description} ».`);
    out.push({ description, qty, unit_price: price ?? 0, vat_applicable: bool(r.vat_applicable) });
  }
  return out;
}

export class FormError extends Error {}

// Numéro ivoirien à 10 chiffres → format international pour wa.me.
export function whatsappNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `225${digits}`;
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

export function whatsappLink(phone, message) {
  const n = whatsappNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}

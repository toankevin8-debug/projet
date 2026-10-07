// Gabarits HTML : littéraux étiquetés avec échappement systématique.
// Une valeur n'est insérée telle quelle que si elle est marquée par raw() ou produite par html``.

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new Raw(String(value));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

// --- Formats -----------------------------------------------------------------

const moneyFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

// 182900 → « 182 900 » (espace fine insécable, comme sur un document imprimé).
export const amount = (n) => moneyFormat.format(Number(n) || 0).replace(/\s/g, ' ');
export const fcfa = (n) => `${amount(n)} FCFA`;

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const longDateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const toDate = (d) => (d instanceof Date ? d : new Date(String(d).length === 10 ? `${d}T00:00:00Z` : d));
export const date = (d) => (d ? dateFormat.format(toDate(d)) : '—');
export const longDate = (d) => (d ? longDateFormat.format(toDate(d)) : '—');
export const isoDate = (d) => (d ? toDate(d).toISOString().slice(0, 10) : '');

export const qty = (q) => {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
};

// --- Libellés --------------------------------------------------------------------

export const STATUS_LABELS = {
  brouillon: 'Brouillon',
  emise: 'Émise',
  partiellement_payee: 'Partiellement payée',
  payee: 'Payée',
  annulee: 'Annulée',
  en_retard: 'En retard',
};

export const QUOTE_STATUS_LABELS = {
  brouillon: 'Brouillon',
  envoye: 'Envoyé',
  accepte: 'Accepté',
  refuse: 'Refusé',
  expire: 'Expiré',
};

export const METHOD_LABELS = {
  orange_money: 'Orange Money',
  mtn_money: 'MTN Money',
  moov_money: 'Moov Money',
  wave: 'Wave',
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
};

export const REGIME_LABELS = {
  RNI: 'Régime réel normal (RNI)',
  RSI: 'Régime réel simplifié (RSI)',
  RME: 'Microentreprise (RME)',
  entreprenant: 'Entreprenant',
};

export function statusTag(status) {
  return html`<span class="tag tag--${status}">${STATUS_LABELS[status] ?? status}</span>`;
}

export function options(map, selected) {
  return Object.entries(map).map(
    ([value, label]) => html`<option value="${value}" ${value === selected ? raw('selected') : ''}>${label}</option>`,
  );
}

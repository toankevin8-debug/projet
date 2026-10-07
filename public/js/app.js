// FreeFact — comportements de page. Tout fonctionne sans ce script ;
// il ajoute les totaux en direct, l'ajout de lignes et quelques confirmations.

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const money = (n) => `${fmt.format(n).replace(/\s/g, ' ')} FCFA`;
const parseNum = (v) => {
  const n = Number(String(v).replace(/\s| | /g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Même règles que amount_in_words() côté base (orthographe traditionnelle).
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
  'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below1000(n, beforeScale) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let rest = '';
  if (r > 0) {
    if (r < 20) rest = UNITS[r];
    else {
      const t = Math.floor(r / 10);
      const u = r % 10;
      if (t === 7 || t === 9) rest = (t === 7 ? 'soixante' : 'quatre-vingt') + (t === 7 && u === 1 ? ' et ' : '-') + UNITS[10 + u];
      else if (t === 8) rest = 'quatre-vingt' + (u === 0 ? (beforeScale ? '' : 's') : `-${UNITS[u]}`);
      else rest = TENS[t] + (u === 0 ? '' : u === 1 ? ' et un' : `-${UNITS[u]}`);
    }
  }
  let words = '';
  if (h > 0) {
    words = h === 1 ? 'cent' : `${UNITS[h]} cent`;
    if (r === 0 && h > 1 && !beforeScale) words += 's';
  }
  return [words, rest].filter(Boolean).join(' ');
}

function inWords(n) {
  if (n === 0) return 'zéro';
  const scales = ['', 'mille', 'million', 'milliard'];
  const parts = [];
  let i = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      let w = below1000(chunk, i > 0);
      if (i === 1) w = chunk === 1 ? 'mille' : `${w} mille`;
      else if (i >= 2) w = `${w} ${scales[i]}${chunk > 1 ? 's' : ''}`;
      parts.unshift(w);
    }
    n = Math.floor(n / 1000);
    i += 1;
  }
  return parts.join(' ');
}

// --- Éditeur de lignes ---------------------------------------------------------------

function setupLines(form) {
  const table = form.querySelector('[data-lines]');
  if (!table) return;
  const body = table.tBodies[0];
  const template = form.querySelector('[data-line-template]');
  const totals = form.querySelector('[data-totals]');
  const vatToggle = form.querySelector('[data-vat-toggle]');
  const rate = parseNum(table.dataset.vatRate);
  let counter = body.rows.length;

  const vatOn = () => (vatToggle ? vatToggle.checked : totals.dataset.vatApplicable === '1');

  function recompute() {
    let ht = 0;
    let taxable = 0;
    for (const row of body.querySelectorAll('[data-line]')) {
      const line = Math.round(parseNum(row.querySelector('[data-qty]').value) * parseNum(row.querySelector('[data-price]').value));
      row.querySelector('[data-line-total]').textContent = fmt.format(line);
      ht += line;
      if (row.querySelector('[data-vat]').checked) taxable += line;
      row.querySelector('[data-vat]').disabled = !vatOn();
    }
    const vat = vatOn() ? Math.round((taxable * rate) / 100) : 0;
    totals.querySelector('[data-total="ht"]').textContent = money(ht);
    totals.querySelector('[data-total="vat"]').textContent = vatOn() ? money(vat) : '—';
    totals.querySelector('[data-vat-label]').textContent = vatOn() ? `${fmt.format(rate)} %` : 'non applicable';
    totals.querySelector('[data-total="ttc"]').textContent = money(ht + vat);
    totals.querySelector('[data-total="words"]').textContent =
      ht + vat > 0 ? `Arrêtée à la somme de ${inWords(ht + vat)} francs CFA.` : '';
  }

  form.querySelector('[data-add-line]')?.addEventListener('click', () => {
    const html = template.innerHTML.replaceAll('__i__', String(counter));
    counter += 1;
    body.insertAdjacentHTML('beforeend', html);
    body.lastElementChild.querySelector('input')?.focus();
    recompute();
  });
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-line]');
    if (!btn) return;
    if (body.rows.length > 1) btn.closest('tr').remove();
    else btn.closest('tr').querySelectorAll('input:not([type=checkbox])').forEach((i) => { i.value = ''; });
    recompute();
  });
  form.addEventListener('input', recompute);
  vatToggle?.addEventListener('change', recompute);
  recompute();
}

document.querySelectorAll('[data-invoice-form]').forEach(setupLines);

// --- Confirmations, impression, copie --------------------------------------------------

document.addEventListener('click', (e) => {
  const confirmBtn = e.target.closest('button[data-confirm]');
  if (confirmBtn && !window.confirm(confirmBtn.dataset.confirm)) e.preventDefault();
  if (e.target.closest('[data-print]')) window.print();
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
      const before = copy.textContent;
      copy.textContent = 'Lien copié';
      setTimeout(() => { copy.textContent = before; }, 1600);
    });
  }
  // Envoi par email : on enregistre l'envoi, puis le client mail s'ouvre.
  const mail = e.target.closest('[data-mark-sent]');
  if (mail) {
    fetch(mail.dataset.markSent, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'channel=email' });
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) e.preventDefault();
});

// --- Fiche client : le NCC n'est demandé qu'aux entreprises -----------------------------

const typeSwitch = document.querySelector('[data-client-type]');
if (typeSwitch) {
  const ncc = document.querySelector('[data-ncc-field]');
  const sync = () => {
    const pro = typeSwitch.querySelector('input:checked')?.value === 'entreprise';
    ncc.hidden = !pro;
  };
  typeSwitch.addEventListener('change', sync);
  sync();
}

// --- Paramètres : la TVA proposée suit le régime ------------------------------------------

const regime = document.querySelector('[data-regime]');
if (regime) {
  const vat = document.querySelector('[data-vat-applicable]');
  const hint = document.querySelector('[data-vat-hint]');
  const sync = (apply) => {
    const r = regime.value;
    if (!r) { hint.textContent = ''; return; }
    const expected = r === 'RNI' || r === 'RSI';
    if (apply) vat.checked = expected;
    hint.textContent = vat.checked === expected
      ? `— habituel pour ce régime, à confirmer avec votre centre des impôts`
      : `— inhabituel pour ce régime : vérifiez auprès de votre centre des impôts`;
  };
  regime.addEventListener('change', () => sync(true));
  vat.addEventListener('change', () => sync(false));
  sync(false);
}

// --- Facture express : dictée par la reconnaissance vocale du navigateur ---------------------

const express = document.querySelector('[data-express]');
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (express && Recognition) {
  const btn = express.querySelector('[data-dictate]');
  const field = express.querySelector('textarea');
  btn.hidden = false;
  let rec = null;
  btn.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Recognition();
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    const before = field.value ? `${field.value.trim()} ` : '';
    rec.onresult = (e) => {
      field.value = before + Array.from(e.results).map((r) => r[0].transcript).join('');
    };
    rec.onend = () => { rec = null; btn.textContent = 'Dicter'; };
    rec.start();
    btn.textContent = 'Arrêter';
  });
}

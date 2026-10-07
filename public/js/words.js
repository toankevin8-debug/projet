// Montant en toutes lettres, mêmes règles que amount_in_words() côté base.
(() => {
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

window.FreeFact = { ...(window.FreeFact || {}), inWords };
})();

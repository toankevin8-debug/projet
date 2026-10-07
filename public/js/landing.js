// Landing page : démonstration sans compte, apparitions au défilement, barre d'action mobile.
(() => {
  const { inWords } = window.FreeFact;
  const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const money = (n) => `${fmt.format(n).replace(/\s/g, ' ')} FCFA`;
  const num = (v) => { const n = Number(String(v).replace(/[\s  ]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // --- Démonstration -----------------------------------------------------------
  const demo = document.querySelector('[data-demo]');
  if (demo) {
    const $ = (k) => demo.querySelector(`[data-i="${k}"]`);
    const out = (k) => demo.querySelector(`[data-d="${k}"]`);
    const REGIMES = { RNI: 'Régime réel normal (RNI)', RSI: 'Régime réel simplifié (RSI)', RME: 'Microentreprise (RME)', entreprenant: 'Entreprenant' };
    let lastRegime = $('regime').value;

    const render = () => {
      const regime = $('regime').value;
      const expected = regime === 'RNI' || regime === 'RSI';
      // Changer de régime propose la TVA habituelle, comme dans l'application.
      if (regime !== lastRegime) { $('vat').checked = expected; lastRegime = regime; }
      const vatOn = $('vat').checked;
      const pro = demo.querySelector('[data-i="type"]:checked').value === 'entreprise';
      const ncc = $('ncc').value.trim();
      demo.querySelector('[data-i-wrap="ncc"]').hidden = !pro;
      $('ncc').setAttribute('aria-invalid', String(pro && !ncc));

      const lines = [[$('d1').value, num($('p1').value)], [$('d2').value, num($('p2').value)]].filter(([d, p]) => d.trim() || p);
      const ht = lines.reduce((s, [, p]) => s + p, 0);
      const vat = vatOn ? Math.round(ht * 0.18) : 0;

      out('regime-label').textContent = REGIMES[regime];
      out('client-ncc').textContent = pro ? (ncc ? `NCC ${ncc}` : 'NCC manquant') : 'Particulier';
      out('client-ncc').style.color = pro && !ncc ? 'var(--bad)' : '';
      out('rows').innerHTML = lines.map(([d, p]) => `<tr><td>${esc(d || 'Sans désignation')}</td><td class="r num">${fmt.format(p)}</td></tr>`).join('');
      out('ht').textContent = money(ht);
      out('vat-label').textContent = vatOn ? 'TVA 18 %' : 'TVA non applicable';
      out('vat').textContent = vatOn ? money(vat) : '—';
      out('ttc').textContent = money(ht + vat);
      out('words').textContent = ht + vat > 0 ? `Arrêtée la présente facture à la somme de ${inWords(ht + vat)} francs CFA.` : '';

      const checks = [];
      if (pro && !ncc) checks.push(['bloquant', 'NCC obligatoire pour un client entreprise : l’émission est bloquée.']);
      if (lines.some(([d]) => !d.trim())) checks.push(['bloquant', 'Chaque ligne doit avoir une désignation.']);
      if (ht === 0) checks.push(['avertissement', 'Aucun montant : un prix non donné reste à 0, FreeFact ne devine rien.']);
      if (vatOn !== expected) {
        checks.push(['avertissement', vatOn
          ? `TVA appliquée alors que le régime ${regime} n’y est normalement pas soumis : à confirmer avec votre centre des impôts.`
          : `TVA non appliquée alors que le régime ${regime} y est normalement soumis : à confirmer avec votre centre des impôts.`]);
      }
      if (!checks.some(([l]) => l === 'bloquant')) checks.push(['ok', 'Prête à être émise : numéro FA-2026-0001 attribué, puis certification FNE.']);
      out('checks').innerHTML = checks.map(([l, m]) => `<li class="${l}">${esc(m)}</li>`).join('');
    };
    demo.addEventListener('input', render);
    demo.addEventListener('change', render);
    render();
  }

  // --- Apparitions au défilement --------------------------------------------------
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = document.querySelectorAll('[data-reveal]');
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 60}ms`; io.observe(el); });
  } else {
    items.forEach((el) => el.classList.add('is-in'));
  }

  // --- Barre d'action mobile : visible après le hero, masquée sur le formulaire ------------
  const bar = document.querySelector('[data-sticky-cta]');
  const hero = document.querySelector('[data-hero]');
  const signup = document.querySelector('[data-signup]');
  if (bar && hero && 'IntersectionObserver' in window) {
    const state = { hero: true, signup: false };
    const sync = () => {
      bar.hidden = state.hero || state.signup;
      document.body.classList.toggle('has-sticky', !bar.hidden);
    };
    new IntersectionObserver(([e]) => { state.hero = e.isIntersecting; sync(); }).observe(hero);
    if (signup) new IntersectionObserver(([e]) => { state.signup = e.isIntersecting; sync(); }).observe(signup);
  }
})();

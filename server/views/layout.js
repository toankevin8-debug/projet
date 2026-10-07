import { html } from '../html.js';

const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap';

function document({ title, description, body, bodyClass = '' }) {
  return html`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  ${description ? html`<meta name="description" content="${description}">` : ''}
  <meta name="theme-color" content="#123832">
  <script>document.documentElement.classList.add('js')</script>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS}">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

export const wordmark = (href = '/') => html`<a class="wordmark" href="${href}"><img src="/logo.svg" alt="" width="32" height="32"><span>Free<b>Fact</b></span></a>`;

export function publicPage({ title, description, user, content, nav = true, current }) {
  return document({
    title,
    description,
    body: html`
<header class="site-head">
  <div class="wrap">
    ${wordmark()}
    <nav class="site-nav" aria-label="Navigation principale">
      ${nav
        ? html`<a class="hide-sm" href="/#cycle">Comment ça marche</a>
               <a class="hide-sm" href="/#tarifs">Tarifs</a>
               <a class="hide-sm" href="/#questions">Questions</a>`
        : ''}
      ${user
        ? html`<a class="btn btn--small" href="/app">Ouvrir mon espace</a>`
        : html`${current === 'connexion' ? '' : html`<a href="/connexion">Se connecter</a>`}
               ${current === 'inscription' ? '' : html`<a class="btn btn--small btn--accent" href="/inscription">Créer mon compte</a>`}`}
    </nav>
  </div>
</header>
${content}`,
  });
}

const NAV = [
  ['/app', 'Tableau de bord', 'dashboard'],
  ['/app/factures', 'Factures', 'factures'],
  ['/app/devis', 'Devis', 'devis'],
  ['/app/clients', 'Clients', 'clients'],
  ['/app/paiements', 'Paiements', 'paiements'],
  ['/app/conformite', 'Conformité', 'conformite'],
];

export function appPage({ title, user, active, content, counts = {}, banner }) {
  return document({
    title: `${title} · FreeFact`,
    body: html`
<a class="skip-link" href="#contenu">Aller au contenu</a>
<div class="app">
  <aside class="app-side">
    ${wordmark('/app')}
    <nav class="app-nav" aria-label="Application">
      ${NAV.map(
        ([href, label, key]) => html`<a href="${href}" ${key === active ? html`aria-current="page"` : ''}>
          <span>${label}</span>${counts[key] ? html`<span class="count">${counts[key]}</span>` : ''}</a>`,
      )}
      <hr>
      <a href="/app/parametres" ${active === 'parametres' ? html`aria-current="page"` : ''}><span>Paramètres</span></a>
    </nav>
    <div class="who">
      <b>${user.profile?.business_name || user.fullname}</b>
      <span class="muted">Plan ${user.plan}</span>
      <form method="post" action="/deconnexion"><button class="link-btn small" type="submit">Se déconnecter</button></form>
    </div>
  </aside>
  <div>
    ${banner ? html`<div class="banner">${banner}</div>` : ''}
    <main class="app-main" id="contenu">${content}</main>
  </div>
</div>
<script src="/js/words.js" defer></script>
<script src="/js/app.js" defer></script>`,
  });
}

export function plainPage({ title, content }) {
  return document({ title, body: content });
}

export function notice(message, kind = 'error') {
  if (!message) return '';
  return html`<div class="notice notice--${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><p>${message}</p></div>`;
}

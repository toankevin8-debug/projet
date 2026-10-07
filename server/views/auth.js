import { html } from '../html.js';
import { publicPage, notice } from './layout.js';
import { signupForm } from './landing.js';

const PLAN_NAMES = { pro: 'Pro', business: 'Business' };

const googleButton = (label) => html`<a class="btn btn--ghost btn-google" href="/auth/google">
  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
  ${label}</a>
  <p class="or"><span>ou</span></p>`;

function authLayout({ title, current, aside, main }) {
  return publicPage({
    title: `${title} · FreeFact`,
    nav: false,
    current,
    content: html`<main class="auth"><section class="auth-aside">${aside}</section><section class="auth-main"><div class="auth-box">${main}</div></section></main>`,
  });
}

export function signupPage({ error, field, values = {}, plan, google }) {
  return authLayout({
    title: 'Créer un compte',
    current: 'inscription',
    aside: html`<p class="eyebrow">Ce que vous allez faire ensuite</p>
    <h1>Trois minutes jusqu’à votre premier brouillon.</h1>
    <ol>
      <li><span><b>Votre identité légale.</b> NCC, régime d’imposition, centre des impôts. FreeFact en déduit la TVA à proposer.</span></li>
      <li><span><b>Un premier client.</b> Particulier ou entreprise ; pour une entreprise, son NCC.</span></li>
      <li><span><b>Une facture.</b> Lignes, délai de paiement, et un contrôle de conformité en direct avant l’émission.</span></li>
    </ol>
    <p class="quote">« Avant, je refaisais mes factures sur Word à chaque fois, et je ne savais jamais quel numéro mettre. »
      <cite>Le genre de phrase qu’on veut ne plus entendre.</cite></p>`,
    main: html`<h2>Créer mon compte</h2>
      <p class="muted" style="margin-bottom:24px">${plan && PLAN_NAMES[plan]
        ? `Vous démarrez en gratuit ; le passage au plan ${PLAN_NAMES[plan]} se fait depuis la page Abonnement.`
        : 'Gratuit, sans carte bancaire.'}</p>
      ${google ? googleButton('Continuer avec Google') : ''}
      ${field ? '' : notice(error)}
      ${signupForm({ values, error, field })}`,
  });
}

export function loginPage({ error, info, email = '', next = '', google }) {
  return authLayout({
    title: 'Connexion',
    current: 'connexion',
    aside: html`<p class="eyebrow">Bon retour</p>
    <h1>Vos factures vous attendent là où vous les avez laissées.</h1>
    <ol>
      <li><span><b>À certifier.</b> Les factures émises qui attendent leur numéro fiscal.</span></li>
      <li><span><b>En retard.</b> Les clients à relancer, avec un message prêt.</span></li>
      <li><span><b>À venir.</b> Ce qui doit rentrer dans les 7 et 30 prochains jours.</span></li>
    </ol>`,
    main: html`<h2>Se connecter</h2>
      <p class="muted" style="margin-bottom:24px">Pas encore de compte ? <a href="/inscription">Créer un compte</a></p>
      ${google ? googleButton('Se connecter avec Google') : ''}
      ${notice(error)}${notice(info, 'ok')}
      <form method="post" action="/connexion">
        <input type="hidden" name="suite" value="${next}">
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required value="${email}"></label>
        <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required>
          <small><a href="/mot-de-passe-oublie">Mot de passe oublié ?</a></small></label>
        <button class="btn" type="submit" style="width:100%">Se connecter</button>
      </form>`,
  });
}

const simpleAside = html`<p class="eyebrow">Compte</p><h1>On remet la main sur votre compte.</h1>
  <ol><li><span><b>Un lien par email.</b> Valable deux heures, utilisable une seule fois.</span></li>
  <li><span><b>Un nouveau mot de passe.</b> Toutes vos sessions ouvertes sont fermées par sécurité.</span></li></ol>`;

export function forgotPage({ sent, error, email = '' }) {
  return authLayout({
    title: 'Mot de passe oublié',
    aside: simpleAside,
    main: sent
      ? html`<h2>Vérifiez vos emails</h2>
        <p>Si un compte existe pour <b>${email}</b>, un lien de réinitialisation vient d’y être envoyé. Pensez à regarder dans les indésirables.</p>
        <p><a href="/connexion">Retour à la connexion</a></p>`
      : html`<h2>Mot de passe oublié</h2>
        <p class="muted" style="margin-bottom:24px">Indiquez l’email de votre compte, nous vous envoyons un lien.</p>
        ${notice(error)}
        <form method="post" action="/mot-de-passe-oublie">
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required value="${email}"></label>
          <button class="btn" type="submit" style="width:100%">Recevoir le lien</button>
        </form>
        <p class="small" style="margin-top:16px"><a href="/connexion">Retour à la connexion</a></p>`,
  });
}

export function resetPage({ token, error }) {
  return authLayout({
    title: 'Nouveau mot de passe',
    aside: simpleAside,
    main: html`<h2>Nouveau mot de passe</h2>
      ${notice(error)}
      ${token
        ? html`<form method="post" action="/reinitialiser">
            <input type="hidden" name="jeton" value="${token}">
            <label class="field"><span>Nouveau mot de passe</span><input name="password" type="password" autocomplete="new-password" minlength="8" required><small>8 caractères au moins.</small></label>
            <button class="btn" type="submit" style="width:100%">Enregistrer</button>
          </form>`
        : html`<p><a href="/mot-de-passe-oublie">Faire une nouvelle demande</a></p>`}`,
  });
}

export function messagePage({ title, message }) {
  return authLayout({
    title,
    aside: html`<p class="eyebrow">FreeFact</p><h1>${title}</h1>`,
    main: html`<h2>${title}</h2><p>${message}</p><p><a href="/app">Mon espace</a> · <a href="/connexion">Connexion</a></p>`,
  });
}

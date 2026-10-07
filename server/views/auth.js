import { html } from '../html.js';
import { publicPage, notice } from './layout.js';
import { signupForm } from './landing.js';

const PLAN_NAMES = { pro: 'Pro', business: 'Business' };

export function signupPage({ error, values = {}, plan }) {
  return publicPage({
    title: 'Créer un compte · FreeFact',
    nav: false,
    current: 'inscription',
    content: html`<main class="auth">
  <section class="auth-aside">
    <p class="eyebrow">Ce que vous allez faire ensuite</p>
    <h1>Trois minutes jusqu’à votre premier brouillon.</h1>
    <ol>
      <li><span><b>Votre identité légale.</b> NCC, régime d’imposition, centre des impôts. FreeFact en déduit la TVA à proposer.</span></li>
      <li><span><b>Un premier client.</b> Particulier ou entreprise ; pour une entreprise, son NCC.</span></li>
      <li><span><b>Une facture.</b> Lignes, délai de paiement, et un contrôle de conformité en direct avant l’émission.</span></li>
    </ol>
    <p class="quote">« Avant, je refaisais mes factures sur Word à chaque fois, et je ne savais jamais quel numéro mettre. »
      <cite>Le genre de phrase qu’on veut ne plus entendre.</cite></p>
  </section>
  <section class="auth-main">
    <div style="width:100%;max-width:420px">
      <h2>Créer mon compte</h2>
      <p class="muted" style="margin-bottom:24px">${plan && PLAN_NAMES[plan]
        ? `Vous démarrez en gratuit ; le passage au plan ${PLAN_NAMES[plan]} se fait depuis vos paramètres.`
        : 'Gratuit, sans carte bancaire.'}</p>
      ${notice(error)}
      ${signupForm({ values })}
    </div>
  </section>
</main>`,
  });
}

export function loginPage({ error, email = '', next = '' }) {
  return publicPage({
    title: 'Connexion · FreeFact',
    nav: false,
    current: 'connexion',
    content: html`<main class="auth">
  <section class="auth-aside">
    <p class="eyebrow">Bon retour</p>
    <h1>Vos factures vous attendent là où vous les avez laissées.</h1>
    <ol>
      <li><span><b>À certifier.</b> Les factures émises qui attendent leur numéro fiscal.</span></li>
      <li><span><b>En retard.</b> Les clients à relancer, avec un message prêt.</span></li>
      <li><span><b>À venir.</b> Ce qui doit rentrer dans les 7 et 30 prochains jours.</span></li>
    </ol>
  </section>
  <section class="auth-main">
    <form method="post" action="/connexion">
      <h2>Se connecter</h2>
      <p class="muted" style="margin-bottom:24px">Pas encore de compte ? <a href="/inscription">Créer un compte</a></p>
      ${notice(error)}
      <input type="hidden" name="suite" value="${next}">
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required value="${email}"></label>
      <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn" type="submit" style="width:100%;justify-content:center">Se connecter</button>
    </form>
  </section>
</main>`,
  });
}

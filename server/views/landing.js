import { html } from '../html.js';
import { publicPage } from './layout.js';
import { invoiceSheet } from './sheet.js';

const demo = {
  kind: 'facture',
  number: 'FA-2026-0014',
  issue_date: '2026-10-02',
  due_date: '2026-10-17',
  terms_days: 15,
  seller: {
    business_name: 'Atelier Nanan',
    legal_form: 'Entreprise individuelle',
    address: 'Rue des Jardins, Cocody',
    city: 'Abidjan',
    ncc: '2204517 K',
    tax_regime: 'RSI',
    tax_center: 'Cocody',
    payment_info: 'Wave ou Orange Money : 07 07 00 00 00',
  },
  buyer: { name: 'Boulangerie des Deux-Plateaux SARL', address: 'Bd Latrille, Abidjan', ncc: '1907733 B' },
  items: [
    { description: 'Affiches A2, campagne de rentrée', qty: 3, unit_price: 25000, vat_applicable: true },
    { description: 'Création du logo et charte simple', qty: 1, unit_price: 80000, vat_applicable: true },
  ],
  vat_applicable: true,
  vat_rate: 18,
  total_ht: 155000,
  total_vat: 27900,
  total_ttc: 182900,
  words: 'Arrêtée la présente facture à la somme de cent quatre-vingt-deux mille neuf cents francs CFA.',
  certification: { fiscal_number: 'FNE-26-0047719', certified_at: '2026-10-02' },
};

const TIMELINE = [
  ['9 mai 2025', 'Arrêté n°0337 : modalités de la facture normalisée électronique.'],
  ['1er juin 2025', 'Obligation pour le régime réel normal (RNI).'],
  ['1er juillet 2025', 'Régime réel simplifié (RSI).'],
  ['1er août 2025', 'Microentreprises (RME).'],
  ['Décembre 2025', 'Fin de la tolérance : les factures papier sont refusées.'],
  ['23 mars 2026', 'Note de service de la DGI sur les mentions obligatoires.'],
];

const STEPS = [
  ['Brouillon', 'Vous saisissez les lignes, ou vous dictez une phrase. FreeFact signale ce qui manque avant que ça bloque.', 'Vous'],
  ['Émission', 'Le numéro tombe dans la série de l’année, sans trou. La facture est figée : on ne la retouche plus, on la corrige par avoir.', 'FreeFact'],
  ['Certification', 'Vous déclarez la facture sur la plateforme FNE et vous reportez le numéro fiscal. Tant que ce n’est pas fait, l’envoi reste verrouillé.', 'Vous + la DGI'],
  ['Envoi', 'Un message WhatsApp prérempli avec le lien de la facture, ou un email. Le client reçoit le document certifié, rien d’autre.', 'FreeFact'],
  ['Encaissement', 'Wave, Orange Money, MTN, Moov, espèces, virement : vous notez chaque paiement, même partiel. Le reste à payer se met à jour.', 'Vous'],
];

const RULES = [
  ['Numérotation continue', 'FA-2026-0001, puis 0002 : une série par année, sans trou ni doublon.'],
  ['Facture figée', 'Une fois émise, ni modification ni suppression. Seuls les brouillons s’effacent.'],
  ['Correction par avoir', 'Un avoir AV-… lié à la facture d’origine, jamais au-delà de ce qui reste à créditer.'],
  ['Photographie à l’émission', 'Changer d’adresse demain ne réécrit pas les factures d’hier.'],
  ['Identité du vendeur', 'NCC, régime, centre des impôts, RCCM. Sans NCC ni adresse, pas d’émission.'],
  ['Client entreprise', 'NCC exigé pour un client B2B, pas pour un particulier.'],
  ['TVA selon le régime', '18 % proposé en RNI et RSI, « TVA non applicable » sinon, avec alerte en cas d’écart.'],
  ['Montants justes', 'HT, TVA, TTC, reste à payer, et la somme écrite en toutes lettres.'],
  ['Échéance calculée', 'Le délai choisi au brouillon devient une date le jour de l’émission.'],
  ['Envoi après certification', 'Pas de numéro fiscal DGI, pas d’envoi au client.'],
  ['Conservation', 'Les documents émis restent, export de sauvegarde à tout moment. Gardez-les 10 ans.'],
];

const FAQ = [
  [
    'FreeFact certifie-t-il mes factures à ma place ?',
    'Pas encore automatiquement. La certification par API demande une autorisation du Directeur général des impôts, que nous préparons. En attendant, FreeFact vous guide : vous déclarez la facture sur la plateforme FNE, vous reportez le numéro fiscal, et FreeFact débloque l’envoi.',
  ],
  [
    'Je suis à la microentreprise, dois-je facturer la TVA ?',
    'En général non : FreeFact propose « TVA non applicable » pour les régimes RME et entreprenant, et 18 % pour le RNI et le RSI. Votre situation peut différer ; confirmez-la avec votre centre des impôts. FreeFact vous prévient si votre choix ne colle pas à votre régime.',
  ],
  [
    'Je me suis trompé sur une facture émise. Comment faire ?',
    'Comme le veut la règle : par une facture d’avoir, partielle ou totale, liée à la facture d’origine. FreeFact la prépare en un clic, et une facture entièrement créditée passe en « annulée ».',
  ],
  [
    'Et l’intelligence artificielle, elle fait quoi exactement ?',
    'Elle prépare : un brouillon à partir d’une phrase, une relance au bon ton, une réponse sur vos encaissements. Elle n’émet jamais une facture et ne touche jamais un document figé. Elle ne reçoit ni votre NCC, ni les téléphones ou emails de vos clients.',
  ],
  [
    'Mes données sont-elles en sécurité ?',
    'Chaque compte est cloisonné jusque dans la base de données, et les règles d’intégrité (numérotation, factures figées) y sont appliquées, pas seulement à l’écran. Vous pouvez exporter vos données à tout moment.',
  ],
  [
    'FreeFact remplace-t-il mon expert-comptable ?',
    'Non. FreeFact est un outil de gestion : vous restez responsable de l’exactitude de vos factures et de votre situation fiscale. Il vous évite les erreurs de forme, pas les conseils d’un professionnel.',
  ],
];

export function signupForm({ values = {}, compact = false } = {}) {
  return html`<form method="post" action="/inscription" novalidate>
    <label class="field"><span>Nom et prénom</span>
      <input name="fullname" autocomplete="name" required value="${values.fullname || ''}"></label>
    <label class="field"><span>Email</span>
      <input name="email" type="email" autocomplete="email" required value="${values.email || ''}"></label>
    <label class="field"><span>Téléphone</span>
      <input name="phone" type="tel" autocomplete="tel" placeholder="07 00 00 00 00" value="${values.phone || ''}">
      ${compact ? '' : html`<small>Pour vous joindre sur WhatsApp en cas de souci avec votre compte.</small>`}</label>
    <label class="field"><span>Mot de passe</span>
      <input name="password" type="password" autocomplete="new-password" minlength="8" required>
      <small>8 caractères au moins.</small></label>
    <label class="check"><input type="checkbox" name="terms" value="1" required ${values.terms ? html`checked` : ''}>
      <span class="small">J’ai compris que FreeFact est un outil de gestion : je reste responsable de mes factures et de ma situation fiscale.</span></label>
    <button class="btn btn--accent" type="submit" style="width:100%;justify-content:center">Créer mon compte gratuit</button>
    <p class="small muted" style="margin-top:12px">Déjà inscrit ? <a href="/connexion">Se connecter</a></p>
  </form>`;
}

export function landingPage({ user }) {
  return publicPage({
    title: 'FreeFact — des factures conformes FNE, envoyées sur WhatsApp',
    description:
      'FreeFact aide les freelances et petites entreprises de Côte d’Ivoire à émettre des factures conformes à la facture normalisée électronique de la DGI, à les envoyer et à suivre leurs encaissements.',
    user,
    content: html`
<main>
  <section class="hero">
    <div class="wrap">
      <div>
        <p class="eyebrow">Facturation · Côte d’Ivoire · Facture normalisée électronique</p>
        <h1>La facture qui passe la DGI <em>du premier coup.</em></h1>
        <p class="lede">FreeFact prépare des factures conformes à la FNE : NCC, TVA selon votre régime, numérotation sans trou, montant en lettres. Vous émettez, vous certifiez, vous envoyez sur WhatsApp, et vous suivez ce que Wave et Orange Money vous ont réellement versé.</p>
        <div class="ctas">
          <a class="btn btn--accent" href="/inscription">Créer mon compte, c’est gratuit</a>
          <a class="btn btn--ghost" href="#cycle">Voir le parcours d’une facture</a>
        </div>
        <p class="fine">5 factures par mois sans payer. Pas de carte bancaire, pas d’engagement.</p>
      </div>
      <div>
        ${invoiceSheet(demo, { className: 'hero-sheet' })}
        <p class="hero-caption"><span>FA-2026-0014</span><span>Une facture FreeFact, telle que votre client la reçoit.</span></p>
      </div>
    </div>
  </section>

  <section class="band band--dark" aria-labelledby="loi">
    <div class="wrap">
      <div class="section-head">
        <div>
          <p class="eyebrow">Ce qui a changé</p>
          <h2 id="loi">Depuis décembre 2025, une facture papier ne suffit plus.</h2>
        </div>
        <p>La DGI exige des factures normalisées électroniques, validées avant d’être remises au client. Une facture sortie sans certification ne se régularise pas après coup : elle n’est pas déductible pour votre client, et elle peut vous coûter l’attestation de régularité fiscale qu’on vous demande pour les marchés publics.</p>
      </div>
      <ol class="timeline">
        ${TIMELINE.map(
          ([when, what], i) => html`<li class="${i === TIMELINE.length - 1 ? 'now' : ''}"><time>${when}</time><p>${what}</p></li>`,
        )}
      </ol>
    </div>
  </section>

  <section class="band" id="cycle" aria-labelledby="cycle-title">
    <div class="wrap">
      <div class="section-head">
        <div>
          <p class="eyebrow">Le parcours d’une facture</p>
          <h2 id="cycle-title">Cinq étapes, dans le bon ordre, sans en sauter une.</h2>
        </div>
        <p>FreeFact pilote le cycle complet. Chaque étape débloque la suivante : on n’envoie pas ce qui n’est pas certifié, on n’encaisse pas au-delà de ce qui est dû.</p>
      </div>
      <ol class="steps">
        ${STEPS.map(([title, text, who]) => html`<li><h3>${title}</h3><p>${text}</p><span class="who">${who}</span></li>`)}
      </ol>
    </div>
  </section>

  <section class="band band--tint" aria-labelledby="regles">
    <div class="wrap">
      <div class="section-head">
        <div>
          <p class="eyebrow">Les contrôles</p>
          <h2 id="regles">Onze règles appliquées à chaque facture, pas seulement à l’écran.</h2>
        </div>
        <p>Elles sont inscrites dans la base de données elle-même : même en cas de bug de l’interface, une facture émise ne peut pas être modifiée et un numéro ne peut pas sauter.</p>
      </div>
      <ol class="rules">
        ${RULES.map(
          ([title, text], i) => html`<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><b>${title}</b><span>${text}</span></div></li>`,
        )}
      </ol>
    </div>
  </section>

  <section class="band" aria-labelledby="ia">
    <div class="wrap">
      <div class="section-head">
        <div>
          <p class="eyebrow">Facture express</p>
          <h2 id="ia">Dites ce que vous avez vendu. FreeFact écrit le brouillon.</h2>
        </div>
        <p>Une phrase tapée ou dictée devient des lignes chiffrées. Un montant que vous n’avez pas donné reste à zéro : rien n’est deviné. Vous relisez, et c’est vous qui émettez.</p>
      </div>
      <div class="grid-2" style="gap:32px">
        <div class="ai-example">
          <div class="said">« 3 affiches à 25 000 et un logo à 80 000 pour la boulangerie, paiement sous 15 jours »</div>
          <div class="made">
            <p class="eyebrow">Brouillon préparé</p>
            <table>
              <tr><td>Affiches</td><td class="r num">3 × 25 000</td></tr>
              <tr><td>Logo</td><td class="r num">1 × 80 000</td></tr>
              <tr><td>Client</td><td class="r">Boulangerie des Deux-Plateaux</td></tr>
              <tr><td>Échéance</td><td class="r">15 jours après émission</td></tr>
            </table>
          </div>
        </div>
        <div>
          <ul class="rules" style="columns:1">
            <li><span class="n">→</span><div><b>Relances au bon ton</b><span>Amical à J+3, ferme à J+30. Sans menace, sans pénalité inventée, relues par vous avant de partir.</span></div></li>
            <li><span class="n">→</span><div><b>Prévisions de trésorerie</b><span>Ce qui doit rentrer à 7 et 30 jours, calculé d’après les habitudes réelles de chaque client.</span></div></li>
            <li><span class="n">→</span><div><b>Un assistant qui connaît vos chiffres</b><span>« Qui me doit le plus ? », « Combien encaissé en septembre ? ». Pour la fiscalité, il vous renvoie vers la DGI ou votre comptable.</span></div></li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--tint" id="tarifs" aria-labelledby="tarifs-title">
    <div class="wrap">
      <div class="section-head">
        <div>
          <p class="eyebrow">Tarifs</p>
          <h2 id="tarifs-title">Le prix d’un déjeuner par mois.</h2>
        </div>
        <p>Toutes les formules produisent des factures conformes et guident la certification FNE. Payez par Mobile Money, changez de formule quand vous voulez.</p>
      </div>
      <div class="plans">
        <div class="plan">
          <p class="eyebrow">Gratuit</p>
          <div class="price">0 <small>FCFA / mois</small></div>
          <p class="muted small">Pour démarrer et facturer ses premiers clients.</p>
          <ul>
            <li>5 factures par mois</li><li>20 clients</li><li>Facture conforme, aperçu, export</li>
            <li>Certification FNE guidée</li><li>5 actions IA par mois</li><li class="no">Logo personnalisé</li>
          </ul>
          <a class="btn btn--ghost" href="/inscription">Commencer</a>
        </div>
        <div class="plan plan--focus">
          <p class="eyebrow">Pro</p>
          <div class="price">2 000 <small>FCFA / mois</small></div>
          <p class="muted small">Pour le freelance qui facture chaque semaine.</p>
          <ul>
            <li>Factures illimitées</li><li>Clients illimités</li><li>Logo sur vos factures</li>
            <li>Certification FNE guidée</li><li>50 actions IA par mois</li><li class="no">Relances en lot</li>
          </ul>
          <a class="btn btn--accent" href="/inscription?plan=pro">Choisir Pro</a>
        </div>
        <div class="plan">
          <p class="eyebrow">Business</p>
          <div class="price">5 000 <small>FCFA / mois</small></div>
          <p class="muted small">Pour la petite entreprise avec plusieurs clients réguliers.</p>
          <ul>
            <li>Tout Pro, IA sans limite</li><li>Relances IA en lot</li><li>Export Excel (CSV)</li>
            <li>Statistiques avancées</li><li>Certification FNE par API, dès l’agrément obtenu</li>
          </ul>
          <a class="btn btn--ghost" href="/inscription?plan=business">Choisir Business</a>
        </div>
      </div>
    </div>
  </section>

  ${user
    ? ''
    : html`<section class="band band--dark" id="inscription" aria-labelledby="inscription-title">
    <div class="wrap signup">
      <div>
        <p class="eyebrow">Inscription</p>
        <h2 id="inscription-title">Votre première facture conforme, ce soir.</h2>
        <p class="muted" style="margin-top:18px;font-size:17px">Le compte se crée en une minute. Ensuite, FreeFact vous demande votre identité légale ; gardez ces informations sous la main :</p>
        <ul class="prepare">
          <li><b>NCC</b><span>Votre numéro de compte contribuable, sur votre déclaration d’existence.</span></li>
          <li><b>Régime</b><span>RNI, RSI, microentreprise ou entreprenant : il décide de la TVA.</span></li>
          <li><b>Centre</b><span>Votre centre des impôts de rattachement.</span></li>
          <li><b>RCCM</b><span>Si vous êtes immatriculé au registre du commerce.</span></li>
        </ul>
      </div>
      <div class="card">${signupForm({ compact: true })}</div>
    </div>
  </section>`}

  <section class="band" id="questions" aria-labelledby="faq-title">
    <div class="wrap">
      <div class="section-head">
        <div>
          <p class="eyebrow">Questions</p>
          <h2 id="faq-title">Ce qu’on nous demande avant de s’inscrire.</h2>
        </div>
      </div>
      <div class="faq">
        ${FAQ.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}
      </div>
    </div>
  </section>
</main>

<footer class="site-foot">
  <div class="wrap">
    <div>
      <a class="wordmark" href="/">Free<b>Fact</b></a>
      <p style="margin-top:14px">Facturation pour freelances et petites entreprises de Côte d’Ivoire. FreeFact est un outil de gestion : il ne remplace ni la DGI ni votre expert-comptable. Le portail <a href="https://fne.dgi.gouv.ci" rel="noopener">fne.dgi.gouv.ci</a> fait foi.</p>
    </div>
    <div>
      <h4>Produit</h4>
      <ul><li><a href="/#cycle">Parcours d’une facture</a></li><li><a href="/#tarifs">Tarifs</a></li><li><a href="/#questions">Questions</a></li></ul>
    </div>
    <div>
      <h4>Compte</h4>
      <ul><li><a href="/inscription">Créer un compte</a></li><li><a href="/connexion">Se connecter</a></li></ul>
    </div>
  </div>
</footer>`,
  });
}

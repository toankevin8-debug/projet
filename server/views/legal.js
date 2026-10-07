// Pages légales (section 9 du cahier des charges). Version de travail : à faire valider
// par un juriste ivoirien avant le lancement. Les mentions entre crochets sont à compléter.
import { html } from '../html.js';
import { publicPage } from './layout.js';

const DRAFT = html`<div class="notice notice--warn"><p><b>Version de travail.</b> Ce texte doit être relu et validé par un juriste ivoirien avant le lancement commercial. Les éléments entre crochets sont à compléter.</p></div>`;

function legalPage({ title, updated, sections }) {
  return ({ user }) => publicPage({
    title: `${title} · FreeFact`,
    user,
    content: html`<main class="wrap legal">
      <p class="eyebrow">Informations légales · mise à jour le ${updated}</p>
      <h1>${title}</h1>
      ${DRAFT}
      <nav class="legal-nav" aria-label="Pages légales"><a href="/cgu">Conditions d’utilisation</a><a href="/confidentialite">Confidentialité</a><a href="/mentions-legales">Mentions légales</a></nav>
      ${sections.map(([h, ...ps]) => html`<section><h2>${h}</h2>${ps.map((p) => html`<p>${p}</p>`)}</section>`)}
    </main>`,
  });
}

export const LEGAL_PAGES = {
  '/cgu': legalPage({
    title: 'Conditions générales d’utilisation',
    updated: '7 octobre 2026',
    sections: [
      ['1. Le service', 'FreeFact est un logiciel de gestion de la facturation destiné aux freelances et petites entreprises établis en Côte d’Ivoire. Il aide à préparer des factures et des devis, à suivre leur certification sur la plateforme de facture normalisée électronique (FNE) de la Direction générale des impôts (DGI), à les envoyer et à suivre les encaissements.'],
      ['2. Ce que FreeFact n’est pas', 'FreeFact est un outil de gestion. Il ne remplace ni la DGI, ni un expert-comptable, ni un conseil fiscal. L’utilisateur reste seul responsable de l’exactitude des informations qu’il saisit, du choix de son régime et de son taux de TVA, de la certification de ses factures et de sa conformité fiscale. Les contrôles proposés par FreeFact (mentions obligatoires, cohérence de la TVA avec le régime) sont des aides et ne valent pas validation par l’administration.', 'Tant que l’interfaçage par API avec la FNE n’est pas autorisé par le Directeur général des impôts, la certification se fait sur la plateforme de la DGI ; FreeFact enregistre le numéro fiscal que l’utilisateur y a obtenu.'],
      ['3. Compte', 'L’utilisateur crée un compte avec une adresse email et un mot de passe, ou avec son compte Google. Il garde ses identifiants confidentiels et signale sans délai toute utilisation non autorisée.'],
      ['4. Formules et quotas', 'Trois formules sont proposées : Gratuit (5 factures et 5 actions d’intelligence artificielle par mois, 20 clients), Pro (2 000 FCFA par mois) et Business (5 000 FCFA par mois). Le détail des quotas figure sur la page Tarifs. Les abonnements sont payables d’avance, par Mobile Money, via un agrégateur de paiement agréé. Un abonnement non renouvelé repasse en formule gratuite ; aucune donnée n’est supprimée.'],
      ['5. Intelligence artificielle', 'Certaines fonctions (facture express, rédaction de relances, assistant, commentaire des prévisions) s’appuient sur un fournisseur d’intelligence artificielle. Elles préparent des brouillons et des textes que l’utilisateur relit ; elles n’émettent jamais une facture et ne modifient jamais un document émis. Seules les données utiles à la tâche sont transmises (noms, montants, dates, statuts), à l’exclusion des NCC, numéros de téléphone et adresses email.'],
      ['6. Factures émises et conservation', 'Une facture émise ne peut plus être modifiée ni supprimée ; elle se corrige par une facture d’avoir. FreeFact conserve les documents émis pendant dix ans, y compris après la résiliation du compte, afin de permettre à l’utilisateur de répondre à ses obligations de conservation. L’utilisateur peut à tout moment exporter l’ensemble de ses données.'],
      ['7. Disponibilité et responsabilité', 'FreeFact met en œuvre des moyens raisonnables pour assurer la disponibilité du service, sans garantie d’absence d’interruption. La responsabilité de l’éditeur, toutes causes confondues, est limitée au montant des sommes versées par l’utilisateur au cours des douze derniers mois. [Plafond et exclusions à valider.]'],
      ['8. Résiliation', 'L’utilisateur peut cesser d’utiliser le service à tout moment. Les données restent exportables ; les documents émis sont conservés comme indiqué à l’article 6.'],
      ['9. Droit applicable', 'Les présentes conditions sont régies par le droit ivoirien. [Juridiction compétente à préciser.]'],
    ],
  }),
  '/confidentialite': legalPage({
    title: 'Politique de confidentialité',
    updated: '7 octobre 2026',
    sections: [
      ['Responsable du traitement', '[Raison sociale de l’entité exploitante], [adresse], NCC [à compléter]. Porteur du projet : TOAN ISMAILA Kevin. Contact : [email de contact].'],
      ['Données traitées', 'Compte : nom, email, téléphone, mot de passe chiffré, identifiant Google le cas échéant. Activité : identité légale de l’entreprise, clients, devis, factures, paiements, relances. Technique : jeton de session, journal d’audit des opérations sur les factures.'],
      ['Finalités', 'Fournir le service de facturation, sécuriser le compte, envoyer les emails liés au service (vérification, réinitialisation, notifications que l’utilisateur peut désactiver), conserver les documents émis.'],
      ['Sous-traitants', 'Hébergement : [hébergeur et pays à décider et documenter]. Envoi d’emails : [prestataire SMTP]. Intelligence artificielle : Anthropic, pour les seules fonctions d’IA, avec les données limitées décrites dans les conditions d’utilisation. Paiement des abonnements : [agrégateur de paiement].'],
      ['Durées de conservation', 'Documents émis : dix ans. Autres données du compte : durée d’utilisation du service, puis suppression ou anonymisation dans un délai de [à préciser], sous réserve des obligations légales.'],
      ['Vos droits', 'Conformément à la loi ivoirienne n°2013-450 du 19 juin 2013 relative à la protection des données à caractère personnel, vous disposez d’un droit d’accès, de rectification et d’opposition. Écrivez à [email de contact]. Vous pouvez saisir l’Autorité de régulation des télécommunications/TIC de Côte d’Ivoire (ARTCI). [Déclaration ou autorisation ARTCI : à effectuer.]'],
      ['Cookies', 'FreeFact n’utilise qu’un cookie de session, nécessaire à la connexion, et un cookie temporaire pendant la connexion Google. Aucun cookie publicitaire ni de mesure d’audience.'],
    ],
  }),
  '/mentions-legales': legalPage({
    title: 'Mentions légales',
    updated: '7 octobre 2026',
    sections: [
      ['Éditeur', '[Raison sociale], [forme juridique] au capital de [montant] FCFA, RCCM [numéro], NCC [numéro], [adresse]. Directeur de la publication : TOAN ISMAILA Kevin.'],
      ['Hébergement', '[Nom, adresse et pays de l’hébergeur.]'],
      ['Marque', 'FreeFact est une marque [en cours de dépôt auprès de l’OAPI : à vérifier].'],
      ['Facture normalisée électronique', 'La plateforme FNE est opérée par la Direction générale des impôts de Côte d’Ivoire. Le portail fne.dgi.gouv.ci fait foi pour toute question relative à la facture normalisée électronique.'],
    ],
  }),
};

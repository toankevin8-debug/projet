# FreeFact

Facturation pour freelances et petites entreprises de Côte d’Ivoire, conforme à la **facture normalisée électronique (FNE)** de la DGI.
FreeFact pilote le cycle complet : brouillon → émission → certification FNE → envoi (WhatsApp, email) → encaissement (Wave, Orange Money, MTN, Moov…).

Le cahier des charges MVP V2 est dans [`docs/cahier-des-charges-mvp-v2.md`](docs/cahier-des-charges-mvp-v2.md).

## Ce que contient le dépôt

| Dossier | Contenu |
|---|---|
| `db/schema.sql` | Modèle de données v2 (PostgreSQL ≥ 13). Les règles de la section 3 sont appliquées **par la base** : numérotation continue sans trou, facture figée après émission, avoirs plafonnés, photographies vendeur/client, envoi bloqué avant certification, quotas par plan, journal d’audit en écriture seule. |
| `db/tests/` | Tests SQL de chaque règle (`npm run test:db`). |
| `server/` | Application Node.js / Express, pages rendues côté serveur (légères, utilisables sur un réseau mobile irrégulier). |
| `public/` | Feuille de style unique et un petit script de confort (totaux en direct, dictée). Tout fonctionne sans JavaScript. |
| `test/` | Tests de bout en bout par HTTP (`npm test`) : parcours d’une facture, comptes, abonnement, PDF, devis, notifications, IA contre un faux serveur d’API. |

## Couverture du cahier des charges

| Module (section 5) | État |
|---|---|
| Landing page | Livrée : preuves factuelles, démonstration sans compte, aperçu WhatsApp, tarifs, FAQ, inscription intégrée. La vidéo « Voir une démo » reste à tourner. |
| Inscription | Email + mot de passe avec vérification, mot de passe oublié, connexion Google (si `GOOGLE_CLIENT_ID`), limite de tentatives. |
| Onboarding | Identité légale, TVA proposée selon le régime, liste « Premiers pas ». |
| Tableau de bord | 6 indicateurs, facturé/encaissé sur 6 mois, prévisions 7/30 jours (commentées par l’IA à la demande), « À traiter », Facture express. |
| Clients | Particulier ou entreprise, fiche avec historique, délai moyen de paiement, suppression refusée si facture émise. |
| Devis | Lignes, envoi WhatsApp avec lien client `/d/:id`, statuts, conversion en facture. |
| Factures | Cycle complet, avoirs, duplication, PDF natif (filigrane tant que non certifiée), envoi WhatsApp et email avec PDF joint, brouillons gardés sur l’appareil. |
| Paiements | Partiels ou totaux, tous moyens ; relances modèles ou rédigées par l’IA, relances en lot (Business). |
| Notifications | Dans l’application et récapitulatif quotidien par email (désactivable). |
| Assistant IA | Chat sur les données du compte (sans NCC, téléphone ni email). |
| Conformité | Score du dossier légal, guide FNE. |
| Abonnement | Quotas, usage du mois, changement de plan. **Paiement simulé** tant que l’agrégateur Mobile Money n’est pas choisi. |
| Paramètres | Identité, TVA, préfixes, logo (Pro), notifications, mot de passe, sauvegarde JSON. Statistiques et exports CSV en Business. |

**Dépend d’un tiers, à brancher le moment venu :**

- **Certification FNE par API** : exige l’autorisation de la DGI ; le contrat d’interface n’est connu qu’avec l’agrément. Tout est prêt autour d’un seul point d’intégration (`server/fne.js`) ; `FNE_MODE=simulation` permet de tester le parcours (refusé en production).
- **Paiement des abonnements** : agrégateur Mobile Money à choisir ; les changements de plan sont aujourd’hui tracés comme simulés (`billing_events`).
- **Emails** : il suffit d’un compte SMTP (`SMTP_URL`). Sans lui, chaque email est gardé dans la table `outbox`.
- **Pages légales** : CGU, confidentialité et mentions légales sont en version de travail, à faire valider par un juriste ivoirien.

## Lancer en local

```bash
npm install
createdb freefact
DATABASE_URL=postgres://localhost/freefact npm start      # crée le schéma au premier démarrage
# → http://localhost:3000
```

Ou avec Docker (application + PostgreSQL) :

```bash
cp .env.example .env    # facultatif : SMTP, Google, IA, FNE
docker compose up --build
```

Toutes les variables sont décrites dans [`.env.example`](.env.example). `GET /sante` répond `{"ok":true}` quand la base est joignable.

Variables d’environnement principales :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL (seule obligatoire). |
| `PUBLIC_URL` | Adresse publique, pour les liens envoyés par email et WhatsApp. |
| `NODE_ENV=production` | Cookies `Secure`, mode simulation FNE refusé. |
| `SMTP_URL`, `MAIL_FROM` | Envoi réel des emails. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Connexion Google. |
| `ANTHROPIC_API_KEY`, `FREEFACT_AI_MODEL` | Fonctions IA (`claude-opus-5-5` par défaut). Sans clé, elles n’apparaissent pas. |
| `FNE_MODE`, `FNE_API_URL`, `FNE_API_TOKEN` | Certification FNE : `manuel`, `api` ou `simulation`. |
| `DISABLE_JOBS=1` | Coupe le récapitulatif quotidien par email. |

## Tests

```bash
PGHOST=… PGPORT=… PGUSER=… npm run test:db       # règles de la base, sur une base jetable
DATABASE_URL=postgres://…/base_vide npm test      # parcours complets par HTTP (9 tests)
```

## Choix de conception

- **La base est la source de vérité des règles légales.** Les fonctions `emit_invoice`, `record_fne_certification`, `mark_invoice_sent`, `create_credit_note` sont les seules portes de changement d’état ; des déclencheurs refusent toute modification d’une facture émise, même en SQL direct.
- **L’IA prépare, elle n’émet jamais.** La Facture express transforme une phrase en brouillon ; un prix absent reste à 0. Seuls la phrase et les noms des clients partent vers le modèle (ni NCC, ni téléphone, ni email). Le quota mensuel du plan est vérifié en base (`record_ai_usage`).
- **Design.** Identité tirée du logo (`public/logo.svg`) : vert lagune `#123832` pour la marque, la barre latérale et les grands bandeaux, or `#D4941F` pour les actions principales (or foncé `#8A5A06` pour le texte sur fond clair). Fond vert-blanc `#F3F6F4`, cartes blanches aux angles arrondis, pastilles d’état colorées, icônes au trait. Titres en Outfit (géométrique, comme le F du logo), texte en Work Sans. Le document facture reste sobre : c’est une pièce comptable. Tous les couples texte/fond sont vérifiés au-dessus de 4,5:1.
- **Landing page.** Formulaire à un champ, preuves factuelles (aucun témoignage inventé), démonstration du contrôle de conformité sans compte, aperçu du message WhatsApp reçu par le client, tarifs, barre d’action collante sur mobile. Animations d’apparition désactivées sous `prefers-reduced-motion`.
- **Accessibilité.** Lien d’évitement, focus visible, cibles tactiles de 44 px, contrastes vérifiés, boutons verrouillés pendant l’envoi (pas de double émission).

FreeFact est un outil de gestion : il ne remplace ni la DGI ni l’expert-comptable. Le portail [fne.dgi.gouv.ci](https://fne.dgi.gouv.ci) fait foi.

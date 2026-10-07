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
| `test/` | Test de bout en bout du parcours d’une facture par HTTP (`npm test`). |

### Modules livrés

Landing page avec inscription intégrée · inscription / connexion · onboarding de l’identité légale (NCC, régime, centre des impôts, TVA proposée selon le régime) · tableau de bord (6 indicateurs, facturé/encaissé sur 6 mois, prévisions à 7 et 30 jours, liste « À traiter ») · clients · devis (conversion en facture) · factures et avoirs (contrôle de conformité en direct, émission, certification FNE guidée, envoi WhatsApp/email, paiements partiels, relances, duplication, impression) · paiements · conformité · paramètres et sauvegarde JSON · **Facture express** (IA, optionnelle).

### Pas encore branché

- Vérification d’email et connexion Google (le schéma les prévoit : `email_verified_at`, `google_id`).
- Certification FNE **par API** : exige l’autorisation de la DGI. En attendant, la certification est guidée (saisie du numéro fiscal).
- Paiement des abonnements par Mobile Money (agrégateur), PDF natif côté serveur (l’impression du navigateur produit le PDF), envoi automatique d’emails.

## Lancer en local

```bash
npm install
createdb freefact
DATABASE_URL=postgres://localhost/freefact npm start      # crée le schéma au premier démarrage
# → http://localhost:3000
```

Variables d’environnement :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL. |
| `PORT` | Port HTTP (3000 par défaut). |
| `NODE_ENV=production` | Cookies de session `Secure`. |
| `ANTHROPIC_API_KEY` | Active la Facture express. Sans clé, le bloc n’apparaît pas. |
| `FREEFACT_AI_MODEL` | Modèle utilisé par la Facture express (`claude-opus-5-5` par défaut). |

## Tests

```bash
PGHOST=… PGPORT=… PGUSER=… npm run test:db       # règles de la base, sur une base jetable
DATABASE_URL=postgres://…/base_vide npm test      # parcours complet par HTTP
```

## Choix de conception

- **La base est la source de vérité des règles légales.** Les fonctions `emit_invoice`, `record_fne_certification`, `mark_invoice_sent`, `create_credit_note` sont les seules portes de changement d’état ; des déclencheurs refusent toute modification d’une facture émise, même en SQL direct.
- **L’IA prépare, elle n’émet jamais.** La Facture express transforme une phrase en brouillon ; un prix absent reste à 0. Seuls la phrase et les noms des clients partent vers le modèle (ni NCC, ni téléphone, ni email). Le quota mensuel du plan est vérifié en base (`record_ai_usage`).
- **Design.** Identité tirée du logo (`public/logo.svg`) : vert lagune `#123832` pour les actions et les bandeaux, point d’or `#D4941F` en accent (or foncé `#8A5A06` pour le texte sur papier, contraste 5,2:1). Papier chaud, filets de registre, titres en Newsreader, interface et chiffres en IBM Plex. Les écrans montrent de vrais documents plutôt que des illustrations.
- **Landing page.** Formulaire à un champ, preuves factuelles (aucun témoignage inventé), démonstration du contrôle de conformité sans compte, aperçu du message WhatsApp reçu par le client, tarifs, barre d’action collante sur mobile. Animations d’apparition désactivées sous `prefers-reduced-motion`.
- **Accessibilité.** Lien d’évitement, focus visible, cibles tactiles de 44 px, contrastes vérifiés, boutons verrouillés pendant l’envoi (pas de double émission).

FreeFact est un outil de gestion : il ne remplace ni la DGI ni l’expert-comptable. Le portail [fne.dgi.gouv.ci](https://fne.dgi.gouv.ci) fait foi.

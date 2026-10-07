# FreeFact — Cahier des charges MVP V2 (révisé)

7 oct. 2026 · @kevin — Porteur du projet : TOAN ISMAILA Kevin

## 1. Périmètre révisé du MVP

Le MVP V2 reste une application de facturation pour freelances et petites entreprises ivoiriennes, mais il devient conforme à la facture normalisée électronique (FNE) de la DGI et l'IA prépare les documents à la place de l'utilisateur.

| Domaine | V1 (cahier initial) | V2 (ce document) |
|---|---|---|
| Légalité | Aucune règle fiscale | NCC, régime d'imposition, TVA, numérotation continue, factures figées, avoirs, certification FNE |
| IA | Prévue en V3 | Facture express (texte ou voix), relances rédigées, assistant financier, prévisions de trésorerie |
| Lignes de facture | Absentes du modèle | Lignes, HT / TVA / TTC, montant en lettres |
| Statuts | 5 statuts | Brouillon, émise, partiellement payée, payée, en retard, annulée (par avoir) |
| Envoi | Non précisé | Email et WhatsApp (lien prérempli) ; bloqué tant que la facture n'est pas certifiée FNE |
| Périmètre | 3 plans, prévisions, notifications complètes | Prévisions locales dès la V1, notifications essentielles, quotas IA par plan |

> **Décision de fond :** la certification FNE devient le cœur du produit. Une facture PDF classique ne suffit plus en Côte d'Ivoire pour la plupart des contribuables (section 2). FreeFact doit donc piloter le cycle **brouillon → émission → certification → envoi → encaissement**.

## 2. Cadre légal : la facture normalisée électronique (FNE)

Depuis décembre 2025, la DGI n'accepte plus les factures papier : toute entreprise établie en Côte d'Ivoire doit émettre des factures normalisées électroniques, sauf dérogations limitées (guide Cleo ERP, avril 2026). Ces sources sont des guides d'éditeurs : le portail de la DGI (fne.dgi.gouv.ci) fait foi et doit être consulté avant le lancement.

| Date | Étape |
|---|---|
| 23 mars 2026 | Note de service de la DGI sur les mentions obligatoires, avec un régime adapté aux avocats et médecins (Yessouan) |
| 25 févr. 2026 | Plus de 52 000 entreprises inscrites sur la plateforme FNE |
| 1er et 11 déc. 2025 | Communiqués de la DGI : fin de la tolérance, factures papier refusées |
| 1er août 2025 | Microentreprises (RME) |
| 1er juil. 2025 | Régime réel simplifié (RSI) |
| 1er juin 2025 | Régime réel normal (RNI) |
| 9 mai 2025 | Arrêté n°0337 : modalités de la facture normalisée électronique |

### Ce que doit porter une facture

- **Éléments fournis par la DGI** : numéro fiscal unique attribué à la validation, cachet fiscal électronique, QR code, logo FNE, signature électronique.
- **Mentions classiques, toujours exigées** : identification du vendeur (NCC) et du client (nom ou raison sociale, adresse), dates, désignation, base HT, TVA, total TTC.
- **Principe de « clearance »** : la facture doit être validée par la DGI avant d'être remise au client ; une facture sortie sans certification n'est pas régularisable après coup.

### Trois façons d'émettre

1. **Plateforme web ou application mobile de la DGI** : saisie ou import de fichier, adaptée à un faible volume.
2. **Interfaçage par API** : le logiciel envoie la facture et reçoit numéro fiscal, cachet et QR code. Cela exige l'autorisation du Directeur général des impôts et, sans équipe technique interne, un éditeur ou intégrateur agréé (FAQ de la DGI, snippet de recherche : le site bloque la lecture automatique).
3. **Terminal TPE / reçu normalisé (RNE)** : pour les ventes au comptant des régimes forfaitaires.

Documents pris en charge : facture de vente, facture proforma (équivalent du devis), facture d'avoir (obligatoirement liée à une facture initiale) et reçus RNE.

### Conséquences d'un défaut

Selon les guides consultés : facture non déductible pour le client, refus de l'Attestation de Régularité fiscale (bloquant pour les marchés publics) et contrôle renforcé. Durée de conservation : 6 à 10 ans selon le régime ; 10 ans est la règle prudente, alignée sur les obligations comptables OHADA.

> **Conséquence produit :** FreeFact ne peut pas se contenter de produire des PDF. Il doit piloter la certification FNE et bloquer l'envoi d'une facture non certifiée.

## 3. Règles de conception d'une facture conforme

Le MVP applique onze règles, déjà codées dans l'application publiée. Les trois premières protègent l'intégrité des factures, les suivantes leur contenu.

| # | Règle | Mise en œuvre |
|---|---|---|
| 1 | Numérotation continue, par année, sans trou | Numéro (ex. FA-2026-0001) attribué à l'émission ; un brouillon n'en a pas |
| 2 | Facture figée après émission | Ni modification ni suppression ; seuls les brouillons se suppriment |
| 3 | Correction par avoir | Facture d'avoir liée à la facture d'origine, numérotée AV-…, partielle ou totale, plafonnée au solde créditable |
| 4 | Photographie à l'émission | Vendeur, client, taux de TVA copiés sur le document : modifier ses paramètres ne change pas les factures passées |
| 5 | Identité du vendeur | Nom, forme juridique, NCC, régime d'imposition, adresse, centre des impôts, RCCM si applicable ; NCC et adresse bloquants |
| 6 | Identification du client | Nom et adresse ; NCC obligatoire pour un client entreprise (B2B), non exigé pour un particulier |
| 7 | TVA | Taux de 18 % configurable, proposé selon le régime (RNI, RSI : oui ; RME, entreprenant : non) à confirmer avec le centre des impôts ; mention « TVA non applicable » sinon ; avertissement en cas d'incohérence |
| 8 | Montants | Lignes, total HT, TVA, TTC, reste à payer, montant en lettres (« Arrêtée la présente facture à la somme de… ») |
| 9 | Échéance et pénalités | Délai de paiement choisi à la création, échéance calculée à l'émission ; mention générale de pénalités, sans taux inventé |
| 10 | Certification FNE | Statut « à certifier » puis « certifiée » avec numéro fiscal, date et référence QR saisis ; envoi au client bloqué avant certification |
| 11 | Conservation | Documents émis non supprimables ; export de sauvegarde ; recommandation d'archivage sur 10 ans |

### Cycle de vie d'une facture

1. **Brouillon** : modifiable, contrôle de conformité en direct (points bloquants et avertissements).
2. **Émise** : numéro attribué, document figé, statut « À certifier FNE ».
3. **Certifiée** : numéro fiscal DGI enregistré ; l'envoi par email ou WhatsApp est débloqué.
4. **Encaissée** : paiements partiels ou totaux, avec moyen (Orange Money, MTN Money, Moov Money, Wave, espèces, virement, chèque) et référence.
5. **Corrigée ou annulée** par un avoir si nécessaire.

Le devis joue le rôle de facture proforma : il n'est pas numéroté fiscalement, peut être converti en brouillon de facture en un clic, et sa certification FNE éventuelle est prévue avec l'API (section 10).

## 4. IA intégrée au MVP

L'IA prépare, rédige et explique ; elle n'émet jamais une facture et ne modifie jamais un document figé. Cinq fonctions sont livrées dans l'application publiée.

| Fonction | Ce que fait l'IA | Garde-fous |
|---|---|---|
| Facture express | Transforme une phrase écrite ou dictée (« 3 affiches à 25 000 et un logo à 80 000, paiement sous 15 jours ») en brouillon de facture ou de devis | Montant absent = 0, jamais deviné ; client inconnu créé sans coordonnées ; l'utilisateur relit et émet lui-même |
| Relance IA | Rédige un message WhatsApp ou email au ton adapté au retard (amical, cordial, ferme, dernier rappel) | Pas de menace, pas de loi citée, pas de pénalité chiffrée ; relecture avant envoi |
| Relances en lot (Business) | Prépare tous les messages des factures en retard en un appel | Mêmes règles ; envoi manuel via lien WhatsApp |
| Assistant financier | Répond en français aux questions sur encaissements, retards et relances, à partir des données du compte | Répond uniquement d'après les données ; renvoie vers la DGI ou un expert-comptable pour la fiscalité |
| Prévisions de trésorerie | Calcule l'attendu à 7 et 30 jours (échéance + délai habituel de paiement du client), puis commente en 5 lignes | Le calcul est déterministe ; l'IA n'invente aucun chiffre |

Un score de délai de paiement par client (retard moyen constaté) est calculé sans IA et alimente les prévisions.

### Données et coûts

- Seules les données utiles à la tâche partent vers le modèle : noms, montants, dates, statuts. Ni NCC, ni téléphone, ni email n'entrent dans les requêtes de l'assistant.
- La dictée vocale utilise la reconnaissance du navigateur (disponible surtout sur Chrome et Android) ; une transcription côté serveur est prévue pour la V2.
- Dans le prototype, chaque appel IA consomme l'usage Claude de la personne connectée. En production, FreeFact paie l'API : les quotas par plan (section 8) sont un impératif de marge.

### Évolutions prévues

- **V2** : facture depuis une note vocale WhatsApp, lecture d'un devis papier photographié, relances programmées, détection de doublons et de montants atypiques.
- **V3** : score de risque d'impayé par client, assistant de trésorerie proactif, aide à la déclaration de TVA (sous réserve de validation par un expert-comptable).

## 5. Modules et parcours révisés

Treize modules composent le MVP ; dix sont livrés dans l'application publiée, un est simulé et deux exigent un backend ou du contenu marketing. Les corrections demandées après la revue de la V1 sont intégrées : lignes de facture, statut « partiellement payée », vérification d'email inutile avec Google, envoi par email ou lien, démo en vidéo.

| Module | Contenu | Prototype publié |
|---|---|---|
| Landing page | Hero, fonctionnalités, tarifs, témoignages, FAQ ; « Voir une démo » = vidéo de 60 à 90 secondes | À faire |
| Inscription | Email + mot de passe avec vérification, ou Google sans vérification ; téléphone demandé | Backend requis |
| Onboarding | Identité légale (NCC, régime, centre des impôts, RCCM), TVA proposée selon le régime, démo ou premiers clients | Livré |
| Dashboard | 6 indicateurs, graphique facturé / encaissé sur 6 mois, prévisions 7 et 30 jours, liste « À traiter », Facture express IA | Livré |
| Clients | Particulier ou entreprise, NCC, délai moyen de paiement ; suppression refusée si facture émise | Livré |
| Devis | Lignes, aperçu, envoi, conversion en facture, statuts brouillon, envoyé, accepté, refusé, expiré | Livré |
| Factures | Cycle de vie de la section 3, filtres, avoir, duplication, aperçu imprimable, export HTML | Livré (PDF natif côté serveur) |
| Paiements | Encaissés et en attente, paiement partiel ou total, relances IA | Livré (API Mobile Money en V2) |
| Notifications | Retard, échéance sous 3 jours, facture à certifier | Livré dans l'application ; email et WhatsApp en V2 |
| Assistant IA | Chat financier sur les données du compte | Livré |
| Conformité | Score du dossier légal, guide FNE, règles appliquées | Livré |
| Abonnement | Plans, quotas, usage du mois | Simulé |
| Paramètres | Identité légale, délais, TVA, pénalités, signature, sauvegarde JSON ; logo à venir | Livré |

## 6. Modèle de données v2

Le modèle de production ajoute les lignes de facture, les champs légaux, les instantanés d'émission et la certification FNE. Tous les montants sont des entiers en FCFA (pas de décimales). Implémentation de référence : [`db/schema.sql`](../db/schema.sql).

| Table | Champs principaux | Contrainte clé |
|---|---|---|
| Users | id, fullname, email, phone, password_hash (nul si Google), google_id, email_verified_at, plan | email unique |
| BusinessProfiles | user_id, business_name, legal_form, ncc, rccm, capital, tax_regime, tax_center, address, city, country, phone, email_pro, logo_url, vat_applicable, vat_rate, payment_info, late_penalty_text, signature_text, invoice_prefix, quote_prefix, default_terms_days, fne_registered | 1 profil par utilisateur |
| Clients | id, user_id, type (particulier ou entreprise), name, ncc, phone, email, address, notes | suppression interdite si facture émise |
| Quotes, QuoteItems | number, status, valid_until, notes ; lignes : position, description, qty, unit_price, vat_applicable | — |
| Invoices | id, user_id, client_id, quote_id, ref_invoice_id, kind (facture ou avoir), number, status, issue_date, terms_days, due_date, vat_applicable, vat_rate, total_ht, total_vat, total_ttc, seller_snapshot, buyer_snapshot, emitted_at, sent_at | number unique par utilisateur et année ; immuable après émission |
| InvoiceItems | invoice_id, position, description, qty, unit_price, vat_applicable | verrouillée avec la facture |
| FneCertifications | invoice_id, fiscal_number, certified_at, qr_reference, document_url, mode (manuel ou api), api_response | 1 certification par facture |
| Payments | user_id, invoice_id, amount, payment_date, method, reference | somme des paiements ≤ solde |
| Reminders | user_id, invoice_id, channel, tone, sent_at, ai_generated | — |
| Counters | user_id, prefix, year, last_number | incrément atomique |
| AiUsage | user_id, month, action, cost | quota par plan |
| AuditLog | user_id, entity, entity_id, action, at | écriture seule, preuve d'intégrité |

L'immuabilité est garantie par la base (déclencheur refusant tout UPDATE ou DELETE sur une facture au statut émis) et non seulement par l'interface.

## 7. Architecture de production et intégrations

L'API FreeFact est le seul composant qui parle à la base, à la FNE et à l'IA : l'application ne contacte jamais la DGI ni le fournisseur d'IA directement, ce qui protège les clés et centralise les contrôles légaux.

```
Application web / mobile ──▶ API FreeFact ──▶ Base de données (+ archivage 10 ans)
                                  │
                                  ├══▶ FNE (DGI)          ← intégration qui conditionne le lancement commercial
                                  ├──▶ Fournisseur d'IA (quotas par plan)
                                  └──▶ Mobile Money (agrégateur), WhatsApp, email
```

Ordre de mise en œuvre :

1. Backend, base de données et authentification ;
2. Archivage sur 10 ans ;
3. Certification par l'API FNE après autorisation de la DGI ;
4. IA côté serveur avec quotas ;
5. Mobile Money, WhatsApp et email.

## 8. Plans tarifaires et quotas

Les prix de la V1 sont conservés ; la V2 ajoute des quotas IA, car chaque action coûte à FreeFact en production.

| | Gratuit | Pro : 2 000 FCFA/mois | Business : 5 000 FCFA/mois |
|---|---|---|---|
| Factures créées par mois | 5 | Illimitées | Illimitées |
| Clients | 20 | Illimités | Illimités |
| Facture conforme, aperçu, export HTML | Oui | Oui | Oui |
| Certification FNE guidée (saisie du numéro fiscal) | Oui | Oui | Oui |
| Actions IA par mois | 5 | 50 | Illimitées |
| Logo personnalisé | Non | Oui | Oui |
| Relances IA en lot | Non | Non | Oui |
| Export Excel (CSV) | Non | Non | Oui |
| Statistiques avancées | Non | Non | Oui |
| Certification FNE automatique par API (après agrément) | Non | Non | Oui, à confirmer |

Le changement de plan est simulé dans le prototype ; le paiement par Mobile Money passera par un agrégateur de paiement.

## 9. Volet légal de FreeFact en tant qu'éditeur

FreeFact est lui-même soumis à des obligations : la plus structurante est l'autorisation de la DGI pour interfacer le logiciel à la FNE. Les autres points ci-dessous viennent de pratiques courantes et n'ont pas été vérifiés dans des textes officiels : un juriste ivoirien doit les valider avant le lancement.

| Sujet | Ce qu'il faut faire | Vérifié |
|---|---|---|
| Interfaçage API FNE | Obtenir l'autorisation du Directeur général des impôts ; passer par un éditeur ou intégrateur agréé (liste sur le portail FNE) si pas d'équipe technique interne | Source secondaire |
| Statut de l'éditeur | Créer ou confirmer l'entité exploitante (NCC, RCCM) ; elle signera les contrats et la facturation des abonnements | À décider |
| CGU / CGV | Définir le périmètre du service, les quotas, la résiliation, la restitution des données, le plafond de responsabilité | À rédiger |
| Non-conseil fiscal | Stipuler que FreeFact est un outil de gestion : l'utilisateur reste responsable de l'exactitude de ses factures et de sa conformité fiscale | À rédiger |
| Données personnelles | Politique de confidentialité ; déclaration ou autorisation auprès de l'ARTCI au titre de la loi ivoirienne de 2013 sur la protection des données | À vérifier |
| IA et sous-traitants | Informer l'utilisateur que des données de facturation (noms, montants) sont traitées par un fournisseur d'IA ; limiter ces données au strict nécessaire | À rédiger |
| Hébergement | Choisir le lieu d'hébergement et le documenter ; sauvegardes chiffrées | À décider |
| Conservation | Garder les factures émises 10 ans, y compris après résiliation, avec export à la demande | Recommandé par les guides FNE |
| Paiement des abonnements | Passer par un agrégateur de paiement agréé plutôt que d'encaisser soi-même | À vérifier |
| Marque | Vérifier la disponibilité du nom FreeFact et le déposer auprès de l'OAPI | À vérifier |

Côté utilisateur, FreeFact applique déjà les contrôles de la section 3 et affiche un rappel clair : l'outil ne remplace ni la DGI ni l'expert-comptable.

## 10. Feuille de route

Le prototype est livré ; deux portes conditionnent la suite :

1. la relecture des règles par un expert-comptable avant le lancement ;
2. l'autorisation de la DGI avant la certification par API.

Aucune date n'est fixée : à arrêter après ces deux validations.

## 11. Risques et points à faire valider

> L'application publiée est un prototype : ses données sont rattachées à chaque utilisateur dans l'application, sans sauvegarde serveur ni valeur fiscale. Elle ne doit pas servir à émettre de vraies factures avant le backend de la section 7.

| Risque | Pourquoi | Action |
|---|---|---|
| Certification FNE non automatisée | L'API exige l'autorisation de la DGI et un éditeur ou intégrateur agréé | Demander l'agrément dès maintenant ; en attendant, certification manuelle guidée |
| Règles fiscales mal appliquées | TVA, régime et obligation FNE dépendent de la situation de chaque contribuable | Faire relire les règles par un expert-comptable ivoirien avant le lancement |
| Sources non officielles | Seul un guide d'éditeur a été lu en entier ; le portail de la DGI bloque la lecture automatique | Vérifier l'arrêté n°0337 et les notes de service directement auprès de la DGI |
| Coût de l'IA | Chaque action IA est facturée à FreeFact en production | Mesurer le coût moyen par action et fixer les quotas pour garder la marge |
| Dictée vocale inégale | Dépend de la reconnaissance vocale du navigateur | Transcription côté serveur en V2 |
| Connexion Internet | La FNE se valide en ligne ; le réseau est irrégulier hors d'Abidjan | Brouillons hors ligne, certification dès que le réseau revient |
| Mobile Money | Chaque opérateur impose ses contrats et ses délais | Passer par un agrégateur ; ne pas démarrer par l'intégration directe |

## Sources

- **Guide FNE 2026 pour les PME, Cleo ERP** : lu en entier, base des sections 2 et 3.
- **Résumés de recherche, non lus en entier** : Djaboo, Kompto, CassKai, Sage Côte d'Ivoire, Yessouan, Yorine.
- **Officiels, non lus** (accès automatique bloqué ou document ancien) : portail FNE de la DGI, FAQ FNE, procédure d'édition de la facture normalisée (PDF).

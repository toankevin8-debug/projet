-- Tests des règles de conformité portées par la base.
-- Lancement : db/tests/run.sh (crée une base jetable, charge le schéma, exécute ce fichier).
\set ON_ERROR_STOP 1
SET search_path = freefact, public;
SET client_min_messages = warning;
\o /dev/null

-- Vérifie qu'une instruction échoue et que le message contient un fragment attendu.
CREATE FUNCTION pg_temp.expect_error(stmt text, fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
        IF position(fragment IN SQLERRM) = 0 THEN
            RAISE EXCEPTION 'Erreur inattendue pour « % » : % (attendu : %)', stmt, SQLERRM, fragment;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'Aucune erreur pour « % » (attendu : %)', stmt, fragment;
END
$$;

CREATE FUNCTION pg_temp.eq(actual anyelement, expected anyelement, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION '% : obtenu %, attendu %', label, actual, expected;
    END IF;
END
$$;

-- Montant en lettres -----------------------------------------------------------
SELECT pg_temp.eq(amount_in_words(0), 'zéro', '0');
SELECT pg_temp.eq(amount_in_words(1), 'un', '1');
SELECT pg_temp.eq(amount_in_words(21), 'vingt et un', '21');
SELECT pg_temp.eq(amount_in_words(71), 'soixante et onze', '71');
SELECT pg_temp.eq(amount_in_words(77), 'soixante-dix-sept', '77');
SELECT pg_temp.eq(amount_in_words(80), 'quatre-vingts', '80');
SELECT pg_temp.eq(amount_in_words(81), 'quatre-vingt-un', '81');
SELECT pg_temp.eq(amount_in_words(91), 'quatre-vingt-onze', '91');
SELECT pg_temp.eq(amount_in_words(100), 'cent', '100');
SELECT pg_temp.eq(amount_in_words(200), 'deux cents', '200');
SELECT pg_temp.eq(amount_in_words(201), 'deux cent un', '201');
SELECT pg_temp.eq(amount_in_words(1000), 'mille', '1000');
SELECT pg_temp.eq(amount_in_words(1001), 'mille un', '1001');
SELECT pg_temp.eq(amount_in_words(80000), 'quatre-vingt mille', '80000');
SELECT pg_temp.eq(amount_in_words(200000), 'deux cent mille', '200000');
SELECT pg_temp.eq(amount_in_words(155000), 'cent cinquante-cinq mille', '155000');
SELECT pg_temp.eq(amount_in_words(1000000), 'un million', '1000000');
SELECT pg_temp.eq(amount_in_words(2500000), 'deux millions cinq cent mille', '2500000');
SELECT pg_temp.eq(amount_in_words(182900), 'cent quatre-vingt-deux mille neuf cents', '182900');

-- Jeu de données ----------------------------------------------------------------
INSERT INTO users (id, fullname, email, password_hash, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Awa Koné', 'awa@example.ci', 'x', 'pro');

INSERT INTO clients (id, user_id, type, name, address)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
        'entreprise', 'Imprimerie du Plateau', NULL);

INSERT INTO invoices (id, user_id, client_id)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000c1');
INSERT INTO invoice_items (invoice_id, position, description, qty, unit_price) VALUES
    ('00000000-0000-0000-0000-0000000000f1', 1, 'Affiche A2', 3, 25000),
    ('00000000-0000-0000-0000-0000000000f1', 2, 'Logo', 1, 80000);

-- Règle 5/6 : émission bloquée sans profil, sans adresse client, sans NCC B2B.
SELECT pg_temp.expect_error($$SELECT emit_invoice('00000000-0000-0000-0000-0000000000f1')$$,
                            'Identité légale du vendeur');

INSERT INTO business_profiles (user_id, business_name, tax_regime, vat_applicable, default_terms_days)
VALUES ('00000000-0000-0000-0000-000000000001', 'Studio Awa', 'RSI', true, 15);

SELECT pg_temp.expect_error($$SELECT emit_invoice('00000000-0000-0000-0000-0000000000f1')$$, 'NCC du vendeur');
UPDATE business_profiles SET ncc = 'CI-2024-0001234A', address = 'Cocody, Abidjan', tax_center = 'Cocody'
WHERE user_id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($$SELECT emit_invoice('00000000-0000-0000-0000-0000000000f1')$$, 'NCC obligatoire');
UPDATE clients SET address = 'Plateau, Abidjan', ncc = 'CI-2019-0099887B'
WHERE id = '00000000-0000-0000-0000-0000000000c1';

-- Brouillon : pas de numéro ; émission directe par UPDATE interdite.
SELECT pg_temp.expect_error($$UPDATE invoices SET status = 'emise' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
                            'emit_invoice');

-- Règle 1, 4, 8, 9 : émission.
SELECT emit_invoice('00000000-0000-0000-0000-0000000000f1');
SELECT pg_temp.eq((SELECT number FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'),
                  'FA-' || extract(year FROM current_date) || '-0001', 'numéro');
SELECT pg_temp.eq((SELECT total_ht FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'), 155000::bigint, 'HT');
SELECT pg_temp.eq((SELECT total_vat FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'), 27900::bigint, 'TVA');
SELECT pg_temp.eq((SELECT total_ttc FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'), 182900::bigint, 'TTC');
SELECT pg_temp.eq((SELECT due_date FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'),
                  current_date + 15, 'échéance');
SELECT pg_temp.eq((SELECT amount_in_words FROM invoice_overview WHERE id = '00000000-0000-0000-0000-0000000000f1'),
                  'Arrêtée la présente facture à la somme de cent quatre-vingt-deux mille neuf cents francs CFA (182900 FCFA).',
                  'mention en lettres');

-- Règle 4 : modifier le profil ne change pas la facture émise.
UPDATE business_profiles SET business_name = 'Studio Awa SARL' WHERE user_id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.eq((SELECT seller_snapshot->>'business_name' FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'),
                  'Studio Awa', 'photographie vendeur');

-- Règle 2 : figée.
SELECT pg_temp.expect_error($$UPDATE invoices SET notes = 'x' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$, 'avoir');
SELECT pg_temp.expect_error($$UPDATE invoice_items SET unit_price = 1 WHERE invoice_id = '00000000-0000-0000-0000-0000000000f1'$$,
                            'verrouillées');
SELECT pg_temp.expect_error($$DELETE FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'$$, 'suppression interdite');
SELECT pg_temp.expect_error($$DELETE FROM clients WHERE id = '00000000-0000-0000-0000-0000000000c1'$$, 'suppression refusée');
SELECT pg_temp.expect_error($$SELECT emit_invoice('00000000-0000-0000-0000-0000000000f1')$$, 'déjà émise');

-- Règle 10 : envoi et relance bloqués avant certification.
SELECT pg_temp.eq((SELECT to_certify FROM invoice_overview WHERE id = '00000000-0000-0000-0000-0000000000f1'), true, 'à certifier');
SELECT pg_temp.expect_error($$SELECT mark_invoice_sent('00000000-0000-0000-0000-0000000000f1')$$, 'pas certifiée');
SELECT pg_temp.expect_error($$INSERT INTO reminders (user_id, invoice_id, channel, tone)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'whatsapp', 'amical')$$,
    'non certifiée');
SELECT record_fne_certification('00000000-0000-0000-0000-0000000000f1', 'FNE-2026-ABC123', now(), 'QR-REF-1');
SELECT pg_temp.expect_error($$SELECT record_fne_certification('00000000-0000-0000-0000-0000000000f1', 'AUTRE', now())$$,
                            'duplicate key');
SELECT pg_temp.expect_error($$UPDATE fne_certifications SET fiscal_number = 'X'$$, 'écriture seule');
SELECT mark_invoice_sent('00000000-0000-0000-0000-0000000000f1');
SELECT pg_temp.eq((SELECT sent_at IS NOT NULL FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'), true, 'envoyée');

-- Paiements : partiel, plafond, total.
INSERT INTO payments (user_id, invoice_id, amount, method, reference)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 100000, 'wave', 'W-1');
SELECT pg_temp.eq((SELECT status FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'),
                  'partiellement_payee'::invoice_status, 'partiel');
SELECT pg_temp.expect_error($$INSERT INTO payments (user_id, invoice_id, amount, method)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 90000, 'especes')$$,
    'supérieur au reste');
SELECT pg_temp.expect_error($$UPDATE invoices SET status = 'payee' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$,
                            'découle');

-- Règle 3 : avoir partiel, plafonné au solde créditable, qui ramène le reste à payer.
INSERT INTO invoices (id, user_id, client_id, ref_invoice_id, kind)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'avoir');
INSERT INTO invoice_items (invoice_id, position, description, qty, unit_price)
VALUES ('00000000-0000-0000-0000-0000000000a1', 1, 'Affiche A2 non livrée', 1, 25000);
SELECT emit_invoice('00000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.eq((SELECT number FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000a1'),
                  'AV-' || extract(year FROM current_date) || '-0001', 'numéro avoir');
SELECT pg_temp.eq((SELECT remaining FROM invoice_overview WHERE id = '00000000-0000-0000-0000-0000000000f1'),
                  182900::bigint - 29500 - 100000, 'reste après avoir');

-- Avoir total au-delà du solde créditable : refusé.
SELECT create_credit_note('00000000-0000-0000-0000-0000000000f1') AS full_credit \gset
SELECT pg_temp.expect_error(format('SELECT emit_invoice(%L)', :'full_credit'), 'solde créditable');
DELETE FROM invoices WHERE id = :'full_credit';

-- Solde par paiement.
INSERT INTO payments (user_id, invoice_id, amount, method)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 53400, 'orange_money');
SELECT pg_temp.eq((SELECT status FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'payee'::invoice_status, 'payée');

-- Numérotation continue : la facture suivante prend 0002, même après un échec d'émission.
INSERT INTO invoices (id, user_id, client_id)
VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000c1');
SELECT pg_temp.expect_error($$SELECT emit_invoice('00000000-0000-0000-0000-0000000000f2')$$, 'aucune ligne');
INSERT INTO invoice_items (invoice_id, position, description, qty, unit_price)
VALUES ('00000000-0000-0000-0000-0000000000f2', 1, 'Carte de visite', 100, 150);
SELECT emit_invoice('00000000-0000-0000-0000-0000000000f2');
SELECT pg_temp.eq((SELECT number FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f2'),
                  'FA-' || extract(year FROM current_date) || '-0002', 'numéro sans trou');

-- Annulation totale par avoir sur une facture non payée.
SELECT create_credit_note('00000000-0000-0000-0000-0000000000f2') AS cancel_credit \gset
SELECT emit_invoice(:'cancel_credit');
SELECT pg_temp.eq((SELECT status FROM invoices WHERE id = '00000000-0000-0000-0000-0000000000f2'), 'annulee'::invoice_status, 'annulée');
SELECT pg_temp.expect_error($$INSERT INTO payments (user_id, invoice_id, amount, method)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 1, 'especes')$$, 'non annulée');

-- Devis → brouillon de facture.
INSERT INTO quotes (id, user_id, client_id) VALUES
    ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1');
INSERT INTO quote_items (quote_id, position, description, qty, unit_price)
VALUES ('00000000-0000-0000-0000-0000000000d1', 1, 'Site vitrine', 1, 450000);
SELECT pg_temp.eq((SELECT number FROM quotes WHERE id = '00000000-0000-0000-0000-0000000000d1'),
                  'DV-' || extract(year FROM current_date) || '-0001', 'numéro devis');
SELECT convert_quote_to_invoice('00000000-0000-0000-0000-0000000000d1') AS from_quote \gset
SELECT pg_temp.eq((SELECT count(*) FROM invoice_items WHERE invoice_id = :'from_quote'), 1::bigint, 'lignes reprises');
SELECT pg_temp.eq((SELECT status FROM invoices WHERE id = :'from_quote'), 'brouillon'::invoice_status, 'brouillon');

-- Quotas IA : 50 par mois en Pro.
SELECT record_ai_usage('00000000-0000-0000-0000-000000000001', 'facture_express') FROM generate_series(1, 50);
SELECT pg_temp.expect_error($$SELECT record_ai_usage('00000000-0000-0000-0000-000000000001', 'relance')$$, 'Quota IA');

-- Plan gratuit : 5 factures par mois.
INSERT INTO users (id, fullname, email, google_id) VALUES ('00000000-0000-0000-0000-000000000002', 'Yao', 'yao@example.ci', 'g-1');
INSERT INTO clients (id, user_id, name) VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000002', 'Client');
INSERT INTO invoices (user_id, client_id)
SELECT '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2' FROM generate_series(1, 5);
SELECT pg_temp.expect_error($$INSERT INTO invoices (user_id, client_id)
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2')$$, '5 factures');

-- Cloisonnement : une facture ne peut pas viser le client d'un autre utilisateur.
SELECT pg_temp.expect_error($$INSERT INTO invoices (user_id, client_id)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2')$$, 'foreign key');

-- Journal d'audit en écriture seule.
SELECT pg_temp.expect_error($$DELETE FROM audit_log$$, 'écriture seule');

\o
\echo 'Tous les tests de règles passent'

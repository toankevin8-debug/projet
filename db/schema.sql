-- FreeFact — modèle de données v2 (PostgreSQL >= 13)
--
-- Traduit la section 6 du cahier des charges (docs/cahier-des-charges-mvp-v2.md)
-- et fait porter par la base les règles d'intégrité de la section 3 :
--   1. numérotation continue par année, sans trou (compteur atomique, attribué à l'émission)
--   2. facture figée après émission (déclencheurs refusant UPDATE / DELETE)
--   3. correction par avoir lié à la facture d'origine, plafonné au solde créditable
--   4. photographie du vendeur, du client et de la TVA à l'émission
--   5-6. identité du vendeur et du client contrôlée avant émission (points bloquants)
--   8. totaux HT / TVA / TTC calculés par la base, montant en lettres
--   9. échéance calculée à l'émission
--   10. envoi bloqué tant que la facture n'est pas certifiée FNE
--   11. documents émis non supprimables, journal d'audit en écriture seule
--
-- Tous les montants sont des entiers en FCFA.
-- Les fonctions de cycle de vie (emit_invoice, record_fne_certification, mark_invoice_sent,
-- create_credit_note, convert_quote_to_invoice, record_ai_usage) sont les seules
-- portes d'entrée pour les changements d'état : l'API FreeFact les appelle.

BEGIN;

CREATE SCHEMA IF NOT EXISTS freefact;
SET search_path = freefact, public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

CREATE TYPE plan_type        AS ENUM ('gratuit', 'pro', 'business');
CREATE TYPE tax_regime       AS ENUM ('RNI', 'RSI', 'RME', 'entreprenant');
CREATE TYPE client_type      AS ENUM ('particulier', 'entreprise');
CREATE TYPE quote_status     AS ENUM ('brouillon', 'envoye', 'accepte', 'refuse', 'expire');
CREATE TYPE invoice_kind     AS ENUM ('facture', 'avoir');
-- « en retard » n'est pas stocké : il dépend de la date du jour (voir la vue invoice_overview).
CREATE TYPE invoice_status   AS ENUM ('brouillon', 'emise', 'partiellement_payee', 'payee', 'annulee');
CREATE TYPE fne_mode         AS ENUM ('manuel', 'api');
CREATE TYPE payment_method   AS ENUM ('orange_money', 'mtn_money', 'moov_money', 'wave',
                                      'especes', 'virement', 'cheque');
CREATE TYPE reminder_channel AS ENUM ('email', 'whatsapp');
CREATE TYPE reminder_tone    AS ENUM ('amical', 'cordial', 'ferme', 'dernier_rappel');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fullname          text NOT NULL,
    email             text NOT NULL,
    phone             text,
    password_hash     text,                 -- nul si inscription Google
    google_id         text UNIQUE,
    email_verified_at timestamptz,
    plan              plan_type NOT NULL DEFAULT 'gratuit',
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_auth_method CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE business_profiles (
    user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    business_name      text NOT NULL,
    legal_form         text,
    ncc                text,
    rccm               text,
    capital            bigint CHECK (capital >= 0),
    tax_regime         tax_regime,
    tax_center         text,
    address            text,
    city               text,
    country            text NOT NULL DEFAULT 'Côte d''Ivoire',
    phone              text,
    email_pro          text,
    logo_url           text,
    vat_applicable     boolean NOT NULL DEFAULT false,
    vat_rate           numeric(5,2) NOT NULL DEFAULT 18 CHECK (vat_rate >= 0 AND vat_rate < 100),
    payment_info       text,
    late_penalty_text  text,
    signature_text     text,
    invoice_prefix     text NOT NULL DEFAULT 'FA' CHECK (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
    credit_note_prefix text NOT NULL DEFAULT 'AV' CHECK (credit_note_prefix ~ '^[A-Z0-9]{1,8}$'),
    quote_prefix       text NOT NULL DEFAULT 'DV' CHECK (quote_prefix ~ '^[A-Z0-9]{1,8}$'),
    default_terms_days integer NOT NULL DEFAULT 30 CHECK (default_terms_days BETWEEN 0 AND 365),
    fne_registered     boolean NOT NULL DEFAULT false,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_distinct_prefixes
        CHECK (invoice_prefix <> credit_note_prefix AND invoice_prefix <> quote_prefix
               AND credit_note_prefix <> quote_prefix)
);

CREATE TABLE clients (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       client_type NOT NULL DEFAULT 'particulier',
    name       text NOT NULL,
    ncc        text,
    phone      text,
    email      text,
    address    text,
    notes      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id)
);
CREATE INDEX clients_user_idx ON clients (user_id);

CREATE TABLE quotes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_id   uuid NOT NULL,
    number      text,                       -- non fiscal, attribué à la création
    status      quote_status NOT NULL DEFAULT 'brouillon',
    issue_date  date NOT NULL DEFAULT current_date,
    valid_until date,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id),
    UNIQUE (user_id, number),
    FOREIGN KEY (client_id, user_id) REFERENCES clients (id, user_id) ON DELETE CASCADE
);

CREATE TABLE quote_items (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id       uuid NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
    position       integer NOT NULL CHECK (position > 0),
    description    text NOT NULL CHECK (btrim(description) <> ''),
    qty            numeric(12,3) NOT NULL CHECK (qty > 0),
    unit_price     bigint NOT NULL CHECK (unit_price >= 0),
    vat_applicable boolean NOT NULL DEFAULT true,
    UNIQUE (quote_id, position)
);

CREATE TABLE invoices (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_id      uuid NOT NULL,
    quote_id       uuid,
    ref_invoice_id uuid,                    -- facture d'origine d'un avoir
    kind           invoice_kind NOT NULL DEFAULT 'facture',
    number         text,                    -- nul tant que brouillon
    status         invoice_status NOT NULL DEFAULT 'brouillon',
    issue_date     date,
    terms_days     integer CHECK (terms_days BETWEEN 0 AND 365),
    due_date       date,
    vat_applicable boolean,
    vat_rate       numeric(5,2) CHECK (vat_rate >= 0 AND vat_rate < 100),
    notes          text,
    total_ht       bigint NOT NULL DEFAULT 0 CHECK (total_ht >= 0),
    total_vat      bigint NOT NULL DEFAULT 0 CHECK (total_vat >= 0),
    total_ttc      bigint NOT NULL DEFAULT 0 CHECK (total_ttc >= 0),
    seller_snapshot jsonb,
    buyer_snapshot  jsonb,
    emitted_at     timestamptz,
    sent_at        timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id),
    UNIQUE (user_id, number),
    FOREIGN KEY (client_id, user_id)      REFERENCES clients (id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (quote_id, user_id)       REFERENCES quotes (id, user_id),
    FOREIGN KEY (ref_invoice_id, user_id) REFERENCES invoices (id, user_id),
    CONSTRAINT invoices_credit_note_ref
        CHECK ((kind = 'avoir') = (ref_invoice_id IS NOT NULL)),
    CONSTRAINT invoices_emission_fields
        CHECK (status = 'brouillon'
               OR (number IS NOT NULL AND issue_date IS NOT NULL AND due_date IS NOT NULL
                   AND emitted_at IS NOT NULL AND vat_applicable IS NOT NULL
                   AND vat_rate IS NOT NULL AND seller_snapshot IS NOT NULL
                   AND buyer_snapshot IS NOT NULL)),
    CONSTRAINT invoices_draft_unnumbered
        CHECK (status <> 'brouillon' OR (number IS NULL AND emitted_at IS NULL AND sent_at IS NULL)),
    CONSTRAINT invoices_totals CHECK (total_ttc = total_ht + total_vat)
);
CREATE INDEX invoices_user_status_idx ON invoices (user_id, status);
CREATE INDEX invoices_ref_idx ON invoices (ref_invoice_id) WHERE ref_invoice_id IS NOT NULL;

CREATE TABLE invoice_items (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id     uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    position       integer NOT NULL CHECK (position > 0),
    description    text NOT NULL CHECK (btrim(description) <> ''),
    qty            numeric(12,3) NOT NULL CHECK (qty > 0),
    unit_price     bigint NOT NULL CHECK (unit_price >= 0),
    vat_applicable boolean NOT NULL DEFAULT true,
    UNIQUE (invoice_id, position)
);

CREATE TABLE fne_certifications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id    uuid NOT NULL UNIQUE REFERENCES invoices (id),
    fiscal_number text NOT NULL CHECK (btrim(fiscal_number) <> ''),
    certified_at  timestamptz NOT NULL,
    qr_reference  text,
    document_url  text,
    mode          fne_mode NOT NULL DEFAULT 'manuel',
    api_response  jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id),
    invoice_id   uuid NOT NULL,
    amount       bigint NOT NULL CHECK (amount > 0),
    payment_date date NOT NULL DEFAULT current_date,
    method       payment_method NOT NULL,
    reference    text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (invoice_id, user_id) REFERENCES invoices (id, user_id)
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);

CREATE TABLE reminders (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id),
    invoice_id   uuid NOT NULL,
    channel      reminder_channel NOT NULL,
    tone         reminder_tone NOT NULL,
    message      text,
    sent_at      timestamptz NOT NULL DEFAULT now(),
    ai_generated boolean NOT NULL DEFAULT false,
    FOREIGN KEY (invoice_id, user_id) REFERENCES invoices (id, user_id)
);

CREATE TABLE counters (
    user_id     uuid NOT NULL REFERENCES users (id),
    prefix      text NOT NULL,
    year        integer NOT NULL,
    last_number integer NOT NULL CHECK (last_number > 0),
    PRIMARY KEY (user_id, prefix, year)
);

CREATE TABLE ai_usage (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    month   date NOT NULL CHECK (month = date_trunc('month', month)::date),
    action  text NOT NULL,
    cost    integer NOT NULL DEFAULT 0 CHECK (cost >= 0),   -- coût interne, en FCFA
    at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_user_month_idx ON ai_usage (user_id, month);

CREATE TABLE audit_log (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id   uuid NOT NULL REFERENCES users (id),
    entity    text NOT NULL,
    entity_id uuid NOT NULL,
    action    text NOT NULL,
    details   jsonb,
    at        timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

-- Quotas par plan (section 8). NULL = illimité.
CREATE TABLE plan_limits (
    plan                   plan_type PRIMARY KEY,
    invoices_per_month     integer,
    clients                integer,
    ai_actions_per_month   integer,
    custom_logo            boolean NOT NULL,
    batch_ai_reminders     boolean NOT NULL,
    csv_export             boolean NOT NULL,
    advanced_stats         boolean NOT NULL,
    fne_api_certification  boolean NOT NULL
);
INSERT INTO plan_limits VALUES
    ('gratuit',  5,    20,   5,    false, false, false, false, false),
    ('pro',      NULL, NULL, 50,   true,  false, false, false, false),
    ('business', NULL, NULL, NULL, true,  true,  true,  true,  true);

-- ---------------------------------------------------------------------------
-- Utilitaires
-- ---------------------------------------------------------------------------

-- Les fonctions de cycle de vie ouvrent ce drapeau, local à la transaction, pour
-- signaler aux déclencheurs qu'un changement d'état passe par la bonne porte.
CREATE FUNCTION internal_on() RETURNS void LANGUAGE sql AS
$$ SELECT set_config('freefact.internal', 'on', true) $$;

CREATE FUNCTION internal_off() RETURNS void LANGUAGE sql AS
$$ SELECT set_config('freefact.internal', 'off', true) $$;

CREATE FUNCTION is_internal() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('freefact.internal', true), 'off') = 'on' $$;

-- Montant en toutes lettres, orthographe traditionnelle (« quatre-vingts », « deux cents »,
-- « vingt et un »). Utilisé pour la mention « Arrêtée la présente facture à la somme de… ».
CREATE FUNCTION amount_in_words(n bigint) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    units text[] := ARRAY['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf',
                          'dix','onze','douze','treize','quatorze','quinze','seize',
                          'dix-sept','dix-huit','dix-neuf'];
    tens  text[] := ARRAY['', '', 'vingt','trente','quarante','cinquante','soixante'];
    scales text[] := ARRAY['', 'mille', 'million', 'milliard', 'billion'];
    result text := '';
    chunk  integer;
    i      integer := 0;
    words  text;
    rest   bigint := n;
BEGIN
    IF n < 0 THEN
        RETURN 'moins ' || amount_in_words(-n);
    END IF;
    IF n = 0 THEN
        RETURN 'zéro';
    END IF;

    WHILE rest > 0 LOOP
        chunk := (rest % 1000)::integer;
        IF chunk > 0 THEN
            words := freefact.below_thousand_in_words(chunk, units, tens, i > 0);
            IF i = 1 THEN
                -- « mille » est invariable et ne prend pas « un » devant.
                words := CASE WHEN chunk = 1 THEN 'mille' ELSE words || ' mille' END;
            ELSIF i >= 2 THEN
                words := words || ' ' || scales[i + 1] || CASE WHEN chunk > 1 THEN 's' ELSE '' END;
            END IF;
            result := CASE WHEN result = '' THEN words ELSE words || ' ' || result END;
        END IF;
        rest := rest / 1000;
        i := i + 1;
    END LOOP;
    RETURN result;
END
$$;

-- before_scale : le nombre est suivi de « mille », « million »… ; dans ce cas
-- « quatre-vingt » et « cent » ne prennent pas de « s » devant « mille ».
CREATE FUNCTION below_thousand_in_words(n integer, units text[], tens text[], before_scale boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    h integer := n / 100;
    r integer := n % 100;
    t integer;
    u integer;
    words text := '';
    rest_words text := '';
BEGIN
    IF r > 0 THEN
        IF r < 20 THEN
            rest_words := units[r + 1];
        ELSE
            t := r / 10;
            u := r % 10;
            IF t IN (7, 9) THEN
                -- 70-79 : soixante-dix… ; 90-99 : quatre-vingt-dix…
                rest_words := CASE WHEN t = 7 THEN 'soixante' ELSE 'quatre-vingt' END
                              || CASE WHEN t = 7 AND u = 1 THEN ' et ' ELSE '-' END
                              || units[10 + u + 1];
            ELSIF t = 8 THEN
                rest_words := 'quatre-vingt'
                              || CASE WHEN u = 0 THEN (CASE WHEN before_scale THEN '' ELSE 's' END)
                                      ELSE '-' || units[u + 1] END;
            ELSE
                rest_words := tens[t + 1]
                              || CASE WHEN u = 0 THEN ''
                                      WHEN u = 1 THEN ' et un'
                                      ELSE '-' || units[u + 1] END;
            END IF;
        END IF;
    END IF;

    IF h > 0 THEN
        words := CASE WHEN h = 1 THEN 'cent' ELSE units[h + 1] || ' cent' END;
        IF r = 0 AND h > 1 AND NOT before_scale THEN
            words := words || 's';
        END IF;
    END IF;

    IF words = '' THEN
        RETURN rest_words;
    ELSIF rest_words = '' THEN
        RETURN words;
    END IF;
    RETURN words || ' ' || rest_words;
END
$$;

CREATE FUNCTION invoice_legal_sentence(total_ttc bigint, kind invoice_kind DEFAULT 'facture')
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT 'Arrêtée la présente ' || CASE WHEN kind = 'avoir' THEN 'facture d''avoir' ELSE 'facture' END
           || ' à la somme de ' || freefact.amount_in_words(total_ttc) || ' francs CFA ('
           || regexp_replace(total_ttc::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g') || ' FCFA).'
$$;

-- Attribue le numéro suivant d'une série (préfixe, année) de façon atomique.
-- Appelée dans la transaction d'émission : un échec annule aussi l'incrément,
-- la numérotation reste donc sans trou.
CREATE FUNCTION next_number(p_user uuid, p_prefix text, p_year integer) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO freefact.counters AS c (user_id, prefix, year, last_number)
    VALUES (p_user, p_prefix, p_year, 1)
    ON CONFLICT (user_id, prefix, year) DO UPDATE SET last_number = c.last_number + 1
    RETURNING last_number INTO n;
    RETURN p_prefix || '-' || p_year || '-' || lpad(n::text, greatest(4, length(n::text)), '0');
END
$$;

CREATE FUNCTION write_audit(p_user uuid, p_entity text, p_entity_id uuid, p_action text, p_details jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO freefact.audit_log (user_id, entity, entity_id, action, details)
    VALUES (p_user, p_entity, p_entity_id, p_action, p_details)
$$;

-- Totaux d'une facture à partir de ses lignes. Chaque ligne est arrondie au franc,
-- la TVA est calculée sur la base HT des lignes soumises à TVA.
CREATE FUNCTION compute_invoice_totals(p_invoice uuid, p_vat_applicable boolean, p_vat_rate numeric,
                                       OUT total_ht bigint, OUT total_vat bigint, OUT total_ttc bigint)
LANGUAGE sql STABLE AS $$
    WITH lines AS (
        SELECT round(qty * unit_price)::bigint AS ht, vat_applicable
        FROM freefact.invoice_items WHERE invoice_id = p_invoice
    ), sums AS (
        SELECT coalesce(sum(ht), 0)::bigint AS ht,
               coalesce(sum(ht) FILTER (WHERE vat_applicable), 0)::bigint AS taxable
        FROM lines
    )
    SELECT ht,
           CASE WHEN p_vat_applicable THEN round(taxable * p_vat_rate / 100)::bigint ELSE 0 END,
           ht + CASE WHEN p_vat_applicable THEN round(taxable * p_vat_rate / 100)::bigint ELSE 0 END
    FROM sums
$$;

-- Montant déjà crédité par des avoirs émis sur une facture.
CREATE FUNCTION credited_amount(p_invoice uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(total_ttc), 0)::bigint FROM freefact.invoices
    WHERE ref_invoice_id = p_invoice AND kind = 'avoir' AND status <> 'brouillon'
$$;

CREATE FUNCTION paid_amount(p_invoice uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(amount), 0)::bigint FROM freefact.payments WHERE invoice_id = p_invoice
$$;

-- ---------------------------------------------------------------------------
-- Contrôle de conformité (règles 5, 6, 7) : points bloquants et avertissements
-- ---------------------------------------------------------------------------

CREATE FUNCTION compliance_check(p_invoice uuid)
RETURNS TABLE (level text, code text, message text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    inv freefact.invoices;
    prof freefact.business_profiles;
    cli freefact.clients;
    item_count integer;
    vat_expected boolean;
BEGIN
    SELECT * INTO inv FROM freefact.invoices WHERE id = p_invoice;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facture % introuvable', p_invoice USING ERRCODE = 'no_data_found';
    END IF;
    SELECT * INTO prof FROM freefact.business_profiles WHERE user_id = inv.user_id;
    SELECT * INTO cli FROM freefact.clients WHERE id = inv.client_id;
    SELECT count(*) INTO item_count FROM freefact.invoice_items WHERE invoice_id = p_invoice;

    IF prof.user_id IS NULL THEN
        RETURN QUERY SELECT 'bloquant', 'seller_profile_missing', 'Identité légale du vendeur non renseignée';
    ELSE
        IF coalesce(btrim(prof.ncc), '') = '' THEN
            RETURN QUERY SELECT 'bloquant', 'seller_ncc_missing', 'NCC du vendeur manquant';
        END IF;
        IF coalesce(btrim(prof.address), '') = '' THEN
            RETURN QUERY SELECT 'bloquant', 'seller_address_missing', 'Adresse du vendeur manquante';
        END IF;
        IF prof.tax_regime IS NULL THEN
            RETURN QUERY SELECT 'avertissement', 'seller_regime_missing', 'Régime d''imposition non renseigné';
        ELSE
            vat_expected := prof.tax_regime IN ('RNI', 'RSI');
            IF coalesce(inv.vat_applicable, prof.vat_applicable) <> vat_expected THEN
                RETURN QUERY SELECT 'avertissement', 'vat_regime_mismatch',
                    CASE WHEN vat_expected
                         THEN 'TVA non appliquée alors que le régime ' || prof.tax_regime || ' y est normalement soumis'
                         ELSE 'TVA appliquée alors que le régime ' || prof.tax_regime || ' n''y est normalement pas soumis'
                    END || ' : à confirmer avec le centre des impôts';
            END IF;
        END IF;
        IF coalesce(btrim(prof.tax_center), '') = '' THEN
            RETURN QUERY SELECT 'avertissement', 'seller_tax_center_missing', 'Centre des impôts non renseigné';
        END IF;
        IF NOT prof.fne_registered THEN
            RETURN QUERY SELECT 'avertissement', 'seller_not_fne_registered',
                'Inscription à la plateforme FNE non confirmée : la facture devra être certifiée avant envoi';
        END IF;
    END IF;

    IF coalesce(btrim(cli.address), '') = '' THEN
        RETURN QUERY SELECT 'bloquant', 'buyer_address_missing', 'Adresse du client manquante';
    END IF;
    IF cli.type = 'entreprise' AND coalesce(btrim(cli.ncc), '') = '' THEN
        RETURN QUERY SELECT 'bloquant', 'buyer_ncc_missing', 'NCC obligatoire pour un client entreprise';
    END IF;
    IF item_count = 0 THEN
        RETURN QUERY SELECT 'bloquant', 'no_items', 'La facture ne comporte aucune ligne';
    END IF;
    IF inv.kind = 'facture' AND item_count > 0 AND NOT EXISTS (
        SELECT 1 FROM freefact.invoice_items WHERE invoice_id = p_invoice AND unit_price > 0) THEN
        RETURN QUERY SELECT 'avertissement', 'zero_amount', 'Toutes les lignes sont à 0 FCFA';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Cycle de vie
-- ---------------------------------------------------------------------------

-- Émission : contrôle, calcul des totaux, photographie, numérotation, échéance.
CREATE FUNCTION emit_invoice(p_invoice uuid) RETURNS freefact.invoices
LANGUAGE plpgsql AS $$
DECLARE
    inv freefact.invoices;
    prof freefact.business_profiles;
    cli freefact.clients;
    ref freefact.invoices;
    blocking text;
    totals record;
    v_issue date := current_date;
    v_prefix text;
BEGIN
    SELECT * INTO inv FROM freefact.invoices WHERE id = p_invoice FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facture % introuvable', p_invoice USING ERRCODE = 'no_data_found';
    END IF;
    IF inv.status <> 'brouillon' THEN
        RAISE EXCEPTION 'La facture % est déjà émise', inv.number USING ERRCODE = 'check_violation';
    END IF;

    SELECT string_agg(c.message, ' ; ') INTO blocking
    FROM freefact.compliance_check(p_invoice) c WHERE c.level = 'bloquant';
    IF blocking IS NOT NULL THEN
        RAISE EXCEPTION 'Émission impossible : %', blocking USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO prof FROM freefact.business_profiles WHERE user_id = inv.user_id;
    SELECT * INTO cli FROM freefact.clients WHERE id = inv.client_id;

    inv.vat_applicable := coalesce(inv.vat_applicable, prof.vat_applicable);
    inv.vat_rate := CASE WHEN inv.vat_applicable THEN coalesce(inv.vat_rate, prof.vat_rate) ELSE 0 END;
    inv.terms_days := coalesce(inv.terms_days, prof.default_terms_days);
    totals := freefact.compute_invoice_totals(p_invoice, inv.vat_applicable, inv.vat_rate);

    IF inv.kind = 'avoir' THEN
        -- Verrou sur la facture d'origine : deux avoirs simultanés ne peuvent pas dépasser le solde.
        SELECT * INTO ref FROM freefact.invoices WHERE id = inv.ref_invoice_id FOR UPDATE;
        IF ref.kind <> 'facture' OR ref.status = 'brouillon' THEN
            RAISE EXCEPTION 'Un avoir doit se rapporter à une facture émise' USING ERRCODE = 'check_violation';
        END IF;
        IF ref.client_id <> inv.client_id THEN
            RAISE EXCEPTION 'L''avoir doit concerner le même client que la facture d''origine'
                USING ERRCODE = 'check_violation';
        END IF;
        IF totals.total_ttc <= 0 THEN
            RAISE EXCEPTION 'Un avoir doit avoir un montant positif' USING ERRCODE = 'check_violation';
        END IF;
        IF totals.total_ttc > ref.total_ttc - freefact.credited_amount(ref.id) THEN
            RAISE EXCEPTION 'Avoir de % FCFA supérieur au solde créditable de % (% FCFA)',
                totals.total_ttc, ref.number, ref.total_ttc - freefact.credited_amount(ref.id)
                USING ERRCODE = 'check_violation';
        END IF;
        v_prefix := prof.credit_note_prefix;
    ELSE
        v_prefix := prof.invoice_prefix;
    END IF;

    PERFORM freefact.internal_on();
    UPDATE freefact.invoices SET
        number          = freefact.next_number(inv.user_id, v_prefix, extract(year FROM v_issue)::integer),
        status          = 'emise',
        issue_date      = v_issue,
        terms_days      = inv.terms_days,
        due_date        = v_issue + inv.terms_days,
        vat_applicable  = inv.vat_applicable,
        vat_rate        = inv.vat_rate,
        total_ht        = totals.total_ht,
        total_vat       = totals.total_vat,
        total_ttc       = totals.total_ttc,
        seller_snapshot = jsonb_build_object(
            'business_name', prof.business_name, 'legal_form', prof.legal_form, 'ncc', prof.ncc,
            'rccm', prof.rccm, 'capital', prof.capital, 'tax_regime', prof.tax_regime,
            'tax_center', prof.tax_center, 'address', prof.address, 'city', prof.city,
            'country', prof.country, 'phone', prof.phone, 'email', prof.email_pro,
            'logo_url', prof.logo_url, 'payment_info', prof.payment_info,
            'late_penalty_text', prof.late_penalty_text, 'signature_text', prof.signature_text),
        buyer_snapshot  = jsonb_build_object(
            'type', cli.type, 'name', cli.name, 'ncc', cli.ncc, 'address', cli.address,
            'phone', cli.phone, 'email', cli.email),
        emitted_at      = now()
    WHERE id = p_invoice
    RETURNING * INTO inv;

    IF inv.kind = 'avoir' THEN
        PERFORM freefact.refresh_invoice_status(inv.ref_invoice_id);
    END IF;
    PERFORM freefact.internal_off();

    PERFORM freefact.write_audit(inv.user_id, 'invoice', inv.id, 'emit',
        jsonb_build_object('number', inv.number, 'total_ttc', inv.total_ttc));
    RETURN inv;
END
$$;

-- Statut de paiement d'une facture émise, recalculé après paiement ou avoir.
CREATE FUNCTION refresh_invoice_status(p_invoice uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    inv freefact.invoices;
    credited bigint;
    paid bigint;
    new_status freefact.invoice_status;
BEGIN
    SELECT * INTO inv FROM freefact.invoices WHERE id = p_invoice;
    IF inv.kind <> 'facture' OR inv.status = 'brouillon' THEN
        RETURN;
    END IF;
    credited := freefact.credited_amount(p_invoice);
    paid := freefact.paid_amount(p_invoice);
    new_status := CASE
        WHEN credited >= inv.total_ttc AND inv.total_ttc > 0 THEN 'annulee'
        WHEN paid >= inv.total_ttc - credited THEN 'payee'
        WHEN paid > 0 THEN 'partiellement_payee'
        ELSE 'emise'
    END;
    IF new_status <> inv.status THEN
        PERFORM freefact.internal_on();
        UPDATE freefact.invoices SET status = new_status WHERE id = p_invoice;
        PERFORM freefact.write_audit(inv.user_id, 'invoice', inv.id, 'status',
            jsonb_build_object('from', inv.status, 'to', new_status));
        PERFORM freefact.internal_off();
    END IF;
END
$$;

-- Certification FNE (règle 10). Mode manuel : numéro fiscal saisi par l'utilisateur.
CREATE FUNCTION record_fne_certification(p_invoice uuid, p_fiscal_number text, p_certified_at timestamptz,
                                         p_qr_reference text DEFAULT NULL, p_document_url text DEFAULT NULL,
                                         p_mode fne_mode DEFAULT 'manuel', p_api_response jsonb DEFAULT NULL)
RETURNS freefact.fne_certifications LANGUAGE plpgsql AS $$
DECLARE
    cert freefact.fne_certifications;
BEGIN
    INSERT INTO freefact.fne_certifications
        (invoice_id, fiscal_number, certified_at, qr_reference, document_url, mode, api_response)
    VALUES (p_invoice, btrim(p_fiscal_number), p_certified_at, p_qr_reference, p_document_url, p_mode, p_api_response)
    RETURNING * INTO cert;
    RETURN cert;
END
$$;

-- Envoi au client : refusé tant que la facture n'est pas certifiée.
CREATE FUNCTION mark_invoice_sent(p_invoice uuid) RETURNS freefact.invoices
LANGUAGE plpgsql AS $$
DECLARE
    inv freefact.invoices;
BEGIN
    UPDATE freefact.invoices SET sent_at = coalesce(sent_at, now())
    WHERE id = p_invoice RETURNING * INTO inv;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Facture % introuvable', p_invoice USING ERRCODE = 'no_data_found';
    END IF;
    RETURN inv;
END
$$;

-- Avoir total en brouillon : reprend les lignes de la facture d'origine.
-- Pour un avoir partiel, l'utilisateur modifie ou retire des lignes avant émission.
CREATE FUNCTION create_credit_note(p_invoice uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    ref freefact.invoices;
    new_id uuid;
BEGIN
    SELECT * INTO ref FROM freefact.invoices WHERE id = p_invoice;
    IF NOT FOUND OR ref.kind <> 'facture' OR ref.status = 'brouillon' THEN
        RAISE EXCEPTION 'Un avoir doit se rapporter à une facture émise' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO freefact.invoices (user_id, client_id, ref_invoice_id, kind, terms_days, vat_applicable, vat_rate)
    VALUES (ref.user_id, ref.client_id, ref.id, 'avoir', 0, ref.vat_applicable, ref.vat_rate)
    RETURNING id INTO new_id;
    INSERT INTO freefact.invoice_items (invoice_id, position, description, qty, unit_price, vat_applicable)
    SELECT new_id, position, description, qty, unit_price, vat_applicable
    FROM freefact.invoice_items WHERE invoice_id = ref.id;
    RETURN new_id;
END
$$;

-- Conversion d'un devis (facture proforma) en brouillon de facture.
CREATE FUNCTION convert_quote_to_invoice(p_quote uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    q freefact.quotes;
    new_id uuid;
BEGIN
    SELECT * INTO q FROM freefact.quotes WHERE id = p_quote FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Devis % introuvable', p_quote USING ERRCODE = 'no_data_found';
    END IF;
    IF q.status IN ('refuse', 'expire') THEN
        RAISE EXCEPTION 'Un devis % ne peut pas être converti', q.status USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO freefact.invoices (user_id, client_id, quote_id, notes)
    VALUES (q.user_id, q.client_id, q.id, q.notes)
    RETURNING id INTO new_id;
    INSERT INTO freefact.invoice_items (invoice_id, position, description, qty, unit_price, vat_applicable)
    SELECT new_id, position, description, qty, unit_price, vat_applicable
    FROM freefact.quote_items WHERE quote_id = p_quote;
    UPDATE freefact.quotes SET status = 'accepte' WHERE id = p_quote;
    RETURN new_id;
END
$$;

-- Enregistre une action IA si le quota mensuel du plan le permet.
CREATE FUNCTION record_ai_usage(p_user uuid, p_action text, p_cost integer DEFAULT 0) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_limit integer;
    v_used integer;
    v_month date := date_trunc('month', current_date)::date;
BEGIN
    SELECT l.ai_actions_per_month INTO v_limit
    FROM freefact.users u JOIN freefact.plan_limits l ON l.plan = u.plan
    WHERE u.id = p_user FOR UPDATE OF u;     -- sérialise les appels concurrents d'un même utilisateur
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Utilisateur % introuvable', p_user USING ERRCODE = 'no_data_found';
    END IF;
    SELECT count(*) INTO v_used FROM freefact.ai_usage WHERE user_id = p_user AND month = v_month;
    IF v_limit IS NOT NULL AND v_used >= v_limit THEN
        RAISE EXCEPTION 'Quota IA atteint (% actions ce mois-ci)', v_limit USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO freefact.ai_usage (user_id, month, action, cost) VALUES (p_user, v_month, p_action, p_cost);
    RETURN CASE WHEN v_limit IS NULL THEN NULL ELSE v_limit - v_used - 1 END;   -- actions restantes
END
$$;

-- ---------------------------------------------------------------------------
-- Déclencheurs d'intégrité
-- ---------------------------------------------------------------------------

-- Valeurs par défaut d'un brouillon, quotas du plan gratuit.
CREATE FUNCTION trg_invoices_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    prof freefact.business_profiles;
    v_limit integer;
    v_count integer;
BEGIN
    IF NEW.status <> 'brouillon' THEN
        RAISE EXCEPTION 'Une facture est créée en brouillon puis émise par emit_invoice()'
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO prof FROM freefact.business_profiles WHERE user_id = NEW.user_id;
    IF FOUND THEN
        NEW.vat_applicable := coalesce(NEW.vat_applicable, prof.vat_applicable);
        NEW.vat_rate := coalesce(NEW.vat_rate, prof.vat_rate);
        NEW.terms_days := coalesce(NEW.terms_days, prof.default_terms_days);
    END IF;
    NEW.total_ht := 0; NEW.total_vat := 0; NEW.total_ttc := 0;

    IF NEW.kind = 'facture' THEN
        SELECT l.invoices_per_month INTO v_limit
        FROM freefact.users u JOIN freefact.plan_limits l ON l.plan = u.plan
        WHERE u.id = NEW.user_id FOR UPDATE OF u;
        IF v_limit IS NOT NULL THEN
            SELECT count(*) INTO v_count FROM freefact.invoices
            WHERE user_id = NEW.user_id AND kind = 'facture'
              AND created_at >= date_trunc('month', now());
            IF v_count >= v_limit THEN
                RAISE EXCEPTION 'Quota du plan atteint : % factures par mois', v_limit
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER invoices_before_insert BEFORE INSERT ON invoices
    FOR EACH ROW EXECUTE FUNCTION trg_invoices_before_insert();

-- Règle 2 : facture figée après émission. Seuls changent ensuite le statut de paiement
-- (par les fonctions internes) et la date d'envoi (une seule fois, après certification).
CREATE FUNCTION trg_invoices_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.kind <> OLD.kind
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Champs non modifiables' USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.status = 'brouillon' THEN
        IF NEW.status <> 'brouillon' AND NOT freefact.is_internal() THEN
            RAISE EXCEPTION 'L''émission passe par emit_invoice()' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.status = 'brouillon' AND (NEW.total_ht, NEW.total_vat, NEW.total_ttc,
                                         NEW.seller_snapshot, NEW.buyer_snapshot, NEW.issue_date, NEW.due_date)
                     IS DISTINCT FROM (OLD.total_ht, OLD.total_vat, OLD.total_ttc,
                                       OLD.seller_snapshot, OLD.buyer_snapshot, OLD.issue_date, OLD.due_date) THEN
            RAISE EXCEPTION 'Totaux, photographies et dates sont fixés à l''émission'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- Facture émise.
    IF (NEW.client_id, NEW.quote_id, NEW.ref_invoice_id, NEW.number, NEW.issue_date, NEW.terms_days,
        NEW.due_date, NEW.vat_applicable, NEW.vat_rate, NEW.notes, NEW.total_ht, NEW.total_vat,
        NEW.total_ttc, NEW.seller_snapshot, NEW.buyer_snapshot, NEW.emitted_at)
       IS DISTINCT FROM
       (OLD.client_id, OLD.quote_id, OLD.ref_invoice_id, OLD.number, OLD.issue_date, OLD.terms_days,
        OLD.due_date, OLD.vat_applicable, OLD.vat_rate, OLD.notes, OLD.total_ht, OLD.total_vat,
        OLD.total_ttc, OLD.seller_snapshot, OLD.buyer_snapshot, OLD.emitted_at) THEN
        RAISE EXCEPTION 'La facture % est émise : elle ne peut plus être modifiée (corriger par un avoir)',
            OLD.number USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND (NOT freefact.is_internal() OR NEW.status = 'brouillon') THEN
        RAISE EXCEPTION 'Le statut de la facture % découle de ses paiements et avoirs', OLD.number
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
        IF OLD.sent_at IS NOT NULL THEN
            RAISE EXCEPTION 'Date d''envoi déjà enregistrée' USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM freefact.fne_certifications WHERE invoice_id = OLD.id) THEN
            RAISE EXCEPTION 'Envoi bloqué : la facture % n''est pas certifiée FNE', OLD.number
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER invoices_before_update BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION trg_invoices_before_update();

CREATE FUNCTION trg_invoices_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'brouillon' THEN
        RAISE EXCEPTION 'La facture % est émise : suppression interdite (conservation 10 ans)', OLD.number
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END
$$;
CREATE TRIGGER invoices_before_delete BEFORE DELETE ON invoices
    FOR EACH ROW EXECUTE FUNCTION trg_invoices_before_delete();

CREATE FUNCTION trg_invoices_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM freefact.write_audit(NEW.user_id, 'invoice', NEW.id, 'create', jsonb_build_object('kind', NEW.kind));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM freefact.write_audit(OLD.user_id, 'invoice', OLD.id, 'delete_draft', NULL);
    ELSIF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
        PERFORM freefact.write_audit(NEW.user_id, 'invoice', NEW.id, 'send', NULL);
    END IF;
    RETURN NULL;
END
$$;
CREATE TRIGGER invoices_audit AFTER INSERT OR UPDATE OR DELETE ON invoices
    FOR EACH ROW EXECUTE FUNCTION trg_invoices_audit();

-- Lignes verrouillées avec la facture.
CREATE FUNCTION trg_invoice_items_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    st freefact.invoice_status;
BEGIN
    SELECT status INTO st FROM freefact.invoices
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
    -- Introuvable : suppression en cascade d'un brouillon, autorisée.
    IF FOUND AND st <> 'brouillon' THEN
        RAISE EXCEPTION 'Les lignes d''une facture émise sont verrouillées' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.invoice_id <> OLD.invoice_id THEN
        RAISE EXCEPTION 'Une ligne ne change pas de facture' USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER invoice_items_lock BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
    FOR EACH ROW EXECUTE FUNCTION trg_invoice_items_lock();

-- Certification : uniquement sur un document émis, puis immuable.
CREATE FUNCTION trg_fne_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    inv freefact.invoices;
BEGIN
    SELECT * INTO inv FROM freefact.invoices WHERE id = NEW.invoice_id;
    IF inv.status = 'brouillon' THEN
        RAISE EXCEPTION 'Seule une facture émise peut être certifiée' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.certified_at < inv.emitted_at - interval '1 day' THEN
        RAISE EXCEPTION 'Date de certification antérieure à l''émission' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM freefact.write_audit(inv.user_id, 'invoice', inv.id, 'certify',
        jsonb_build_object('fiscal_number', NEW.fiscal_number, 'mode', NEW.mode));
    RETURN NEW;
END
$$;
CREATE TRIGGER fne_before_insert BEFORE INSERT ON fne_certifications
    FOR EACH ROW EXECUTE FUNCTION trg_fne_before_insert();

CREATE FUNCTION trg_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '%: enregistrement en écriture seule', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER fne_immutable BEFORE UPDATE OR DELETE ON fne_certifications
    FOR EACH ROW EXECUTE FUNCTION trg_forbid_change();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION trg_forbid_change();
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION trg_forbid_change();

-- Paiements : sur une facture émise, somme des paiements ≤ solde.
CREATE FUNCTION trg_payments_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    inv freefact.invoices;
    remaining bigint;
BEGIN
    SELECT * INTO inv FROM freefact.invoices WHERE id = NEW.invoice_id FOR UPDATE;
    IF inv.kind <> 'facture' OR inv.status IN ('brouillon', 'annulee') THEN
        RAISE EXCEPTION 'Paiement possible uniquement sur une facture émise et non annulée'
            USING ERRCODE = 'check_violation';
    END IF;
    remaining := inv.total_ttc - freefact.credited_amount(inv.id) - freefact.paid_amount(inv.id);
    IF NEW.amount > remaining THEN
        RAISE EXCEPTION 'Paiement de % FCFA supérieur au reste à payer de % (% FCFA)',
            NEW.amount, inv.number, remaining USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER payments_before_insert BEFORE INSERT ON payments
    FOR EACH ROW EXECUTE FUNCTION trg_payments_before_insert();

CREATE FUNCTION trg_payments_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM freefact.write_audit(NEW.user_id, 'payment', NEW.id, 'create',
        jsonb_build_object('invoice_id', NEW.invoice_id, 'amount', NEW.amount, 'method', NEW.method));
    PERFORM freefact.refresh_invoice_status(NEW.invoice_id);
    RETURN NULL;
END
$$;
CREATE TRIGGER payments_after_insert AFTER INSERT ON payments
    FOR EACH ROW EXECUTE FUNCTION trg_payments_after_insert();

-- Relance : uniquement pour une facture certifiée (même règle que l'envoi).
CREATE FUNCTION trg_reminders_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM freefact.fne_certifications WHERE invoice_id = NEW.invoice_id) THEN
        RAISE EXCEPTION 'Relance impossible : facture non certifiée FNE' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER reminders_before_insert BEFORE INSERT ON reminders
    FOR EACH ROW EXECUTE FUNCTION trg_reminders_before_insert();

-- Clients : quota du plan gratuit ; suppression refusée si une facture a été émise.
CREATE FUNCTION trg_clients_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_limit integer;
BEGIN
    SELECT l.clients INTO v_limit
    FROM freefact.users u JOIN freefact.plan_limits l ON l.plan = u.plan
    WHERE u.id = NEW.user_id FOR UPDATE OF u;
    IF v_limit IS NOT NULL
       AND (SELECT count(*) FROM freefact.clients WHERE user_id = NEW.user_id) >= v_limit THEN
        RAISE EXCEPTION 'Quota du plan atteint : % clients', v_limit USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER clients_before_insert BEFORE INSERT ON clients
    FOR EACH ROW EXECUTE FUNCTION trg_clients_before_insert();

CREATE FUNCTION trg_clients_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM freefact.invoices WHERE client_id = OLD.id AND status <> 'brouillon') THEN
        RAISE EXCEPTION 'Client « % » : suppression refusée, une facture a été émise', OLD.name
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END
$$;
CREATE TRIGGER clients_before_delete BEFORE DELETE ON clients
    FOR EACH ROW EXECUTE FUNCTION trg_clients_before_delete();

-- Numéro de devis (non fiscal) attribué à la création.
CREATE FUNCTION trg_quotes_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.number IS NULL THEN
        NEW.number := freefact.next_number(
            NEW.user_id,
            coalesce((SELECT quote_prefix FROM freefact.business_profiles WHERE user_id = NEW.user_id), 'DV'),
            extract(year FROM NEW.issue_date)::integer);
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER quotes_before_insert BEFORE INSERT ON quotes
    FOR EACH ROW EXECUTE FUNCTION trg_quotes_before_insert();

-- ---------------------------------------------------------------------------
-- Vues de lecture
-- ---------------------------------------------------------------------------

-- Statut affiché (avec « en retard »), certification, reste à payer, montant en lettres.
CREATE VIEW invoice_overview AS
SELECT i.id, i.user_id, i.client_id, i.kind, i.number, i.status, i.issue_date, i.due_date,
       i.total_ht, i.total_vat, i.total_ttc,
       freefact.credited_amount(i.id) AS credited,
       freefact.paid_amount(i.id) AS paid,
       CASE WHEN i.kind = 'facture' AND i.status <> 'brouillon'
            THEN i.total_ttc - freefact.credited_amount(i.id) - freefact.paid_amount(i.id)
            ELSE 0 END AS remaining,
       c.fiscal_number, c.certified_at,
       (i.status <> 'brouillon' AND c.id IS NULL) AS to_certify,
       (c.id IS NOT NULL) AS can_send,
       CASE WHEN i.status IN ('emise', 'partiellement_payee') AND i.kind = 'facture'
                 AND i.due_date < current_date THEN 'en_retard'
            ELSE i.status::text END AS display_status,
       CASE WHEN i.status <> 'brouillon' THEN freefact.invoice_legal_sentence(i.total_ttc, i.kind) END
           AS amount_in_words
FROM freefact.invoices i
LEFT JOIN freefact.fne_certifications c ON c.invoice_id = i.id;

-- Score de délai de paiement par client (section 4) : retard moyen constaté, en jours,
-- sur les factures soldées. Calcul déterministe, sans IA ; alimente les prévisions.
CREATE VIEW client_payment_scores AS
SELECT i.user_id, i.client_id,
       count(*) AS paid_invoices,
       round(avg(p.last_payment - i.due_date), 1) AS avg_delay_days
FROM freefact.invoices i
JOIN LATERAL (SELECT max(payment_date) AS last_payment FROM freefact.payments WHERE invoice_id = i.id) p ON true
WHERE i.kind = 'facture' AND i.status = 'payee'
GROUP BY i.user_id, i.client_id;

-- Prévisions de trésorerie à 7 et 30 jours : échéance + délai habituel du client.
CREATE VIEW cash_forecast AS
SELECT o.user_id,
       coalesce(sum(o.remaining) FILTER (WHERE expected <= current_date + 7), 0)::bigint AS expected_7_days,
       coalesce(sum(o.remaining) FILTER (WHERE expected <= current_date + 30), 0)::bigint AS expected_30_days
FROM (
    SELECT ov.user_id, ov.remaining,
           greatest(ov.due_date + coalesce(round(s.avg_delay_days)::integer, 0), current_date) AS expected
    FROM freefact.invoice_overview ov
    LEFT JOIN freefact.client_payment_scores s ON s.user_id = ov.user_id AND s.client_id = ov.client_id
    WHERE ov.kind = 'facture' AND ov.status IN ('emise', 'partiellement_payee') AND ov.remaining > 0
) o
GROUP BY o.user_id;

COMMIT;

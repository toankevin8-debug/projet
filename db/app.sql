-- Tables propres à l'application web (sessions). Idempotent : rejoué à chaque migration.
SET search_path = freefact, public;

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,               -- sha256 du jeton du cookie, jamais le jeton lui-même
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Jetons à usage unique : vérification d'email et réinitialisation du mot de passe.
CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash text PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('verify', 'reset')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens (user_id, kind);

-- File des emails : tout email passe par ici, envoyé ou non (sans SMTP configuré, il reste lisible).
CREATE TABLE IF NOT EXISTS outbox (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    to_address text NOT NULL,
    subject    text NOT NULL,
    body_text  text NOT NULL,
    attachment_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at    timestamptz,
    error      text
);

-- Logo de l'entreprise (plans Pro et Business), servi par /logo/:user.
CREATE TABLE IF NOT EXISTS business_logos (
    user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    mime       text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/svg+xml', 'image/webp')),
    data       bytea NOT NULL CHECK (octet_length(data) <= 300000),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Historique des changements de plan et des paiements d'abonnement.
CREATE TABLE IF NOT EXISTS billing_events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    from_plan  plan_type NOT NULL,
    to_plan    plan_type NOT NULL,
    amount     bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
    method     text,
    reference  text,
    simulated  boolean NOT NULL DEFAULT true,
    at         timestamptz NOT NULL DEFAULT now()
);

-- Notifications par email déjà envoyées : une par facture, par type et par jour au plus.
CREATE TABLE IF NOT EXISTS notifications_sent (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       text NOT NULL,
    invoice_id uuid NOT NULL,
    day        date NOT NULL DEFAULT current_date,
    PRIMARY KEY (user_id, kind, invoice_id, day)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- Conversation avec l'assistant financier (les 20 derniers échanges sont affichés).
CREATE TABLE IF NOT EXISTS assistant_messages (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role    text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL,
    at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_messages_user_idx ON assistant_messages (user_id, id);

-- Fonctions de présentation corrigées après la création du schéma : redéfinies à chaque migration.
CREATE OR REPLACE FUNCTION invoice_legal_sentence(total_ttc bigint, kind invoice_kind DEFAULT 'facture')
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT 'Arrêtée la présente ' || CASE WHEN kind = 'avoir' THEN 'facture d''avoir' ELSE 'facture' END
           || ' à la somme de ' || freefact.amount_in_words(total_ttc) || ' francs CFA ('
           || regexp_replace(total_ttc::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g') || ' FCFA).'
$$;

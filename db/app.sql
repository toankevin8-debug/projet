-- Tables propres à l'application web (sessions). Idempotent : rejoué à chaque migration.
SET search_path = freefact, public;

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,               -- sha256 du jeton du cookie, jamais le jeton lui-même
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

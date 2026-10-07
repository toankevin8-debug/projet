#!/usr/bin/env bash
# Crée une base jetable, charge le schéma et exécute les tests de règles.
# Variables : PGHOST, PGPORT, PGUSER (connexion à un serveur PostgreSQL >= 13).
set -euo pipefail
cd "$(dirname "$0")/../.."
db="freefact_test_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f db/schema.sql
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f db/tests/rules.sql

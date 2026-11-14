#!/usr/bin/env bash
# Datenbank-Tests: legt eine frische Test-Datenbank an, spielt alle Migrationen ein
# und führt supabase/tests/10_core_flows.sql aus.
#
# Nutzung (lokal mit Docker):
#   docker run -d --name lager-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:16
#   PGHOST=localhost PGPORT=54329 PGUSER=postgres PGPASSWORD=postgres npm run test:db
#
# Verbindet sich NIE mit dem Live-System, solange PGHOST/PGPORT auf eine lokale Test-Datenbank zeigen.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-lager_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

case "${PGHOST:-localhost}" in
  *supabase.co*|*supabase.com*) echo "Abbruch: PGHOST zeigt auf Supabase – Tests nur gegen eine lokale Test-Datenbank!" >&2; exit 1 ;;
esac

"${PSQL[@]}" -d postgres -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
"${PSQL[@]}" -d "$DB" -f supabase/tests/00_supabase_stub.sql 2>&1 | grep -v -E 'NOTICE|wal_level|HINT' || true
for f in supabase/migrations/*.sql; do
  echo "Migration: $f"
  "${PSQL[@]}" -d "$DB" -f "$f" 2>&1 | grep -v NOTICE || true
  # psql liefert bei Fehlern Exit-Code 3; durch die Pipe prüfen wir ihn explizit
  test "${PIPESTATUS[0]}" -eq 0 || { echo "Migration fehlgeschlagen: $f" >&2; exit 1; }
done
# Migrationen sind wiederholbar – 002 bis 007 ein zweites Mal einspielen
for f in supabase/migrations/00[2-9]*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "Migration nicht wiederholbar: $f" >&2; exit 1; }
done
"${PSQL[@]}" -d "$DB" -f supabase/tests/10_core_flows.sql 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e '/NOTICE:  /d'
test "${PIPESTATUS[0]}" -eq 0

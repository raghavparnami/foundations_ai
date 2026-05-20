#!/usr/bin/env bash
# Migrate local loom_catalog → Railway Postgres.
#
# Usage:
#   export RAILWAY_URL='postgres://...railway.app...'        # NEVER paste into chat
#   export LOCAL_URL='postgres://loom:loom@localhost:5544/loom_catalog'
#   bash setup/migrate-to-railway.sh
#
# What it does:
#   1. Applies the foundation_ai schema to Railway (idempotent)
#   2. Dumps data-only from your local catalog
#   3. Loads it into Railway
#   4. Verifies row counts on both sides
#
# Optional: append --include-demo to also copy the manufacturing demo source.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${RAILWAY_URL:?Set RAILWAY_URL to the Railway Postgres connection string}"
: "${LOCAL_URL:=postgres://loom:loom@localhost:5544/loom_catalog}"

echo "==> 1/4  Applying foundation_ai schema to Railway"
psql "$RAILWAY_URL" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/sql/01-loom-catalog-schema.sql" >/dev/null
echo "    ok"

echo "==> 2/4  Dumping foundation_ai data from local"
DUMP=$(mktemp -t loom_catalog_data.XXXXXX.sql)
trap 'rm -f "$DUMP"' EXIT
pg_dump "$LOCAL_URL" \
  --schema=foundation_ai \
  --data-only \
  --no-owner --no-privileges \
  --disable-triggers \
  > "$DUMP"
echo "    dumped $(wc -l < "$DUMP" | tr -d ' ') lines to $DUMP"

echo "==> 3/4  Loading into Railway"
psql "$RAILWAY_URL" -v ON_ERROR_STOP=1 -f "$DUMP" >/dev/null
echo "    ok"

echo "==> 4/4  Verifying row counts"
read -r local_pages local_tables local_docs <<<"$(psql "$LOCAL_URL" -At -F$'\t' -c "SET search_path TO foundation_ai; SELECT (SELECT count(*) FROM wiki_pages), (SELECT count(*) FROM tables), (SELECT count(*) FROM documents)")"
read -r remote_pages remote_tables remote_docs <<<"$(psql "$RAILWAY_URL" -At -F$'\t' -c "SET search_path TO foundation_ai; SELECT (SELECT count(*) FROM wiki_pages), (SELECT count(*) FROM tables), (SELECT count(*) FROM documents)")"

printf "                  local    railway\n"
printf "  wiki_pages    %7s  %7s\n" "$local_pages" "$remote_pages"
printf "  tables        %7s  %7s\n" "$local_tables" "$remote_tables"
printf "  documents     %7s  %7s\n" "$local_docs"   "$remote_docs"

if [[ "$local_pages" != "$remote_pages" || "$local_tables" != "$remote_tables" || "$local_docs" != "$remote_docs" ]]; then
  echo "  ⚠ counts differ — review the dump above"
  exit 1
fi
echo "  ✓ counts match"

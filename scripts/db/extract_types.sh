#!/bin/bash
set -euo pipefail

# Extract custom types (ENUMs) from remote database
# Use this to create a migration for missing types

# Get directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# Validate configuration
validate_config

OUTPUT_FILE="${SCHEMA_DIR}/custom_types.sql"

echo "🔍 Extracting custom types from remote Supabase database..."
echo ""

# Extract only TYPE definitions from remote database
PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql \
  --host="${SUPABASE_DB_HOST}" \
  --port="${SUPABASE_DB_PORT}" \
  --username="${SUPABASE_DB_USER}" \
  --dbname="${SUPABASE_DB_NAME}" \
  --no-align \
  --tuples-only \
  --command="
    SELECT 
      'CREATE TYPE ' || n.nspname || '.' || t.typname || ' AS ENUM (' ||
      string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) ||
      ');' as create_statement
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
    GROUP BY n.nspname, t.typname
    ORDER BY t.typname;
  " > "${OUTPUT_FILE}"

if [ $? -eq 0 ]; then
    if [ -s "${OUTPUT_FILE}" ]; then
        print_success "Custom types extracted to ${OUTPUT_FILE}"
        echo ""
        print_info "Found types:"
        cat "${OUTPUT_FILE}"
        echo ""
        echo "─────────────────────────────────────────────────────────────"
        print_info "To add these to your local database:"
        echo "  1. Create a new migration: supabase migration new add_custom_types"
        echo "  2. Copy the content from ${OUTPUT_FILE}"
        echo "  3. Paste into your new migration file"
        echo "  4. Run: supabase db reset"
    else
        print_info "No custom types found in remote database"
        rm -f "${OUTPUT_FILE}"
    fi
else
    print_error "Failed to extract custom types"
    exit 1
fi
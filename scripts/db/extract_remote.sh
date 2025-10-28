#!/bin/bash
set -euo pipefail

# Extract schema from remote Supabase database
# This bypasses the Supabase CLI and uses pg_dump directly

# Get directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# Validate configuration
validate_config

OUTPUT_FILE="${SCHEMA_DIR}/remote_schema.sql"

echo "🔍 Extracting schema from remote Supabase database..."
echo "   Host: ${SUPABASE_DB_HOST}"
echo "   Port: ${SUPABASE_DB_PORT}"
echo "   User: ${SUPABASE_DB_USER}"
echo ""

# Test connection first
print_info "Testing database connection..."
if ! PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql \
  --host="${SUPABASE_DB_HOST}" \
  --port="${SUPABASE_DB_PORT}" \
  --username="${SUPABASE_DB_USER}" \
  --dbname="${SUPABASE_DB_NAME}" \
  --command="SELECT version();" \
  --no-align \
  --tuples-only \
  > /dev/null 2>&1; then
    print_error "Cannot connect to remote database"
    echo ""
    echo "Please check:"
    echo "  1. SUPABASE_DB_PASSWORD is correct"
    echo "  2. SUPABASE_DB_HOST is correct (format: db.yourproject.supabase.co)"
    echo "  3. Your IP is allowed (check Supabase Dashboard → Settings → Database)"
    echo "  4. Port 5432 is accessible (not blocked by firewall)"
    echo ""
    echo "Test manually with:"
    echo "  psql \"postgresql://postgres:\${SUPABASE_DB_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/${SUPABASE_DB_NAME}\""
    exit 1
fi
print_success "Connection successful"
echo ""

print_info "Extracting schema (this may take 10-30 seconds)..."

# Extract complete schema using pg_dump
# This includes tables, types (ENUMs), functions, views, etc.
# Key flags:
#   --schema-only: No data, just structure
#   --no-owner: Don't include ownership commands
#   --no-acl: Don't include GRANT/REVOKE (prevents the REVOKE bug)
#   --schema=public: Only public schema (includes all types, tables, functions)
#   --exclude-schema: Explicitly exclude Supabase internal schemas
#   --verbose: Show progress

PGPASSWORD="${SUPABASE_DB_PASSWORD}" timeout 120 pg_dump \
  --host="${SUPABASE_DB_HOST}" \
  --port="${SUPABASE_DB_PORT}" \
  --username="${SUPABASE_DB_USER}" \
  --dbname="${SUPABASE_DB_NAME}" \
  --schema-only \
  --no-owner \
  --no-acl \
  --schema=public \
  --exclude-schema=auth \
  --exclude-schema=storage \
  --exclude-schema=realtime \
  --exclude-schema=pgsodium \
  --exclude-schema=pgsodium_masks \
  --exclude-schema=supabase_functions \
  --exclude-schema=vault \
  --verbose \
  --file="${OUTPUT_FILE}" 2>&1 | grep -v "^pg_dump: last built-in OID"

if [ $? -eq 0 ]; then
    print_success "Remote schema saved to ${OUTPUT_FILE}"
    
    # Show file size
    FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)
    print_info "File size: ${FILE_SIZE}"
    
    # Count tables
    TABLE_COUNT=$(grep -c "^CREATE TABLE" "${OUTPUT_FILE}" || echo "0")
    print_info "Tables found: ${TABLE_COUNT}"
else
    print_error "Failed to extract remote schema"
    exit 1
fi
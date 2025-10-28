#!/bin/bash
set -euo pipefail

# Extract schema from local Supabase database after applying migrations
# This creates a baseline to compare against the remote database

# Get directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

OUTPUT_FILE="${SCHEMA_DIR}/local_schema.sql"

echo "🔄 Resetting local database with migrations..."
echo ""

# Reset local database to apply all migrations
yarn supabase db reset

if [ $? -ne 0 ]; then
    print_error "Failed to reset local database"
    print_info "Make sure Supabase is running: supabase start"
    exit 1
fi

echo ""
echo "🔍 Extracting schema from local Supabase database..."
echo "   Host: ${LOCAL_DB_HOST}"
echo "   Port: ${LOCAL_DB_PORT}"
echo "   User: ${LOCAL_DB_USER}"
echo ""

# Extract complete schema using pg_dump
# This includes tables, types (ENUMs), functions, views, etc.
# Same flags as remote extraction for consistency
PGPASSWORD="${LOCAL_DB_PASSWORD}" pg_dump \
  --host="${LOCAL_DB_HOST}" \
  --port="${LOCAL_DB_PORT}" \
  --username="${LOCAL_DB_USER}" \
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
  --file="${OUTPUT_FILE}"

if [ $? -eq 0 ]; then
    print_success "Local schema saved to ${OUTPUT_FILE}"
    
    # Show file size
    FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)
    print_info "File size: ${FILE_SIZE}"
    
    # Count tables
    TABLE_COUNT=$(grep -c "^CREATE TABLE" "${OUTPUT_FILE}" || echo "0")
    print_info "Tables found: ${TABLE_COUNT}"
else
    print_error "Failed to extract local schema"
    exit 1
fi
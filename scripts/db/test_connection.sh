#!/bin/bash
set -euo pipefail

# Quick connection test script
# Use this to verify your database credentials work

# Get directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo "═══════════════════════════════════════════════════════════════"
echo "  Database Connection Test"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Validate configuration
validate_config

echo "Configuration:"
echo "  Host: ${SUPABASE_DB_HOST}"
echo "  Port: ${SUPABASE_DB_PORT}"
echo "  User: ${SUPABASE_DB_USER}"
echo "  Database: ${SUPABASE_DB_NAME}"
echo "  Password: ${SUPABASE_DB_PASSWORD:0:3}***"
echo ""

print_info "Testing connection..."
echo ""

# Test connection with timeout
if timeout 10 bash -c "PGPASSWORD='${SUPABASE_DB_PASSWORD}' psql \
  --host='${SUPABASE_DB_HOST}' \
  --port='${SUPABASE_DB_PORT}' \
  --username='${SUPABASE_DB_USER}' \
  --dbname='${SUPABASE_DB_NAME}' \
  --command='SELECT version();' \
  --no-align \
  --tuples-only" 2>&1; then
    echo ""
    print_success "Connection successful!"
    echo ""
    
    # Get table count
    print_info "Getting table count..."
    TABLE_COUNT=$(PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql \
      --host="${SUPABASE_DB_HOST}" \
      --port="${SUPABASE_DB_PORT}" \
      --username="${SUPABASE_DB_USER}" \
      --dbname="${SUPABASE_DB_NAME}" \
      --command="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" \
      --no-align \
      --tuples-only)
    
    print_success "Found ${TABLE_COUNT} tables in public schema"
    echo ""
    
    # List tables
    print_info "Tables in public schema:"
    PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql \
      --host="${SUPABASE_DB_HOST}" \
      --port="${SUPABASE_DB_PORT}" \
      --username="${SUPABASE_DB_USER}" \
      --dbname="${SUPABASE_DB_NAME}" \
      --command="SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" \
      --no-align \
      --tuples-only | while read table; do
        echo "  - ${table}"
      done
    
    echo ""
    print_success "All tests passed! You can now run ./scripts/db/full_sync.sh"
    
else
    EXIT_CODE=$?
    echo ""
    print_error "Connection failed (exit code: ${EXIT_CODE})"
    echo ""
    
    if [ $EXIT_CODE -eq 124 ]; then
        print_warning "Connection timed out after 10 seconds"
        echo ""
        echo "This could mean:"
        echo "  1. The host is unreachable"
        echo "  2. Port 5432 is blocked by a firewall"
        echo "  3. Your IP is not allowlisted in Supabase"
        echo ""
    fi
    
    echo "Troubleshooting steps:"
    echo ""
    echo "1. Verify your credentials in .env.db:"
    echo "   - SUPABASE_DB_HOST should be: db.yourproject.supabase.co"
    echo "   - SUPABASE_DB_PASSWORD from Supabase Dashboard"
    echo ""
    echo "2. Check IP allowlist in Supabase:"
    echo "   Dashboard → Settings → Database → Connection Pooling"
    echo "   Make sure your IP is allowed or use 0.0.0.0/0 for testing"
    echo ""
    echo "3. Test with psql directly:"
    echo "   psql \"postgresql://${SUPABASE_DB_USER}:\${SUPABASE_DB_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/${SUPABASE_DB_NAME}\""
    echo ""
    echo "4. Verify pg_dump is installed:"
    echo "   pg_dump --version"
    echo ""
    
    exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
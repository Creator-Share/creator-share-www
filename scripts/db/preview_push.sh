#!/bin/bash
set -euo pipefail

# Preview what changes will be pushed to production
# This compares LOCAL → REMOTE (reverse of normal sync)
# Shows what SQL will be applied to production database

# Get directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# Validate configuration
validate_config

OUTPUT_FILE="${SCHEMA_DIR}/push_preview.sql"

echo "═══════════════════════════════════════════════════════════════"
echo "  Preview Push to Production"
echo "═══════════════════════════════════════════════════════════════"
echo ""
print_warning "This shows changes that will be applied to PRODUCTION"
echo ""

# Check if migra is installed
if ! command -v migra &> /dev/null; then
    print_error "migra is not installed"
    echo ""
    echo "Install with:"
    echo "  pip install migra psycopg2-binary"
    exit 1
fi

# Make sure local database is up to date with migrations
print_info "Ensuring local database is up to date (this may take 30-60 seconds)..."
echo ""

if ! yarn supabase db reset; then
    print_error "Failed to reset local database"
    echo ""
    print_info "Make sure Supabase is running: supabase status"
    exit 1
fi

echo ""
print_success "Local database reset complete"
echo ""

# Connection strings
LOCAL_URL="postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/${SUPABASE_DB_NAME}"
REMOTE_URL="postgresql://${SUPABASE_DB_USER}:${SUPABASE_DB_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/${SUPABASE_DB_NAME}"

print_info "Comparing schemas..."
echo "   Production (current): ${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}"
echo "   Local (target):       ${LOCAL_DB_HOST}:${LOCAL_DB_PORT}"
echo ""
print_info "Direction: REMOTE → LOCAL (what to apply to production)"
echo ""

# Test connections first
print_info "Testing database connections..."
if ! PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql -h "${SUPABASE_DB_HOST}" -p "${SUPABASE_DB_PORT}" -U "${SUPABASE_DB_USER}" -d "${SUPABASE_DB_NAME}" -c "SELECT 1" > /dev/null 2>&1; then
    print_error "Cannot connect to remote database"
    exit 1
fi
print_success "Remote connection OK"

if ! PGPASSWORD="${LOCAL_DB_PASSWORD}" psql -h "${LOCAL_DB_HOST}" -p "${LOCAL_DB_PORT}" -U "${LOCAL_DB_USER}" -d "${SUPABASE_DB_NAME}" -c "SELECT 1" > /dev/null 2>&1; then
    print_error "Cannot connect to local database"
    exit 1
fi
print_success "Local connection OK"
echo ""

# Generate diff: REMOTE → LOCAL (what to apply to production)
# This shows SQL needed to make REMOTE match LOCAL
print_info "Generating diff (may take 10-20 seconds)..."
MIGRA_OUTPUT=$(migra --unsafe "${REMOTE_URL}" "${LOCAL_URL}" 2>&1)
MIGRA_EXIT=$?

if [ $MIGRA_EXIT -ne 0 ]; then
    print_error "migra failed with exit code $MIGRA_EXIT"
    echo "$MIGRA_OUTPUT"
    exit 1
fi

# Save output
echo "$MIGRA_OUTPUT" > "${OUTPUT_FILE}"

# Debug: Show what we got
echo "─────────────────────────────────────────────────────────────"
echo "Debug Information:"
echo "  Output file: ${OUTPUT_FILE}"
echo "  migra exit code: $MIGRA_EXIT"
echo "  Output file size: $(wc -c < "${OUTPUT_FILE}" 2>/dev/null || echo "0") bytes"
echo "  Output line count: $(wc -l < "${OUTPUT_FILE}" 2>/dev/null || echo "0") lines"
echo ""
echo "  First 10 lines of output:"
head -n 10 "${OUTPUT_FILE}" 2>/dev/null || echo "  (file is empty)"
echo "─────────────────────────────────────────────────────────────"
echo ""

# Check if diff has content
if [ -s "${OUTPUT_FILE}" ]; then
    print_warning "Changes that will be pushed to PRODUCTION:"
    echo ""
    
    # Show file size
    FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)
    print_info "Preview size: ${FILE_SIZE}"
    
    # Count changes
    LINE_COUNT=$(wc -l < "${OUTPUT_FILE}")
    print_info "Total lines: ${LINE_COUNT}"
    echo ""
    
    # Check for type changes
    TYPE_CHANGES=$(grep -c "CREATE TYPE\|ALTER TYPE\|DROP TYPE" "${OUTPUT_FILE}" || echo "0")
    if [ "${TYPE_CHANGES}" -gt 0 ]; then
        print_warning "⚠ ${TYPE_CHANGES} custom type change(s) detected"
    fi
    
    # Check for drops
    DROP_COUNT=$(grep -c "DROP TABLE\|DROP COLUMN" "${OUTPUT_FILE}" || echo "0")
    if [ "${DROP_COUNT}" -gt 0 ]; then
        print_warning "⚠ ${DROP_COUNT} DROP statement(s) detected - REVIEW CAREFULLY!"
    fi
    
    echo ""
    echo "─────────────────────────────────────────────────────────────"
    cat "${OUTPUT_FILE}"
    echo "─────────────────────────────────────────────────────────────"
    echo ""
    
    # Safety warnings
    print_warning "CRITICAL: Review these changes before pushing!"
    echo ""
    echo "This preview shows what SQL will be executed on production when you run:"
    echo "  yarn supabase db push"
    echo ""
    echo "Verify:"
    echo "  ✓ All changes are intentional"
    echo "  ✓ No unexpected DROP statements"
    echo "  ✓ Type changes are safe (ENUMs can't have values removed if in use)"
    echo "  ✓ No data loss will occur"
    echo "  ✓ Migrations are in correct order"
    echo ""
    
    # Save to file
    print_success "Full preview saved to ${OUTPUT_FILE}"
    
else
    print_success "No changes to push - production is already in sync!"
    rm -f "${OUTPUT_FILE}"
fi

echo "═══════════════════════════════════════════════════════════════"yarn 
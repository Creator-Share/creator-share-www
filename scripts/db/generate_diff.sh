#!/bin/bash
set -euo pipefail

# Generate schema diff between local and remote databases
# Uses migra for intelligent PostgreSQL schema comparison

# Get directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# Validate configuration
validate_config

OUTPUT_FILE="${SCHEMA_DIR}/diff.sql"

echo "📊 Generating schema diff..."
echo ""

# Check if migra is installed
if ! command -v migra &> /dev/null; then
    print_error "migra is not installed"
    echo ""
    echo "Install with:"
    echo "  pip install migra psycopg2-binary"
    echo ""
    echo "Or using pip3:"
    echo "  pip3 install migra psycopg2-binary"
    exit 1
fi

# Connection strings
LOCAL_URL="postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/${SUPABASE_DB_NAME}"
REMOTE_URL="postgresql://${SUPABASE_DB_USER}:${SUPABASE_DB_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/${SUPABASE_DB_NAME}"

print_info "Comparing local migrations to remote database..."
echo "   Local:  ${LOCAL_DB_HOST}:${LOCAL_DB_PORT} (Supabase local)"
echo "   Remote: ${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT} (Production)"
echo ""

# Generate diff using migra
# --unsafe: Include DROP statements (be careful!)
# Direction: local -> remote (shows what to add to local to match remote)
migra \
  --unsafe \
  "${LOCAL_URL}" \
  "${REMOTE_URL}" \
  > "${OUTPUT_FILE}" 2>&1 || {
    # migra returns non-zero even on success sometimes
    if [ ! -f "${OUTPUT_FILE}" ]; then
      print_error "Failed to generate diff"
      exit 1
    fi
  }

# Check if diff has content
if [ -s "${OUTPUT_FILE}" ]; then
    print_success "Schema differences found and saved to ${OUTPUT_FILE}"
    echo ""
    
    # Show file size
    FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)
    print_info "Diff size: ${FILE_SIZE}"
    
    # Count changes
    LINE_COUNT=$(wc -l < "${OUTPUT_FILE}")
    print_info "Total lines: ${LINE_COUNT}"
    echo ""
    
    # Show preview
    print_warning "Preview of changes (first 50 lines):"
    echo "─────────────────────────────────────────────────────────────"
    head -n 50 "${OUTPUT_FILE}"
    
    if [ "${LINE_COUNT}" -gt 50 ]; then
        echo ""
        echo "... (truncated, see full diff in ${OUTPUT_FILE})"
    fi
    
    echo "─────────────────────────────────────────────────────────────"
    echo ""
    
    # Check for type changes
    TYPE_CHANGES=$(grep -c "CREATE TYPE\|ALTER TYPE\|DROP TYPE" "${OUTPUT_FILE}" || echo "0")
    if [ "${TYPE_CHANGES}" -gt 0 ]; then
        print_info "Detected ${TYPE_CHANGES} custom type change(s)"
        echo ""
    fi
    
    # Safety warnings
    print_warning "IMPORTANT: Review the diff carefully before creating a migration!"
    echo ""
    echo "Check for:"
    echo "  ✓ Unexpected DROP statements"
    echo "  ✓ REVOKE statements (should not appear)"
    echo "  ✓ Changes to system tables"
    echo "  ✓ Data loss risks"
    echo "  ✓ Type changes (ENUMs) - ensure they're intentional"
    echo ""
    
else
    print_success "No schema differences detected!"
    print_info "Your local migrations are in sync with remote database"
    rm -f "${OUTPUT_FILE}"
fi
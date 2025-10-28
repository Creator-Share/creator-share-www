#!/bin/bash
set -euo pipefail

# Full database schema sync workflow
# This is the main script you should run to check for schema differences

# Get directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# Validate configuration
validate_config

echo "═══════════════════════════════════════════════════════════════"
echo "  Database Schema Sync Workflow"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "This will:"
echo "  1. Extract schema from remote Supabase database"
echo "  2. Extract schema from local database (with migrations)"
echo "  3. Generate a diff showing changes needed"
echo ""

# Confirm before proceeding
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

echo ""

# Step 1: Extract remote schema
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1/3: Extracting remote schema"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"${SCRIPT_DIR}/extract_remote.sh"
echo ""

# Step 2: Extract local schema
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2/3: Extracting local schema"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"${SCRIPT_DIR}/extract_local.sh"
echo ""

# Step 3: Generate diff
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3/3: Generating diff"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"${SCRIPT_DIR}/generate_diff.sh"
echo ""

# Summary and next steps
echo "═══════════════════════════════════════════════════════════════"
echo "  Workflow Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if [ -f "${SCHEMA_DIR}/diff.sql" ]; then
    print_info "Schema differences detected."
    echo ""
    echo "📝 Next steps:"
    echo ""
    echo "  1. Review the diff file:"
    echo "     less scripts/db/diff.sql"
    echo ""
    echo "  2. Create a new migration:"
    echo "     supabase migration new capture_studio_changes"
    echo ""
    echo "  3. Copy relevant changes from diff.sql to the new migration"
    echo ""
    echo "  4. Test locally:"
    echo "     supabase db reset"
    echo ""
    echo "  5. Push to remote:"
    echo "     supabase db push"
    echo ""
else
    print_success "Your local migrations are in sync with remote database!"
    echo ""
    print_info "No action needed."
fi

echo "═══════════════════════════════════════════════════════════════"
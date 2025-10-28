#!/bin/bash
# Database configuration for schema management scripts
# This file is sourced by other scripts in this directory

# Remote Supabase database configuration
# Override these with environment variables as needed
export SUPABASE_DB_HOST="${SUPABASE_DB_HOST:-}"
export SUPABASE_DB_USER="${SUPABASE_DB_USER:-postgres}"
export SUPABASE_DB_NAME="${SUPABASE_DB_NAME:-postgres}"
export SUPABASE_DB_PORT="${SUPABASE_DB_PORT:-5432}"

# Local Supabase configuration
export LOCAL_DB_HOST="127.0.0.1"
export LOCAL_DB_PORT="5432"
export LOCAL_DB_USER="postgres"
export LOCAL_DB_PASSWORD="postgres"

# Output directory for schema files
export SCHEMA_DIR="$(dirname "$0")"

# Validate required variables
validate_config() {
    if [ -z "$SUPABASE_DB_PASSWORD" ]; then
        echo "❌ Error: SUPABASE_DB_PASSWORD environment variable must be set"
        echo ""
        echo "Set it with:"
        echo "  export SUPABASE_DB_PASSWORD='your-password-here'"
        echo ""
        echo "Or get it from Supabase dashboard:"
        echo "  Project Settings → Database → Connection string"
        exit 1
    fi

    if [ -z "$SUPABASE_DB_HOST" ]; then
        echo "❌ Error: SUPABASE_DB_HOST environment variable must be set"
        echo ""
        echo "Set it with:"
        echo "  export SUPABASE_DB_HOST='db.your-project.supabase.co'"
        echo ""
        echo "Or get it from Supabase dashboard:"
        echo "  Project Settings → Database → Connection string"
        exit 1
    fi
}

# Color codes for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export NC='\033[0m' # No Color

# Helper functions
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}
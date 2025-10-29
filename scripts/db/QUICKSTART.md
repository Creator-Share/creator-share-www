# Quick Start Guide

## First Time Setup

1. **Install migra:**
   ```bash
   pip install migra psycopg2-binary
   ```

2. **Copy the example env file:**
   ```bash
   cp .env.db.example .env.db
   ```

3. **Edit `.env.db` with your credentials:**
   ```bash
   # Get these from: Supabase Dashboard → Project Settings → Database
   export SUPABASE_DB_PASSWORD='your-actual-password'
   export SUPABASE_DB_HOST='db.yourproject.supabase.co'
   ```

4. **Load environment variables:**
   ```bash
   source .env.db
   ```

## Test Your Connection First

Before running the full sync, test that you can connect:

```bash
# Load credentials
source .env.db

# Test connection
./scripts/db/test_connection.sh
```

This will verify:
- Your credentials are correct
- Port 5432 is accessible
- Your IP is allowlisted in Supabase
- Tables are visible

If this fails, fix the connection issues before proceeding.

## Regular Workflow

### When you've made schema changes in Supabase Studio:

```bash
# 1. Load your database credentials
source .env.db

# 2. Run the sync workflow
./scripts/db/full_sync.sh

# 3. Review the diff (if any)
less scripts/db/diff.sql

# 4. Create a new migration
supabase migration new capture_studio_changes

# 5. Copy relevant SQL to the migration file
# Edit: supabase/migrations/YYYYMMDDHHMMSS_capture_studio_changes.sql

# 6. Test locally
supabase db reset

# 7. Preview what will be pushed to production
./scripts/db/preview_push.sh

# 8. If preview looks good, push to production
supabase db push
```

## Before Pushing to Production

Always preview your changes first:

```bash
# Preview what SQL will be executed on production
./scripts/db/preview_push.sh

# Review the output carefully
less scripts/db/push_preview.sql

# If it looks good, push
supabase db push
```

This shows the **reverse diff** (local → production) so you know exactly what changes will be applied.

## Troubleshooting

### Script says "migra is not installed"
```bash
pip install migra psycopg2-binary
# or
pip3 install migra psycopg2-binary
```

### "SUPABASE_DB_PASSWORD environment variable must be set"
```bash
# Make sure you've loaded your .env.db file
source .env.db

# Or set manually
export SUPABASE_DB_PASSWORD='your-password'
export SUPABASE_DB_HOST='db.yourproject.supabase.co'
```

### Can't connect to remote database
```bash
# Test connection manually
psql "postgresql://postgres:${SUPABASE_DB_PASSWORD}@${SUPABASE_DB_HOST}:5432/postgres" -c "SELECT version();"
```

## What This Replaces

❌ **Old (broken):**
```bash
supabase db diff --linked
```

✅ **New (reliable):**
```bash
./scripts/db/full_sync.sh
```

## Safety Checks

Before creating a migration, verify the diff doesn't contain:
- ❌ Unexpected DROP statements
- ❌ REVOKE statements
- ❌ Changes to auth.* or storage.* tables
- ✅ Only your intended changes

## Full Documentation

See [scripts/db/README.md](./README.md) for complete documentation.
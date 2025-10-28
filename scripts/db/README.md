# Database Schema Management Scripts

These scripts provide a safe alternative to `supabase db diff` for extracting and comparing database schemas. They bypass the Supabase CLI's authentication issues and prevent the problematic REVOKE statement generation.

## Prerequisites

### Required Tools

1. **PostgreSQL client tools** (pg_dump, psql)
   - Usually installed with PostgreSQL
   - Check: `pg_dump --version`

2. **migra** (for schema comparison)
   ```bash
   pip install migra psycopg2-binary
   # or
   pip3 install migra psycopg2-binary
   ```

3. **Supabase CLI** (for local development)
   - Only needed for `supabase db reset`
   - Check: `supabase --version`

## Setup

### 1. Set Environment Variables

You need to configure your remote Supabase database connection:

```bash
# Required
export SUPABASE_DB_PASSWORD='your-database-password'
export SUPABASE_DB_HOST='db.your-project.supabase.co'

# Optional (defaults shown)
export SUPABASE_DB_USER='postgres'
export SUPABASE_DB_NAME='postgres'
export SUPABASE_DB_PORT='5432'
```

**Getting your credentials:**
1. Go to Supabase Dashboard
2. Navigate to: Project Settings → Database
3. Find "Connection string" section
4. Copy the password and host from the connection string

### 2. Create .env file (recommended)

Create a `.env.db` file in the project root:

```bash
# .env.db
export SUPABASE_DB_HOST='db.yourproject.supabase.co'
export SUPABASE_DB_PASSWORD='your-password-here'
```

Load it before running scripts:
```bash
source .env.db
./scripts/db/full_sync.sh
```

**Important:** Add `.env.db` to your `.gitignore` to avoid committing credentials!

## Usage

### Quick Start (Most Common)

```bash
# Set your environment variables
export SUPABASE_DB_PASSWORD='your-password'
export SUPABASE_DB_HOST='db.yourproject.supabase.co'

# Run the full workflow
./scripts/db/full_sync.sh
```

This will:
1. Extract schema from remote database
2. Extract schema from local database (after applying migrations)
3. Generate a diff showing what changed

### Individual Scripts

#### Extract Remote Schema Only
```bash
./scripts/db/extract_remote.sh
```
Output: `scripts/db/remote_schema.sql`

#### Extract Local Schema Only
```bash
./scripts/db/extract_local.sh
```
Output: `scripts/db/local_schema.sql`

#### Generate Diff Only
```bash
./scripts/db/generate_diff.sh
```
Output: `scripts/db/diff.sql` (only if differences exist)

#### Extract Custom Types (ENUMs)
```bash
./scripts/db/extract_types.sh
```
Output: `scripts/db/custom_types.sql`

Use this when you see errors about missing types in the diff, such as:
- `activity_source does not exist`
- `sponsorship_method does not exist`

#### Preview Changes Before Push
```bash
./scripts/db/preview_push.sh
```
Output: `scripts/db/push_preview.sql`

**Shows what changes will be applied to production when you run `supabase db push`.**

This reverses the comparison direction:
- Normal sync: Shows what's different in remote (production → local)
- Preview push: Shows what will change in production (local → production)

## Workflow

### After Making Changes in Supabase Studio

1. **Run the sync workflow:**
   ```bash
   ./scripts/db/full_sync.sh
   ```

2. **Review the generated diff:**
   ```bash
   less scripts/db/diff.sql
   # or
   cat scripts/db/diff.sql
   ```

   The diff will automatically include:
   - Table structure changes
   - **Type changes (new/modified ENUMs)**
   - Function changes
   - Index changes
   - Constraint changes

3. **Check for red flags:**
   - ❌ Unexpected DROP TABLE/COLUMN statements
   - ❌ REVOKE statements (shouldn't appear with our setup)
   - ❌ Changes to auth.* or storage.* tables
   - ✅ Expected table/column additions
   - ✅ Type changes (CREATE TYPE, ALTER TYPE)
   - ✅ New indexes or constraints

4. **Create a new migration:**
   ```bash
   supabase migration new capture_studio_changes
   ```

5. **Copy relevant SQL from diff.sql to your new migration file:**
   ```bash
   # Edit: supabase/migrations/YYYYMMDDHHMMSS_capture_studio_changes.sql
   # Copy only the changes you want to keep
   ```

6. **Test locally:**
   ```bash
   supabase db reset
   # Test your application
   ```

7. **Preview what will be pushed to production:**
   ```bash
   ./scripts/db/preview_push.sh
   ```
   
   This shows the **reverse diff** (local → production) so you can see exactly what SQL will be executed on the production database.

8. **If preview looks good, push to production:**
   ```bash
   supabase db push
   ```

## Key Features

### ✅ What This Solves

- **No pooler authentication issues** - Connects directly to port 5432
- **No REVOKE statement bugs** - Uses `--no-acl` flag
- **Transparent process** - See exactly what SQL is generated
- **Direct PostgreSQL tools** - No Supabase CLI wrapper bugs

### 🔍 What Gets Extracted

**Included:**
- Tables structure
- **Custom types (ENUMs, composite types, domains)**
- Indexes
- Constraints
- Functions
- Views
- Triggers
- Sequences
- Extensions (in public schema)

**Excluded:**
- Table data
- Ownership commands (--no-owner)
- Permissions (--no-acl)
- Internal Supabase schemas (auth.*, storage.*, pgsodium.*, realtime.*)

**Note:** Custom types (ENUMs) are now automatically included in schema extraction and will appear in diffs when they change. This matches Supabase CLI behavior. The [`extract_types.sh`](extract_types.sh) script is still available if you need to see types in isolation.

## Troubleshooting

### "SUPABASE_DB_PASSWORD environment variable must be set"

Set your database password:
```bash
export SUPABASE_DB_PASSWORD='your-password-here'
```

### "migra is not installed"

Install migra:
```bash
pip install migra psycopg2-binary
```

### "Failed to extract remote schema"

Check your connection:
```bash
psql "postgresql://postgres:${SUPABASE_DB_PASSWORD}@${SUPABASE_DB_HOST}:5432/postgres" -c "SELECT version();"
```

### "Failed to reset local database"

Make sure Supabase is running:
```bash
supabase start
supabase status
```

### "Connection refused" on local database (port 5432)

The local Supabase database runs on port **5432**, not 54322. This is correct - our scripts use port 5432.

If you get connection refused:
1. Check Supabase is running: `supabase status`
2. Verify the Database URL shows `127.0.0.1:5432`
3. Try connecting manually: `psql postgresql://postgres:postgres@127.0.0.1:5432/postgres`

**Note:** Port confusion is common:
- Port **5432** = Direct PostgreSQL database (what we use)
- Port **54321** = Supabase API endpoint
- Port **54323** = Supabase Studio

### Connection timeout

If you're behind a firewall or VPN, ensure port 5432 is accessible to your Supabase project.

## Files Generated

These files are automatically created (and gitignored):

- `remote_schema.sql` - Schema from remote Supabase database
- `local_schema.sql` - Schema from local database (after migrations)
- `diff.sql` - Differences between local and remote (only if differences exist)

## Safety Checklist

Before creating a migration from a diff, always verify:

- [ ] No unexpected DROP statements
- [ ] No REVOKE statements (should be excluded)
- [ ] No changes to system schemas (auth.*, storage.*)
- [ ] Only expected tables/columns are affected
- [ ] No data loss risks
- [ ] Changes are intentional (match your Studio edits)

## Advanced Usage

### Extract Specific Tables Only

Modify the script to target specific tables:

```bash
PGPASSWORD="${SUPABASE_DB_PASSWORD}" pg_dump \
  --host="${SUPABASE_DB_HOST}" \
  --schema-only \
  --no-owner \
  --no-acl \
  --table=public.your_table_name \
  --file="specific_table.sql"
```

### Compare Without Running supabase db reset

If you want to skip the local reset (faster):

```bash
./scripts/db/extract_remote.sh
# Skip extract_local.sh
./scripts/db/generate_diff.sh
```

Note: This compares against the current local database state, which might not reflect all migrations.

## Why These Scripts Exist

The Supabase CLI's `db diff` command has several issues:

1. **Intermittent authentication errors** with the pooler
2. **Generates REVOKE statements** that strip permissions
3. **Ignores SUPABASE_DB_PASSWORD** environment variable inconsistently

These scripts use native PostgreSQL tools (`pg_dump`, `psql`) and the `migra` comparison tool to provide a more reliable workflow.

## References

- [pg_dump documentation](https://www.postgresql.org/docs/current/app-pgdump.html)
- [migra GitHub](https://github.com/djrobstep/migra)
- [Supabase Database Docs](https://supabase.com/docs/guides/database)
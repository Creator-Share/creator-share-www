# Data Layer Findings (Supabase / Postgres / RLS)

Reviewed all 34 migrations in `supabase/migrations/`, `config.toml`, `seed.sql`, `sql/`, `scripts/db/`, the generated `db.types.ts`, and query patterns across `src/`. The RLS findings here are the database-side view of the security report's C1–C4/C6/H2 — the same root cause, documented from the schema's perspective. See [findings-security.md](./findings-security.md) for the exploit framing.

---

## Per-table RLS status (final state after all migrations applied in timestamp order)

| Table | RLS enabled? | Policies | `anon` grants | Risk |
|---|---|---|---|---|
| `beneficiaries` (was `sponsor_people`) | **YES** (re-enabled `20251006120000`) | public SELECT `true`; SUPER_ADMIN write via `role_assignments` subquery | ALL | OK — public data, writes denied to anon |
| `roles` | YES | SELECT authenticated `true` | ALL | Low — RLS blocks; leaks role UUIDs |
| `permissions`, `permission_assignments` | YES | SELECT authenticated `true` | ALL | Low |
| `advocate`, `initiative`, `organization`, `project` | YES | SELECT `true` | ALL | Low |
| **`users`** | **NO — never enabled** | none | ALL | **CRITICAL** — emails, names, `auth.users.id` anon read/write |
| **`subscriptions`** | **NO — never enabled** | none | ALL | **CRITICAL** — sponsor PII, `customer_id`, amounts; realtime channel open |
| **`transaction_ledger`** | **NO** (`insert_user` policy inert) | `insert_user WITH CHECK(true)` (dormant) | ALL | **CRITICAL** — `customer_email/name`, `payment_intent`; anon can forge donations |
| **`role_assignments`** | **DISABLED** `20251006120000:62` | base SELECT-auth policy now inert | ALL | **CRITICAL** — anon INSERT → self-grant SUPER_ADMIN |
| **`partnerships`** | **NO — never enabled** | `Allow public insert`; `view own` (inert) | ALL | **HIGH** — `card_number`, `card_type` exposed |
| **`media`** | **DISABLED** `20251006120000:45` | policies from `20250923123000` now inert | ALL | **HIGH** — anon media-row injection into emails/pages |
| **`activities`** (was `people_activities`) | **NO — never enabled** | none | ALL | **HIGH** — private (`is_public=false`) notes anon read/write |
| **`expenses`**, **`expense_assignments`** | **DISABLED** `20251006120000:41-43` | SELECT `true` (inert) | ALL | MEDIUM |
| **`activity_subscriptions`** | **NO — never enabled** | none | ALL | MEDIUM — subscriber email list exposed |
| **`email_logs`** | **NO — never enabled** | none | ALL (via default privileges) | MEDIUM — recipient emails/subjects |
| **`beneficiary_reservations`** | **NO — never enabled** | 3 policies incl. `allow_delete_own USING(true)` (inert) | ALL | MEDIUM — anon read/delete any reservation (`created_ip`, `user_agent`) |

---

## CRITICAL

### D1 — RLS disabled/absent on all sensitive tables (root cause)
See the matrix above and security C1–C4/C6/H2. The mechanism has two layers:
1. The **catch-up migration** [`20251006120000_missing_migrations.sql`](../../supabase/migrations/20251006120000_missing_migrations.sql) actively **disables** RLS that earlier migrations had enabled (`media:45`, `expenses:41`, `expense_assignments:43`, `role_assignments:62`). This is a migration that loosens security — the exact hygiene red flag.
2. Several tables (`users`, `subscriptions`, `transaction_ledger`, `partnerships`, `activities`, `activity_subscriptions`, `email_logs`, `beneficiary_reservations`) were **never** given `ENABLE ROW LEVEL SECURITY` at all.

**Fix:** A single remediation migration that, for every sensitive table: `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon, authenticated` (keep `service_role`), and adds explicit policies (public SELECT only where intended; owner-scoped SELECT for user-owned rows; writes via service role or SUPER_ADMIN). Rewrite the dormant `USING(true)`/`WITH CHECK(true)` policies **before** enabling RLS, or enabling it will silently activate wide-open rules (see M1).

### D2 — Base-schema default privileges grant `ALL` to `anon` for all current *and future* tables
[`20250124232440_remote_schema.sql:164-204`](../../supabase/migrations/20250124232440_remote_schema.sql): `GRANT ALL … TO anon`/`authenticated` plus `ALTER DEFAULT PRIVILEGES … GRANT ALL … TO anon`. Every new public table inherits full anon access by default — which is why `email_logs`, `beneficiary_reservations`, etc. are exposed without any explicit grant. This makes the RLS-disable actions catastrophic rather than merely sloppy.

**Fix:** `ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM anon, authenticated;` and grant narrowly per table going forward. Add a CI check (or a Supabase linter run) that fails if a new table is `anon`-writable or RLS-off.

---

## HIGH

### D3 — The RLS-loosening migration also adds misleadingly-named permissive policies
`20251006120000` adds `beneficiary_reservations` policies `allow_delete_own USING(true)` / `allow_insert_own WITH CHECK(true)` — named "own" but fully public, and inert anyway (RLS never enabled on that table). If RLS is later enabled without rewriting these, "own" reservations become deletable by anyone.

### D4 — Storage policies are broad
`storage.objects` policies ([`20251006120000:262-336`](../../supabase/migrations/20251006120000_missing_migrations.sql)) let any `authenticated` role insert/update/delete in the `beneficiaries` and `activities-media` buckets, with public SELECT on `media`. Combined with the SUPER_ADMIN self-grant (D1), or if anonymous sign-in were ever enabled, this widens blast radius. Mitigated today only by `enable_anonymous_sign_ins = false` ([`config.toml:113`](../../supabase/config.toml)). **Fix:** scope storage writes to admins/owners.

---

## MEDIUM

### M1 — Dormant policies give a false sense of protection
`transaction_ledger.insert_user`, all `partnerships` / `beneficiary_reservations` policies, and the `media`/`expenses` policies are defined on tables whose RLS is off — they do nothing until RLS is enabled, and several are `WITH CHECK(true)`/`USING(true)`. Enabling RLS naively would activate wide-open rules. **Fix:** rewrite these to real owner/admin predicates as part of the D1 remediation.

### M2 — `beneficiary_reservations` unique index is not partial
`uniq_active_reservation_per_beneficiary` is `UNIQUE(beneficiary_id)` ([`20251006120000:92`](../../supabase/migrations/20251006120000_missing_migrations.sql)), not scoped to `expires_at > now()`. Once any reservation row exists, no new reservation can be created for that beneficiary until the old row is physically deleted — even after the 15-minute expiry. A correctness bug in the reservation flow. **Fix:** make it a partial unique index on `(beneficiary_id) WHERE expires_at > now()` (mirror the `subscriptions` pattern), or a scheduled cleanup.

### M3 — Dead / bug-carrying DB function `get_active_subscription_total`
[`20250218084246:86-97`](../../supabase/migrations/20250218084246_subscription_and_images.sql) filters `status = 'active'`, but `SubscriptionStatus` only has `complete/incomplete/cancelled` — so it always returns 0. Marked `IMMUTABLE` while reading a table (wrong volatility). **Fix:** drop it (or fix + re-mark `STABLE`) after confirming no references.

### M4 — `filter_by_polygon` references a dropped table
[`20250212025932:154-166`](../../supabase/migrations/20250212025932_rename_people_table.sql) defines `filter_by_polygon()` selecting `FROM people`, but `people` is dropped/renamed to `beneficiaries` in the same migration chain. Broken/stale. **Fix:** drop or repoint to `beneficiaries`.

### M5 — SECURITY DEFINER functions without pinned `search_path`
`handle_user_registration` ([`20251006120000:117-138`](../../supabase/migrations/20251006120000_missing_migrations.sql), SECURITY DEFINER) and the older `handle_new_user` don't `SET search_path`. This is the standard Supabase-linter warning — a schema-shadowing hardening gap. **Fix:** `SET search_path = public, pg_temp` on all SECURITY DEFINER functions.

---

## LOW

### L1 — Missing indexes on the public listing's hot filters
The public browse filters heavily by `beneficiary_type` + `status`, but there is **no index** on `beneficiaries.beneficiary_type` or `beneficiaries.status` (existing indexes are only `location_geo` gist and `sort_weight`). Full-table scans as the table grows. `beneficiary_type` was also converted enum→`text` ([`20260505000000`](../../supabase/migrations/)) with no CHECK constraint, so filter typos silently return nothing. **Fix:** add a composite (or partial) index on `(beneficiary_type, status)`; consider a CHECK/enum for `beneficiary_type`.

### L2 — Inconsistent timestamp timezone-awareness
Money is `integer` cents consistently (good). But `users.created_at` and `subscriptions.current_period_start/end`/`canceled_at` are `timestamp WITHOUT time zone` while most other timestamps are `timestamptz`. Risks off-by-hours bugs in period/cancellation logic. **Fix:** standardize on `timestamptz`.

### L3 — Duplicated statements + magic-value sentinel
[`20250514214053_beneficiary-updates.sql:62-82`](../../supabase/migrations/20250514214053_beneficiary-updates.sql) duplicates a trigger/index block verbatim (idempotent, but noise). The `budget_goal = -1` "open sponsorship" sentinel is threaded through triggers and app `.or()` filters — brittle vs. an explicit `is_open` boolean column.

---

## Confirmed-good (do not regress)

- **Budget math is atomic:** `update_beneficiary_by_subscriptions` ([`20260526153000:133`](../../supabase/migrations/)) recomputes `budget_raised` from `subscriptions` in one guarded statement — no read-modify-write race. `reject_fulfilled_beneficiary_subscription` correctly handles blind (`NULL beneficiary_id`) and open (`budget_goal=-1`) cases. One active subscription per beneficiary enforced by a partial unique index. *(Note the migrations themselves flag that service-role inserts bypass these triggers' dup protection — an accepted app-layer responsibility.)*
- **FKs / ON DELETE are sensible** (CASCADE on join tables, SET NULL on optional refs); `role_assignments.user_id` correctly re-pointed to `auth.users`; `beneficiaries.username` and `users.email` uniquely indexed.
- **Migrations are ordered and idempotent** (`IF NOT EXISTS` / `DO $$ … EXCEPTION`); the consolidated `20251028031500_dev_migrations.sql` is intentionally empty.
- **`db.types.ts` (2790 lines) is current** with PostgREST 13.0.4 — it is under-used (see [findings-api-backend.md](./findings-api-backend.md#type-safety)), not stale.

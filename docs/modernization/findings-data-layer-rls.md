# Data Layer Findings (Supabase / Postgres / RLS)

> ## ⚠️ CORRECTED AFTER PRODUCTION VERIFICATION (2026-07-05)
> This document was built by statically reading the **migration files**. The matrix and CRITICAL findings below (D1, D2) described the migrations, **not the running database** — and the running database is materially different. Live read-only queries confirm **RLS is enabled with restrictive policies on every sensitive table in production**; an anonymous caller reads zero rows. The "RLS disabled/absent" criticals are **refuted**. The genuine finding is the **drift** between migrations and the live DB. Authoritative evidence and the corrected matrix: **[findings-production-verification.md](./findings-production-verification.md)**.

Reviewed all 34 migrations in `supabase/migrations/`, `config.toml`, `seed.sql`, `sql/`, `scripts/db/`, the generated `db.types.ts`, and query patterns across `src/`. **Caveat:** migration files ≠ live schema here — always cross-check against production.

---

## Per-table RLS status — MIGRATIONS vs PRODUCTION

The left column is what the committed migrations produce; the right is what production actually enforces (verified live). **The gap between them is the finding (D1, below).**

| Table | Migrations imply | **Production (verified)** |
|---|---|---|
| `role_assignments` | RLS **disabled** → anon self-grant | ✅ **RLS on**, INSERT `WITH CHECK is_super_admin()` — escalation blocked |
| `users` | RLS absent → anon PII read/write | ✅ **RLS on**, SELECT `own_or_super_admin` — anon reads 0 |
| `subscriptions` | RLS absent → anon read/write | ✅ **RLS on**, SELECT `own_or_super_admin` — anon reads 0 |
| `transaction_ledger` | RLS absent → forge donations | ✅ **RLS on**, SELECT `own_or_super_admin`; ⚠️ `{public}` INSERT `WITH CHECK(true)` (Medium — insert-only, see verification doc) |
| `partnerships` | RLS absent → card data exposed | ✅ **RLS on**, SELECT `own_or_super_admin`; ⚠️ `{public}` INSERT `WITH CHECK(true)` (Medium) |
| `media` | RLS disabled → anon injection | ✅ **RLS on**; anon writes blocked; ⚠️ authenticated INSERT/UPDATE `WITH CHECK(true)` (Medium) |
| `activities` | RLS absent → private notes exposed | ✅ **RLS on**; anon sees only `is_public=true` (56 rows), private hidden |
| `activity_subscriptions`, `email_logs` | RLS absent → lists exposed | ✅ **RLS on** — anon reads 0 |
| `expenses`, `expense_assignments` | RLS disabled | ✅ **RLS on** + **anon grant revoked** (most-locked) |
| `roles` | SELECT auth `true` | ✅ RLS on; ⚠️ permissive `USING(true)` SELECT lets any authed user enumerate (Low) |
| `beneficiaries` | RLS on, public read | ✅ RLS on, public read (366 rows) — by design |
| `beneficiary_reservations` | table exists | ⚠️ **does not exist in production** (dev-only) — drift |

---

## HIGH

### D1 — Migrations do not reproduce production security (**drift** — the real finding)
The committed migrations contain **zero** `ENABLE ROW LEVEL SECURITY` statements for the sensitive tables and **none** of the 29 live policies or the `is_super_admin()` predicate they depend on. Production was hardened out-of-band (dashboard). Consequence: **rebuilding the DB from migrations — local dev, staging, a DR restore, a fresh project — yields an insecure database** (RLS off, `GRANT ALL TO anon` intact). This is an operational / reproducibility / DR risk, not a live breach.

**Fix:** `supabase db pull` (or dump `pg_policies`/grants) to capture the live RLS posture into a committed migration, then keep migrations authoritative. Add a CI check (or scheduled Supabase linter run) that fails if any `public` table is RLS-off or `anon`-writable. This also resolves the dev↔prod divergence (`expenses` grants, `beneficiary_reservations` existence).

### ~~D2 — Base-schema default privileges grant `ALL` to `anon`~~ — reclassified LOW (hygiene)
The `GRANT ALL … TO anon` / `ALTER DEFAULT PRIVILEGES` grants ([`20250124232440_remote_schema.sql:164-204`](../../supabase/migrations/20250124232440_remote_schema.sql)) **do** exist, but they are **harmless in production because RLS gates them** — grants are necessary-but-not-sufficient. Still worth tightening as defense-in-depth (revoke the blanket defaults; grant narrowly) so that a future RLS-disable can't silently expose a table.

---

## HIGH

### D3 — The RLS-loosening migration also adds misleadingly-named permissive policies
`20251006120000` adds `beneficiary_reservations` policies `allow_delete_own USING(true)` / `allow_insert_own WITH CHECK(true)` — named "own" but fully public, and inert anyway (RLS never enabled on that table). If RLS is later enabled without rewriting these, "own" reservations become deletable by anyone.

### D4 — Storage policies are broad
`storage.objects` policies ([`20251006120000:262-336`](../../supabase/migrations/20251006120000_missing_migrations.sql)) let any `authenticated` role insert/update/delete in the `beneficiaries` and `activities-media` buckets, with public SELECT on `media`. Combined with the SUPER_ADMIN self-grant (D1), or if anonymous sign-in were ever enabled, this widens blast radius. Mitigated today only by `enable_anonymous_sign_ins = false` ([`config.toml:113`](../../supabase/config.toml)). **Fix:** scope storage writes to admins/owners.

---

## MEDIUM

### M1 — Permissive `WITH CHECK(true)` / `USING(true)` policies are ACTIVE in production
Corrected framing: RLS **is** enabled in prod, so these policies are live, not dormant. Verified permissive ones: `transaction_ledger.insert_user` (`{public}` INSERT `WITH CHECK true`), `partnerships` public-insert policies (`WITH CHECK true`), `media`/`subscriptions`/`transaction_ledger` authenticated INSERT (`WITH CHECK true`), and leftover `roles`/`role_assignments` `SELECT USING(true)`. Net effect: anon can INSERT into `transaction_ledger`/`partnerships`; any authenticated user can INSERT into `media`/`subscriptions`; any authenticated user can enumerate `roles`/`role_assignments`. **Fix:** rewrite each to a real owner/admin predicate and drop the redundant permissive duplicates. Details in [findings-production-verification.md](./findings-production-verification.md) §2.

### M2 — `beneficiary_reservations` unique index is not partial (⚠️ table is dev-only)
`uniq_active_reservation_per_beneficiary` is `UNIQUE(beneficiary_id)` ([`20251006120000:92`](../../supabase/migrations/20251006120000_missing_migrations.sql)), not scoped to `expires_at > now()` — so once any reservation exists, no new one can be created for that beneficiary until the row is physically deleted, even after expiry. **Verified caveat:** the `beneficiary_reservations` table **does not exist in production** (it exists only in dev) — another drift symptom. If/when the reservation feature ships to prod, fix this as a partial unique index on `(beneficiary_id) WHERE expires_at > now()`.

### M3 — Dead / bug-carrying DB function `get_active_subscription_total`
[`20250218084246:86-97`](../../supabase/migrations/20250218084246_subscription_and_images.sql) filters `status = 'active'`, but `SubscriptionStatus` only has `complete/incomplete/cancelled` — so it always returns 0. Marked `IMMUTABLE` while reading a table (wrong volatility). **Fix:** drop it (or fix + re-mark `STABLE`) after confirming no references.

### M4 — `filter_by_polygon` references a dropped table
[`20250212025932:154-166`](../../supabase/migrations/20250212025932_rename_people_table.sql) defines `filter_by_polygon()` selecting `FROM people`, but `people` is dropped/renamed to `beneficiaries` in the same migration chain. Broken/stale. **Fix:** drop or repoint to `beneficiaries`.

### M5 — SECURITY DEFINER functions without pinned `search_path` (verified in prod)
Confirmed live: `is_super_admin()` (`prosecdef=true`, `proconfig=null`) and `handle_user_registration` are SECURITY DEFINER with **no** `search_path` set. This matters more than first stated — **`is_super_admin()` is called by every admin RLS policy**, so a schema-shadowing gap here undermines the whole authorization model. **Fix:** `ALTER FUNCTION public.is_super_admin() SET search_path = public, pg_temp;` (and `handle_user_registration`, and any other SECURITY DEFINER function).

---

## LOW

### L1 — Missing + duplicate indexes on `beneficiaries` (verified in prod)
Confirmed live: **no index** on `beneficiaries.beneficiary_type` or `status` — the hot public-listing filter does full scans (366 rows today, grows with the org). Meanwhile there are **three identical GIST indexes** on `location_geo` (`idx_beneficiaries_location_geo`, `idx_people_location`, `idx_people_location_geo`) — wasted write/storage overhead. `beneficiary_type` was converted enum→`text` with no CHECK constraint, so filter typos silently return nothing. **Fix:** add a composite/partial index on `(beneficiary_type, status)`, drop two of the three redundant geo indexes, and add a CHECK (or enum) for `beneficiary_type`.

### L2 — Inconsistent timestamp timezone-awareness
Money is `integer` cents consistently (good). But `users.created_at` and `subscriptions.current_period_start/end`/`canceled_at` are `timestamp WITHOUT time zone` while most other timestamps are `timestamptz`. Risks off-by-hours bugs in period/cancellation logic. **Fix:** standardize on `timestamptz`.

### L3 — Duplicated statements + magic-value sentinel
[`20250514214053_beneficiary-updates.sql:62-82`](../../supabase/migrations/20250514214053_beneficiary-updates.sql) duplicates a trigger/index block verbatim (idempotent, but noise). The `budget_goal = -1` "open sponsorship" sentinel is threaded through triggers and app `.or()` filters — brittle vs. an explicit `is_open` boolean column.

---

## Confirmed-good (do not regress)

- **Budget math is atomic:** `update_beneficiary_by_subscriptions` ([`20260526153000:133`](../../supabase/migrations/)) recomputes `budget_raised` from `subscriptions` in one guarded statement — no read-modify-write race. `reject_fulfilled_beneficiary_subscription` correctly handles blind (`NULL beneficiary_id`) and open (`budget_goal=-1`) cases. *(Note the migrations themselves flag that service-role inserts bypass these triggers' dup protection — an accepted app-layer responsibility.)*
  - ⚠️ **Corrected (twice):** the original doc claimed "one active subscription per beneficiary enforced by a partial unique index." That index is **absent from production — by design**: migration `20251126040000_remove_duplicate_subscription_constraint` intentionally dropped it because *beneficiaries should accept multiple sponsors until their budget goal is met* (cap enforced by the `reject_fulfilled_beneficiary_subscription` trigger). So it is **not** an enforced invariant and **must not be re-added**. See [findings-production-verification.md](./findings-production-verification.md) §3.
- **FKs / ON DELETE are sensible** (CASCADE on join tables, SET NULL on optional refs); `role_assignments.user_id` correctly re-pointed to `auth.users`; `beneficiaries.username` and `users.email` uniquely indexed.
- **Migrations are ordered and idempotent** (`IF NOT EXISTS` / `DO $$ … EXCEPTION`); the consolidated `20251028031500_dev_migrations.sql` is intentionally empty.
- **`db.types.ts` (2790 lines) is current** with PostgREST 13.0.4 — it is under-used (see [findings-api-backend.md](./findings-api-backend.md#type-safety)), not stale.

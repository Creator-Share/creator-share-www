# Creator Share — Codebase Modernization Audit

**Date:** 2026-07-03 · **Production-verified:** 2026-07-05
**Scope:** Full-codebase review of `creator-share-www` (Next.js 15 App Router, React 19, Chakra UI v3, Supabase/Postgres, Stripe + PayPal, TanStack Query, Zustand) — ~250 TS/TSX files, ~42k LOC, 75 API routes.
**Method:** Six parallel deep-dive reviews (security/auth, data layer/RLS, payments correctness, API/backend maintainability, frontend/React/performance, tooling/build/deps/tests/CI), each cross-checked against the source — **then verified against the live production database** with read-only queries.

This folder is the deliverable. Start here, then read the [Upgrade Plan](./upgrade-plan.md) and the per-area findings documents.

---

## ⚠️ Read this first — the big correction, and what's actually urgent

> **The audit's original #1 finding was wrong.** The security and data-layer passes read the repo's **migration files** and concluded that Row Level Security was disabled on the sensitive tables, implying trivial anonymous privilege-escalation to SUPER_ADMIN and mass PII exposure. **Verification against the live production database refuted that:** RLS is enabled and correctly enforced on every sensitive table (`role_assignments`, `users`, `subscriptions`, `transaction_ledger`, `partnerships`, …); an anonymous caller reads **zero rows** from all of them, and non-admins cannot self-grant a role. The migrations simply never captured the hardening that was done in the Supabase dashboard. See **[findings-production-verification.md](./findings-production-verification.md)** for the authoritative evidence.

What is genuinely urgent (all verified):

1. **A live Telegram bot token is committed and shipped to the browser** (`src/config/telegram.ts:3` fallback + `src/app/test-telegram/page.tsx`). **Rotate it via BotFather now** — it's in git history and already public. → [Security C5](./findings-security.md#c5)
2. **Migration↔production drift.** The correct security posture exists only in the live DB, not the committed migrations — so any rebuild/restore/staging/local DB comes up **insecure**. Capture it into a migration. → [Verify M-DRIFT-1](./findings-production-verification.md)
3. **App-layer privilege escalation** via `complete-invitation` trusting user-writable `user_metadata.role_ids`, written through the service-role client (**bypasses RLS**). → [Verify §5](./findings-production-verification.md)
4. **18 real sponsors are orphaned** — complete subscriptions with no beneficiary assigned (blind-sponsorship auto-match failing), oldest from 2025-07-29. → [Verify §3](./findings-production-verification.md)

---

## Severity dashboard (post-verification)

| Area | Critical | High | Medium | Low | Detail |
|---|---|---|---|---|---|
| Security & auth | **1** | 4 | 5 | 6 | [findings-security.md](./findings-security.md) |
| Data layer (RLS/schema) | **0** | 1 | 6 | 3 | [findings-data-layer-rls.md](./findings-data-layer-rls.md) |
| **Production verification** | — | 2 | 3 | 2 | [findings-production-verification.md](./findings-production-verification.md) |
| Payments correctness | 1* | 5 | 6 | 5 | [findings-payments.md](./findings-payments.md) |
| API / backend | — | 5 | 5 | 3 | [findings-api-backend.md](./findings-api-backend.md) |
| Frontend / React / perf | — | 7 | 9 | 6 | [findings-frontend.md](./findings-frontend.md) |
| Tooling / build / tests / CI | — | 6 | 6 | 4 | [findings-tooling.md](./findings-tooling.md) |

*The five original RLS "criticals" were refuted in production and are struck through in the findings docs. \*Payments "critical" = the double-credit/silent-capture class, latent (no victims in prod data yet) except the 18 orphaned sponsorships, which are materialized.*

---

## The ten highest-leverage fixes (re-ranked after verification)

Ranked by (risk × reach) ÷ effort. Full sequencing is in the [Upgrade Plan](./upgrade-plan.md).

1. **Rotate the leaked Telegram token**; delete the hardcoded fallback + `/test-telegram` page; delete/guard all `src/app/api/test/**` routes. *(Only live CRITICAL.)*
2. **Close the migration↔prod drift** — `supabase db pull` the live RLS/policies/grants into a committed migration; add a CI check that fails on any RLS-off `public` table. *(Makes the good posture reproducible before a restore reintroduces the theoretical holes.)*
3. **Close the `complete-invitation` escalation** — stop deriving roles from user-writable `user_metadata`; use a server-only `invitations` table or `app_metadata`. *(RLS does not cover service-role writes.)*
4. **Reconcile the 18 orphaned sponsorships** and fix blind-sponsorship auto-match (call the matcher in-process, not via an unauthenticated admin HTTP hop).
5. **Tighten the over-permissive live policies** — drop `{public}` INSERT `WITH CHECK(true)` on `transaction_ledger`/`partnerships`; bind `media`/`subscriptions` authenticated inserts to ownership; drop leftover `USING(true)` SELECT on `roles`/`role_assignments`; pin `search_path` on `is_super_admin()`.
6. **Fix the payment integrity bugs** — PayPal double-credit (add the unique `(reference, tx_action)` + `stripe_subscription_id` constraints — both missing in prod), Stripe silent money-capture on reconciliation failure, webhook `200-on-error`.
7. **Type the Supabase client** (`createServerClient<Database>`) — deletes ~19 unsound `as unknown as` casts.
8. **Introduce a shared route wrapper + `zod` schemas** — collapses duplication across 69 files, fixes `error.message` leakage and mass-assignment.
9. **Add a CI quality gate** (install-frozen + lint + `typecheck` + test + build); add `typecheck`; resolve dual-lockfile drift; prune dead/phantom deps. *(Also cuts the ~35 duplicated Dependabot alerts in half.)*
10. **Adopt (or remove) TanStack Query** (installed, mounted, never used) — fixes the N+1 per-card image fetch, Zustand server-state staleness, and hand-rolled fetch logic. Then **SSR beneficiary profiles with `generateMetadata`** for shareable-link SEO.

---

## Documents in this folder

| File | Contents |
|---|---|
| [findings-production-verification.md](./findings-production-verification.md) | **Authoritative.** Live read-only audit of the production DB: actual RLS/policy/grant state, refuted findings, real residuals, index/constraint reality, data-integrity checks, migration/dev/prod drift. |
| [upgrade-plan.md](./upgrade-plan.md) | The phased modernization roadmap (Phase 0–5), with sequencing, effort, and acceptance criteria. Re-scoped after verification. |
| [findings-security.md](./findings-security.md) | Auth/authz, committed secret, unauthenticated endpoints, headers, enumeration. RLS criticals struck through (refuted). |
| [findings-data-layer-rls.md](./findings-data-layer-rls.md) | Migrations-vs-production RLS matrix, schema/index/constraint issues, dead DB functions, migration hygiene. |
| [findings-payments.md](./findings-payments.md) | Webhook idempotency, double-credit, silent money capture, subscription lifecycle, currency/region correctness. |
| [findings-api-backend.md](./findings-api-backend.md) | Duplication metrics, validation, error handling, type safety, REST/service-layer structure. |
| [findings-frontend.md](./findings-frontend.md) | React Query unused, SSR/SEO gap, N+1 rendering, Zustand server-state, a11y, forms, duplication. |
| [findings-tooling.md](./findings-tooling.md) | Lockfile drift, dead/phantom deps, ESLint 9 config, tests, CI gate, env inventory, config risks. |

---

## What is already good (so we don't regress it)

- **Admin API authorization is correct AND backed by RLS in production.** All 41 `src/app/api/admin/**` routes call `requireSuperAdmin` (JWT-validated via `auth.getUser()`), and the DB enforces RLS behind it — sound end-to-end. *(Caveat: the RLS lives only in the live DB, not migrations — see drift.)*
- **Webhook signature verification is correct** for both Stripe and PayPal, with `provider_event_id` replay protection.
- **Budget math is atomic** — `budget_raised` recomputed by SUM in a single trigger statement (no race), with correct blind/open handling. *(Caveat: the one-subscription-per-beneficiary partial unique index the migrations claim does **not** exist in prod — 0 duplicates today, but add it.)*
- **Generated DB types are current** (`db.types.ts`, PostgREST 13.0.4) — just under-used.
- **The `docs/` folder is unusually thorough** — this audit adds to that strength.
- **`ProgressiveImage`** is a solid `next/image` wrapper, and image compression is centralized.

# Creator Share — Codebase Modernization Audit

**Date:** 2026-07-03
**Scope:** Full-codebase review of `creator-share-www` (Next.js 15 App Router, React 19, Chakra UI v3, Supabase/Postgres, Stripe + PayPal, TanStack Query, Zustand) — ~250 TS/TSX files, ~42k LOC, 75 API routes.
**Method:** Six parallel deep-dive reviews (security/auth, data layer/RLS, payments correctness, API/backend maintainability, frontend/React/performance, tooling/build/deps/tests/CI), each cross-checked against the source.

This folder is the deliverable. Start here, then read the [Upgrade Plan](./upgrade-plan.md) for the phased remediation roadmap and the per-area findings documents for the full detail.

---

## ⚠️ Read this first — act today

Two findings are actively exploitable **right now**, from a browser, with no privileged access:

1. **Anyone can make themselves a SUPER_ADMIN.** Row Level Security is disabled on `role_assignments` (and other sensitive tables) while the table is granted to `anon`. The public anon key ships in every page bundle, so a visitor can `insert` a `role_assignments` row granting themselves the SUPER_ADMIN role, then pass every server-side admin check. The same gap exposes all sponsor PII and the financial ledger (emails, names, card metadata, payment intents) to unauthenticated reads/writes. → [Security](./findings-security.md#c1) · [Data Layer](./findings-data-layer-rls.md)
2. **A live Telegram bot token is committed and shipped to the browser** in `src/app/test-telegram/page.tsx`. **Rotate it via BotFather immediately** — removing it from the file does not un-leak it (it is in git history and already public to anyone who loaded `/test-telegram`). → [Security C4](./findings-security.md#c4)

Everything else can be scheduled. These two cannot.

---

## Severity dashboard

| Area | Critical | High | Medium | Low | Detail |
|---|---|---|---|---|---|
| Security & auth | 6 | 4 | 4 | 6 | [findings-security.md](./findings-security.md) |
| Data layer (RLS/schema) | 2 | 2 | 5 | 3 | [findings-data-layer-rls.md](./findings-data-layer-rls.md) |
| Payments correctness | 3 | 5 | 5 | 5 | [findings-payments.md](./findings-payments.md) |
| API / backend | — | 5 | 5 | 3 | [findings-api-backend.md](./findings-api-backend.md) |
| Frontend / React / perf | — | 7 | 9 | 6 | [findings-frontend.md](./findings-frontend.md) |
| Tooling / build / tests / CI | — | 6 | 6 | 4 | [findings-tooling.md](./findings-tooling.md) |

*Security and data-layer overlap on the RLS finding — it is the single highest risk in the codebase and is counted in both.*

---

## The ten highest-leverage fixes

Ranked by (risk × reach) ÷ effort. Full sequencing is in the [Upgrade Plan](./upgrade-plan.md).

1. **Enable RLS + revoke `anon`/`authenticated` grants** on `role_assignments`, `users`, `subscriptions`, `transaction_ledger`, `partnerships`, `activities`, `media`, `expenses`, `expense_assignments`, `email_logs`, `beneficiary_reservations`, `activity_subscriptions`. Fix the base-schema default-privileges grant so new tables are locked by default. *(Fixes the privilege-escalation + PII/PCI exposure.)*
2. **Rotate the leaked Telegram token**, delete/guard all `src/app/api/test/**` routes and `/test-telegram`, `/test-embed-iframe` pages. *(Live secret + unauthenticated email/telegram relays.)*
3. **Close the `complete-invitation` escalation path** — stop deriving roles from user-writable `user_metadata`; source invited roles from a server-only `invitations` table or `app_metadata`.
4. **Authenticate + ownership-check `/api/stripe/cancel-subscription`** and re-derive checkout `amount`/`userId`/`beneficiaryId` server-side (stop trusting the client for money and attribution).
5. **Fix the payment integrity bugs** — PayPal one-time double-credit (idempotency-key mismatch), Stripe silent money-capture on reconciliation failure, and webhook `200-on-error` that loses events on transient DB failures.
6. **Type the Supabase client** (`createServerClient<Database>`) — one file, deletes ~19 unsound `as unknown as` casts and the `RoleAssignmentResponse` pattern.
7. **Introduce a shared route wrapper + `zod` schemas** — collapses try/catch + parse + auth + error-shape duplication across 69 files, fixes `error.message` leakage (13 routes) and mass-assignment holes.
8. **Add a CI quality gate** (install-frozen + lint + `typecheck` + test + build on PRs); add the missing `typecheck` script; resolve the dual-lockfile drift; prune dead/phantom dependencies.
9. **Adopt (or remove) TanStack Query.** It is installed and mounted but never used; fixing this resolves the N+1 per-card image fetch, server-state-in-Zustand staleness, and the hand-rolled fetch/retry/abort logic in one move.
10. **Server-render beneficiary profile pages with `generateMetadata`.** Shareable `/sponsorships/:username` links currently produce contentless previews — a direct hit to a donation site's core growth loop.

---

## Documents in this folder

| File | Contents |
|---|---|
| [upgrade-plan.md](./upgrade-plan.md) | The phased modernization roadmap: 5 phases from "stop the bleeding" to "extensibility", with sequencing, effort, and acceptance criteria. |
| [findings-security.md](./findings-security.md) | Auth/authz, RLS-as-master-key, committed secret, IDOR, unauthenticated endpoints, headers, enumeration. |
| [findings-data-layer-rls.md](./findings-data-layer-rls.md) | Per-table RLS status matrix, schema/index/constraint issues, dead & broken DB functions, migration hygiene. |
| [findings-payments.md](./findings-payments.md) | Webhook idempotency, double-credit, silent money capture, subscription lifecycle, currency/region correctness. |
| [findings-api-backend.md](./findings-api-backend.md) | Duplication metrics, validation, error handling, type safety, REST/service-layer structure. |
| [findings-frontend.md](./findings-frontend.md) | React Query unused, SSR/SEO gap, N+1 rendering, Zustand server-state, a11y, forms, duplication. |
| [findings-tooling.md](./findings-tooling.md) | Lockfile drift, dead/phantom deps, ESLint 9 config, tests, CI gate, env inventory, config risks. |

---

## What is already good (so we don't regress it)

The review is heavy on problems by design, but several things are done well and should be preserved:

- **Admin API authorization is correct.** All 41 `src/app/api/admin/**` routes call `requireSuperAdmin`, which JWT-validates via `auth.getUser()` and checks real role assignments; middleware adds a defense-in-depth 401. *(The RLS gap bypasses this at the DB layer — the guard itself is sound.)*
- **Webhook signature verification is correct** for both Stripe (multi-region `constructEvent`, raw body preserved, platform-marker gating) and PayPal (`verify-webhook-signature`), both with `provider_event_id` replay protection.
- **Budget math is atomic** — `budget_raised` is recomputed by SUM in a single trigger statement (no read-modify-write race), with correct handling of blind (`NULL beneficiary_id`) and open (`budget_goal = -1`) sponsorships; one active subscription per beneficiary is enforced by a partial unique index.
- **Generated DB types are current** (`db.types.ts`, PostgREST 13.0.4) — they are just under-used.
- **The `docs/` folder is unusually thorough** — 17 focused docs (webhook contracts, telegram, realtime, storage, post-mortems). This audit adds to that strength rather than compensating for its absence.
- **`ProgressiveImage`** is a solid `next/image` wrapper, and image compression is centralized.

# Creator Share — Modernization Upgrade Plan

This is the sequenced remediation roadmap derived from the findings documents in this folder. It is organized into phases, ordered so that the highest risk-per-effort work lands first and later phases build on earlier ones. Each item links to its finding and states an acceptance criterion.

> **⚠️ Corrected 2026-07-05 after production verification.** The original Phase 0 was dominated by an "enable RLS everywhere" emergency. **That was a false positive** — verification against the live database ([findings-production-verification.md](./findings-production-verification.md)) proved **RLS is already correctly enforced on every sensitive table in production**. Phase 0 has been re-scoped to what is actually exploitable/urgent: rotating the leaked token, closing the **migration↔prod drift** (so the good security posture is reproducible and version-controlled), tightening a handful of over-permissive policies, and the RLS-independent app-layer fixes.

**How to read the effort/impact tags:** effort is a rough T-shirt size (S ≈ hours, M ≈ 1–3 days, L ≈ a week+). "Impact" is the blast radius if left unaddressed.

Guiding principle: **the database security boundary is already enforced correctly in production — but it lives only in the dashboard, not in the committed migrations.** The urgent work is to (a) rotate a live leaked secret, (b) make the security posture reproducible in code before a rebuild/restore silently reintroduces the theoretical holes, and (c) fix the app-layer paths (service-role writes, PII-returning endpoints) that RLS does not cover.

---

## Phase 0 — Stop the bleeding (do this week)

Re-scoped after production verification. These are the genuinely urgent items: a live leaked secret, the drift that makes the (good) security posture non-reproducible, and RLS-independent app-layer holes.

| # | Action | Finding | Effort | Impact |
|---|---|---|---|---|
| 0.1 | **Rotate the leaked Telegram bot token** via BotFather (only real fix — it's in git history). Then delete the hardcoded fallback in `src/config/telegram.ts:3`, remove it from `test-telegram/page.tsx`, delete/guard the `/test-telegram` page. Docs already scrubbed. `git filter-repo` is a secondary step. | [SEC C5](./findings-security.md#c5) | S | **CRITICAL** — full bot takeover |
| 0.2 | **Close the `complete-invitation` escalation** (now the top escalation vector): stop deriving roles from user-writable `user_metadata.role_ids` — it's written via the service-role client, which **bypasses RLS**. Source invited roles from a server-only `invitations` table (written by the admin invite route) or `app_metadata`. | [SEC C5→C3 note](./findings-production-verification.md) | M | **HIGH** — privilege escalation (RLS does not cover service-role writes) |
| 0.3 | **Delete or guard all `src/app/api/test/**` routes** and `/test-embed-iframe`; add `/api/test` to a middleware deny-list. (`payment-failed-email` = open email relay; `test/telegram` spams the ops channel.) | [SEC H1](./findings-security.md#h1) | S | Open email relay, ops-channel spam |
| 0.4 | **Close the migration↔prod drift**: `supabase db pull` (or dump `pg_policies`/grants) to capture the live RLS, policies, and grants into a committed migration, so a rebuild/restore reproduces the hardened posture instead of the insecure migration state. Add a CI check that fails if any `public` table is RLS-off. | [DATA D1](./findings-data-layer-rls.md), [VERIFY M-DRIFT-1](./findings-production-verification.md) | M | **HIGH** — DR/staging/local rebuilds are insecure |
| 0.5 | **Tighten the over-permissive live policies**: drop the `{public}` INSERT `WITH CHECK(true)` on `transaction_ledger`/`partnerships` (route those writes via service role); bind the authenticated `WITH CHECK(true)` INSERT/UPDATE on `media`/`subscriptions` to ownership; drop the leftover `USING(true)` SELECT on `roles`/`role_assignments`; de-duplicate redundant policies. | [VERIFY M-DRIFT-2, L-ENUM, M1](./findings-production-verification.md) | M | Ledger/media injection; admin enumeration |
| 0.6 | **Pin `search_path` on SECURITY DEFINER functions** — `is_super_admin()` (underpins every admin policy) and `handle_user_registration`: `SET search_path = public, pg_temp`. | [DATA M5](./findings-data-layer-rls.md#m5) | S | Hardening of the core authz function |
| 0.7 | **Fix the PII-leaking endpoints**: `/api/stripe/session` + `/api/stripe/success` require auth + return only non-PII status. Add an explicit `getUser()` + ownership check to `/api/stripe/cancel-subscription` (RLS blocks the cross-user path today, but don't rely on it implicitly). | [SEC H3](./findings-security.md#h3) | S | PII leak; DiD on cancel |

**Acceptance:** the Telegram token is rotated and absent from `HEAD` and every bundle; a self-set `user_metadata.role_ids` cannot promote a user via `complete-invitation`; `/api/test/**` is unreachable in prod; a fresh `supabase db reset` from committed migrations produces a database with RLS **on** and the same policies as prod (verified by re-running the `pg_policies` diff); `stripe/session` returns no PII to an unauthenticated caller. Add a regression test for each.

> **Note on realtime:** `src/lib/subscriptionsRealtime.ts` opens a browser realtime channel on `public.subscriptions`. Because RLS is enabled in prod, the channel already only delivers rows the caller is authorized to see — no change required, but confirm it still functions for authenticated sponsors after 0.5's policy edits.

---

## Phase 1 — Payment integrity (this sprint)

Money can currently be duplicated, silently captured, or lost. These are correctness bugs, not hardening.

| # | Action | Finding | Effort | Impact |
|---|---|---|---|---|
| 1.1 | **Fix PayPal one-time double-credit**: have the webhook dedup on `reference = orderId AND tx_action` (mirror the client path); add a partial unique index on `(reference, tx_action)`. | [PAY P2](./findings-payments.md) | M | Double-charged ledger, doubled `budget_raised` |
| 1.2 | **Fix silent money-capture on reconciliation failure**: on a *successful* charge, accept the charged amount or refund + alert — never return 200 with no record. | [PAY P3](./findings-payments.md) | M | Sponsor charged, gets nothing |
| 1.3 | **Fix blind-sponsorship auto-match**: call the match logic in-process instead of an unauthenticated HTTP round-trip to an admin route. **Also reconcile the 18 already-orphaned complete subscriptions** found in prod (17 Stripe, oldest 2025-07-29) — match or refund them. | [PAY P1](./findings-payments.md), [VERIFY §3](./findings-production-verification.md) | M | **18 real sponsors** unmatched for months |
| 1.4 | **Return 5xx for transient webhook errors** so Stripe retries (handler is idempotent); add a reconciliation sweep job. | [PAY P4/P9](./findings-payments.md) | M | Events lost on DB blips |
| 1.5 | **Re-derive `amount`/`userId`/`beneficiaryId` server-side** at checkout; require auth on checkout creation; stop persisting a new Product/Price per call. | [PAY P5/P6](./findings-payments.md), [SEC H... ] | M | Underpayment, mis-attribution, Stripe bloat |
| 1.6 | **Key partnership lifecycle on subscription/customer id**, not email; apply the `beneficiary_id` UUID guard consistently in PayPal. | [PAY P7/P8](./findings-payments.md) | S | Over-broad cancellation, mis-attribution |

**Acceptance:** replaying any Stripe/PayPal webhook event produces no duplicate ledger rows or subscriptions; a forced reconciliation mismatch results in a refund or a recorded charge (never a silent drop); a blind-sponsorship checkout auto-matches without an admin. Add integration tests (with the Stripe CLI / PayPal sandbox) for each.

---

## Phase 2 — Backend foundation (unblocks everything after it)

These are enabling refactors: they don't just remove duplication, they make the Phase 1/3 fixes cheap and safe to apply consistently.

| # | Action | Finding | Effort | Impact |
|---|---|---|---|---|
| 2.1 | **Type the Supabase client** — `createServerClient<Database>()` / `createServiceRoleClient<Database>()`. Delete the `MediaRow` and `RoleAssignmentResponse` cast families (~19–31 `as unknown as`). | [API §4](./findings-api-backend.md#type-safety) | S | Unsound types across the app |
| 2.2 | **Add `zod`** and a **shared `adminRoute(schema, fn)` / `route(schema, fn)` wrapper** (auth + parse + validate + error-normalize). Migrate routes onto it, starting with `admin/beneficiaries/*`. Use `.strict()` schemas to kill mass-assignment. | [API §1/§2](./findings-api-backend.md) | L | 69-file duplication, silent coercion, mass assignment |
| 2.3 | **Stop leaking `error.message`** to clients (13 routes); add `src/lib/logger.ts` and replace the ~406 `console.*` calls; gate logs by environment. | [API §3](./findings-api-backend.md) | M | Internal detail disclosure, unstructured logs |
| 2.4 | **Route the 9 inline admin checks through `requireSuperAdmin`**; extract a domain **service layer** (`src/services/*`) for beneficiaries/users/expenses; wrap multi-write operations (e.g. `assign-roles`) in real transactions/RPCs. | [API §1/§5](./findings-api-backend.md) | M | Auth drift, partial-failure hazards |
| 2.5 | **Add rate limiting** (Upstash Ratelimit / Vercel KV) to auth, OTP, invite, payment, AI, and proxy routes. Fix the geocoding-proxy param encoding and the `beneficiaries/get` PostgREST filter injection. | [SEC M1–M3, H4](./findings-security.md#m1) | M | Brute-force, cost abuse, filter injection |
| 2.6 | **Add security headers** via `next.config.ts` `headers()` (CSP `frame-ancestors`, HSTS, `nosniff`, `Referrer-Policy`). | [SEC L4](./findings-security.md) | S | Clickjacking |

**Acceptance:** a new admin route is ~5 lines (wrapper + schema + body); no route returns a raw DB error; brute-forcing login is throttled; `curl`-ing a CSP-protected page shows the headers. Typecheck passes with the typed client and no `as unknown as` in the deleted families.

---

## Phase 3 — Frontend modernization

| # | Action | Finding | Effort | Impact |
|---|---|---|---|---|
| 3.1 | **Adopt TanStack Query** (it's already mounted): `useInfiniteQuery` for the listing, `useQuery`/`useMutation`+`invalidateQueries` for admin CRUD. **Remove server data from Zustand** (keep UI state only). Retire the hand-rolled retry/dedup/abort logic. | [FE §3/§4](./findings-frontend.md) | L | Staleness, races, reinvented caching |
| 3.2 | **Fix the listing N+1**: return image URLs with each beneficiary in the list payload; wrap `SponsorshipCard` in `React.memo` with stable handlers. | [FE §2](./findings-frontend.md) | M | 9 requests/scroll-page, re-render storms |
| 3.3 | **Server-render beneficiary profiles** (`sponsorships/[username]`) with `generateMetadata` (title/description/`og:image`). | [FE §1](./findings-frontend.md) | M | No SEO/social previews on shareable links |
| 3.4 | **Replace the rewrite-to-`/` routing** with real route segments or a dynamic `[type]` segment; pass type as a server prop (removes the hydration flash). | [FE §1](./findings-frontend.md) | M | Flash, unindexable routes |
| 3.5 | **Delete dead code** (`SponsorshipMap`, unused `Skeleton`) and the dead map deps; wire the card skeleton into loading states. | [FE §2/§5](./findings-frontend.md) | S | Bundle bloat |
| 3.6 | **Adopt `react-hook-form` + zod** in the big admin modals; split the 1,400–1,700-line modal files into subcomponents; fix focus-trap/label a11y. | [FE §5/§6/§7](./findings-frontend.md) | L | Form correctness, a11y, maintainability |
| 3.7 | **Split `email.ts` (1259 lines)** and decompose the Stripe webhook handler (1382 lines) per event type. | [API §6](./findings-api-backend.md) | M | God-modules |

**Acceptance:** scrolling the listing fires one request per page (not per card); a beneficiary link preview shows the child's name/photo; the admin CRUD screens update optimistically and invalidate correctly; no component file exceeds ~500 lines.

---

## Phase 4 — Tooling, tests, and CI (make regressions impossible)

| # | Action | Finding | Effort | Impact |
|---|---|---|---|---|
| 4.1 | **Add a PR CI gate**: `yarn install --frozen-lockfile` → `lint` → `typecheck` → `test` → `build`. | [TOOL §5](./findings-tooling.md) | S | Nothing guards the branch today |
| 4.2 | **Add a `typecheck` script** (`tsc --noEmit`); migrate ESLint to flat config; add husky + lint-staged; promote `no-explicit-any` to `error`. | [TOOL §2/§3](./findings-tooling.md) | M | Type/lint errors reach prod |
| 4.3 | **Resolve the dual lockfile** (delete `package-lock.json`, gitignore it); **prune dead/phantom deps** (`@svgr/webpack` add-or-remove, `react-map-gl`, `react-leaflet-cluster`, `lodash`, `lodash.debounce`, `supabase-cli`, `ngrok`→dev, `dotenv` review). | [TOOL §1](./findings-tooling.md) | M | Install drift, broken build |
| 4.4 | **Migrate off deprecated deps**: `@supabase/auth-helpers-nextjs` → `@supabase/ssr` (one route); `openai-edge` → `openai`. | [TOOL §1](./findings-tooling.md) | M | Unmaintained/deprecated |
| 4.5 | **Add unit + API-route tests** (Vitest), prioritizing payments, RLS policies, and auth; wire `msw` in or remove it. | [TOOL §4](./findings-tooling.md) | L | ~0% coverage on highest-risk code |
| 4.6 | **Reconcile env docs** (add the 5 missing vars to `dotenv.sample`, fix README Stripe var names, add `LICENSE`); **narrow image `remotePatterns`**; fix the Turbopack/webpack SVG divergence. | [TOOL §6/§7](./findings-tooling.md) | S | Onboarding friction, SSRF surface |
| 4.7 | **Replace the git-author-rewrite deploy hack** with Vercel Git integration or a proper deploy Action. | [TOOL §5](./findings-tooling.md) | M | Fragile, force-push risk |

**Acceptance:** a PR that breaks types, lint, or tests cannot merge; `yarn install --frozen-lockfile` is the only supported install; `next build` succeeds from a clean checkout; payments and RLS have test coverage.

---

## Phase 5 — Extensibility (once the foundation is solid)

Lower urgency; do opportunistically after Phases 0–4.

- **Database-backed FX rates** replacing the hardcoded `currency.ts` table ([API §6](./findings-api-backend.md)); carry currency decimal-exponent metadata before adding JPY ([PAY P11](./findings-payments.md)).
- **Consolidate region routing** to one decision function with a test matrix ([PAY P13](./findings-payments.md)).
- **RESTful route consolidation** (`GET/POST /admin/activities`, `PATCH/DELETE /[id]`) replacing the RPC-style `retrieve`/`get`/`create` paths ([API §5](./findings-api-backend.md)).
- **Cursor pagination** on all list endpoints ([API §7](./findings-api-backend.md)).
- **Replace the `budget_goal = -1` sentinel** with an explicit `is_open` column; standardize timestamps on `timestamptz`; add the `(beneficiary_type, status)` index; drop/fix the dead DB functions; pin `search_path` on SECURITY DEFINER functions ([DATA L1–L3, M3–M5](./findings-data-layer-rls.md)).
- **Web-worker image compression**; `IntersectionObserver` infinite scroll; consolidate the 4 card components ([FE §2/§7/§8](./findings-frontend.md)).

---

## Sequencing at a glance

```
Phase 0  ██  Token rotation + drift + policy tightening  (this week)
Phase 1  ███ Payment integrity           (this sprint — includes reconciling 18 orphaned sponsorships)
Phase 2  ███ Backend foundation          (enables consistent Phase 1/3 fixes)
Phase 3  ████ Frontend modernization     (depends on 2.1 typed client, 2.2 wrapper)
Phase 4  ███ Tooling / tests / CI        (can start in parallel with Phase 2)
Phase 5  ██  Extensibility               (opportunistic)
```

Phases 0 and 1 are non-negotiable and time-sensitive. Phase 4's CI gate (4.1) is worth pulling forward to run *alongside* Phase 2 so that the refactors land behind a green check. Phases 2 and 3 are the bulk of the "modernization" effort and should be done as a series of small, reviewable PRs rather than one big-bang rewrite.

# Creator Share — Modernization Upgrade Plan

This is the sequenced remediation roadmap derived from the six findings documents in this folder. It is organized into five phases, ordered so that the highest risk-per-effort work lands first and later phases build on earlier ones. Each item links to its finding and states an acceptance criterion.

**How to read the effort/impact tags:** effort is a rough T-shirt size (S ≈ hours, M ≈ 1–3 days, L ≈ a week+). "Impact" is the blast radius if left unaddressed.

A guiding principle throughout: **the database is the security boundary, not the API layer.** The app-layer auth is already correct; most of the critical risk is that a browser can bypass it entirely via the anon key. Phase 0 closes that.

---

## Phase 0 — Stop the bleeding (do this week)

These are exploitable now with no privileges, or leak a live secret. Nothing else should be prioritized above them.

| # | Action | Finding | Effort | Impact |
|---|---|---|---|---|
| 0.1 | **Rotate the leaked Telegram bot token** via BotFather; remove it from `test-telegram/page.tsx` and `docs/telegram-bot-setup.md`; delete the `/test-telegram` page. Scrub git history (`git filter-repo`) as a secondary step. | [SEC C5](./findings-security.md#c5) | S | Full bot takeover |
| 0.2 | **Delete or guard all `src/app/api/test/**` routes** and `/test-embed-iframe`; add `/api/test` to a middleware deny-list. | [SEC H1](./findings-security.md#h1) | S | Open email relay, unauth writes |
| 0.3 | **Ship an RLS remediation migration**: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated` on `role_assignments`, `users`, `subscriptions`, `transaction_ledger`, `partnerships`, `activities`, `media`, `expenses`, `expense_assignments`, `email_logs`, `beneficiary_reservations`, `activity_subscriptions`. Rewrite the dormant `USING(true)`/`WITH CHECK(true)` policies to real owner/admin predicates **before** enabling. | [SEC C1–C4/C6](./findings-security.md#c1), [DATA D1](./findings-data-layer-rls.md) | M | Admin takeover, PII/PCI exposure, donation forgery |
| 0.4 | **Revoke the base-schema default privileges** (`ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM anon, authenticated`) so new tables are locked by default. | [DATA D2](./findings-data-layer-rls.md) | S | Future tables silently exposed |
| 0.5 | **Close the `complete-invitation` escalation**: stop reading roles from user-writable `user_metadata`; source invited roles from a server-only `invitations` table (written by the admin invite route) or `app_metadata`. | [SEC C3 / API §5] | M | Privilege escalation independent of 0.3 |
| 0.6 | **Auth + ownership-check `/api/stripe/cancel-subscription`** and `/api/stripe/session` + `/api/stripe/success` (require `getUser()`, verify ownership, stop returning PII). | [SEC C2/H3](./findings-security.md#c2) | S | Cancel anyone's sponsorship; PII leak |

**Acceptance:** a logged-in non-admin user cannot (a) read `subscriptions`/`users`/`transaction_ledger` via the anon PostgREST endpoint, (b) insert a `role_assignments` row, (c) insert a `transaction_ledger` row, (d) cancel another user's subscription. The Telegram token no longer appears in any bundle or in git `HEAD`. Add a regression test for each.

> **Note on realtime:** `src/lib/subscriptionsRealtime.ts` opens a browser realtime channel on `public.subscriptions`, which only works today because that table is unprotected. After 0.3, re-implement it behind a scoped RLS policy or a server proxy. Verify before deploying 0.3.

---

## Phase 1 — Payment integrity (this sprint)

Money can currently be duplicated, silently captured, or lost. These are correctness bugs, not hardening.

| # | Action | Finding | Effort | Impact |
|---|---|---|---|---|
| 1.1 | **Fix PayPal one-time double-credit**: have the webhook dedup on `reference = orderId AND tx_action` (mirror the client path); add a partial unique index on `(reference, tx_action)`. | [PAY P2](./findings-payments.md) | M | Double-charged ledger, doubled `budget_raised` |
| 1.2 | **Fix silent money-capture on reconciliation failure**: on a *successful* charge, accept the charged amount or refund + alert — never return 200 with no record. | [PAY P3](./findings-payments.md) | M | Sponsor charged, gets nothing |
| 1.3 | **Fix blind-sponsorship auto-match**: call the match logic in-process instead of an unauthenticated HTTP round-trip to an admin route. | [PAY P1](./findings-payments.md) | M | Blind sponsorships orphaned by default |
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
Phase 0  ██  Security emergencies        (this week — blocks nothing, unblocks trust)
Phase 1  ███ Payment integrity           (this sprint — depends on 0.3 RLS for the ledger)
Phase 2  ███ Backend foundation          (enables consistent Phase 1/3 fixes)
Phase 3  ████ Frontend modernization     (depends on 2.1 typed client, 2.2 wrapper)
Phase 4  ███ Tooling / tests / CI        (can start in parallel with Phase 2)
Phase 5  ██  Extensibility               (opportunistic)
```

Phases 0 and 1 are non-negotiable and time-sensitive. Phase 4's CI gate (4.1) is worth pulling forward to run *alongside* Phase 2 so that the refactors land behind a green check. Phases 2 and 3 are the bulk of the "modernization" effort and should be done as a series of small, reviewable PRs rather than one big-bang rewrite.

# Security & Auth Findings

Two independent security passes reached the same conclusion: **the API-route authorization layer is sound, but the database authorization layer (Postgres RLS + grants) is not.** Because the public `anon` key ships in every page bundle (`src/utils/supabase/client.ts`), a browser can talk to Supabase's PostgREST endpoint directly and bypass the Next.js app entirely. Every "enable RLS" fix below is far more important than any code change.

Severity legend: **CRITICAL** = exploitable now, no privileges needed · **HIGH** = exploitable with low effort or leaks sensitive data · **MEDIUM** = abuse/DoS/hardening · **LOW** = defense-in-depth / informational.

---

## CRITICAL

<a id="c1"></a>
### C1 — Anonymous privilege escalation to SUPER_ADMIN via `role_assignments`
`role_assignments` has RLS **disabled** in its final migration state yet is granted to `anon`, and the SUPER_ADMIN role UUID is public.

- RLS enabled at base, then **disabled**: [`supabase/migrations/20251006120000_missing_migrations.sql:62`](../../supabase/migrations/20251006120000_missing_migrations.sql)
- Grant: `GRANT ALL ON TABLE public.role_assignments TO anon` — [`20250124232440_remote_schema.sql:185`](../../supabase/migrations/20250124232440_remote_schema.sql)
- Seeded SUPER_ADMIN role id `7363a1c9-5336-4a6d-a1df-16136313d385`: [`supabase/seed.sql:14`](../../supabase/seed.sql)
- Anon key is client-side: [`src/utils/supabase/client.ts`](../../src/utils/supabase/client.ts)

**Exploit:** From the browser console, `supabase.from('role_assignments').insert({ user_id: <self>, role_id: '7363a1c9-…' })`. The attacker is now SUPER_ADMIN; every `requireSuperAdmin`-gated `/api/admin/**` route authorizes them. Full admin takeover.

**Fix:** `ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY;` + `REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated;` + policy allowing mutation only by an existing SUPER_ADMIN or the service role.

<a id="c2"></a>
### C2 — `subscriptions` fully anon read/write (RLS never enabled) → data exposure + cancel-subscription IDOR
`subscriptions` was never given `ENABLE ROW LEVEL SECURITY` and is granted select/insert/update/delete to `anon` ([`20250218084246_subscription_and_images.sql:179-205`](../../supabase/migrations/20250218084246_subscription_and_images.sql)). The three SUPER_ADMIN policies in that file are on `sponsor_people`, not `subscriptions`.

**Exploit:** Any anon user reads all subscriptions (sponsor emails, amounts, `customer_id`, `stripe_subscription_id`), or updates/deletes them, via PostgREST. This also turns [`POST /api/stripe/cancel-subscription`](../../src/app/api/stripe/cancel-subscription/route.ts) into a true unauthenticated IDOR — it never calls `getUser()`, takes `subscriptionId` from the body, and cancels the real Stripe/PayPal subscription. Enumerate every id (via the anon read) and cancel every active sponsorship.

**Fix:** Enable RLS, revoke anon write, add owner/admin policies. Add `getUser()` + `subscription.user_id === user.id` (or admin) check to `cancel-subscription`.

<a id="c3"></a>
### C3 — `transaction_ledger` anon INSERT → forge donations and mark beneficiaries "fully funded"
RLS never enabled; anon INSERT granted ([`20250212205722_add_transaction_ledger.sql:41`](../../supabase/migrations/20250212205722_add_transaction_ledger.sql)); a permissive `insert_user … with check (true)` policy exists ([`20250301000509_add_activities.sql:111`](../../supabase/migrations/20250301000509_add_activities.sql)); an `AFTER INSERT` trigger recomputes `budget_raised` ([`20250212211454_calculate_budgets.sql:26`](../../supabase/migrations/20250212211454_calculate_budgets.sql)).

**Exploit:** Anon `POST …/rest/v1/transaction_ledger` with a fabricated `credit` + `beneficiary_id` inflates that beneficiary's `budget_raised`, forging donations and flipping children to "fully funded" — with no payment. Corrupts the financial ledger and public funding metrics.

**Fix:** Enable RLS, drop the `with check (true)` insert policy, revoke anon INSERT. Only the service-role client (webhooks) should write the ledger.

<a id="c4"></a>
### C4 — `users` table anon read/write (RLS never enabled) → PII exposure + account tampering
`GRANT insert/update/delete ON public.users TO anon` ([`20250212025932_rename_people_table.sql:228-240`](../../supabase/migrations/20250212025932_rename_people_table.sql)); no `ENABLE ROW LEVEL SECURITY` anywhere.

**Exploit:** Anon selects all users (emails, names, `auth.users.id`), updates arbitrary rows (e.g. change an email that owner-scoped logic keys on), or deletes records. Combines with C1 to fabricate the `public.users` row a forged role assignment references.

**Fix:** Enable RLS, revoke anon write, add self-only + admin policies.

<a id="c5"></a>
### C5 — Live Telegram bot token committed and shipped to the browser  ⚠️ ACT NOW
`8268585751:AAHf1JGEJ1QvdveRYqRTDvQzHqKBt9dnl80` is hardcoded in [`src/app/test-telegram/page.tsx:189`](../../src/app/test-telegram/page.tsx) and `:194` — a `"use client"` page, so the token is in the public JS bundle and served at `/test-telegram`. Also in [`docs/telegram-bot-setup.md:44`](../telegram-bot-setup.md).

**Exploit:** Anyone reading the bundle gets full bot control (read `getUpdates`, send/spoof messages, hijack the notification channel).

**Fix:** **Rotate the token via BotFather now** — it is in git history and already public; removal-from-file does not remediate it. Then remove it from source, delete/guard the page, and never embed a bot token client-side. Consider `git filter-repo` to scrub history (secondary to rotation).

<a id="c6"></a>
### C6 — `partnerships` and `activity_subscriptions` anon-writable with RLS off
`partnerships`: anon INSERT + `"Allow public insert" … with check (true)`, RLS never enabled ([`20250729082058_sponsorship_migrations.sql:264`](../../supabase/migrations/20250729082058_sponsorship_migrations.sql)). `activity_subscriptions`: anon insert/update/delete, RLS never enabled (same file). `partnerships` holds `card_number`/`card_type`/`customer_id`.

**Exploit:** Anon reads partnership card metadata and injects/modifies partnership + newsletter-subscription rows (spam, data poisoning, mass-deletion).

**Fix:** Enable RLS on both; owner/service-role writes only; keep at most a narrow, column-constrained public INSERT for the newsletter if intended.

---

## HIGH

<a id="h1"></a>
### H1 — Unauthenticated test/debug endpoints reachable in production
Middleware only guards `/app`, `/admin`, `/api/admin` — nothing blocks `/api/test/**`.
- [`GET /api/test/payment-failed-email`](../../src/app/api/test/payment-failed-email/route.ts) — sends a "payment failed" email to any `?email=`. **Open email relay / phishing lure**, no auth, no rate limit.
- [`POST /api/test/telegram`](../../src/app/api/test/telegram/route.ts) — anyone triggers Telegram messages to the ops channel.
- [`POST /api/test/create-child`](../../src/app/api/test/create-child/route.ts) — unauthenticated beneficiary/media insert + Telegram notify. (The beneficiary insert is currently blocked because `beneficiaries` RLS is on with no anon policy, but the Telegram side-effect still fires.)

**Fix:** Delete these routes, or guard behind `requireSuperAdmin` **and** `NODE_ENV !== "production"`, and add `/api/test` to a middleware deny-list.

<a id="h2"></a>
### H2 — `media` table anon-writable (RLS disabled in the catch-up migration)
RLS enabled at [`20250923123000_media_updates.sql:96`](../../supabase/migrations/20250923123000_media_updates.sql), then **disabled** at [`20251006120000_missing_migrations.sql:45`](../../supabase/migrations/20251006120000_missing_migrations.sql); anon insert/update/delete granted.

**Exploit:** Anon inserts `media` rows with attacker-controlled `image_url`/`parent_id`. Those URLs are rendered into confirmation emails and beneficiary pages (`src/utils/email.ts` → `getBeneficiaryImageUrl`), enabling brand-borrowing content injection / tracking pixels / phishing imagery.

**Fix:** Re-enable RLS on `media`, revoke anon write, add authenticated/admin policies.

<a id="h3"></a>
### H3 — `GET /api/stripe/session` leaks payment + PII with no auth
[`src/app/api/stripe/session/route.ts:5`](../../src/app/api/stripe/session/route.ts) takes `?id=` and returns the full expanded Checkout Session (`customer_details`, `payment_intent`), falling back to `transaction_ledger`/`subscriptions`, with no ownership check.

**Exploit:** Anyone with a `cs_…` id (they leak via success-redirect URLs, referrer headers, logs) retrieves sponsor email, name, child name/location, and payment status. The parallel `GET /api/stripe/success` has the same shape.

**Fix:** Require auth and verify the row belongs to the caller, or return only a minimal non-PII status.

<a id="h4"></a>
### H4 — PostgREST filter injection in `beneficiaries/get`
[`src/app/api/beneficiaries/get/route.ts:101`](../../src/app/api/beneficiaries/get/route.ts) interpolates the raw `search` param into `query.or(\`name.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%\`)`; `status` and date bounds are likewise string-interpolated.

**Exploit:** A `search` value containing PostgREST syntax (e.g. `,status.eq.Draft` or nested `and(...)`) escapes the intended `ilike` and injects OR conditions, retrieving non-public `Draft`/`Archived` beneficiaries or otherwise manipulating the query.

**Fix:** Reject/escape PostgREST operator characters (`,`, `(`, `)`), or avoid string-built `.or()` — use `.ilike()` on a single column or properly-quoted values. Enforce the public status filter server-side.

---

## MEDIUM

<a id="m1"></a>
### M1 — No rate limiting anywhere (auth, payment, email, AI)
No rate-limiting middleware/library exists. Login, password-reset, `verify-otp`, newsletter/email, and the AI proofread route are all unthrottled → credential brute-force, OTP brute-force, email-bomb, and LLM cost-abuse. **Fix:** Add IP/user rate limiting (e.g. Upstash Ratelimit / Vercel KV) on these routes.

<a id="m2"></a>
### M2 — Unauthenticated AI proofread endpoint (LLM cost abuse + prompt injection)
[`src/app/api/ai/proofread/route.ts:5`](../../src/app/api/ai/proofread/route.ts) — no auth; anyone calls the server-side LLM (≤10k chars, attacker-controlled `instructions`) unlimited times. (`/api/ai/config` correctly returns only a boolean — good.) **Fix:** Require admin auth + rate limit.

<a id="m3"></a>
### M3 — Query-parameter injection in geocoding proxies
[`src/app/api/proxy/nominatim/route.ts:13`](../../src/app/api/proxy/nominatim/route.ts) interpolates un-encoded `lat`/`lon` into the upstream URL; [`proxy/photon/route.ts:12`](../../src/app/api/proxy/photon/route.ts) interpolates `limit` raw. Host is fixed (no full SSRF), but attackers can append/override upstream params and, unthrottled, use the server to hammer Nominatim/Photon (quota bans). **Fix:** `encodeURIComponent` all values; validate `lat`/`lon` as numbers and `limit` as a bounded int; rate-limit.

<a id="m4"></a>
### M4 — `change-password` does no current-password re-auth
[`src/app/api/auth/change-password/route.ts:17`](../../src/app/api/auth/change-password/route.ts) calls `updateUser({ password })` for the session user without re-verifying the current password. It only affects the caller's own account (not cross-account), but a hijacked session can immediately reset the password. **Fix:** Require current-password re-auth for logged-in changes (keep the recovery-token path for forgot-password); add rate limiting.

---

## LOW / Informational

- **L1 — Weak `postMessage` origin handling in embed.** [`src/app/embed/page.tsx:67`](../../src/app/embed/page.tsx) validates the parent with `event.origin.includes("share-tanzania.webflow.io")` (substring — `…webflow.io.evil.com` passes) and defaults the `postMessage` target to `"*"` from an attacker-controllable `parentOrigin` param. Low impact (only height posted). **Fix:** exact-origin allowlist.
- **L2 — User enumeration in registration.** [`registration/route.ts:17`](../../src/app/api/auth/registration/route.ts) returns "An account with this email already exists"; login returns the raw Supabase error. **Fix:** generic responses.
- **L3 — Hardcoded `localhost` redirect.** [`registration/route.ts:39`](../../src/app/api/auth/registration/route.ts) sets `emailRedirectTo: "http://localhost:3000/…"` — breaks confirmation in prod. **Fix:** use `NEXT_PUBLIC_BASE_URL`/`NEXT_PUBLIC_SITE_URL`.
- **L4 — No security headers.** No `headers()` in `next.config.ts` / `vercel.json` → no CSP/`frame-ancestors`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`. Authenticated `/app`+`/admin` are framable (clickjacking). **Fix:** add a `headers()` block with `frame-ancestors 'self' <embed-origin>`, HSTS, `nosniff`, `Referrer-Policy`.
- **L5 — Test pages ship to prod.** `/test-telegram`, `/test-embed-iframe` are deployable. Remove or guard.
- **L6 — Nothing else leaks.** No open redirects, no CORS wildcards, no arbitrary-URL SSRF; `NEXT_PUBLIC_*` vars are all legitimately public; the service-role key is server-only (`NEXT_SERVICE_ROLE_KEY`, referenced only in `src/utils/supabase/server.ts`).

---

## Confirmed-good (do not regress)

- **All 41 `/api/admin/**` routes call `requireSuperAdmin`** ([`src/utils/auth/requireSuperAdmin.ts`](../../src/utils/auth/requireSuperAdmin.ts)), which JWT-validates via `auth.getUser()`; middleware adds a defense-in-depth 401. The weakness is that its `role_assignments` lookup is attacker-writable at the DB layer (C1) — the code is correct.
- **Webhook signature verification is correct** for Stripe ([`webhooks/stripe/handler.ts:114`](../../src/app/api/webhooks/stripe/handler.ts)) and PayPal ([`paypal/webhook/route.ts:66`](../../src/app/api/paypal/webhook/route.ts)), both with `provider_event_id` idempotency.
- **`/api/sponsorships/self-assign`** correctly scopes to `user_id = user.id` (though C2 undermines it at the DB layer).

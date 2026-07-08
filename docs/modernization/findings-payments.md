# Payments Findings (Stripe / PayPal / Webhooks)

Traced the Stripe and PayPal flows end-to-end: checkout-session creation, webhook processing, subscription lifecycle, currency/region routing, and the money math. The webhook **security** (signature verification, replay protection) is correct; the problems are in **idempotency across code paths**, **failure handling**, and **trusting client input for money**.

Severity legend: **CRITICAL** = money lost/duplicated or funding integrity broken · **HIGH** = reliability/abuse · **MEDIUM/LOW** = correctness edge cases.

---

## CRITICAL

### P1 — Blind-sponsorship auto-match always fails (403); blind sponsorships are orphaned by default
[`webhooks/stripe/handler.ts:818-849`](../../src/app/api/webhooks/stripe/handler.ts) calls `POST /api/admin/blind-sponsorships/match?...` via a bare `fetch` with **no auth cookies/headers**. The target ([`admin/blind-sponsorships/match/route.ts:24`](../../src/app/api/admin/blind-sponsorships/match/route.ts)) starts with `requireSuperAdmin`, which calls `auth.getUser()` — a webhook request carries no user session, so it returns 401/403 every time. The webhook logs "auto-match failed" and swallows it.

**Impact:** Every blind sponsorship stays `beneficiary_id = NULL` unless an admin matches it manually — the *default* outcome, not an edge case. This is the orphaned-blind-sponsorship problem noted in `docs/duplicate-sponsorship-issue.md`.

**Fix:** Call the matching logic **in-process** (import the function) instead of an HTTP round-trip, or protect the endpoint with a shared secret/service token the webhook presents, rather than a user-session admin check.

### P2 — PayPal one-time payment can be double-credited (idempotency keys don't match across paths)
Two paths insert a `transaction_ledger` row for the same PayPal order with **different** idempotency keys:
- Client capture ([`paypal/route.ts:89`](../../src/app/api/paypal/route.ts)): `provider_event_id = capture.id` (or `orderID` when already `COMPLETED`), **and** checks `reference = orderId` as a fallback dedup.
- Webhook `PAYMENT.CAPTURE.COMPLETED` ([`paypal/webhook/route.ts:200`](../../src/app/api/paypal/webhook/route.ts)): `provider_event_id = event.id` and dedups **only** on that key — it does **not** check `reference`.

Since `event.id` ≠ `capture.id`, and the webhook lacks the reference-based fallback, **both inserts succeed**. The unique index on `provider_event_id` doesn't help across two different key values, and there is no unique constraint on `(reference, tx_action)`.

**Impact:** One PayPal payment → two `SPONSORSHIP` ledger rows → doubled `budget_raised`, two Telegram notifications.

**Fix:** Make the webhook also check `reference = orderId AND tx_action = 'SPONSORSHIP'` before inserting (mirror the client path), and add a partial unique index on `(reference, tx_action)` for PayPal rows.

### P3 — Stripe currency-reconciliation failure silently drops the payment but keeps the money
[`handler.ts:168-183`](../../src/app/api/webhooks/stripe/handler.ts): on `checkout.session.completed`, if `validateStripeCurrencyAmount` fails, the handler logs and returns HTTP 200 with **no subscription, no ledger entry, and no refund** — but Stripe has already charged the customer. Same pattern in the `invoice.paid` reconciliation ([`:1228-1267`](../../src/app/api/webhooks/stripe/handler.ts)).

**Impact:** Any FX drift between checkout creation and webhook delivery (rates are a static file, `config/rates.ts`), or any metadata mismatch, means the sponsor is charged but gets nothing recorded and no refund — silent money capture. (Contrast the beneficiary-rejection path at `:494-631`, which *does* refund.)

**Fix:** On reconciliation failure for a *successful* charge, accept the actually-charged amount (recompute base from the event) or trigger a refund + alert — never a silent 200-drop.

---

## HIGH

### P4 — Blanket `200-on-error` loses events on transient failures
[`handler.ts:1372-1376`](../../src/app/api/webhooks/stripe/handler.ts): the outer catch returns 200 for *every* unexpected error ("Always return 200 to Stripe to prevent retries"). Most DB-error branches also return 200 and only `console.error`. So a transient DB blip during `checkout.session.completed` → subscription insert throws → 200 → Stripe never retries → subscription never created, but the sponsor is billed monthly. No reconciliation job exists. **Fix:** Return 5xx for transient/infrastructure errors so Stripe retries (the handler is idempotent via `provider_event_id`, so retries are safe); reserve 200 for genuinely-unprocessable events. Add a reconciliation sweep.

### P5 — Client fully controls `amount`, `currency`, `userId`, `beneficiaryId` at checkout
[`stripe/route.ts:104-109`](../../src/app/api/stripe/route.ts): for non-blind sponsorships `enforcedAmount = amount` straight from the body, validated only as an integer ≥ minimum. For **fixed-budget** beneficiaries the server never loads the beneficiary to confirm the amount equals `budget_goal`; `beneficiaryId`, `userId`, `paymentType`, `project` are all taken from the body. **Impact:** a client can sponsor a fixed-goal child for the minimum, convert recurring→one-time, or attribute a sponsorship to another account; the webhook later trusts the same metadata. **Fix:** for fixed types, load the beneficiary and force `amount = budget_goal`; validate `beneficiaryId` exists and is accepting; derive `userId` from the session.

### P6 — Stripe checkout creation is unauthenticated and creates real Product/Price objects per call
[`stripe/route.ts:64+`](../../src/app/api/stripe/route.ts) has no auth and calls `stripe.products.create` + `stripe.prices.create` on every request (`:160-191`). **Impact:** an attacker loops the endpoint, creating unbounded Stripe products/prices (account bloat / object-count exhaustion) and enabling P5. **Fix:** require auth (or rate-limit + captcha) and reuse a small set of prices or inline `price_data` instead of persisting new objects per checkout.

### P7 — `invoice.payment_failed` cancels partnerships by email, unbounded
[`handler.ts:868-882`](../../src/app/api/webhooks/stripe/handler.ts): updates partnerships `WHERE email = customerEmail AND status = 'complete'`. `customer_email` can be null and multiple partnerships can share an email. **Impact:** one failed invoice cancels *all* of a person's complete partnerships; a null email silently updates zero rows. Same fragility in `customer.subscription.deleted` (`:1091-1106`). **Fix:** key partnership lifecycle on `stripe_subscription_id` / `customer_id`, not email.

### P8 — PayPal subscription insert skips the `beneficiary_id` validation used elsewhere
[`paypal/webhook/route.ts:509-530`](../../src/app/api/paypal/webhook/route.ts) (`BILLING.SUBSCRIPTION.CREATED`) inserts with `beneficiary_id = custom_id` **without** the 36-char UUID guard applied at `:207` and `:331`, and hardcodes `status: "incomplete"` while computing an unused `mappedStatus`. **Impact:** a malformed `custom_id` violates the FK or silently mis-attributes. **Fix:** apply the UUID/existence guard consistently; reconcile `mappedStatus` vs persisted `status`.

---

## MEDIUM

### P9 — Concurrent same-beneficiary subscriptions → losing insert becomes a silent 200
The partial unique index `uniq_active_subscription_per_beneficiary` correctly prevents two `complete` subscriptions per beneficiary at the DB layer (good). But in the webhook, the losing insert throws a generic unique-violation that isn't the expected `beneficiary_not_accepting_subscriptions` string, so it falls through to the outer catch → silent 200 ([`handler.ts:635`](../../src/app/api/webhooks/stripe/handler.ts)). **Impact:** the second sponsor is charged monthly in Stripe with no local row and no refund. **Fix:** detect the unique-violation specifically and run the cancel+refund path.

### P10 — Insert-on-GET in `paypal/verify` (non-idempotent)
[`paypal/verify/route.ts:153-174`](../../src/app/api/paypal/verify/route.ts) **inserts** a subscription inside a `GET` handler. Browsers/prefetchers retry GETs; two concurrent success-page loads can both pass the existence check then both insert. **Fix:** move subscription creation to the webhook or a POST; add a unique index on `subscriptions.stripe_subscription_id` (verify it exists).

### P11 — Zero-decimal currency assumption is latent
`utils/currency.ts` and the migrations assume all currencies have 2 decimals. Fine for the 4 supported today, but adding **JPY** (0-decimal) or a 3-decimal currency breaks `chargedAmountMinor` and every `/100` formatter, and Stripe will reject amounts. **Fix:** carry currency decimal-exponent metadata before expanding `SUPPORTED_CURRENCIES`.

### P12 — Yearly→monthly integer truncation
`update_beneficiary_by_subscriptions` computes `s.amount / 12` on an `integer` column — integer division truncates cents for yearly subscriptions. Low financial impact but incorrect. **Fix:** compute in a numeric context or store monthly-equivalent explicitly.

### P13 — Two divergent region-decision sources
`currencyRouting.ts` maps `USD→us, else→uk`; `region.ts`/`config.ts` map by beneficiary country. A EUR checkout for a US-country beneficiary is created on the **UK** account by one function while other lookups may pick a different account. **Fix:** consolidate to one region-decision function; add a test matrix of (currency × beneficiary country) → account.

---

## LOW

- **P14** — Beneficiary-rejection refund path ([`handler.ts:494-631`](../../src/app/api/webhooks/stripe/handler.ts)) has no idempotency guard; a retried rejected event re-attempts cancel+refund+email (Stripe refund is roughly idempotent by PI, but the email is not).
- **P15** — `payments/return` and `PaymentSuccessClient` assume success on *any* error ("assume payment was successful"). Cosmetic (webhook is source of truth) but can mislead users about a failed payment.
- **P16** — `handler.ts:304-355` builds a PostgREST `.or()` filter by string-interpolating `session.customer` and email — fragile if either contains a comma/paren (email is attacker-influenced).
- **P17** — `dollarsToCents`/`parsePayPalAmountMinor` coerce malformed amounts to `null`/`0` and rely on the reconciliation guard to reject them.
- **P18** — Cancellation-cascade logic is copy-pasted across `handler.ts:1144-1200`, `paypal/webhook:599-656`, and `cancel-subscription:171-246` with subtly different email-sourcing (see [findings-api-backend.md](./findings-api-backend.md) — consolidate into a service).

---

## Confirmed-good (do not regress)

- Stripe signature verification + raw-body preservation (middleware excludes `api/webhooks`); multi-region secret-trial loop is sound.
- Stripe checkout idempotency via `transaction_ledger.provider_event_id` (unique index) — a retried Stripe webhook won't double-credit or duplicate the subscription.
- `budget_raised` recompute-by-SUM (no lost-update race); one `complete` subscription per beneficiary enforced by partial unique index.

**Needs runtime verification:** unique index on `subscriptions.stripe_subscription_id` (P10); which region function governs each live flow (P13); whether the PayPal client-capture and webhook both fire in the live config (determines P2 blast radius).

# Advocate Payment Boundary Release Runbook

This runbook controls the additive deployment of the v2 sponsorship checkout boundary. It exists because database functions and warm application instances cannot be replaced atomically across Supabase and Vercel.

The release must preserve the current sponsorship checkout until every new application instance uses the v2 functions. Legacy functions remain service scoped during that overlap and contain explicit guards that prevent them from mutating v2 checkout operations.

## Required configuration

Configure and validate these server only values in every target environment:

- `SPONSORSHIP_CRYPTO_SECRET_V1`, one canonical base64 value containing at least 32 random bytes. Never rotate it by replacing the current value. Introduce a new numbered key and migration plan.
- `SPONSORSHIP_VISITOR_COOKIE_SECRET_V1`, a separate canonical base64 value containing at least 32 random bytes. It signs only the first party visitor token and must never equal `SPONSORSHIP_CRYPTO_SECRET_V1`. An absent or malformed production value disables anonymous attribution without blocking sponsorship payment. Generate it with a cryptographically secure random source, store it as a server only value, and run the visitor cookie canary before promotion.
- `CRON_SECRET`, a random secret of at least 32 characters. Vercel sends this value as a Bearer token to each scheduled worker route.
- `PAYMENT_GATEWAY_EVENT_WORKER_SECRET`, optional. Use only for a non-Vercel scheduler. When present, its caller must send this value instead of `CRON_SECRET`.
- `SPONSOR_WELCOME_EMAIL_WORKER_SECRET`, optional, with the same external-scheduler rule.
- `SUBSCRIPTION_CANCELLATION_WORKER_SECRET`, optional, with the same external scheduler rule.
- `PAYMENT_GATEWAY_EVENT_BATCH_SIZE`, optional, from 1 through 100. The default is 20.
- `PAYMENT_GATEWAY_EVENT_CONCURRENCY`, optional, from 1 through 10. The default is 4.
- `SPONSOR_WELCOME_EMAIL_BATCH_SIZE`, optional, from 1 through 100. The default is 4 and it must not exceed the configured concurrency. This keeps one claimed batch to one SMTP wave inside the 60 second Vercel execution window.
- `SPONSOR_WELCOME_EMAIL_CONCURRENCY`, optional, from 1 through 10. The default is 4.
- `SPONSOR_WELCOME_EMAIL_RETRY_AFTER_SECONDS`, optional, from 1 through 86400. The default is 300. This is the base delay. Provider failures back off exponentially, stop increasing at one day, and are never scheduled beyond the 90 day contact retention boundary.
- `SPONSOR_WELCOME_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS`, optional, from 1000 through 45000. The default is 20000. The worker persists SMTP handoff evidence before this bounded network call.
- `SPONSOR_WELCOME_EMAIL_INVOCATION_SAFETY_MARGIN_MILLISECONDS`, optional, from 1000 through 15000. The default is 5000. This value plus the SMTP timeout must not exceed 55000 inside the 60 second Vercel route.
- `SUBSCRIPTION_CANCELLATION_BATCH_SIZE`, optional, from 1 through 20. The default is 4.
- `SUBSCRIPTION_CANCELLATION_CONCURRENCY`, optional, from 1 through 4. The default is 2 and cannot exceed the batch size.
- `SUBSCRIPTION_CANCELLATION_PROVIDER_TIMEOUT_MILLISECONDS`, optional, from 1000 through 45000. The default is 15000.
- `SUBSCRIPTION_CANCELLATION_INVOCATION_SAFETY_MARGIN_MILLISECONDS`, optional, from 1000 through 15000. The default is 5000. This value plus the provider timeout must not exceed 55000.
- Stripe US and UK API keys, signing secrets, optional previous signing secrets, publishable keys, and portal URLs.
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and the exact `PAYPAL_API_URL`. Production should use `https://api-m.paypal.com`. Sandbox must explicitly use `https://api-m.sandbox.paypal.com`. The webhook ID and certificate environment must match this API origin.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, and the Creator Share `EMAIL_FROM` value for the welcome outbox worker.

The Stripe signing secret for one regional account must never equal a current or previous secret for the other account. Startup and webhook handling fail closed if the topology is ambiguous.

Both regional Stripe webhook endpoints must deliver events using API version `2025-02-24.acacia`. Configuring the application client to this version does not configure an existing dashboard webhook endpoint. Before promotion, inspect each endpoint in Stripe Workbench or the Dashboard, record its configured event API version, and send one signed canary from each regional account. The ingested event must contain `api_version=2025-02-24.acacia`. Any other version is quarantined by the server intent boundary and is a release blocker.

The PayPal webhook endpoint accepts at most 64 KiB and verifies the exact raw event representation through PayPal's signature verification API. Do not place a body parser, JSON normalizer, or proxy transformation in front of it. Unsupported signed events are acknowledged after durable contact-free quarantine evidence is written. Permanent chain mismatches are also quarantined. Provider lookup outages remain retryable and return a static unavailable response.

The production Vercel project must support one-minute Cron schedules. The repository schedules the payment event worker, sponsor welcome worker, subscription cancellation worker, and advocate provisioner every minute with authenticated GET requests. Vercel does not retry one failed Cron invocation, so durable database leases and the next scheduled invocation provide recovery. Confirm the project plan accepts this frequency before promotion.

## Visitor attribution release boundary

The visitor token is an authenticated pseudonymous identifier, not payment authority, proof of identity, or proof of a human visit. The exposure endpoint never creates a token from a bare analytics request and requires exact same origin browser metadata, but an automated client can still load a public page, receive a valid token, and imitate the follow-up request. Direct and post visit sponsorship outcomes remain payment backed. Raw visit and reach counts remain susceptible to deliberate automation until FF-024 adds Cloudflare rate limits and bot scoring.

The token is scoped to `.creatorshare.com` so a later primary site sponsorship can join to an earlier advocate exposure. A browser therefore sends it to every Creator Share subdomain. `HttpOnly` prevents script access but does not prevent a sibling subdomain server from receiving the token. Before enabling the cookie in production:

1. Export the complete Cloudflare DNS record inventory for `creatorshare.com`.
2. Record the hosting owner and runtime for every active or delegated subdomain.
3. Remove, isolate, or explicitly approve every legacy, vendor hosted, parked, dangling, or third party controlled hostname.
4. Confirm no untrusted service can read or set parent domain cookies.
5. Retain the inventory with the release evidence and repeat the review before adding any new sibling service.

The application keeps middleware on the globally distributed Edge runtime. Visitor cookie authentication uses an audited Edge compatible HMAC and HKDF implementation so primary page and API traffic does not inherit a Node middleware latency or invocation cost regression. Static Next.js chunks remain excluded. The primary root favicon and public image assets retain their existing exclusions, while Creator Share sibling hosts pass those assets through the exact tenant policy. Image optimizer requests remain inside the policy on every host to prevent an unapproved origin from consuming optimization capacity. The production build must report Edge middleware with both reviewed matchers. A Vercel preview must prove one exact provisioned tenant hostname, reject one unprovisioned sibling hostname, and prove cookie issuance, duplicate normalization, checkout initiation, and the neutral provider return flow before promotion.

Version one visitor tokens have a 400 day maximum age. If the signing key is suspected compromised before versioned overlap support exists, replace the key immediately, accept that prior anonymous visitor linkage is reset, preserve payment and locked attribution facts, and record the incident. Never delay containment to preserve anonymous analytics. FF-023 adds a version two issue key with version one verification overlap for planned rotation.

## Phase 1: additive database deployment

1. Back up the target database and record the restore point.
2. Apply migrations through the additive v2 checkout and gateway worker boundaries.
3. Run the complete pgTAP suite against the target schema.
4. Read `read_sponsorship_checkout_rpc_release_gate_v2()` and record its result in the release evidence.
5. Confirm both legacy and v2 functions are service role only.
6. Confirm every legacy checkout mutator rejects an intent that owns a v2 operation.
7. Confirm direct table access to checkout operations, recovery state, gateway events, claims, outbox, and secret material access evidence is unavailable to browser roles.

The release gate function is deployment evidence. It is not a per request feature flag. During the additive phase it intentionally reports that caller cutover and a later legacy drain migration are still required.

## Phase 2: application caller cutover

1. Deploy the application version that requires a browser generated checkout operation ID.
2. Confirm checkout creation calls only the v2 prepare, quote, begin, resume, attach, finalize, and status functions.
3. Confirm the browser stores only the noncontact operation binding and opaque receipt in same tab session storage.
4. Confirm return URLs contain no Stripe object ID, region, amount, email, beneficiary ID, or attribution identifier.
5. Confirm the payment gateway event worker is authenticated, scheduled, bounded, and reporting fixed error codes only.
6. Confirm the sponsor welcome worker is authenticated, scheduled, bounded, and sends no plaintext recipient or claim material to database logs, application logs, or route responses.
7. Confirm the subscription cancellation worker is authenticated, scheduled every minute, bounded by its batch, concurrency, provider timeout, and invocation margin, and returns no provider subscription identifiers.
8. Run live mode canaries for Stripe US and Stripe UK with one time, monthly, and yearly terms where supported.
9. Run PayPal canaries for one time, monthly, and yearly terms. Confirm a one time capture and recurring sale both reopen the lease-fenced welcome material only for the first eligible sponsorship.
10. Confirm each recurring PayPal lifecycle, sale, and payment failure event matches the sole active server catalog plan. An absent, conflicting, or ambiguous plan must fail closed.
11. Replay one signed PayPal capture, sale, refund, and dispute event with the same provider event ID. Confirm each replay returns the same durable event and creates no second movement or application.
12. Exercise a partial PayPal dispute debit, a lifecycle update, a buyer-favor resolution, and both `RESOLVED_SELLER_FAVOR` and `RESOLVED_SELLER_FAVOUR`. Updates and buyer wins must create no money. Seller wins may credit only the outstanding debit for the same dispute and original capture or sale.
13. Exercise a lost application response after provider creation. The retry must recover the same provider object under the same idempotency key.
14. Exercise Checkout cancellation. The same operation must reopen the original session while it remains usable.
15. Exercise Checkout expiration. Signed evidence and recovery reconciliation must terminalize the attempt and release any active child reservation.
16. Exercise one first standard sponsorship welcome, one blind sponsorship welcome, one renewal, and one later sponsorship by the same identity. Confirm one durable welcome outbox exists per eligible identity and partnership payments do not create or consume that identity dedupe.
17. Force the SMTP ambiguity canary in a protected sandbox. Arrange for the SMTP server to accept the deterministic message ID, then terminate the connection before the application receives the acceptance response. Confirm the delivery attempt appears in `list_email_outbox_delivery_ambiguities()` and is not claimed again after its ten minute lease becomes stale.
18. Confirm the invocation deadline canary. Set the remaining route time below the configured SMTP timeout plus safety margin. The worker must record a durable retry without creating a handoff row or calling SMTP.
19. Confirm a provider lookup by deterministic message ID can settle the quarantine. Use `resolve_email_outbox_delivery_ambiguity()` with `confirmed_delivered` only when provider evidence proves acceptance. Use `resolve_email_outbox_delivery_ambiguity()` with `confirmed_not_accepted` only when provider evidence proves nonacceptance. Include an operator or incident reference and a specific reason.
20. Confirm FF-020 remains accepted. The quarantine prevents automatic duplicate delivery, but generic SMTP still cannot provide transactional provider idempotency.
21. Cancel one Stripe US, one Stripe UK, and one PayPal recurring subscription. Confirm the provider reaches a terminal state before the local subscription becomes cancelled.
22. Force a retryable cancellation provider response. Confirm the operation records a future `next_attempt_at`, is absent from the candidate function before that time, and is claimed automatically after it becomes due.
23. Force provider success followed by an unavailable database settlement. The worker must return 503. After lease expiry, a later attempt must converge from the provider's already terminal state and settle the original local operation once.
24. Return an unrelated PayPal 422 response containing the words cancelled or expired outside an exact `SUBSCRIPTION_STATUS_INVALID` detail. It must enter manual review and must not be treated as provider cancellation evidence.
25. Exhaust the bounded cancellation retry count in a protected sandbox. The operation must stop in manual review, and the sponsor and administrator interfaces must not describe it as cancelled.
26. Confirm a production browse response issues one authenticated `cs_sponsorship_visitor_v1` cookie and a later primary site checkout produces the same visitor digest as the advocate exposure.
27. Present a forged cookie plus one authentic cookie and two distinct authentic cookies. Confirm the first case preserves the authentic visitor, the second rotates once, and neither case blocks checkout.
28. Confirm the Edge middleware runtime and matcher in the production build output. Exercise one exact provisioned tenant hostname on the Vercel deployment, then confirm an unprovisioned sibling hostname is rejected.
29. Attach the approved Creator Share subdomain DNS and hosting inventory to the release evidence.

The generic SMTP path quarantines every provider acceptance ambiguity before a stale lease can retry it. It does not provide exact once delivery. A deterministic message ID supports operator investigation, but it is not an idempotency guarantee. Never describe this worker or its canaries as exact once.

### Subscription cancellation convergence

Cancellation retries rely on terminal state convergence, not provider idempotency keys. Stripe subscription cancellation is a DELETE operation, so Stripe idempotency keys do not apply. PayPal's subscription cancellation endpoint does not explicitly support `PayPal-Request-Id`, so the worker does not send that header. The database operation UUID is a durable local correlation key only.

Each retry uses the same cancellation operation, a new database lease, bounded exponential scheduling, and the same provider subscription reference. Exact provider cancellation, exact already terminal evidence, or authoritative absence can settle the local subscription. Ambiguous infrastructure failures remain retryable. Unsupported or structurally ambiguous provider responses enter manual review. Never mark local future billing as stopped before terminal provider evidence is lease settled.

### Partnership notification deferral

V2 partnership checkout uses the same Stripe Hosted Checkout boundary, customer email binding, payment terms, provider account routing, return host, attribution, lifecycle handling, and cancellation surface on the primary site and exact active advocate domains. It does not suppress Stripe's provider receipt when that receipt is enabled for the Creator Share Stripe account.

The legacy webhook also sent a separate Creator Share partnership confirmation directly after checkout completion. The v2 server intent path intentionally does not repeat that direct SMTP side effect. FF-019 defers it until a distinct durable `partnership_confirmation` outbox contract can enqueue atomically with verified payment success and provide idempotent delivery, retry, suppression, retention, and operator visibility. This is a notification delivery deferral, not a difference in payment scope.

A partnership-only success remains ineligible for the sponsor welcome and account claim. Do not relabel the legacy partnership confirmation as a sponsor welcome, reuse the identity-wide welcome dedupe key, manufacture an account claim, or call the direct email helper from the signed webhook path.

The legacy `partnerships` table remains a compatibility projection for pre-v2 Stripe events. Its only current application readers are the legacy checkout completion, invoice failure, and subscription deletion branches in the Stripe webhook. V2 events leave that handler through the server intent classifier before those branches. For v2, `sponsorship_intents`, `subscriptions`, sponsorship financial movements, and `transaction_ledger` are authoritative for project, amount, provider identity, lifecycle, cancellation, account history, admin views, and reporting. Do not dual write a v2 payment into the email-keyed legacy table.

### SMTP manual review procedure

1. Read the contact-free queue with `list_email_outbox_delivery_ambiguities()`. Record the handoff ID, outbox ID, attempt number, deterministic provider message ID, and handoff timestamp in the incident record.
2. Search the SMTP provider using the exact deterministic message ID. Do not put the recipient address, claim token, ciphertext, or decrypted material in the incident record.
3. If provider evidence proves delivery, call `resolve_email_outbox_delivery_ambiguity()` with `confirmed_delivered`, a noncontact reason, and the operator or incident reference.
4. If provider evidence proves the message was not accepted, call the same function with `confirmed_not_accepted`. This is the only resolution which releases a later automatic retry.
5. If provider evidence is absent or inconclusive, leave the row quarantined. Escalate it to the release owner. Uncertainty is not permission to send a second physical message.
6. Confirm the row left the queue and inspect its audit trail. Never directly edit the outbox or handoff tables.

Pending claim links remain valid for 400 days. The encrypted recipient and claim envelope remains available for delivery for no more than 90 days, then the retention worker redacts it. Extending the claim link does not extend plaintext or ciphertext contact retention.

## Checkout contact erasure scope

The checkout contact erasure boundary removes the server-owned provider request ciphertext after canonical settlement and any applicable welcome materialization, or after exact terminal no-payment evidence. Partnership settlement is eligible without a welcome because partnership payments intentionally do not create a claim or welcome outbox.

This boundary does not erase encrypted gateway event payloads or encrypted provider reconciliation evidence. Those retained provider records may contain provider-supplied contact fields unless their producers strip the fields before sealing. Database backups can also retain older row versions while the shared encryption key remains active. Release communications must describe this as checkout request contact erasure, not global sponsor contact cryptographic erasure. A broader provider evidence minimization and key destruction policy requires separate approval, migration, and restore testing.

## Phase 3: warm instance drain

1. Stop promotion while old application instances can still receive traffic.
2. Wait through the platform's maximum warm instance lifetime, plus an operational safety margin.
3. Verify logs show no legacy prepare, quote, begin, or attach calls during the full drain window.
4. Verify all newly created checkout operations have boundary version 2 and a matching durable recovery row after payment begin.
5. Verify the manual review queue is empty or explicitly owned.

Do not infer a completed drain from a successful deployment alone. Serverless platforms are quite capable of preserving yesterday inside a warm process.

## Phase 4: legacy revocation

Create and apply a separate migration only after Phase 3 evidence is approved. That migration must:

1. Revoke service role execution from the compatibility generation of prepare, quote, begin, and attach.
2. Preserve private historical primitives only where rollback evidence requires them.
3. Update the release gate result to show caller cutover complete and no later drain migration required.
4. Add pgTAP assertions for the final privileges and function inventory.
5. Retain all historical intents, attempts, operations, events, movements, claims, and audit evidence.
6. Retire the legacy return compatibility endpoints and client branches, including `/api/stripe/success` and `/api/paypal/verify`, after the warm drain proves no unmarked legacy return remains. Marked v2 PayPal returns without their tab receipt must continue to fail closed and must never fall back to the legacy verifier.

## Rollback boundaries

- Before any v2 operation exists, application traffic may return to the previous caller while the additive migration remains installed.
- After a v2 operation exists, only v2 functions may mutate that operation. Never convert it to a legacy intent or delete its recovery evidence.
- After provider creation, recovery must use the sealed request and original provider idempotency key. Never synthesize a replacement request from browser state.
- After a verified payment event exists, rollback must preserve event application and financial movement idempotency.
- Database restoration is an incident procedure, not an ordinary application rollback. Reconcile provider state before reopening payment traffic.

## Release evidence

Retain the following with the release record:

- Migration list and database commit identity.
- Full pgTAP result.
- Typecheck, lint, unit, integration, and browser test results.
- Release gate output before and after final legacy revocation.
- Stripe US and UK canary object IDs in a protected operator record.
- Worker batch health and manual review counts.
- Confirmation that no sponsor email, claim token, receipt, ciphertext, or provider payload appeared in application logs.
- Production visitor cookie canary, Edge middleware runtime evidence, and approved subdomain trust inventory.
- Rollback owner and incident contact.

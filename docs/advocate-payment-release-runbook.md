# Advocate Payment Boundary Release Runbook

This runbook controls the additive deployment of the v2 sponsorship checkout boundary. It exists because database functions and warm application instances cannot be replaced atomically across Supabase and Vercel.

The release must preserve the current sponsorship checkout until every new application instance uses the v2 functions. Legacy functions remain service scoped during that overlap and contain explicit guards that prevent them from mutating v2 checkout operations.

## Required configuration

Configure and validate these server only values in every target environment:

- `ADVOCATE_PROVIDER_AUTOMATION_MODE`, an environment-wide provider automation gate accepting only the exact values `disabled` and `active`. Missing or malformed values fail closed as disabled. Keep it disabled in preview, test, and local environments and throughout production configuration review. Activate it only through a separately approved production environment promotion after the authenticated provider-free release preflight succeeds. It covers provisioning, publication canaries, the publication sentinel, and archived-domain lifecycle coordination so a disabled environment cannot accumulate destructive provider cleanup work. This gate does not disable checkout, payment event processing, sponsor cancellation, welcome email, or invitation email delivery.
- `SPONSORSHIP_CRYPTO_SECRET_V1`, one canonical base64 value containing at least 32 random bytes. Never rotate it by replacing the current value. Introduce a new numbered key and migration plan.
- `SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1`, a separate canonical base64 value containing at least 32 random bytes. It HMACs the Vercel trusted source signal under different delivery and verification contexts, so the two ledgers cannot be joined by their source digest. It must be unique to each environment and distinct from sponsorship, visitor, attribution, worker, and provider secrets. An absent or malformed value fails delivery and verification closed without exposing account existence.
- `ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1`, a separate canonical base64 value containing at least 32 random bytes. It HMACs only the Vercel trusted source signal for advocate invitation email proof attempts and must differ from every other environment secret. Exact quota denial, missing configuration, a database timeout, and a malformed reservation response fail closed as one generic retryable unavailable result before Supabase proof verification. A planned rotation must advance the numbered environment key and database key version together while preserving the prior 24 hour quota evidence.
- Pending advocate invitation delivery envelopes use `SPONSORSHIP_CRYPTO_SECRET_V1` for authenticated encryption. A rotation must preserve decryptability for every pending envelope or cancel and safely reissue those invitations before retiring the old key. Never replace the current key while a pending envelope still depends on it.
- `SPONSORSHIP_VISITOR_COOKIE_SECRET_V1`, a separate canonical base64 value containing at least 32 random bytes. It signs only the first party visitor token and must never equal `SPONSORSHIP_CRYPTO_SECRET_V1`. An absent or malformed production value disables anonymous attribution without blocking sponsorship payment. Generate it with a cryptographically secure random source, store it as a server only value, and run the visitor cookie canary before promotion.
- `ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1`, a third and distinct canonical base64 value containing at least 32 random bytes. This server only key signs the 400-day cross-subdomain signal used solely to exclude authenticated Creator Share staff and advocate portal members from attribution analytics. It is not a session, authentication credential, or authorization input. It must never equal `SPONSORSHIP_CRYPTO_SECRET_V1`, `SPONSORSHIP_VISITOR_COOKIE_SECRET_V1`, or any other environment secret.
- `ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS`, optional. During a planned key rotation, set it to the former current attribution identity key so existing valid signals can be verified and refreshed. It must be distinct from the current key and every sponsorship secret. Retain it until every valid 400-day signal has been refreshed or expired, unless an incident requires immediate invalidation. Never use this slot as a second current signing key.
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
- `DATA_RETENTION_WORKER_SECRET`, optional. Use only for a non-Vercel scheduler. Vercel Cron sends `CRON_SECRET`, so this dedicated value must remain unset in Vercel.
- `DATA_RETENTION_BATCH_SIZE`, optional, from 1 through 5000. The default is 5000. Checkout contact erasure remains capped at 500 per invocation even when this value is higher.
- `DATA_RETENTION_RPC_TIMEOUT_MILLISECONDS`, optional, from 1000 through 10000. The default is 7500.
- `DATA_RETENTION_INVOCATION_SAFETY_MARGIN_MILLISECONDS`, optional, from 1000 through 5000. The default is 5000. Six cleanup deadlines, two bounded control calls, and this reserve must not exceed 55000.
- `ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET`, optional. A dedicated external scheduler may send this value. Leave it unset for Vercel Cron, which sends `CRON_SECRET`. Generate at least 32 random nonwhitespace characters and keep it server only.
- `ADVOCATE_LOGO_RECONCILIATION_BATCH_SIZE`, optional, from 1 through 20. The default is 4.
- `ADVOCATE_LOGO_RECONCILIATION_CONCURRENCY`, optional, from 1 through 4. The default is 2 and cannot exceed the batch size.
- `ADVOCATE_LOGO_RECONCILIATION_STORAGE_TIMEOUT_MILLISECONDS`, optional, from 1000 through 30000. The default is 15000. This is a real aborting deadline for both reconciliation RPC and Storage traffic.
- `ADVOCATE_LOGO_RECONCILIATION_INVOCATION_SAFETY_MARGIN_MILLISECONDS`, optional, from 1000 through 15000. The default is 5000. This reserve remains outside the worker network deadline so the route can return before the 60 second platform cutoff. The reserve plus the Storage timeout must not exceed 55000.
- `ADVOCATE_INVITATION_EMAIL_WORKER_SECRET`, optional. A dedicated external scheduler may send this value. Leave it unset for Vercel Cron, which sends `CRON_SECRET`. Generate at least 32 random nonwhitespace characters and keep it server only.
- `ADVOCATE_INVITATION_EMAIL_BATCH_SIZE`, optional, from 1 through 20. The default is 2.
- `ADVOCATE_INVITATION_EMAIL_CONCURRENCY`, optional, from 1 through 4. The default is 2 and cannot exceed the batch size.
- `ADVOCATE_INVITATION_EMAIL_RETRY_AFTER_SECONDS`, optional, from 1 through 86400. The default is 300.
- `ADVOCATE_INVITATION_EMAIL_SERVICE_REQUEST_TIMEOUT_MILLISECONDS`, optional, from 1000 through 10000. The default is 5000. The worker budgets five bounded service calls inside one invocation.
- `ADVOCATE_INVITATION_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS`, optional, from 1000 through 30000. The default is 20000.
- `ADVOCATE_INVITATION_EMAIL_INVOCATION_SAFETY_MARGIN_MILLISECONDS`, optional, from 1000 through 15000. The default is 5000. Five service request timeouts, the transport timeout, and this reserve must total no more than 59000.
- `ADVOCATE_INVITATION_CANONICAL_ORIGIN`, optional. Leave it unset in production. If present, its only accepted value is the exact primary origin `https://creatorshare.com`.
- `ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET`, optional. A dedicated external scheduler may send this value. Leave it unset for Vercel Cron, which sends `CRON_SECRET`.
- `ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE`, optional, from 1 through 100. The default is 100 active advocate portals per weekly invocation.
- `ADVOCATE_PUBLIC_METRIC_RELEASE_RPC_TIMEOUT_MILLISECONDS`, optional, from 1000 through 50000. The default is 45000 inside the 60 second route.
- Stripe US and UK API keys, signing secrets, optional previous signing secrets, publishable keys, and portal URLs.
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US`, the enabled live Billing Portal configuration in the Stripe US account. It must allow only the required payment-method update flow and must not be reused from another Stripe account.
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK`, the corresponding enabled live configuration in the Stripe UK account.
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and the exact `PAYPAL_API_URL`. Production should use `https://api-m.paypal.com`. Sandbox must explicitly use `https://api-m.sandbox.paypal.com`. The webhook ID and certificate environment must match this API origin.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, and the Creator Share `EMAIL_FROM` value for the welcome and advocate invitation outbox workers.

The Stripe signing secret for one regional account must never equal a current or previous secret for the other account. Startup and webhook handling fail closed if the topology is ambiguous.

### Supabase email confirmation boundary

The hosted Supabase project configuration is a release gate. Local `supabase/config.toml` does not configure the hosted project.

1. In Supabase Authentication email templates, configure both Confirm signup and Magic Link from `supabase/templates/sponsor_email_confirmation.html`. Their link target must remain exactly `{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;v=1`. Never put the token hash in a query parameter.
2. Require email confirmation for email signups in every deployed environment. Local configuration also enables confirmation so the Mailpit gate exercises production-shaped behavior.
3. Allow only these production redirect targets in Supabase URL configuration: `https://creatorshare.com/auth/confirm?next=%2Fapp`, `https://creatorshare.com/auth/confirm?next=%2Fsponsor%2Fclaim`, `https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding`, and `https://creatorshare.com/advocate-invitation`. Do not add a wildcard host, wildcard path, `www` alias, Vercel alias, or advocate subdomain.
4. Disable provider link tracking and click rewriting for these messages. A provider which rewrites or prefetches fragment-bearing links must be rejected for this flow.
5. Confirm `/auth/confirm` is served only from the exact canonical Host. GET and HEAD display a raw, no-store, no-referrer interstitial and never redeem the token. Redemption occurs once, in a same-origin JSON POST, only after the user activates Continue.
6. Run the gated Mailpit or production-equivalent canary with two independent browser cookie jars. Request the email in the first jar, open the delivered link in the second, verify the URL fragment is synchronously removed, and confirm the second jar reaches the fixed destination with a server session.
7. Exercise signup confirmation, existing-account sign in, sponsor initial claim, sponsor reauthentication, an overlapping resend, an expired token, a duplicate token fragment, and a scanner-style GET without a click. Confirm the scanner GET creates no session or recent-authentication receipt.
8. Inspect requests, responses, browser storage, referrers, analytics, application logs, and provider logs. The token may appear only in the delivered email fragment and the one same-origin confirmation POST body. It must not appear in a URL received by the server, query string, header, cookie, log, analytics event, referrer, local storage, or session storage.

Record a SHA256 checksum of the deployed Confirm signup and Magic Link templates, the exact redirect allowlist, confirmation setting, and link-tracking setting in the release evidence. Compare them with the repository template before every promotion. A matching local configuration is not hosted-project evidence.

### Passwordless delivery and verification limits

The database reserves every permitted delivery atomically before Supabase receives an email request. It retains only keyed recipient and trusted-source digests. It never stores a raw email address or IP address in the limiter. The application returns the same `202 Accepted` response for a known account, unknown account, denied reservation, provider rejection, or internal provider failure.

Generic sign-in and registration are public flows. Authenticated reauthentication and database-validated initial or existing-account claims are protected flows. Each class has a bounded pool inside an unchanged hard provider ceiling. Public traffic therefore cannot consume the protected capacity needed to manage a sponsorship.

The MVP delivery policy is:

- A public delivery is suppressed by any active 60-second recipient single flight. A protected delivery is suppressed only by another active protected single flight, so public traffic cannot hold the protected path closed.
- Per recipient, the hard limits are four deliveries in 10 minutes and 12 in 24 hours. Public flows may consume at most two and six of those limits. Protected flows may consume at most three and 10.
- Per trusted source, the hard limits are 40 deliveries in 10 minutes and 240 in 24 hours. Public flows may consume at most 20 and 120. Protected flows may consume at most 30 and 180.
- Globally, the hard limits remain 1,000 deliveries in one hour and 5,000 in 24 hours. Public flows may consume at most 700 and 3,500. Protected flows may consume at most 800 and 4,000.

The confirmation POST separately reserves one verification attempt before calling Supabase. Its source digest uses a purpose-separated HMAC context and the ledger stores no recipient or token-derived value. Verification permits at most 30 attempts per trusted source in 10 minutes, 200 per source in 24 hours, 600 globally in one hour, and 3,000 globally in 24 hours. A denied reservation returns the same invalid-or-expired response as a rejected token. Reservation infrastructure failure returns the static unavailable response and never calls Supabase.

Exercise every exact boundary concurrently. Confirm public saturation leaves the documented protected capacity, the hard provider ceiling still closes every class, an accepted reservation cannot be exceeded through parallel requests, a denial does not call Supabase, and no response or log distinguishes the limiting dimension. Confirm verification saturation makes zero provider calls and neither rate-limit table stores raw email, IP, or token material. The hosted route may trust the Vercel-overwritten client source header and Vercel trace identifier only when the runtime declares `VERCEL=1`. Every other environment collapses source identity to the fixed unavailable bucket and discards the supplied Vercel trace. Direct or non-Vercel deployment requires an equivalent authenticated ingress boundary before a source signal is trusted.

### Sponsor account management release gate

Cancellation and payment-method management require a server-recorded email-authentication receipt no more than 15 minutes old. The receipt must bind the exact healthy Supabase Auth user and exact live session. Exercise missing, expired, future-dated, wrong-session, revoked-session, low-assurance, deleted-account, banned-account, and password-only cases. A fresh JWT or authentication-method claim without the service-recorded receipt must fail with the exact recent-verification precondition before any provider call.

Cancellation forensics record a Vercel trace and exact single client IP only when the runtime declares `VERCEL=1`, because Vercel overwrites those headers at final ingress. Every non-Vercel deployment records both fields as unavailable. Cloudflare and generic forwarding headers are never evidence in the DNS-only MVP topology. The bounded user-agent field is a browser assertion, not a trusted network identity. Exercise spoofed, repeated, malformed, and off-platform headers before promotion.

Run one payment-management canary for Stripe US, one for Stripe UK, and one for PayPal. For Stripe, prove the selected customer belongs exclusively to the authenticated sponsor in the exact regional provider chain, the subscription is live and uses a supported automatic collection mode, and the returned short-lived URL uses only `https://billing.stripe.com`. Confirm the URL never enters application-controlled logs, analytics, databases, persistent web storage, or outbound referrers. Browser navigation history is controlled by the browser and provider and is not an application persistence surface. For PayPal, confirm the browser presents an explicit handoff notice and opens only PayPal Automatic Payments without exposing a provider subscription identifier.

Stripe Billing Portal `payment_method_update` changes the customer invoice default. A nonnull `subscription.default_payment_method` or `subscription.default_source` overrides that customer default. Inventory every live recurring subscription in both Stripe accounts before promotion and retain only aggregate counts plus protected operator references. The runtime must fail closed for every override, unsupported collection mode, unsupported state, or ambiguous customer ownership. An empty inventory plus the runtime guard permits the customer-level flow. Any discovered override blocks release until it is reconciled or an exact-subscription, webhook-authoritative update workflow is delivered. The account UI must describe the Stripe action as updating the regional billing account, not one selected subscription.

Run the read-only inventory from a protected operator environment where `STRIPE_SECRET_KEY_US` and `STRIPE_SECRET_KEY_UK` are set to the two live regional account keys:

```sh
yarn -s audit:stripe-payment-methods
```

The command queries only the three live subscription states supported by the runtime flow: `active`, `past_due`, and `trialing`. It does not treat ended, incomplete, unpaid, paused, or cancelled subscriptions as payment-method update candidates. Within the three scanned states, a subscription with invoice collection, `default_payment_method`, or `default_source` increments the unique blocker count. The command verifies that both credentials are live, both regional accounts are reachable and distinct, every page is complete and well formed, and every scanned subscription has a provider customer. It performs only account retrieval and subscription listing operations.

Interpret the exit status as follows:

- Exit `0` means both regional inventories completed, every scanned subscription uses automatic collection without a subscription-level payment method or source override, and promotion may proceed to the live canaries.
- Exit `1` means the inventory completed but at least one blocker exists. Promotion remains blocked. Investigate and record exact references only inside the protected Stripe operator workflow. Do not add provider identifiers to this command's output.
- Exit `2` means the evidence is uncertain because configuration, regional account identity, provider access, pagination, or response validation failed. Promotion remains blocked even when any partial count was zero.

Standard output contains only fixed region labels, fixed status or reason codes, and aggregate counts. It never contains a Stripe account ID, secret key, customer ID, subscription ID, payment method ID, source ID, provider error message, or bearer URL. Retain the aggregate JSON as release evidence. Never retain a shell transcript which printed the key export commands.

Both regional Stripe webhook endpoints must deliver events using API version `2025-02-24.acacia`. Configuring the application client to this version does not configure an existing dashboard webhook endpoint. Before promotion, inspect each endpoint in Stripe Workbench or the Dashboard, record its configured event API version, and send one signed canary from each regional account. The ingested event must contain `api_version=2025-02-24.acacia`. Any other version is quarantined by the server intent boundary and is a release blocker.

The PayPal webhook endpoint accepts at most 64 KiB and verifies the exact raw event representation through PayPal's signature verification API. Do not place a body parser, JSON normalizer, or proxy transformation in front of it. Unsupported signed events are acknowledged after durable contact-free quarantine evidence is written. Permanent chain mismatches are also quarantined. Provider lookup outages remain retryable and return a static unavailable response.

The production Vercel project must support one-minute Cron schedules. The repository declares eleven schedules: advocate provisioning, publication canaries, the publication sentinel, logo reconciliation, invitation delivery, lifecycle cleanup, payment event processing, sponsor welcome delivery, and subscription cancellation every minute; bounded retention hourly at minute 17; and public metric release daily at 01:13 UTC. The database permits only one fixed weekly public-metric source cutoff, so daily invocations provide idempotent recovery without increasing the public release cadence. Vercel does not retry one failed Cron invocation, so durable database state and the next scheduled invocation provide recovery. Confirm the project plan accepts all eleven schedules and the 300 second publication-canary function before promotion.

### Advocate invitation worker operations

`GET` and `POST` requests to `/api/internal/advocates/invitations` run the same bounded worker. Vercel invokes authenticated `GET` once per minute, and an approved external scheduler or operator may invoke authenticated `POST`. The route has a 60 second function limit and requires `Bearer` authentication using `ADVOCATE_INVITATION_EMAIL_WORKER_SECRET` when configured, otherwise `CRON_SECRET`. Responses and logs contain only a request identifier, fixed status code, and aggregate claimed, sent, retry, terminal failure, lease loss, manual review, and unknown settlement counts. They never contain an invitation, recipient, target account, provider proof, capability, ciphertext, outbox identifier, or provider message identifier.

The worker binds the provider account to the exact normalized email before SMTP handoff. Once provider handoff begins, an unknown acceptance result is quarantined and cannot be reclaimed after its lease expires. This prevents an automatic duplicate at the cost of manual investigation. FF-031 tracks a dedicated audited resolution console. Until it exists, the safe procedure below never mutates or retries the quarantined outbox item.

### Advocate public metric release operations

`GET` and `POST` requests to `/api/internal/advocates/public-metrics` run the same bounded worker. Vercel invokes authenticated `GET` daily at 01:13 UTC. The route requires the dedicated external scheduler secret when configured, otherwise `CRON_SECRET`. It returns only a request identifier, fixed policy version, weekly source cutoff, and aggregate processed, inserted, and pending counts. Repeated invocations during one week are recovery attempts against the same immutable cutoff.

The database derives the most recent eligible Monday cutoff with a seven day embargo. It calculates four fixed monotonic metrics for active advocates, independently requires five contributing contacts since each prior release, and stores only an advanced rounded lower bound. It does not store candidate totals or support counts. Overlapping invocations serialize through the database boundary, and replay at the same cutoff is idempotent. Selection changes never invoke this worker and never create a release.

Alert on every non-success response and on a missing weekly success. A successful zero insertion is not an error because no privacy-safe bucket may have advanced. The MVP fails the complete transaction if active published advocates exceed the configured batch, rather than repeatedly processing an arbitrary first page. FF-035 owns durable continuation before that ceiling is raised. Never log or attach raw metric candidates, sponsor contacts, identities, intents, beneficiaries, provider facts, or financial movements to worker evidence.

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

The separate advocate attribution identity signal also has a 400 day maximum age and travels across Creator Share subdomains. A successful authentication completion refreshes it, while explicit logout and password-reset signout remove it using the same parent-domain cookie scope. The application may use a verified signal only as a candidate user ID for database-enforced staff and same-portal member exclusion. It must never grant account, portal, payment, or administrative access. Missing or invalid signals leave ordinary guest attribution behavior unchanged.

Before promotion, complete the cross-subdomain self-exclusion canary. Authenticate on `creatorshare.com`, record that the response sets one `HttpOnly`, `Secure`, `SameSite=Lax`, parent-domain attribution identity cookie without exposing its value, and then browse one exact active advocate hostname in the same browser. Confirm the exposure endpoint forwards the authenticated user binding and the database creates no visitor or exposure for a global staff user and for a member of that same advocate portal. Repeat issuance through password login, magic-link callback, recovery OTP, any registration mode that creates an immediate session, and the client-side invitation session flow. The invitation flow must call the same-origin authenticated completion endpoint before it treats the session as usable. Log out on `creatorshare.com`, confirm the response expires the exact parent-domain cookie, and then confirm an ordinary anonymous browser can still create an eligible exposure. Repeat the cookie issuance step while the previous rotation key is configured, confirm the application accepts and refreshes an old valid signal, and retain only redacted pass or fail evidence.

PostgREST role claim compatibility is a release boundary, not an implementation detail. Before phase 1 promotion, exercise checkout quote issuance, qualified exposure, PayPal capture material, cancellation work, retention, logo work, invitation work, public metric release, sponsor history, and sponsor cancellation through the deployed PostgREST version. Run every service-only case with both the legacy service role JWT and the current secret API key. Run the sponsor cases with a real authenticated user token. Repeat the service cases as an ordinary user and anonymous caller, and repeat the sponsor cases anonymously. Every authorized canary must reach its exact downstream validation error. Every unauthorized canary must stop at the execute grant or role guard. A unit test that manually injects only the legacy scalar claim is not release evidence.

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
5. Confirm the payment gateway event worker is authenticated, scheduled, bounded, and reporting fixed error codes only. A nonzero terminal-failure or unknown-settlement count must return 503 and emit `PAYMENT_GATEWAY_EVENT_WORKER_REQUIRES_ATTENTION` with aggregate counts only.
6. Confirm the sponsor welcome worker is authenticated, scheduled, bounded, and sends no plaintext recipient or claim material to database logs, application logs, or route responses. A nonzero terminal-failure, manual-review, or unknown-settlement count must return 503 and emit `SPONSOR_WELCOME_EMAIL_WORKER_REQUIRES_ATTENTION` with aggregate counts only.
7. Confirm the subscription cancellation worker is authenticated, scheduled every minute, bounded by its batch, concurrency, provider timeout, and invocation margin, and returns no provider subscription identifiers. A nonzero manual-review, claim-failure, or unknown-settlement count must return 503 and emit `SUBSCRIPTION_CANCELLATION_WORKER_REQUIRES_ATTENTION` with aggregate counts only.
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
30. Confirm the hourly retention worker calls checkout contact, welcome email contact, gateway payload, raw audit forensics, sponsor authentication evidence, and advocate tracking cleanup in that order. Confirm an expired recent-authentication receipt is removed by the next hourly run. Confirm passwordless delivery reservations, sponsor verification attempts, and advocate invitation authentication attempts remain through their complete 24 hour quota windows, then are removed by the next hourly run. Force the sponsor-authentication step to fail and confirm advocate tracking still runs, the route returns a non-success status, and the response exposes only safe run and request identifiers, status values, fixed step names, and aggregate counts.
31. Confirm Vercel Production has Auto-assign Custom Production Domains disabled. Set the Production value to the exact `ADVOCATE_PROVIDER_AUTOMATION_MODE=active`, then create a staged Production deployment from the reviewed revision with no domain assignment. Send an unscheduled `POST` with no body to that deployment's immutable generated URL at `/api/internal/advocates/release-preflight` with the exact `Authorization: Bearer <CRON_SECRET>` header. Confirm its response contains only fixed check names, categorical configuration states, and `providerReadiness: not_probed`, and require every check to be `configured`. Independently confirm the staged deployment ID and revision. Confirm the preflight makes no provider request, database claim, or service-client call. Retain only the response and never record the request header or secret. Promote that exact staged Production deployment without rebuilding, then verify the current deployment identity is unchanged. Do not substitute a Preview promotion because Vercel rebuilds it with Production variables. Recheck that an unauthenticated caller receives only the fixed unauthorized response when worker authentication is configured.
32. Follow [the advocate domain publication runbook](./advocate-domain-publication-runbook.md) for every new exact hostname. Provider readiness alone must stop in `verifying` and must not activate the domain.
33. Run the cross-subdomain attribution self-exclusion canary. Confirm authentication issues the parent-domain exclusion signal, an advocate-host exposure excludes staff and same-portal members through a fresh database check, explicit signout expires the signal, and the signal never authorizes a protected surface.
34. Run the advocate logo reconciliation canary through `/api/internal/advocates/logo-reconciliation` with its exact Bearer secret. Seed one unattached disposable logo reservation through the approved database test fixture, place only its exact object in `advocate-assets`, and confirm the first invocation reports one claimed and one deleted with no identifiers or paths. Replay after completion and confirm no second deletion. Repeat with the object already absent and confirm the job completes idempotently. Force one provider timeout and confirm the job records a durable retry while the route remains successful. Force one exhausted job, one invariant quarantine, and one database finalization failure, and confirm each returns 503 with only the request identifier and aggregate counts. Confirm the worker never deletes an attached logo, a pending reservation, the current branding path, a different reservation path, or more than its configured batch and concurrency. The one-minute production schedule is declared in `vercel.json`; do not promote that schedule until this canary passes and the release change is reviewed.
35. Issue one advocate invitation to a new account and one to an existing account. Confirm the invitation authority stores only the capability digest, the forced row security delivery outbox stores only encrypted recipient and capability envelopes, and neither administrator responses nor logs expose the capability, authentication proof, ciphertext, target user identifier, or provider identifier.
36. Open each email on a separate mobile browser. Confirm both secrets exist only after the URL fragment marker, the server never receives that fragment, the interstitial replaces browser history before parsing it, and no redemption request, storage write, analytics request, or Referer disclosure occurs before the recipient deliberately selects Continue.
37. Confirm invitation acceptance uses two responses. First, run the release preflight against the exact deployment and verify `ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1` is a canonical base64 value containing at least 32 random bytes and differs from every other declared secret. Exercise a quota denial through the exact canonical host and trusted Vercel ingress. Confirm it returns the generic retryable unavailable result, retains the in-tab invitation material, permits the exact retry, and makes no Supabase verification call. Confirm an allowed reservation retains only a 32 byte source HMAC, key version, and timestamp before provider verification. The first successful response verifies the exact email bound Supabase magic link, establishes the signed session through `Set-Cookie`, and makes no tenant mutation request. If the proof was already consumed by an ambiguous first response, retry requires a current signed session with a provider signed `magiclink` authentication method reference no older than 15 minutes. The second response proves that session user is the invitation target, requires the seven day 256 bit application capability and one stable version 4 operation UUID, then atomically consumes the invitation and writes the contact-free result receipt. Lose and corrupt the second response, then recover the exact initial-owner and delegate outcomes using only the same operation and active session. Force recovery to acquire the operation lock immediately before the in-flight redemption, confirm the first lookup reports no receipt without discarding the operation, then confirm an exact manual recheck returns the committed outcome. Confirm redemption and recovery propagate refreshed session cookies on success and classified database rejection. Present a recently refreshed access token with no fresh `magiclink` authentication method reference, a password session, and every supported non-magic-link OTP session. Each must fail even when its JWT issued-at time is recent. Revoke one pending invitation and expire another, then confirm both fail closed without disclosing which condition failed. Inspect the same-tab storage record and prove it contains only the canonical operation and version.
38. Complete FF-029 before release. Generate multiple Supabase email links for the same existing and new accounts, including two advocate invitations and an overlapping sponsor account link. Exercise both generation orders, concurrent generation, resend, first and second link consumption, and expiry. Record whether one proof supersedes another and adopt an explicit safe concurrency policy. Provider behavior without production equivalent evidence is a release blocker.
39. Replay one invitation issue after losing the first application response. Reuse the same administrator idempotency key and unchanged invitation inputs. Confirm the original invitation and outbox item are returned and no second email authority is created. Changing any issue input under the same key must fail closed.
40. Force the invitation SMTP server to accept the deterministic message ID and then terminate the connection before the application receives the response. Confirm the outbox remains quarantined after its lease expires and is never automatically claimed again. Alert on the aggregate `manualReview` or `settlementUnknown` result and follow the invitation ambiguity procedure below. The MVP has no general resolver for a stale invitation handoff, so never imply that authoritative evidence makes the quarantined row directly retryable.
41. Exercise `get_advocate_analytics_snapshot()` as an authorized analytics viewer, a branding-only delegate, a revoked and suspended member, a nonmember, and a member of another advocate. Confirm only the authorized same-tenant viewer receives a result. Confirm anonymous and service roles cannot execute it. Confirm no advocate role can read identity, attribution, exposure, payment, or financial facts, and authenticated subscription policies expose only the caller's own sponsor account rows rather than advocate analytics data.
42. Create payment-backed direct and post visit fixtures at the exact 1 day, 7 day, 30 day, and 365 day boundaries. Confirm the five timing bands are mutually exclusive, observed outcomes never enter official totals, renewals increase money but not sponsorship counts, and records finalized, occurred, or recorded on or after the complete UTC cutoff are absent.
43. Exercise one active monthly sponsorship, one active annual sponsorship, an expired paid period, a lifecycle change after the cutoff, and a settled cancellation before the cutoff. Confirm lifecycle state is reconstructed from applied event and cancellation evidence and that a verified paid period covers the cutoff. Monthly and annual periodic commitments must remain separate, while the annualized projection multiplies monthly commitments by twelve and leaves annual commitments unchanged.
44. Attempt small-cell reconstruction. Use five total contacts with only one renewal, refund, dispute, verified account, and active commitment contributor. Confirm each sensitive measure is null, complementary gross or net values are also null, and the response contains no hidden contributor count. Repeat across timing and currency cells and confirm family-wide suppression prevents subtraction from another cell.
45. Before the analytics migration, stage one historical direct sponsorship by Creator Share staff, one by a same-portal member, and one by an unrelated sponsor. Confirm the exclusive, null-first backfill classifies the first two with the fixed noncontact reasons, leaves the unrelated sponsor eligible, preserves factual attribution, restores its exact immutability trigger, and reports zero changes on replay. Then complete the same three cases through the live insert path. Change membership afterward and confirm historical eligibility does not change. If an environment has hard-deleted historical role or membership evidence, stop for an explicit reconciliation decision.
46. Inspect the database response, rendered page, logs, errors, and browser payload. Confirm they contain no email, contact digest, sponsor identity, authenticated user identifier, visitor, exposure, intent, beneficiary, provider object, exact event time, contributor support count, or suppressed raw value.
47. Invoke the public metric release worker twice for the same weekly cutoff and overlap two invocations. Confirm only one append only release may exist per advocate, metric, and cutoff, replay creates no duplicate, and the response contains only the fixed aggregate contract.
48. Stage four eligible contacts for each public metric and confirm every metric remains pending. Add a fifth contact after the current release cutoff and confirm no value advances. Move the server-derived weekly cutoff past the seven day embargo, then confirm count values advance only to a multiple of five and gross funds advance only to a multiple of 100 USD.
49. Add one through four contacts after an existing public release and cross a raw count or money bucket. Confirm the visible value and cutoff do not move. Add the fifth contributing contact and confirm only the rounded lower bound and weekly cutoff advance. Repeat with a large single payment and confirm it cannot advance gross funds without five contributing contacts.
50. Exercise standard, blind assigned, blind unassigned, and partnership sponsorships. Confirm children supported uses distinct immutable standard beneficiaries and blind assignment rows dated before the cutoff, excludes unassigned blind and partnership rows, and counts one beneficiary once. Confirm renewals advance gross funds but not sponsorship or child counts.
51. Select, reorder, hide, and restore each approved public metric. Confirm selection changes require exact tenant permission, optimistic versioning, a server-owned actor and request identifier, and a reason. Confirm selection never invokes a release, never resets a release cutoff, and never reveals why a pending value is unavailable. Attempt every private enum value and confirm the database rejects it.
52. Scrape successive public snapshots across several days and two weekly cutoffs. Confirm the page exposes only four approved keys, rounded lower bounds, generic pending state, and released cutoffs. Confirm active sponsorships, net funds, verified accounts, normalized contacts, observed attribution, support counts, raw candidates, release IDs, and private facts never enter HTML, serialized browser state, responses, logs, or errors.

The generic SMTP paths for sponsor welcome and advocate invitation mail quarantine every provider acceptance ambiguity before a stale lease can retry it. They do not provide exact once delivery. A deterministic message ID supports operator investigation, but it is not an idempotency guarantee. Never describe either worker or its canaries as exact once.

### Advocate invitation SMTP ambiguity procedure

1. Escalate every nonzero invitation `manualReview` or `settlementUnknown` count to the release owner. Do not place the recipient, capability, authentication proof, ciphertext, or target account identifier in the incident record.
2. An authorized database operator identifies the quarantined outbox item through protected operational access and derives its deterministic provider message ID. The ordinary advocate interface and worker response intentionally expose neither value.
3. Search the SMTP provider for the exact deterministic message ID. If provider evidence proves acceptance, leave the invitation authority available and the outbox quarantined. The recipient may redeem the message already accepted by the provider.
4. If provider evidence proves nonacceptance, revoke the original invitation through the existing reason-required administrator boundary. Then issue a fresh invitation with a new idempotency key. Never reuse the quarantined authority or its email proof.
5. If provider evidence is absent or inconclusive, leave the invitation and outbox quarantined. Do not send another invitation. Uncertainty is not evidence of nonacceptance.
6. Retain the provider evidence, revocation audit event when applicable, and incident reference. FF-031 must replace protected database investigation with a dedicated service-scoped, audited resolution workflow before this becomes routine support work.

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
- Cross-subdomain attribution self-exclusion canary with redacted issuance, staff exclusion, same-portal member exclusion, explicit signout, and authorization nonuse results.
- Hourly retention worker result, durable run evidence, partial-failure and backlog alert paths, and evidence that all six privacy cleanup steps remain scheduled, including the recent-authentication receipt, passwordless delivery reservation, and verification-attempt deletion bounds.
- Hosted Supabase Confirm signup and Magic Link template checksums, exact redirect allowlist, confirmation setting, disabled link-tracking evidence, and a scanner GET result showing zero verification calls.
- Passwordless secret and HMAC-context separation, public and protected delivery capacity results, exact verification-attempt boundaries, uniform public responses, and proof that no raw email, IP, or token material is stored.
- Stripe US and UK Billing Portal configuration IDs in a protected operator record, the aggregate subscription override inventory, runtime override rejection evidence, and Stripe US, Stripe UK, and PayPal management canary results.
- Advocate domain protected canary report, digest, audited publication result, and post-publication exact-host verification.
- Advocate logo reconciliation canary with redacted batch counts, retry evidence, exhausted and quarantine alert evidence, exact path nondeletion controls, and confirmation that no object path, job identifier, lease token, or provider body appeared in logs or responses.
- Advocate analytics persona, exact timing boundary, late-record exclusion, lifecycle reconstruction, self-exclusion, per-measure suppression, complementary reconstruction, currency-family suppression, and response redaction evidence.
- Public metric weekly worker evidence, overlap and replay result, five-contact delta gates, seven day embargo, bucket advancement tests, approved selection enforcement, and browser payload redaction evidence.
- PostgREST role boundary evidence for both service key formats, a real authenticated user, anonymous and ordinary-user deny controls, and the exact downstream validation reached by every authorized canary.
- Advocate audit disclosure evidence for exact business event mapping, near match exclusion, append only enforcement, no historical backfill, tenant cursor isolation, fixed page size, permission personas, actor label fallback, and browser payload redaction.
- Rollback owner and incident contact.

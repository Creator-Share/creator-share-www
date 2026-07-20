# Advocate Domain Publication Runbook

This runbook controls the transition from automated provider readiness to a publicly available advocate portal. Provider provisioning remains fully automated after an explicit environment activation. Missing, malformed, and explicit disabled automation mode all stop before database claims, service clients, provider adapters, or network traffic. Public activation is a separate, audited release decision because a successful Cloudflare, Vercel, Stripe, or PayPal API response does not prove that the exact public hostname serves the intended tenant or can safely initiate checkout.

## Production prerequisites

Do not enable advocate publication until all of these surfaces are deployed and validated together:

- Atomic provisioning start for the exact primary hostname and exactly five required integrations.
- An authenticated Creator Share onboarding surface that creates or resumes an email-first initial-owner invitation without exposing contact or provider material.
- A two-response invitation acceptance surface that establishes the signed session before tenant mutation, binds redemption to one stable operation UUID, and recovers a committed initial-owner or delegate result without the capability.
- A Creator Share portal detail surface that shows sanitized provisioning progress, terminal repair eligibility, and publication eligibility.
- Scheduled provisioning reconciliation and the fail-closed active drift transition.
- The authenticated, provider-free release preflight and exact `ADVOCATE_PROVIDER_AUTOMATION_MODE=active` production activation. Preview, test, and local environments remain disabled unless a separately approved canary explicitly requires provider work.
- Protected exact-host challenge, report canonicalization, and safe live payment canaries.
- The reserved `publication-sentinel` label and automated shared Cloudflare and Vercel negative-control reconciliation.
- The authenticated publication start and poll route plus a client that preserves and recovers its exact operation identity across timeouts and page reloads.
- The one-minute internal publication recovery cron.
- Durable database execution leases and immutable report completion.
- Post-publication drift canaries, alerts, and named operator ownership.

The presence of a publication function or a provider `ready` status is not production readiness. The release gate is the complete asynchronous flow described below.

## Lifecycle contract

The domain lifecycle is deliberately asymmetric:

1. Portal onboarding atomically reserves the slug, creates the inactive ownerless advocate foundation, and issues one single-use initial-owner invitation. No provider work begins for an unaccepted invitation.
2. Exact initial-owner redemption creates the sole Owner membership, activates the relationship, derives its primary domain, creates exactly five required provider integrations, enqueues idempotent provisioning work, and writes one immutable contact-free redemption receipt in one transaction.
3. An authenticated worker invocation returns the fixed `automation_disabled` result until the exact environment mode is active. Once active, the provisioner reconciles Cloudflare DNS, Vercel attachment, Stripe US live access, Stripe UK live access, and PayPal live access.
4. Each successful provider reconciliation stores a bounded evidence digest and advances the integration to `ready`.
5. A domain with exactly the five required ready integrations advances only to `verifying`.
6. A Creator Share super administrator sends an authenticated publication request with the expected portal version, one stable operation ID, and an audit reason.
7. The request creates or polls one immutable canary start and returns `202 Accepted` while work is pending. An `after()` callback attempts low-latency execution after the response.
8. A one-minute internal cron recovers starts that were not completed by the callback. A durable database fencing lease allows only one current runner to complete a run.
9. The runner exercises the exact hostname and deployment, then stores one immutable succeeded or failed report. It cannot publish the portal.
10. A later authenticated poll by a currently authorized Creator Share super administrator observes the succeeded report and invokes the publication boundary.
11. The database reauthorizes the administrator and atomically activates the exact primary domain and advocate portal.

No `after()` callback, cron invocation, provider worker, service role client, or ordinary advocate administrator may activate a portal. A succeeded report remains nonpublic until an authenticated poll completes publication. A domain in `verifying` remains unavailable to ordinary public browsing and checkout.

## Creator Share administrative control boundary

Domain, ownership, and tenant lifecycle changes require Creator Share approval. The browser boundary accepts these decisions only from a currently authorized Creator Share super administrator with a verified, active email account. Publication, lifecycle actions, and cleanup recovery bind the reviewed advocate version. Ownership transfer instead binds the expected current owner membership and an eligible target membership. Every mutation also requires a stable operation ID and reason, then writes an append-only exact replay receipt. Each high risk database function derives the signed authentication session from the verified Supabase JWT. The browser cannot supply or override session identity. Advocate owners and delegates cannot directly transfer ownership, publish, suspend, resume, repair, archive, or recover provider cleanup. A tenant-initiated ownership transfer request and approval workflow is deferred to FF-036.

Every Creator Share control route requires exact primary-host same-origin JSON before authentication, then reauthorizes the healthy super administrator. It accepts bounded route forensics only after the semantic command is valid. The database derives the signed session identity and binds optimistic versions, stable operation IDs, and reasons. Responses expose only sanitized aggregate state and fixed outcome codes. They never expose recipient contact, provider object identifiers, job identifiers, provider payloads, credentials, or encrypted delivery material.

Suspension and archive are intentionally different decisions. Suspension immediately disables public tenant resolution and provider reconciliation without deleting provider attachments. It is reversible through an audited resume or repair action. Archive also disables tenant resolution immediately, but it is irreversible and begins the controlled provider cleanup described below. Neither action deletes attribution, sponsorship, financial, membership, or audit history, and neither releases the slug for reuse.

Lifecycle and ownership transitions write both the private row audit and append-only semantic decision receipts. Exceptional transitions, including repair from an active publication back into provisioning, require a private mutation guard bound to the current database transaction and exact advocate. Runtime callers cannot forge the guard through a session setting or a browser request. Direct row edits and service role shortcuts are not supported recovery procedures.

The browser control routes capture bounded, sanitized client IP and user agent metadata solely in `audit.audit_event_forensics`. Transport metadata is not part of exact replay equality. These fields never appear in semantic decision receipts, advocate delegate history, public responses, or ordinary administrative response bodies. The retention worker removes them after 90 days. Redacted business audit history and semantic decision receipts remain append-only and are retained indefinitely.

## Required provider topology

Publication requires exactly these required integration tuples for the primary domain:

| Provider   | Environment  | Readiness evidence                                                                    |
| ---------- | ------------ | ------------------------------------------------------------------------------------- |
| Cloudflare | `production` | Exact DNS only CNAME record observed through the provider API                         |
| Vercel     | `production` | Exact verified project domain with no redirect, branch, or custom environment binding |
| Stripe US  | `live`       | Expected live account scope is authenticated                                          |
| Stripe UK  | `live`       | Expected live account scope is authenticated                                          |
| PayPal     | `live`       | Expected live API origin and credentials are authenticated                            |

Every tuple must reference a succeeded `provision` or `reconcile` job with a 32 byte evidence digest observed within the 30 minute publication window. Any extra required tuple, missing tuple, nonready tuple, stale tuple, or queued or running job blocks publication.

Provider readiness is necessary, but it is not sufficient. It proves control plane access. It does not prove public DNS propagation, TLS, tenant selection, deployment identity, return URL construction, or provider checkout object creation through the exact host.

## Negative-control topology

The publication proof uses two different negative controls because DNS absence and safe application rejection prove different claims.

First, the runner generates a high-entropy sibling beneath `creatorshare.com`. It proves that no exact advocate domain row or reserved-label row exists before making any network observation. It then queries CNAME, A, AAAA, HTTPS, and SVCB independently. HTTPS and SVCB use authenticated exact-type DNS over HTTPS queries because the Node resolver does not expose those record types. Every query must either return zero records or reject with an exact DNS absence result. A timeout, truncation, `SERVFAIL`, `REFUSED`, malformed response, record answer, or arbitrary resolver exception is inconclusive and fails the `unprovisioned_sibling_dns_absent` step. The successful evidence contains only the hostname, `unprovisioned: true`, `resolved: false`, empty record types, zero answers, and the observation time. The runner never attempts TLS or HTTP against this intentionally absent hostname.

Second, `publication-sentinel.creatorshare.com` is persistent shared negative-control infrastructure. Its label is migration owned and cannot be assigned to an advocate. A dedicated one-minute worker uses the existing exact Cloudflare and Vercel adapters to reconcile one DNS-only CNAME and one exact project-domain attachment. Reconciliation always performs provider lookup before mutation, uses deterministic synthetic integration ownership identities, and rechecks after any create race. Ordinary provider, DNS, certificate, and network propagation is recorded as `converging`, not as a terminal tenant canary failure. The tenant canary worker runs the same bounded preflight before claiming work, so a canary cannot begin until the shared sentinel is ready. Tenant archive and deprovisioning never remove this shared sentinel.

After the canary is claimed, the terminal runner independently inspects provider state without mutation, resolves the sentinel again, pins only addresses from that sentinel observation, performs normal certificate and hostname verification, and makes a fresh pinned HTTPS root request. The sentinel must return the same bounded byte-identical neutral 404 as the still-verifying tenant root. Tenant, sentinel, and sibling checks never reuse another hostname's DNS observation or pinned-address set. Separate Vercel hostnames may legitimately resolve to the same public anycast address. The `negative_sentinel_hidden` report evidence contains only safe provider readiness booleans, DNS target match, TLS verification facts, bounded 404 facts and digest, equality with the tenant root, hostname, and observation time. It never contains provider identifiers, raw response bodies, credentials, or tokens.

Each scheduled reconciliation writes one atomic append-only audit record. It contains a one-way request reference, ordered fixed stage codes, and the terminal `ready`, `converging`, or `failed` outcome. Application roles have no direct table access. Provider identifiers, hostnames, responses, raw errors, payloads, tokens, and credentials are structurally absent from this evidence schema.

Both negative-control steps retain the database-compatible terminal code `unprovisioned_sibling_not_hidden`. The exact failed report step distinguishes DNS absence failure from sentinel readiness, TLS, or HTTP failure.

## Asynchronous publication operation

The authenticated publication `POST` is both the start endpoint and the poll endpoint. The caller must keep the same browser generated v4 operation ID, expected advocate version, and administrator reason for every retry and poll. The database stores that exact operation ID as the immutable canary start request identity. Deployment identity, source revision, administrator identity, and session identity are bindings on that operation, not ingredients that may silently produce another operation.

On the first valid request, the server locks one canary start to the exact advocate, primary domain, hostname, deployment, source revision, and current five-provider evidence chain. It returns `202 Accepted` while the report is pending. The response includes the stable operation and run identifiers plus a retry interval. Returning promptly is required because the Creator Share administrative API is normally behind Cloudflare. A synchronous canary can take roughly 140 seconds in the worst case, while Cloudflare's default Proxy Read Timeout is 120 seconds.

After sending the response, Next.js `after()` attempts the run for low latency. It is an optimization, not a durable queue. A separate Vercel cron calls the internal publication worker once per minute to recover abandoned work. Both paths use the same claim boundary. A durable database lease issues a unique fencing token to one runner. An active lease prevents a second owner from running the same start. An expired lease may be reclaimed with a new token, and the stale owner cannot complete after reclamation.

The worker can only append a terminal report. It cannot publish. A later authenticated `POST` with the same operation inputs reads the immutable report through an authenticated database boundary. Every poll requires a currently healthy Creator Share super administrator and an active signed authentication session. The polling administrator may differ from the initiating administrator. A failed report returns a terminal failure for that operation. For a succeeded report, the trusted application server first uses its service credential to mint a database generated capability that lasts no more than 60 seconds and is bound to the exact operation, run, stored deployment, stored source revision, and report digest. The capability never enters the browser, public response, or permanent audit receipt. The authenticated publication transaction independently requires the current administrator and signed session, atomically consumes the capability, and rechecks portal version, domain state, evidence freshness, provider topology, and report binding before activation. The service credential or capability cannot publish alone, and an administrator cannot publish without the current server capability. Once publication commits, an exact authenticated replay returns the immutable approval receipt before inspecting later mutable portal state and does not mint another capability.

Vercel Cron does not retry a failed invocation and may occasionally deliver overlapping or duplicate invocations. The one-minute cadence and database lease are therefore both required. Neither `after()` nor cron is publication authority.

## Creator Share operator workflow

1. Open the authenticated Advocate portals administration surface and choose Create portal.
2. Enter the canonical lowercase slug, display name, advocate type, initial owner email, and a specific administrative reason. The client creates one stable operation ID and reuses it for every ambiguous retry.
3. Confirm the result shows an invited, draft portal with a reserved hostname and pending initial-owner delivery, but no provider topology or provider work.
4. If delivery fails terminally, correct the external cause and use the audited reissue control. If a sent or ambiguous owner link must be invalidated, use the separate audited revocation control first, observe the new tenant version, then reissue. Never duplicate live authority, create a second tenant, or release the slug to work around delivery state.
5. After the owner accepts, confirm the portal shows one active owner and exactly five required provisioning tracks. The browser receives only aggregate readiness and fixed states.
6. For initial production activation or any later application release, confirm Vercel Production has Auto-assign Custom Production Domains disabled. Set the Production environment value to the exact `ADVOCATE_PROVIDER_AUTOMATION_MODE=active`, then create a staged Production deployment from the reviewed revision with no domain assignment. A Preview promotion is not equivalent because Vercel rebuilds it with Production variables.
7. Send an unscheduled `POST` with no body to the staged deployment's immutable generated URL at `/api/internal/advocates/release-preflight` with the exact `Authorization: Bearer <CRON_SECRET>` header. Retain only its fixed categorical result. Never record the request header or secret. Require every check, including `deployment_identity` and `provider_automation_gate`, to be `configured`. Independently inspect the staged deployment metadata and confirm its deployment ID and revision belong to the reviewed build.
8. Promote that exact staged Production deployment. Promotion must assign domains without rebuilding. Confirm the current deployment ID and revision remain identical to the preflight target, then confirm an authenticated worker no longer returns `automation_disabled`. A subsequent advocate portal uses this already validated active deployment and does not repeat platform activation.
9. Allow automated reconciliation to reach a verifying domain. Use Repair only when the server derives it as eligible. The browser never chooses a provider, integration, or job.
10. Enter the publication reason once and start publication. The client stores the nonsecret operation ID, advocate ID, expected version, exact reason, and optional server bound run ID in same-tab session storage before sending the request. It must write, read, strictly parse, and compare that record before the first request.
11. Poll the same authenticated endpoint using byte-equivalent semantic inputs and the server retry interval. On timeout or reload, recover the stored operation and resume polling before offering a new operation.
12. Treat `202 Accepted` as pending, a succeeded response as published, and a terminal failed, expired, or deployment changed response as requiring review and explicit acknowledgment before a new operation. Never silently replace an operation after an ambiguous response.
13. Complete the post-publication verification below and retain the sanitized release evidence.

The client clears a published operation only after an exact success response and verified storage removal. It retains failed, expired, and deployment changed results until explicit operator acknowledgment. If storage cleanup fails after publication, the client keeps the saved operation and blocks another start. A reload, route transition, tab backgrounding, lost response, authentication loss, or Cloudflare timeout must not cause a second publication start. The server remains authoritative if browser state is missing or malformed and exact replay remains safe.

## Production platform configuration

Use Vercel Pro or Enterprise for production. This release does not support Hobby because the recovery contract requires a once-per-minute cron. Configure the authenticated publication route and internal publication worker for a 300 second maximum function duration. Confirm that the deployed project and its Fluid Compute setting honor that value.

In Vercel Project Settings, under Environment Variables, enable Automatically expose System Environment Variables. Confirm that both `VERCEL_DEPLOYMENT_ID` and `VERCEL_GIT_COMMIT_SHA` are present at runtime. Publication starts and reports bind to these values so an old deployment cannot supply evidence for a new release. Environment changes apply only to new Vercel deployments. Permanently disable Auto-assign Custom Production Domains so every Production build can be validated at its immutable generated URL before it receives production traffic.

Keep `ADVOCATE_PROVIDER_AUTOMATION_MODE=disabled` in Preview, test, and local environments. Before initial activation, keep the Production value disabled as well. Normal active releases set the Production value to `active`, create a staged Production deployment, pass preflight on that exact build, and promote the same build without a rebuild. The preflight intentionally reports the provider gate invalid for a disabled deployment, so disabled evidence cannot authorize an active release. The gate covers provisioning, publication canaries, the publication sentinel, and archived-domain lifecycle coordination. The lifecycle coordinator is included because it locks archived tenants and enqueues destructive provider cleanup. The authenticated release preflight performs only local configuration parsing. It never calls a provider, opens a database client, or claims work. Its response contains fixed check names and only categorical states, with provider readiness explicitly reported as `not_probed`. A successful preflight does not authorize provider traffic by itself.

For a normal rollback, reassign the production domains to the previously verified Production deployment and confirm its recorded deployment identity. To stop provider automation during an incident, first set the Production value to `disabled`, create a staged Production deployment, verify authenticated workers return the fixed `automation_disabled` result, and promote that exact build under incident approval. Changing a Vercel environment variable alone does not change the running deployment.

Cloudflare remains authoritative DNS for the MVP. Each advocate hostname must have one exact CNAME whose content equals the project-specific `ADVOCATE_CLOUDFLARE_CNAME_TARGET`. The record must be DNS only, represented as `proxied: false` through the Cloudflare API. The configured target must match Vercel's project-specific `<hash>.vercel-dns-<number>.com` form. Do not substitute the legacy generic Vercel target. The provider-free preflight validates only this format. The publication sentinel and tenant canary must still prove that the exact target belongs to the configured Vercel project before publication. The same hostname must also be verified on the configured Vercel project with no redirect, Git branch, or custom environment binding before it can become ready.

Required server secrets and protected identifiers are:

- Provider automation: `ADVOCATE_PROVIDER_AUTOMATION_MODE`, with only the exact values `disabled` and `active`. Missing or malformed configuration fails closed as disabled. No browser, public request, or tenant setting may override it.
- Supabase: `NEXT_SERVICE_ROLE_KEY`, plus the configured Supabase URL and anonymous key. The preflight accepts the current `sb_secret_` and `sb_publishable_` formats or legacy JWT keys only when their embedded roles are exactly `service_role` and `anon`. It rejects swapped roles before a privileged key can be inlined into the browser bundle.
- Supabase invitation redirect allowlist: the exact `https://creatorshare.com/advocate-invitation` target. Do not permit a wildcard host, wildcard path, `www` alias, Vercel alias, or advocate subdomain.
- Invitation authentication capacity: `ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1`, a dedicated canonical base64 value containing at least 32 random bytes. It must be unique to the environment and distinct from every sponsor, sponsorship, visitor, attribution, worker, and provider secret. Advance its numbered key and database key version together during planned rotation while retaining the prior 24 hour quota evidence.
- Publication execution: `CRON_SECRET` and `ADVOCATE_PUBLICATION_CANARY_SECRET_V1`. The challenge secret must be the canonical base64 encoding of exactly 32 random bytes and must be unique to the environment.
- Cloudflare: `ADVOCATE_CLOUDFLARE_API_TOKEN`, `ADVOCATE_CLOUDFLARE_ZONE_ID`, and `ADVOCATE_CLOUDFLARE_CNAME_TARGET`.
- Vercel: `ADVOCATE_VERCEL_API_TOKEN`, `ADVOCATE_VERCEL_PROJECT_ID`, and `ADVOCATE_VERCEL_TEAM_ID` when the project belongs to a team.
- Stripe US and UK: each account's secret key, publishable key, webhook secret, dedicated live recurring publication canary Price ID, and public portal link. Each portal link must use HTTPS with no credentials, custom port, query, or fragment and an approved `billing.stripe.com` or `stripe.creatorshare.com` host.
- PayPal: the live client ID, client secret, webhook ID, and dedicated live recurring publication canary Plan ID. In production, leave `PAYPAL_API_URL` unset or set it exactly to `https://api-m.paypal.com`.

Vercel sends `CRON_SECRET` as a bearer token to the internal cron route. Store every secret only in the intended Vercel environment. Release evidence may record that a variable is configured, but never its value.

## Protected canary report

The canary runner must execute after the latest provider readiness timestamp and against the exact production hostname. It must not temporarily publish the tenant. Use a short lived, single-purpose server challenge that can resolve only the expected `verifying` domain through the protected canary route. Ordinary requests to the same hostname must continue to receive the neutral default-deny response.

The report must include:

- Report schema version.
- Advocate ID, primary domain ID, exact lowercase hostname, and expected advocate version.
- Deployment ID and source revision.
- Canary start and completion timestamps in UTC.
- The exact DNS only CNAME target, independently resolved public A and AAAA answers, and the expected Vercel target.
- TLS certificate hostname coverage, validity window, and normal chain verification.
- Exact-host protected tenant response, including the expected advocate ID and deployment ID.
- Ordinary public response proving the verifying tenant remains unpublished.
- A generated unprovisioned sibling and strict CNAME, A, AAAA, HTTPS, and SVCB absence evidence.
- The fixed reserved negative sentinel, independently resolved and pinned, with automated Cloudflare and Vercel readiness plus a byte-identical neutral 404.
- Stripe US, Stripe UK, and PayPal checkout initiation results.
- Sanitized provider object references required for later operator investigation.
- A pass or fail result for every check and one overall result.

The checkout canaries must use the production provider accounts without collecting money:

- Stripe US and Stripe UK each create one live Checkout Session in subscription mode with the dedicated recurring canary Price and exact advocate success and cancel URLs. Verify `livemode: true`, unpaid state, no created subscription, and an open or expired session. If it is open, expire it immediately. Use stable idempotency keys derived from the server-issued attempt identity for both creation and expiration. Never expose the Checkout URL.
- PayPal creates one live recurring Subscription with a stable `PayPal-Request-Id`, a server-issued custom ID, no subscriber, and the exact advocate return and cancel URLs. Verify `APPROVAL_PENDING`, validate the approval destination, and then discard it. Never expose or approve the URL.

Report payment checks with the exact step names `stripe_us_payment_canary`, `stripe_uk_payment_canary`, and `paypal_payment_canary`. The Stripe evidence status is `checkout_session_expired_unpaid`. The PayPal evidence status is `subscription_approval_pending`. Record `financial_charge_attempted`, `provider_capture_attempted`, `sponsorship_state_created`, and `webhook_delivery_verified` as explicit `false` values. Do not collapse those facts into one ambiguous `payments_ready` result.

The report must contain no sponsor contact, provider secret, bearer token, checkout contact envelope, approval URL, or full provider response. Store the exact canonical UTF8 report bytes and their SHA256 digest in the protected append-only audit schema. The publication boundary also computes a binding digest over the report and ordered provider evidence. Release evidence may contain the sanitized report and provider object references needed for investigation.

## Publication approval

The initiating and approving callers must each be a currently authenticated Creator Share super administrator with a verified, active email account and an active signed authentication session. They may be different administrators. The immutable start records the initiating user and session. The immutable approval records the actual approving user and session. Read the current advocate version immediately before the first request. Generate one operation ID and keep the exact request inputs stable while polling.

The first request normally returns `202 Accepted`. The client should wait for the returned retry interval and poll the same authenticated endpoint. A pending response is not a failure. Only a later authenticated poll can invoke publication after observing a succeeded immutable report.

The database publication boundary fails closed unless:

- The caller still holds the global `SUPER_ADMIN` assignment throughout the transaction.
- The first publication consumes one unexpired, single-use server capability bound to the exact operation, run, deployment, source revision, and report digest.
- The advocate relationship is active and its version exactly matches the reviewed version.
- The report's domain is the exact primary domain for that advocate.
- The domain remains in `verifying`.
- The start and report are bound to the current deployment identity and source revision.
- The canary completed no more than 30 minutes ago and no earlier than the latest provider readiness evidence.
- Exactly the five required provider tuples are ready with succeeded evidence-bearing jobs.
- No provisioning job for the advocate is queued or running.
- The hostname, report digest, deployment, operation, request, trace, and reason bindings remain valid.

The function records immutable audit metadata, including the report digest, canary completion time, deployment ID, exact hostname, approving administrator and signed session, and the database-computed publication binding. Bounded client IP and user agent enter only the expiring private forensic layer. They do not enter the permanent semantic start or approval receipts. The function then activates the domain and advocate in one transaction. A replay of the same successful poll returns the recorded approval without reusing the canary for another publication, even if later authorized work changes the current portal version or state.

For the MVP, service-role-only report completion plus the authenticated super administrator poll establishes provenance and approval. FF-025 tracks a later signed, single-use runner attestation without transferring publication authority to automation.

## Retry, reclaim, and operator failure handling

- If the client receives `202 Accepted`, follow the retry interval and poll with the same operation ID, expected version, and reason.
- If the client sees a timeout, a Cloudflare `524`, or an ambiguous connection failure, poll the same operation before creating another one. The server may have committed the start or publication despite losing the response.
- `after()` and cron may race. The database lease chooses the owner. A worker that cannot acquire the lease exits without running provider canaries.
- If a worker stops before appending a report, the active lease temporarily blocks another owner. After lease expiry, cron may reclaim the same start with a new fencing token. Completion from the stale token is rejected.
- Provider creation retries reuse the server-issued attempt identity and provider idempotency key. Stripe creation and expiration calls are safe to replay with the same keys. PayPal creation reuses the same `PayPal-Request-Id`.
- A failed report is immutable and terminal for its operation. Fix the reported stage, confirm that any open Stripe canary Session is expired, never approve a PayPal canary, and begin a fresh operation.
- An incomplete start stops accepting new worker claims when fewer than 300 seconds remain in its 30 minute evidence window, but the original operation remains pending because a final active lease may still complete. A different operation ID for the same portal version is accepted only after the original 30 minute window ends, preventing overlap with that final lease. At that point the old operation reports expired and the administrator may start a new one.
- A succeeded report remains nonpublic until an authenticated poll. Poll promptly because evidence expires after 30 minutes and any portal, provider, domain, or deployment change can invalidate the binding.
- A pending start bound to an older deployment cannot be claimed by a newer deployment. Keep polling the original operation because an older active worker may still commit its report. If that report succeeds after the deployment changes, the original operation returns the terminal deployment changed result and cannot publish the newer release. No second operation for the same portal version may begin until the original 30 minute evidence window ends.
- Never edit lifecycle, lease, start, report, or approval rows directly. Never call the publication function manually with a service role. Repair the failed stage and use the authenticated workflow.

## Post-publication verification

Immediately after approval:

1. Load the public root from the exact advocate hostname and confirm the expected logo, colors, opening header, and eligible child catalog.
2. Load one deep child route and confirm every internal browse, sponsorship, success, cancel, and account link stays on the exact advocate hostname where intended.
3. Initiate one production-safe operator checkout canary for every supported provider and region. Do not complete payment unless the release plan explicitly includes a live transaction.
4. Confirm the primary Creator Share hostname remains primary, a random unprovisioned sibling has no DNS records, and the fixed negative sentinel still serves the neutral 404.
5. Confirm the publication audit events contain the expected actor, portal, domain, deployment, request, trace, reason, report digest, and binding digest.
6. Attach the canary report, database result, build identity, and post-publication observations to the release record.

If any post-publication check fails, suspend public tenant resolution before investigating provider state. Do not edit lifecycle columns directly.

## Reconciliation and drift

The scheduled provisioner processes queued jobs every minute. The publication recovery cron is a separate worker with a separate database claim boundary. It may complete a pending report, but it must never publish. A separate reconciliation scheduler periodically enqueues one idempotent reconcile job per required integration that is due for observation. A provider status regression must never be treated as a successful publication decision.

## Initial owner authority concurrency gate

Run `yarn test:advocate:initial-owner-concurrency` against a freshly started, loopback-only local Supabase stack before production activation of email-first advocate onboarding. The harness uses independent authenticated, service-role, and worker PostgreSQL sessions and server-observed blocking evidence. It exercises 11 scenarios and 16 deterministic interleavings across invitation email claim versus revocation, delivery start versus revocation, redemption versus reissue or archive, competing operation identities, exact replay, and same-operation redemption versus recovery. Exact reissue replay must preserve only the first capability material, reject the competing material, redeem the winning capability, and produce the precise five-provider production integration and job topology. CI writes the separate sanitized artifact named by `ADVOCATE_INITIAL_OWNER_CONCURRENCY_EVIDENCE_PATH`.

The invariant is not that only one transaction may ever commit. A claim or delivery start can commit before a later revocation, and a provider handoff already in progress can still deliver a cryptographically dead link. After all contenders settle, there must be zero or one final redeemable authority, never multiple. Every invalidated invitation must leave zero live local authority, membership, or provisioning topology, and every database contender that loses before commit must leave no success receipt or replay residue. A dead delivered link must fail closed without creating an owner or starting provider work.

## Invitation acceptance and lost-response recovery

Invitation acceptance uses two same-origin JSON responses. The email link carries the Supabase proof and the 256 bit application capability in the URL fragment. The no-store interstitial removes the fragment from browser history before parsing it and waits for explicit user activation. The first response accepts only a strict successful `verifyOtp` result whose returned session and user identifiers agree, returns the Supabase session cookies, and performs no tenant mutation. It does not add a redundant user lookup after that fresh provider response. Provider throttling, network failure, unknown provider errors, fallback session failures, and malformed provider success data remain retryable. Any queued session cookie is copied to that retryable response so a consumed proof can recover through the newly established session. Only the exact provider expired-proof outcome without a usable fresh session is deterministic. If the proof was already consumed by an ambiguous first response, retry requires a current signed session with a `magiclink` authentication method reference no more than 15 minutes old. The later redemption still proves that the session user is the invitation target before any tenant mutation.

Before calling Supabase proof verification, the authentication response reserves capacity through a service-role-only database function. The application trusts one syntactically valid `x-vercel-forwarded-for` address only when Vercel declares the runtime. Every other source becomes one fixed unavailable-source signal. The database stores only a purpose-separated 32 byte HMAC, key version, and timestamp under forced row security with no runtime table grants. One transaction lock enforces 20 attempts per source per 10 minutes, 100 per source per 24 hours, 300 globally per hour, and 1,500 globally per 24 hours. Scheduled retention removes rows after the complete 24 hour quota horizon even when authentication traffic is quiet. Quota denial, configuration failure, database failure, timeout, and response-shape failure return the same generic retryable unavailable response before provider verification. The browser retains the invitation material and permits an exact retry.

Before the second response, the browser creates a version 4 operation UUID and proves that it can write and read the exact canonical `{operationId, version: 1}` record from same-tab session storage. It stores no capability, email proof, contact, session value, tenant identifier, or result in localStorage or sessionStorage. Redemption requires the active signed session, exact application capability, and that operation. The database validates a confirmed, nonanonymous, nondeleted, nonbanned account plus its current active signed session. Initial-owner and browser delegate redemption write one immutable contact-free receipt in the same transaction as the membership result. The receipt table has forced row security, no application table grants, append-only guards, and foreign keys to the committed tenant, invitation, membership, and, for an initial owner, provisioning start.

An exact successful response clears the secrets and operation, then opens the portal. Any network exception, lost response, malformed response, or malformed success is ambiguous. The browser keeps the operation and calls recovery with only that operation and version. Recovery returns the exact receipt only to its initiating healthy user with a current active signed session. A missing operation and another user's operation produce the same unavailable result. A missing receipt is provisional because recovery can acquire the operation lock immediately before an already in-flight redemption. The browser therefore keeps the operation and enables an exact manual recheck. Authentication loss also retains the operation, offers sign-in in another tab, and then retries recovery. Exact deterministic redemption request, conflict, or invalid-invitation failures clear the operation. The client resolves a stored operation before it considers material from a reopened invitation link, so a second link cannot replace an ambiguous first operation.

The authentication response must carry the newly established Supabase cookies. Redemption and recovery must also copy any Supabase refresh cookies onto successful and classified failure responses. Losing a refresh cookie can turn an exact database receipt into a support incident disguised as philosophy, which is an expensive genre.

The database migration and matching routes are a coordinated cutover. The new application cannot call the old redemption signature, and an old initial-owner caller cannot satisfy the new operation requirement. For this first release, apply the migration before enabling invitation delivery, promote the matching build, validate the deployed flow, and only then send invitation links. Legacy delegate callers may temporarily omit an operation, but every browser delegate acceptance must use the receipt path. Before any future one-sided rollout, add an explicit compatibility or maintenance gate.

FF-042 remains `in_progress` until all required evidence is retained. Automated evidence must cover exact request parsing, same-origin and no-store controls, source and global authentication quotas, quiet-traffic retention, session establishment before mutation, refresh cookie propagation, initial-owner and delegate receipts, exact replay, changed-input rejection, wrong-user nondisclosure, revoked-session and banned-account rejection, lost and malformed responses, reload recovery, operation precedence, reauthentication, and the initial-owner redeem-versus-recover concurrency interleaving. Retained local evidence includes 142 focused invitation and owner assertions, 57 pgTAP files with 1,954 assertions, 11 concurrency scenarios with 16 deterministic interleavings, 135 relevant Chromium tests, 19 mobile WebKit scenarios, type checking, lint, and the production build. The remaining device evidence is a current physical iOS smoke test that opens the link from Mail, backgrounds and restores the tab, reloads or returns after process eviction, completes sign-in recovery in another tab, and proves that no invitation secret or session value entered localStorage, sessionStorage, request targets, referrers, analytics, or logs.

## Publication authority concurrency gate

Run `yarn test:advocate:publication-concurrency` against a freshly started, loopback-only local Supabase stack before production activation. The harness creates a random disposable PostgreSQL 15 database inside the local Supabase cluster, restores the current schema, runtime function permissions, required auth ownership permissions, and immutable dictionaries, provisions five complete portal fixtures through the real provider settlement boundaries, and force drops the database in a final cleanup step. It verifies both the loopback database URL and the Docker published-port binding, refuses a stack exposed on nonloopback host interfaces, removes stale evidence before starting, and never mutates the primary local database. It also requires the source database's complete applied migration-version set to equal every repository SQL migration before accepting the repository migration boundary and digest. Pass evidence is written only after successful transient database disposal.

The combined GitHub workflow relies on a fresh ephemeral hosted runner. Supabase start applies all migrations and seed data on the dedicated loopback Docker bridge. The workflow first runs focused initial-owner and invitation pgTAP plus the FF-039 harness, then runs focused publication pgTAP plus the FF-040 harness on the same source stack. It uploads separate sanitized evidence artifacts for the two authority boundaries. Do not add a database reset step unless the pinned Supabase CLI is first proven to preserve that bridge and its loopback port binding, because version 2.90.0 recreates the database on the default network during reset. The focused pgTAP helper must join the same custom bridge. Before production activation, configure the combined `Publication authority database tests` job as one required status check for the `dev` branch; until that repository rule exists, both gates are advisory.

The healthy Creator Share administrator boundary deliberately takes one global transaction advisory lock before rechecking the caller and holding the actor's role assignment. This makes concurrent revocation safe, but it also serializes protected administrator mutations across unrelated advocates. FF-041 tracks lock-wait telemetry, a capacity soak, and any future revocation-safe narrowing. Do not weaken the lock merely to make a benchmark prettier.

The gate uses independent PostgreSQL sessions and server-observed `pg_blocking_pids` evidence. It does not use fixed sleeps as proof of overlap. It must pass simultaneous different-operation starts, exact operation replay, report completion versus premature approval at the shared publication authority lock, two approving administrators sharing one capability, two expired-lease reclaimers contending with stale completion, and deployment rollover. The rollover case stages the original and new deployment workers behind their exact queue locks. Required postconditions are one start and payment-attempt tuple, one terminal report, one consumed capability, one approval receipt and version transition, the actual winning administrator and signed session, rejection of stale authority, one original-deployment queue claim and zero new-deployment claims, immutable first deployment binding, and exact committed replay without a second receipt.

CI writes the sanitized evidence file named by `ADVOCATE_PUBLICATION_CONCURRENCY_EVIDENCE_PATH`. The artifact may contain scenario names, participant counts, SQLSTATE categories, the database-verified PostgreSQL major version, the source-verified repository migration boundary and complete migration-set digest, and pass status. It must not contain the database URL, credentials, user or session identifiers, operation or capability UUIDs, emails, report bodies, provider identifiers, or raw audit material.

Each provisioner invocation has one 50 second monotonic budget inside the 60 second Vercel function limit. Scheduling, claim, context reads, reconciliation recording, and lease renewal share an absolute database abort deadline that ends 10 seconds before the invocation deadline. Provider request timeouts are calculated from that same remaining work budget. Completion and retry use a separate signal that ends at the absolute invocation deadline, so a slow control call cannot consume the durable settlement reserve. If final settlement also times out, the worker returns a nonclean `settlement_unknown` result and leaves the exact fenced lease for normal expiry and recovery. A fixed per-request database timeout is not an acceptable substitute because several serial calls could still cross the route deadline.

Enable scheduled reconciliation for active domains only after the active-drift settlement migration in this release is applied. That boundary atomically moves an active advocate publication, domain, and affected required integration into their fail-closed states when verified provider drift becomes terminal. For Vercel, a redirect, Git branch binding, or custom environment binding is terminal drift even when the hostname remains verified on the expected project. Repair may return failed state through provisioning to `verifying`, but automation must never reactivate the portal directly.

Alert on:

- A required integration entering `failed` or remaining nonready past its retry objective.
- A domain remaining in `provisioning` or `verifying` beyond its operational objective.
- A pending publication start older than one cron interval, repeated lease reclaim, or a publication cron cadence breach.
- Provider evidence that no longer matches desired state.
- An active domain whose DNS, Vercel attachment, TLS, or checkout canary later fails.
- Repeated publication failures, optimistic version conflicts, or evidence freshness failures.
- Any attempt by a service role or non-super-administrator path to activate a portal.

Publication evidence is not permanent evidence of health. Active domains require scheduled public drift canaries and a documented suspension threshold.

## Suspension and deprovisioning

Suspension disables tenant resolution and reconciliation without scheduling provider cleanup. Use it for a reversible operational stop. Archive is the irreversible relationship decision that requests provider cleanup. Both actions fail closed before any external provider mutation and preserve advocate, attribution, sponsorship, financial, membership, and audit history.

After archive, the coordinator enforces a 20 minute quiescence period. This exceeds the maximum 15 minute provisioning lease and 60 second provider request horizon with an operational buffer, so work accepted before archive can settle before cleanup begins. The lifecycle cleanup coordinator runs once per minute and creates at most one current deprovisioning job for each archived advocate.

Cleanup proceeds in this strict order:

1. Remove the Cloudflare DNS record and verify absence.
2. Release the exact domain from Vercel and verify absence.
3. Retire the local Stripe US hosted-checkout integration projection and verify its expected terminal state.
4. Retire the local Stripe UK hosted-checkout integration projection and verify its expected terminal state.
5. Retire the local PayPal hosted-checkout integration projection and verify its expected terminal state.

The Stripe and PayPal phases are local hosted-checkout integration retirement. They do not delete Stripe accounts, Prices, Customers, Subscriptions, PayPal plans, or other provider objects. Cloudflare DNS removal and exact Vercel domain release are the only external infrastructure deletions in the MVP archive sequence.

The coordinator advances only after the preceding provider job succeeds. It never skips, reorders, or runs provider cleanup in parallel. A failed or cancelled current job moves the archive cleanup projection to `needs_attention`. Automation does not guess at a replacement job after a terminal result.

Any selected batch containing `needs_attention` returns a persistent nonclean worker result and must alert until an administrator corrects the cause. Deduplicate repeated alerts by the static outcome code and the protected advocate or incident correlation, not by the per-invocation request ID. At MVP scale, blocked tenants are considered after runnable, open, and quiescing cleanup. Reserved alert scan capacity for sustained higher volume is tracked in FF-037.

After the underlying provider or configuration issue is corrected, a Creator Share super administrator may request exact cleanup recovery with the current advocate version, one stable operation ID, and a required reason. The database derives the only eligible terminal job and current provider phase under lock, appends an immutable recovery receipt, and creates one replacement job for that exact phase. The browser cannot select a provider, integration, job, phase, or retry order. Replaying the exact successful request returns the recorded outcome. Changing any request binding requires a new operation and current version.

Never release a slug automatically for reuse. Never remove provider objects while the hostname can still route public traffic. Never describe a partially deprovisioned domain as deleted when historical financial and attribution records remain intentionally retained. Never edit lifecycle, integration, job, or cleanup rows directly to bypass `needs_attention`.

## Retention worker dependency

The retention worker runs hourly at minute 17 and invokes six independently committed, idempotent cleanup transactions in privacy-first order:

1. Erase eligible terminal checkout contact envelopes.
2. Redact expired or no-longer-deliverable welcome email contact.
3. Redact expired encrypted gateway payloads.
4. Delete expired raw audit IP and user-agent forensics.
5. Delete expired sponsor recent-authentication receipts, passwordless delivery reservations, and passwordless verification attempts after their complete quota windows.
6. Delete expired advocate exposures and then unreferenced browser visitors.

Each step has a bounded timeout and the worker attempts later steps after an earlier failure. Every accepted run writes an immutable sanitized header. Successful steps append bounded counts and backlog evidence, while finish or later stale-run abandonment appends terminal evidence correlated to the request and optional trace identifier. Authorization, configuration, or start rejection does not claim a new durable run. A partial result or remaining backlog returns a non-success status. It emits a static structured error signal containing safe run and request identifiers, state flags, and fixed step names. Aggregate counts remain in the no-store HTTP response and durable step outcomes. Configure production alerts for those signals and for stale unterminated runs. The next hourly invocation retries the idempotent work. The minute payment, welcome email, cancellation, and domain provisioner workers remain separate dependencies and must not be removed when enabling retention.

## Release evidence checklist

Retain:

- Database migration identity and complete pgTAP result.
- Application typecheck, focused route tests, production build result, and Edge middleware matcher evidence.
- Vercel Pro or Enterprise plan confirmation, effective 300 second function limits, one-minute publication cron inventory, and recent authorized worker evidence.
- Runtime evidence that System Environment Variables expose `VERCEL_DEPLOYMENT_ID` and `VERCEL_GIT_COMMIT_SHA` without recording secret values.
- Configuration presence for every required Cloudflare, Vercel, payment, Supabase, cron, and challenge value.
- Exact five provider readiness records and their succeeded job references.
- Cloudflare API evidence that the exact CNAME uses the project-specific target with `proxied: false`, plus the matching Vercel project domain attachment.
- Protected canary report and its SHA256 digest.
- A focused concurrency test proving single ownership, expired lease reclaim, and rejection of stale completion.
- The passing FF-039 sanitized concurrency artifact, proving no more than one final redeemable initial-owner authority, zero live local authority, membership, or topology from invalidated invitations, and no success receipt or replay residue from losing database contenders.
- FF-042 evidence for the two-response boundary, initial-owner and delegate immutable receipts, exact operation recovery after response loss, one receipt under concurrent redeem and recovery, refresh cookie propagation, wrong-user nondisclosure, and contact-free same-tab storage. Retain the locally passing 19 scenario mobile WebKit result and current physical iOS observations separately.
- The passing FF-040 sanitized concurrency artifact, proving one start and one approval under simultaneous operation, deployment, and administrator races.
- Route evidence for `202 Accepted`, authenticated polling, low-latency `after()` execution, cron recovery, and the rule that background execution cannot publish.
- Browser evidence for create, terminal-delivery reissue, sent or ambiguous invitation revocation, post-revocation reissue, initial-owner and delegate acceptance, lost-response recovery, reauthentication recovery, provision, verify, publish, timeout recovery, and reload recovery. The evidence must prove exact operation replay, version fencing, refresh cookie propagation, contact-free browser storage, and sanitized responses.
- Provider evidence proving both Stripe Sessions were unpaid and expired, the PayPal Subscription remained unapproved, and no financial or sponsorship state was created.
- Super administrator publication result and immutable audit event references.
- Super administrator lifecycle and ownership results, append-only exact replay receipts, and private browser forensic capture with 90 day deletion evidence.
- Archive exercises proving immediate tenant suppression, 20 minute quiescence, strict Cloudflare, Vercel, Stripe US, Stripe UK, and PayPal cleanup order, terminal `needs_attention`, and exact recovery without browser-selected provider or job input.
- Post-publication exact-host, random sibling DNS absence, and fixed sentinel observations.
- Active scheduler inventory, recent successful worker runs, and alert ownership.
- Hourly evidence for all six retention steps, including the roughly 75-minute recent-authentication bound and roughly 25-hour passwordless delivery and verification reservation bounds.
- Suspension, deprovisioning, and incident owners.

The release record may reference protected provider object IDs. It must not contain credentials, sponsor contact, account claim secrets, visitor tokens, encrypted contact material, or raw provider payloads.

## Official platform references

- [Cloudflare Error 524 and the 120 second default Proxy Read Timeout](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)
- [Cloudflare DNS record types and DNS only CNAME configuration](https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/)
- [Vercel Cron usage and plan cadence](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Cron delivery, overlap, and retry behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel function maximum duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel System Environment Variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [Next.js post-response `after()` guidance](https://nextjs.org/docs/app/api-reference/functions/after)
- [Stripe Checkout Session expiration](https://docs.stripe.com/api/checkout/sessions/expire)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [PayPal Subscriptions API](https://developer.paypal.com/docs/api/subscriptions/v1/)
- [PayPal idempotency guidance](https://developer.paypal.com/reference/guidelines/idempotency/)

# Advocate Domain Publication Runbook

This runbook controls the transition from automated provider readiness to a publicly available advocate portal. Provider provisioning remains fully automated. Public activation is a separate, audited release decision because a successful Cloudflare, Vercel, Stripe, or PayPal API response does not prove that the exact public hostname serves the intended tenant or can safely initiate checkout.

## Implementation status and prerequisites

The database publication boundary and the scheduled retention boundary are implemented. The lifecycle below is the required production contract, not a claim that every caller already exists.

Do not publish an advocate portal until these remaining application surfaces are deployed and validated:

- Atomic provisioning start that derives the exact hostname, creates the primary domain and exactly five required integrations, and enqueues all initial work in one transaction.
- Bounded scheduled reconciliation plus the fail-closed active-drift transition described below.
- Protected exact-host challenge route and canary runner.
- Protected report evidence storage and deterministic report hashing.
- Authenticated super-administrator publication caller using the caller's user session.
- Post-publication drift canaries and alert ownership.

The existing `create_advocate_portal` function creates the advocate, branding, owner membership, and audit evidence. It does not yet create the domain topology or provisioning jobs. The current provisioner processes work that already exists. No operator should infer production readiness from the presence of the publication RPC alone.

## Lifecycle contract

The domain lifecycle is deliberately asymmetric:

1. Portal creation reserves the slug and creates the inactive advocate foundation. The separate atomic provisioning-start boundary derives its exact primary domain, creates five required provider integrations, and enqueues idempotent provisioning work.
2. The provisioner reconciles Cloudflare DNS, Vercel attachment, Stripe US live access, Stripe UK live access, and PayPal live access.
3. Each successful provider reconciliation stores a bounded evidence digest and advances the integration to `ready`.
4. A domain with exactly the five required ready integrations advances only to `verifying`.
5. An independent protected canary runner exercises the exact hostname and deployment.
6. A Creator Share super administrator reviews the result and calls the publication boundary with the expected portal version and evidence digest.
7. The database atomically activates the exact primary domain and advocate portal.

No provider worker, service role client, or ordinary advocate administrator may activate a portal. A domain in `verifying` remains unavailable to ordinary public browsing and checkout.

## Required provider topology

Publication requires exactly these required integration tuples for the primary domain:

| Provider   | Environment  | Readiness evidence                                               |
| ---------- | ------------ | ---------------------------------------------------------------- |
| Cloudflare | `production` | Exact DNS only CNAME record observed through the provider API    |
| Vercel     | `production` | Exact project domain attached and provider verification complete |
| Stripe US  | `live`       | Expected live account scope is authenticated                     |
| Stripe UK  | `live`       | Expected live account scope is authenticated                     |
| PayPal     | `live`       | Expected live API origin and credentials are authenticated       |

Every tuple must reference a succeeded `provision` or `reconcile` job with a 32 byte evidence digest observed within the 30 minute publication window. Any extra required tuple, missing tuple, nonready tuple, stale tuple, or queued or running job blocks publication.

Provider readiness is necessary, but it is not sufficient. It proves control plane access. It does not prove public DNS propagation, TLS, tenant selection, deployment identity, return URL construction, or provider checkout object creation through the exact host.

## Protected canary report

The canary runner must execute after the latest provider readiness timestamp and against the exact production hostname. It must not temporarily publish the tenant. Use a short lived, single-purpose server challenge that can resolve only the expected `verifying` domain through the protected canary route. Ordinary requests to the same hostname must continue to receive the neutral default-deny response.

The report must include:

- Report schema version.
- Advocate ID, primary domain ID, exact lowercase hostname, and expected advocate version.
- Deployment ID and source revision.
- Canary start and completion timestamps in UTC.
- DNS answers and the expected Vercel target.
- TLS certificate hostname coverage, validity window, and issuer metadata.
- Exact-host protected tenant response, including the expected advocate ID and deployment ID.
- Ordinary public response proving the verifying tenant remains unpublished.
- A generated, unprovisioned sibling hostname and its neutral rejection result.
- Stripe US, Stripe UK, and PayPal checkout initiation results.
- Sanitized provider object references required for later operator investigation.
- A pass or fail result for every check and one overall result.

The checkout canaries must use the production provider accounts without collecting money. Each provider-specific canary must create a nonapproved or otherwise nonchargeable object through the same configuration and return URL construction code used by sponsorship checkout. The runner must verify that success, cancel, and return destinations use the exact expected hostname. Any created object must be immediately terminalized when the provider supports that operation, or left unapproved to expire under a documented provider lifecycle. Never create a fake paid sponsorship, synthetic ledger movement, account claim, welcome email, or advocate attribution decision for a publication canary.

Report payment checks with literal evidence names. At minimum, distinguish live account authentication from `stripe_us_checkout_session_created_and_expired`, `stripe_uk_checkout_session_created_and_expired`, and `paypal_order_created_unapproved`. Also record `financial_charge_attempted`, `provider_capture_attempted`, `sponsorship_state_created`, and `webhook_delivery_verified` as explicit booleans. Do not collapse those facts into one ambiguous `payments_ready` result.

The report must contain no sponsor contact, provider secret, bearer token, checkout contact envelope, or full provider response. Store the exact report bytes in the protected release evidence system. Calculate SHA256 over those exact bytes and pass the 32 byte digest to the database. The ordinary application database stores the digest and an additional binding digest, not the report contents.

## Publication approval

The approving caller must be a currently authenticated Creator Share super administrator with a verified, active email account. Read the current advocate version immediately before approval. Then call:

`publish_advocate_portal(target_advocate_id, expected_advocate_version, target_primary_domain_id, expected_primary_hostname, evidence_sha256, canary_completed_at, change_reason, deployment_id, request_id, trace_id)`

The function fails closed unless:

- The caller still holds the global `SUPER_ADMIN` assignment throughout the transaction.
- The advocate relationship is active and its version exactly matches the reviewed version.
- The supplied domain is the exact primary domain for that advocate.
- The domain remains in `verifying`.
- The canary completed no more than 30 minutes ago and no earlier than the latest provider readiness evidence.
- Exactly the five required provider tuples are ready with succeeded evidence-bearing jobs.
- No provisioning job for the advocate is queued or running.
- The hostname, evidence digest, deployment, request, trace, and reason inputs are valid.

The function records immutable audit metadata, including the report digest, canary completion time, deployment ID, exact hostname, and a database-computed binding digest over the report digest and ordered provider evidence. It then activates the domain and advocate in one transaction. An optimistic version failure requires a fresh review and a new canary if the existing report has become stale.

For the MVP, the authenticated super administrator is the attesting authority for the protected report digest. The database proves who approved which digest for which domain, deployment, provider evidence, and time. It does not independently prove that a particular runner produced the report. FF-025 tracks a later single-use signed runner attestation without transferring publication authority to automation.

## Post-publication verification

Immediately after approval:

1. Load the public root from the exact advocate hostname and confirm the expected logo, colors, opening header, and eligible child catalog.
2. Load one deep child route and confirm every internal browse, sponsorship, success, cancel, and account link stays on the exact advocate hostname where intended.
3. Initiate one production-safe operator checkout canary for every supported provider and region. Do not complete payment unless the release plan explicitly includes a live transaction.
4. Confirm the primary Creator Share hostname remains primary and an unprovisioned sibling remains neutral.
5. Confirm the publication audit events contain the expected actor, portal, domain, deployment, request, trace, reason, report digest, and binding digest.
6. Attach the canary report, database result, build identity, and post-publication observations to the release record.

If any post-publication check fails, suspend public tenant resolution before investigating provider state. Do not edit lifecycle columns directly.

## Reconciliation and drift

The scheduled provisioner processes queued jobs every minute. A separate reconciliation scheduler must periodically enqueue one idempotent reconcile job per required integration that is due for observation. A provider status regression must never be treated as a successful publication decision.

Do not enable scheduled reconciliation for active domains until the active-drift settlement boundary is deployed. That boundary must atomically move an active advocate publication, domain, and affected required integration into their fail-closed states when verified provider drift becomes terminal. Repair may return failed state through provisioning to `verifying`, but automation must never reactivate the portal directly.

Alert on:

- A required integration entering `failed` or remaining nonready past its retry objective.
- A domain remaining in `provisioning` or `verifying` beyond its operational objective.
- Provider evidence that no longer matches desired state.
- An active domain whose DNS, Vercel attachment, TLS, or checkout canary later fails.
- Repeated publication failures, optimistic version conflicts, or evidence freshness failures.
- Any attempt by a service role or non-super-administrator path to activate a portal.

Publication evidence is not permanent evidence of health. Active domains require scheduled public drift canaries and a documented suspension threshold.

## Suspension and deprovisioning

Suspension disables tenant resolution before provider cleanup. Preserve advocate, attribution, sponsorship, financial, and audit history. Deprovisioning then removes Cloudflare DNS before releasing the Vercel domain and records provider evidence for every transition.

Never release a slug automatically for reuse. Never remove provider objects first while the hostname can still route public traffic. Never describe a partially deprovisioned domain as deleted when historical financial and attribution records remain intentionally retained.

## Retention worker dependency

The retention worker runs hourly at minute 17 and invokes five independently committed, idempotent cleanup transactions in privacy-first order:

1. Erase eligible terminal checkout contact envelopes.
2. Redact expired or no-longer-deliverable welcome email contact.
3. Redact expired encrypted gateway payloads.
4. Delete expired raw audit IP and user-agent forensics.
5. Delete expired advocate exposures and then unreferenced browser visitors.

Each step has a bounded timeout and the worker attempts later steps after an earlier failure. Every accepted run writes an immutable sanitized header. Successful steps append bounded counts and backlog evidence, while finish or later stale-run abandonment appends terminal evidence correlated to the request and optional trace identifier. Authorization, configuration, or start rejection does not claim a new durable run. A partial result or remaining backlog returns a non-success status. It emits a static structured error signal containing safe run and request identifiers, state flags, and fixed step names. Aggregate counts remain in the no-store HTTP response and durable step outcomes. Configure production alerts for those signals and for stale unterminated runs. The next hourly invocation retries the idempotent work. The minute payment, welcome email, cancellation, and domain provisioner workers remain separate dependencies and must not be removed when enabling retention.

## Release evidence checklist

Retain:

- Database migration identity and complete pgTAP result.
- Application typecheck, focused route tests, production build result, and Edge middleware matcher evidence.
- Exact five provider readiness records and their succeeded job references.
- Protected canary report and its SHA256 digest.
- Super administrator publication result and immutable audit event references.
- Post-publication exact-host and rejected-sibling observations.
- Active scheduler inventory, recent successful worker runs, and alert ownership.
- Suspension, deprovisioning, and incident owners.

The release record may reference protected provider object IDs. It must not contain credentials, sponsor contact, account claim secrets, visitor tokens, encrypted contact material, or raw provider payloads.

# Advocate Platform MVP Completion Audit

This answers one question: **is the Advocate Platform ready for final manual testing and a merge to `dev`?**

The short answer is that the repository work is complete and the automated evidence is enforced, and what remains cannot be closed from inside the repository. Every remaining item needs a live provider, a hosted deployment, a physical device, or your decision. Those are enumerated in `docs/advocate-staging-manual-audit.md`; this document is the traceability record that justifies that claim gate by gate.

## What is measured, not asserted

Every number below was produced by a command, and the source is named so it can be re-run.

| Measurement                      | Value                          | Produced by                                         |
| -------------------------------- | ------------------------------ | --------------------------------------------------- |
| Test files assigned to a lane    | 238                            | `node scripts/verify-release-manifest.mjs`          |
| Offline Playwright lane          | 143 files, 1,551 tests passing | `CI=true yarn test:lane:offline`                    |
| pgTAP suite from a clean reset   | 63 files, 2,131 tests passing  | Advocate publication database gate, run 30166556179 |
| Dev-server Playwright lane       | 9 files                        | release manifest                                    |
| Seeded-database Playwright lane  | 4 files                        | release manifest                                    |
| WebKit browser overlay           | 3 files                        | release manifest                                    |
| Local Supabase HTTP lane         | 1 file                         | release manifest                                    |
| Database harness lane            | 18 files                       | release manifest                                    |
| Opt-in integration, not required | 1 file                         | release manifest                                    |

The manifest is a gate, not a listing. `scripts/verify-release-manifest.mjs` discovers every test-shaped file in the repository, including untracked ones, and fails the build if any file is unassigned, assigned twice, missing from disk, or sitting outside an expected directory. It was verified to fail in all four directions.

## Status vocabulary

Four classes are used below, and they mean exactly this:

- **CI-enforced** — a named test in a required lane fails if the property is broken.
- **CI-enforced, hosted still required** — the mechanics are enforced in CI, and the gate's own text additionally demands hosted evidence. CI is necessary here but the roadmap does not accept it as sufficient.
- **Hosted only** — cannot be produced without live providers or a deployment.
- **Manual** — needs a human or a physical device.

No gate below is marked CI-enforced on the strength of a file name. Each names the file that carries the assertion.

## Release gate traceability

| #   | Release gate                                                                    | Status                                     | Asserting evidence                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Legacy invitation privilege escalation removed or isolated                      | CI-enforced                                | `supabase/tests/advocate_invitation_email_delivery.test.sql` — the legacy delegate branch requires a fresh `otp` session; issuance is service-role only                                                                          |
| 2   | Two-response invitation redemption with exact proof type                        | CI-enforced                                | `supabase/tests/advocate_invitation_email_proof_settlement.test.sql`, `tests/advocates/portal-invitation-route.spec.ts`                                                                                                          |
| 3   | Phone authentication disabled, all three controls                               | CI-enforced (local), hosted still required | `tests/auth/local-phone-authentication-lock.spec.ts` pins the Twilio provider and both phone MFA operations false. Hosted verification is manual item 2                                                                          |
| 4   | Sponsor magic links: template, allowlist, no session on load, no token leak     | CI-enforced, hosted still required         | `tests/auth/verify-otp.spec.ts`, `tests/auth/supabase-email-proof-issuer.spec.ts`, `tests/provider/supabase-email-proof-supersession.spec.ts` (99-case offline contract)                                                         |
| 5   | Sign-in and reauthentication never create accounts                              | CI-enforced                                | `tests/sponsorships/sponsor-claim-routes.spec.ts`, `supabase/tests/persistent_sponsor_account_claim_links.test.sql`                                                                                                              |
| 6   | Cancellation and payment-method management need a live receipt                  | CI-enforced                                | `supabase/tests/sponsor_recent_authentication_management.test.sql`, `supabase/tests/sponsor_subscription_cancellation_boundary.test.sql`                                                                                         |
| 7   | Passwordless limiter partitions public from protected capacity                  | CI-enforced                                | `supabase/tests/sponsor_passwordless_email_delivery_limits.test.sql` — verified by hand, not by file name: exhausting the public pool preserves validated-claim capacity                                                         |
| 8   | Exposed tables have RLS and least-privilege grants                              | CI-enforced                                | `supabase/tests/postgrest_role_claim_compatibility.test.sql`, `supabase/tests/storage_access_hardening.test.sql`, `supabase/tests/advocate_platform_foundation.test.sql`                                                         |
| 9   | Every payment path creates and verifies a server-owned intent                   | CI-enforced                                | `supabase/tests/sponsorship_checkout_intent_boundary.test.sql`, `tests/sponsorships/stripe-checkout-v2.spec.ts`                                                                                                                  |
| 10  | Webhooks authenticated, idempotent, authoritative                               | CI-enforced                                | `tests/sponsorships/stripe-webhook-signature-gate.spec.ts` (authentication, against the real Stripe SDK), `supabase/tests/paypal_webhook_financial_parity.test.sql`, `supabase/tests/verified_gateway_event_quarantine.test.sql` |
| 11  | Both regional Billing Portal configurations enabled and reconciled              | Hosted only                                | Needs live Stripe US and UK                                                                                                                                                                                                      |
| 12  | Exact host stays nonpublic in `verifying` until the canary report completes     | CI-enforced                                | `supabase/tests/advocate_publication_canary_reports.test.sql`                                                                                                                                                                    |
| 13  | Provisioning, TLS, HTTP tenant, and checkout canaries pass                      | Hosted only                                | Manual item 5                                                                                                                                                                                                                    |
| 14  | Random sibling proves DNS absence; sentinel proves provider readiness           | CI-enforced, hosted still required         | `supabase/tests/advocate_publication_sentinel_reservation.test.sql` reserves the label; the network proof is hosted                                                                                                              |
| 15  | Super administrator promotes through the audited publication function           | CI-enforced                                | `supabase/tests/advocate_publication_from_canary.test.sql`, `supabase/tests/advocate_publication_approval_boundary.test.sql`                                                                                                     |
| 16  | Visitor signing secret is host-scoped and distinct from payment or contact keys | CI-enforced, hosted still required         | `tests/advocates/release-preflight.spec.ts` asserts pairwise key separation including the payment-key instances; the production host-scope canary is hosted                                                                      |
| 17  | Production build proves Edge middleware selection; Vercel canary                | Hosted only                                | Needs the staging project, blocked on manual item 1                                                                                                                                                                              |
| 18  | Parent-domain cookie activation remains unavailable                             | CI-enforced                                | `tests/advocates/attribution-identity-middleware.spec.ts`, `tests/advocates/attribution-identity-auth-routes.spec.ts`                                                                                                            |
| 19  | Apex broker passes mobile, tracking-prevention, abuse, settlement canaries      | Hosted only                                | Chrome and WebKit feasibility evidence is retained; the four canaries are hosted                                                                                                                                                 |
| 20  | Advocate roles cannot read sponsor contact or raw tracking data                 | CI-enforced                                | `supabase/tests/advocate_private_analytics_boundary.test.sql`, `supabase/tests/advocate_delegate_administration.test.sql`                                                                                                        |
| 21  | Audit redaction and append-only pass adversarial tests                          | CI-enforced                                | `supabase/tests/advocate_sanitized_audit_history.test.sql`                                                                                                                                                                       |
| 22  | Ownership and lifecycle controls prove fencing, reasons, replay, receipts       | CI-enforced                                | `supabase/tests/creator_share_advocate_lifecycle_controls.test.sql`, `tests/advocates/creator-share-advocate-lifecycle.spec.ts`                                                                                                  |
| 23  | Initial owner onboarding concurrency races                                      | CI-enforced                                | `tests/database/advocate-initial-owner-concurrency.mjs`                                                                                                                                                                          |
| 24  | Invitation recovery evidence, no secret in storage or URLs                      | CI-enforced                                | `tests/advocates/invitation-interstitial.spec.ts`, `tests/advocates/portal-invitation-route.spec.ts`                                                                                                                             |
| 25  | Advocate publication concurrency                                                | CI-enforced                                | `tests/database/advocate-publication-concurrency.mjs`, `supabase/tests/advocate_publication_operation_recovery.test.sql`                                                                                                         |
| 26  | Archive: suppression, quiescence, strict cleanup order, recovery                | CI-enforced, hosted still required         | `tests/advocates/creator-share-advocate-control-routes.spec.ts`, `supabase/tests/domain_provisioning_settlement_boundary.test.sql`; the provider cleanup order against live providers is hosted                                  |
| 27  | Browser lifecycle forensics private and removed after 90 days                   | CI-enforced                                | `supabase/tests/scheduled_data_retention_worker.test.sql`                                                                                                                                                                        |
| 28  | Retention cleanup jobs configured, hourly                                       | CI-enforced                                | `supabase/tests/sponsor_authentication_retention.test.sql`; `tests/advocates/data-retention-worker.spec.ts` asserts the `17 * * * *` schedule against `vercel.json`                                                              |
| 29  | Sealed checkout contact ciphertext erased after its duties end                  | CI-enforced                                | `supabase/tests/checkout_contact_envelope_erasure.test.sql`                                                                                                                                                                      |
| 30  | Rollback and suspension procedures exercised                                    | Manual                                     | Runbook exercise, not a code property                                                                                                                                                                                            |

That is 21 gates enforced in CI, 5 enforced in CI with hosted evidence still required by the gate's own wording, 5 hosted only, and 1 manual procedure.

## Gaps closed in this pass, and what each would have allowed

Each of these was a real hole. Every one was mutation tested: the implementation was deliberately broken, the suite was confirmed to fail, and the source was restored byte-identical.

| Gap                                                             | What could have shipped                                                                    | Now asserted by                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Webhook authentication had no test at the route boundary        | An unsigned or wrongly signed webhook reaching the database                                | `tests/sponsorships/stripe-webhook-signature-gate.spec.ts` — 5 cases, each also asserting the database was not reached |
| No test rendered a real advocate-branded document               | A provider that stopped emitting the site kind, or tenant data crossing to the client      | `tests/advocates/public-site-branding-browser.spec.ts`                                                                 |
| The public catalog route was covered by reading its source text | An advocate Host served the entire primary catalog, or an admin surface on a tenant        | `tests/advocates/public-catalog-host-routing.spec.ts`                                                                  |
| `authorizeCheckoutHost` had no test reference at all            | A suspended, unpublished, or retired tenant collecting sponsorships under its own branding | `tests/sponsorships/checkout-host-authorization.spec.ts`                                                               |
| Tenancy uniqueness was structural, not asserted                 | Two advocates on one slug, or two primary hostnames on one advocate                        | `supabase/tests/advocate_platform_foundation.test.sql`                                                                 |
| Local phone authentication was unpinned                         | A phone path silently re-enabled, defeating the freshness proof                            | `tests/auth/local-phone-authentication-lock.spec.ts`                                                                   |
| Checkout parity was inferred from module tests                  | A branded subdomain behaving differently from the primary origin at checkout               | `tests/advocates/tenant-payment-browser.spec.ts`                                                                       |

The checkout parity work also found and fixed a **real production bug**: `src/lib/sponsorships/checkout/clientState.ts` called an unbound `crypto.randomUUID`, which throws `Illegal invocation` in browsers. It was invisible to module tests because Node tolerates the unbound reference.

## Where the automated evidence stops

Stating this plainly matters more than the count above.

- **The tenant checkout `POST` in the browser parity test is intercepted, not served.** `tests/advocates/tenant-payment-browser.spec.ts` asserts that the browser initiates identically on both origins — same origin, same body apart from a distinct operation identifier, a genuine top-level navigation to the provider. It does not carry the request into the real route. The route's own tenant authorization is now covered separately by `tests/sponsorships/checkout-host-authorization.spec.ts`, but the two halves are joined only in a hosted canary.
- **WebKit coverage is engine emulation, not Mobile Safari.** Four tests in `tests/advocates/portal-catalog-browser.spec.ts` are skipped under WebKit because Playwright's WebKit never emits native `beforeunload` or history `confirm` dialogs. Real Mobile Safari does. Manual item 4 is the only evidence covering that behavior, and it is not optional.
- **The 99-case provider contract runs in a network namespace with no outbound interface.** That makes it a genuine offline contract and explicitly not hosted evidence.
- **FF-049 is open.** It is a WebKit lane instability, documented with the CI run history that refuted my first hypothesis. `tests/advocates/portal-catalog-browser.spec.ts` should not be modified and should not be returned to the `webkit-browser` lane until the failing context is discriminated.

## On the earlier traceability sweep

An earlier automated sweep classified the release gates as 14 automated, 32 partial, 12 hosted-only, 5 uncovered. **Treat that partial count as a classification artefact, not a backlog**, and treat the aggregate verdicts of both large sweeps as unreliable in both directions:

- A sweep run with a pro-covered prompt returned 16 of 16 "covered".
- A sweep run with a pro-refute prompt returned 12 of 13 "overturned".

The aggregates tracked the instruction, not the code. The individual findings, when checked by hand against source, were trustworthy and produced two genuine fixes. That is why every row in the table above names a file, and why the ones I re-checked by hand are marked as such.

Two of the sweep's specific claims were wrong on inspection. The legacy invitation branch it flagged as an escalation risk is an intentional compatibility path documented by FF-042 that still requires a fresh `otp` session; its real defect was missing coverage, now closed. A claimed PayPal weakness turned out to be my test being wrong and the implementation being stricter than I had assumed.

## The answer

**Merging to `dev` is a decision about process, not about evidence.** Both required gates are green, every test file in the repository is assigned to a lane, and the manifest gate fails the build if that stops being true.

Two things are worth settling first, and both are yours to decide:

1. `dev` has **no branch protection and no required-check ruleset**. Every gate built for this pull request runs, but nothing prevents a merge that ignores them. Suggested required checks are `Publication authority database tests` and `Catalog recovery in WebKit`. I have deliberately not changed this.
2. The **physical iOS smoke test** (manual item 4) is required for release and is the only evidence for the four WebKit-skipped dialog behaviors. It does not block a merge to `dev`, but it does block a release.

Everything else on `docs/advocate-staging-manual-audit.md` is hosted or provider work that begins after the staging project exists, and that is itself blocked on the project-creation audit evidence in manual item 1.

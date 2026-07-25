# Advocate Platform MVP Completion Audit

This answers one question: **is the Advocate Platform ready for final manual testing and a merge to `dev`?**

The short answer is that the repository work is complete and the automated evidence is enforced, and what remains cannot be closed from inside the repository. Every remaining item needs a live provider, a hosted deployment, a physical device, or your decision. Those are enumerated in `docs/advocate-staging-manual-audit.md`; this document is the traceability record that justifies that claim gate by gate.

## What is measured, not asserted

Every number below was produced by a command, and the source is named so it can be re-run.

| Measurement                      | Value                          | Produced by                                         |
| -------------------------------- | ------------------------------ | --------------------------------------------------- |
| Test files assigned to a lane    | 245                            | `node scripts/verify-release-manifest.mjs`          |
| Offline Playwright lane          | 150 files, 1,609 tests passing | `CI=true yarn test:lane:offline`                    |
| pgTAP suite from a clean reset   | 63 files, 2,131 tests passing  | Advocate publication database gate, run 30166556179 |
| Dev-server Playwright lane       | 9 files                        | release manifest                                    |
| Seeded-database Playwright lane  | 4 files                        | release manifest                                    |
| WebKit browser overlay           | 3 files                        | release manifest                                    |
| Local Supabase HTTP lane         | 1 file                         | release manifest                                    |
| Database harness lane            | 18 files                       | release manifest                                    |
| Opt-in integration, not required | 1 file                         | release manifest                                    |

The manifest is a gate, not a listing. `scripts/verify-release-manifest.mjs` discovers every test-shaped file in the repository, including untracked ones, and fails the build if any file is unassigned, assigned twice, missing from disk, or sitting outside an expected directory. It was verified to fail in all four directions.

## What changed after this audit was first written

The numbers above were refreshed after a mutation campaign measured how much of the suite is load-bearing. Twenty-three deliberate, compiling edits to production TypeScript passed every lane. All twenty-three are now resolved: twenty-two are covered by a test that fails when its mutation is applied, and one was reclassified as redundant logic no test could catch.

`docs/advocate-coverage-gap-register.md` holds the record, including the three controls that make those verdicts trustworthy: a known-bad mutation that reported caught, a known-harmless one that reported survived, and a reachability probe that appended a throwing statement to each file to prove the suite actually loads it.

The gate table below is unchanged by that work. Those gaps were missing assertions, not failing gates: the committed code was correct in every case, and each row records only that a future regression there would have shipped silently.

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
- **WebKit coverage is engine emulation, and it is narrower than it looks.** `tests/advocates/portal-catalog-browser.spec.ts` holds 15 tests. Exactly one, `recovers version-bound drafts after mobile WebKit back and forward traversal`, runs under WebKit, through the `Verify catalog recovery` step of the WebKit gate. The other 14 — including every `beforeunload` and history-confirm guard — run in Chromium only, through the dev-server lane. Playwright's WebKit never emits native `beforeunload` or history `confirm` dialogs, and real Mobile Safari does. Manual item 4 is therefore the only evidence covering the unsaved-change guard on the target engine, and it is not optional.

  This corrects a figure I published earlier. "Four tests skipped under WebKit" described the lane while the whole file was assigned to the `webkit-browser` overlay. That assignment was reverted under FF-049, and the accurate count is one test running in WebKit, not eleven.

- **The 99-case provider contract runs in a network namespace with no outbound interface.** That makes it a genuine offline contract and explicitly not hosted evidence.
- **FF-049 is open.** It is a WebKit lane instability, documented with the CI run history that refuted my first hypothesis. `tests/advocates/portal-catalog-browser.spec.ts` should not be modified and should not be returned to the `webkit-browser` lane until the failing context is discriminated.

## A systematic search for what is left, and what it got wrong

An earlier revision of this section claimed a repository-wide search had surfaced no further uncovered boundary, and concluded the repository-side work was finished. **That conclusion was wrong, and the method behind it was too weak to support it.**

The search matched function names against the text of test files. That finds a function nothing mentions; it cannot find a function that is mentioned but never actually exercised, and it cannot find a behavior whose only coverage is a check that reads the source and asserts it contains a symbol name.

A stronger method replaced it: propose a concrete edit to production TypeScript, then **mechanically apply it and run the suite**. A mutation that compiles and leaves every lane green is a missing assertion as a matter of fact. Twenty-three proposals were run this way. All twenty-three survived.

A reachability probe then established what that meant, by appending a throwing statement to each of the 19 distinct files and re-running the complete offline lane. **Fifteen were reached**, so their surviving mutations are genuine, specific assertion gaps. **Four were loaded by no test at all.**

Three of those four are now closed, and the class matters more than the instances: four public routes choose between an advocate-scoped loader and the platform-wide primary loader by reading `site.kind`, and only `beneficiaries/get` was covered. `beneficiaries/[id]/activities` was not among the proposals at all; it surfaced from enumerating the class. The PayPal webhook route had no test of its authentication boundary, though the Stripe route had gained exactly that coverage earlier the same day.

The remaining twenty are recorded in `docs/advocate-coverage-gap-register.md`, with the controls that make the verdicts trustworthy and the caveat that every entry is a missing assertion rather than a live defect.

**The honest position is therefore narrower than the one I first stated.** The release gates in the table above are enforced. What is not true is that nothing further could be found from inside the repository; a better method found twenty more places in a single pass, and the method has not been run to exhaustion.

## On the earlier traceability sweep

An earlier automated sweep classified the release gates as 14 automated, 32 partial, 12 hosted-only, 5 uncovered. **Treat that partial count as a classification artefact, not a backlog**, and treat the aggregate verdicts of both large sweeps as unreliable in both directions:

- A sweep run with a pro-covered prompt returned 16 of 16 "covered".
- A sweep run with a pro-refute prompt returned 12 of 13 "overturned".

The aggregates tracked the instruction, not the code. The individual findings, when checked by hand against source, were trustworthy and produced two genuine fixes. That is why every row in the table above names a file, and why the ones I re-checked by hand are marked as such.

Two of the sweep's specific claims were wrong on inspection. The legacy invitation branch it flagged as an escalation risk is an intentional compatibility path documented by FF-042 that still requires a fresh `otp` session; its real defect was missing coverage, now closed. A claimed PayPal weakness turned out to be my test being wrong and the implementation being stricter than I had assumed.

## The answer

**Merging to `dev` is a decision about process, not about evidence.** Both required gates are green, every test file in the repository is assigned to a lane, and the manifest gate fails the build if that stops being true.

That said, do not read this document as saying the repository work is exhausted. It is not. `docs/advocate-coverage-gap-register.md` lists twenty places where a deliberate regression would ship silently. None of them blocks a merge, because none is a live defect, but the register is real work and it is not finished.

Two things are worth settling first, and both are yours to decide:

1. `dev` has **no branch protection and no required-check ruleset**. Every gate built for this pull request runs, but nothing prevents a merge that ignores them. Suggested required checks are `Publication authority database tests` and `Catalog recovery in WebKit`. I have deliberately not changed this.
2. The **physical iOS smoke test** (manual item 4) is required for release and is the only evidence for the four WebKit-skipped dialog behaviors. It does not block a merge to `dev`, but it does block a release.

Everything else on `docs/advocate-staging-manual-audit.md` is hosted or provider work that begins after the staging project exists, and that is itself blocked on the project-creation audit evidence in manual item 1.

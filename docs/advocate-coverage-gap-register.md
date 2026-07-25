# Advocate Coverage Gap Register

**Every row in this register is now closed.** Of the twenty-three mutations that originally survived the full suite, twenty-two are covered by a test that fails when the mutation is applied, and one was reclassified as redundant logic that no test could ever catch. The closed table and the redundancy note below are the record.

## Read this first

**Every entry is a missing assertion, not a live defect.** The committed code is correct. Each row records that if someone broke that specific behavior, nothing would fail. Do not read the "what would break" column as a description of current behavior.

## How these were found, and why the method is trustworthy

Two earlier automated sweeps produced aggregates that tracked their own prompt rather than the code: one returned 16 of 16 "covered", another 12 of 13 "overturned". This register avoids opinion entirely.

Agents proposed concrete edits to `src/` they believed no test would catch. Each proposal was then **mechanically applied and the suite actually run**. A row survives only if it compiles under `tsc --noEmit` and leaves both the 1,566-test offline lane and the 62-test dev-server lane green. That is a fact about the suite, not a judgment about it.

Three controls make the verdicts meaningful:

1. **A known-bad control.** Dropping the `publication_status` predicate from checkout authorization was correctly reported CAUGHT.
2. **A known-harmless control.** A log-wording change was correctly reported SURVIVED. The harness discriminates in both directions.
3. **A reachability probe.** "Survived" is worthless if no test loads the file. A throwing statement was appended to each of the 19 files and the complete offline lane re-run. **15 of 19 were reached**, so their surviving mutations are genuine, specific assertion gaps. The 4 that were never loaded had no test at all; three of those are now closed.

The agents' own adversarial screen judged 23 of 23 proposals uncatchable. That unanimity was not trusted, and it should not be cited as evidence. The empirical run is the evidence.

## Closed in this session

| Was                                                                                                                                                                                                 | Now asserted by                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `beneficiaries/images/[id]`, `beneficiaries/get/username/[username]`, and `beneficiaries/[id]/activities` chose their loader by `site.kind` with no test loading any of them                        | `tests/advocates/public-beneficiary-detail-host-routing.spec.ts` |
| The PayPal webhook route's authentication boundary had no test, though the Stripe one did                                                                                                           | `tests/sponsorships/paypal-webhook-signature-gate.spec.ts`       |
| The amount, currency, quantity, and recurrence sent to Stripe were asserted nowhere, so multiplying every line item by one hundred passed the whole suite                                           | `tests/sponsorships/stripe-hosted-session-amount.spec.ts`        |
| Stripe never asserted quote expiry though PayPal did, so a recovered operation could seal and send an already-expired quote at a stale conversion rate                                              | `tests/sponsorships/stripe-checkout-v2.spec.ts`                  |
| The advocate display name reached the invitation email HTML with no escaping asserted anywhere, so an operator-supplied name could deliver live markup on a trusted transactional message           | `tests/advocates/invitation-email-escaping.spec.ts`              |
| The canary DNS address allowlist was asserted for four IPv4 addresses and no IPv6 at all, so a tenant AAAA record could pin internal address space                                                  | `tests/advocates/publication-canary-runtime.spec.ts`             |
| The logo route's lifecycle test set relationship and publication status to suspended together, so neither predicate was independently asserted and dropping either left the suite green             | `tests/advocates/portal-logo-route.spec.ts`                      |
| The private analytics k-anonymity floor on sponsor contacts and the paired gross/renewal withholding invariants on both the USD summary and the per-currency table were unasserted                  | `tests/advocates/portal-analytics.spec.ts`                       |
| Framing protection was asserted for three tenant paths but never the beneficiary profile page, which carries the sponsorship call to action and is the one worth clickjacking                       | `tests/advocates/tenant-middleware.spec.ts`                      |
| The PayPal refund path compared amounts but its currency match was unasserted, so a refund in a different currency than the capture would be recorded against the original movement                 | `tests/sponsorships/paypal-webhook-ingestion.spec.ts`            |
| The exposure broker's refusal of bots, header-less clients, and speculative navigations was unasserted, so an unreachable guard would still have looked correct                                     | `tests/advocates/exposure-broker-server.spec.ts`                 |
| The qualified-exposure key test was named for the advocate but never varied it, so dropping the hostname from the digest would collide two tenants' exposures for one visitor                       | `tests/sponsorships/exposure.spec.ts`                            |
| The intent-versus-attempt parity gate on the Stripe webhook was unasserted, so a webhook could record a sponsorship at terms the sponsor's intent never authorized                                  | `tests/sponsorships/stripe-webhook-ingestion.spec.ts`            |
| The provisioning worker's evidence value contract and its publish-eligibility term for provision and reconcile jobs were both unasserted                                                            | `tests/advocates/provisioning-validation.spec.ts`                |
| The WCAG luminance coefficients and the cross-module logo bucket contract were both unasserted, and neither is detectable by a test that reuses the implementation's own arithmetic                 | `tests/advocates/public-site-contrast.spec.ts`                   |
| Starting a checkout on changed terms was asserted to mint a new operation but never to discard the previous bearer receipt                                                                          | `tests/sponsorships/checkout-client-state.spec.ts`               |
| Session completion never checked that an existing attribution identity cookie belonged to the account that just authenticated, and never asserted normalization of a browser holding two identities | `tests/advocates/attribution-identity-completion.spec.ts`        |
| Editing a mistyped invitation recipient did not discard the retained idempotency key, so a corrected address would replay the original invitation and never be invited                              | `tests/advocates/invitation-settings-browser.spec.ts`            |

The activities route was not among the agents' findings. It surfaced from enumerating the whole class of routes that make the advocate-versus-primary loader choice, which is the more reliable move: fix the class, not the instances.

## Open register

None. The table that stood here is empty; each row moved to the closed table above as its test landed, and the single reclassified row is described under "A redundant condition, not a gap".

## The one file still untested

`src/components/advocates/admin/InvitationSettingsClient.tsx` is loaded by no test in any lane. Unlike the routes above it is a client component, so covering it needs a browser fixture rather than a direct handler invocation.

## Suggested order

The money and security rows deserve attention first. The row that stood out, a mutation multiplying every Stripe Hosted Checkout line item by one hundred, is now closed and removed from the table above. `buildHostedStripeSessionParams` is asserted against five independent mutations covering scaling in both directions, quantity, currency substitution, and a dropped yearly interval.

The Stripe quote-expiry gate is now closed too, asserted from both sides so the boundary turns on expiry rather than on a flag being set.

Nothing here blocks a merge to `dev`. Each row is a place where a future regression would ship silently, which is a reason to close them deliberately rather than urgently.

## A redundant condition, not a gap

`src/app/api/auth/attribution-identity/route.ts` guards its early return with three terms, and the third cannot be caught by any test because it can never independently change the outcome.

`requiresNormalization` is defined as `values.length !== 1 || new Set(values).size !== 1 || verification === null || verification.requiresRefresh`. It therefore includes `requiresRefresh` by construction. A measured probe confirms it: a cookie that verifies only against the previous secret resolves with **both** flags true. Removing `!existingSignal.requiresRefresh` leaves the behaviour identical, which is exactly what the mutation run shows.

This is dead logic rather than missing coverage. The rotated-secret behaviour is asserted; the term itself is a candidate for deletion, not for a test.

An earlier revision of this register listed these two terms as an open gap on the strength of two withdrawn tests. Those tests were wrong in a specific and instructive way: they minted cookies with a fixed `issuedAtSeconds` of 1,800,000,000, which is January 2027 and therefore in the future, so neither cookie verified, the signal resolved to null, and the tests passed without exercising the terms they named. Using timestamps near the present closes the normalization half outright.

# Advocate Coverage Gap Register

Nineteen places where a deliberate, compiling change to production TypeScript passes the entire required suite.

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

| Was                                                                                                                                                                          | Now asserted by                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `beneficiaries/images/[id]`, `beneficiaries/get/username/[username]`, and `beneficiaries/[id]/activities` chose their loader by `site.kind` with no test loading any of them | `tests/advocates/public-beneficiary-detail-host-routing.spec.ts` |
| The PayPal webhook route's authentication boundary had no test, though the Stripe one did                                                                                    | `tests/sponsorships/paypal-webhook-signature-gate.spec.ts`       |

The activities route was not among the agents' findings. It surfaced from enumerating the whole class of routes that make the advocate-versus-primary loader choice, which is the more reliable move: fix the class, not the instances.

## Open register

Ordered by the proposer's severity label. I have not independently audited each claim's severity; the empirical fact recorded here is only that the mutation compiles and the suite stays green.

| #   | Severity    | File                                                          | What would break undetected                                                                                                                            |
| --- | ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | security    | `src/app/api/portal/[slug]/logo/route.ts`                     | Drops the relationship-lifecycle gate on the privileged logo/branding mutation endpoint. A member holding portal.branding.update whose advocate relati |
| 2   | security    | `src/lib/advocates/invitations/emailRenderer.ts`              | The advocate portal display name is interpolated raw into the delegate invitation email's HTML body (<h1>Join ${escapedAdvocate}</h1>). advocates.disp |
| 3   | security    | `src/lib/advocates/publicationCanary/runtime.ts`              | isAllowedPublicAddress() loses its IPv6 global-unicast (2000::/3) restriction, so any AAAA answer outside the documentation prefixes is accepted as a  |
| 4   | security    | `src/middleware.ts`                                           | Beneficiary profile documents on advocate tenant hosts (/sponsorships/<username>, the page carrying the sponsorship call to action) are served without |
| 5   | money       | `src/lib/advocates/exposureBrokerServer.ts`                   | The bot and missing-user-agent rejection becomes unreachable (an empty user agent never matches the bot regex, so the expression is constantly false). |
| 6   | money       | `src/lib/sponsorships/checkout/stripeCheckout.ts`             | Every Stripe Hosted Checkout line item is created at 100x the amount the database payment boundary approved. A GBP monthly sponsorship whose server-ow |
| 7   | money       | `src/lib/sponsorships/checkout/stripeCheckout.ts`             | createStripeSponsorshipCheckoutV2 stops enforcing quote expiry. A recovered operation (the client keeps one for 35 minutes) whose server-issued paymen |
| 8   | money       | `src/lib/sponsorships/exposure.ts`                            | The qualified-exposure idempotency key stops binding to the advocate hostname. One visitor who views the same page path on two different advocate tena |
| 9   | money       | `src/lib/sponsorships/gateways/paypalWebhook.ts`              | adjustmentFacts (the PAYMENT.CAPTURE.REFUNDED / .REVERSED / PAYMENT.SALE.REFUNDED / .REVERSED path) stops requiring the refund currency to match the o |
| 10  | money       | `src/lib/sponsorships/gateways/stripeWebhookRuntime.ts`       | The intent-vs-attempt amount parity gate becomes vacuous. validateBoundary in stripeWebhook.ts rejects with boundary-mismatch when boundary.intentChar |
| 11  | privacy     | `src/lib/advocates/admin/analytics.ts`                        | Disables the k-anonymity floor on every private analytics cell (official summary, observed summary, and each attribution segment). A cell built from a |
| 12  | privacy     | `src/lib/advocates/admin/analytics.ts`                        | Removes the paired-withholding invariant on the USD summary cells. A cell may now publish grossCollectedUsdCents while renewalCollectedUsdCents is wit |
| 13  | privacy     | `src/lib/advocates/admin/analytics.ts`                        | Same paired-withholding invariant removed from the original-currency table. A currency row may now show grossCollectedMinor while renewalCollectedMino |
| 14  | privacy     | `src/lib/advocates/provisioning/validation.ts`                | assertSafeProviderEvidence() keeps its key allowlist but stops validating the values under allowed keys. sanitizeEvidenceString enforces length 1..500 |
| 15  | correctness | `src/app/api/auth/attribution-identity/route.ts`              | Session completion stops checking that the existing attribution identity cookie belongs to the account that just authenticated. On a shared or previou |
| 16  | correctness | `src/components/advocates/admin/InvitationSettingsClient.tsx` | Editing the recipient email no longer clears the retained idempotencyKey. The key is set before the POST and only cleared on a fully successful respon |
| 17  | correctness | `src/lib/advocates/provisioning/validation.ts`                | assertContextMatchesJob() stops enforcing advocateCanPublish (relationshipStatus === 'active' && publicationStatus !== 'suspended') for reconcile jobs |
| 18  | correctness | `src/lib/advocates/publicPresentation.ts`                     | Every advocate portal's logo URL is now composed against the wrong Storage bucket: safeLogoUrl emits `<origin>/storage/v1/object/public/media/logos/<s |
| 19  | correctness | `src/lib/advocates/publicSiteTheme.ts`                        | Swapping the WCAG red and blue luminance coefficients silently breaks every accessible-color derivation for tenant branding. `deriveAccessibleForegrou |
| 20  | correctness | `src/lib/sponsorships/checkout/clientState.ts`                | Starting a new checkout operation no longer discards the bearer receipt of the previous one. A sponsor who completes one checkout, then changes benefi |

## The one file still untested

`src/components/advocates/admin/InvitationSettingsClient.tsx` is loaded by no test in any lane. Unlike the routes above it is a client component, so covering it needs a browser fixture rather than a direct handler invocation.

## Suggested order

The money and security rows deserve attention first, and one stands out: a mutation multiplying every Stripe Hosted Checkout line item by one hundred leaves the whole suite green. The v2 checkout library is heavily tested, but the amount that reaches the provider request builder is evidently asserted nowhere that the mutation touches. That is the highest-value single gap in this register.

Nothing here blocks a merge to `dev`. Each row is a place where a future regression would ship silently, which is a reason to close them deliberately rather than urgently.

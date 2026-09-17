# MVP deferral options

Status: recommendations only. No scope reduction is approved or implemented. Earlier measurements use `b812f8c`; the private-analytics measurement uses `dbf6ded`. All current capabilities remain required.

## Recommended order

| Option | Recommendation | Dedicated application surface inspected | Main cost to the product |
| --- | --- | --- | --- |
| Detailed private analytics | Highest direct reduction in current privacy-release risk, if reduced advocate reporting is acceptable | Three application files, 1,058 physical lines | No private detailed attribution, timing, currency, renewal, refund, or commitment dashboard at launch; retain existing delayed public impact metrics |
| Public impact counters | Simpler deferral if private analytics remains essential | 12 files, 1,352 physical lines | No public fundraising or sponsorship counters at launch; private reporting remains |
| Post-visit attribution and observation | Consider only if direct sponsorship credit is sufficient for launch | Nine exposure and visitor-token files, 1,481 physical lines | Primary-site sponsorships after an advocate visit receive no post-visit credit or year-long observation |
| Staff-managed delegate invitations | Choose for operational reasons, not assumed engineering savings | Five delegate invitation administration files, 1,376 physical lines | Advocates ask staff to change team access; staff need a secure management path |
| Plain-text introductions | Low priority | Editor and validator, 390 physical lines | Header and biography lose rich formatting; logos and colors remain |

These are measured file footprints, not promised deletion totals or estimates of delivery time. They exclude shared wiring, most schema changes, and tests. Removing a capability may require replacement code. The counts include comments and blank lines.

## Detailed private analytics

The dedicated page, dashboard, and repository/validation module total 1,058 physical lines at `dbf6ded`. The `get_advocate_analytics_snapshot` function contains 789 lines. Its dedicated database and application tests total 2,784 lines, but those files and their shared fixture assertions are not automatically disposable. The surrounding migration also defines immutable analytics eligibility used by public metrics and attribution, so deleting that migration wholesale is unsafe.

This option removes the current detailed private disclosure surface rather than claiming its privacy defect is repaired. If approved, remove or revoke the snapshot RPC as well as the page, adjust navigation and role capabilities, and test direct access denial. Merely hiding the menu leaves the database surface accessible. Keep attribution decisions and financial history intact so later reporting can use them. The existing delayed and rounded public metrics could remain as the initial reporting capability; no new manual-report service is assumed.

The cost is substantive: advocates lose private conversion timing, currency detail, collected-fund adjustments, and recurring commitment reporting. This is an alternative to resolving the FF-034 privacy/freshness policy for launch, not approval to ship the current leaking snapshot. Payment accounting (FF-072 and FF-084), operational recovery, and external release gates remain necessary. This option and deferring public counters should be considered separately because choosing both removes the existing aggregate reporting experiences.

## Public impact counters

The dedicated surface includes the public cards, selection editor, portal page and mutation route, and `src/lib/advocates/publicMetrics/` worker stack. Its main migration contains 1,132 lines, but also defines the shared public presentation snapshot, which must remain without the metric fields. Its dedicated database and four application test files total 2,769 lines. Shared permission, audit, presentation, scheduler, and integration assertions also need coordinated changes.

This removes public disclosure releases, delayed metric publication, and their operational recovery burden. It does not remove private analytics or fix FF-034: consecutive private snapshots already reveal isolated contributions, refunds, and renewals. It also does not affect the payment accounting defect FF-072.

## Direct attribution only

The measured files cover exposure capture, the exposure broker and tracker, and visitor-cookie issuance and validation. Additional logic lives inside shared intent, attribution, reporting, and retention migrations, so deleting those migrations wholesale would break payment and identity behavior.

Direct attribution still needs exact active-host authorization, immutable intents, renewal inheritance, staff and same-portal-member exclusions, and historical financial integrity. Removing visitor tracking does not automatically remove the separate identity-exclusion signal or settle the app-wide session-cookie decision. DNS, TLS, exact tenant routing, and provider canaries remain required. This is a material change to the platform's attribution proposition, not a harmless implementation shortcut.

## Staff-managed invitations

The five measured files are the delegate invitation component, its two portal routes, and administration contracts and helpers. They are only the self-service administration slice. The shared invitation delivery, proof issuance, redemption, initial-owner onboarding, and durable receipts still serve the initial owner. The hosted email-proof canary remains necessary.

The existing delegate permission predicate requires tenant membership and assigned permissions; it does not implicitly grant Creator Share staff access. A staff-managed alternative therefore needs an explicit, audited staff authority boundary. Removing the advocate form and directing staff to raw database edits is not an acceptable substitute. Net engineering savings are uncertain until that replacement is designed.

## Plain-text branding

The measured editor and rich-text validator are already small relative to payments, identity, and operations. Plain text would still need length limits, safe rendering, version checks, permissions, audit evidence, and compatibility changes to the branding schema and public projection. It is a reasonable product preference but a weak primary strategy for reducing this PR's complexity.

## Capabilities to preserve

Do not trade away payment correctness, secure guest checkout, cancellation, immutable financial attribution, exact tenant routing, contact protection, or retention enforcement. Deferrals do not excuse unresolved defects in retained capabilities. In particular, neither the partial-adjustment accounting failure nor the current private analytics disclosure should be relabeled as an optional future enhancement.

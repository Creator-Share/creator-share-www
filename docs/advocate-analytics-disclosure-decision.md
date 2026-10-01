# Private analytics disclosure decision

Status: tenant-scoped replacement validated, cross-portal policy and capacity unfinished, October 1, 2026. The owner approved delayed or withheld updates while preserving every metric. FF-034 remains a P1 release gate because cross-portal composition, broader reconstruction review, and capacity bounds remain unfinished. Contact expiry is unchanged and outside this investigation.

## Approved behavior

Private reporting retains direct, post-visit, observed, financial, commitment, contact, and verified-account measures. Reports identify pending and withheld values. A longer delay alone is insufficient: authorized viewers can retain every report, and five contributors to individual totals do not imply five contributors to their differences.

The shared weekly cutoff and public seven-day embargo remain a working cadence assumption. The draft prioritizes gross funds, net funds, refunds, initial funds, renewals, sponsorships, contacts, accounts, dispute details, and commitments, in that order, with official measures before observed measures. The owner has been asked whether to prefer core fundraising figures or withhold an entire conflicting financial panel. No metric is removed. A value may remain withheld across multiple periods; timely release is not guaranteed.

## Why the previous rule was insufficient

The original daily query disclosed a new contact's 733-cent contribution by changing from five contacts and 500 cents to six contacts and 1,233 cents. Separate probes isolated seven-cent refund and renewal changes without adding contacts. Persisted reports and comparisons against every earlier release repaired these cases but did not establish arithmetic closure.

Two later counterexamples passed the pairwise rule:

- Eleven contacts produce gross 10,733, refunds 7,500, dispute debits 8,233, dispute credits 8,233, and net 3,233 USD cents. One contact paid 733, was fully disputed and reinstated, and received no refund. Five others each paid 1,000 and had a 500-cent debit, reinstatement, and refund. Five others each paid 1,000 and had a 1,000-cent debit, reinstatement, and refund. Debits minus refunds, or credits minus refunds, isolate the first contact's 733 cents. The existing guarded complements all pass.
- Five contacts initially contribute 100 cents each, then another 100 each. At the third cutoff, four contribute another 100 and the fifth contributes 107. Every pair of releases changes five contacts, but `1507 - 2 * 1000 + 500 = 7` isolates the fifth contact's variation.

The first reproduction uses the actual candidate query and release writer with synthetic financial rows, normal disclosure triggers, and fixture-only ingestion bypasses. The second uses exact contributor fixtures and the real coordinator. Neither identifies a contact or proves live provider processing.

## Replacement numerical history

The private candidate supplies exact fractions for every reportable financial, count, commitment, segment, and original-currency value. Stable account counts have separate contact and account projections. Canonical contact allocation for an account spanning several contact keys is internal arithmetic bookkeeping, not ownership. Projection tests reconcile displayed totals after aggregate rounding, including five-sevenths-cent adjustments, ten accounts sharing five contacts, and one account spanning several contacts.

The coordinator considers each measure's visible scopes together with all previously disclosed numerical directions and already accepted measures. Unknown numerical fields or contributions that do not reconcile with the report fail closed. Withheld fields retain no new history. The client validates the response structure and visible arithmetic; it does not infer a privacy decision from which fields are null.

Rows represent distinct subjects and columns represent exact contributions to disclosed values. Five disjoint row sets must each span the full row space. This establishes a narrow property: a linear combination of represented columns that is nonzero for one subject must be nonzero for at least five subjects. If it vanished throughout one spanning set, it would vanish throughout the entire row space. Every nonzero combination therefore needs a nonzero contributor in each disjoint set.

Fractions are scaled exactly to integer rows before elimination. No JavaScript number, floating-point division, or per-contact rounding participates. Contact and account matrices are certified separately. The check is conservative: failure to find five spanning sets means unproven and withheld, not proof that a release is unsafe. Greedy selection can miss valid arrangements.

The ledger retains only independent original contribution columns. Every omitted column is an exact combination of retained columns over all subjects. New subjects extend old columns with zeros, preserving those relations. Retained columns never change or disappear. Row-scaled or row-eliminated coordinates are not stored. A sixteen-release regression proves that every original historical vector remains represented after compression; independent rational elimination also verifies the SQL-selected columns on 158 matrices.

The new ledger replaces per-contact fingerprint transitions and the growing list of special-case subtraction guards. It uses forced row security, no API-role table or helper access, immutable rows, release foreign keys, and column-only audit events. History writes recheck that the complete old basis remains a prefix and that the new basis is independent and certified. Private receipts hash the basis at their creation. Later public columns reference that receipt without rewriting its hash.

Public metric candidates now supply their own exact contact columns, including the canonical first sponsorship association used to count distinct children. Before inserting a rounded public receipt, the worker certifies its stronger, unrounded contribution column against the same numerical history. Private and public changes remain in one transaction under the existing tenant release lock. Public selections cannot reset history. The reader still returns only the latest immutable snapshot after current account and tenant permission checks; it cannot calculate a new report. Contact-key version changes still stop advancement pending an approved continuity migration.

## Current evidence

Both complete hosted workflows passed the replacement at `ca4f71f`: [publication 36846429788](https://github.com/Creator-Share/creator-share-www/actions/runs/36846429788) and [WebKit 36846429848](https://github.com/Creator-Share/creator-share-www/actions/runs/36846429848). The native database job passed the full pgTAP suite and the adapted analytics concurrency harness, including worker exclusion, cancellation rollback, stable retry/replay, and account-ban enforcement. This validates the tenant-scoped implementation; it does not repair the cross-portal gap below or establish production capacity.

In-process checks of the replacement establish:

- Strict migration replay and 158 SQL assertions across the actual analytics-query, public-release, and policy suites pass with managed-schema substitutes.
- The actual eleven-contact release keeps gross 10,733, refunds 7,500, and net 3,233 while withholding dispute details and conflicting counts. It retains two independent numerical columns. The policy suite also withholds the three-release reconstruction and preserves safe reports with five contacts in each independent financial shape.
- Private history constrains public publication, independently certified public columns persist, and a later private report cannot ignore that public history. Replays add no duplicate columns; rejected columns, hidden values, and attempts to discard old columns do not advance history.
- The SQL certificate matches 150 independently checked integer cases and 150 exact fractional transformations, including thirty large-integer cases. Compression preserves decisions across those 150 matrices and eight extracted query matrices. Independent rational elimination confirms that the returned original columns span every full matrix.
- Seventeen focused parser and server-rendering contracts pass, including visible core funds with withheld dispute details and counts. These tests launch no local server or browser.

The 5,000-contact first-release probe completes in 4.87 seconds and stores two basis columns. The preceding fingerprint implementation with numerical projection took 9.04 seconds and stored 120,120 changes. Both replays took one millisecond. These are individual synthetic PGlite observations, not controlled throughput comparisons or hosted latency guarantees. Native capacity and multi-tenant execution remain unmeasured. A subsequent synthetic dense-history probe repeats each independent contact pattern five times. Single certification takes 17 ms for 8 columns and 40 subjects, 24 ms for 16 columns and 80 subjects, 130 ms for 32 columns and 160 subjects, 1,083 ms for 64 columns and 320 subjects, and 11,919 ms for 128 columns and 640 subjects. These are individual in-process observations, not a complete release or native latency budget. The 256-column probe remained active beyond 90 seconds and was manually terminated without a result; its configured SQL timeout did not produce an observed interruption in PGlite. This does not establish native PostgreSQL timeout behavior.

## Cross-portal composition finding

A policy probe against the replacement coordinator confirms a remaining gap in its tenant-scoped history. Five contacts each contribute 100 cents to portal A, which releases gross 500. The same five each contribute 100 to portal B, where one contact also renews for 100. Portal B independently releases gross 600 while withholding its initial, renewal, and count details. Comparing gross 600 with gross 500 isolates that contact's 100-cent difference across portals. The schema permits one user to hold memberships in both portals; this example does not identify the contact by itself.

Passing portal A's basis into portal B's coordinator withholds portal B's gross and net and preserves compatible values. The probe uses exact policy fixtures, not a two-portal payment-ingestion or authorization run. A shared cross-portal history is the recommendation presented to the owner. It would couple reporting availability across advocates and require global concurrency, identity-version continuity, and capacity validation. The choice remains pending; this cross-portal property is not protected by the current tenant-scoped implementation.

## Remaining limits and acceptance

The certificate concerns linear support in complete, correct numerical columns. It does not establish differential privacy, protection against arbitrary auxiliary information, or protection against every nonlinear inference. Rounded public disclosures are conservatively modeled by their stronger raw contributions. Cross-tenant overlapping populations, nonlinear inference, and complete privacy and availability behavior still require review. The implemented ledger is tenant scoped.

The tenant-scoped implementation has native authority and concurrency evidence, including no canceled private/public/audit residue. Acceptance still requires resolution of cross-portal composition, broader reconstruction and availability review, complete scope and history coverage, and bounded native execution. A shared-history implementation will require renewed concurrency and identity-version continuity checks. Operational dimension and execution bounds must fail closed without discarding earlier disclosures. FF-034 cannot close merely because the fixed examples or existing workflows pass.


## Unchanged-history append optimization

The append function now skips numerical recertification only when the supplied subject basis exactly equals the immutable stored basis. It still checks service authority, current release identity, tenant serialization, and preservation of every prior column. Any extension requires full certification before insertion. This avoids repeating elimination for unchanged private history and dependent public releases; it does not bound the coordinator or solve dense-history growth. All 160 in-process policy, actual-query, and public-metric assertions pass, including same-width replacement rejection and unsafe extension rejection. The existing hosted harness now records separate 64-, 128-, and 256-column native capacity observations with a 15-second server statement timeout and a 20-second client timeout. Cancellation is recorded separately from certification, and artifacts are published only after database disposal. This observation is not a production execution bound. Hosted validation of the optimization and native observations remains pending.

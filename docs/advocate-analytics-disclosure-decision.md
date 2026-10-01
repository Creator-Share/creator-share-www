# Private analytics disclosure decision

Status: replacement implementation under validation, October 1, 2026. The owner approved delayed or withheld updates while preserving every metric. FF-034 remains a P1 release gate pending native integration, concurrency, broader reconstruction review, and capacity evidence. Contact expiry is unchanged and outside this investigation.

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

Both complete hosted workflows passed the arithmetic foundation and candidate projection at `792c17c`: [publication 36841503410](https://github.com/Creator-Share/creator-share-www/actions/runs/36841503410) and [WebKit 36841503427](https://github.com/Creator-Share/creator-share-www/actions/runs/36841503427). Those results precede the replacement coordinator and numerical ledger. Native validation of the replacement remains pending.

In-process checks of the replacement establish:

- Strict migration replay and 158 SQL assertions across the actual analytics-query, public-release, and policy suites pass with managed-schema substitutes.
- The actual eleven-contact release keeps gross 10,733, refunds 7,500, and net 3,233 while withholding dispute details and conflicting counts. It retains two independent numerical columns. The policy suite also withholds the three-release reconstruction and preserves safe reports with five contacts in each independent financial shape.
- Private history constrains public publication, independently certified public columns persist, and a later private report cannot ignore that public history. Replays add no duplicate columns; rejected columns, hidden values, and attempts to discard old columns do not advance history.
- The SQL certificate matches 150 independently checked integer cases and 150 exact fractional transformations, including thirty large-integer cases. Compression preserves decisions across those 150 matrices and eight extracted query matrices. Independent rational elimination confirms that the returned original columns span every full matrix.
- Seventeen focused parser and server-rendering contracts pass, including visible core funds with withheld dispute details and counts. These tests launch no local server or browser.

The 5,000-contact first-release probe completes in 4.87 seconds and stores two basis columns. The preceding fingerprint implementation with numerical projection took 9.04 seconds and stored 120,120 changes. Both replays took one millisecond. These are individual synthetic PGlite observations, not controlled throughput comparisons or hosted latency guarantees. Dense changing history, multi-tenant execution, and native capacity remain unmeasured.

## Remaining limits and acceptance

The certificate concerns linear support in complete, correct numerical columns. It does not establish differential privacy, protection against arbitrary auxiliary information, or protection against every nonlinear inference. Rounded public disclosures are conservatively modeled by their stronger raw contributions. Cross-tenant overlapping populations, nonlinear inference, and complete privacy and availability behavior still require review. The implemented ledger is tenant scoped.

Acceptance requires native authority and concurrency checks, no canceled private/public/audit residue, both known reconstructions withheld, preservation of every metric and safe-report availability, complete scope and history coverage, and bounded native execution. Operational dimension and execution bounds must fail closed without discarding earlier disclosures. FF-034 cannot close merely because the fixed examples or existing workflows pass.

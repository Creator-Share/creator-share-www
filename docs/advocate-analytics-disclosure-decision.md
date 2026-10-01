# Private analytics disclosure decision

Status: approved for implementation, October 1, 2026. The owner accepts delayed or withheld updates for low-volume advocates while preserving every metric. Implementation and acceptance evidence remain pending.

## Confirmed disclosure

`public.get_advocate_analytics_snapshot` recomputes exact cumulative amounts through the preceding UTC day. Its suppression rules consider contacts inside each snapshot and complements inside the same response. They retain no previously disclosed private snapshot and do not check the number of contacts contributing to the difference between releases.

An isolated reproduction executed the current function against the existing analytics test fixture with five distinct historical contacts, each contributing 100 USD cents, and one additional contact contributing 733 cents during the next reporting day. All six sponsorships were direct, one-time USD payments. The function returned:

| Snapshot | Suppressed | Contacts | Initial, gross, and net USD cents |
| --- | --- | ---: | ---: |
| First day | false | 5 | 500 |
| Following day | false | 6 | 1,233 |

Subtracting responses reveals the new contact's exact 733-cent contribution. The API also discloses that the contact count increased by one. It does not directly disclose a name, email, or event time; identifying that contact requires additional information. The day of inclusion is observable from the change.

The reproduction used the actual migration function in in-process PostgreSQL with minimal Auth and Storage stubs. Fixture seeding followed the existing pgTAP test's trigger-disabled preparation. For the second query only, the function's local `v_as_of` expression advanced by one day; every aggregation, eligibility, and suppression expression stayed unchanged. This is concrete query evidence, not a hosted authorization, payment-ingestion, or concurrency test. No provider or hosted database was contacted.

## Existing-contact changes

Two additional executions kept the contact count fixed at five and introduced no new sponsorship. Each contact already contributed to the relevant historical measure, so per-measure contact suppression also passed.

| Change | First snapshot | Following snapshot | Revealed difference |
| --- | --- | --- | --- |
| One further refund | Refunds 50 cents; net 450 cents | Refunds 57 cents; net 443 cents | Seven-cent refund |
| One further renewal | Renewals 50 cents; gross and net 550 cents | Renewals 57 cents; gross and net 557 cents | Seven-cent renewal |

Both official cells remained unsuppressed, with five contacts and five sponsorships. These reproductions use the same isolated fixture and clock method described above. They establish that a new-contact release threshold alone is insufficient, and that suppressing only the adjustment field can still leave its difference visible through net or gross totals.

## Why the current mitigation is insufficient

A one-day delay shifts when disclosure occurs. A five-contact cumulative cohort does not imply five contributors to its change. Removing filters and exports does not prevent an authorized viewer from retaining yesterday's result. Rounding alone can still reveal isolated changes at bucket boundaries. The existing FF-034 therefore applies to the current MVP, not only to future filters or exports.

## Proposed repair

Preserve every metric but release private updates only when coordinated disclosure rules allow the change. The design needs a durable record of disclosed values, a shared cutoff across related totals and segments, and sufficient distinct contributors to each newly visible measure. Refund, dispute, renewal, and commitment changes need their own contributor analysis; a new-sponsorship threshold alone does not protect them. Original-currency tables and public impact releases must be reviewed together with private totals so one surface cannot reveal a suppressed difference from another.

This necessarily changes freshness for low-volume advocates. Exact daily cumulative amounts and a guarantee against isolating a single changed contribution cannot both be promised in the demonstrated case. The owner approved coordinated delayed disclosure on October 1, 2026. The implementation must preserve every metric and identify delayed or withheld updates explicitly.

## Required acceptance evidence

- Two consecutive releases cannot reveal a single new contact's amount through direct subtraction under the approved policy.
- Repeated payments by one contact do not satisfy a distinct-contact advancement threshold.
- Refunds, dispute restoration, renewals, and cancellation commitments receive the same longitudinal review.
- Totals, segments, original currencies, verified-account counts, and public impact cannot supply a missing complement.
- Repeated reads, concurrent refreshes, delayed gateway events, and membership changes do not reset disclosure history.
- Every existing metric remains available, with explicit delayed or withheld states where required.

This repair must not invent formally private guarantees from a cohort heuristic. The final policy must state which reconstruction attacks it addresses and what auxiliary-information risks remain.


## Internal cutoff boundary

Snapshot calculation now has a private candidate builder with an explicit complete UTC-day cutoff. Anonymous, authenticated, and service API roles cannot execute it. The public reader keeps its original one-argument contract and rechecks the current account and tenant permission before returning the latest persisted release. Before the first release it returns a fixed pending response with no cutoff or financial values.

The existing public metric worker now calculates the private release first, under its shared weekly cutoff, and keeps both changes in one transaction. A public metric cannot advance unless the corresponding private measure is visible at that cutoff. Historical public values remain available with their original cutoff. Changing public selections does not create a new disclosure.


## Disclosure ledger candidate

The current candidate records exact per-contact contribution fingerprints for totals, segments, currencies, and their intersections. Repeated payments by one contact remain one contributor. Private release receipts are append only; a separate append-only log stores only changed contributor fingerprints. Reconstructing a baseline therefore does not require copying every historical contact into every weekly receipt. Both tables force row security and deny API-role access. Audit rows record the release operation without copying contributor material.

The gate checks all prior disclosed states, including nonconsecutive releases. Its transition-count calculation catches a five-contact loss followed by five restorations that leaves only one contact's seven-cent loss when compared with an earlier release. Withheld fields retain their last disclosed baseline. Dependency checks cover net funds, gross funds, remaining disputes, recurring commitment projections, and count complements. Contact-key version changes stop advancement pending an explicit continuity migration.

The concrete policy tests cover the original 733-cent new-contact disclosure, existing-contact refunds and renewals, repeated single-contact activity, advancement after five contacts change, cross-surface masking, immutable history, and nonconsecutive restoration. The production query also proves that five sponsorship rows from one contact remain one contributor. The real release writer passes replay, append-only, and reconstructed-baseline digest checks in-process. A separate full-snapshot reference agrees with the sparse history algorithm across 16 releases and 25 candidate states, including omitted contributions, restorations, and unchanged weeks. These checks use PostgreSQL with managed-schema stubs; hosted validation remains required.

The candidate now connects the reader, existing scheduled worker, strict version-two parser, and dashboard. Pending reports and withheld count or amount changes have explicit presentation. The working cadence assumption remains a shared weekly cutoff with the existing public seven-day embargo; the owner has been asked whether daily private reporting is preferred. This implementation requires hosted validation, concurrency evidence, broader reconstruction review, and performance measurements before FF-034 can close. It is a defined cohort policy, not a claim of differential privacy or protection against arbitrary auxiliary information.

The integration tests preserve the original calculation assertions through the private candidate builder, separately prove that an authorized public read cannot create a release, compare the public reader with the immutable receipt, and reject a subsequently banned reader. The public-metric fixture proves that safe gross funds advance while incompatible count releases stay at their prior cutoff or remain pending. The attribution settlement integration runs the real shared worker before reading private analytics. Seventeen application tests include actual server rendering of pending and partially withheld reports. These are local, provider-free checks; hosted results are recorded separately.

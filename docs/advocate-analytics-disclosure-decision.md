# Private analytics disclosure decision

Status: proposed, owner decision pending. No reporting behavior has changed.

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

This necessarily changes freshness for low-volume advocates. Exact daily cumulative amounts and a guarantee against isolating a single changed contribution cannot both be promised in the demonstrated case. The pending owner question asks whether to batch updates for privacy or explicitly accept the narrower disclosure guarantee. Neither choice has been implemented or treated as approved.

## Required acceptance evidence

- Two consecutive releases cannot reveal a single new contact's amount through direct subtraction under the approved policy.
- Repeated payments by one contact do not satisfy a distinct-contact advancement threshold.
- Refunds, dispute restoration, renewals, and cancellation commitments receive the same longitudinal review.
- Totals, segments, original currencies, verified-account counts, and public impact cannot supply a missing complement.
- Repeated reads, concurrent refreshes, delayed gateway events, and membership changes do not reset disclosure history.
- Every existing metric remains available, with explicit delayed or withheld states where required.

This repair must not invent formally private guarantees from a cohort heuristic. The final policy must state which reconstruction attacks it addresses and what auxiliary-information risks remain.

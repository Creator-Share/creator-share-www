# Private analytics disclosure decision

Status: implementation incomplete, October 1, 2026. The owner approved delayed or withheld updates while preserving every metric. FF-034 remains a P1 release blocker because the implemented policy permits both cross-measure subtraction and three-release reconstruction. Contact expiry is unchanged and outside this investigation.

## Approved behavior and current implementation

Private reporting must retain direct, post-visit, observed, financial, commitment, contact, and verified-account measures. Reports must identify pending and withheld values. A longer delay alone is insufficient: authorized viewers can retain every report, and five contributors to an individual total do not imply five contributors to its differences.

The current implementation has these boundaries:

- A private candidate builder accepts an internal complete UTC-day cutoff. API roles cannot execute it. The public reader retains its one-argument contract, rechecks current account health and tenant permission, and returns the latest persisted release or a fixed pending response.
- The existing public-metric worker writes private and public releases in one transaction at a shared cutoff. Public advancement requires matching private disclosure. Existing public values retain their original cutoff, and changing selections creates no new release.
- Append-only private tables retain release receipts and changed per-contact fingerprints. API roles have no table access, row security is forced, and audit entries omit contributor material. Withheld measures keep their last disclosed baseline. Contact-key version changes stop advancement pending an approved continuity migration.
- The coordinator compares each measure with every prior disclosed state, including nonconsecutive releases. It coordinates totals, segments, original currencies, intersections, known financial complements, and count dependencies. The parser and dashboard support pending and partially withheld reports.

The shared weekly cutoff and public seven-day embargo remain a working cadence assumption. The owner has also been asked whether unsafe joint financial reports should prioritize core fundraising figures or withhold the whole financial panel. That presentation choice does not remove the requirement to repair the arithmetic boundary.

## What existing evidence proves

The original daily query disclosed a new contact's 733-cent contribution by changing from five contacts and 500 cents to six contacts and 1,233 cents. Separate probes isolated seven-cent refund and renewal changes without adding contacts. Current policy tests cover those cases, repeated payments by one contact, advancement after five contacts change, retained baselines, and a nonconsecutive restoration that leaves one contact's loss. A full-snapshot oracle agrees with the sparse history calculation across sixteen releases and twenty-five candidate states. Agreement proves the implementation of that pairwise rule, not its sufficiency.

The real release writer passes replay and immutable-history checks. Reader and integration tests exercise authority, account bans, public/private coordination, attribution settlement, and pending or withheld rendering. Hosted concurrency evidence at `ddd661d`, database job 110233824338, proves competing-worker exclusion, no partial visibility, cancellation rollback without private/public/audit residue, stable retry and replay, and committed account-ban enforcement.

Both complete hosted workflows pass at `05d4d31`: [publication 36834986995](https://github.com/Creator-Share/creator-share-www/actions/runs/36834986995) and [WebKit 36834986975](https://github.com/Creator-Share/creator-share-www/actions/runs/36834986975). These checks do not cover the unresolved examples below. None of these results establishes differential privacy, protection against arbitrary auxiliary information, or production activation readiness.

## Confirmed cross-measure disclosure

At `42fbe55`, unchanged in `05d4d31`, the actual candidate builder and release writer expose the following eleven-contact fixture. Amounts are USD cents. Each contact has one initial payment. A dispute debit precedes reinstatement, which precedes refund; all events fall before the cutoff.

| Contacts | Initial per contact | Dispute debit per contact | Dispute credit per contact | Refund per contact | Final net per contact |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 733 | 733 | 733 | 0 | 733 |
| 5 | 1,000 | 500 | 500 | 500 | 500 |
| 5 | 1,000 | 1,000 | 1,000 | 1,000 | 0 |

The unsuppressed official cell reports eleven sponsorships and contacts, gross 10,733, refunds 7,500, debits 8,233, credits 8,233, and net 3,233. Debits minus refunds and credits minus refunds each reveal the first contact's 733-cent residual; the other ten contributions cancel exactly. Gross minus debits has five contributors, gross minus refunds and net have six, and open dispute balance is zero. Every currently implemented guard can therefore pass.

The reproduction uses real migrations, the existing public-metric fixture, and normal triggers during disclosure in PGlite. Fixture construction bypasses ingestion and uses managed-schema substitutes. This proves query behavior, not live provider processing, native capacity, or identification of the contact. A bounded enumeration of coefficients from minus one through one also finds these subtractions; redundant vectors are not separate incidents.

Earlier guards repaired gross-minus-debits disclosure after reinstatement and a four-contact gross-minus-refunds residual despite zero net. Their tests still pass. Those repairs did not establish arithmetic closure, and this counterexample shows why extending the list one expression at a time is insufficient.

## Confirmed three-release disclosure

The actual coordinator and stored-history comparison also permit this sequence. Five contacts contribute 100 cents each initially. Each then contributes another 100 cents. At the third cutoff, four contribute another 100 cents and the fifth contributes 107 cents. Contact and sponsorship counts remain five; renewals do not create new sponsorships.

| Release | Initial total | Cumulative renewals | Gross and net |
| --- | ---: | ---: | ---: |
| First | 500 | 0 | 500 |
| Second | 500 | 500 | 1,000 |
| Third | 500 | 1,007 | 1,507 |

Every pair of releases differs in five contacts, so the current history function returns no unsafe measure and all three reports remain visible. Yet `1507 - 2 * 1000 + 500 = 7` cancels the four regular trajectories and isolates the fifth contact's seven-cent variation. This does not identify that contact or disclose its entire payment.

The in-process probe uses the existing policy fixture's exact contributor maps, the real coordinator, and append-only history tables with normal disclosure triggers. It does not exercise the complete payment ingestion or candidate aggregation path. It establishes that checking every pair of historical states is insufficient even when that algorithm is implemented correctly.

## Systematic certificate experiment

A temporary exact-arithmetic model treats contacts as rows and disclosed contributions as columns. A column may represent a financial measure at a particular scope and release. It seeks five disjoint row sets, each spanning the full matrix row space.

This is a sufficient condition for a narrow, explicit property: any linear combination of the represented columns that is nonzero for at least one contact must be nonzero for at least five contacts. If it were zero throughout one spanning set, linearity would make it zero throughout the row space. A nonzero combination therefore needs a nonzero contributor in each disjoint set. This argument depends on complete, correct numerical contribution columns; fingerprints alone cannot establish it.

The prototype rejects the eleven-contact matrix containing gross, refunds, debits, and credits. It certifies gross, refunds, and net together in that fixture. It rejects the three-release trajectory above, as well as one-contact and four-contact historical changes, while accepting the modeled five-contact change. An independent rational-elimination oracle checked 150 SQL matrices, including thirty cases with integers beyond JavaScript's exact range. It validated ranks and disjoint spanning witnesses for all 68 accepted matrices; bounded signed-combination checks also passed. These are model results, not a production privacy repair.

The simplest greedy construction can reject safe matrices. For threshold two, rows `(1,0), (0,1), (1,1), (1,1)` admit two disjoint spanning pairs, but greedy selection of the first pair leaves only parallel rows. Failure to find a certificate must mean withheld or unproven, not a claim that disclosure is unsafe. The condition itself is conservative even with a complete search.

Remaining design work:

- Represent every relevant disclosed scope and historical value together; certifying only a new snapshot or comparing pairs leaves known gaps. Review counts, commitments, overlapping contact populations, original currencies, and public rounded releases explicitly.
- Use exact rational contributions, with integer-preserving elimination. Independently rounded contact values can invent or erase cancellations.
- Define a fixed metric priority or panel policy and test safe-report availability. A certificate must not silently remove a product capability or promise timely updates it cannot deliver.
- Review the privacy and storage consequences of retaining numerical contribution history instead of fingerprints. Bound dimensions, execution, and failure behavior without discarding already disclosed history.
- Prove actual database integration, authority, concurrency, public/private coordination, and workload capacity before replacing the current implementation. Do not infer protection against nonlinear inference or arbitrary outside knowledge from the linear property.

## Capacity evidence and acceptance

Current implementation measurements use synthetic PGlite fixtures, not hosted latency. With 5,000 direct contacts plus the existing fixture cohorts, intermediate JSON aggregation reduced candidate calculation from 17.56 to 20.49 seconds to 1.91 to 1.97 seconds with identical output. Flattened fingerprint comparison reduced a complete first release from 19.39 to 5.77 seconds. Adding the two existing financial-complement guards increased it to 8.13 seconds and 120,120 stored contribution changes. Replay took one millisecond. Earlier unchanged historical releases added no contribution rows; changing-history and multi-tenant native capacity remain unmeasured.

The temporary SQL certificate took seventeen milliseconds for a synthetic 5,000-row, five-column matrix and fifty-two milliseconds for twenty columns. A 5,000-row, sixty-four-column fixture with rank four, which forces a complete initial contact scan, took 483 milliseconds. These fixtures do not measure candidate extraction, fractional normalization, changing dense histories, disclosure selection, persistence, or a complete release. They are feasibility observations only.

Acceptance requires both confirmed reconstruction cases to be withheld without breaking safe reports, preservation of every metric and explicit withheld states, replay and authority invariants, coordinated public and private surfaces, retention of all relevant disclosure history, and bounded native execution. FF-034 cannot close because a fixed example passes, a delay increases, or existing workflows are green.

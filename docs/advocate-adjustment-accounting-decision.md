# Partial foreign-currency adjustment decision

Status: proposed, September 17, 2026. The owner accounting-policy question is pending. No refund allocation change is approved or implemented by this document. FF-072 remains a release blocker.

## Confirmed defect

The active adjustment code rejects a two-cent AUD refund on a payment of 3,500 AUD cents with an original normalized value of 2,500 USD cents and a rate of 1.4. No whole USD-cent amount converts back to exactly two AUD cents. Both provider adapters and database ingestion/settlement require this impossible equality for some legitimate adjustments.

The provider can already have completed the refund. The application classifies the failure as permanent, retains a quarantined event, and acknowledges delivery. The financial ledger then omits the adjustment. Repair must include recovery of those retained events and cannot rely on the provider retrying an acknowledged delivery.

## Measured amount domain at current rates

Executed the active Stripe adjustment helper for every positive partial-refund amount below a payment normalized to 2,500 USD cents, using the current configured rates and exact forward conversion. Each case starts from the same untouched original payment; this is a single-adjustment domain scan, not a cumulative-settlement or provider-network test.

| Currency | Rate | Original charge in minor units | Partial amounts examined | Rejected by round-trip boundary |
| --- | ---: | ---: | ---: | ---: |
| USD | 1 | 2,500 | 2,499 | 0 |
| AUD | 1.4 | 3,500 | 3,499 | 1,000 |
| GBP | 0.74 | 1,850 | 1,849 | 0 |
| EUR | 0.86 | 2,150 | 2,149 | 0 |

The AUD failures include whole-dollar refunds of 1, 6, 8, 13, 15, 20, 22, 27, 29, and 34 AUD. For example, 71 USD cents converts to 99 AUD cents, while 72 converts to 101; a 100-cent AUD refund has no whole USD-cent preimage. This is not confined to unusually tiny adjustments. The counts describe representability at the tested rates and original amount, not observed refund frequency. Zero failures in the other single-adjustment scans do not establish correct cumulative allocation, dispute restoration, or behavior at different rates.

## Required invariants

- Preserve the exact original-currency minor units received from the authenticated provider chain.
- Preserve the original payment's immutable rate and normalized USD total.
- A full refund must reverse that original normalized total exactly.
- Multiple partial adjustments must never invent additional provider money through rounding or duplicate delivery.
- A resolved dispute must restore its own outstanding debit, including partial credits and interleaved refunds.
- Currency bounds, provider-account identity, original-movement identity, replay, and concurrency authority remain enforced.
- Allow zero normalized USD-cent deltas where a legitimate provider movement is smaller than one USD cent. Do not omit the provider movement merely because its normalized display delta is zero.
- Reporting must disclose how rounding differences enter normalized totals and categories. Exact provider amounts remain separately available.

## Why one rounding expression is insufficient

A cumulative calculation can reconcile the overall USD net while misallocating category totals. For the same 3,500 AUD-cent payment, independently applying `round(net AUD cents * 2500 / 3500)` produces:

| Event | AUD-cent movement | USD-cent movement from cumulative net | Remaining AUD cents | Remaining USD cents |
| --- | ---: | ---: | ---: | ---: |
| Dispute debit | -1 | -1 | 3499 | 2499 |
| Refund | -1 | 0 | 3498 | 2499 |
| Dispute credit | 1 | 0 | 3499 | 2499 |

The provider dispute is fully restored, but its summed USD debit and credit still show a one-cent loss. Conversely, forcing the credit to restore the earlier USD cent changes the cumulative normalized total unless the rounding residual is recorded elsewhere. Replacing the existing helper with a simple inverse rate therefore does not complete this repair.

The earlier cumulative-cent recommendation is insufficient without a separate residual allocation contract. The preferred proposal is now to derive exact rational normalized values from the immutable original payment and round at an explicitly defined reporting boundary. This avoids assigning an arrival-order-dependent rounding residual to an otherwise fully restored dispute. It still needs an approved cross-payment aggregation and display policy; neither option permits silently discarding adjustments.

## Alternative using existing immutable payment facts

A fractional representation need not add a separately rounded normalized amount to every adjustment. The original payment already records normalized USD cents `B` and charged minor units `A`; an adjustment of `x` original-currency minor units can derive the exact rational USD-cent value `B * x / A`. The original movement reference supplies the immutable denominator and conversion evidence. Integer numerator arithmetic preserves exact sums within that payment, a full refund reverses `B`, and an equal dispute debit and credit cancel even with an intervening refund.

A PostgreSQL `numeric` quotient is not itself an exact rational representation. An isolated PostgreSQL-engine check returned `0.71428571428571428571` for `2500::numeric / 3500`; multiplying that quotient by 3,500 returned `2499.99999999999999998500`, while aggregating the integer numerator before division returned exactly 2,500. Keep original minor units and integer numerators authoritative, aggregate within the original payment before presentation division, and define precision and rounding for aggregation across different denominators. Merely changing the ledger column to `numeric` would not establish the stated exact-sum property.

This uses the ratio of the actual original amounts, including original charge rounding. It is a proposed accounting convention, not a claim that dividing by the quoted conversion rate gives the same result. Cross-payment aggregation and whole-cent presentation still need explicit rounding rules. Independently rounded category displays can differ from a rounded net total; the reporting contract must explain or reconcile that residual. Existing positive whole-cent ledger constraints and consumers would still need coordinated changes.

A standalone BigInt model examined 11,534 positive adjustment amounts, including full refunds, across five original-amount pairs, and 50,000 amount combinations for the ordering dispute debit, refund, then matching dispute credit. Exact numerator sums reconciled in every case. These are mathematical model checks, not production adapter, database, concurrency, event-order permutation, or provider evidence. No accounting behavior has changed. This proposal remains subject to the owner accounting decision.

## Arrival-order model extension

A second standalone BigInt model examined all six arrival permutations of one dispute debit, one refund, and the matching full dispute credit. It used the same five original-amount pairs, with dispute and refund amounts independently ranging from 1 through 100 provider minor units: 300,000 scenarios. Credits arriving before the debit were deferred until the end of the sequence, then applied; replay of committed event identities added no movement in the model.

Exact rational sums preserved the final provider net and restored the dispute numerator to zero in every scenario. The simple cumulative whole-cent model left a nonzero dispute category balance in 19,960 scenarios: 9,980 with debit/refund/credit arrival and 9,980 with credit/debit/refund arrival followed by deferred credit settlement. This demonstrates dependence on settlement ordering, not an estimated frequency of production failures. The model assumes sufficient bounded principal and one original payment. It does not resolve excess or grouped disputes in FF-084.

These are model properties, not assertions about current database retry scheduling, idempotency, concurrent settlement, or provider delivery. The existing hosted recovery regression remains separate evidence for the implemented out-of-order event boundary. The accounting recommendation must still be implemented and tested across adapters, ingestion, settlement, reporting, and retained-quarantine recovery after approval.

## Implementation boundaries to change together

| Boundary | Current constraint or responsibility |
| --- | --- |
| Stripe and PayPal adjustment adapters | Derive a positive whole USD-cent amount that must reproduce the exact provider amount. |
| Verified gateway event ingestion | Freezes normalized amount facts before settlement and requires the same round-trip equality. |
| Financial adjustment settlement | Rechecks normalized facts, serializes by original payment, checks remaining dispute credit, and bounds both currency totals. |
| Financial movement and transaction ledger shapes | Require positive normalized amounts for canonical movements. Zero normalized deltas need an explicit valid representation. |
| Sponsor history, private analytics, public metrics, and audit evidence | Consume movement classifications and normalized totals. Their meanings must remain consistent with the chosen allocation policy. |
| Quarantine and replay | Must recover retained authentic events after the corrected policy is installed without bypassing current provider-chain or idempotency checks. |

The settlement function already holds an original-payment advisory transaction lock. Preserve it and return committed replay evidence before making a new allocation decision. An event's arrival order must not allow an already committed movement to be rewritten.

## Acceptance evidence

Run both providers and every supported currency through single partial refunds, repeated one-minor-unit refunds, final full refunds, partial reversals, dispute debits and credits, refund/dispute interleavings, duplicate events, duplicate movement identities, conflicting evidence, and concurrent settlement. Assert original-currency totals, normalized totals, per-dispute restoration, reporting projections, and append-only audit evidence. Include the two-cent AUD example and the interleaving above. Existing tests that expect rejection of unrepresentable slices must change to the approved behavior.

Exercise retained-quarantine recovery separately. A repaired future webhook path does not establish reconciliation of previously acknowledged events. No live provider operation is authorized by this review document.

## Quarantine recovery boundary

Current quarantines are terminal `ignored` records carrying `requires_operational_review`; ordinary worker claims exclude them. Their encrypted payloads remain subject to the 90-day retention deadline. Fixing conversion arithmetic does not itself reprocess those records, and a successful worker run is not a quarantine health check. The payment runbook now defines a sanitized ingress signal, protected aggregate inventory, and monitoring canary. The accounting repair still needs an explicit audited recovery path before it can be considered complete.

## Disputes can exceed the original principal (FF-084)

The accounting model has another independent constraint: it assumes every adjustment belongs wholly to one payment and that payment's aggregate net remains between zero and its original gross. Stripe documents larger disputes caused by currency changes, disputes that combine recurring charges, and full-charge disputes after partial refunds. These are supported provider outcomes, not necessarily forged amounts. [Stripe dispute lifecycle](https://support.stripe.com/embedded-connect/questions/how-disputes-work?locale=en-GB)

A temporary server-free probe reused the current Stripe adapter fixtures with a 1,250-cent captured charge and a matching 1,300-cent dispute withdrawal. The active adapter rejected it with permanent `provider-fact-mismatch` before ingestion. The webhook handler sends permanent verified failures to quarantine. Independently, `apply_sponsorship_financial_adjustment` rejects any aggregate net below zero, so allowing the adapter input alone would not fix settlement. The probe is evidence of current rejection, not a desired rejection contract or a live provider incident.

The repair must distinguish sponsor principal and attribution from actual provider cash movements. An authenticated loss must remain recorded even when principal attribution is exhausted. A dispute covering several recurring charges also needs explicit allocation or an unallocated reconciliation state; attributing the entire loss to one intent can misstate cohort reports. Preserve exact event identity, provider-account binding, original charge evidence, and bounded reinstatement authority. Do not merely remove amount checks or silently clamp the loss to zero.

The existing owner accounting decision must cover these semantics before implementation. Add excess disputes, full-charge disputes after partial refunds, disputes spanning recurring charges, and their reinstatements to acceptance evidence. This finding is separate from the whole-cent representability defect in FF-072.

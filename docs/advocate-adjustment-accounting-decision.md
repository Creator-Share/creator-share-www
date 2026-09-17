# Partial foreign-currency adjustment decision

Status: proposed, September 17, 2026. The owner accounting-policy question is pending. No refund allocation change is approved or implemented by this document. FF-072 remains a release blocker.

## Confirmed defect

The active adjustment code rejects a two-cent AUD refund on a payment of 3,500 AUD cents with an original normalized value of 2,500 USD cents and a rate of 1.4. No whole USD-cent amount converts back to exactly two AUD cents. Both provider adapters and database ingestion/settlement require this impossible equality for some legitimate adjustments.

The provider can already have completed the refund. The application classifies the failure as permanent, retains a quarantined event, and acknowledges delivery. The financial ledger then omits the adjustment. Repair must include recovery of those retained events and cannot rely on the provider retrying an acknowledged delivery.

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

Cumulative cent allocation remains the initial recommendation, subject to an explicit treatment of dispute restoration and rounding residuals. Sub-cent storage is an alternative, but still needs precision, residual, full-refund, and reporting rules. Neither option permits silently discarding adjustments.

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

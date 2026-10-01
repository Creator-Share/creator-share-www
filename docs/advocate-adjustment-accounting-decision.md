# Partial foreign-currency adjustment decision

Status: approved for implementation, October 1, 2026. The owner approved fractional internal normalization from immutable original amounts, rounding at reporting boundaries, and separate recording of provider losses beyond attributed principal. FF-072 and FF-084 remain release blockers until the coordinated implementation and recovery checks pass.

## Confirmed defect

The implementation reviewed before the October 1 repair rejected a two-cent AUD refund on a payment of 3,500 AUD cents with an original normalized value of 2,500 USD cents and a rate of 1.4. No whole USD-cent amount converts back to exactly two AUD cents. Both provider adapters and database ingestion/settlement required this impossible equality for some legitimate adjustments. The implementation below removes that requirement and adds retained financial-adjustment recovery. Live recovery evidence and the excess-loss cases remain incomplete.

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

This uses the ratio of the actual original amounts, including original charge rounding. The owner approved this convention; dividing by the quoted conversion rate need not give the same result. The exact aggregate below supplies cross-payment aggregation and rounds displayed half cents away from zero. Independently rounded category displays can differ from a rounded net total; the reporting contract must explain or reconcile that residual. The implementation below coordinates the ledger constraints and reporting consumers.

A standalone BigInt model examined 11,534 positive adjustment amounts, including full refunds, across five original-amount pairs, and 50,000 amount combinations for the ordering dispute debit, refund, then matching dispute credit. Exact numerator sums reconciled in every case. These are mathematical model checks, not production adapter, database, concurrency, event-order permutation, or provider evidence. The model itself changed no accounting behavior. The owner approved this direction on October 1, 2026; implementation evidence appears below.

## Arrival-order model extension

A second standalone BigInt model examined all six arrival permutations of one dispute debit, one refund, and the matching full dispute credit. It used the same five original-amount pairs, with dispute and refund amounts independently ranging from 1 through 100 provider minor units: 300,000 scenarios. Credits arriving before the debit were deferred until the end of the sequence, then applied; replay of committed event identities added no movement in the model.

Exact rational sums preserved the final provider net and restored the dispute numerator to zero in every scenario. The simple cumulative whole-cent model left a nonzero dispute category balance in 19,960 scenarios: 9,980 with debit/refund/credit arrival and 9,980 with credit/debit/refund arrival followed by deferred credit settlement. This demonstrates dependence on settlement ordering, not an estimated frequency of production failures. The model assumes sufficient bounded principal and one original payment. It does not resolve excess or grouped disputes in FF-084.

These are model properties, not assertions about current database retry scheduling, idempotency, concurrent settlement, or provider delivery. The existing hosted recovery regression remains separate evidence for the implemented out-of-order event boundary. The accounting recommendation must still be implemented and tested across adapters, ingestion, settlement, reporting, and retained-quarantine recovery under the approved policy.

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

Quarantines now use a distinct unresolved `quarantined` state. They retain authenticated evidence and an operational review reason without consuming the event's unique final application receipt. Ordinary workers cannot claim them, and ordinary no-effect settlement cannot finalize them. Duplicate deliveries must match the original evidence. Payload retention remains unchanged.

The previous implementation called `ignore_sponsorship_payment_gateway_event`, creating an immutable application receipt and terminal `ignored` state before financial interpretation succeeded. The undeployed schema now reserves that final disposition for verified events with no financial effect. Financial application receipts remain immutable and unique.

Financial-adjustment ingestion now supports explicit recovery admission after its existing validation succeeds. Admission preserves the original ciphertext, hashes, verification time, occurrence time, redacted delivery evidence and retention deadline. A private immutable receipt binds the operation ID, interpretation version and derived-fact hash to the same transaction that makes the event claimable. Ordinary delivery cannot request this transition implicitly. An explicit internal operator request now prepares financial adjustments and admits them under a persistent operation identity. Existing gateway workers perform settlement; this requires no second recovery queue. Other event families remain unsupported by this endpoint. Duplicate delivery, concurrent recovery, prior application, unavailable payload, current provider-account binding, and failed interpretation remain required cases. No retention deadline is extended and no live provider execution is authorized.

The recovery decoder now checks authenticated ciphertext, exact delivery bytes, immutable event digest, event identity, verification method, configured regional scope, Stripe mode, and the existing payload expiry. It rejects erased or incomplete evidence and returns sanitized errors. PayPal unsupported-event quarantine deliberately retains minimized evidence, so those records cannot reconstruct a webhook from storage. This helper makes no provider call and grants no settlement authority. The internal payment-worker credential now protects an explicit operator endpoint that connects the decoder to the existing adapters and atomic admission. Hosted endpoint evidence and live recovery canaries remain pending.

Provider immutable-event digests now use one serializer with UTF-16 key ordering, independent of process locale and ICU collation. The previous duplicated serializers produced different hashes for identical evidence under English, Turkish and Swedish locales. The replacement preserves JSON omission rules and rejects non-JSON values. This changes the undeployed digest contract; the owner has confirmed no Advocate migrations have been applied to staging or production. It is not a migration strategy for existing event hashes.

## Disputes can exceed the original principal (FF-084)

The accounting model has another independent constraint: it assumes every adjustment belongs wholly to one payment and that payment's aggregate net remains between zero and its original gross. Stripe documents larger disputes caused by currency changes, disputes that combine recurring charges, and full-charge disputes after partial refunds. These are supported provider outcomes, not necessarily forged amounts. [Stripe dispute lifecycle](https://support.stripe.com/embedded-connect/questions/how-disputes-work?locale=en-GB)

A temporary server-free probe reused the current Stripe adapter fixtures with a 1,250-cent captured charge and a matching 1,300-cent dispute withdrawal. The active adapter rejected it with permanent `provider-fact-mismatch` before ingestion. The webhook handler sends permanent verified failures to quarantine. Independently, `apply_sponsorship_financial_adjustment` rejects any aggregate net below zero, so allowing the adapter input alone would not fix settlement. The probe is evidence of current rejection, not a desired rejection contract or a live provider incident.

The repair must distinguish sponsor principal and attribution from actual provider cash movements. An authenticated loss must remain recorded even when principal attribution is exhausted. A dispute covering several recurring charges also needs explicit allocation or an unallocated reconciliation state; attributing the entire loss to one intent can misstate cohort reports. Preserve exact event identity, provider-account binding, original charge evidence, and bounded reinstatement authority. Do not merely remove amount checks or silently clamp the loss to zero.

The October 1 owner approval includes preserving excess provider losses separately from principal attribution. Add excess disputes, full-charge disputes after partial refunds, disputes spanning recurring charges, and their reinstatements to acceptance evidence. This finding is separate from the whole-cent representability defect in FF-072.

## Exact reporting foundation, October 1

The implementation now has a private integer-fraction aggregate. It multiplies original USD cents by each signed provider amount, reduces fractions with integer greatest common divisors, combines different denominators exactly, and rounds the final reported total once, with half cents rounded away from zero. Missing input raises an error rather than silently dropping a movement. One-time sponsor history uses this aggregate over the original payment and its adjustments.

In-process migration replay and fourteen SQL assertions passed, including 60,000 dispute/refund amount and arrival-order combinations, complete reversal through 3,500 one-unit refunds, large opposing amounts, and a cross-payment total just below half a cent. The existing nineteen one-time history assertions also passed in the same PostgreSQL engine with minimal managed-schema stubs. These are arithmetic and query checks; they do not establish provider ingestion or hosted release readiness.

At this foundation checkpoint, adapter, ingestion, settlement, and private analytics changes were still pending. The implementation checkpoint below covers those changes. Excess or unallocated provider cash losses and retained-event recovery remain unfinished.


## Adjustment normalization implementation, October 1

The provider adapters now submit exact original-currency adjustment amounts without manufacturing a whole USD-cent equivalent. Ingestion and settlement derive normalization from the immutable original payment. An adjustment stores no independent `base_amount_usd_cents`; its canonical ledger row has null `credit` and normalized base fields. Its provider amount and linked financial movement remain authoritative. Existing gross payments retain their original USD cents. New reporting must join the original financial movement and use the exact aggregate, rather than sum the legacy ledger credit column.

Private analytics preserves fractions through sponsorship rollups and rounds each displayed total once. The regression with five one-unit AUD refunds reports four USD cents of refunds, rather than rounding each sponsorship to one cent and reporting five. Independently rounded components can differ from the independently rounded net total. Sponsor history uses the same original-payment ratio.

The undeployed schema and application RPC signature change together. There is no deployed Advocate data to backfill, and this change is not a rolling upgrade procedure for an already deployed adjustment schema. Provider identity checks, immutable original-payment linkage, settlement locking, duplicate detection, and original-currency limits remain in place.

Local evidence includes 44 mock provider adapter tests, the existing history and refund-update assertions, sixteen exact aggregate assertions, and settlement regressions across both providers and all four supported currencies. The SQL checks use an in-process PostgreSQL engine with managed-schema stubs; hosted validation remains necessary. Excess or unallocated provider losses, retained-event recovery, and longitudinal disclosure remain release work. This checkpoint does not close FF-072 or FF-084.


## Stripe balance transaction contract correction

Stripe documents zero, one, or two balance transactions on a dispute. The existing two-item bound is consistent with that contract and is not evidence of a defect. Do not broaden it merely to accommodate hypothetical repeated withdrawals or credits. Partial reinstatement and duplicate-event checks remain necessary, but any claim that Stripe emits several same-direction cash movements requires separate provider evidence. [Stripe dispute object](https://docs.stripe.com/api/disputes/object)

The balance transaction has its own identity, currency, gross amount, fees, and net balance effect. The accounting repair must preserve those facts separately from original-payment attribution, especially when inverse conversion cannot recover a unique original-currency amount. A provider cash loss must not disappear because principal allocation is ambiguous. [Stripe balance transaction object](https://docs.stripe.com/api/balance_transactions/object)


## Rounded reporting consumer

The analytics parser previously required displayed USD components to add exactly to displayed net funds. That check is invalid under independently rounded exact totals. It is removed; types, safe integer ranges, suppression dependencies, and exact original-currency checks remain. Fifteen analytics application tests pass. A database regression combines five tiny refunds and five tiny dispute debits: both displayed loss categories are four cents, but the exact combined loss rounds to seven cents and the net is 493 cents from a 500-cent gross. The UI must preserve the database result instead of recomputing net from rounded categories.


## Hosted fixture correction

The first hosted database run for `510a661` failed in the two new fixture helpers. Supabase accepted the suite's existing `SET LOCAL session_replication_role` statements but denied the helpers' `set_config` calls for that parameter. Both helpers now use the existing statement form. The in-process engine did not reproduce this managed-role distinction. Production permissions remain unchanged; fixture setup still restores trigger execution before settlement and before the analytics read. The subsequent hosted publication gates passed with this fixture correction.


## Durable provider cash evidence foundation

Verified Stripe dispute processing now records balance transaction identity, exact signed gross amount, fee, net amount, settlement currency, optional provider exchange rate, occurrence time, and the matching original payment before attempting principal allocation. A separate immutable observation binds each provider event and its digest to that cash record. Both tables force row security and deny raw API access; one service-only function validates the materialized regional payment chain and rejects conflicting movement or event identities. Exact retries return the same cash identity, while distinct events can corroborate it without duplicating money.

This order preserves cash when a larger dispute or ambiguous inverse conversion still reaches the existing reconciliation quarantine. Cash recording alone does not mutate sponsorship principal, sponsor history, attribution, gateway settlement, or acknowledgment. It does not close FF-084: automatic excess-loss allocation, grouped-dispute reconciliation, PayPal parity, durable unallocated-cash monitoring, and retained-event recovery remain required. The encrypted payload retention rule is unchanged; the cash facts contain no sponsor contact material and persist independently.

In-process tests cover excess cash, separate fees and net, exact replay, distinct observations, conflicting event and movement identities, wrong regional authority, append-only enforcement, and denied API access. Mock adapter tests prove that cash survives ambiguous and unsupported settlement-currency allocation, and that persistence failure prevents principal ingestion. The cash foundation passed hosted publication 36824970426; later gates also cover its concurrency and recovery extensions.


## Cash concurrency evidence and reporting clarification

The required publication workflow now includes a seven-scenario provider cash race harness: identical delivery, distinct corroborating events, conflicting cash, conflicting event binding, conflicting digest, first-writer rollback, and cancellation between cash insertion and event observation followed by retry. Each ordering requires PostgreSQL-observed blocking and checks private cash, observation, audit, and principal state. All seven scenarios passed hosted publication 36828769720. Three recovery admission races were subsequently added, and all ten passed publication 36855203431.

The owner has been asked whether advocate net funds should stay nonnegative with excess losses confined to Creator Share reconciliation, or permit negative advocate net funds while also reporting excess separately. The prior approval establishes separate loss preservation, but does not explicitly settle that display choice. Principal arithmetic is unchanged pending clarification.


## PayPal protection payout ambiguity

The adapter treated `RESOLVED_WITH_PAYOUT` as a seller win and submitted a credit for the full disputed amount. The [PayPal Disputes API schema](https://developer.paypal.com/api/customer-disputes/v1/schema.json) defines this outcome as protection provided to the merchant or customer. That case status does not identify who received funds or prove reinstatement to the merchant.

A regression using this outcome fails against the former adapter and passes after removing it from the seller-credit allowlist. The existing verified-event quarantine path retains the unresolved event without inventing a credit or treating it as financially resolved. Seller-favour outcomes retain their current path. Reconciliation must establish merchant cash evidence before crediting a protection payout; this repair does not establish PayPal cash parity or settle the broader dispute/refund overlap question.


## Cash ingestion interruption monitoring

A verified cash receipt can commit before the gateway event. The prior event-only health query returned zero unresolved failures for that state. The candidate now counts unmatched cash by provider account, event identity, and immutable digest, and alerts after a ten-minute ingestion grace period. Tests cover multiple observations for one cash movement, mismatched account and digest, and transition into the existing unresolved quarantine inventory. Health and linkage do not allocate principal or claim financial recovery. The payment release runbook specifies the alert and deployment order.


### Atomic adjustment recovery admission

The SQL regression covers Stripe and PayPal fractional refunds recovered from genuine quarantine rows, exact committed replay, competing operation identities, changed source evidence, receipt-free bypass, a forced failure after receipt creation, unchanged source material, and one normal financial application. Failed admission leaves no receipt, partial interpretation or success audit evidence. The required cash concurrency harness now also covers identical recovery operations, competing operations, and rollback of the first admission across independent sessions. All ten cash and recovery scenarios passed in hosted publication 36855203431 at f54441e, including the three admission races. This does not resolve excess-loss allocation or provide live provider recovery evidence.

The operator candidate passes 139 in-process SQL assertions and 96 provider and request-boundary tests, plus TypeScript and scoped lint. These cover original authentication-time preservation, lost-response reconciliation, service-only state access, malformed input, aborted body reads, strict response projection and preparation deadlines. Hosted publication 36857244761 and WebKit 36857244764 passed at f4b45be, including all ten cash and recovery concurrency scenarios. Live provider recovery remains pending.


## PayPal case status does not establish merchant cash (FF-097)

PayPal's current [dispute testing guide](https://developer.paypal.com/disputes/test-go-live) includes cases with no hold where a merchant victory leaves the balance unchanged, and no-hold buyer victories that debit the merchant only at resolution. It also distinguishes provisional credit and held cases. The current adapter instead creates a full dispute debit from case creation, a full credit from selected seller-favour outcomes, and a no-effect event from buyer-favour resolution.

A temporary mock-only probe executed the production adapter with the existing valid dispute fixture and a 500-cent disputed amount. Its three outputs were a 500-cent adjustment at creation, a 500-cent adjustment on seller victory, and no adjustment on buyer victory. No cash movement or hold evidence was supplied or checked. The probe verifies adapter decisions, not actual provider delivery or downstream settlement. Existing tests explicitly expect those mappings; their success does not establish provider parity. The temporary diagnostic was removed after execution.

Case exposure and temporary holds must remain reportable, but they must not manufacture completed cash losses or reinstatements. Repair requires merchant-side movement evidence with stable deduplication identity, separate hold and fee treatment, and correct occurrence times. The official [Disputes OpenAPI schema](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_disputes_v1.json) marks the money movement list deprecated; its entries contain party, amount, time, direction and reason but no transaction identifier. Merely reading that list or treating its absence as zero cash would not close this defect.

This is independent of the pending excess-loss display choice. Acceptance must include no-hold merchant wins and losses, held cases, partial settlements, provisional credits, fees, duplicate and out-of-order events, and reconciliation of case resolution with actual merchant cash. No code repair, provider cash API contract, or live canary is claimed yet.


### Proposed PayPal reconciliation boundary

The owner has been asked to approve durable reconciliation through Transaction Search, with unresolved cases remaining pending while reporting catches up. This proposal is not implemented and requires verified reporting access before release. No live credential or provider configuration change is authorized.

The official [Transaction Search specification](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/reporting_transactions_v1.json) documents up to three hours of reporting latency, a maximum 31-day query range, pagination, and separate balance-affecting records. It warns that a transaction ID can also identify a non-balance-affecting reporting row. An empty immediate response cannot establish that a dispute has no financial effect. Request only transaction information and retain a strict financial projection; do not request payer or shipping records. Original-payment binding must use the reference ID and its declared type, not the counterparty account field. The available query filters do not include that reference ID, so querying the original transaction ID alone cannot be assumed to retrieve its later adjustments.

The [transaction code reference](https://developer.paypal.com/docs/transaction-search/transaction-event-codes/) distinguishes holds and their cancellation, chargebacks and reimbursement, and dispute fees. Proposed reconciliation must preserve that distinction, provider amounts, status changes, occurrence evidence, and conflicting observations. A code alone does not establish debit direction. Reuse the durable gateway worker where its retry window can accommodate delayed reports; add bounded continuation only if the existing worker cannot safely finish the required pages. A completed scan and a completed financial disposition need separate evidence. Unknown relationships and incomplete pages must remain unresolved rather than becoming zero cash.

Before implementation, establish the stable balance-record identity, fee sign convention, report-to-dispute linkage, behavior of reversed records, and the mapping of a later report observation to retained authenticated event evidence. The current Stripe-only cash recorder must not be generalized by accepting PayPal identifiers while retaining Stripe assumptions. Provider fixtures and an authorized live canary must cover these contracts before release.

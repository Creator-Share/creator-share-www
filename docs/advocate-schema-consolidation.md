# Undeployed Advocate schema consolidation

The owner confirmed on September 17, 2026 that the Advocate migrations have never been deployed to production or staging. This cleanup applies only to migrations introduced by PR 127. Base migrations remain unchanged. Do not apply this rewrite to a database that has already recorded these migration versions.

## Change

Forty-four PostgreSQL functions now carry their final implementation at their original declaration. Their superseded replacements have been removed. Table changes, grants, comments, policies, triggers, enum transactions, function renames, and wrapper boundaries retain their original order. No application capability or final database contract is intentionally changed.

The initial candidate was narrowed after replay exposed dependencies on tables introduced later. SQL-language replacements and functions declaring a later table's row type retain their original ordering. The audit context revisions also remain because migrations execute that function before its later transport-context table exists.

## Evidence and limits

Baseline: GitHub commit `03806587621477ef8c86b946e59431b053f5a9d5`.

A temporary in-process PostgreSQL harness replays both the baseline and candidate and compares 5,325 catalog entries covering function definitions and ACLs, relation ownership and RLS, columns and defaults, constraints, policies, triggers, indexes, and views. The snapshots match exactly. The candidate also replays with function-body validation enabled before each migration.

A second comparison inserts representative pre-existing account, role, advocate, beneficiary, subscription, ledger, and partnership records before the first Advocate migration. Both histories produce identical retained data, excluding generated creation, update, and goal-fulfillment timestamps.

These are development checks, not the production release gate. The temporary harness uses minimal Supabase Auth and Storage schemas and substitutes geographic types and functions. It does not prove geographic behavior, hosted Auth, PostgREST, provider behavior, multi-session concurrency, or the complete range of historical production data. Real Supabase replay, pgTAP, and concurrency suites remain required before merge.

## Consolidated functions

| Function | Definitions before cleanup | Superseded definition lines |
| --- | ---: | ---: |
| `private.prepare_advocate_row` | 2 | 137 |
| `private.validate_and_prepare_advocate_domain` | 2 | 176 |
| `audit.purge_expired_forensics` | 2 | 32 |
| `public.transfer_advocate_ownership` | 2 | 216 |
| `private.enqueue_domain_provisioning_job_internal` | 4 | 424 |
| `public.enqueue_domain_provisioning_job` | 2 | 76 |
| `public.claim_domain_provisioning_jobs` | 2 | 137 |
| `public.record_domain_provisioning_reconciliation` | 2 | 74 |
| `public.complete_domain_provisioning_job` | 2 | 98 |
| `public.retry_domain_provisioning_job` | 2 | 93 |
| `public.cancel_queued_domain_provisioning_job` | 2 | 73 |
| `private.prevent_sponsorship_attribution_mutation` | 3 | 32 |
| `private.protect_email_outbox` | 2 | 229 |
| `public.purge_expired_advocate_tracking` | 2 | 75 |
| `public.purge_expired_gateway_event_payloads` | 2 | 52 |
| `public.purge_expired_email_outbox_contact` | 3 | 132 |
| `private.require_payment_service_role` | 2 | 20 |
| `private.validate_provider_event_type` | 4 | 176 |
| `private.validate_sponsorship_checkout_eligibility` | 3 | 208 |
| `private.finalize_sponsorship_attribution` | 2 | 132 |
| `private.validate_linked_payment_chain` | 2 | 89 |
| `public.claim_email_outbox_jobs` | 2 | 125 |
| `public.fail_email_outbox_delivery` | 2 | 98 |
| `public.record_qualified_advocate_exposure` | 2 | 247 |
| `private.apply_domain_job_success` | 2 | 192 |
| `private.apply_domain_job_failure` | 2 | 68 |
| `private.resolve_sponsorship_financial_adjustment_kind` | 3 | 120 |
| `public.read_public_advocate_beneficiary_catalog_page` | 2 | 252 |
| `private.resolve_public_advocate_beneficiary_identifier` | 2 | 113 |
| `private.require_data_retention_service_role` | 2 | 20 |
| `public.start_data_retention_run` | 2 | 198 |
| `public.run_data_retention_step` | 4 | 570 |
| `public.finish_data_retention_run` | 2 | 227 |
| `public.start_advocate_portal_provisioning` | 2 | 323 |
| `private.require_advocate_logo_service_role` | 2 | 20 |
| `private.require_advocate_invitation_service_role` | 2 | 21 |
| `private.protect_advocate_invitation` | 2 | 107 |
| `private.protect_advocate_invitation_email_outbox` | 2 | 197 |
| `public.fail_advocate_invitation_email_delivery` | 2 | 137 |
| `public.reserve_sponsor_passwordless_email_delivery` | 2 | 351 |
| `public.acquire_email_proof_issuance_gate` | 2 | 191 |
| `public.begin_email_proof_issuance` | 2 | 78 |
| `public.abandon_email_proof_issuance` | 2 | 69 |
| `public.purge_expired_email_proof_issuance_gates` | 3 | 127 |

## Second consolidation pass

The first pass conservatively excluded every function name involved in a rename or schema move. The second pass groups definitions only within the interval before or after that boundary. It preserves every rename, schema move, drop, and function alteration instead of combining distinct generations under the same name.

Nine additional groups remove 1,212 superseded definition lines. The strict in-process replay again matches all 5,325 original catalog entries and the eight legacy fixture projections exactly. Final catalog equality includes the renamed private implementations that wrappers still call. Hosted run [35179157120](https://github.com/Creator-Share/creator-share-www/actions/runs/35179157120) on `d42eb98` passed Supabase replay, the complete pgTAP suite, every required concurrency harness, PostgREST compatibility, and forced cleanup for this second pass.

| Function | Definitions in interval | Superseded definition lines |
| --- | ---: | ---: |
| `public.get_advocate_audit_events` | 4 | 276 |
| `public.issue_sponsorship_payment_quote` | 2 | 142 |
| `public.read_payment_gateway_event_success_material` | 2 | 135 |
| `private.data_retention_counts_are_valid` | 2 | 86 |
| `private.data_retention_backlog` | 2 | 96 |
| `public.claim_advocate_invitation_email_jobs` | 2 | 209 |
| `public.begin_advocate_invitation_email_delivery` | 2 | 124 |
| `private.data_retention_counts_are_valid` | 2 | 43 |
| `private.data_retention_backlog` | 3 | 101 |

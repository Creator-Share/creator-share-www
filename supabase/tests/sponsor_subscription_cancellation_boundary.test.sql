BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.list_sponsorship_subscription_cancellation_candidates(integer)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.claim_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.settle_sponsorship_subscription_cancellation(uuid,uuid,public.sponsorship_subscription_cancellation_result,bytea,text,text,text,text)'::regprocedure
  ),
  'all cancellation RPCs are security definer functions with empty search paths'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.list_sponsorship_subscription_cancellation_candidates(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.list_sponsorship_subscription_cancellation_candidates(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.list_sponsorship_subscription_cancellation_candidates(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.claim_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.settle_sponsorship_subscription_cancellation(uuid,uuid,public.sponsorship_subscription_cancellation_result,bytea,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.settle_sponsorship_subscription_cancellation(uuid,uuid,public.sponsorship_subscription_cancellation_result,bytea,text,text,text,text)',
    'EXECUTE'
  ),
  'browser and service cancellation capabilities are separated'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid =
      'public.sponsorship_subscription_cancellations'::regclass
  )
  AND NOT has_table_privilege(
    'anon',
    'public.sponsorship_subscription_cancellations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.sponsorship_subscription_cancellations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_subscription_cancellations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_subscription_cancellations',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_subscription_cancellations',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_subscription_cancellations',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_subscription_cancellations',
    'TRUNCATE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'sponsorship_subscription_cancellations'
  ),
  'provider cancellation state is RPC only with no direct RLS path'
);

SELECT extensions.ok(
  position(
    'provider_object_id'
    IN pg_get_function_result(
      'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
    )
  ) = 0
  AND position(
    'provider_account_scope'
    IN pg_get_function_result(
      'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
    )
  ) = 0
  AND position(
    'provider_object_id'
    IN pg_get_function_result(
      'public.list_sponsorship_subscription_cancellation_candidates(integer)'::regprocedure
    )
  ) = 0
  AND position(
    'provider_object_id'
    IN pg_get_function_result(
      'public.settle_sponsorship_subscription_cancellation(uuid,uuid,public.sponsorship_subscription_cancellation_result,bytea,text,text,text,text)'::regprocedure
    )
  ) = 0
  AND position(
    'provider_object_id'
    IN pg_get_function_result(
      'public.claim_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'only the service claim RPC can return provider routing identifiers'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_anonymous
)
VALUES
  (
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'cancellation-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    '9a000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'cancellation-other@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    '9a000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'cancellation-admin@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  );

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT
  '9a000000-0000-4000-8000-000000000003'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

INSERT INTO public.sponsor_identities (
  id,
  auth_user_id
)
VALUES (
  '9c000000-0000-4000-8000-000000000001'::uuid,
  '9a000000-0000-4000-8000-000000000002'::uuid
);

INSERT INTO public.subscriptions (
  id,
  user_id,
  status,
  sponsorship_method,
  stripe_subscription_id,
  payment_region,
  provider_account_scope,
  provider_subscription_object_type,
  provider_subscription_object_id
)
VALUES
  (
    '9b000000-0000-4000-8000-000000000001'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_cancel_main_001',
    'us',
    'stripe_us',
    'subscription',
    'sub_cancel_main_001'
  ),
  (
    '9b000000-0000-4000-8000-000000000002'::uuid,
    '9a000000-0000-4000-8000-000000000002'::uuid,
    'complete',
    'STRIPE',
    'sub_cancel_other_002',
    'us',
    NULL,
    NULL,
    NULL
  ),
  (
    '9b000000-0000-4000-8000-000000000003'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'cancelled',
    'STRIPE',
    'sub_cancelled_003',
    'uk',
    NULL,
    NULL,
    NULL
  ),
  (
    '9b000000-0000-4000-8000-000000000004'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    NULL,
    'us',
    NULL,
    NULL,
    NULL
  ),
  (
    '9b000000-0000-4000-8000-000000000005'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'PAYPAL',
    'I-CANCEL-PAYPAL-005',
    'us',
    NULL,
    NULL,
    NULL
  ),
  (
    '9b000000-0000-4000-8000-000000000006'::uuid,
    '9a000000-0000-4000-8000-000000000002'::uuid,
    'complete',
    'STRIPE',
    'sub_cancel_admin_006',
    'uk',
    NULL,
    NULL,
    NULL
  ),
  (
    '9b000000-0000-4000-8000-000000000007'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_cancel_retry_007',
    'us',
    NULL,
    NULL,
    NULL
  ),
  (
    '9b000000-0000-4000-8000-000000000008'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_conflict_legacy_008',
    'us',
    'stripe_us',
    'subscription',
    'sub_conflict_modern_008'
  ),
  (
    '9b000000-0000-4000-8000-000000000009'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_owner_conflict_009',
    'us',
    NULL,
    NULL,
    NULL
  );

UPDATE public.subscriptions subscription
SET sponsor_identity_id =
  '9c000000-0000-4000-8000-000000000001'::uuid
WHERE subscription.id =
  '9b000000-0000-4000-8000-000000000009'::uuid;

INSERT INTO public.beneficiaries (
  name,
  username,
  budget_goal,
  status
)
VALUES (
  'Cancellation Derived Totals Beneficiary',
  'cancellation-derived-totals-beneficiary',
  -1,
  'New'
);

UPDATE public.subscriptions subscription
SET
  beneficiary_id = (
    SELECT beneficiary.id
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.username =
      'cancellation-derived-totals-beneficiary'
  ),
  amount = 1200,
  interval = 'month'
WHERE subscription.id =
  '9b000000-0000-4000-8000-000000000001'::uuid;

SELECT extensions.ok(
  (
    SELECT beneficiary.status = 'Partially Funded'
      AND beneficiary.budget_raised = 1200
      AND beneficiary.active_subscriptions = 1
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.username =
      'cancellation-derived-totals-beneficiary'
  ),
  'the fixture proves the existing subscription trigger owns derived funding totals'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_subscription_cancellation(
      '9b000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'Subscription cancellation is not authorized',
  'another authenticated sponsor cannot cancel the owner subscription'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_subscription_cancellation(
      '9b000000-0000-4000-8000-000000000009'::uuid
    )
  $$,
  '42501',
  'Subscription cancellation is not authorized',
  'an identity owner cannot cancel a row with conflicting direct ownership'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_subscription_cancellation(
      '9b000000-0000-4000-8000-000000000009'::uuid
    )
  $$,
  '42501',
  'Subscription cancellation is not authorized',
  'a direct owner cannot cancel a row with conflicting identity ownership'
);

CREATE TEMP TABLE main_cancellation_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  '9b000000-0000-4000-8000-000000000001'::uuid,
  'cancel-request-main',
  'cancel-trace-main',
  '192.0.2.10',
  'cancellation-test-agent'
) begun;

SELECT extensions.is(
  (SELECT cancellation_status FROM main_cancellation_begin),
  'pending',
  'the owner creates one pending server cancellation operation'
);

SELECT extensions.ok(
  NOT (SELECT is_terminal FROM main_cancellation_begin)
  AND NOT (SELECT replayed FROM main_cancellation_begin)
  AND (
    SELECT count(*) = 1
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.subscription_id =
      '9b000000-0000-4000-8000-000000000001'::uuid
  ),
  'the first request is nonterminal and materializes exactly one operation'
);

CREATE TEMP TABLE main_cancellation_replay
ON COMMIT DROP
AS
SELECT replayed.*
FROM public.begin_sponsorship_subscription_cancellation(
  '9b000000-0000-4000-8000-000000000001'::uuid,
  'cancel-request-replay'
) replayed;

SELECT extensions.ok(
  (
    SELECT cancellation_operation_id
    FROM main_cancellation_replay
  ) = (
    SELECT cancellation_operation_id
    FROM main_cancellation_begin
  )
  AND (SELECT replayed FROM main_cancellation_replay)
  AND (
    SELECT operation.request_count = 2
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.id = (
      SELECT cancellation_operation_id FROM main_cancellation_begin
    )
  ),
  'an exact replay recovers the same durable operation without duplication'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'sponsorship_subscription_cancellations'
      AND event.operation = 'INSERT'
      AND event.record_pk ->> 'id' = (
        SELECT cancellation_operation_id::text
        FROM main_cancellation_begin
      )
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        '9a000000-0000-4000-8000-000000000001'::uuid
      AND event.effective_user_id =
        '9a000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'begin_sponsorship_subscription_cancellation'
      AND event.request_id = 'cancel-request-main'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND event.changed_columns @> ARRAY[
        'provider_object_id',
        'status',
        'subscription_id'
      ]::text[]
      AND event.metadata ->> 'resource_id' =
        '9b000000-0000-4000-8000-000000000001'
      AND event.metadata::text NOT LIKE '%sub_cancel_main_001%'
  ),
  'the user operation is audited without provider row images or identifiers'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.ok(
  (
    SELECT array_agg(candidate.cancellation_operation_id) = ARRAY[
      (SELECT cancellation_operation_id FROM main_cancellation_begin)
    ]::uuid[]
    FROM public.list_sponsorship_subscription_cancellation_candidates(4)
      candidate
  ),
  'the service worker lists a bounded due operation without provider identifiers'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.list_sponsorship_subscription_cancellation_candidates(21)
  $$,
  '22023',
  'Subscription cancellation candidate batch is malformed',
  'the autonomous candidate boundary rejects an oversized batch'
);

CREATE TEMP TABLE main_cancellation_claim
ON COMMIT DROP
AS
SELECT claimed.*
FROM public.claim_sponsorship_subscription_cancellation(
  (SELECT cancellation_operation_id FROM main_cancellation_begin),
  'route-worker/main-claim',
  'cancel-claim-main',
  'cancel-trace-main'
) claimed;

SELECT extensions.ok(
  (
    SELECT cancellation_status = 'processing'
      AND processing_lease_token IS NOT NULL
      AND processing_lease_expires_at > clock_timestamp()
      AND provider = 'STRIPE'
      AND provider_account_scope = 'stripe_us'
      AND provider_object_type = 'subscription'
      AND provider_object_id = 'sub_cancel_main_001'
      AND cancellation_operation_id = (
        SELECT cancellation_operation_id FROM main_cancellation_begin
      )
      AND claim_attempt_count = 1
    FROM main_cancellation_claim
  ),
  'the service claim receives the exact modern Stripe provenance and operation identity'
);

SELECT extensions.ok(
  (
    SELECT second_claim.cancellation_status = 'processing'
      AND second_claim.processing_lease_token IS NULL
      AND second_claim.provider IS NULL
      AND second_claim.provider_account_scope IS NULL
      AND second_claim.provider_object_id IS NULL
      AND second_claim.claim_attempt_count = 1
    FROM public.claim_sponsorship_subscription_cancellation(
      (SELECT cancellation_operation_id FROM main_cancellation_begin),
      'route-worker/concurrent-claim'
    ) second_claim
  ),
  'a concurrent claimant cannot obtain the active lease or provider identifiers'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.list_sponsorship_subscription_cancellation_candidates(20)
      candidate
    WHERE candidate.cancellation_operation_id = (
      SELECT cancellation_operation_id FROM main_cancellation_begin
    )
  ),
  'an operation with an active provider lease is not a retry candidate'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.settle_sponsorship_subscription_cancellation(
      (SELECT cancellation_operation_id FROM main_cancellation_begin),
      'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid,
      'provider_cancelled',
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  '55P03',
  'Subscription cancellation processing lease is missing or stale',
  'a stale lease cannot settle a provider cancellation'
);

CREATE TEMP TABLE main_cancellation_settlement
ON COMMIT DROP
AS
SELECT settled.*
FROM public.settle_sponsorship_subscription_cancellation(
  (SELECT cancellation_operation_id FROM main_cancellation_begin),
  (SELECT processing_lease_token FROM main_cancellation_claim),
  'provider_cancelled',
  decode(repeat('a1', 32), 'hex'),
  'cancel-settle-main',
  'cancel-trace-main'
) settled;

SELECT extensions.ok(
  (
    SELECT cancellation_status = 'cancelled'
      AND is_terminal
      AND provider_effect_recorded
      AND NOT replayed
    FROM main_cancellation_settlement
  )
  AND (
    SELECT subscription.status = 'cancelled'
      AND subscription.canceled_at IS NOT NULL
      AND subscription.last_provider_lifecycle_event_occurred_at IS NULL
      AND subscription.last_provider_lifecycle_event_precedence IS NULL
      AND subscription.last_provider_lifecycle_event_id IS NULL
    FROM public.subscriptions subscription
    WHERE subscription.id =
      '9b000000-0000-4000-8000-000000000001'::uuid
  )
  AND (
    SELECT operation.status = 'cancelled'
      AND operation.result = 'provider_cancelled'
      AND operation.processing_lease_token IS NULL
      AND operation.provider_evidence_sha256 =
        decode(repeat('a1', 32), 'hex')
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.id = (
      SELECT cancellation_operation_id FROM main_cancellation_begin
    )
  )
  AND (
    SELECT beneficiary.status = 'New'
      AND beneficiary.budget_raised = 0
      AND beneficiary.active_subscriptions = 0
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.username =
      'cancellation-derived-totals-beneficiary'
  ),
  'provider success settles atomically, preserves webhook facts, and invokes only standard derived funding recalculation'
);

SELECT extensions.ok(
  (
    SELECT replayed.replayed
      AND replayed.cancellation_status = 'cancelled'
      AND replayed.provider_effect_recorded
    FROM public.settle_sponsorship_subscription_cancellation(
      (SELECT cancellation_operation_id FROM main_cancellation_begin),
      (SELECT processing_lease_token FROM main_cancellation_claim),
      'provider_cancelled',
      decode(repeat('a1', 32), 'hex')
    ) replayed
  ),
  'an exact provider settlement replay returns the first terminal evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.settle_sponsorship_subscription_cancellation(
      (SELECT cancellation_operation_id FROM main_cancellation_begin),
      (SELECT processing_lease_token FROM main_cancellation_claim),
      'provider_not_found',
      decode(repeat('a2', 32), 'hex')
    )
  $$,
  '23514',
  'Subscription cancellation settlement conflicts with terminal evidence',
  'conflicting terminal provider evidence cannot replace the first result'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'subscriptions'
      AND event.operation = 'UPDATE'
      AND event.record_pk ->> 'id' =
        '9b000000-0000-4000-8000-000000000001'
      AND event.actor_type = 'system'
      AND event.system_actor = 'subscription_cancellation_service'
      AND event.tool = 'settle_sponsorship_subscription_cancellation'
      AND event.request_id = 'cancel-settle-main'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND event.changed_columns @> ARRAY[
        'canceled_at',
        'status'
      ]::text[]
      AND event.metadata::text NOT LIKE '%sub_cancel_main_001%'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'sponsorship_subscription_cancellations'
      AND event.operation = 'UPDATE'
      AND event.record_pk ->> 'id' = (
        SELECT cancellation_operation_id::text
        FROM main_cancellation_begin
      )
      AND event.actor_type = 'system'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND event.metadata::text NOT LIKE '%sub_cancel_main_001%'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN public.beneficiaries beneficiary
      ON event.record_pk ->> 'id' = beneficiary.id::text
    WHERE event.table_name = 'beneficiaries'
      AND beneficiary.username =
        'cancellation-derived-totals-beneficiary'
      AND event.operation = 'UPDATE'
      AND event.actor_type = 'system'
      AND event.system_actor = 'subscription_cancellation_service'
      AND event.tool = 'settle_sponsorship_subscription_cancellation'
      AND event.request_id = 'cancel-settle-main'
      AND event.changed_columns @> ARRAY[
        'active_subscriptions',
        'budget_raised',
        'status'
      ]::text[]
  ),
  'atomic settlement audits the operation, subscription, and derived beneficiary totals'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

CREATE TEMP TABLE already_cancelled_cancellation_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  '9b000000-0000-4000-8000-000000000003'::uuid
) begun;

SELECT extensions.ok(
  (
    SELECT begun.cancellation_status = 'cancelled'
      AND begun.is_terminal
      AND NOT begun.replayed
    FROM already_cancelled_cancellation_begin begun
  )
  AND (
    SELECT operation.result = 'subscription_already_cancelled'
      AND operation.claim_attempt_count = 0
      AND operation.provider_evidence_sha256 IS NULL
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.subscription_id =
      '9b000000-0000-4000-8000-000000000003'::uuid
  ),
  'an already cancelled subscription resolves without a provider call'
);

CREATE TEMP TABLE missing_reference_cancellation_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  '9b000000-0000-4000-8000-000000000004'::uuid
) begun;

SELECT extensions.ok(
  (
    SELECT begun.cancellation_status = 'manual_review'
      AND begun.is_terminal
      AND NOT begun.replayed
    FROM missing_reference_cancellation_begin begun
  )
  AND (
    SELECT operation.result = 'provider_reference_missing'
      AND operation.provider_object_id IS NULL
      AND operation.claim_attempt_count = 0
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.subscription_id =
      '9b000000-0000-4000-8000-000000000004'::uuid
  ),
  'a subscription without provider provenance stops in manual review'
);

CREATE TEMP TABLE conflicting_reference_cancellation_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  '9b000000-0000-4000-8000-000000000008'::uuid
) begun;

SELECT extensions.ok(
  (
    SELECT begun.cancellation_status = 'manual_review'
      AND begun.is_terminal
    FROM conflicting_reference_cancellation_begin begun
  )
  AND (
    SELECT operation.result = 'provider_reference_conflict'
      AND operation.claim_attempt_count = 0
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.subscription_id =
      '9b000000-0000-4000-8000-000000000008'::uuid
  ),
  'conflicting modern and legacy provider identifiers cannot reach an adapter'
);

CREATE TEMP TABLE paypal_cancellation_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  '9b000000-0000-4000-8000-000000000005'::uuid
) begun;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

CREATE TEMP TABLE paypal_cancellation_claim
ON COMMIT DROP
AS
SELECT claimed.*
FROM public.claim_sponsorship_subscription_cancellation(
  (SELECT cancellation_operation_id FROM paypal_cancellation_begin),
  'route-worker/paypal-claim'
) claimed;

SELECT extensions.ok(
  (
    SELECT provider = 'PAYPAL'
      AND provider_account_scope = 'paypal'
      AND provider_object_type = 'billing_subscription'
      AND provider_object_id = 'I-CANCEL-PAYPAL-005'
    FROM paypal_cancellation_claim
  ),
  'legacy PayPal rows derive the exact single-account provider provenance'
);

CREATE TEMP TABLE paypal_cancellation_settlement
ON COMMIT DROP
AS
SELECT settled.*
FROM public.settle_sponsorship_subscription_cancellation(
  (SELECT cancellation_operation_id FROM paypal_cancellation_begin),
  (SELECT processing_lease_token FROM paypal_cancellation_claim),
  'provider_not_found',
  decode(repeat('b1', 32), 'hex')
) settled;

SELECT extensions.ok(
  (
    SELECT settled.cancellation_status = 'cancelled'
      AND settled.provider_effect_recorded
    FROM paypal_cancellation_settlement settled
  )
  AND (
    SELECT subscription.status = 'cancelled'
    FROM public.subscriptions subscription
    WHERE subscription.id =
      '9b000000-0000-4000-8000-000000000005'::uuid
  ),
  'authoritative provider absence stops future billing locally'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000003',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_subscription_cancellation(
      target_subscription_id =>
        '9b000000-0000-4000-8000-000000000006'::uuid,
      context_request_id => 'cancel-admin-no-reason'
    )
  $$,
  '22023',
  'A specific administrator cancellation reason is required',
  'a global administrator cannot override sponsor ownership without a specific reason'
);

CREATE TEMP TABLE admin_cancellation_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  target_subscription_id =>
    '9b000000-0000-4000-8000-000000000006'::uuid,
  context_request_id => 'cancel-admin-override',
  request_reason =>
    'Duplicate sponsorship sub_private_admin for admin@example.test'
) begun;

SELECT extensions.ok(
  (SELECT cancellation_status = 'pending' FROM admin_cancellation_begin)
  AND (
    SELECT operation.requested_by_user_id =
        '9a000000-0000-4000-8000-000000000003'::uuid
      AND operation.effective_user_id =
        '9a000000-0000-4000-8000-000000000002'::uuid
      AND operation.requester_is_super_admin
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.id = (
      SELECT cancellation_operation_id FROM admin_cancellation_begin
    )
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'sponsorship_subscription_cancellations'
      AND event.record_pk ->> 'id' = (
        SELECT cancellation_operation_id::text
        FROM admin_cancellation_begin
      )
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        '9a000000-0000-4000-8000-000000000003'::uuid
      AND event.effective_user_id =
        '9a000000-0000-4000-8000-000000000002'::uuid
      AND event.reason =
        'Duplicate sponsorship [redacted] for [redacted]'
      AND event.request_id = 'cancel-admin-override'
      AND event.metadata ->> 'ownership_conflict' = 'false'
      AND event.reason NOT LIKE '%sub_private_admin%'
      AND event.reason NOT LIKE '%admin@example.test%'
  ),
  'a global super administrator override is specific, sanitized, scoped, and audited'
);

CREATE TEMP TABLE conflicting_owner_admin_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  target_subscription_id =>
    '9b000000-0000-4000-8000-000000000009'::uuid,
  context_request_id => 'cancel-admin-owner-conflict',
  request_reason => 'Resolve conflicting legacy and sponsor identity ownership'
) begun;

SELECT extensions.ok(
  (
    SELECT operation.effective_user_id IS NULL
      AND operation.requester_is_super_admin
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.id = (
      SELECT cancellation_operation_id FROM conflicting_owner_admin_begin
    )
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'sponsorship_subscription_cancellations'
      AND event.record_pk ->> 'id' = (
        SELECT cancellation_operation_id::text
        FROM conflicting_owner_admin_begin
      )
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        '9a000000-0000-4000-8000-000000000003'::uuid
      AND event.effective_user_id IS NULL
      AND event.reason =
        'Resolve conflicting legacy and sponsor identity ownership'
      AND event.metadata ->> 'ownership_conflict' = 'true'
      AND event.request_id = 'cancel-admin-owner-conflict'
  ),
  'an administrator override records ownership conflict without choosing an effective owner'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

CREATE TEMP TABLE retry_cancellation_begin
ON COMMIT DROP
AS
SELECT begun.*
FROM public.begin_sponsorship_subscription_cancellation(
  '9b000000-0000-4000-8000-000000000007'::uuid
) begun;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

CREATE TEMP TABLE retry_cancellation_claim_one
ON COMMIT DROP
AS
SELECT claimed.*
FROM public.claim_sponsorship_subscription_cancellation(
  (SELECT cancellation_operation_id FROM retry_cancellation_begin),
  'route-worker/retry-one'
) claimed;

CREATE TEMP TABLE retry_cancellation_settlement_one
ON COMMIT DROP
AS
SELECT settled.*
FROM public.settle_sponsorship_subscription_cancellation(
  (SELECT cancellation_operation_id FROM retry_cancellation_begin),
  (SELECT processing_lease_token FROM retry_cancellation_claim_one),
  'provider_retryable_error',
  decode(repeat('c1', 32), 'hex')
) settled;

SELECT extensions.ok(
  (
    SELECT settled.cancellation_status = 'pending'
      AND NOT settled.is_terminal
      AND NOT settled.provider_effect_recorded
    FROM retry_cancellation_settlement_one settled
  )
  AND (
    SELECT operation.status = 'retryable'
      AND operation.result = 'provider_retryable_error'
      AND operation.next_attempt_at >=
        operation.provider_evidence_recorded_at + interval '1 minute'
      AND operation.provider_evidence_sha256 =
        decode(repeat('c1', 32), 'hex')
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.id = (
      SELECT cancellation_operation_id FROM retry_cancellation_begin
    )
  )
  AND (
    SELECT subscription.status = 'complete'
    FROM public.subscriptions subscription
    WHERE subscription.id =
      '9b000000-0000-4000-8000-000000000007'::uuid
  ),
  'a retryable provider failure preserves the active subscription and durable evidence'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.ok(
  (
    SELECT begun.cancellation_operation_id = (
        SELECT cancellation_operation_id FROM retry_cancellation_begin
      )
      AND begun.cancellation_status = 'pending'
      AND begun.replayed
    FROM public.begin_sponsorship_subscription_cancellation(
      '9b000000-0000-4000-8000-000000000007'::uuid
    ) begun
  ),
  'a sponsor retry recovers the original failed operation'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.ok(
  (
    SELECT claimed.cancellation_status = 'pending'
      AND claimed.processing_lease_token IS NULL
      AND claimed.provider_object_id IS NULL
      AND claimed.claim_attempt_count = 1
    FROM public.claim_sponsorship_subscription_cancellation(
      (SELECT cancellation_operation_id FROM retry_cancellation_begin),
      'route-worker/retry-too-soon'
    ) claimed
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.list_sponsorship_subscription_cancellation_candidates(20)
      candidate
    WHERE candidate.cancellation_operation_id = (
      SELECT cancellation_operation_id FROM retry_cancellation_begin
    )
  ),
  'durable retry timing prevents browser and worker hot loops'
);

SELECT set_config('app.subscription_cancellation.writer', 'rpc-v1', true);
UPDATE public.sponsorship_subscription_cancellations operation
SET next_attempt_at = clock_timestamp() - interval '1 second'
WHERE operation.id = (
  SELECT cancellation_operation_id FROM retry_cancellation_begin
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.list_sponsorship_subscription_cancellation_candidates(20)
      candidate
    WHERE candidate.cancellation_operation_id = (
      SELECT cancellation_operation_id FROM retry_cancellation_begin
    )
  ),
  'a due retry becomes visible to the autonomous service worker'
);

SELECT extensions.ok(
  (
    SELECT claimed.processing_lease_token IS NOT NULL
      AND claimed.claim_attempt_count = 2
      AND claimed.cancellation_operation_id = (
        SELECT cancellation_operation_id FROM retry_cancellation_begin
      )
    FROM public.claim_sponsorship_subscription_cancellation(
      (SELECT cancellation_operation_id FROM retry_cancellation_begin),
      'route-worker/retry-two'
    ) claimed
  ),
  'a provider retry receives a new lease for the same durable operation'
);

SELECT set_config('app.subscription_cancellation.writer', '', true);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_subscription_cancellations operation
    SET request_count = operation.request_count
    WHERE operation.id = (
      SELECT cancellation_operation_id FROM main_cancellation_begin
    )
  $$,
  '42501',
  'Subscription cancellation operations are RPC controlled',
  'even a database path must enter through the cancellation writer boundary'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM audit.audit_events event
    CROSS JOIN public.sponsorship_subscription_cancellations operation
    WHERE event.table_name IN (
      'sponsorship_subscription_cancellations',
      'subscriptions'
    )
      AND operation.provider_object_id IS NOT NULL
      AND position(
        operation.provider_object_id
        IN concat_ws(
          ' ',
          event.before_data::text,
          event.after_data::text,
          event.metadata::text,
          event.reason
        )
      ) > 0
  ),
  'provider subscription identifiers never enter durable audit content'
);

SELECT extensions.ok(
  position(
    'beneficiaries'
    IN pg_get_functiondef(
      'public.settle_sponsorship_subscription_cancellation(uuid,uuid,public.sponsorship_subscription_cancellation_result,bytea,text,text,text,text)'::regprocedure
    )
  ) = 0
  AND position(
    'email_outbox'
    IN pg_get_functiondef(
      'public.settle_sponsorship_subscription_cancellation(uuid,uuid,public.sponsorship_subscription_cancellation_result,bytea,text,text,text,text)'::regprocedure
    )
  ) = 0
  AND position(
    'last_provider_lifecycle_event'
    IN pg_get_functiondef(
      'public.settle_sponsorship_subscription_cancellation(uuid,uuid,public.sponsorship_subscription_cancellation_result,bytea,text,text,text,text)'::regprocedure
    )
  ) = 0,
  'settlement performs no bespoke beneficiary assignment, direct beneficiary DML, email delivery, or webhook fact mutation'
);

SELECT * FROM extensions.finish();

ROLLBACK;

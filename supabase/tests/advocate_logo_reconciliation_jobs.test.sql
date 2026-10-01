BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname = 'advocate_logo_reconciliation_jobs'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'private'
      AND policy.tablename = 'advocate_logo_reconciliation_jobs'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.advocate_logo_reconciliation_jobs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_logo_reconciliation_jobs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_reconciliation_jobs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_reconciliation_jobs',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_reconciliation_jobs',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_reconciliation_jobs',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_reconciliation_jobs',
    'TRUNCATE'
  ),
  'the reconciliation queue is forced-RLS default deny, including direct service-role writes and truncate'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.claim_advocate_logo_reconciliation_jobs(text,integer,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.authorize_advocate_logo_reconciliation_deletion(uuid,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.complete_advocate_logo_reconciliation_job(uuid,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.fail_advocate_logo_reconciliation_job(uuid,text,text,text,text)'::regprocedure
  ),
  'every reconciliation RPC is a fixed-search-path security definer boundary'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_advocate_logo_reconciliation_jobs(text,integer,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.authorize_advocate_logo_reconciliation_deletion(uuid,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_advocate_logo_reconciliation_job(uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.fail_advocate_logo_reconciliation_job(uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_advocate_logo_reconciliation_jobs(text,integer,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.authorize_advocate_logo_reconciliation_deletion(uuid,text,text,text)',
    'EXECUTE'
  ),
  'only the service role can execute the four public reconciliation RPCs'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.claim_advocate_logo_reconciliation_jobs(text,integer,text,text)'::regprocedure
  ),
  ARRAY[
    'worker_id',
    'batch_size',
    'request_id',
    'trace_id',
    'job_id',
    'reservation_id',
    'advocate_id',
    'object_path',
    'lease_token',
    'lease_expires_at',
    'attempt_count',
    'maximum_attempts'
  ]::text[],
  'the claim RPC has the exact fixed input and output names'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.authorize_advocate_logo_reconciliation_deletion(uuid,text,text,text)'::regprocedure
  ),
  ARRAY[
    'target_job_id',
    'lease_token',
    'request_id',
    'trace_id',
    'outcome',
    'object_path'
  ]::text[],
  'the authorization RPC returns exactly outcome and object_path'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.complete_advocate_logo_reconciliation_job(uuid,text,text,text,text)'::regprocedure
  ),
  ARRAY[
    'target_job_id',
    'lease_token',
    'target_outcome',
    'request_id',
    'trace_id'
  ]::text[],
  'the scalar completion RPC has the exact fixed argument names'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.fail_advocate_logo_reconciliation_job(uuid,text,text,text,text)'::regprocedure
  ),
  ARRAY[
    'target_job_id',
    'lease_token',
    'failure_code',
    'request_id',
    'trace_id',
    'status',
    'next_attempt_at'
  ]::text[],
  'the failure RPC returns exactly status and next_attempt_at'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'private'
      AND index_definition.indexname = 'advocate_logo_upload_pending_expiry_idx'
      AND index_definition.indexdef LIKE '%expires_at%'
      AND index_definition.indexdef LIKE '%status = ''pending''%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'private'
      AND index_definition.indexname = 'advocate_logo_upload_cleanup_grace_idx'
      AND index_definition.indexdef LIKE '%GREATEST(expires_at, settled_at)%'
  )
  AND pg_get_functiondef(
    'public.claim_advocate_logo_reconciliation_jobs(text,integer,text,text)'::regprocedure
  ) LIKE '%FOR UPDATE OF job SKIP LOCKED%'
  AND pg_get_functiondef(
    'public.claim_advocate_logo_reconciliation_jobs(text,integer,text,text)'::regprocedure
  ) LIKE '%gen_random_bytes(32)%',
  'eligibility scans are indexed and claims use skip-locked rows with 256-bit tokens'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name = 'advocate_logo_reconciliation_jobs'
      AND column_definition.column_name = 'lease_token'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name = 'advocate_logo_reconciliation_jobs'
      AND column_definition.column_name = 'lease_token_digest'
  ),
  'the queue persists only a digest and has no plaintext lease-token column'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.get_advocate_audit_history_page(uuid,uuid,integer)'::regprocedure
  ) NOT LIKE '%advocate_logo_reconciliation_jobs%'
  AND to_regprocedure(
    'public.get_advocate_audit_events(uuid,bigint,integer)'
  ) IS NULL,
  'portal audit history excludes internal logo reconciliation lifecycle rows'
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
  updated_at
)
VALUES (
  'c2000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'logo-reconciliation@example.test',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status
)
VALUES
  (
    'c0000000-0000-4000-8000-000000000001',
    'reconcilea',
    'Reconcile A',
    'active',
    'draft'
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    'reconcileb',
    'Reconcile B',
    'active',
    'draft'
  ),
  (
    'c0000000-0000-4000-8000-000000000003',
    'reconcilec',
    'Reconcile C',
    'active',
    'draft'
  );

INSERT INTO public.advocate_branding (
  advocate_id,
  logo_storage_path,
  logo_alt_text
)
VALUES
  ('c0000000-0000-4000-8000-000000000001', NULL, NULL),
  (
    'c0000000-0000-4000-8000-000000000002',
    'logos/reconcileb/c1000000-0000-4000-8000-000000000007.webp',
    'Current protected logo'
  ),
  ('c0000000-0000-4000-8000-000000000003', NULL, NULL);

INSERT INTO private.advocate_logo_upload_reservations (
  id,
  advocate_id,
  actor_user_id,
  expected_advocate_version,
  object_path,
  status,
  request_id,
  failure_code,
  resulting_advocate_version,
  created_at,
  expires_at,
  settled_at
)
VALUES
  (
    'c1000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilea/c1000000-0000-4000-8000-000000000001.webp',
    'pending',
    'reconcile-just-expired',
    NULL,
    NULL,
    clock_timestamp() - interval '16 minutes',
    clock_timestamp() - interval '2 minutes',
    NULL
  ),
  (
    'c1000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilea/c1000000-0000-4000-8000-000000000002.webp',
    'expired',
    'reconcile-missing',
    'reservation_expired',
    NULL,
    clock_timestamp() - interval '41 minutes',
    clock_timestamp() - interval '27 minutes',
    clock_timestamp() - interval '20 minutes'
  ),
  (
    'c1000000-0000-4000-8000-000000000003',
    'c0000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilea/c1000000-0000-4000-8000-000000000003.webp',
    'cleanup_required',
    'reconcile-delete',
    'provider_outcome_ambiguous',
    NULL,
    clock_timestamp() - interval '41 minutes',
    clock_timestamp() - interval '27 minutes',
    clock_timestamp() - interval '20 minutes'
  ),
  (
    'c1000000-0000-4000-8000-000000000004',
    'c0000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilea/c1000000-0000-4000-8000-000000000004.webp',
    'cancelled',
    'reconcile-cancelled-absent',
    'request_rejected',
    NULL,
    clock_timestamp() - interval '41 minutes',
    clock_timestamp() - interval '27 minutes',
    clock_timestamp() - interval '20 minutes'
  ),
  (
    'c1000000-0000-4000-8000-000000000005',
    'c0000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilea/c1000000-0000-4000-8000-000000000005.webp',
    'cancelled',
    'reconcile-retry',
    'request_rejected_after_upload',
    NULL,
    clock_timestamp() - interval '41 minutes',
    clock_timestamp() - interval '27 minutes',
    clock_timestamp() - interval '20 minutes'
  ),
  (
    'c1000000-0000-4000-8000-000000000006',
    'c0000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilea/c1000000-0000-4000-8000-000000000006.webp',
    'attached',
    'reconcile-attached',
    NULL,
    2,
    clock_timestamp() - interval '41 minutes',
    clock_timestamp() - interval '27 minutes',
    clock_timestamp() - interval '20 minutes'
  ),
  (
    'c1000000-0000-4000-8000-000000000007',
    'c0000000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcileb/c1000000-0000-4000-8000-000000000007.webp',
    'expired',
    'reconcile-current-branding',
    'reservation_expired',
    NULL,
    clock_timestamp() - interval '41 minutes',
    clock_timestamp() - interval '27 minutes',
    clock_timestamp() - interval '20 minutes'
  ),
  (
    'c1000000-0000-4000-8000-000000000008',
    'c0000000-0000-4000-8000-000000000003',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilec/c1000000-0000-4000-8000-000000000008.webp',
    'pending',
    'reconcile-attachment-winner',
    NULL,
    NULL,
    clock_timestamp(),
    clock_timestamp() + interval '14 minutes',
    NULL
  ),
  (
    'c1000000-0000-4000-8000-000000000009',
    'c0000000-0000-4000-8000-000000000003',
    'c2000000-0000-4000-8000-000000000001',
    1,
    'logos/reconcilec/c1000000-0000-4000-8000-000000000009.webp',
    'cleanup_required',
    'reconcile-reclaim',
    'provider_outcome_ambiguous',
    NULL,
    clock_timestamp() - interval '41 minutes',
    clock_timestamp() - interval '27 minutes',
    clock_timestamp() - interval '20 minutes'
  );

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES
  (
    'advocate-assets',
    'logos/reconcilea/c1000000-0000-4000-8000-000000000003.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 1024)
  ),
  (
    'advocate-assets',
    'logos/reconcilea/c1000000-0000-4000-8000-000000000005.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 1024)
  ),
  (
    'advocate-assets',
    'logos/reconcilea/c1000000-0000-4000-8000-000000000006.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 1024)
  ),
  (
    'advocate-assets',
    'logos/reconcileb/c1000000-0000-4000-8000-000000000007.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 1024)
  ),
  (
    'advocate-assets',
    'logos/reconcilec/c1000000-0000-4000-8000-000000000008.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 1024)
  ),
  (
    'advocate-assets',
    'logos/reconcilec/c1000000-0000-4000-8000-000000000009.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 1024)
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_advocate_logo_reconciliation_jobs(
      'browser-worker',
      1,
      'browser-claim',
      NULL
    )
  $$,
  '42501',
  NULL,
  'an authenticated browser cannot execute the reconciliation worker boundary'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_advocate_logo_reconciliation_jobs(
      'worker-a',
      21,
      'oversized-claim',
      NULL
    )
  $$,
  '22023',
  'Logo reconciliation claim input is malformed',
  'the reconciliation claim is bounded to at most twenty jobs'
);

CREATE TEMP TABLE test_logo_reconciliation_claim_one AS
SELECT *
FROM public.claim_advocate_logo_reconciliation_jobs(
  'worker-a',
  20,
  'logo-recon-claim-1',
  'logo-recon-trace-1'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM test_logo_reconciliation_claim_one
  ),
  5::bigint,
  'the first claim enqueues only old expired, cleanup-required, cancelled residue, and protected current-branding evidence'
);

SELECT extensions.ok(
  (
    SELECT reservation.status = 'expired'
      AND reservation.settled_at > clock_timestamp() - interval '30 seconds'
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.id = 'c1000000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.advocate_logo_reconciliation_jobs job
    WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000001'
  ),
  'a newly expired pending reservation is terminalized first and waits through its two-minute safety grace'
);

SELECT extensions.ok(
  (
    SELECT count(*)
    FROM private.advocate_logo_reconciliation_jobs job
    WHERE job.reservation_id IN (
      'c1000000-0000-4000-8000-000000000002',
      'c1000000-0000-4000-8000-000000000003',
      'c1000000-0000-4000-8000-000000000005',
      'c1000000-0000-4000-8000-000000000007',
      'c1000000-0000-4000-8000-000000000009'
    )
  ) = 5
  AND NOT EXISTS (
    SELECT 1
    FROM private.advocate_logo_reconciliation_jobs job
    WHERE job.reservation_id IN (
      'c1000000-0000-4000-8000-000000000004',
      'c1000000-0000-4000-8000-000000000006',
      'c1000000-0000-4000-8000-000000000008'
    )
  ),
  'cancelled missing residue, attached reservations, and live pending reservations are not enqueued'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM test_logo_reconciliation_claim_one claim
    WHERE claim.lease_token !~ '^[0-9a-f]{64}$'
      OR claim.attempt_count <> 1
      OR claim.maximum_attempts <> 8
  )
  AND NOT EXISTS (
    SELECT 1
    FROM test_logo_reconciliation_claim_one claim
    JOIN private.advocate_logo_reconciliation_jobs job
      ON job.id = claim.job_id
    WHERE octet_length(job.lease_token_digest) <> 32
      OR job.lease_token_digest IS DISTINCT FROM
        extensions.digest(claim.lease_token, 'sha256')
      OR job.lease_expires_at - job.claimed_at <> interval '120 seconds'
      OR job.worker_id <> 'worker-a'
  ),
  'each claim returns one 256-bit token while persisting only its exact digest and a 120-second lease'
);

UPDATE private.advocate_logo_upload_reservations reservation
SET
  status = 'attached',
  resulting_advocate_version = 2,
  settled_at = clock_timestamp()
WHERE reservation.id = 'c1000000-0000-4000-8000-000000000008';

SELECT extensions.ok(
  (
    SELECT reservation.status = 'attached'
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.id = 'c1000000-0000-4000-8000-000000000008'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.advocate_logo_reconciliation_jobs job
    WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000008'
  ),
  'a live attachment wins its reservation row before cleanup and therefore never creates a deletion job'
);

SELECT extensions.throws_ok(
  $$
    UPDATE private.advocate_logo_upload_reservations reservation
    SET
      status = 'attached',
      failure_code = NULL,
      resulting_advocate_version = 2,
      settled_at = clock_timestamp()
    WHERE reservation.id = 'c1000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'Terminal logo reservations are immutable',
  'once expiration wins the reservation lock, a later attachment cannot reverse the cleanup decision'
);

SELECT extensions.throws_ok(
  $$
    UPDATE private.advocate_logo_reconciliation_jobs job
    SET object_path =
      'logos/reconcilea/c1000000-0000-4000-8000-000000000099.webp'
    WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'Logo reconciliation identity and reservation evidence are immutable',
  'job identity cannot be detached from its immutable reservation evidence'
);

SELECT extensions.throws_ok(
  $$
    UPDATE private.advocate_logo_upload_reservations reservation
    SET object_path =
      'logos/reconcilea/c1000000-0000-4000-8000-000000000098.webp'
    WHERE reservation.id = 'c1000000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'Logo reservation identity and evidence are immutable',
  'the source reservation path and tenant evidence remain immutable'
);

SELECT extensions.is(
  (
    SELECT authorization_result.outcome || '|' || coalesce(authorization_result.object_path, 'null')
    FROM test_logo_reconciliation_claim_one claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      claim.job_id,
      claim.lease_token,
      'logo-recon-authorize-missing',
      'logo-recon-trace-missing'
    ) authorization_result
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000002'
  ),
  'already_absent|null',
  'a safely abandoned object that is already absent reveals no path and needs no provider delete'
);

SELECT extensions.is(
  (
    SELECT public.complete_advocate_logo_reconciliation_job(
      claim.job_id,
      claim.lease_token,
      'already_absent',
      'logo-recon-complete-missing',
      'logo-recon-trace-missing'
    )
    FROM test_logo_reconciliation_claim_one claim
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000002'
  ),
  'completed',
  'missing-object completion succeeds only after the database independently proves absence'
);

SELECT extensions.is(
  (
    SELECT public.complete_advocate_logo_reconciliation_job(
      claim.job_id,
      claim.lease_token,
      'already_absent',
      'logo-recon-complete-missing-replay',
      NULL
    )
    FROM test_logo_reconciliation_claim_one claim
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000002'
  ),
  'completed',
  'same-token replay of an identical successful outcome is idempotent'
);

SELECT extensions.is(
  (
    SELECT authorization_result.outcome || '|' || authorization_result.object_path
    FROM test_logo_reconciliation_claim_one claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      claim.job_id,
      claim.lease_token,
      'logo-recon-authorize-delete',
      NULL
    ) authorization_result
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000003'
  ),
  'delete|logos/reconcilea/c1000000-0000-4000-8000-000000000003.webp',
  'authorization returns the exact immutable path only while every deletion invariant is safe'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.complete_advocate_logo_reconciliation_job(%L, %L, %L, %L, NULL)',
    (
      SELECT claim.job_id
      FROM test_logo_reconciliation_claim_one claim
      WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000003'
    ),
    (
      SELECT claim.lease_token
      FROM test_logo_reconciliation_claim_one claim
      WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000003'
    ),
    'deleted',
    'logo-recon-complete-too-soon'
  ),
  '55000',
  'Logo reconciliation completion requires an absent object',
  'completion refuses to trust a worker while the exact storage row is still present'
);

SET LOCAL session_replication_role = replica;
DELETE FROM storage.objects object
WHERE object.bucket_id = 'advocate-assets'
  AND object.name =
    'logos/reconcilea/c1000000-0000-4000-8000-000000000003.webp';
SET LOCAL session_replication_role = origin;

SELECT extensions.is(
  (
    SELECT public.complete_advocate_logo_reconciliation_job(
      claim.job_id,
      claim.lease_token,
      'deleted',
      'logo-recon-complete-delete',
      NULL
    )
    FROM test_logo_reconciliation_claim_one claim
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000003'
  ),
  'completed',
  'fenced deletion completion succeeds after the storage row is absent'
);

SELECT extensions.is(
  (
    SELECT authorization_result.outcome || '|' || coalesce(authorization_result.object_path, 'null')
    FROM test_logo_reconciliation_claim_one claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      claim.job_id,
      claim.lease_token,
      'logo-recon-authorize-branding',
      NULL
    ) authorization_result
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000007'
  ),
  'quarantined|null',
  'a current branding path is durably quarantined and is never authorized for deletion'
);

SELECT extensions.ok(
  (
    SELECT job.status = 'quarantined'
      AND job.quarantine_reason_code = 'branding_path_in_use'
      AND job.terminal_outcome = 'quarantined'
      AND job.lease_token_digest IS NULL
    FROM private.advocate_logo_reconciliation_jobs job
    WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000007'
  ),
  'branding protection is retained as a terminal bounded-code quarantine record'
);

SELECT extensions.is(
  (
    SELECT authorization_result.outcome
    FROM test_logo_reconciliation_claim_one claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      claim.job_id,
      repeat('0', 64),
      'logo-recon-wrong-token',
      NULL
    ) authorization_result
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000005'
  ),
  'lease_lost',
  'a wrong authorization token reveals no path and does not mutate the job'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.fail_advocate_logo_reconciliation_job(%L, %L, %L, %L, NULL)',
    (
      SELECT claim.job_id
      FROM test_logo_reconciliation_claim_one claim
      WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000005'
    ),
    repeat('0', 64),
    'storage_timeout',
    'logo-recon-wrong-fail-token'
  ),
  '55P03',
  'Logo reconciliation failure lease was lost',
  'a wrong failure token cannot mutate or reschedule work'
);

CREATE TEMP TABLE test_logo_reconciliation_failure_one AS
SELECT failure.*
FROM test_logo_reconciliation_claim_one claim
CROSS JOIN LATERAL public.fail_advocate_logo_reconciliation_job(
  claim.job_id,
  claim.lease_token,
  'storage_timeout',
  'logo-recon-fail-1',
  'logo-recon-fail-trace-1'
) failure
WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000005';

SELECT extensions.ok(
  (
    SELECT failure.status = 'retry_scheduled'
      AND failure.next_attempt_at > clock_timestamp() + interval '4 minutes 55 seconds'
      AND failure.next_attempt_at < clock_timestamp() + interval '5 minutes 5 seconds'
    FROM test_logo_reconciliation_failure_one failure
  )
  AND (
    SELECT job.status = 'retry_wait'
      AND job.last_failure_code = 'storage_timeout'
      AND job.available_at = failure.next_attempt_at
      AND job.lease_token_digest IS NULL
    FROM private.advocate_logo_reconciliation_jobs job
    CROSS JOIN test_logo_reconciliation_failure_one failure
    WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000005'
  ),
  'the first bounded failure schedules an exact five-minute retry and destroys its active lease'
);

SELECT extensions.is(
  (
    SELECT authorization_result.outcome
    FROM test_logo_reconciliation_claim_one claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      claim.job_id,
      claim.lease_token,
      'logo-recon-old-failed-token',
      NULL
    ) authorization_result
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000005'
  ),
  'lease_lost',
  'a failed attempt token remains stale and cannot regain deletion authority'
);

SET LOCAL session_replication_role = replica;
UPDATE private.advocate_logo_reconciliation_jobs job
SET
  created_at = job.created_at - interval '3 minutes',
  claimed_at = job.claimed_at - interval '3 minutes',
  lease_expires_at = job.lease_expires_at - interval '3 minutes'
WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000009';
SET LOCAL session_replication_role = origin;

SELECT extensions.is(
  (
    SELECT authorization_result.outcome
    FROM test_logo_reconciliation_claim_one claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      claim.job_id,
      claim.lease_token,
      'logo-recon-expired-token',
      NULL
    ) authorization_result
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000009'
  ),
  'lease_lost',
  'an expired token never authorizes a storage path'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.complete_advocate_logo_reconciliation_job(%L, %L, %L, %L, NULL)',
    (
      SELECT claim.job_id
      FROM test_logo_reconciliation_claim_one claim
      WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000009'
    ),
    (
      SELECT claim.lease_token
      FROM test_logo_reconciliation_claim_one claim
      WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000009'
    ),
    'deleted',
    'logo-recon-expired-complete'
  ),
  '55P03',
  'Logo reconciliation completion lease was lost',
  'an expired token cannot complete work'
);

CREATE TEMP TABLE test_logo_reconciliation_claim_two AS
SELECT *
FROM public.claim_advocate_logo_reconciliation_jobs(
  'worker-b',
  20,
  'logo-recon-claim-2',
  NULL
);

SELECT extensions.ok(
  (
    SELECT second_claim.lease_token <> first_claim.lease_token
      AND second_claim.attempt_count = 2
      AND second_claim.lease_expires_at > clock_timestamp()
    FROM test_logo_reconciliation_claim_two second_claim
    JOIN test_logo_reconciliation_claim_one first_claim
      USING (reservation_id)
    WHERE second_claim.reservation_id =
      'c1000000-0000-4000-8000-000000000009'
  )
  AND (
    SELECT job.worker_id = 'worker-b'
      AND job.lease_token_digest =
        extensions.digest(second_claim.lease_token, 'sha256')
    FROM private.advocate_logo_reconciliation_jobs job
    JOIN test_logo_reconciliation_claim_two second_claim
      ON second_claim.job_id = job.id
    WHERE job.reservation_id =
      'c1000000-0000-4000-8000-000000000009'
  ),
  'an expired processing lease is reclaimed with a rotated token and incremented attempt'
);

SELECT extensions.is(
  (
    SELECT authorization_result.outcome
    FROM test_logo_reconciliation_claim_one first_claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      first_claim.job_id,
      first_claim.lease_token,
      'logo-recon-stale-token',
      NULL
    ) authorization_result
    WHERE first_claim.reservation_id =
      'c1000000-0000-4000-8000-000000000009'
  ),
  'lease_lost',
  'the prior plaintext token is stale immediately after lease rotation'
);

UPDATE public.advocate_branding branding
SET
  logo_storage_path =
    'logos/reconcilec/c1000000-0000-4000-8000-000000000009.webp',
  logo_alt_text = 'Won a post-claim race'
WHERE branding.advocate_id = 'c0000000-0000-4000-8000-000000000003';

SELECT extensions.is(
  (
    SELECT authorization_result.outcome || '|' || coalesce(authorization_result.object_path, 'null')
    FROM test_logo_reconciliation_claim_two claim
    CROSS JOIN LATERAL public.authorize_advocate_logo_reconciliation_deletion(
      claim.job_id,
      claim.lease_token,
      'logo-recon-race-quarantine',
      NULL
    ) authorization_result
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000009'
  ),
  'quarantined|null',
  'a branding reference that appears after claim wins the final fence and quarantines deletion'
);

SET LOCAL session_replication_role = replica;
UPDATE private.advocate_logo_reconciliation_jobs job
SET
  attempt_count = 7,
  available_at = clock_timestamp() - interval '1 second'
WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000005';
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE test_logo_reconciliation_claim_three AS
SELECT *
FROM public.claim_advocate_logo_reconciliation_jobs(
  'worker-c',
  20,
  'logo-recon-claim-3',
  NULL
);

SELECT extensions.is(
  (
    SELECT claim.attempt_count
    FROM test_logo_reconciliation_claim_three claim
    WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000005'
  ),
  8::smallint,
  'the eighth and final attempt can be claimed once its retry is available'
);

CREATE TEMP TABLE test_logo_reconciliation_failure_eight AS
SELECT failure.*
FROM test_logo_reconciliation_claim_three claim
CROSS JOIN LATERAL public.fail_advocate_logo_reconciliation_job(
  claim.job_id,
  claim.lease_token,
  'storage_unavailable',
  'logo-recon-fail-8',
  NULL
) failure
WHERE claim.reservation_id = 'c1000000-0000-4000-8000-000000000005';

SELECT extensions.ok(
  (
    SELECT failure.status = 'exhausted'
      AND failure.next_attempt_at IS NULL
    FROM test_logo_reconciliation_failure_eight failure
  )
  AND (
    SELECT job.status = 'exhausted'
      AND job.attempt_count = 8
      AND job.maximum_attempts = 8
      AND job.last_failure_code = 'storage_unavailable'
      AND job.terminal_outcome = 'exhausted'
      AND job.completed_at IS NOT NULL
      AND job.lease_token_digest IS NULL
    FROM private.advocate_logo_reconciliation_jobs job
    WHERE job.reservation_id = 'c1000000-0000-4000-8000-000000000005'
  ),
  'attempt eight exhausts permanently and returns no next-attempt timestamp'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.fail_advocate_logo_reconciliation_job(
      (
        SELECT job.id
        FROM private.advocate_logo_reconciliation_jobs job
        WHERE job.reservation_id =
          'c1000000-0000-4000-8000-000000000005'
      ),
      repeat('1', 64),
      'free form provider exploded',
      'logo-recon-unbounded-code',
      NULL
    )
  $$,
  '22023',
  'Logo reconciliation failure input is malformed',
  'free-form provider failure text is rejected at the RPC boundary'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'advocate_logo_reconciliation_jobs'
      AND event.advocate_id = 'c0000000-0000-4000-8000-000000000001'
      AND event.actor_type = 'system'
      AND event.system_actor = 'advocate-logo-reconciliation-worker'
      AND event.tool = 'advocate-logo-reconciliation'
      AND event.request_id = 'logo-recon-claim-1'
      AND event.trace_id = 'logo-recon-trace-1'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND cardinality(event.changed_columns) > 0
  ),
  'queue changes emit advocate-scoped columns-only audit events with the fixed system actor, tool, request, and trace'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_logo_reconciliation_jobs'
      AND (
        event.before_data IS NOT NULL
        OR event.after_data IS NOT NULL
        OR event.metadata::text LIKE '%lease_token%'
      )
  ),
  'reconciliation audit evidence never contains row images or plaintext lease material'
);

SELECT extensions.throws_ok(
  'TRUNCATE private.advocate_logo_reconciliation_jobs',
  '42501',
  'Operational sponsorship tables cannot be truncated',
  'even the table owner cannot truncate durable reconciliation evidence through ordinary SQL'
);

SELECT * FROM extensions.finish();
ROLLBACK;

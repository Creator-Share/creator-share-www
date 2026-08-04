BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '60s';

SELECT extensions.plan(29);

CREATE TEMP TABLE publication_operation_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  bigint_value bigint,
  text_value text,
  bytea_value bytea
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.set_publication_operation_actor(
  target_user_id uuid,
  target_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', target_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', target_user_id::text,
      'session_id', target_session_id::text,
      'aal', 'aal1'
    )::text,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.publication_operation_provider_result(
  target_provider public.advocate_domain_integration_provider
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE target_provider
    WHEN 'cloudflare' THEN jsonb_build_object(
      'provider_status', 'dns_only_cname_ready',
      'provider_resource_id', repeat('d', 32),
      'dns_record_id', repeat('d', 32),
      'http_status', 200,
      'verified', true
    )
    WHEN 'vercel' THEN jsonb_build_object(
      'provider_status', 'attached_verified',
      'provider_resource_id', 'durablepublication.creatorshare.com',
      'deployment_id', 'dpl_durable_publication',
      'http_status', 200,
      'verified', true
    )
    ELSE jsonb_build_object(
      'provider_status', 'payment_path_ready',
      'provider_resource_id', target_provider::text || ':hosted_checkout',
      'http_status', 200,
      'verified', true
    )
  END;
$$;

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
      AND coalesce(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.begin_or_resume_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND coalesce(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.publish_advocate_portal_from_canary_v2(uuid,bigint,uuid,uuid,text,bytea,text,uuid,text,uuid,text,text)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND coalesce(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.mint_advocate_publication_deployment_capability(uuid,uuid,text,text)'::regprocedure
  ),
  'durable operation and deployment-capability boundaries are fixed-search-path security definers'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.begin_or_resume_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.publish_advocate_portal_from_canary_v2(uuid,bigint,uuid,uuid,text,bytea,text,uuid,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.mint_advocate_publication_deployment_capability(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.mint_advocate_publication_deployment_capability(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.mint_advocate_publication_deployment_capability(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.publish_advocate_portal_from_canary_v2(uuid,bigint,uuid,uuid,text,bytea,text,uuid,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.advocate_publication_deployment_capabilities',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_publication_deployment_capabilities',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_publication_deployment_capabilities',
    'SELECT'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.begin_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.get_advocate_publication_canary_execution(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.publish_advocate_portal_from_canary(uuid,bigint,uuid,text,bytea,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated publication and service deployment attestation have disjoint runtime privileges and no capability-table access'
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
    'c7100000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'publication-initiator@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    'c7100000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'publication-resumer@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  );

INSERT INTO auth.sessions (
  id,
  user_id,
  created_at,
  updated_at,
  aal,
  not_after
)
VALUES
  (
    'c7200000-0000-4000-8000-000000000001'::uuid,
    'c7100000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    'c7200000-0000-4000-8000-000000000002'::uuid,
    'c7100000-0000-4000-8000-000000000002'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  );

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT actor.user_id, role.id, NULL, NULL
FROM (
  VALUES
    ('c7100000-0000-4000-8000-000000000001'::uuid),
    ('c7100000-0000-4000-8000-000000000002'::uuid)
) AS actor(user_id)
CROSS JOIN public.roles role
WHERE role.name = 'SUPER_ADMIN';

SELECT pg_temp.set_publication_operation_actor(
  'c7100000-0000-4000-8000-000000000001'::uuid,
  'c7200000-0000-4000-8000-000000000001'::uuid
);

WITH created AS (
  SELECT public.create_advocate_portal(
    'c7100000-0000-4000-8000-000000000001'::uuid,
    'durablepublication',
    'Durable Publication',
    'Create a durable publication operation fixture',
    'creator',
    'durable-publication-create-request',
    'durable-publication-create-trace',
    'c7200000-0000-4000-8000-000000000001'
  ) AS advocate_id
)
INSERT INTO publication_operation_context (key, uuid_value)
SELECT 'advocate', advocate_id FROM created;

UPDATE publication_operation_context context
SET bigint_value = advocate.version
FROM public.advocates advocate
WHERE context.key = 'advocate'
  AND advocate.id = context.uuid_value;

WITH provisioning AS (
  SELECT *
  FROM public.start_advocate_portal_provisioning(
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
    (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
    'c7300000-0000-4000-8000-000000000001'::uuid,
    'durable-publication-provisioning'
  )
)
INSERT INTO publication_operation_context (key, uuid_value, bigint_value, text_value)
SELECT 'domain', domain_id, advocate_version, hostname
FROM provisioning;

UPDATE publication_operation_context context
SET bigint_value = (
  SELECT domain.bigint_value
  FROM publication_operation_context domain
  WHERE domain.key = 'domain'
)
WHERE context.key = 'advocate';

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);

CREATE TEMP TABLE publication_operation_claims (
  provider public.advocate_domain_integration_provider PRIMARY KEY,
  job_id uuid NOT NULL,
  lease_token uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO publication_operation_claims (provider, job_id, lease_token)
SELECT claimed.provider, claimed.job_id, claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'durable-publication-provider-worker',
  5,
  interval '10 minutes'
) claimed;

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  pg_temp.publication_operation_provider_result(claim.provider)
)
FROM publication_operation_claims claim;

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  pg_temp.publication_operation_provider_result(claim.provider)
)
FROM publication_operation_claims claim;

SELECT pg_temp.set_publication_operation_actor(
  'c7100000-0000-4000-8000-000000000001'::uuid,
  'c7200000-0000-4000-8000-000000000001'::uuid
);

UPDATE publication_operation_context context
SET bigint_value = advocate.version
FROM public.advocates advocate
WHERE context.key = 'advocate'
  AND advocate.id = context.uuid_value;

SELECT extensions.ok(
  (
    SELECT snapshot.can_begin_publication_canary
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate')
    ) snapshot
  ),
  'the control snapshot derives publication eligibility from exact ready database state'
);

WITH started AS (
  SELECT *
  FROM public.begin_or_resume_advocate_publication_canary(
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
    (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
    'c7400000-0000-4000-8000-000000000001'::uuid,
    'dpl_durable_publication',
    repeat('a', 40),
    'durable-publication-start-trace',
    'Approve the reviewed durable publication operation',
    '203.0.113.41',
    'Creator Share Publication Test/1.0'
  )
)
INSERT INTO publication_operation_context (key, uuid_value, text_value)
SELECT 'run', run_id, deployment_id
FROM started
WHERE created
  AND operation_id = 'c7400000-0000-4000-8000-000000000001'::uuid;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM publication_operation_context context
    WHERE context.key = 'run'
      AND context.text_value = 'dpl_durable_publication'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_starts start
    WHERE start.request_id = 'c7400000-0000-4000-8000-000000000001'::uuid
      AND start.run_id = (
        SELECT uuid_value FROM publication_operation_context WHERE key = 'run'
      )
      AND start.initiating_user_id =
        'c7100000-0000-4000-8000-000000000001'::uuid
      AND start.initiating_session_id =
        'c7200000-0000-4000-8000-000000000001'
  ),
  'the browser operation UUID and initiating signed session bind one immutable start'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.table_name = 'advocate_publication_canary_starts'
      AND event.record_pk ->> 'run_id' = (
        SELECT uuid_value::text
        FROM publication_operation_context
        WHERE key = 'run'
      )
      AND event.session_id = 'c7200000-0000-4000-8000-000000000001'
      AND forensic.client_ip = '203.0.113.41'
      AND forensic.user_agent = 'Creator Share Publication Test/1.0'
      AND forensic.expires_at = forensic.captured_at + interval '90 days'
  ),
  'start transport evidence is isolated in the exact 90-day forensic layer'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'audit'
      AND column_definition.table_name IN (
        'advocate_publication_canary_starts',
        'advocate_publication_approvals'
      )
      AND column_definition.column_name IN ('client_ip', 'user_agent')
  ),
  'permanent publication receipts structurally exclude raw transport fields'
);

SELECT extensions.is(
  (
    SELECT snapshot.can_begin_publication_canary
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate')
    ) snapshot
  ),
  false,
  'an unexpired incomplete operation suppresses fresh-start eligibility'
);

SELECT pg_temp.set_publication_operation_actor(
  'c7100000-0000-4000-8000-000000000002'::uuid,
  'c7200000-0000-4000-8000-000000000002'::uuid
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.begin_or_resume_advocate_publication_canary(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000001'::uuid,
      'dpl_later_deployment',
      repeat('b', 40),
      'durable-publication-resume-trace',
      'Approve the reviewed durable publication operation',
      '203.0.113.42',
      'Creator Share Publication Test/2.0'
    ) resumed
    WHERE NOT resumed.created
      AND resumed.run_id = (
        SELECT uuid_value FROM publication_operation_context WHERE key = 'run'
      )
      AND resumed.deployment_id = 'dpl_durable_publication'
      AND resumed.revision = repeat('a', 40)
  ),
  'a later healthy administrator resumes the first deployment binding without creating work'
);

SELECT extensions.is(
  (
    SELECT count(*)::bigint
    FROM audit.advocate_publication_canary_starts start
    WHERE start.request_id = 'c7400000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'cross-administrator recovery leaves exactly one run and one payment-attempt set'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_starts start
    WHERE start.request_id = 'c7400000-0000-4000-8000-000000000001'::uuid
      AND start.initiating_user_id =
        'c7100000-0000-4000-8000-000000000001'::uuid
      AND start.initiating_session_id =
        'c7200000-0000-4000-8000-000000000001'
  ),
  'later recovery cannot rewrite the initiating actor or signed session'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_or_resume_advocate_publication_canary(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000001'::uuid,
      'dpl_later_deployment',
      repeat('b', 40),
      'durable-publication-wrong-reason-trace',
      'A different reviewed reason must never recover the operation',
      NULL,
      NULL
    )
  $$,
  '40001',
  'Advocate publication operation does not match the committed request',
  'operation recovery requires the exact reviewed advocate version and reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_or_resume_advocate_publication_canary(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000002'::uuid,
      'dpl_later_deployment',
      repeat('b', 40),
      'durable-publication-overlap-trace',
      'Approve the reviewed durable publication operation',
      NULL,
      NULL
    )
  $$,
  '40001',
  'An advocate publication operation is already in progress',
  'a second operation cannot overlap an incomplete run for the reviewed version'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', 'c7100000-0000-4000-8000-000000000002'
  )::text,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_or_resume_advocate_publication_canary(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000001'::uuid,
      'dpl_later_deployment',
      repeat('b', 40),
      'durable-publication-no-session-trace',
      'Approve the reviewed durable publication operation',
      NULL,
      NULL
    )
  $$,
  '28000',
  'A signed authentication session is required',
  'every poll requires a signed active authentication session at the database boundary'
);

SELECT pg_temp.set_publication_operation_actor(
  'c7100000-0000-4000-8000-000000000002'::uuid,
  'c7200000-0000-4000-8000-000000000002'::uuid
);

SET LOCAL session_replication_role = 'replica';

INSERT INTO audit.advocate_publication_canary_reports (
  run_id,
  completion_request_id,
  completing_user_id,
  advocate_id,
  expected_advocate_version,
  domain_id,
  hostname,
  deployment_id,
  git_revision,
  outcome,
  failure_code,
  completed_at,
  canonical_report_text,
  report_sha256,
  trace_id,
  admin_reason,
  recorded_at
)
SELECT
  start.run_id,
  'c7500000-0000-4000-8000-000000000001'::uuid,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  start.deployment_id,
  start.git_revision,
  'succeeded',
  NULL,
  clock_timestamp(),
  '{}'::text,
  extensions.digest(pg_catalog.convert_to('{}', 'UTF8'), 'sha256'),
  start.trace_id,
  start.admin_reason,
  clock_timestamp()
FROM audit.advocate_publication_canary_starts start
WHERE start.request_id = 'c7400000-0000-4000-8000-000000000001'::uuid;

SET LOCAL session_replication_role = 'origin';

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_or_resume_advocate_publication_canary(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000003'::uuid,
      'dpl_later_deployment',
      repeat('b', 40),
      'durable-publication-new-operation-after-success-trace',
      'Approve the reviewed durable publication operation',
      NULL,
      NULL
    )
  $$,
  '40001',
  'An advocate publication operation is already in progress',
  'a changed deployment cannot create a second operation while successful evidence awaits approval'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.begin_or_resume_advocate_publication_canary(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000001'::uuid,
      'dpl_later_deployment',
      repeat('b', 40),
      'durable-publication-original-operation-after-success-trace',
      'Approve the reviewed durable publication operation',
      NULL,
      NULL
    ) resumed
    WHERE NOT resumed.created
      AND resumed.run_id = (
        SELECT uuid_value FROM publication_operation_context WHERE key = 'run'
      )
      AND resumed.deployment_id = 'dpl_durable_publication'
      AND resumed.revision = repeat('a', 40)
      AND resumed.outcome = 'succeeded'
      AND resumed.report_sha256 =
        extensions.digest(pg_catalog.convert_to('{}', 'UTF8'), 'sha256')
  )
  AND (
    SELECT count(*)
    FROM audit.advocate_publication_canary_starts start
    WHERE start.advocate_id = (
      SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'
    )
      AND start.expected_advocate_version = (
        SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'
      )
  ) = 1,
  'the exact original operation still returns immutable successful evidence without minting another run'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary_v2(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000001'::uuid,
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
      'dpl_durable_publication',
      extensions.digest(pg_catalog.convert_to('{}', 'UTF8'), 'sha256'),
      'Approve the reviewed durable publication operation',
      'c7600000-0000-5000-8000-000000000001'::uuid,
      'durable-publication-direct-admin-bypass',
      NULL,
      NULL,
      NULL
    )
  $$,
  '42501',
  'A current server deployment capability is required',
  'an authenticated administrator cannot publish with caller-supplied old deployment input alone'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.mint_advocate_publication_deployment_capability(
      'c7400000-0000-4000-8000-000000000009'::uuid,
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
      'dpl_durable_publication',
      repeat('a', 40)
    )
  $$,
  '23503',
  'Advocate publication operation does not exist',
  'the server cannot mint a capability for an unknown operation'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.mint_advocate_publication_deployment_capability(
      'c7400000-0000-4000-8000-000000000001'::uuid,
      'c7400000-0000-4000-8000-000000000099'::uuid,
      'dpl_durable_publication',
      repeat('a', 40)
    )
  $$,
  '40001',
  'Publication deployment capability does not match the committed operation',
  'the server cannot mint a capability for a changed run'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.mint_advocate_publication_deployment_capability(
      'c7400000-0000-4000-8000-000000000001'::uuid,
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
      'dpl_later_deployment',
      repeat('b', 40)
    )
  $$,
  '40001',
  'Publication deployment capability does not match the committed operation',
  'the server cannot mint a capability after its deployment or revision changes'
);

WITH minted AS (
  SELECT *
  FROM public.mint_advocate_publication_deployment_capability(
    'c7400000-0000-4000-8000-000000000001'::uuid,
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
    'dpl_durable_publication',
    repeat('a', 40)
  )
)
INSERT INTO publication_operation_context (key, uuid_value, text_value)
SELECT
  'expired_capability',
  deployment_capability_id,
  expires_at::text
FROM minted;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM private.advocate_publication_deployment_capabilities capability
    JOIN audit.advocate_publication_canary_starts start
      ON start.request_id = capability.operation_id
     AND start.run_id = capability.run_id
     AND start.deployment_id = capability.deployment_id
     AND start.git_revision = capability.git_revision
    JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = capability.run_id
     AND report.report_sha256 = capability.report_sha256
    WHERE capability.capability_id = (
        SELECT uuid_value
        FROM publication_operation_context
        WHERE key = 'expired_capability'
      )
      AND capability.capability_id::text ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND capability.expires_at > capability.created_at
      AND capability.expires_at <=
        capability.created_at + interval '60 seconds'
  ),
  'the database mints one short-lived random capability bound to the exact successful operation and deployment'
);

UPDATE private.advocate_publication_deployment_capabilities capability
SET
  created_at = clock_timestamp() - interval '2 minutes',
  expires_at = clock_timestamp() - interval '90 seconds'
WHERE capability.capability_id = (
  SELECT uuid_value
  FROM publication_operation_context
  WHERE key = 'expired_capability'
);

SELECT pg_temp.set_publication_operation_actor(
  'c7100000-0000-4000-8000-000000000002'::uuid,
  'c7200000-0000-4000-8000-000000000002'::uuid
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary_v2(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000001'::uuid,
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
      'dpl_durable_publication',
      extensions.digest(pg_catalog.convert_to('{}', 'UTF8'), 'sha256'),
      'Approve the reviewed durable publication operation',
      'c7600000-0000-5000-8000-000000000001'::uuid,
      'durable-publication-expired-capability',
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'expired_capability'),
      NULL,
      NULL
    )
  $$,
  '42501',
  'Current server deployment capability does not match',
  'an expired deployment capability cannot authorize publication'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);

WITH minted AS (
  SELECT *
  FROM public.mint_advocate_publication_deployment_capability(
    'c7400000-0000-4000-8000-000000000001'::uuid,
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
    'dpl_durable_publication',
    repeat('a', 40)
  )
)
INSERT INTO publication_operation_context (key, uuid_value, text_value)
SELECT
  'active_capability',
  deployment_capability_id,
  expires_at::text
FROM minted;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM private.advocate_publication_deployment_capabilities capability
    WHERE capability.capability_id = (
      SELECT uuid_value
      FROM publication_operation_context
      WHERE key = 'expired_capability'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM private.advocate_publication_deployment_capabilities capability
    WHERE capability.capability_id = (
        SELECT uuid_value
        FROM publication_operation_context
        WHERE key = 'active_capability'
      )
      AND capability.expires_at > clock_timestamp()
  )
  AND (
    SELECT expired.uuid_value <> active.uuid_value
    FROM publication_operation_context expired
    CROSS JOIN publication_operation_context active
    WHERE expired.key = 'expired_capability'
      AND active.key = 'active_capability'
  ),
  'a later mint deletes expired capability state and issues a distinct current capability'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary_v2(
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
      'c7400000-0000-4000-8000-000000000001'::uuid,
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
      'dpl_durable_publication',
      extensions.digest(pg_catalog.convert_to('{}', 'UTF8'), 'sha256'),
      'Approve the reviewed durable publication operation',
      'c7600000-0000-5000-8000-000000000001'::uuid,
      'durable-publication-service-capability-alone',
      (SELECT uuid_value FROM publication_operation_context WHERE key = 'active_capability'),
      NULL,
      NULL
    )
  $$,
  '28000',
  'Authentication is required',
  'a service deployment capability without an authenticated administrator cannot publish'
);

SELECT pg_temp.set_publication_operation_actor(
  'c7100000-0000-4000-8000-000000000002'::uuid,
  'c7200000-0000-4000-8000-000000000002'::uuid
);

SELECT extensions.is(
  public.publish_advocate_portal_from_canary_v2(
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
    (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
    'c7400000-0000-4000-8000-000000000001'::uuid,
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
    'dpl_durable_publication',
    extensions.digest(pg_catalog.convert_to('{}', 'UTF8'), 'sha256'),
    'Approve the reviewed durable publication operation',
    'c7600000-0000-5000-8000-000000000001'::uuid,
    'durable-publication-approval-by-later-admin',
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'active_capability'),
    '203.0.113.42',
    'Creator Share Publication Test/2.0'
  ),
  (SELECT bigint_value + 1 FROM publication_operation_context WHERE key = 'advocate'),
  'a later healthy administrator can publish the exact initiating operation'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_publication_approvals approval
    WHERE approval.request_id =
        'c7600000-0000-5000-8000-000000000001'::uuid
      AND approval.approving_user_id =
        'c7100000-0000-4000-8000-000000000002'::uuid
      AND approval.approving_session_id =
        'c7200000-0000-4000-8000-000000000002'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.table_name = 'advocate_publication_approvals'
      AND event.request_id =
        'c7600000-0000-5000-8000-000000000001'
      AND event.actor_user_id =
        'c7100000-0000-4000-8000-000000000002'::uuid
      AND event.session_id = 'c7200000-0000-4000-8000-000000000002'
      AND forensic.client_ip = '203.0.113.42'
      AND forensic.user_agent = 'Creator Share Publication Test/2.0'
  ),
  'publication binds the actual approving actor and session while isolating transport forensics'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM private.advocate_publication_deployment_capabilities capability
    WHERE capability.operation_id =
      'c7400000-0000-4000-8000-000000000001'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.metadata::text LIKE '%' || (
      SELECT uuid_value::text
      FROM publication_operation_context
      WHERE key = 'active_capability'
    ) || '%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'audit'
      AND column_definition.table_name IN (
        'advocate_publication_canary_starts',
        'advocate_publication_approvals'
      )
      AND column_definition.column_name LIKE '%capability%'
  ),
  'successful publication consumes the capability without copying its identity into permanent audit receipts'
);

SET LOCAL session_replication_role = 'replica';

UPDATE public.advocates advocate
SET version = advocate.version + 7
WHERE advocate.id = (
  SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'
);

SET LOCAL session_replication_role = 'origin';

SELECT extensions.is(
  public.publish_advocate_portal_from_canary_v2(
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'advocate'),
    (SELECT bigint_value FROM publication_operation_context WHERE key = 'advocate'),
    'c7400000-0000-4000-8000-000000000001'::uuid,
    (SELECT uuid_value FROM publication_operation_context WHERE key = 'run'),
    'dpl_durable_publication',
    extensions.digest(pg_catalog.convert_to('{}', 'UTF8'), 'sha256'),
    'Approve the reviewed durable publication operation',
    'c7600000-0000-5000-8000-000000000001'::uuid,
    'durable-publication-replay-after-deploy',
    NULL,
    '203.0.113.42',
    'Creator Share Publication Test/2.0'
  ),
  (SELECT bigint_value + 1 FROM publication_operation_context WHERE key = 'advocate'),
  'an immutable published approval replays before inconsistent current portal state is inspected'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM private.advocate_publication_transport_contexts transport
  ),
  'transaction-private publication transport context leaves no durable row'
);

SELECT extensions.ok(
  (
    SELECT array_agg(argument_name ORDER BY argument_position) = ARRAY[
      'operation_id',
      'run_id',
      'advocate_id',
      'expected_advocate_version',
      'deployment_id',
      'revision',
      'started_at',
      'outcome',
      'failure_code',
      'report_sha256',
      'completed_at',
      'published_advocate_version',
      'created'
    ]::text[]
    FROM pg_proc routine
    CROSS JOIN LATERAL unnest(routine.proargnames)
      WITH ORDINALITY AS argument(argument_name, argument_position)
    WHERE routine.oid =
      'public.begin_or_resume_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text,text,text)'::regprocedure
      AND argument_position > routine.pronargs
  ),
  'the operation status RPC exposes only the fixed sanitized result shape'
);

SELECT * FROM extensions.finish();

ROLLBACK;

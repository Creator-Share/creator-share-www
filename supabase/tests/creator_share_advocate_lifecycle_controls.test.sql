BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '45s';

SELECT extensions.no_plan();

CREATE TEMP TABLE lifecycle_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  bigint_value bigint,
  text_value text
) ON COMMIT DROP;

CREATE TEMP TABLE lifecycle_action_result (
  advocate_id uuid,
  advocate_version bigint,
  relationship_status public.advocate_relationship_status,
  publication_status public.advocate_publication_status,
  domain_cleanup_requested boolean
) ON COMMIT DROP;

CREATE TEMP TABLE lifecycle_provisioning_result (
  advocate_id uuid,
  advocate_version bigint,
  domain_id uuid,
  hostname text,
  job_ids uuid[]
) ON COMMIT DROP;

CREATE TEMP TABLE lifecycle_claim (
  job_id uuid,
  domain_id uuid,
  integration_id uuid,
  provider public.advocate_domain_integration_provider,
  lease_token uuid
) ON COMMIT DROP;

CREATE TEMP TABLE lifecycle_coordinator_result (
  advocate_id uuid,
  domain_id uuid,
  phase text,
  jobs_enqueued integer,
  cleanup_complete boolean
) ON COMMIT DROP;

CREATE TEMP TABLE lifecycle_cleanup_recovery_result (
  advocate_id uuid,
  advocate_version bigint,
  cleanup_phase text,
  cleanup_retry_requested boolean
) ON COMMIT DROP;

CREATE TEMP TABLE lifecycle_archive_fixture (
  fixture_name text PRIMARY KEY,
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL
) ON COMMIT DROP;

GRANT ALL ON lifecycle_action_result TO authenticated;
GRANT ALL ON lifecycle_provisioning_result TO authenticated;
GRANT ALL ON lifecycle_coordinator_result TO service_role;
GRANT ALL ON lifecycle_cleanup_recovery_result TO authenticated;
GRANT SELECT ON lifecycle_test_context TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.set_lifecycle_test_role(
  target_role text,
  target_session_id uuid DEFAULT
    'd4000000-0000-4000-8000-000000000900'::uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sub text := nullif(
    current_setting('request.jwt.claim.sub', true),
    ''
  );
BEGIN
  PERFORM set_config('request.jwt.claim.role', target_role, true);

  IF target_role = 'authenticated' THEN
    IF v_sub IS NULL THEN
      RAISE EXCEPTION 'Authenticated lifecycle test role requires a subject';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'role', target_role,
        'sub', v_sub,
        'session_id', target_session_id::text
      )::text,
      true
    );
  ELSE
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('role', target_role)::text,
      true
    );
  END IF;
END;
$$;

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.apply_creator_share_advocate_lifecycle_action(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.retry_creator_share_advocate_cleanup(uuid,bigint,text,uuid,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.coordinate_archived_advocate_domain_deprovisioning(integer,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.list_creator_share_advocate_controls(integer,timestamptz,uuid,public.advocate_relationship_status,public.advocate_publication_status)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_creator_share_advocate_control_snapshot(uuid)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.list_creator_share_advocate_ownership_candidates(uuid,integer,uuid)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.transfer_creator_share_advocate_ownership(uuid,uuid,uuid,text,uuid,text,text,text)'::regprocedure
  ),
  'all Creator Share lifecycle control RPCs are security definers with empty search paths'
);

SELECT extensions.ok(
  (
    SELECT array_agg(argument_name ORDER BY argument_position) = ARRAY[
      'target_advocate_id',
      'expected_advocate_version',
      'target_action',
      'change_reason',
      'request_id',
      'trace_id',
      'client_ip',
      'user_agent'
    ]::text[]
    FROM pg_proc routine
    CROSS JOIN LATERAL unnest(routine.proargnames)
      WITH ORDINALITY AS argument(argument_name, argument_position)
    WHERE routine.oid =
      'public.apply_creator_share_advocate_lifecycle_action(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)'::regprocedure
      AND argument_position <= routine.pronargs
  )
  AND (
    SELECT array_agg(argument_name ORDER BY argument_position) = ARRAY[
      'target_advocate_id',
      'expected_advocate_version',
      'change_reason',
      'request_id',
      'trace_id',
      'client_ip',
      'user_agent'
    ]::text[]
    FROM pg_proc routine
    CROSS JOIN LATERAL unnest(routine.proargnames)
      WITH ORDINALITY AS argument(argument_name, argument_position)
    WHERE routine.oid =
      'public.retry_creator_share_advocate_cleanup(uuid,bigint,text,uuid,text,text,text)'::regprocedure
      AND argument_position <= routine.pronargs
  )
  AND (
    SELECT array_agg(argument_name ORDER BY argument_position) = ARRAY[
      'target_advocate_id',
      'expected_owner_membership_id',
      'target_owner_membership_id',
      'change_reason',
      'request_id',
      'trace_id',
      'client_ip',
      'user_agent'
    ]::text[]
    FROM pg_proc routine
    CROSS JOIN LATERAL unnest(routine.proargnames)
      WITH ORDINALITY AS argument(argument_name, argument_position)
    WHERE routine.oid =
      'public.transfer_creator_share_advocate_ownership(uuid,uuid,uuid,text,uuid,text,text,text)'::regprocedure
      AND argument_position <= routine.pronargs
  ),
  'high-risk RPC arguments expose signed-session-safe named transport parameters only'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.apply_creator_share_advocate_lifecycle_action(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.apply_creator_share_advocate_lifecycle_action(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.apply_creator_share_advocate_lifecycle_action(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.coordinate_archived_advocate_domain_deprovisioning(integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.coordinate_archived_advocate_domain_deprovisioning(integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.coordinate_archived_advocate_domain_deprovisioning(integer,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.retry_creator_share_advocate_cleanup(uuid,bigint,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.retry_creator_share_advocate_cleanup(uuid,bigint,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.retry_creator_share_advocate_cleanup(uuid,bigint,text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'lifecycle and cleanup recovery are administrator entrypoints while cleanup coordination is service only'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.list_creator_share_advocate_controls(integer,timestamptz,uuid,public.advocate_relationship_status,public.advocate_publication_status)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.get_creator_share_advocate_control_snapshot(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_creator_share_advocate_control_snapshot(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.get_creator_share_advocate_control_snapshot(uuid)',
    'EXECUTE'
  ),
  'control projections are authenticated entrypoints but deny anonymous and service principals'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.list_creator_share_advocate_ownership_candidates(uuid,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.transfer_creator_share_advocate_ownership(uuid,uuid,uuid,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.list_creator_share_advocate_ownership_candidates(uuid,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.transfer_creator_share_advocate_ownership(uuid,uuid,uuid,text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'ownership controls are browser entrypoints with no anonymous or service execution grant'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'audit.creator_share_advocate_lifecycle_actions',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.creator_share_advocate_lifecycle_actions',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.creator_share_advocate_lifecycle_actions',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.creator_share_advocate_lifecycle_actions',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.creator_share_advocate_ownership_transfers',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.creator_share_advocate_ownership_transfers',
    'INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.creator_share_advocate_cleanup_recoveries',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.creator_share_advocate_cleanup_recoveries',
    'INSERT,UPDATE,DELETE'
  ),
  'append-only lifecycle, ownership, and cleanup recovery receipts have no browser or service table access'
);

SELECT extensions.ok(
  (
    SELECT bool_and(table_definition.relrowsecurity)
      AND bool_and(table_definition.relforcerowsecurity)
      AND count(*) = 3
    FROM pg_class table_definition
    JOIN pg_namespace schema_definition
      ON schema_definition.oid = table_definition.relnamespace
    WHERE schema_definition.nspname = 'audit'
      AND table_definition.relname IN (
        'creator_share_advocate_lifecycle_actions',
        'creator_share_advocate_ownership_transfers',
        'creator_share_advocate_cleanup_recoveries'
      )
  ),
  'all three private receipt tables enforce row level security even for their owner'
);

SELECT extensions.ok(
  NOT has_column_privilege(
    'anon',
    'public.advocates',
    'relationship_status',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'authenticated',
    'public.advocates',
    'relationship_status',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'service_role',
    'public.advocates',
    'relationship_status',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'authenticated',
    'public.advocates',
    'publication_status',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'service_role',
    'public.advocates',
    'publication_status',
    'UPDATE'
  ),
  'no runtime principal can mutate relationship or publication lifecycle columns directly'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'private.require_healthy_creator_share_super_admin(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.enqueue_archived_advocate_deprovision_job(uuid,uuid,uuid,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.require_signed_auth_session_id()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.require_signed_auth_session_id()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.creator_share_advocate_lifecycle_request_binding(uuid,uuid,public.creator_share_advocate_lifecycle_action,bigint,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.creator_share_advocate_ownership_request_binding(uuid,uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.creator_share_advocate_cleanup_recovery_request_binding(uuid,uuid,bigint,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_lifecycle_mutation_guards',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_lifecycle_mutation_guards',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_ownership_transport_contexts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_ownership_transport_contexts',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'private authorization, mutation and transport guards, receipt binding, and enqueue helpers are inaccessible'
);

SELECT extensions.ok(
  (
    SELECT array_agg(column_name::text ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'audit'
      AND table_name = 'creator_share_advocate_lifecycle_actions'
  ) = ARRAY[
    'id',
    'request_id',
    'request_binding_sha256',
    'actor_user_id',
    'advocate_id',
    'action',
    'expected_advocate_version',
    'resulting_advocate_version',
    'prior_relationship_status',
    'prior_publication_status',
    'resulting_relationship_status',
    'resulting_publication_status',
    'reason',
    'trace_id',
    'session_id',
    'domain_cleanup_requested',
    'created_at'
  ]::text[],
  'the lifecycle receipt has an exact semantic replay shape without raw transport evidence'
);

SELECT extensions.ok(
  (
    SELECT array_agg(column_name::text ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'audit'
      AND table_name = 'creator_share_advocate_ownership_transfers'
  ) = ARRAY[
    'id',
    'request_id',
    'request_binding_sha256',
    'actor_user_id',
    'advocate_id',
    'expected_owner_membership_id',
    'target_owner_membership_id',
    'resulting_owner_membership_id',
    'prior_advocate_version',
    'resulting_advocate_version',
    'reason',
    'trace_id',
    'session_id',
    'created_at'
  ]::text[],
  'the ownership transfer receipt has exact opaque identifiers without raw transport evidence'
);

SELECT extensions.ok(
  (
    SELECT array_agg(column_name::text ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'audit'
      AND table_name = 'creator_share_advocate_cleanup_recoveries'
  ) = ARRAY[
    'id',
    'request_id',
    'request_binding_sha256',
    'actor_user_id',
    'advocate_id',
    'expected_advocate_version',
    'terminal_job_id',
    'replacement_job_id',
    'resulting_advocate_version',
    'resulting_cleanup_phase',
    'cleanup_retry_requested',
    'reason',
    'trace_id',
    'session_id',
    'created_at'
  ]::text[],
  'cleanup recovery receipts retain exact replay evidence without raw transport evidence'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'public.domain_provisioning_jobs',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.domain_provisioning_jobs',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.domain_provisioning_jobs',
    'INSERT'
  )
  AND NOT has_column_privilege(
    'anon',
    'public.domain_provisioning_jobs',
    'advocate_id',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'authenticated',
    'public.domain_provisioning_jobs',
    'domain_id',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'service_role',
    'public.domain_provisioning_jobs',
    'integration_id',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'service_role',
    'public.domain_provisioning_jobs',
    'provider',
    'UPDATE'
  ),
  'runtime principals cannot insert domain jobs or rewrite their tenant and provider provenance'
);

SELECT extensions.ok(
  pg_get_function_result(
    'public.list_creator_share_advocate_controls(integer,timestamptz,uuid,public.advocate_relationship_status,public.advocate_publication_status)'::regprocedure
  ) !~ '(provider_(id|identifier)|payload|error|email|user_id|secret)'
  AND pg_get_function_result(
    'public.get_creator_share_advocate_control_snapshot(uuid)'::regprocedure
  ) !~ '(provider_(id|identifier)|payload|error|email|user_id|secret)'
  AND pg_get_function_result(
    'public.list_creator_share_advocate_ownership_candidates(uuid,integer,uuid)'::regprocedure
  ) !~ '(provider_(id|identifier)|payload|error|email|user_id|secret)'
  AND pg_get_function_result(
    'public.retry_creator_share_advocate_cleanup(uuid,bigint,text,uuid,text,text,text)'::regprocedure
  ) !~ '(provider|payload|error|email|user_id|secret|job)',
  'Creator Share browser projections have strict result signatures without contact or provider detail'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
VALUES
  (
    'd4000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'lifecycle-admin@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Lifecycle","last_name":"Admin"}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'd4000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'lifecycle-unverified-admin@example.test',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'd4000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'lifecycle-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Portal","last_name":"Owner"}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'd4000000-0000-4000-8000-000000000004'::uuid,
    'authenticated',
    'authenticated',
    'lifecycle-successor@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Future","last_name":"Owner"}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'd4000000-0000-4000-8000-000000000005'::uuid,
    'authenticated',
    'authenticated',
    'lifecycle-outsider@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'd4000000-0000-4000-8000-000000000006'::uuid,
    'authenticated',
    'authenticated',
    'lifecycle-empty-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Empty","last_name":"Portal"}'::jsonb,
    false,
    now(),
    now()
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
    ('d4000000-0000-4000-8000-000000000001'::uuid),
    ('d4000000-0000-4000-8000-000000000002'::uuid)
) AS actor(user_id)
CROSS JOIN public.roles role
WHERE role.name = 'SUPER_ADMIN';

CREATE OR REPLACE FUNCTION pg_temp.settle_lifecycle_test_jobs(
  target_worker_id text,
  expected_count integer,
  deprovisioning boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claim record;
  v_hostname text;
  v_evidence jsonb;
  v_completed integer := 0;
BEGIN
  FOR v_claim IN
    SELECT *
    FROM public.claim_domain_provisioning_jobs(
      target_worker_id,
      expected_count,
      interval '10 minutes'
    )
  LOOP
    SELECT domain.hostname
    INTO v_hostname
    FROM public.advocate_domains domain
    WHERE domain.id = v_claim.domain_id;

    IF deprovisioning THEN
      v_evidence := jsonb_build_object(
        'provider_status', 'absent',
        'http_status', 200,
        'verified', true
      );
      IF v_claim.provider IN ('stripe_us', 'stripe_uk', 'paypal') THEN
        v_evidence := v_evidence || jsonb_build_object(
          'provider_resource_id',
          v_claim.provider::text || ':hosted_checkout'
        );
      END IF;
    ELSE
      v_evidence := CASE v_claim.provider
        WHEN 'cloudflare' THEN jsonb_build_object(
          'provider_status', 'dns_only_cname_ready',
          'provider_resource_id', repeat('d', 32),
          'dns_record_id', repeat('d', 32),
          'http_status', 200,
          'verified', true
        )
        WHEN 'vercel' THEN jsonb_build_object(
          'provider_status', 'attached_verified',
          'provider_resource_id', v_hostname,
          'deployment_id', target_worker_id || '_deployment',
          'http_status', 200,
          'verified', true
        )
        ELSE jsonb_build_object(
          'provider_status', 'payment_path_ready',
          'provider_resource_id',
            v_claim.provider::text || ':hosted_checkout',
          'http_status', 200,
          'verified', true
        )
      END;
    END IF;

    PERFORM public.record_domain_provisioning_reconciliation(
      v_claim.job_id,
      v_claim.lease_token,
      CASE WHEN deprovisioning THEN 'not_found' ELSE 'matches_intent' END,
      v_evidence
    );
    PERFORM public.complete_domain_provisioning_job(
      v_claim.job_id,
      v_claim.lease_token,
      'succeeded',
      NULL,
      v_evidence
    );
    v_completed := v_completed + 1;
  END LOOP;

  IF v_completed <> expected_count THEN
    RAISE EXCEPTION 'Expected % lifecycle provider jobs but settled %',
      expected_count,
      v_completed;
  END IF;

  RETURN v_completed;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.create_archived_lifecycle_fixture(
  fixture_number integer,
  fixture_slug text
)
RETURNS TABLE (
  advocate_id uuid,
  domain_id uuid
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_advocate_id uuid;
  v_domain_id uuid;
  v_version bigint;
BEGIN
  v_advocate_id := public.create_advocate_portal(
    'd4000000-0000-4000-8000-000000000006'::uuid,
    fixture_slug,
    'Lifecycle Queue Fixture ' || fixture_number::text,
    'Create an archived scheduler fairness fixture',
    'creator',
    'lifecycle-queue-create-' || fixture_number::text,
    'lifecycle-queue-create-trace-' || fixture_number::text,
    'lifecycle-queue-create-session-' || fixture_number::text
  );

  SELECT advocate.version
  INTO v_version
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id;

  SELECT result.domain_id
  INTO v_domain_id
  FROM public.start_advocate_portal_provisioning(
    v_advocate_id,
    v_version,
    gen_random_uuid(),
    'lifecycle-queue-provision-' || fixture_number::text
  ) result;

  SELECT advocate.version
  INTO v_version
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id;

  PERFORM result.advocate_id
  FROM public.apply_creator_share_advocate_lifecycle_action(
    v_advocate_id,
    v_version,
    'archive',
    'Archive a scheduler fairness fixture',
    gen_random_uuid(),
    'lifecycle-queue-archive-trace-' || fixture_number::text
  ) result;

  RETURN QUERY SELECT v_advocate_id, v_domain_id;
END;
$$;

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000005',
  true
);
SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.list_creator_share_advocate_controls()
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'an ordinary authenticated account cannot list Creator Share tenant controls'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.get_creator_share_advocate_control_snapshot(
      gen_random_uuid()
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'an ordinary authenticated account cannot read a Creator Share control snapshot'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      'An ordinary account must not control a tenant lifecycle',
      gen_random_uuid(),
      'lifecycle-outsider-trace'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'an ordinary authenticated account cannot apply a tenant lifecycle action'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.coordinate_archived_advocate_domain_deprovisioning(
      25,
      'lifecycle-authenticated-coordinator'
    )
  $$,
  '42501',
  'Advocate lifecycle coordinator service role is required',
  'an authenticated browser principal cannot invoke the cleanup coordinator'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000002',
  true
);
SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.list_creator_share_advocate_controls()
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'an unverified global administrator cannot enter the control plane'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', 'd4000000-0000-4000-8000-000000000001',
    'session_id', 'not-a-signed-session-uuid'
  )::text,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      'Reject a malformed signed authentication session',
      gen_random_uuid(),
      'lifecycle-malformed-session-trace'
    )
  $$,
  '28000',
  'A signed authentication session is required',
  'a high-risk lifecycle action derives and validates session identity from the JWT'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', 'd4000000-0000-4000-8000-000000000001'
  )::text,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      'Reject a missing signed authentication session',
      gen_random_uuid(),
      'lifecycle-missing-session-trace'
    )
  $$,
  '28000',
  'A signed authentication session is required',
  'a high-risk lifecycle action rejects a JWT without a session identity'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      E'\nReject a reason with leading whitespace',
      gen_random_uuid(),
      'lifecycle-leading-whitespace-reason-trace'
    )
  $$,
  '22023',
  'Creator Share advocate lifecycle action input is invalid',
  'a lifecycle action rejects leading LF while allowing internal LF'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      E'Reject a reason containing\ta tab',
      gen_random_uuid(),
      'lifecycle-control-reason-trace'
    )
  $$,
  '22023',
  'Creator Share advocate lifecycle action input is invalid',
  'a lifecycle action rejects non-LF controls in an immutable reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      '',
      gen_random_uuid(),
      'lifecycle-empty-reason-trace'
    )
  $$,
  '22023',
  'Creator Share advocate lifecycle action input is invalid',
  'a lifecycle action requires a nonempty reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      repeat('r', 2001),
      gen_random_uuid(),
      'lifecycle-long-reason-trace'
    )
  $$,
  '22023',
  'Creator Share advocate lifecycle action input is invalid',
  'a lifecycle action rejects a reason longer than 2000 characters'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      'Reject empty lifecycle transport evidence',
      gen_random_uuid(),
      'lifecycle-empty-transport-trace',
      '',
      'lifecycle-empty-transport-agent'
    )
  $$,
  '22023',
  'Creator Share advocate lifecycle action input is invalid',
  'a lifecycle action rejects an empty nonnull client IP'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      'Reject control characters in lifecycle transport evidence',
      gen_random_uuid(),
      'lifecycle-control-transport-trace',
      '203.0.113.8',
      E'lifecycle-control\ntransport-agent'
    )
  $$,
  '22023',
  'Creator Share advocate lifecycle action input is invalid',
  'a lifecycle action rejects control characters in the user agent'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      gen_random_uuid(),
      1,
      'suspend',
      'Reject oversized lifecycle transport evidence',
      gen_random_uuid(),
      'lifecycle-oversized-transport-trace',
      '203.0.113.8',
      repeat('é', 513)
    )
  $$,
  '22023',
  'Creator Share advocate lifecycle action input is invalid',
  'a lifecycle action enforces the 1024 UTF-8 byte user agent bound'
);

WITH created AS (
  SELECT public.create_advocate_portal(
    'd4000000-0000-4000-8000-000000000003'::uuid,
    'lifecycle-portal',
    'Lifecycle Portal',
    'Create the lifecycle control fixture',
    'creator',
    'lifecycle-create-request',
    'lifecycle-create-trace',
    'lifecycle-create-session'
  ) AS advocate_id
)
INSERT INTO lifecycle_test_context (key, uuid_value)
SELECT 'advocate', advocate_id FROM created;

INSERT INTO lifecycle_test_context (key, uuid_value)
SELECT 'owner_membership', advocate.owner_membership_id
FROM public.advocates advocate
WHERE advocate.id = (
  SELECT uuid_value
  FROM lifecycle_test_context
  WHERE key = 'advocate'
);

WITH inserted AS (
  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  SELECT
    uuid_value,
    'd4000000-0000-4000-8000-000000000004'::uuid,
    'active'
  FROM lifecycle_test_context
  WHERE key = 'advocate'
  RETURNING id, advocate_id
), assigned AS (
  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  SELECT
    inserted.advocate_id,
    inserted.id,
    role.id,
    'd4000000-0000-4000-8000-000000000001'::uuid
  FROM inserted
  JOIN public.advocate_roles role ON role.key = 'analytics_viewer'
  RETURNING membership_id
)
INSERT INTO lifecycle_test_context (key, uuid_value)
SELECT 'successor_membership', membership_id
FROM assigned;

UPDATE public.users profile
SET
  first_name = 'lifecycle-outsider@example.test',
  last_name = '<script>'
WHERE profile.id = 'd4000000-0000-4000-8000-000000000005'::uuid;

INSERT INTO public.advocate_memberships (
  advocate_id,
  user_id,
  status
)
SELECT
  uuid_value,
  'd4000000-0000-4000-8000-000000000005'::uuid,
  'suspended'
FROM lifecycle_test_context
WHERE key = 'advocate';

INSERT INTO lifecycle_provisioning_result
SELECT *
FROM public.start_advocate_portal_provisioning(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (
    SELECT advocate.version
    FROM public.advocates advocate
    WHERE advocate.id = (
      SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
    )
  ),
  'd4000000-0000-4000-8000-000000000101'::uuid,
  'lifecycle-provisioning-trace'
);

/* The start RPC has a different result shape, so retain its domain separately. */
INSERT INTO lifecycle_test_context (key, uuid_value)
SELECT 'domain', result.domain_id
FROM lifecycle_provisioning_result result;

SELECT pg_temp.set_lifecycle_test_role('service_role');

SELECT extensions.is(
  pg_temp.settle_lifecycle_test_jobs(
    'lifecycle-initial-provider-worker',
    5,
    false
  ),
  5,
  'all five initial provider jobs settle with verified evidence'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT public.publish_advocate_portal(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (
    SELECT advocate.version
    FROM public.advocates advocate
    WHERE advocate.id = (
      SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
    )
  ),
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'domain'),
  'lifecycle-portal.creatorshare.com',
  extensions.digest('lifecycle-publication-canary', 'sha256'),
  clock_timestamp(),
  'Publish the lifecycle fixture after verified provider settlement',
  'lifecycle-test-deployment',
  'lifecycle-publication-request',
  'lifecycle-publication-trace'
);

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT 'active_version', advocate.version
FROM public.advocates advocate
WHERE advocate.id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocates advocate
    SET publication_status = 'provisioning'
    WHERE advocate.id = (
      SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
    )
  $$,
  '23514',
  'Illegal advocate publication transition from active to provisioning',
  'a direct active to provisioning update cannot forge the guarded repair transition'
);

SELECT extensions.ok(
  public.read_public_advocate_presentation_snapshot(
    'lifecycle-portal.creatorshare.com'
  ) IS NOT NULL,
  'the fully published lifecycle fixture resolves publicly before suspension'
);

TRUNCATE lifecycle_action_result;
INSERT INTO lifecycle_action_result
SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'active_version'),
  'repair',
      'Replace published provider evidence with a fresh repair request',
      'd4000000-0000-4000-8000-000000000106'::uuid,
      'lifecycle-repair-trace'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.relationship_status = 'active'
      AND result.publication_status = 'provisioning'
      AND NOT result.domain_cleanup_requested
    FROM lifecycle_action_result result
    JOIN lifecycle_test_context context ON context.key = 'active_version'
  )
  AND (
    SELECT count(*)
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.status = 'queued'
  ) = 5
  AND public.read_public_advocate_presentation_snapshot(
    'lifecycle-portal.creatorshare.com'
  ) IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM private.advocate_lifecycle_mutation_guards mutation_guard
  ),
  'authorized repair moves an active publication to provisioning in one root version and fresh work'
);

UPDATE lifecycle_test_context context
SET bigint_value = result.advocate_version
FROM lifecycle_action_result result
WHERE context.key = 'active_version';

SELECT pg_temp.set_lifecycle_test_role('service_role');

SELECT *
FROM public.issue_advocate_invitation_email(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  'd4000000-0000-4000-8000-000000000003'::uuid,
  'pending-lifecycle-invite@example.test',
  ARRAY['analytics_viewer']::text[],
  'lifecycle-invitation-request-0001',
  extensions.digest('lifecycle-invitation-capability', 'sha256'),
  convert_to(repeat('r', 64), 'UTF8'),
  extensions.digest('pending-lifecycle-invite@example.test', 'sha256'),
  convert_to(repeat('s', 64), 'UTF8'),
  1::smallint,
  1::smallint,
  1::smallint,
  'Create a pending invitation to verify archive revocation',
  'lifecycle-invitation-request',
  'lifecycle-invitation-trace',
  'lifecycle-invitation-session'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

INSERT INTO lifecycle_test_context (key, uuid_value)
SELECT
  'stale_job',
  public.enqueue_domain_provisioning_job(
    integration.domain_id,
    integration.id,
    'reconcile',
    'Create an in-flight job to prove lifecycle fencing',
    clock_timestamp(),
    'lifecycle-stale-worker-request'
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
    SELECT uuid_value FROM lifecycle_test_context WHERE key = 'domain'
  )
  AND integration.provider = 'cloudflare';

SELECT pg_temp.set_lifecycle_test_role('service_role');

INSERT INTO lifecycle_claim (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'lifecycle-stale-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  (SELECT count(*)::integer FROM lifecycle_claim),
  1,
  'one provider job is leased before the administrator suspension'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

TRUNCATE lifecycle_action_result;
INSERT INTO lifecycle_action_result
SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'active_version'),
  'suspend',
  'Suspend the portal while Creator Share investigates provider state',
  'd4000000-0000-4000-8000-000000000102'::uuid,
  'lifecycle-suspend-trace'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.relationship_status = 'suspended'
      AND result.publication_status = 'suspended'
      AND NOT result.domain_cleanup_requested
    FROM lifecycle_action_result result
    JOIN lifecycle_test_context context ON context.key = 'active_version'
  ),
  'suspend advances the root version exactly once and requests no deprovisioning'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocates advocate
    JOIN public.advocate_domains domain ON domain.advocate_id = advocate.id
    WHERE advocate.id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND advocate.relationship_status = 'suspended'
      AND advocate.publication_status = 'suspended'
      AND domain.status = 'failed'
      AND domain.failure_code = 'administrator_suspended'
  ),
  'suspend closes both tenant publication and the exact domain immediately without deprovisioning'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind <> 'deprovision'
      AND job.status IN ('queued', 'running')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND integration.reconciliation_suppressed_at IS NULL
  ),
  'suspend cancels every open non-deprovision job and durably suppresses every integration'
);

SELECT extensions.is(
  public.read_public_advocate_presentation_snapshot(
    'lifecycle-portal.creatorshare.com'
  ),
  NULL::jsonb,
  'the suspended hostname no longer has a public presentation snapshot'
);

SELECT pg_temp.set_lifecycle_test_role('service_role');

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.record_qualified_advocate_exposure(
      'd4000000-0000-4000-8000-000000000103'::uuid,
      extensions.digest('lifecycle-suspended-visitor', 'sha256'),
      'lifecycle-portal.creatorshare.com',
      'not_required',
      '/',
      NULL,
      NULL,
      'lifecycle-suspended-exposure',
      'lifecycle-suspended-trace'
    )
  $$,
  '23514',
  'Qualified advocate exposure requires an exact active advocate domain',
  'the payment attribution boundary rejects the suspended advocate hostname immediately'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.complete_domain_provisioning_job(
        %L::uuid,
        %L::uuid,
        'succeeded',
        NULL,
        '{"provider_status":"dns_only_cname_ready","provider_resource_id":"dddddddddddddddddddddddddddddddd","dns_record_id":"dddddddddddddddddddddddddddddddd","http_status":200,"verified":true}'::jsonb
      )
    $sql$,
    (SELECT job_id FROM lifecycle_claim),
    (SELECT lease_token FROM lifecycle_claim)
  ),
  '42501',
  'Domain provisioning lease is unavailable',
  'a worker token captured before suspension cannot restore provider state'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

TRUNCATE lifecycle_action_result;
INSERT INTO lifecycle_action_result
SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'active_version'),
  'suspend',
  'Suspend the portal while Creator Share investigates provider state',
  'd4000000-0000-4000-8000-000000000102'::uuid,
  'lifecycle-suspend-retry-trace'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
      AND max(result.advocate_version) =
        (SELECT bigint_value + 1 FROM lifecycle_test_context WHERE key = 'active_version')
    FROM lifecycle_action_result result
  )
  AND (
    SELECT count(*) = 1
    FROM audit.creator_share_advocate_lifecycle_actions receipt
    WHERE receipt.request_id =
      'd4000000-0000-4000-8000-000000000102'::uuid
  ),
  'a semantic suspension replay survives new transport forensics without another root advance'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.creator_share_advocate_lifecycle_actions receipt
    WHERE receipt.request_id =
        'd4000000-0000-4000-8000-000000000102'::uuid
      AND octet_length(receipt.request_binding_sha256) = 32
      AND receipt.actor_user_id =
        'd4000000-0000-4000-8000-000000000001'::uuid
      AND receipt.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND receipt.action = 'suspend'
      AND receipt.expected_advocate_version = (
        SELECT bigint_value FROM lifecycle_test_context WHERE key = 'active_version'
      )
      AND receipt.resulting_advocate_version =
        receipt.expected_advocate_version + 1
      AND receipt.prior_relationship_status = 'active'
      AND receipt.prior_publication_status = 'provisioning'
      AND receipt.resulting_relationship_status = 'suspended'
      AND receipt.resulting_publication_status = 'suspended'
      AND receipt.reason =
        'Suspend the portal while Creator Share investigates provider state'
      AND receipt.trace_id = 'lifecycle-suspend-trace'
      AND receipt.session_id =
        'd4000000-0000-4000-8000-000000000900'::uuid::text
      AND NOT receipt.domain_cleanup_requested
  ),
  'the immutable suspension receipt binds the exact actor, request, version, statuses, and reason'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.creator_share_advocate_lifecycle_actions
    SET reason = reason
    WHERE request_id = 'd4000000-0000-4000-8000-000000000102'::uuid
  $$,
  '42501',
  'Creator Share advocate lifecycle receipts are append-only',
  'lifecycle receipts cannot be updated even by the database owner'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.creator_share_advocate_lifecycle_actions
    WHERE request_id = 'd4000000-0000-4000-8000-000000000102'::uuid
  $$,
  '42501',
  'Creator Share advocate lifecycle receipts are append-only',
  'lifecycle receipts cannot be deleted even by the database owner'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE audit.creator_share_advocate_lifecycle_actions
  $$,
  '42501',
  'Creator Share advocate lifecycle receipts are append-only',
  'lifecycle receipts cannot be truncated even by the database owner'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'active_version'),
      'suspend',
      'A different reason must not bind to the committed request',
      'd4000000-0000-4000-8000-000000000102'::uuid,
      'lifecycle-suspend-trace'
    )
  $$,
  '40001',
  'Advocate lifecycle replay does not match the committed request',
  'request UUID replay is bound to the exact actor, target, version, action, and reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'active_version'),
      'resume',
      'Attempt a resume against a stale version',
      'd4000000-0000-4000-8000-000000000104'::uuid,
      'lifecycle-stale-resume-trace'
    )
  $$,
  '40001',
  'Advocate portal version changed before the lifecycle action',
  'a stale advocate version cannot perform a different lifecycle action'
);

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT 'suspended_version', result.advocate_version
FROM lifecycle_action_result result;

TRUNCATE lifecycle_action_result;
INSERT INTO lifecycle_action_result
SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'suspended_version'),
  'resume',
  'Resume the portal with fresh provider work after investigation',
  'd4000000-0000-4000-8000-000000000105'::uuid,
  'lifecycle-resume-trace'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.relationship_status = 'active'
      AND result.publication_status = 'provisioning'
      AND NOT result.domain_cleanup_requested
    FROM lifecycle_action_result result
    JOIN lifecycle_test_context context ON context.key = 'suspended_version'
  ),
  'resume advances the root once to active plus unpublished provisioning state'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'domain'
      )
      AND domain.status = 'provisioning'
  )
  AND (
    SELECT count(*)
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.status = 'queued'
  ) = 5
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND integration.reconciliation_suppressed_at IS NOT NULL
  ),
  'resume clears suppression and creates exactly five fresh provider jobs without publishing'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.event_key = 'domain.provisioning.requested'
  ),
  'repair materializes the fixed privacy-safe domain provisioning audit event'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
      AND bool_and(control.slug = 'lifecycle-portal')
      AND bool_and(control.owner_display_name = 'Portal O.')
      AND bool_and(control.open_provider_jobs = 5)
    FROM public.list_creator_share_advocate_controls(
      10,
      NULL,
      NULL,
      'active',
      'provisioning'
    ) control
    WHERE control.advocate_id = (
      SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
    )
  ),
  'the bounded control list exposes lifecycle state, a privacy-limited owner label, and aggregate counts'
);

SELECT extensions.ok(
  (
    SELECT snapshot.can_suspend
      AND NOT snapshot.can_resume
      AND snapshot.can_archive
      AND snapshot.can_repair
      AND snapshot.cleanup_phase = 'not_requested'
      AND snapshot.required_integrations = 5
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate')
    ) snapshot
  ),
  'the strict control snapshot derives action eligibility without exposing provider payloads'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.list_creator_share_advocate_controls(
      101,
      NULL,
      NULL,
      NULL,
      NULL
    )
  $$,
  '22023',
  'Creator Share advocate control list input is invalid',
  'the Creator Share control list has a hard page bound'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 3
      AND bool_or(candidate.is_current_owner)
      AND count(*) FILTER (
        WHERE candidate.is_current_owner AND NOT candidate.is_eligible
      ) = 1
      AND count(*) FILTER (
        WHERE NOT candidate.is_current_owner AND candidate.is_eligible
      ) = 1
      AND count(*) FILTER (
        WHERE NOT candidate.is_current_owner AND NOT candidate.is_eligible
      ) = 1
      AND bool_and(
        candidate.display_name = ANY (
          ARRAY['Portal O.', 'Future O.', 'Portal team member']
        )
      )
    FROM public.list_creator_share_advocate_ownership_candidates(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      100,
      NULL
    ) candidate
  ),
  'ownership candidates expose safe labels and mark only a healthy nonowner target eligible'
);

SELECT extensions.ok(
  pg_get_function_result(
    'public.list_creator_share_advocate_ownership_candidates(uuid,integer,uuid)'::regprocedure
  ) !~ '(user_id|email)',
  'the ownership candidate browser result has no auth user ID or email field'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000003',
  true
);
SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      'd4000000-0000-4000-8000-000000000003'::uuid,
      'd4000000-0000-4000-8000-000000000004'::uuid,
      'A portal owner must not transfer ownership directly',
      'owner-direct-transfer-request',
      'owner-direct-transfer-trace',
      'owner-direct-transfer-session'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'the current portal owner cannot call the retained ownership transfer contract'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      'd4000000-0000-4000-8000-000000000003'::uuid,
      'd4000000-0000-4000-8000-000000000004'::uuid,
      E'Reject a direct ownership reason containing\rreturn',
      'owner-direct-invalid-reason-request',
      'owner-direct-invalid-reason-trace',
      'owner-direct-invalid-reason-session'
    )
  $$,
  '22023',
  'Advocate ownership transfer input is invalid',
  'the underlying ownership boundary rejects non-LF reason controls'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_creator_share_advocate_ownership(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'successor_membership'),
      'Reject oversized ownership transport evidence',
      'd4000000-0000-4000-8000-000000000117'::uuid,
      'lifecycle-ownership-invalid-transport-trace',
      repeat('é', 129),
      'lifecycle-ownership-invalid-transport-agent'
    )
  $$,
  '22023',
  'Creator Share ownership transfer input is invalid',
  'ownership transfer enforces the 256 UTF-8 byte client IP bound'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_creator_share_advocate_ownership(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'successor_membership'),
      'Reject empty ownership transport evidence',
      'd4000000-0000-4000-8000-000000000119'::uuid,
      'lifecycle-ownership-empty-transport-trace',
      '203.0.113.119',
      ''
    )
  $$,
  '22023',
  'Creator Share ownership transfer input is invalid',
  'ownership transfer rejects an empty nonnull user agent'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_creator_share_advocate_ownership(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'successor_membership'),
      'Reject control characters in ownership transport evidence',
      'd4000000-0000-4000-8000-000000000120'::uuid,
      'lifecycle-ownership-control-transport-trace',
      E'203.0.113.120\n',
      'lifecycle-ownership-control-transport-agent'
    )
  $$,
  '22023',
  'Creator Share ownership transfer input is invalid',
  'ownership transfer rejects control characters in the client IP'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_creator_share_advocate_ownership(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
      'Exercise the private ownership transport bridge rollback',
      'd4000000-0000-4000-8000-000000000118'::uuid,
      'lifecycle-ownership-bridge-rollback-trace',
      '203.0.113.118',
      'lifecycle-ownership-bridge-rollback-agent'
    )
  $$,
  '23505',
  'The target account already owns this advocate portal',
  'an ownership failure after private bridge insertion rolls back the mutation'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM private.advocate_ownership_transport_contexts transport
  ),
  'the private ownership transport bridge is empty after a failed transfer'
);

SELECT pg_temp.set_lifecycle_test_role(
  'authenticated',
  'd4000000-0000-4000-8000-000000000907'::uuid
);

SELECT extensions.is(
  public.transfer_creator_share_advocate_ownership(
    (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
    (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
    (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'successor_membership'),
    E'Transfer ownership through the Creator Share\nmembership-scoped control',
    'd4000000-0000-4000-8000-000000000107'::uuid,
    'lifecycle-ownership-trace',
    '203.0.113.107',
    'lifecycle-ownership-admin-test-agent'
  ),
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  'the Creator Share wrapper transfers ownership using only opaque membership identifiers'
);

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT
  'ownership_forensic_count',
  count(*)
FROM audit.audit_events event
JOIN audit.audit_event_forensics forensic
  ON forensic.audit_event_id = event.id
WHERE event.request_id =
  'd4000000-0000-4000-8000-000000000107'::uuid::text;

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT
  'ownership_audit_count',
  count(*)
FROM audit.audit_events event
WHERE event.request_id =
  'd4000000-0000-4000-8000-000000000107'::uuid::text;

SELECT pg_temp.set_lifecycle_test_role(
  'authenticated',
  'd4000000-0000-4000-8000-000000000917'::uuid
);

SELECT extensions.is(
  public.transfer_creator_share_advocate_ownership(
    (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
    (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
    (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'successor_membership'),
    E'Transfer ownership through the Creator Share\nmembership-scoped control',
    'd4000000-0000-4000-8000-000000000107'::uuid,
    'lifecycle-ownership-retry-trace',
    '203.0.113.207',
    'lifecycle-ownership-replay-test-agent'
  ),
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  'an ownership replay survives changed transport forensics after the owner has changed'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_creator_share_advocate_ownership(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'),
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'successor_membership'),
      'A different ownership reason must not reuse the committed request',
      'd4000000-0000-4000-8000-000000000107'::uuid,
      'lifecycle-ownership-mismatch-trace'
    )
  $$,
  '40001',
  'Creator Share ownership replay does not match the committed request',
  'ownership request reuse is bound to the exact semantic transfer'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.creator_share_advocate_ownership_transfers receipt
    WHERE receipt.request_id =
        'd4000000-0000-4000-8000-000000000107'::uuid
      AND octet_length(receipt.request_binding_sha256) = 32
      AND receipt.actor_user_id =
        'd4000000-0000-4000-8000-000000000001'::uuid
      AND receipt.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND receipt.expected_owner_membership_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'owner_membership'
      )
      AND receipt.target_owner_membership_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'successor_membership'
      )
      AND receipt.resulting_owner_membership_id =
        receipt.target_owner_membership_id
      AND receipt.resulting_advocate_version =
        receipt.prior_advocate_version + 1
      AND receipt.trace_id = 'lifecycle-ownership-trace'
      AND receipt.session_id =
        'd4000000-0000-4000-8000-000000000907'::uuid::text
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.request_id =
        'd4000000-0000-4000-8000-000000000107'::uuid::text
      AND event.table_name = 'advocates'
      AND event.operation = 'UPDATE'
      AND event.session_id =
        'd4000000-0000-4000-8000-000000000907'::uuid::text
      AND forensic.client_ip = '203.0.113.107'
      AND forensic.user_agent = 'lifecycle-ownership-admin-test-agent'
      AND forensic.expires_at = forensic.captured_at + interval '90 days'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.advocate_ownership_transport_contexts transport
  )
  AND (
    SELECT count(*) = 1
    FROM audit.creator_share_advocate_ownership_transfers receipt
    WHERE receipt.request_id =
      'd4000000-0000-4000-8000-000000000107'::uuid
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'ownership_forensic_count'
    )
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000107'::uuid::text
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'ownership_audit_count'
    )
    FROM audit.audit_events event
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000107'::uuid::text
  ),
  'ownership exact replay leaves first-attempt transport forensics unchanged with ninety-day expiry'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.creator_share_advocate_ownership_transfers
    SET reason = reason
    WHERE request_id = 'd4000000-0000-4000-8000-000000000107'::uuid
  $$,
  '42501',
  'Creator Share advocate ownership receipts are append-only',
  'ownership receipts cannot be updated even by the database owner'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        'd4000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'creator-share-admin-advocates'
      AND event.metadata ->> 'operation' = 'transfer_ownership'
      AND event.table_name = 'advocates'
      AND event.operation = 'UPDATE'
  ),
  'ownership transfer preserves the exact creator_share_admin audit contract'
);

SELECT pg_temp.set_lifecycle_test_role('service_role');

TRUNCATE lifecycle_claim;
INSERT INTO lifecycle_claim (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'lifecycle-archive-race-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT extensions.ok(
  (
    SELECT count(*) = 1 AND bool_and(claim.provider = 'cloudflare')
    FROM lifecycle_claim claim
  )
  AND EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_claim claim ON claim.job_id = job.id
    WHERE job.status = 'running'
      AND job.lease_token = claim.lease_token
  ),
  'archive begins while an exact provider job owns a live worker lease'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT 'pre_archive_version', advocate.version
FROM public.advocates advocate
WHERE advocate.id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
);

SELECT pg_temp.set_lifecycle_test_role(
  'authenticated',
  'd4000000-0000-4000-8000-000000000908'::uuid
);

TRUNCATE lifecycle_action_result;
INSERT INTO lifecycle_action_result
SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'pre_archive_version'),
  'archive',
  'Archive this advocate tenant and remove its exact domain safely',
  'd4000000-0000-4000-8000-000000000108'::uuid,
  'lifecycle-archive-trace',
  '203.0.113.108',
  'lifecycle-archive-admin-test-agent'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.relationship_status = 'archived'
      AND result.publication_status = 'suspended'
      AND result.domain_cleanup_requested
    FROM lifecycle_action_result result
    JOIN lifecycle_test_context context ON context.key = 'pre_archive_version'
  ),
  'archive advances the root exactly once, is unpublished, and requests cleanup'
);

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT
  'archive_forensic_count',
  count(*)
FROM audit.audit_events event
JOIN audit.audit_event_forensics forensic
  ON forensic.audit_event_id = event.id
WHERE event.request_id =
  'd4000000-0000-4000-8000-000000000108'::uuid::text;

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT
  'archive_audit_count',
  count(*)
FROM audit.audit_events event
WHERE event.request_id =
  'd4000000-0000-4000-8000-000000000108'::uuid::text;

SELECT extensions.ok(
  (
    SELECT count(*) > 0
      AND bool_and(
        forensic.client_ip = '203.0.113.108'
        AND forensic.user_agent = 'lifecycle-archive-admin-test-agent'
        AND forensic.expires_at = forensic.captured_at + interval '90 days'
      )
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000108'::uuid::text
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'archive_audit_count'
    )
    FROM audit.audit_events event
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000108'::uuid::text
  ),
  'archive transport evidence exists only in the exact ninety-day forensic layer'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocates advocate
    JOIN public.advocate_domains domain ON domain.advocate_id = advocate.id
    WHERE advocate.id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND advocate.slug = 'lifecycle-portal'
      AND advocate.display_name = 'Lifecycle Portal'
      AND advocate.relationship_status = 'archived'
      AND advocate.archived_at IS NOT NULL
      AND domain.hostname = 'lifecycle-portal.creatorshare.com'
      AND domain.status = 'redirecting'
      AND domain.redirect_to_domain_id IS NULL
  ),
  'archive retains tenant identity and hostname history while entering targetless quiescence'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.status IN ('queued', 'running')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
  )
  AND EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_claim claim ON claim.job_id = job.id
    WHERE job.status = 'cancelled'
      AND job.lease_owner IS NULL
      AND job.lease_token IS NULL
      AND job.lease_expires_at IS NULL
      AND job.last_error = 'advocate_archived'
  ),
  'archive revokes every provider lease and creates no cleanup work during quiescence'
);

SELECT pg_temp.set_lifecycle_test_role('service_role');

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.complete_domain_provisioning_job(
        %L::uuid,
        %L::uuid,
        'succeeded',
        NULL,
        '{"provider_status":"dns_only_cname_ready","provider_resource_id":"dddddddddddddddddddddddddddddddd","dns_record_id":"dddddddddddddddddddddddddddddddd","http_status":200,"verified":true}'::jsonb
      )
    $sql$,
    (SELECT job_id FROM lifecycle_claim),
    (SELECT lease_token FROM lifecycle_claim)
  ),
  '42501',
  'Domain provisioning lease is unavailable',
  'a provider response arriving after archive cannot settle with its withdrawn lease'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.ok(
  (
    SELECT snapshot.cleanup_phase = 'quiescing'
      AND NOT snapshot.can_archive
      AND snapshot.open_deprovision_jobs = 0
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate')
    ) snapshot
  ),
  'the control snapshot reports server-owned quiescence without implying cleanup work exists'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.enqueue_domain_provisioning_job(
        %L::uuid,
        %L::uuid,
        'deprovision',
        %L,
        clock_timestamp(),
        %L
      )
    $sql$,
    integration.domain_id,
    integration.id,
    'Attempt browser cleanup during archive quiescence for ' ||
      integration.provider::text,
    'lifecycle-quiescence-browser-' || integration.provider::text
  ),
  '55000',
  'Archived advocate cleanup must use the lifecycle coordinator',
  'browser enqueue cannot bypass quiescence for ' || integration.provider::text
)
FROM public.advocate_domain_integrations integration
WHERE integration.advocate_id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
)
ORDER BY integration.provider::text;

SELECT pg_temp.set_lifecycle_test_role('service_role');

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.enqueue_domain_provisioning_job_system(
        %L::uuid,
        %L::uuid,
        'deprovision',
        clock_timestamp(),
        %L
      )
    $sql$,
    integration.domain_id,
    integration.id,
    'lifecycle-quiescence-system-' || integration.provider::text
  ),
  '55000',
  'Archived advocate cleanup must use the lifecycle coordinator',
  'system enqueue cannot bypass quiescence for ' || integration.provider::text
)
FROM public.advocate_domain_integrations integration
WHERE integration.advocate_id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
)
ORDER BY integration.provider::text;

SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    JOIN public.advocate_invitation_email_outbox outbox
      ON outbox.invitation_id = invitation.id
     AND outbox.advocate_id = invitation.advocate_id
    WHERE invitation.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NOT NULL
      AND invitation.revoked_by_user_id =
        'd4000000-0000-4000-8000-000000000001'::uuid
      AND outbox.status = 'cancelled'
      AND outbox.contact_redacted_at IS NOT NULL
      AND outbox.recipient_email_ciphertext IS NULL
      AND outbox.secret_payload_ciphertext IS NULL
  ),
  'archive revokes pending invitations and cryptographically erases unsent delivery material'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.event_key = 'portal.lifecycle.updated'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.event_key = 'domain.deactivated'
  ),
  'archive writes the fixed privacy-safe portal lifecycle and domain deactivation events'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.request_id =
        'd4000000-0000-4000-8000-000000000108'::uuid::text
      AND event.trace_id = 'lifecycle-archive-trace'
      AND event.session_id =
        'd4000000-0000-4000-8000-000000000908'::uuid::text
      AND event.reason =
        'Archive this advocate tenant and remove its exact domain safely'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        'd4000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'creator-share-admin-advocate-lifecycle'
  ),
  'archive memorializes exact request, trace, session, reason, actor, and tool context'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 4
      AND bool_and(
        audit.json_object_has_exact_keys(
          event.metadata,
          ARRAY[
            'operation',
            'outcome',
            'prior_status',
            'resource_id',
            'resource_kind'
          ]::text[]
        )
      )
    FROM audit.audit_events event
    JOIN (
      VALUES
        ('suspend_advocate', 'active/provisioning', 'suspended/suspended'),
        ('resume_advocate', 'suspended/suspended', 'active/provisioning'),
        ('repair_advocate', 'active/active', 'active/provisioning'),
        ('archive_advocate', 'active/provisioning', 'archived/suspended')
    ) expected(operation, prior_status, outcome)
      ON event.metadata ->> 'operation' = expected.operation
     AND event.metadata ->> 'prior_status' = expected.prior_status
     AND event.metadata ->> 'outcome' = expected.outcome
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.table_name = 'advocates'
      AND event.operation = 'UPDATE'
      AND event.metadata ->> 'resource_kind' = 'advocate'
      AND event.metadata ->> 'resource_id' = event.advocate_id::text
  ),
  'all four lifecycle actions emit only the frozen exact advocate metadata contract'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.table_name = 'advocate_domains'
      AND event.operation = 'UPDATE'
      AND audit.json_object_has_exact_keys(
        event.metadata,
        ARRAY[
          'operation',
          'outcome',
          'prior_status',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      AND event.metadata ->> 'operation' = 'quiesce_domain'
      AND event.metadata ->> 'resource_kind' = 'advocate_domain'
      AND event.metadata ->> 'resource_id' =
        (SELECT uuid_value::text FROM lifecycle_test_context WHERE key = 'domain')
      AND event.metadata ->> 'prior_status' = 'provisioning'
      AND event.metadata ->> 'outcome' = 'redirecting'
  ),
  'domain quiescence emits only the frozen targetless deactivation metadata contract'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND event.table_name = 'advocates'
      AND event.operation = 'UPDATE'
      AND audit.json_object_has_exact_keys(
        event.metadata,
        ARRAY['operation', 'resource_id', 'resource_kind', 'role_key']::text[]
      )
      AND event.metadata ->> 'operation' = 'transfer_ownership'
      AND event.metadata ->> 'resource_kind' = 'advocate'
      AND event.metadata ->> 'resource_id' = event.advocate_id::text
      AND event.metadata ->> 'role_key' = 'owner'
  ),
  'ownership transfer retains only the frozen exact ownership metadata contract'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_creator_share_advocate_lifecycle_action(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      (SELECT advocate.version FROM public.advocates advocate WHERE advocate.id =
        (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate')),
      'resume',
      'Archived tenants cannot resume',
      'd4000000-0000-4000-8000-000000000109'::uuid,
      'lifecycle-archived-resume-trace'
    )
  $$,
  '55000',
  'Advocate portal is not eligible for resume while deprovisioning',
  'archive is irreversible and has no resume path'
);

SELECT pg_temp.set_lifecycle_test_role(
  'authenticated',
  'd4000000-0000-4000-8000-000000000918'::uuid
);

TRUNCATE lifecycle_action_result;
INSERT INTO lifecycle_action_result
SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'pre_archive_version'),
  'archive',
  'Archive this advocate tenant and remove its exact domain safely',
  'd4000000-0000-4000-8000-000000000108'::uuid,
  'lifecycle-archive-replay-trace',
  '203.0.113.208',
  'lifecycle-archive-replay-test-agent'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
    FROM lifecycle_action_result result
    JOIN lifecycle_test_context context ON context.key = 'pre_archive_version'
  )
  AND (
    SELECT count(*) = 1
    FROM audit.creator_share_advocate_lifecycle_actions receipt
    WHERE receipt.request_id =
      'd4000000-0000-4000-8000-000000000108'::uuid
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'archive_forensic_count'
    )
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000108'::uuid::text
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'archive_audit_count'
    )
    FROM audit.audit_events event
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000108'::uuid::text
  ),
  'an exact archive replay returns the immutable result without new forensic evidence'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.list_creator_share_advocate_ownership_candidates(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'),
      100,
      NULL
    ) candidate
    WHERE candidate.is_eligible
  ),
  'archived advocate portals expose no eligible ownership transfer candidates'
);

WITH created AS (
  SELECT public.create_advocate_portal(
    'd4000000-0000-4000-8000-000000000006'::uuid,
    'lifecycle-empty-portal',
    'Lifecycle Empty Portal',
    'Create a domainless archive fixture',
    'creator',
    'lifecycle-empty-create-request',
    'lifecycle-empty-create-trace',
    'lifecycle-empty-create-session'
  ) AS advocate_id
)
INSERT INTO lifecycle_test_context (key, uuid_value)
SELECT 'empty_advocate', advocate_id FROM created;

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT 'empty_advocate_version', advocate.version
FROM public.advocates advocate
WHERE advocate.id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'empty_advocate'
);

TRUNCATE lifecycle_action_result;
INSERT INTO lifecycle_action_result
SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'empty_advocate'),
  (SELECT bigint_value FROM lifecycle_test_context WHERE key = 'empty_advocate_version'),
  'archive',
  'Archive a tenant that never requested a provider domain',
  'd4000000-0000-4000-8000-000000000110'::uuid,
  'lifecycle-empty-archive-trace'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.relationship_status = 'archived'
      AND result.publication_status = 'suspended'
      AND NOT result.domain_cleanup_requested
    FROM lifecycle_action_result result
    JOIN lifecycle_test_context context
      ON context.key = 'empty_advocate_version'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = (
      SELECT uuid_value FROM lifecycle_test_context WHERE key = 'empty_advocate'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM audit.creator_share_advocate_lifecycle_actions receipt
    WHERE receipt.request_id =
        'd4000000-0000-4000-8000-000000000110'::uuid
      AND NOT receipt.domain_cleanup_requested
  ),
  'archiving a domainless tenant is truthful that no provider cleanup was requested'
);

SELECT pg_temp.set_lifecycle_test_role('service_role');

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT *
FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'quiescing'
      AND result.jobs_enqueued = 0
      AND NOT result.cleanup_complete
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
  ),
  'the coordinator returns quiescing with zero work before the archive cooldown expires'
);

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.advocates DISABLE TRIGGER advocates_touch_updated_at;
ALTER TABLE public.advocates DISABLE TRIGGER advocates_audit_row_change;

UPDATE public.advocates advocate
SET archived_at = clock_timestamp() - interval '19 minutes 59 seconds'
WHERE advocate.id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
);

ALTER TABLE public.advocates ENABLE TRIGGER advocates_audit_row_change;
ALTER TABLE public.advocates ENABLE TRIGGER advocates_touch_updated_at;

SET CONSTRAINTS ALL DEFERRED;

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT *
FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'quiescing'
      AND result.jobs_enqueued = 0
      AND NOT result.cleanup_complete
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
  ),
  'cleanup remains quiescent one second before the twenty-minute safety horizon'
);

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.advocates DISABLE TRIGGER advocates_touch_updated_at;
ALTER TABLE public.advocates DISABLE TRIGGER advocates_audit_row_change;

UPDATE public.advocates advocate
SET archived_at = clock_timestamp() - interval '20 minutes 1 second'
WHERE advocate.id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
);

ALTER TABLE public.advocates ENABLE TRIGGER advocates_audit_row_change;
ALTER TABLE public.advocates ENABLE TRIGGER advocates_touch_updated_at;

SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.enqueue_domain_provisioning_job(
        %L::uuid,
        %L::uuid,
        'deprovision',
        %L,
        clock_timestamp(),
        %L
      )
    $sql$,
    integration.domain_id,
    integration.id,
    'Attempt browser cleanup outside coordinator order for ' ||
      integration.provider::text,
    'lifecycle-order-browser-' || integration.provider::text
  ),
  '55000',
  'Archived advocate cleanup must use the lifecycle coordinator',
  'browser enqueue cannot bypass strict order for ' || integration.provider::text
)
FROM public.advocate_domain_integrations integration
WHERE integration.advocate_id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
)
ORDER BY integration.provider::text;

SELECT pg_temp.set_lifecycle_test_role('service_role');

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.enqueue_domain_provisioning_job_system(
        %L::uuid,
        %L::uuid,
        'deprovision',
        clock_timestamp(),
        %L
      )
    $sql$,
    integration.domain_id,
    integration.id,
    'lifecycle-order-system-' || integration.provider::text
  ),
  '55000',
  'Archived advocate cleanup must use the lifecycle coordinator',
  'system enqueue cannot bypass strict order for ' || integration.provider::text
)
FROM public.advocate_domain_integrations integration
WHERE integration.advocate_id = (
  SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
)
ORDER BY integration.provider::text;

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT *
FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'cloudflare_dns_removal'
      AND result.jobs_enqueued = 1
      AND NOT result.cleanup_complete
  )
  AND (
    SELECT count(*) = 1
      AND bool_and(job.provider = 'cloudflare')
      AND bool_and(
        job.run_after >= advocate.archived_at + interval '20 minutes'
      )
    FROM public.domain_provisioning_jobs job
    JOIN public.advocates advocate ON advocate.id = job.advocate_id
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
  ),
  'the first recovery run creates one Cloudflare job only after the twenty-minute archive boundary'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT *
FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'cloudflare_dns_removal'
      AND result.jobs_enqueued = 0
      AND NOT result.cleanup_complete
  )
  AND (
    SELECT count(*) = 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
  ),
  'a queued Cloudflare phase replays exactly without creating a second job'
);

SELECT extensions.is(
  pg_temp.settle_lifecycle_test_jobs(
    'lifecycle-cloudflare-removal-worker',
    1,
    true
  ),
  1,
  'Cloudflare absence settles before any downstream provider cleanup is created'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT *
FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'vercel_removal'
      AND result.jobs_enqueued = 1
      AND NOT result.cleanup_complete
  )
  AND (
    SELECT count(*) = 1 AND bool_and(job.provider = 'vercel')
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
      AND job.status IN ('queued', 'running')
  ),
  'verified Cloudflare absence releases only the Vercel phase'
);

SELECT extensions.is(
  pg_temp.settle_lifecycle_test_jobs(
    'lifecycle-vercel-removal-worker',
    1,
    true
  ),
  1,
  'Vercel absence settles before payment cleanup exists'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT * FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'stripe_us_removal'
      AND result.jobs_enqueued = 1
      AND NOT result.cleanup_complete
  )
  AND (
    SELECT count(*) = 1 AND bool_and(job.provider = 'stripe_us')
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
      AND job.status IN ('queued', 'running')
  ),
  'verified Vercel absence releases only the Stripe US phase'
);

SELECT extensions.is(
  pg_temp.settle_lifecycle_test_jobs(
    'lifecycle-stripe-us-removal-worker',
    1,
    true
  ),
  1,
  'Stripe US absence settles before Stripe UK cleanup exists'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT * FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'stripe_uk_removal'
      AND result.jobs_enqueued = 1
      AND NOT result.cleanup_complete
  )
  AND (
    SELECT count(*) = 1 AND bool_and(job.provider = 'stripe_uk')
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
      AND job.status IN ('queued', 'running')
  ),
  'verified Stripe US absence releases only the Stripe UK phase'
);

SELECT extensions.is(
  pg_temp.settle_lifecycle_test_jobs(
    'lifecycle-stripe-uk-removal-worker',
    1,
    true
  ),
  1,
  'Stripe UK absence settles before PayPal cleanup exists'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT * FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND result.phase = 'paypal_removal'
      AND result.jobs_enqueued = 1
      AND NOT result.cleanup_complete
  )
  AND (
    SELECT count(*) = 1 AND bool_and(job.provider = 'paypal')
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.kind = 'deprovision'
      AND job.status IN ('queued', 'running')
  ),
  'verified Stripe UK absence releases only the PayPal phase'
);

SELECT extensions.is(
  pg_temp.settle_lifecycle_test_jobs(
    'lifecycle-paypal-removal-worker',
    1,
    true
  ),
  1,
  'PayPal absence settles the final provider phase'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'domain'
      )
      AND domain.status = 'disabled'
      AND domain.deactivated_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND integration.status <> 'disabled'
  ),
  'the existing settlement boundary completes the archived domain into disabled state'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT *
FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-cleanup-coordinator'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    WHERE result.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
        SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate'
      )
      AND job.status IN ('queued', 'running')
  ),
  'completed archived domains leave the recurring scheduler queue without recreating work'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.ok(
  (
    SELECT snapshot.cleanup_phase = 'complete'
      AND snapshot.open_deprovision_jobs = 0
      AND NOT snapshot.can_retry_cleanup
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM lifecycle_test_context WHERE key = 'advocate')
    ) snapshot
  ),
  'the control snapshot reports complete after all five ordered settlements'
);

INSERT INTO lifecycle_archive_fixture (fixture_name, advocate_id, domain_id)
SELECT 'terminal_one', fixture.advocate_id, fixture.domain_id
FROM pg_temp.create_archived_lifecycle_fixture(
  1,
  'lifecycle-terminal-one'
) fixture;

INSERT INTO lifecycle_archive_fixture (fixture_name, advocate_id, domain_id)
SELECT 'terminal_two', fixture.advocate_id, fixture.domain_id
FROM pg_temp.create_archived_lifecycle_fixture(
  2,
  'lifecycle-terminal-two'
) fixture;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.advocates DISABLE TRIGGER advocates_touch_updated_at;
ALTER TABLE public.advocates DISABLE TRIGGER advocates_audit_row_change;

UPDATE public.advocates advocate
SET archived_at = clock_timestamp() - interval '20 minutes 1 second'
WHERE advocate.id IN (
  SELECT fixture.advocate_id
  FROM lifecycle_archive_fixture fixture
  WHERE fixture.fixture_name IN ('terminal_one', 'terminal_two')
);

ALTER TABLE public.advocates ENABLE TRIGGER advocates_audit_row_change;
ALTER TABLE public.advocates ENABLE TRIGGER advocates_touch_updated_at;

SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.set_lifecycle_test_role('service_role');

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT * FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-fairness-coordinator'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
      AND bool_and(result.phase = 'cloudflare_dns_removal')
      AND bool_and(result.jobs_enqueued = 1)
    FROM lifecycle_coordinator_result result
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = result.advocate_id
    WHERE fixture.fixture_name IN ('terminal_one', 'terminal_two')
  ),
  'two older archived fixtures each receive one initial Cloudflare cleanup job'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

INSERT INTO lifecycle_archive_fixture (fixture_name, advocate_id, domain_id)
SELECT 'later_actionable', fixture.advocate_id, fixture.domain_id
FROM pg_temp.create_archived_lifecycle_fixture(
  3,
  'lifecycle-later-actionable'
) fixture;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.advocates DISABLE TRIGGER advocates_touch_updated_at;
ALTER TABLE public.advocates DISABLE TRIGGER advocates_audit_row_change;

UPDATE public.advocates advocate
SET archived_at = clock_timestamp() - interval '20 minutes 1 second'
WHERE advocate.id = (
  SELECT fixture.advocate_id
  FROM lifecycle_archive_fixture fixture
  WHERE fixture.fixture_name = 'later_actionable'
);

ALTER TABLE public.advocates ENABLE TRIGGER advocates_audit_row_change;
ALTER TABLE public.advocates ENABLE TRIGGER advocates_touch_updated_at;

SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.set_lifecycle_test_role('service_role');

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT * FROM public.coordinate_archived_advocate_domain_deprovisioning(
  2,
  'lifecycle-fairness-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = result.advocate_id
    WHERE fixture.fixture_name = 'later_actionable'
      AND result.phase = 'cloudflare_dns_removal'
      AND result.jobs_enqueued = 1
      AND NOT result.cleanup_complete
  )
  AND (
    SELECT count(*) = 3
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = job.advocate_id
    WHERE job.kind = 'deprovision'
      AND job.status = 'queued'
  ),
  'batch-size-plus-one delayed rows cannot starve a later archive that can enqueue now'
);

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.domain_provisioning_jobs
  DISABLE TRIGGER domain_provisioning_jobs_validate_and_prepare;
ALTER TABLE public.domain_provisioning_jobs
  DISABLE TRIGGER domain_provisioning_jobs_audit_row_change;

UPDATE public.domain_provisioning_jobs job
SET max_attempts = 1
FROM lifecycle_archive_fixture fixture
WHERE fixture.advocate_id = job.advocate_id
  AND fixture.fixture_name IN ('terminal_one', 'terminal_two')
  AND job.kind = 'deprovision'
  AND job.status = 'queued';

ALTER TABLE public.domain_provisioning_jobs
  ENABLE TRIGGER domain_provisioning_jobs_audit_row_change;
ALTER TABLE public.domain_provisioning_jobs
  ENABLE TRIGGER domain_provisioning_jobs_validate_and_prepare;

SET CONSTRAINTS ALL DEFERRED;

TRUNCATE lifecycle_claim;
INSERT INTO lifecycle_claim (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'lifecycle-fairness-worker',
  3,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  public.retry_domain_provisioning_job(
    claim.job_id,
    claim.lease_token,
    interval '1 second',
    'lifecycle_test_exhausted',
    '{}'::jsonb
  ),
  'failed'::public.domain_provisioning_job_status,
  'the bounded provider job becomes terminal for ' || fixture.fixture_name
)
FROM lifecycle_claim claim
JOIN public.domain_provisioning_jobs job ON job.id = claim.job_id
JOIN lifecycle_archive_fixture fixture ON fixture.advocate_id = job.advocate_id
WHERE fixture.fixture_name = 'terminal_one'
ORDER BY fixture.fixture_name;

SELECT audit.set_actor_context(
  context_actor_type => 'system'::audit.audit_actor_type,
  context_system_actor => 'lifecycle-fairness-worker',
  context_tool => 'domain-provisioning-worker',
  context_request_id => 'lifecycle-terminal-cancelled',
  context_reason => 'Create deterministic cancelled recovery evidence',
  context_metadata => jsonb_build_object(
    'operation', 'cancel',
    'resource_kind', 'domain_job',
    'outcome', 'cancelled'
  )
);

UPDATE public.domain_provisioning_jobs job
SET
  status = 'cancelled',
  lease_owner = NULL,
  lease_token = NULL,
  leased_at = NULL,
  lease_expires_at = NULL,
  finished_at = clock_timestamp(),
  last_error = 'lifecycle_test_cancelled'
FROM lifecycle_claim claim
JOIN lifecycle_archive_fixture fixture
  ON fixture.fixture_name = 'terminal_two'
WHERE job.id = claim.job_id
  AND job.advocate_id = fixture.advocate_id;

SELECT extensions.is(
  (
    SELECT job.status
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = job.advocate_id
    WHERE fixture.fixture_name = 'terminal_two'
      AND job.kind = 'deprovision'
  ),
  'cancelled'::public.domain_provisioning_job_status,
  'the second bounded provider job becomes cancelled terminal evidence'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT * FROM public.coordinate_archived_advocate_domain_deprovisioning(
  1,
  'lifecycle-fairness-coordinator'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM lifecycle_coordinator_result result
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = result.advocate_id
    WHERE fixture.fixture_name = 'later_actionable'
      AND result.phase = 'cloudflare_dns_removal'
      AND result.jobs_enqueued = 0
      AND NOT result.cleanup_complete
  ),
  'more terminal rows than the batch limit cannot monopolize the scheduler head'
);

TRUNCATE lifecycle_coordinator_result;
INSERT INTO lifecycle_coordinator_result
SELECT * FROM public.coordinate_archived_advocate_domain_deprovisioning(
  25,
  'lifecycle-fairness-coordinator'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
      AND bool_and(result.phase = 'needs_attention')
      AND bool_and(result.jobs_enqueued = 0)
      AND bool_and(NOT result.cleanup_complete)
    FROM lifecycle_coordinator_result result
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = result.advocate_id
    WHERE fixture.fixture_name IN ('terminal_one', 'terminal_two')
  )
  AND (
    SELECT count(*) = 2
      AND count(*) FILTER (WHERE job.status = 'failed') = 1
      AND count(*) FILTER (WHERE job.status = 'cancelled') = 1
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = job.advocate_id
    WHERE fixture.fixture_name IN ('terminal_one', 'terminal_two')
      AND job.kind = 'deprovision'
      AND job.status IN ('failed', 'cancelled')
  ),
  'recurring coordination quarantines terminal phases without creating replacement jobs'
);

SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.ok(
  (
    SELECT snapshot.cleanup_phase = 'needs_attention'
      AND snapshot.open_deprovision_jobs = 0
      AND snapshot.can_retry_cleanup
    FROM public.get_creator_share_advocate_control_snapshot(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      )
    ) snapshot
  ),
  'the control snapshot and coordinator agree on terminal cleanup attention'
);

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT 'terminal_one_recovery_version', advocate.version
FROM public.advocates advocate
JOIN lifecycle_archive_fixture fixture
  ON fixture.advocate_id = advocate.id
WHERE fixture.fixture_name = 'terminal_one';

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT 'terminal_two_recovery_version', advocate.version
FROM public.advocates advocate
JOIN lifecycle_archive_fixture fixture
  ON fixture.advocate_id = advocate.id
WHERE fixture.fixture_name = 'terminal_two';

SELECT set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000005',
  true
);
SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.retry_creator_share_advocate_cleanup(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      ),
      (
        SELECT bigint_value
        FROM lifecycle_test_context
        WHERE key = 'terminal_one_recovery_version'
      ),
      'An ordinary account must not recover archived cleanup',
      'd4000000-0000-4000-8000-000000000121'::uuid,
      'lifecycle-recovery-outsider-trace'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'an ordinary authenticated account cannot recover terminal cleanup'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'd4000000-0000-4000-8000-000000000001',
  true
);
SELECT pg_temp.set_lifecycle_test_role('authenticated');

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.retry_creator_share_advocate_cleanup(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      ),
      (
        SELECT bigint_value
        FROM lifecycle_test_context
        WHERE key = 'terminal_one_recovery_version'
      ),
      'Reject empty cleanup recovery transport evidence',
      'd4000000-0000-4000-8000-000000000125'::uuid,
      'lifecycle-recovery-empty-transport-trace',
      '',
      'lifecycle-recovery-empty-transport-agent'
    )
  $$,
  '22023',
  'Creator Share advocate cleanup recovery input is invalid',
  'cleanup recovery rejects an empty nonnull client IP'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.retry_creator_share_advocate_cleanup(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      ),
      (
        SELECT bigint_value
        FROM lifecycle_test_context
        WHERE key = 'terminal_one_recovery_version'
      ),
      'Reject control characters in cleanup recovery transport evidence',
      'd4000000-0000-4000-8000-000000000126'::uuid,
      'lifecycle-recovery-control-transport-trace',
      '203.0.113.126',
      E'lifecycle-recovery-control\ntransport-agent'
    )
  $$,
  '22023',
  'Creator Share advocate cleanup recovery input is invalid',
  'cleanup recovery rejects control characters in the user agent'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.retry_creator_share_advocate_cleanup(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      ),
      (
        SELECT bigint_value
        FROM lifecycle_test_context
        WHERE key = 'terminal_one_recovery_version'
      ),
      'Reject oversized cleanup recovery transport evidence',
      'd4000000-0000-4000-8000-000000000127'::uuid,
      'lifecycle-recovery-oversized-transport-trace',
      '203.0.113.127',
      repeat('é', 513)
    )
  $$,
  '22023',
  'Creator Share advocate cleanup recovery input is invalid',
  'cleanup recovery enforces the 1024 UTF-8 byte user agent bound'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.retry_creator_share_advocate_cleanup(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      ),
      (
        SELECT bigint_value
        FROM lifecycle_test_context
        WHERE key = 'terminal_one_recovery_version'
      ),
      E'Reject cleanup recovery reason\x7f',
      'd4000000-0000-4000-8000-000000000128'::uuid,
      'lifecycle-recovery-control-reason-trace'
    )
  $$,
  '22023',
  'Creator Share advocate cleanup recovery input is invalid',
  'cleanup recovery rejects DEL in an immutable reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.retry_creator_share_advocate_cleanup(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'later_actionable'
      ),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        JOIN lifecycle_archive_fixture fixture
          ON fixture.advocate_id = advocate.id
        WHERE fixture.fixture_name = 'later_actionable'
      ),
      'Open cleanup work is not terminal recovery evidence',
      'd4000000-0000-4000-8000-000000000122'::uuid,
      'lifecycle-recovery-wrong-state-trace'
    )
  $$,
  '55000',
  'Advocate cleanup is not eligible for recovery',
  'cleanup recovery rejects a tenant whose current strict-order job is still open'
);

SELECT pg_temp.set_lifecycle_test_role(
  'authenticated',
  'd4000000-0000-4000-8000-000000000923'::uuid
);

TRUNCATE lifecycle_cleanup_recovery_result;
INSERT INTO lifecycle_cleanup_recovery_result
SELECT *
FROM public.retry_creator_share_advocate_cleanup(
  (
    SELECT fixture.advocate_id
    FROM lifecycle_archive_fixture fixture
    WHERE fixture.fixture_name = 'terminal_one'
  ),
  (
    SELECT bigint_value
    FROM lifecycle_test_context
    WHERE key = 'terminal_one_recovery_version'
  ),
  'Retry the latest failed strict-order cleanup job',
  'd4000000-0000-4000-8000-000000000123'::uuid,
  'lifecycle-failed-recovery-trace',
  '203.0.113.123',
  'lifecycle-failed-recovery-admin-test-agent'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.cleanup_phase = 'cloudflare_dns_removal'
      AND result.cleanup_retry_requested
    FROM lifecycle_cleanup_recovery_result result
    JOIN lifecycle_test_context context
      ON context.key = 'terminal_one_recovery_version'
  )
  AND (
    SELECT count(*) = 2
      AND count(*) FILTER (WHERE job.status = 'failed') = 1
      AND count(*) FILTER (WHERE job.status = 'queued') = 1
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = job.advocate_id
    WHERE fixture.fixture_name = 'terminal_one'
      AND job.kind = 'deprovision'
  )
  AND (
    SELECT count(*) = 1
    FROM audit.creator_share_advocate_cleanup_recoveries recovery
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = recovery.advocate_id
    WHERE fixture.fixture_name = 'terminal_one'
      AND recovery.request_id =
        'd4000000-0000-4000-8000-000000000123'::uuid
      AND recovery.cleanup_retry_requested
      AND recovery.session_id =
        'd4000000-0000-4000-8000-000000000923'::uuid::text
  ),
  'failed cleanup recovery advances the tenant once and creates one fresh current-phase job'
);

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT
  'failed_recovery_forensic_count',
  count(*)
FROM audit.audit_events event
JOIN audit.audit_event_forensics forensic
  ON forensic.audit_event_id = event.id
WHERE event.request_id =
  'd4000000-0000-4000-8000-000000000123'::uuid::text;

INSERT INTO lifecycle_test_context (key, bigint_value)
SELECT
  'failed_recovery_audit_count',
  count(*)
FROM audit.audit_events event
WHERE event.request_id =
  'd4000000-0000-4000-8000-000000000123'::uuid::text;

SELECT extensions.ok(
  (
    SELECT count(*) > 0
      AND bool_and(
        event.session_id =
          'd4000000-0000-4000-8000-000000000923'::uuid::text
        AND forensic.client_ip = '203.0.113.123'
        AND forensic.user_agent =
          'lifecycle-failed-recovery-admin-test-agent'
        AND forensic.expires_at = forensic.captured_at + interval '90 days'
      )
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000123'::uuid::text
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'failed_recovery_audit_count'
    )
    FROM audit.audit_events event
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000123'::uuid::text
  ),
  'cleanup recovery captures signed session transport only in ninety-day forensics'
);

SELECT pg_temp.set_lifecycle_test_role(
  'authenticated',
  'd4000000-0000-4000-8000-000000000933'::uuid
);

TRUNCATE lifecycle_cleanup_recovery_result;
INSERT INTO lifecycle_cleanup_recovery_result
SELECT *
FROM public.retry_creator_share_advocate_cleanup(
  (
    SELECT fixture.advocate_id
    FROM lifecycle_archive_fixture fixture
    WHERE fixture.fixture_name = 'terminal_one'
  ),
  (
    SELECT bigint_value
    FROM lifecycle_test_context
    WHERE key = 'terminal_one_recovery_version'
  ),
  'Retry the latest failed strict-order cleanup job',
  'd4000000-0000-4000-8000-000000000123'::uuid,
  'lifecycle-failed-recovery-replay-trace',
  '203.0.113.223',
  'lifecycle-failed-recovery-replay-test-agent'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.cleanup_phase = 'cloudflare_dns_removal'
      AND result.cleanup_retry_requested
    FROM lifecycle_cleanup_recovery_result result
    JOIN lifecycle_test_context context
      ON context.key = 'terminal_one_recovery_version'
  )
  AND (
    SELECT count(*) = 2
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = job.advocate_id
    WHERE fixture.fixture_name = 'terminal_one'
      AND job.kind = 'deprovision'
  )
  AND (
    SELECT count(*) = 1
    FROM audit.creator_share_advocate_cleanup_recoveries recovery
    WHERE recovery.request_id =
      'd4000000-0000-4000-8000-000000000123'::uuid
      AND recovery.trace_id = 'lifecycle-failed-recovery-trace'
      AND recovery.session_id =
        'd4000000-0000-4000-8000-000000000923'::uuid::text
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'failed_recovery_forensic_count'
    )
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000123'::uuid::text
  )
  AND (
    SELECT count(*) = (
      SELECT context.bigint_value
      FROM lifecycle_test_context context
      WHERE context.key = 'failed_recovery_audit_count'
    )
    FROM audit.audit_events event
    WHERE event.request_id =
      'd4000000-0000-4000-8000-000000000123'::uuid::text
  ),
  'cleanup recovery replay ignores later session transport and creates no audit evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.retry_creator_share_advocate_cleanup(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      ),
      (
        SELECT bigint_value
        FROM lifecycle_test_context
        WHERE key = 'terminal_one_recovery_version'
      ),
      'Reuse the request with different semantics',
      'd4000000-0000-4000-8000-000000000123'::uuid,
      'lifecycle-failed-recovery-conflict-trace'
    )
  $$,
  '40001',
  'Advocate cleanup recovery replay does not match the committed request',
  'cleanup recovery rejects request identifier reuse with different semantics'
);

TRUNCATE lifecycle_cleanup_recovery_result;
INSERT INTO lifecycle_cleanup_recovery_result
SELECT *
FROM public.retry_creator_share_advocate_cleanup(
  (
    SELECT fixture.advocate_id
    FROM lifecycle_archive_fixture fixture
    WHERE fixture.fixture_name = 'terminal_two'
  ),
  (
    SELECT bigint_value
    FROM lifecycle_test_context
    WHERE key = 'terminal_two_recovery_version'
  ),
  'Retry the latest cancelled strict-order cleanup job',
  'd4000000-0000-4000-8000-000000000124'::uuid,
  'lifecycle-cancelled-recovery-trace'
);

SELECT extensions.ok(
  (
    SELECT result.advocate_version = context.bigint_value + 1
      AND result.cleanup_phase = 'cloudflare_dns_removal'
      AND result.cleanup_retry_requested
    FROM lifecycle_cleanup_recovery_result result
    JOIN lifecycle_test_context context
      ON context.key = 'terminal_two_recovery_version'
  )
  AND (
    SELECT count(*) = 2
      AND count(*) FILTER (WHERE job.status = 'cancelled') = 1
      AND count(*) FILTER (WHERE job.status = 'queued') = 1
    FROM public.domain_provisioning_jobs job
    JOIN lifecycle_archive_fixture fixture
      ON fixture.advocate_id = job.advocate_id
    WHERE fixture.fixture_name = 'terminal_two'
      AND job.kind = 'deprovision'
  ),
  'cancelled cleanup recovery also creates exactly one fresh current-phase job'
);

SELECT extensions.ok(
  (
    SELECT snapshot.cleanup_phase = 'cloudflare_dns_removal'
      AND snapshot.open_deprovision_jobs = 1
      AND NOT snapshot.can_retry_cleanup
    FROM public.get_creator_share_advocate_control_snapshot(
      (
        SELECT fixture.advocate_id
        FROM lifecycle_archive_fixture fixture
        WHERE fixture.fixture_name = 'terminal_one'
      )
    ) snapshot
  ),
  'the control snapshot clears recovery eligibility while replacement work is open'
);

SELECT * FROM extensions.finish();

ROLLBACK;

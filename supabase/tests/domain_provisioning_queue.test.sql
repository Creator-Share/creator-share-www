BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(48);

CREATE TEMP TABLE queue_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  text_value text
) ON COMMIT DROP;

CREATE TEMP TABLE queue_test_claims (
  label text PRIMARY KEY,
  job_id uuid NOT NULL,
  attempt_count integer NOT NULL,
  provider_idempotency_key text NOT NULL,
  lease_token uuid NOT NULL,
  lease_expires_at timestamp with time zone NOT NULL
) ON COMMIT DROP;

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
VALUES
  (
    '91000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'queue-admin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '91000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'queue-member@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT
  '91000000-0000-4000-8000-000000000001'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status
  )
  VALUES (
    'queuecontract',
    'Queue Contract',
    'active'
  )
  RETURNING id
)
INSERT INTO queue_test_context (key, uuid_value)
SELECT 'advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    uuid_value,
    'queuecontract.creatorshare.com',
    true
  FROM queue_test_context
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO queue_test_context (key, uuid_value)
SELECT 'domain', id FROM inserted;

UPDATE public.advocate_domains
SET status = 'provisioning'
WHERE id = (
  SELECT uuid_value FROM queue_test_context WHERE key = 'domain'
);

WITH inserted AS (
  INSERT INTO public.advocate_domain_integrations (
    advocate_id,
    domain_id,
    provider,
    environment
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    'cloudflare',
    'production'
  FROM queue_test_context advocate
  CROSS JOIN queue_test_context domain
  WHERE advocate.key = 'advocate'
    AND domain.key = 'domain'
  RETURNING id
)
INSERT INTO queue_test_context (key, uuid_value)
SELECT 'integration', id FROM inserted;

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid = 'public.domain_provisioning_jobs'::regclass
  ),
  'the provider work queue has RLS enabled'
);

SELECT extensions.ok(
  has_table_privilege('service_role', 'public.domain_provisioning_jobs', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.domain_provisioning_jobs', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.domain_provisioning_jobs', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.domain_provisioning_jobs', 'DELETE'),
  'the service role can inspect jobs but cannot directly mutate queue rows'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.domain_provisioning_jobs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.domain_provisioning_jobs', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.domain_provisioning_jobs', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.domain_provisioning_jobs', 'DELETE'),
  'authenticated browser clients have no queue table privileges'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_domain_provisioning_jobs(text,integer,interval)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.record_domain_provisioning_reconciliation(uuid,uuid,text,jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.renew_domain_provisioning_job_lease(uuid,uuid,interval)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_status,text,jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.retry_domain_provisioning_job(uuid,uuid,interval,text,jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.cancel_domain_provisioning_job(uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'only narrow worker operations are exposed to the service role'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.enqueue_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_kind,text,timestamp with time zone,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.enqueue_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_kind,text,timestamp with time zone,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.enqueue_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_kind,text,timestamp with time zone,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.enqueue_domain_provisioning_job_system(uuid,uuid,public.domain_provisioning_job_kind,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'administrator and system enqueue entrypoints have distinct callers'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.enqueue_domain_provisioning_job(
      (SELECT uuid_value FROM queue_test_context WHERE key = 'domain'),
      (SELECT uuid_value FROM queue_test_context WHERE key = 'integration'),
      'provision',
      'An ordinary account cannot provision domains',
      now(),
      'queue-request-denied'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'ordinary authenticated users cannot enqueue infrastructure work'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.enqueue_domain_provisioning_job(
      (SELECT uuid_value FROM queue_test_context WHERE key = 'domain'),
      (SELECT uuid_value FROM queue_test_context WHERE key = 'integration'),
      'provision',
      '   ',
      now(),
      'queue-request-no-reason'
    )
  $$,
  '22023',
  'A provisioning reason between 1 and 2000 characters is required',
  'administrator enqueue requires a substantive audit reason'
);

INSERT INTO queue_test_context (key, uuid_value)
SELECT
  'admin_job',
  public.enqueue_domain_provisioning_job(
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    'Provision the initial Cloudflare record',
    now(),
    'queue-request-1'
  )
FROM queue_test_context domain
CROSS JOIN queue_test_context integration
WHERE domain.key = 'domain'
  AND integration.key = 'integration';

SELECT extensions.ok(
  (
    SELECT
      job.status = 'queued'
      AND job.kind = 'provision'
      AND job.provider = 'cloudflare'
      AND job.attempt_count = 0
      AND job.reconciliation_required
      AND job.request_payload = jsonb_build_object(
        'schema_version', 1,
        'reconciliation_policy', 'lookup_before_mutation'
      )
      AND job.provider_idempotency_key ~ '^[0-9a-f]{64}$'
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_context context
      ON context.key = 'admin_job'
     AND context.uuid_value = job.id
  ),
  'administrator enqueue derives tenant, provider, canonical input, and stable provider key'
);

SELECT extensions.is(
  (
    SELECT public.enqueue_domain_provisioning_job(
      domain.uuid_value,
      integration.uuid_value,
      'provision',
      'Idempotent replay of the same provisioning request',
      now(),
      'queue-request-1-replay'
    )
    FROM queue_test_context domain
    CROSS JOIN queue_test_context integration
    WHERE domain.key = 'domain'
      AND integration.key = 'integration'
  ),
  (SELECT uuid_value FROM queue_test_context WHERE key = 'admin_job'),
  'a repeated open enqueue returns the existing job id'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.domain_provisioning_jobs job
    WHERE job.integration_id = (
      SELECT uuid_value FROM queue_test_context WHERE key = 'integration'
    )
      AND job.status IN ('queued', 'running')
  ),
  1,
  'only one open action can exist for an integration'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.enqueue_domain_provisioning_job(
      (SELECT uuid_value FROM queue_test_context WHERE key = 'domain'),
      (SELECT uuid_value FROM queue_test_context WHERE key = 'integration'),
      'reconcile',
      'Conflicting action test',
      now(),
      'queue-request-conflict'
    )
  $$,
  '55000',
  'A conflicting domain integration operation is already open',
  'a reconcile action cannot race an open provision action'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.domain_provisioning_jobs (
      advocate_id,
      domain_id,
      integration_id,
      kind,
      provider,
      request_payload
    )
    SELECT
      advocate.uuid_value,
      domain.uuid_value,
      integration.uuid_value,
      'provision',
      'cloudflare',
      jsonb_build_object('api_token', 'absolutely-not')
    FROM queue_test_context advocate
    CROSS JOIN queue_test_context domain
    CROSS JOIN queue_test_context integration
    WHERE advocate.key = 'advocate'
      AND domain.key = 'domain'
      AND integration.key = 'integration'
  $$,
  '22023',
  'Domain provisioning request payload is not allowlisted',
  'credentials cannot be smuggled into request payloads'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.domain_provisioning_jobs (
      advocate_id,
      domain_id,
      integration_id,
      kind,
      provider,
      request_payload
    )
    SELECT
      advocate.uuid_value,
      domain.uuid_value,
      integration.uuid_value,
      'provision',
      'vercel',
      jsonb_build_object(
        'schema_version', 1,
        'reconciliation_policy', 'lookup_before_mutation'
      )
    FROM queue_test_context advocate
    CROSS JOIN queue_test_context domain
    CROSS JOIN queue_test_context integration
    WHERE advocate.key = 'advocate'
      AND domain.key = 'domain'
      AND integration.key = 'integration'
  $$,
  '23514',
  'Domain provisioning provider must match its integration',
  'the job provider cannot diverge from its integration'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.domain_provisioning_jobs
    SET kind = 'reconcile'
    WHERE id = (
      SELECT uuid_value FROM queue_test_context WHERE key = 'admin_job'
    )
  $$,
  '42501',
  'Domain provisioning job tenant and input identity are immutable',
  'job inputs cannot be rewritten after enqueue'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.domain_provisioning_jobs
    WHERE id = (
      SELECT uuid_value FROM queue_test_context WHERE key = 'admin_job'
    )
  $$,
  '42501',
  'Domain provisioning job history is immutable',
  'job history cannot be deleted'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_domain_provisioning_jobs(
      'queue-worker-1',
      NULL,
      interval '5 seconds'
    )
  $$,
  '22023',
  'Domain provisioning claim batch size must be between 1 and 100',
  'a null batch size cannot become an unbounded claim'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_domain_provisioning_jobs(
      'queue-worker-1',
      1,
      interval '1 second'
    )
  $$,
  '22023',
  'Domain provisioning lease must be between 5 seconds and 15 minutes',
  'workers cannot request a pathologically short lease'
);

INSERT INTO queue_test_claims (
  label,
  job_id,
  attempt_count,
  provider_idempotency_key,
  lease_token,
  lease_expires_at
)
SELECT
  'admin_job_first',
  claimed.job_id,
  claimed.attempt_count,
  claimed.provider_idempotency_key,
  claimed.lease_token,
  claimed.lease_expires_at
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-1',
  1,
  interval '5 minutes'
) claimed;

SELECT extensions.is(
  (SELECT count(*)::integer FROM queue_test_claims WHERE label = 'admin_job_first'),
  1,
  'a due job is claimed exactly once'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'running'
      AND claim.attempt_count = 1
      AND job.lease_token = claim.lease_token
      AND job.lease_expires_at = claim.lease_expires_at
      AND job.lease_expires_at > job.leased_at
      AND job.lease_expires_at <= job.leased_at + interval '15 minutes'
      AND job.reconciliation_required
    FROM queue_test_claims claim
    JOIN public.domain_provisioning_jobs job ON job.id = claim.job_id
    WHERE claim.label = 'admin_job_first'
  ),
  'claiming creates a bounded opaque lease and increments the attempt'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.cancel_queued_domain_provisioning_job(
      (SELECT uuid_value FROM queue_test_context WHERE key = 'admin_job'),
      'Attempt to cancel provider work already in flight',
      'queue-running-admin-cancel'
    )
  $$,
  '55000',
  'Only queued domain provisioning work can be administratively cancelled',
  'an administrator cannot bypass fencing once provider work is in flight'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    SELECT public.renew_domain_provisioning_job_lease(
      claim.job_id,
      gen_random_uuid(),
      interval '6 minutes'
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'a wrong fencing token cannot renew a worker lease'
);

SELECT extensions.ok(
  (
    SELECT public.renew_domain_provisioning_job_lease(
      claim.job_id,
      claim.lease_token,
      interval '6 minutes'
    ) > claim.lease_expires_at
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  ),
  'the current worker can heartbeat a long provider operation without rotating its token'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      '{}'::jsonb
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  $$,
  '55000',
  'Provider reconciliation is required before successful completion',
  'a worker cannot report success before reconciling provider state'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'needs_apply',
      jsonb_build_object('authorization', 'Bearer nope')
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  $$,
  '22023',
  'Domain provisioning result payload contains unsupported data',
  'provider response secrets cannot be stored as reconciliation evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'needs_apply',
      jsonb_build_object('message_code', 'Bearer secret disguised as status')
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  $$,
  '22023',
  'Domain provisioning result payload contains unsupported data',
  'allowlisted result keys still reject freeform secret-bearing values'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      gen_random_uuid(),
      'needs_apply',
      '{}'::jsonb
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'a wrong lease token cannot record reconciliation'
);

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'needs_apply',
  jsonb_build_object(
    'provider_request_id', 'cf-request-1',
    'http_status', 200
  )
)
FROM queue_test_claims claim
WHERE claim.label = 'admin_job_first';

SELECT extensions.ok(
  (
    SELECT
      NOT job.reconciliation_required
      AND job.reconciliation_outcome = 'needs_apply'
      AND job.reconciled_at IS NOT NULL
      AND job.result_payload ->> 'provider_request_id' = 'cf-request-1'
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_claims claim ON claim.job_id = job.id
    WHERE claim.label = 'admin_job_first'
  ),
  'a safe reconciliation outcome unlocks the provider mutation or completion path'
);

SELECT extensions.is(
  (
    SELECT job.provider_idempotency_key
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_claims claim ON claim.job_id = job.id
    WHERE claim.label = 'admin_job_first'
  ),
  (
    SELECT provider_idempotency_key
    FROM queue_test_claims
    WHERE label = 'admin_job_first'
  ),
  'reconciliation does not rotate the provider idempotency key'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object('provider_resource_id', 'cloudflare-record-unverified')
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  $$,
  '55000',
  'Verified provider state is required before successful completion',
  'reconciliation alone cannot turn an unverified provider operation into success'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      gen_random_uuid(),
      'succeeded',
      NULL,
      '{}'::jsonb
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'admin_job_first'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'a wrong lease token cannot complete a job'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  jsonb_build_object(
    'provider_status', 'dns_only_cname_ready',
    'provider_resource_id', 'cloudflare-record-1',
    'dns_record_id', 'cloudflare-record-1',
    'verified', true
  )
)
FROM queue_test_claims claim
WHERE claim.label = 'admin_job_first';

SELECT extensions.ok(
  (
    SELECT
      job.status = 'succeeded'
      AND job.finished_at IS NOT NULL
      AND job.lease_owner IS NULL
      AND job.lease_token IS NULL
      AND job.last_error IS NULL
      AND job.result_payload ->> 'provider_resource_id' = 'cloudflare-record-1'
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_context context
      ON context.key = 'admin_job'
     AND context.uuid_value = job.id
  ),
  'successful completion is terminal and clears every lease field'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN queue_test_context context
      ON context.key = 'admin_job'
     AND event.record_pk ->> 'id' = context.uuid_value::text
    WHERE event.table_name = 'domain_provisioning_jobs'
      AND event.operation = 'INSERT'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id = '91000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'creator-share-admin-domains'
      AND event.request_id = 'queue-request-1'
      AND event.reason = 'Provision the initial Cloudflare record'
  ),
  'administrator enqueue records actor, tool, request id, and reason'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN queue_test_context context
      ON context.key = 'admin_job'
     AND event.record_pk ->> 'id' = context.uuid_value::text
    WHERE event.table_name = 'domain_provisioning_jobs'
      AND event.operation = 'UPDATE'
      AND event.actor_type = 'system'
      AND event.system_actor = 'advocate-domain-worker'
      AND event.tool = 'domain-provisioning-claim'
      AND event.after_data ->> 'lease_token' = '[REDACTED]'
      AND event.after_data ->> 'provider_idempotency_key' = '[REDACTED]'
      AND event.after_data ->> 'request_payload' = '[REDACTED]'
      AND event.after_data ->> 'result_payload' = '[REDACTED]'
  ),
  'worker audit records are system attributed and redact fencing and provider evidence'
);

INSERT INTO queue_test_context (key, uuid_value)
SELECT
  'retry_job',
  public.enqueue_domain_provisioning_job_system(
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    now(),
    'queue-system-retry'
  )
FROM queue_test_context domain
CROSS JOIN queue_test_context integration
WHERE domain.key = 'domain'
  AND integration.key = 'integration';

SELECT extensions.is(
  (
    SELECT public.enqueue_domain_provisioning_job_system(
      domain.uuid_value,
      integration.uuid_value,
      'provision',
      now(),
      'queue-system-retry-replay'
    )
    FROM queue_test_context domain
    CROSS JOIN queue_test_context integration
    WHERE domain.key = 'domain'
      AND integration.key = 'integration'
  ),
  (SELECT uuid_value FROM queue_test_context WHERE key = 'retry_job'),
  'system enqueue is idempotent while the same action remains open'
);

INSERT INTO queue_test_claims (
  label,
  job_id,
  attempt_count,
  provider_idempotency_key,
  lease_token,
  lease_expires_at
)
SELECT
  'retry_job_first',
  claimed.job_id,
  claimed.attempt_count,
  claimed.provider_idempotency_key,
  claimed.lease_token,
  claimed.lease_expires_at
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-2',
  1,
  interval '5 minutes'
) claimed;

SELECT extensions.throws_ok(
  $$
    SELECT public.retry_domain_provisioning_job(
      claim.job_id,
      gen_random_uuid(),
      interval '1 second',
      'provider_timeout',
      '{}'::jsonb
    )
    FROM queue_test_claims claim
    WHERE claim.label = 'retry_job_first'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'a wrong lease token cannot schedule a retry'
);

SELECT public.retry_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  interval '1 second',
  'provider_timeout',
  jsonb_build_object('http_status', 503, 'message_code', 'upstream_timeout')
)
FROM queue_test_claims claim
WHERE claim.label = 'retry_job_first';

SELECT extensions.ok(
  (
    SELECT
      job.status = 'queued'
      AND job.run_after > job.updated_at
      AND job.lease_token IS NULL
      AND job.reconciliation_required
      AND job.reconciliation_outcome IS NULL
      AND job.reconciled_at IS NULL
      AND job.last_error = 'provider_timeout'
      AND job.provider_idempotency_key = claim.provider_idempotency_key
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_claims claim ON claim.job_id = job.id
    WHERE claim.label = 'retry_job_first'
  ),
  'retry clears the lease, preserves provider identity, and requires fresh reconciliation'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.claim_domain_provisioning_jobs(
      'queue-worker-2',
      1,
      interval '5 minutes'
    )
  ),
  0,
  'a delayed retry cannot be claimed before run_after'
);

SELECT pg_sleep(1.1);

INSERT INTO queue_test_claims (
  label,
  job_id,
  attempt_count,
  provider_idempotency_key,
  lease_token,
  lease_expires_at
)
SELECT
  'retry_job_second',
  claimed.job_id,
  claimed.attempt_count,
  claimed.provider_idempotency_key,
  claimed.lease_token,
  claimed.lease_expires_at
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-2',
  1,
  interval '5 minutes'
) claimed;

SELECT extensions.ok(
  (
    SELECT
      second.attempt_count = 2
      AND second.lease_token <> first.lease_token
      AND second.provider_idempotency_key = first.provider_idempotency_key
    FROM queue_test_claims first
    CROSS JOIN queue_test_claims second
    WHERE first.label = 'retry_job_first'
      AND second.label = 'retry_job_second'
  ),
  'a retry receives a new fencing token while retaining provider idempotency'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.cancel_domain_provisioning_job(
      second.job_id,
      first.lease_token,
      'stale_worker_cancel',
      '{}'::jsonb
    )
    FROM queue_test_claims first
    CROSS JOIN queue_test_claims second
    WHERE first.label = 'retry_job_first'
      AND second.label = 'retry_job_second'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'a stale retry token cannot cancel the current attempt'
);

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'not_found',
  jsonb_build_object('provider_status', 'absent')
)
FROM queue_test_claims claim
WHERE claim.label = 'retry_job_second';

SELECT public.cancel_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'worker_cancelled',
  '{}'::jsonb
)
FROM queue_test_claims claim
WHERE claim.label = 'retry_job_second';

SELECT extensions.ok(
  (
    SELECT
      job.status = 'cancelled'
      AND job.finished_at IS NOT NULL
      AND job.lease_token IS NULL
      AND job.last_error = 'worker_cancelled'
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_context context
      ON context.key = 'retry_job'
     AND context.uuid_value = job.id
  ),
  'a current worker token can cancel and terminalize its job'
);

INSERT INTO queue_test_context (key, uuid_value)
SELECT
  'admin_cancel_job',
  public.enqueue_domain_provisioning_job_system(
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    now(),
    'queue-admin-cancel'
  )
FROM queue_test_context domain
CROSS JOIN queue_test_context integration
WHERE domain.key = 'domain'
  AND integration.key = 'integration';

INSERT INTO queue_test_claims (
  label,
  job_id,
  attempt_count,
  provider_idempotency_key,
  lease_token,
  lease_expires_at
)
SELECT
  'admin_cancel_job_first',
  claimed.job_id,
  claimed.attempt_count,
  claimed.provider_idempotency_key,
  claimed.lease_token,
  claimed.lease_expires_at
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-before-admin-cancel',
  1,
  interval '5 minutes'
) claimed;

SELECT public.retry_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  interval '1 hour',
  'awaiting_administrator_decision',
  '{}'::jsonb
)
FROM queue_test_claims claim
WHERE claim.label = 'admin_cancel_job_first';

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);

SELECT public.cancel_queued_domain_provisioning_job(
  (SELECT uuid_value FROM queue_test_context WHERE key = 'admin_cancel_job'),
  'Superseded before the next worker attempt',
  'queue-admin-cancel-request'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'cancelled'
      AND job.attempt_count = 1
      AND job.started_at IS NOT NULL
      AND job.finished_at IS NOT NULL
      AND job.last_error = 'administrator_cancelled'
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_context context
      ON context.key = 'admin_cancel_job'
     AND context.uuid_value = job.id
  ),
  'a Creator Share administrator can cancel currently unleased queued work after a retry'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN queue_test_context context
      ON context.key = 'admin_cancel_job'
     AND event.record_pk ->> 'id' = context.uuid_value::text
    WHERE event.table_name = 'domain_provisioning_jobs'
      AND event.operation = 'UPDATE'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id = '91000000-0000-4000-8000-000000000001'::uuid
      AND event.request_id = 'queue-admin-cancel-request'
      AND event.reason = 'Superseded before the next worker attempt'
  ),
  'administrator cancellation is fully attributed in the audit ledger'
);

SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO queue_test_context (key, uuid_value)
SELECT
  'stale_job',
  public.enqueue_domain_provisioning_job_system(
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    now(),
    'queue-stale-lease'
  )
FROM queue_test_context domain
CROSS JOIN queue_test_context integration
WHERE domain.key = 'domain'
  AND integration.key = 'integration';

INSERT INTO queue_test_claims (
  label,
  job_id,
  attempt_count,
  provider_idempotency_key,
  lease_token,
  lease_expires_at
)
SELECT
  'stale_job_first',
  claimed.job_id,
  claimed.attempt_count,
  claimed.provider_idempotency_key,
  claimed.lease_token,
  claimed.lease_expires_at
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-stale-1',
  1,
  interval '5 seconds'
) claimed;

SELECT pg_sleep(5.1);

INSERT INTO queue_test_claims (
  label,
  job_id,
  attempt_count,
  provider_idempotency_key,
  lease_token,
  lease_expires_at
)
SELECT
  'stale_job_second',
  claimed.job_id,
  claimed.attempt_count,
  claimed.provider_idempotency_key,
  claimed.lease_token,
  claimed.lease_expires_at
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-stale-2',
  1,
  interval '5 minutes'
) claimed;

SELECT extensions.ok(
  (
    SELECT
      second.job_id = first.job_id
      AND second.attempt_count = 2
      AND second.lease_token <> first.lease_token
      AND second.provider_idempotency_key = first.provider_idempotency_key
    FROM queue_test_claims first
    CROSS JOIN queue_test_claims second
    WHERE first.label = 'stale_job_first'
      AND second.label = 'stale_job_second'
  ),
  'an expired lease is atomically reclaimed with a new token and stable provider key'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      second.job_id,
      first.lease_token,
      'failed',
      'stale_worker_result',
      '{}'::jsonb
    )
    FROM queue_test_claims first
    CROSS JOIN queue_test_claims second
    WHERE first.label = 'stale_job_first'
      AND second.label = 'stale_job_second'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'the expired worker is fenced out after stale lease reclaim'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'failed',
  'provider_conflict',
  jsonb_build_object('message_code', 'provider_conflict')
)
FROM queue_test_claims claim
WHERE claim.label = 'stale_job_second';

WITH inserted AS (
  INSERT INTO public.domain_provisioning_jobs (
    advocate_id,
    domain_id,
    integration_id,
    kind,
    provider,
    max_attempts,
    request_payload
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    'cloudflare',
    1,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  FROM queue_test_context advocate
  CROSS JOIN queue_test_context domain
  CROSS JOIN queue_test_context integration
  WHERE advocate.key = 'advocate'
    AND domain.key = 'domain'
    AND integration.key = 'integration'
  RETURNING id
)
INSERT INTO queue_test_context (key, uuid_value)
SELECT 'exhausted_job', id FROM inserted;

INSERT INTO queue_test_claims (
  label,
  job_id,
  attempt_count,
  provider_idempotency_key,
  lease_token,
  lease_expires_at
)
SELECT
  'exhausted_job_first',
  claimed.job_id,
  claimed.attempt_count,
  claimed.provider_idempotency_key,
  claimed.lease_token,
  claimed.lease_expires_at
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-exhausted',
  1,
  interval '5 seconds'
) claimed;

SELECT pg_sleep(5.1);

SELECT count(*)
FROM public.claim_domain_provisioning_jobs(
  'queue-worker-exhausted-recovery',
  1,
  interval '5 minutes'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'failed'
      AND job.attempt_count = job.max_attempts
      AND job.finished_at IS NOT NULL
      AND job.lease_token IS NULL
      AND job.last_error = 'lease_expired_max_attempts'
    FROM public.domain_provisioning_jobs job
    JOIN queue_test_context context
      ON context.key = 'exhausted_job'
     AND context.uuid_value = job.id
  ),
  'an expired final attempt fails closed instead of being leased again'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.domain_provisioning_jobs
    SET max_attempts = 20
    WHERE id = (
      SELECT uuid_value FROM queue_test_context WHERE key = 'exhausted_job'
    )
  $$,
  '42501',
  'Domain provisioning job tenant and input identity are immutable',
  'attempt limits cannot be raised after enqueue'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.domain_provisioning_jobs job
    WHERE job.integration_id = (
      SELECT uuid_value FROM queue_test_context WHERE key = 'integration'
    )
      AND job.status IN ('queued', 'running')
  ),
  0,
  'the test leaves no open provider actions behind'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.claim_domain_provisioning_jobs(text,integer,interval)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_domain_provisioning_jobs(text,integer,interval)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.complete_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_status,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.complete_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_status,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.renew_domain_provisioning_job_lease(uuid,uuid,interval)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.renew_domain_provisioning_job_lease(uuid,uuid,interval)',
    'EXECUTE'
  ),
  'browser roles cannot invoke worker claim or settlement functions'
);

SELECT * FROM extensions.finish();

ROLLBACK;

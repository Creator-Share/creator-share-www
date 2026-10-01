BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(31);

SELECT extensions.is(
  (
    SELECT reserved.reason
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = 'publication-sentinel'
  ),
  'Reserved for the persistent shared advocate publication negative-control hostname.',
  'the fixed publication sentinel label is migration owned'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = 'publication-sentinel'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.hostname = 'publication-sentinel.creatorshare.com'
  ),
  'the publication sentinel is never assigned to an advocate tenant'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.advocate_reserved_subdomains'::regclass
      AND trigger_definition.tgname =
        'advocate_reserved_subdomains_immutable'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'private.prevent_advocate_dictionary_mutation()'::regprocedure
  ),
  'the exact reserved registry immutability trigger is enabled'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'public.advocate_reserved_subdomains',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_reserved_subdomains',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_reserved_subdomains',
    'DELETE'
  ),
  'the application service role cannot mutate the sentinel reservation'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocate_reserved_subdomains (label, reason)
    VALUES ('another-sentinel', 'runtime mutation must fail')
  $$,
  '42501',
  'Predefined advocate dictionaries are migration owned',
  'the restored trigger rejects reserved registry inserts'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_reserved_subdomains
    SET reason = 'mutation must fail'
    WHERE label = 'publication-sentinel'
  $$,
  '42501',
  'Predefined advocate dictionaries are migration owned',
  'the restored trigger rejects sentinel mutation'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocates (slug, display_name)
    VALUES ('publication-sentinel', 'Forbidden Sentinel Tenant')
  $$,
  '23514',
  'Advocate subdomain label is reserved',
  'tenant creation cannot claim the publication sentinel label'
);

SELECT extensions.columns_are(
  'audit',
  'advocate_publication_sentinel_reconciliation_runs',
  ARRAY[
    'run_id',
    'request_reference_sha256',
    'outcome_code',
    'recorded_at'
  ],
  'sentinel run headers retain only sanitized correlation and outcome columns'
);

SELECT extensions.columns_are(
  'audit',
  'advocate_publication_sentinel_reconciliation_events',
  ARRAY[
    'event_id',
    'run_id',
    'sequence',
    'stage',
    'outcome_code',
    'recorded_at'
  ],
  'sentinel events retain only ordered fixed vocabulary evidence'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid =
      'audit.advocate_publication_sentinel_reconciliation_runs'::regclass
  )
  AND (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid =
      'audit.advocate_publication_sentinel_reconciliation_events'::regclass
  ),
  'row level security protects both sentinel evidence tables'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'audit.advocate_publication_sentinel_reconciliation_runs',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_publication_sentinel_reconciliation_events',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.advocate_publication_sentinel_reconciliation_runs',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'application roles have no direct sentinel evidence table access'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_advocate_publication_sentinel_reconciliation(uuid,text,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_advocate_publication_sentinel_reconciliation(uuid,text,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.record_advocate_publication_sentinel_reconciliation(uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'only the service role can invoke the sentinel evidence boundary'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.require_advocate_publication_sentinel_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.advocate_publication_sentinel_event_is_valid(text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.prevent_advocate_publication_sentinel_evidence_mutation()',
    'EXECUTE'
  ),
  'sentinel validation and immutability internals are not directly executable'
);

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(routine.proconfig) setting
        WHERE setting LIKE 'search_path=%'
      )
    FROM pg_proc routine
    WHERE routine.oid =
      'public.record_advocate_publication_sentinel_reconciliation(uuid,text,text,jsonb)'::regprocedure
  ),
  'the sentinel RPC is a locked security definer boundary'
);

SELECT extensions.lives_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      repeat('a', 64),
      'ready',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"ready"},
        {"sequence":2,"stage":"dns","outcome_code":"ready"},
        {"sequence":3,"stage":"tls","outcome_code":"ready"},
        {"sequence":4,"stage":"https","outcome_code":"ready"},
        {"sequence":5,"stage":"complete","outcome_code":"ready"}
      ]'::jsonb
    )
  $$,
  'valid sanitized sentinel evidence is recorded atomically'
);

SELECT extensions.is(
  (
    SELECT concat_ws(
      ':',
      run.request_reference_sha256,
      run.outcome_code
    )
    FROM audit.advocate_publication_sentinel_reconciliation_runs run
    WHERE run.run_id = '11111111-1111-4111-8111-111111111111'::uuid
  ),
  repeat('a', 64) || ':ready',
  'the run header stores only the request digest and terminal code'
);

SELECT extensions.is(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'sequence', event.sequence,
        'stage', event.stage,
        'outcome_code', event.outcome_code
      )
      ORDER BY event.sequence
    )
    FROM audit.advocate_publication_sentinel_reconciliation_events event
    WHERE event.run_id = '11111111-1111-4111-8111-111111111111'::uuid
  ),
  '[
    {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
    {"sequence":1,"stage":"vercel_lookup","outcome_code":"ready"},
    {"sequence":2,"stage":"dns","outcome_code":"ready"},
    {"sequence":3,"stage":"tls","outcome_code":"ready"},
    {"sequence":4,"stage":"https","outcome_code":"ready"},
    {"sequence":5,"stage":"complete","outcome_code":"ready"}
  ]'::jsonb,
  'the event rows preserve the exact sanitized sequence'
);

SELECT extensions.lives_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      repeat('a', 64),
      'ready',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"ready"},
        {"sequence":2,"stage":"dns","outcome_code":"ready"},
        {"sequence":3,"stage":"tls","outcome_code":"ready"},
        {"sequence":4,"stage":"https","outcome_code":"ready"},
        {"sequence":5,"stage":"complete","outcome_code":"ready"}
      ]'::jsonb
    )
  $$,
  'an exact evidence replay is idempotent'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_publication_sentinel_reconciliation_events event
    WHERE event.run_id = '11111111-1111-4111-8111-111111111111'::uuid
  ),
  6,
  'an exact replay does not duplicate event rows'
);

SELECT extensions.lives_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '88888888-8888-4888-8888-888888888888'::uuid,
      repeat('c', 64),
      'failed',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"not_found"},
        {"sequence":1,"stage":"cloudflare_apply","outcome_code":"provider_unavailable"},
        {"sequence":2,"stage":"cloudflare_verify","outcome_code":"failed"},
        {"sequence":3,"stage":"vercel_lookup","outcome_code":"blocked"},
        {"sequence":4,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  'terminal Cloudflare apply failures retain their failed verification evidence'
);

SELECT extensions.lives_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '99999999-9999-4999-8999-999999999999'::uuid,
      repeat('d', 64),
      'failed',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"not_found"},
        {"sequence":2,"stage":"vercel_apply","outcome_code":"provider_unavailable"},
        {"sequence":3,"stage":"vercel_verify","outcome_code":"failed"},
        {"sequence":4,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  'terminal Vercel apply failures retain their failed verification evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      repeat('b', 64),
      'ready',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"ready"},
        {"sequence":2,"stage":"dns","outcome_code":"ready"},
        {"sequence":3,"stage":"tls","outcome_code":"ready"},
        {"sequence":4,"stage":"https","outcome_code":"ready"},
        {"sequence":5,"stage":"complete","outcome_code":"ready"}
      ]'::jsonb
    )
  $$,
  '23505',
  'Publication sentinel run id conflicts with prior evidence',
  'a run id cannot be replayed with conflicting evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '22222222-2222-4222-8222-222222222222'::uuid,
      repeat('a', 64),
      'failed',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready","error":"secret"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"blocked"},
        {"sequence":2,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  '22023',
  'Publication sentinel evidence input is invalid',
  'unknown fields cannot smuggle raw provider evidence into the ledger'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '33333333-3333-4333-8333-333333333333'::uuid,
      repeat('a', 64),
      'failed',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":2,"stage":"vercel_lookup","outcome_code":"blocked"},
        {"sequence":3,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  '22023',
  'Publication sentinel evidence input is invalid',
  'event sequences must be contiguous from zero'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '44444444-4444-4444-8444-444444444444'::uuid,
      repeat('a', 64),
      'failed',
      '[
        {"sequence":0,"stage":"vercel_lookup","outcome_code":"blocked"},
        {"sequence":1,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":2,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  '22023',
  'Publication sentinel evidence input is invalid',
  'stages must follow the fixed operational order'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '55555555-5555-4555-8555-555555555555'::uuid,
      repeat('a', 64),
      'failed',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"apply_accepted"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"blocked"},
        {"sequence":2,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  '22023',
  'Publication sentinel evidence input is invalid',
  'stage and outcome combinations use only their fixed safe vocabulary'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '66666666-6666-4666-8666-666666666666'::uuid,
      repeat('a', 64),
      'ready',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"blocked"},
        {"sequence":2,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  '22023',
  'Publication sentinel evidence input is invalid',
  'the terminal event must exactly match the run outcome'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    SELECT public.record_advocate_publication_sentinel_reconciliation(
      '77777777-7777-4777-8777-777777777777'::uuid,
      repeat('a', 64),
      'failed',
      '[
        {"sequence":0,"stage":"cloudflare_lookup","outcome_code":"ready"},
        {"sequence":1,"stage":"vercel_lookup","outcome_code":"blocked"},
        {"sequence":2,"stage":"complete","outcome_code":"failed"}
      ]'::jsonb
    )
  $$,
  '42501',
  'permission denied for function record_advocate_publication_sentinel_reconciliation',
  'authenticated callers cannot record sentinel evidence'
);

RESET ROLE;

SELECT extensions.throws_ok(
  $$
    UPDATE audit.advocate_publication_sentinel_reconciliation_runs
    SET outcome_code = 'failed'
    WHERE run_id = '11111111-1111-4111-8111-111111111111'::uuid
  $$,
  '42501',
  'Advocate publication sentinel evidence is append only',
  'sentinel run headers cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.advocate_publication_sentinel_reconciliation_events
    WHERE run_id = '11111111-1111-4111-8111-111111111111'::uuid
  $$,
  '42501',
  'Advocate publication sentinel evidence is append only',
  'sentinel events cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE audit.advocate_publication_sentinel_reconciliation_events
  $$,
  '42501',
  'Advocate publication sentinel evidence is append only',
  'sentinel evidence cannot be truncated'
);

SELECT * FROM extensions.finish();

ROLLBACK;

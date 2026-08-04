BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)'::regprocedure
  ),
  'the reservation RPC is a locked security definer function'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)',
    'EXECUTE'
  ),
  'only the service role can execute the reservation RPC'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname =
        'advocate_invitation_authentication_attempts'
  ),
  'the short-lived attempt ledger uses forced row security'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'private.advocate_invitation_authentication_attempts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_invitation_authentication_attempts',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_invitation_authentication_attempts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.advocate_invitation_authentication_attempts',
    'SELECT'
  )
  AND NOT has_sequence_privilege(
    'service_role',
    'private.advocate_invitation_authentication_attempts_id_seq',
    'USAGE'
  ),
  'runtime roles have no direct attempt-ledger or identity-sequence access'
);

SELECT extensions.is(
  (
    SELECT array_agg(
      column_definition.column_name::text
      ORDER BY column_definition.ordinal_position
    )
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name =
        'advocate_invitation_authentication_attempts'
  ),
  ARRAY['id', 'source_digest', 'source_hmac_key_version', 'attempted_at'],
  'the ledger contains only an opaque source digest, its key version, and timing metadata'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name =
        'advocate_invitation_authentication_attempts'
      AND column_definition.column_name ~
        '(ip|token|capability|user|email|contact|recipient)'
  ),
  'the ledger cannot store raw network, proof, capability, identity, or contact fields'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)'::regprocedure
  ) LIKE '%pg_advisory_xact_lock(1129530707, 1800)%'
  AND pg_get_functiondef(
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)'::regprocedure
  ) LIKE '%interval ''10 minutes''%'
  AND pg_get_functiondef(
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)'::regprocedure
  ) LIKE '%>= 20%'
  AND pg_get_functiondef(
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)'::regprocedure
  ) LIKE '%>= 100%'
  AND pg_get_functiondef(
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)'::regprocedure
  ) LIKE '%>= 300%'
  AND pg_get_functiondef(
    'public.reserve_advocate_invitation_authentication_attempt(bytea,smallint)'::regprocedure
  ) LIKE '%>= 1500%',
  'source and global quota windows share one atomic transaction lock'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.purge_expired_sponsor_authentication_evidence(integer)'::regprocedure
  ) LIKE '%private.advocate_invitation_authentication_attempts%'
  AND pg_get_functiondef(
    'private.data_retention_backlog(text)'::regprocedure
  ) LIKE '%private.advocate_invitation_authentication_attempts%'
  AND pg_get_functiondef(
    'public.run_data_retention_step(uuid,text,integer,text,text)'::regprocedure
  ) LIKE '%advocate_invitation_authentication_attempts_deleted%'
  AND private.data_retention_zero_counts('sponsor_authentication') ?
    'advocate_invitation_authentication_attempts_deleted',
  'the hourly durable retention step purges, reports, and monitors quiet-traffic backlog'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('11', 32), 'hex'),
      1::smallint
    )
  $$,
  '42501',
  'permission denied for function reserve_advocate_invitation_authentication_attempt',
  'anonymous callers cannot reserve authentication capacity'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('11', 32), 'hex'),
      1::smallint
    )
  $$,
  '42501',
  'Advocate invitation authentication reservation is not authorized',
  'the RPC also verifies the signed service-role claim'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('11', 31), 'hex'),
      1::smallint
    )
  $$,
  '22023',
  'Advocate invitation authentication reservation is invalid',
  'the RPC rejects a digest that is not exactly 32 bytes'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('11', 32), 'hex'),
      2::smallint
    )
  $$,
  '22023',
  'Advocate invitation authentication reservation is invalid',
  'the RPC accepts only the deployed purpose-specific HMAC key version'
);

RESET ROLE;
TRUNCATE private.advocate_invitation_authentication_attempts;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT authentication_allowed
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('21', 32), 'hex'),
      1::smallint
    )
  ),
  true,
  'an available source receives one exact allowed decision'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.advocate_invitation_authentication_attempts
  ),
  1,
  'an allowed decision records one opaque attempt'
);

TRUNCATE private.advocate_invitation_authentication_attempts;
INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
)
SELECT
  decode(repeat('31', 32), 'hex'),
  1,
  clock_timestamp() - interval '1 minute'
FROM generate_series(1, 20);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT authentication_allowed
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('31', 32), 'hex'),
      1::smallint
    )
  ),
  false,
  'the twentieth source attempt in ten minutes exhausts the short source window'
);

SELECT extensions.is(
  (
    SELECT authentication_allowed
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('32', 32), 'hex'),
      1::smallint
    )
  ),
  true,
  'a different source remains available below the global window'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.advocate_invitation_authentication_attempts
    WHERE source_digest = decode(repeat('31', 32), 'hex')
  ),
  20,
  'a denied source attempt records no additional row'
);

TRUNCATE private.advocate_invitation_authentication_attempts;
INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
)
SELECT
  decode(repeat('41', 32), 'hex'),
  1,
  clock_timestamp() - interval '2 hours'
FROM generate_series(1, 100);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT authentication_allowed
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('41', 32), 'hex'),
      1::smallint
    )
  ),
  false,
  'the hundredth source attempt exhausts the daily source window'
);

RESET ROLE;
TRUNCATE private.advocate_invitation_authentication_attempts;
INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
)
SELECT
  decode(lpad(to_hex(attempt_number), 64, '0'), 'hex'),
  1,
  clock_timestamp() - interval '5 minutes'
FROM generate_series(1, 300) attempt_number;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT authentication_allowed
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('51', 32), 'hex'),
      1::smallint
    )
  ),
  false,
  'the three hundredth recent attempt exhausts the global hourly window'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.advocate_invitation_authentication_attempts
  ),
  300,
  'a global hourly denial records no additional row'
);

TRUNCATE private.advocate_invitation_authentication_attempts;
INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
)
SELECT
  decode(lpad(to_hex(attempt_number), 64, '0'), 'hex'),
  1,
  clock_timestamp() - interval '2 hours'
FROM generate_series(1, 1500) attempt_number;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT authentication_allowed
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('61', 32), 'hex'),
      1::smallint
    )
  ),
  false,
  'the fifteen hundredth retained attempt exhausts the global daily window'
);

RESET ROLE;
TRUNCATE private.advocate_invitation_authentication_attempts;
INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
) VALUES (
  decode(repeat('71', 32), 'hex'),
  1,
  clock_timestamp() - interval '25 hours'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT authentication_allowed
    FROM public.reserve_advocate_invitation_authentication_attempt(
      decode(repeat('72', 32), 'hex'),
      1::smallint
    )
  ),
  true,
  'expired evidence never consumes active quota capacity'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.advocate_invitation_authentication_attempts
  ),
  1,
  'each reservation deletes evidence beyond the complete 24-hour quota horizon'
);

SELECT * FROM extensions.finish();

ROLLBACK;

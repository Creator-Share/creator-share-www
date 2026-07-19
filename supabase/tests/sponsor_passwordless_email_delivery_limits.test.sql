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
      'public.reserve_sponsor_passwordless_email_delivery(bytea,smallint,smallint,bytea,smallint,text,text,text)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.reserve_sponsor_passwordless_email_verification_attempt(bytea,smallint,text,text)'::regprocedure
  ),
  'delivery and verification reservations are locked security definer functions'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.reserve_sponsor_passwordless_email_delivery(bytea,smallint,smallint,bytea,smallint,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.reserve_sponsor_passwordless_email_verification_attempt(bytea,smallint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reserve_sponsor_passwordless_email_delivery(bytea,smallint,smallint,bytea,smallint,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reserve_sponsor_passwordless_email_verification_attempt(bytea,smallint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reserve_sponsor_passwordless_email_delivery(bytea,smallint,smallint,bytea,smallint,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reserve_sponsor_passwordless_email_verification_attempt(bytea,smallint,text,text)',
    'EXECUTE'
  ),
  'only the service role can invoke either reservation boundary'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'private.sponsor_passwordless_email_delivery_reservations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.sponsor_passwordless_email_verification_attempts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.sponsor_passwordless_email_delivery_reservations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.sponsor_passwordless_email_verification_attempts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.sponsor_passwordless_email_delivery_reservations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.sponsor_passwordless_email_verification_attempts',
    'SELECT'
  ),
  'reservation evidence has no runtime table grants'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname =
        'sponsor_passwordless_email_delivery_reservations'
  )
  AND (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname =
        'sponsor_passwordless_email_verification_attempts'
  ),
  'both reservation ledgers use forced row security'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name IN (
        'sponsor_passwordless_email_delivery_reservations',
        'sponsor_passwordless_email_verification_attempts'
      )
      AND column_definition.column_name IN (
        'email',
        'recipient_email',
        'ip',
        'client_ip',
        'source_ip',
        'token',
        'token_hash'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name =
        'sponsor_passwordless_email_verification_attempts'
      AND column_definition.column_name LIKE '%recipient%'
  ),
  'the ledgers contain no raw contact, network, or token material'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('21', 32), 'hex'),
      1::smallint,
      'generic-sign-in',
      '71000000-0000-4000-8000-000000000001',
      NULL
    )
  $$,
  '42501',
  'permission denied for function reserve_sponsor_passwordless_email_delivery',
  'anonymous callers cannot reserve email delivery'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_sponsor_passwordless_email_verification_attempt(
      decode(repeat('21', 32), 'hex'),
      1::smallint,
      '71000000-0000-4000-8000-000000000002',
      NULL
    )
  $$,
  '42501',
  'permission denied for function reserve_sponsor_passwordless_email_verification_attempt',
  'anonymous callers cannot reserve token verification'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_delivery_reservations;

INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
VALUES (
  decode(repeat('31', 32), 'hex'),
  1,
  1,
  decode(repeat('32', 32), 'hex'),
  1,
  'registration',
  clock_timestamp(),
  clock_timestamp() + interval '60 seconds',
  '71000000-0000-4000-8000-000000000003'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('31', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('33', 32), 'hex'),
      1::smallint,
      'reauthentication',
      '71000000-0000-4000-8000-000000000004',
      'sfo1::protected-capacity'
    )
  ),
  true,
  'a public single flight cannot suppress protected reauthentication delivery'
);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('31', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('34', 32), 'hex'),
      1::smallint,
      'generic-sign-in',
      '71000000-0000-4000-8000-000000000005',
      NULL
    )
  ),
  false,
  'a protected single flight still suppresses lower-priority public delivery'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_delivery_reservations;

INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  decode(repeat('41', 32), 'hex'),
  1,
  1,
  extensions.digest('public-recipient-source:' || series.value::text, 'sha256'),
  1,
  CASE WHEN series.value = 1 THEN 'generic-sign-in' ELSE 'registration' END,
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute',
  gen_random_uuid()::text
FROM generate_series(1, 2) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('41', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('42', 32), 'hex'),
      1::smallint,
      'generic-sign-in',
      '71000000-0000-4000-8000-000000000006',
      NULL
    )
  ),
  false,
  'public sign-in and registration share the lower recipient pool'
);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('41', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('43', 32), 'hex'),
      1::smallint,
      'initial-claim',
      '71000000-0000-4000-8000-000000000007',
      NULL
    )
  ),
  true,
  'public recipient exhaustion preserves capacity for a validated initial claim'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_delivery_reservations;

INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  extensions.digest('public-source-recipient:' || series.value::text, 'sha256'),
  1,
  1,
  decode(repeat('51', 32), 'hex'),
  1,
  CASE WHEN series.value % 2 = 0 THEN 'registration' ELSE 'generic-sign-in' END,
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute',
  gen_random_uuid()::text
FROM generate_series(1, 20) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('52', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('51', 32), 'hex'),
      1::smallint,
      'registration',
      '71000000-0000-4000-8000-000000000008',
      NULL
    )
  ),
  false,
  'the public source pool suppresses a public recipient spray'
);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('53', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('51', 32), 'hex'),
      1::smallint,
      'account-claim',
      '71000000-0000-4000-8000-000000000009',
      NULL
    )
  ),
  true,
  'public source exhaustion preserves capacity for a validated account claim'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_delivery_reservations;

INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  extensions.digest('public-global-recipient:' || series.value::text, 'sha256'),
  1,
  1,
  extensions.digest('public-global-source:' || series.value::text, 'sha256'),
  1,
  CASE WHEN series.value % 2 = 0 THEN 'registration' ELSE 'generic-sign-in' END,
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute',
  gen_random_uuid()::text
FROM generate_series(1, 700) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('61', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('62', 32), 'hex'),
      1::smallint,
      'generic-sign-in',
      '71000000-0000-4000-8000-000000000010',
      NULL
    )
  ),
  false,
  'the public global hourly pool closes independently'
);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('63', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('64', 32), 'hex'),
      1::smallint,
      'reauthentication',
      '71000000-0000-4000-8000-000000000011',
      NULL
    )
  ),
  true,
  'public global exhaustion preserves protected reauthentication capacity'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_delivery_reservations;

INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  extensions.digest('hard-global-recipient:' || series.value::text, 'sha256'),
  1,
  1,
  extensions.digest('hard-global-source:' || series.value::text, 'sha256'),
  1,
  CASE
    WHEN series.value <= 700 THEN 'generic-sign-in'
    ELSE 'reauthentication'
  END,
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute',
  gen_random_uuid()::text
FROM generate_series(1, 1000) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('71', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('72', 32), 'hex'),
      1::smallint,
      'initial-claim',
      '71000000-0000-4000-8000-000000000012',
      NULL
    )
  ),
  false,
  'the unchanged hard provider ceiling still applies to protected delivery'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_delivery_reservations;

INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  decode(repeat('73', 32), 'hex'),
  1,
  1,
  extensions.digest('public-daily-source:' || series.value::text, 'sha256'),
  1,
  CASE WHEN series.value % 2 = 0 THEN 'registration' ELSE 'generic-sign-in' END,
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '119 minutes',
  gen_random_uuid()::text
FROM generate_series(1, 6) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('73', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('74', 32), 'hex'),
      1::smallint,
      'registration',
      '71000000-0000-4000-8000-000000000018',
      NULL
    )
  ),
  false,
  'the public recipient daily pool closes outside the short window'
);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('73', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('75', 32), 'hex'),
      1::smallint,
      'account-claim',
      '71000000-0000-4000-8000-000000000019',
      NULL
    )
  ),
  true,
  'public recipient daily exhaustion preserves validated claim capacity'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_delivery_reservations;

INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  extensions.digest('public-daily-recipient:' || series.value::text, 'sha256'),
  1,
  1,
  extensions.digest('public-daily-global-source:' || series.value::text, 'sha256'),
  1,
  CASE WHEN series.value % 2 = 0 THEN 'registration' ELSE 'generic-sign-in' END,
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '119 minutes',
  gen_random_uuid()::text
FROM generate_series(1, 3500) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('76', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('77', 32), 'hex'),
      1::smallint,
      'generic-sign-in',
      '71000000-0000-4000-8000-000000000020',
      NULL
    )
  ),
  false,
  'the public global daily pool closes outside the hourly window'
);

SELECT extensions.is(
  (
    SELECT delivery_allowed
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('78', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('79', 32), 'hex'),
      1::smallint,
      'reauthentication',
      '71000000-0000-4000-8000-000000000021',
      NULL
    )
  ),
  true,
  'public global daily exhaustion preserves protected capacity'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_sponsor_passwordless_email_delivery(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      decode(repeat('21', 32), 'hex'),
      1::smallint,
      'unknown-flow',
      '71000000-0000-4000-8000-000000000013',
      NULL
    )
  $$,
  '22023',
  'Sponsor passwordless delivery reservation is invalid',
  'unknown delivery flows fail closed'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_verification_attempts;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT verification_allowed
    FROM public.reserve_sponsor_passwordless_email_verification_attempt(
      decode(repeat('81', 32), 'hex'),
      1::smallint,
      '71000000-0000-4000-8000-000000000014',
      'sfo1::verification-test'
    )
  ),
  true,
  'the first privacy-safe verification attempt is reserved'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_verification_attempts;

INSERT INTO private.sponsor_passwordless_email_verification_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at,
  request_id
)
SELECT
  decode(repeat('82', 32), 'hex'),
  1,
  clock_timestamp() - interval '2 minutes',
  gen_random_uuid()::text
FROM generate_series(1, 30);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT verification_allowed
    FROM public.reserve_sponsor_passwordless_email_verification_attempt(
      decode(repeat('82', 32), 'hex'),
      1::smallint,
      '71000000-0000-4000-8000-000000000015',
      NULL
    )
  ),
  false,
  'the verification source ceiling suppresses repeated token guesses'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_verification_attempts;

INSERT INTO private.sponsor_passwordless_email_verification_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at,
  request_id
)
SELECT
  extensions.digest('verification-global-source:' || series.value::text, 'sha256'),
  1,
  clock_timestamp() - interval '2 minutes',
  gen_random_uuid()::text
FROM generate_series(1, 600) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT verification_allowed
    FROM public.reserve_sponsor_passwordless_email_verification_attempt(
      decode(repeat('83', 32), 'hex'),
      1::smallint,
      '71000000-0000-4000-8000-000000000016',
      NULL
    )
  ),
  false,
  'the verification global hourly ceiling suppresses distributed guesses'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_verification_attempts;

INSERT INTO private.sponsor_passwordless_email_verification_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at,
  request_id
)
SELECT
  decode(repeat('84', 32), 'hex'),
  1,
  clock_timestamp() - interval '2 hours',
  gen_random_uuid()::text
FROM generate_series(1, 200);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT verification_allowed
    FROM public.reserve_sponsor_passwordless_email_verification_attempt(
      decode(repeat('84', 32), 'hex'),
      1::smallint,
      '71000000-0000-4000-8000-000000000022',
      NULL
    )
  ),
  false,
  'the verification source daily ceiling applies outside the short window'
);

RESET ROLE;
TRUNCATE private.sponsor_passwordless_email_verification_attempts;

INSERT INTO private.sponsor_passwordless_email_verification_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at,
  request_id
)
SELECT
  extensions.digest('verification-daily-source:' || series.value::text, 'sha256'),
  1,
  clock_timestamp() - interval '2 hours',
  gen_random_uuid()::text
FROM generate_series(1, 3000) AS series(value);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT verification_allowed
    FROM public.reserve_sponsor_passwordless_email_verification_attempt(
      decode(repeat('85', 32), 'hex'),
      1::smallint,
      '71000000-0000-4000-8000-000000000023',
      NULL
    )
  ),
  false,
  'the verification global daily ceiling applies outside the hourly window'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_sponsor_passwordless_email_verification_attempt(
      decode('86', 'hex'),
      1::smallint,
      '71000000-0000-4000-8000-000000000017',
      NULL
    )
  $$,
  '22023',
  'Sponsor passwordless verification reservation is invalid',
  'malformed verification source digests fail closed'
);

RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;

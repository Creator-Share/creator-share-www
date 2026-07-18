BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.read_primary_public_beneficiary_catalog_page(text[],text,text[],integer,integer,text,integer,integer,integer,timestamp with time zone,uuid)'::regprocedure),
        ('public.read_public_advocate_beneficiary_catalog_page(text,text[],text,text[],integer,integer,text,integer,integer,integer,timestamp with time zone,uuid)'::regprocedure),
        ('public.read_primary_public_beneficiary_by_username(text)'::regprocedure),
        ('public.read_public_advocate_beneficiary_by_username(text,text)'::regprocedure),
        ('public.read_primary_public_beneficiary_media_by_id(uuid)'::regprocedure),
        ('public.read_public_advocate_beneficiary_media_by_id(text,uuid)'::regprocedure),
        ('public.read_primary_public_beneficiary_activities_by_id(uuid)'::regprocedure),
        ('public.read_public_advocate_beneficiary_activities_by_id(text,uuid)'::regprocedure)
    ) AS catalog_function(signature)
    WHERE NOT has_function_privilege(
        'service_role',
        catalog_function.signature,
        'EXECUTE'
      )
      OR has_function_privilege(
        'anon',
        catalog_function.signature,
        'EXECUTE'
      )
      OR has_function_privilege(
        'authenticated',
        catalog_function.signature,
        'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
        FROM information_schema.routine_privileges privilege
        JOIN pg_proc function_definition
          ON function_definition.proname = privilege.routine_name
        JOIN pg_namespace function_namespace
          ON function_namespace.oid = function_definition.pronamespace
         AND function_namespace.nspname = privilege.routine_schema
        WHERE function_definition.oid = catalog_function.signature
          AND privilege.grantee = 'PUBLIC'
          AND privilege.privilege_type = 'EXECUTE'
      )
  ),
  'every public catalog and purpose-specific deep RPC is executable only by the service role'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.read_primary_public_beneficiary_catalog_page(text[],text,text[],integer,integer,text,integer,integer,integer,timestamp with time zone,uuid)'::regprocedure),
        ('public.read_public_advocate_beneficiary_catalog_page(text,text[],text,text[],integer,integer,text,integer,integer,integer,timestamp with time zone,uuid)'::regprocedure),
        ('public.read_primary_public_beneficiary_by_username(text)'::regprocedure),
        ('public.read_public_advocate_beneficiary_by_username(text,text)'::regprocedure),
        ('public.read_primary_public_beneficiary_media_by_id(uuid)'::regprocedure),
        ('public.read_public_advocate_beneficiary_media_by_id(text,uuid)'::regprocedure),
        ('public.read_primary_public_beneficiary_activities_by_id(uuid)'::regprocedure),
        ('public.read_public_advocate_beneficiary_activities_by_id(text,uuid)'::regprocedure)
    ) AS catalog_function(signature)
    JOIN pg_proc function_definition
      ON function_definition.oid = catalog_function.signature
    WHERE function_definition.prosecdef
      OR function_definition.provolatile <> 's'
      OR coalesce(
        array_to_string(function_definition.proconfig, ','),
        ''
      ) <> 'search_path=""'
  ),
  'every public catalog and purpose-specific deep RPC is stable, invoker scoped, and has an empty search path'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('private.is_beneficiary_canonically_sponsorable(public."PersonStatus",integer,timestamp with time zone)'::regprocedure),
        ('private.is_public_beneficiary_projection_safe(text,text,text,text,text,text,text,text)'::regprocedure),
        ('private.is_public_media_projection_safe(text,text)'::regprocedure),
        ('private.is_public_activity_projection_safe(text,text,text)'::regprocedure),
        ('private.validate_public_beneficiary_catalog_request(text[],text,text[],integer,integer,text,integer,integer,integer,timestamp with time zone,uuid)'::regprocedure),
        ('private.resolve_primary_public_beneficiary_identifier(text,uuid)'::regprocedure),
        ('private.resolve_public_advocate_beneficiary_identifier(text,text,uuid)'::regprocedure),
        ('private.build_public_beneficiary_projection(uuid,boolean,integer)'::regprocedure),
        ('private.build_public_beneficiary_media_projection(uuid)'::regprocedure),
        ('private.build_public_beneficiary_activities_projection(uuid)'::regprocedure)
    ) AS helper(signature)
    WHERE NOT has_function_privilege('service_role', helper.signature, 'EXECUTE')
      OR has_function_privilege('anon', helper.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', helper.signature, 'EXECUTE')
  ),
  'catalog helpers expose exactly the service role execution boundary'
);

SELECT extensions.ok(
  pg_get_viewdef('public.public_media'::regclass, true)
    LIKE '%private.public_media_storage_object_exists%'
  AND (
    SELECT
      function_definition.prosecdef
      AND function_definition.proconfig = ARRAY['search_path=""']::text[]
      AND function_definition.prosrc LIKE '%storage.objects%'
      AND function_definition.prosrc LIKE '%bucket_id = ''media''%'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.public_media_storage_object_exists(uuid,public.media_type,uuid,text)'::regprocedure
  )
  AND has_function_privilege(
    'anon',
    'private.public_media_storage_object_exists(uuid,public.media_type,uuid,text)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'private.public_media_storage_object_exists(uuid,public.media_type,uuid,text)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'private.public_media_storage_object_exists(uuid,public.media_type,uuid,text)'::regprocedure,
    'EXECUTE'
  ),
  'the public media view uses a private fixed-bucket existence check that exposes no storage metadata'
);

SELECT extensions.ok(
  private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'safe-username',
    E'Allowed\nbiography',
    'Tanzania',
    'Arusha',
    'https://example.test/video',
    E'Allowed\tintroduction',
    'IN_OUR_CARE'
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    E'Unsafe\001Name',
    'safe-username',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'checkout',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    '..',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'safe-username',
    repeat('😀', 25001),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'safe-username',
    NULL,
    repeat('c', 301),
    NULL,
    NULL,
    NULL,
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'safe-username',
    NULL,
    NULL,
    E'Unsafe\nlocation',
    NULL,
    NULL,
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'safe-username',
    NULL,
    NULL,
    NULL,
    repeat('v', 4097),
    NULL,
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'safe-username',
    NULL,
    NULL,
    NULL,
    NULL,
    E'Unsafe\001introduction',
    NULL
  )
  AND NOT private.is_public_beneficiary_projection_safe(
    'Safe Name',
    'safe-username',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'lowercase-type'
  )
  AND private.is_public_media_projection_safe('webp', 'IMAGE')
  AND NOT private.is_public_media_projection_safe('bad/ext', 'IMAGE')
  AND private.is_public_activity_projection_safe(
    E'Allowed\ntitle',
    E'Allowed\tdescription',
    'UPDATE'
  )
  AND NOT private.is_public_activity_projection_safe(
    E'Unsafe\001title',
    NULL,
    'INFO'
  ),
  'public projection helpers align text byte limits, control handling, URI safety, and public enum shapes'
);

SELECT extensions.is(
  public.read_public_advocate_beneficiary_catalog_page(
    'unknowncatalog.creatorshare.com'
  ),
  NULL::jsonb,
  'an unknown advocate host returns null and never falls back to the primary catalog'
);

SELECT extensions.is(
  public.read_public_advocate_beneficiary_media_by_id(
    'unknowncatalog.creatorshare.com',
    '10000000-0000-4000-8000-000000000001'::uuid
  ),
  NULL::jsonb,
  'an unknown advocate host returns no purpose-specific deep projection'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_public_advocate_beneficiary_catalog_page(
      'UnknownCatalog.creatorshare.com'
    )
  $$,
  '22023',
  'Invalid advocate hostname',
  'advocate host matching is canonical and case exact'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_primary_public_beneficiary_by_username('path/segment')
  $$,
  '22023',
  'Invalid beneficiary username',
  'purpose-specific deep reads reject usernames that can alter URL structure'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_primary_public_beneficiary_by_username('checkout')
  $$,
  '22023',
  'Invalid beneficiary username',
  'purpose-specific deep reads reject usernames reserved by static routes'
);

CREATE TEMP TABLE catalog_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO public.beneficiaries (
  id,
  created_at,
  name,
  username,
  birth_date,
  budget_goal,
  status,
  beneficiary_type,
  goal_fulfilled_at
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '2026-01-09 00:00:00+00',
    'Catalog Fixture Alpha',
    'catalog-fixture-alpha',
    '2012-01-01',
    5000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '2026-01-08 00:00:00+00',
    'Catalog Fixture Beta',
    'catalog-fixture-beta',
    '2013-01-01',
    6000,
    'Partially Funded',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '2026-01-07 00:00:00+00',
    'Catalog Fixture Gamma',
    'catalog-fixture-gamma',
    '2014-01-01',
    7000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '2026-01-06 00:00:00+00',
    'Catalog Fixture Open Cancelled',
    'catalog-fixture-open-cancelled',
    NULL,
    -1,
    'Sponsorship Cancelled',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    '2026-01-05 00:00:00+00',
    'Catalog Fixture Literal %_(), Search',
    'catalog-fixture-literal',
    '2015-01-01',
    8000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    '2026-01-04 00:00:00+00',
    'Catalog Fixture Fulfillment Evidence',
    'catalog-fixture-fulfillment-evidence',
    '2011-01-01',
    9000,
    'New',
    'IN_OUR_CARE',
    '2026-01-03 00:00:00+00'
  ),
  (
    '10000000-0000-4000-8000-000000000007',
    '2026-01-03 00:00:00+00',
    'Catalog Fixture Supported',
    'catalog-fixture-supported',
    '2010-01-01',
    10000,
    'Budget Fulfilled',
    'IN_OUR_CARE',
    '2026-01-02 00:00:00+00'
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    '2026-01-02 00:00:00+00',
    'Catalog Fixture Draft',
    'catalog-fixture-draft',
    '2016-01-01',
    11000,
    'Draft',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000009',
    '2026-01-01 00:00:00+00',
    'Catalog Fixture Fixed Cancelled',
    'catalog-fixture-fixed-cancelled',
    '2017-01-01',
    12000,
    'Sponsorship Cancelled',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000010',
    '2025-12-31 00:00:00+00',
    'Legacy Projection Family',
    'legacy-projection-family',
    '2011-01-01',
    13000,
    'New',
    'FAMILY',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000011',
    '2025-12-30 00:00:00+00',
    'Legacy Projection Null Type',
    'legacy-projection-null-type',
    '2012-01-01',
    14000,
    'New',
    NULL,
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000012',
    '2025-12-29 00:00:00+00',
    NULL,
    'legacy-projection-incomplete',
    '2013-01-01',
    15000,
    'New',
    'STREET_INVOLVED',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000014',
    '2025-12-27 00:00:00+00',
    'Checkout Floor Fixture',
    'checkout-floor-fixture',
    '2013-01-01',
    499,
    'New',
    'IN_OUR_CARE',
    NULL
  );

INSERT INTO public.beneficiaries (
  id,
  created_at,
  name,
  username,
  biography,
  budget_goal,
  status,
  beneficiary_type
)
VALUES (
  '10000000-0000-4000-8000-000000000026',
  '2025-12-19 00:00:00+00',
  'Projection Shape Poison',
  'projection-shape-poison',
  E'Unsafe\001biography',
  16000,
  'New',
  'IN_OUR_CARE'
);

ALTER TABLE public.beneficiaries
DISABLE TRIGGER beneficiary_username_public_shape_guard;

INSERT INTO public.beneficiaries (
  id,
  created_at,
  name,
  username,
  birth_date,
  budget_goal,
  status,
  beneficiary_type,
  goal_fulfilled_at
)
VALUES
  (
    '10000000-0000-4000-8000-000000000013',
    '2025-12-28 00:00:00+00',
    'Legacy Username Bound',
    repeat('u', 161),
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000015',
    '2025-12-26 00:00:00+00',
    'Legacy Username Padded',
    ' padded-legacy',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000016',
    '2025-12-25 00:00:00+00',
    'Legacy Username Control',
    E'control\nlegacy',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000020',
    '2025-12-24 00:00:00+00',
    'Legacy Username Nonbreaking Space',
    U&'padded\00A0',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000021',
    '2025-12-23 00:00:00+00',
    'Legacy Username Byte Order Mark',
    U&'\FEFFpadded',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000022',
    '2025-12-22 00:00:00+00',
    'Legacy Username C1 Control',
    U&'control\0085legacy',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000023',
    '2025-12-21 00:00:00+00',
    'Legacy Username Astral',
    repeat(U&'\+01F600', 100),
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000024',
    '2025-12-20 00:00:00+00',
    'Legacy Username Reserved Path',
    'path/legacy',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000027',
    '2025-12-18 00:00:00+00',
    'Legacy Username Dot Segment',
    '..',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000028',
    '2025-12-17 00:00:00+00',
    'Legacy Username Static Route',
    'checkout',
    '2013-01-01',
    16000,
    'New',
    'IN_OUR_CARE',
    NULL
  );

ALTER TABLE public.beneficiaries
ENABLE TRIGGER beneficiary_username_public_shape_guard;

SELECT extensions.ok(
  (
    SELECT
      NOT trigger_definition.tgisinternal
      AND pg_get_triggerdef(trigger_definition.oid)
        LIKE '%BEFORE INSERT OR UPDATE OF username%'
      AND function_definition.prosecdef IS FALSE
      AND function_definition.proconfig = ARRAY['search_path=""']::text[]
      AND function_definition.prosrc
        LIKE '%^[A-Za-z0-9._~-]{1,160}$%'
      AND function_definition.prosrc LIKE '%checkout%'
    FROM pg_trigger trigger_definition
    JOIN pg_proc function_definition
      ON function_definition.oid = trigger_definition.tgfoid
    WHERE trigger_definition.tgrelid = 'public.beneficiaries'::regclass
      AND trigger_definition.tgname =
        'beneficiary_username_public_shape_guard'
  ),
  'the username trigger guards inserts and explicit username changes without attaching to unrelated legacy updates'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.beneficiaries (id, name, username)
    VALUES (
      '10000000-0000-4000-8000-000000000017',
      'Future Padded Username',
      ' future-padded'
    )
  $$,
  '23514',
  'Beneficiary username is not URI safe',
  'future padded usernames are rejected at the database boundary'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.beneficiaries (id, name, username)
    VALUES (
      '10000000-0000-4000-8000-000000000018',
      'Future Control Username',
      E'future\ncontrol'
    )
  $$,
  '23514',
  'Beneficiary username is not URI safe',
  'future control characters in usernames are rejected at the database boundary'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.beneficiaries (id, name, username)
    VALUES (
      '10000000-0000-4000-8000-000000000019',
      'Future Long Username',
      repeat('u', 161)
    )
  $$,
  '23514',
  'Beneficiary username is not URI safe',
  'future oversized usernames are rejected at the database boundary'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.beneficiaries (id, name, username)
    VALUES (
      '10000000-0000-4000-8000-000000000025',
      'Future Reserved Username',
      'path/future'
    )
  $$,
  '23514',
  'Beneficiary username is not URI safe',
  'future URL-reserved usernames are rejected at the database boundary'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.beneficiaries (id, name, username)
    VALUES (
      '10000000-0000-4000-8000-000000000029',
      'Future Dot Segment Username',
      '..'
    )
  $$,
  '23514',
  'Beneficiary username is not URI safe',
  'future dot segment usernames are rejected at the database boundary'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.beneficiaries (id, name, username)
    VALUES (
      '10000000-0000-4000-8000-000000000030',
      'Future Static Route Username',
      'CHECKOUT'
    )
  $$,
  '23514',
  'Beneficiary username is not URI safe',
  'future static route usernames are rejected case insensitively at the database boundary'
);

UPDATE public.beneficiaries
SET budget_raised = 1
WHERE id = '10000000-0000-4000-8000-000000000013';

SELECT extensions.is(
  (
    SELECT budget_raised
    FROM public.beneficiaries
    WHERE id = '10000000-0000-4000-8000-000000000013'
  ),
  1,
  'unrelated financial updates remain possible for legacy malformed username rows'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.beneficiaries
    SET username = 'future/path'
    WHERE id = '10000000-0000-4000-8000-000000000014'
  $$,
  '23514',
  'Beneficiary username is not URI safe',
  'an explicit unsafe username update is rejected at the database boundary'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status,
    beneficiary_mode
  )
  VALUES
    ('catalogall', 'Catalog All', 'active', 'draft', 'all'),
    ('catalogfeatured', 'Catalog Featured', 'active', 'draft', 'all_featured'),
    ('catalogselected', 'Catalog Selected', 'active', 'draft', 'selected')
  RETURNING id, slug
)
INSERT INTO catalog_test_ids (key, value)
SELECT 'advocate:' || slug, id
FROM inserted;

INSERT INTO public.advocate_branding (advocate_id)
SELECT value
FROM catalog_test_ids
WHERE key LIKE 'advocate:%';

UPDATE public.advocates
SET publication_status = 'provisioning'
WHERE id IN (
  SELECT value
  FROM catalog_test_ids
  WHERE key LIKE 'advocate:%'
);

UPDATE public.advocates
SET publication_status = 'active'
WHERE id IN (
  SELECT value
  FROM catalog_test_ids
  WHERE key LIKE 'advocate:%'
);

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    value,
    substring(key from 10) || '.creatorshare.com',
    true
  FROM catalog_test_ids
  WHERE key LIKE 'advocate:%'
  RETURNING id, advocate_id
)
INSERT INTO catalog_test_ids (key, value)
SELECT 'domain:' || advocate.slug, inserted.id
FROM inserted
JOIN public.advocates advocate
  ON advocate.id = inserted.advocate_id;

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.value,
  domain.value,
  required.provider::public.advocate_domain_integration_provider,
  required.environment
FROM catalog_test_ids advocate
JOIN catalog_test_ids domain
  ON domain.key = replace(advocate.key, 'advocate:', 'domain:')
CROSS JOIN (
  VALUES
    ('cloudflare', 'production'),
    ('vercel', 'production'),
    ('stripe_us', 'live'),
    ('stripe_uk', 'live'),
    ('paypal', 'live')
) AS required(provider, environment)
WHERE advocate.key LIKE 'advocate:%';

SELECT extensions.is(
  public.read_public_advocate_beneficiary_catalog_page(
    'catalogall.creatorshare.com'
  ),
  NULL::jsonb,
  'a known domain remains private until every activation signal is settled'
);

CREATE OR REPLACE FUNCTION pg_temp.activate_catalog_test_domain(
  target_domain_id uuid,
  worker_id text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_claim record;
  v_evidence jsonb;
  v_hostname text;
  v_completed integer := 0;
BEGIN
  SELECT domain.hostname
  INTO v_hostname
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id;

  IF v_hostname IS NULL THEN
    RAISE EXCEPTION 'Test advocate domain is missing';
  END IF;

  PERFORM public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'provision',
    clock_timestamp(),
    worker_id || ':' || integration.provider::text
  )
  FROM public.advocate_domain_integrations integration
  WHERE integration.domain_id = target_domain_id;

  FOR v_claim IN
    SELECT *
    FROM public.claim_domain_provisioning_jobs(
      worker_id,
      5,
      interval '10 minutes'
    )
  LOOP
    IF v_claim.domain_id IS DISTINCT FROM target_domain_id THEN
      RAISE EXCEPTION 'Test worker claimed an unrelated domain job';
    END IF;

    v_evidence := CASE v_claim.provider
      WHEN 'cloudflare' THEN jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('a', 32),
        'dns_record_id', repeat('a', 32),
        'http_status', 200,
        'verified', true
      )
      WHEN 'vercel' THEN jsonb_build_object(
        'provider_status', 'attached_verified',
        'provider_resource_id', v_hostname,
        'deployment_id', worker_id || '_deployment',
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

    PERFORM public.record_domain_provisioning_reconciliation(
      v_claim.job_id,
      v_claim.lease_token,
      'matches_intent',
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

  IF v_completed <> 5 THEN
    RAISE EXCEPTION 'Test domain did not settle all five provider jobs';
  END IF;
END;
$$;

SELECT pg_temp.activate_catalog_test_domain(
  value,
  'catalog-test-' || substring(key from 8)
)
FROM catalog_test_ids
WHERE key LIKE 'domain:%'
ORDER BY key;

INSERT INTO public.advocate_beneficiaries (
  advocate_id,
  beneficiary_id,
  is_featured,
  display_order
)
VALUES
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogall'),
    '10000000-0000-4000-8000-000000000001',
    true,
    0
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogfeatured'),
    '10000000-0000-4000-8000-000000000003',
    true,
    0
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogfeatured'),
    '10000000-0000-4000-8000-000000000002',
    true,
    1
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogfeatured'),
    '10000000-0000-4000-8000-000000000006',
    true,
    2
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogselected'),
    '10000000-0000-4000-8000-000000000003',
    true,
    0
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogselected'),
    '10000000-0000-4000-8000-000000000001',
    false,
    2
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogselected'),
    '10000000-0000-4000-8000-000000000006',
    true,
    3
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogselected'),
    '10000000-0000-4000-8000-000000000007',
    true,
    4
  ),
  (
    (SELECT value FROM catalog_test_ids WHERE key = 'advocate:catalogselected'),
    '10000000-0000-4000-8000-000000000008',
    true,
    5
  );

SELECT extensions.ok(
  NOT private.is_beneficiary_canonically_sponsorable(
    'New',
    -2,
    NULL
  )
  AND NOT private.is_beneficiary_canonically_sponsorable(
    'New',
    0,
    NULL
  )
  AND NOT private.is_beneficiary_canonically_sponsorable(
    'New',
    499,
    NULL
  )
  AND private.is_beneficiary_canonically_sponsorable(
    'New',
    500,
    NULL
  )
  AND private.is_beneficiary_canonically_sponsorable(
    'New',
    -1,
    NULL
  ),
  'canonical checkout eligibility accepts open sponsorships and fixed goals at or above the five dollar floor'
);

SELECT extensions.ok(
  (
    SELECT jsonb_array_length(primary_page -> 'items') = 1
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_search => 'Checkout Floor Fixture',
      target_page_size => 60
    ) primary_page
  )
  AND (
    SELECT jsonb_array_length(advocate_page -> 'items') = 0
    FROM public.read_public_advocate_beneficiary_catalog_page(
      target_hostname => 'catalogall.creatorshare.com',
      target_search => 'Checkout Floor Fixture',
      target_page_size => 60
    ) advocate_page
  )
  AND public.read_public_advocate_beneficiary_by_username(
    'catalogall.creatorshare.com',
    'checkout-floor-fixture'
  ) IS NULL
  AND public.read_public_advocate_beneficiary_media_by_id(
    'catalogall.creatorshare.com',
    '10000000-0000-4000-8000-000000000014'::uuid
  ) IS NULL
  AND public.read_public_advocate_beneficiary_activities_by_id(
    'catalogall.creatorshare.com',
    '10000000-0000-4000-8000-000000000014'::uuid
  ) IS NULL,
  'advocate list and deep reads exclude fixed sponsorship goals below the checkout floor without changing the primary catalog'
);

SELECT extensions.ok(
  (
    SELECT jsonb_array_length(primary_page -> 'items') = 0
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_search => 'Legacy Username',
      target_page_size => 60
    ) primary_page
  )
  AND (
    SELECT jsonb_array_length(advocate_page -> 'items') = 0
    FROM public.read_public_advocate_beneficiary_catalog_page(
      target_hostname => 'catalogall.creatorshare.com',
      target_search => 'Legacy Username',
      target_page_size => 60
    ) advocate_page
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(
      ARRAY[
        '10000000-0000-4000-8000-000000000013'::uuid,
        '10000000-0000-4000-8000-000000000015'::uuid,
        '10000000-0000-4000-8000-000000000016'::uuid,
        '10000000-0000-4000-8000-000000000020'::uuid,
        '10000000-0000-4000-8000-000000000021'::uuid,
        '10000000-0000-4000-8000-000000000022'::uuid,
        '10000000-0000-4000-8000-000000000023'::uuid,
        '10000000-0000-4000-8000-000000000024'::uuid,
        '10000000-0000-4000-8000-000000000027'::uuid,
        '10000000-0000-4000-8000-000000000028'::uuid
      ]
    ) AS malformed_beneficiary(id)
    WHERE public.read_primary_public_beneficiary_media_by_id(
        malformed_beneficiary.id
      ) IS NOT NULL
      OR public.read_primary_public_beneficiary_activities_by_id(
        malformed_beneficiary.id
      ) IS NOT NULL
      OR public.read_public_advocate_beneficiary_media_by_id(
        'catalogall.creatorshare.com',
        malformed_beneficiary.id
      ) IS NOT NULL
      OR public.read_public_advocate_beneficiary_activities_by_id(
        'catalogall.creatorshare.com',
        malformed_beneficiary.id
      ) IS NOT NULL
  ),
  'list and purpose-specific deep reads consistently exclude every legacy username outside the URI-safe public grammar'
);

SELECT extensions.ok(
  (
    SELECT jsonb_array_length(primary_page -> 'items') = 0
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_search => 'Projection Shape Poison',
      target_page_size => 60
    ) primary_page
  )
  AND (
    SELECT jsonb_array_length(advocate_page -> 'items') = 0
    FROM public.read_public_advocate_beneficiary_catalog_page(
      target_hostname => 'catalogall.creatorshare.com',
      target_search => 'Projection Shape Poison',
      target_page_size => 60
    ) advocate_page
  )
  AND public.read_primary_public_beneficiary_by_username(
    'projection-shape-poison'
  ) IS NULL
  AND public.read_primary_public_beneficiary_media_by_id(
    '10000000-0000-4000-8000-000000000026'::uuid
  ) IS NULL
  AND public.read_primary_public_beneficiary_activities_by_id(
    '10000000-0000-4000-8000-000000000026'::uuid
  ) IS NULL
  AND public.read_public_advocate_beneficiary_by_username(
    'catalogall.creatorshare.com',
    'projection-shape-poison'
  ) IS NULL
  AND private.build_public_beneficiary_projection(
    '10000000-0000-4000-8000-000000000026'::uuid,
    false,
    NULL
  ) IS NULL,
  'one malformed beneficiary projection is quarantined without failing either catalog or a purpose-specific read'
);

SELECT extensions.is(
  (
    SELECT jsonb_array_length(result -> 'items')
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  8,
  'the primary catalog preserves the current public projection instead of imposing checkout eligibility'
);

SELECT extensions.ok(
  (
    SELECT result -> 'items' @> jsonb_build_array(
      jsonb_build_object(
        'id',
        '10000000-0000-4000-8000-000000000006'::uuid
      ),
      jsonb_build_object(
        'id',
        '10000000-0000-4000-8000-000000000007'::uuid
      )
    )
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  'the primary public catalog retains fulfilled and fulfillment-evidenced history rows'
);

SELECT extensions.is(
  (
    SELECT jsonb_array_length(result -> 'items')
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_statuses => ARRAY['New'],
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  5,
  'a waiting-like primary status filter continues to include open sponsorships regardless of their stale nonhidden status'
);

SELECT extensions.ok(
  (
    SELECT result -> 'items' @> jsonb_build_array(
      jsonb_build_object(
        'id',
        '10000000-0000-4000-8000-000000000004'::uuid
      )
    )
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_statuses => ARRAY['New'],
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  'the open sponsorship compatibility branch returns the open cancelled fixture in the New view'
);

SELECT extensions.is(
  (
    SELECT jsonb_array_length(result -> 'items')
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_statuses => ARRAY['Budget Fulfilled'],
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  1,
  'a purely terminal primary filter does not add open sponsorships from another status'
);

SELECT extensions.is(
  (
    SELECT result #>> '{items,0,id}'
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_search => '%_(),',
      target_page_size => 60
    ) result
  ),
  '10000000-0000-4000-8000-000000000005',
  'search punctuation is interpreted literally rather than as query syntax or wildcards'
);

SELECT extensions.is(
  (
    SELECT jsonb_array_length(result -> 'items')
    FROM public.read_primary_public_beneficiary_catalog_page(
      target_search => 'Legacy Projection',
      target_page_size => 60
    ) result
  ),
  2,
  'the primary projection retains complete legacy and null type rows while excluding incomplete display records'
);

SELECT extensions.is(
  (
    SELECT jsonb_array_length(result -> 'items')
    FROM public.read_public_advocate_beneficiary_catalog_page(
      'catalogall.creatorshare.com',
      target_search => 'Legacy Projection',
      target_page_size => 60
    ) result
  ),
  2,
  'the advocate all mode retains canonically eligible legacy and null type records'
);

SELECT extensions.lives_ok(
  $$
    SELECT public.read_primary_public_beneficiary_catalog_page(
      target_beneficiary_types => ARRAY[
        'CHILD',
        'CHILD_LABORER',
        'SPECIAL_NEEDS',
        'IN_OUR_CARE',
        'ANIMAL'
      ],
      target_search => 'Catalog Fixture'
    )
  $$,
  'the exact five product beneficiary types are accepted'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_primary_public_beneficiary_catalog_page(
      target_beneficiary_types => ARRAY['FAMILY']
    )
  $$,
  '22023',
  'Invalid beneficiary type filter',
  'a legacy database value outside the product allowlist is rejected'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_primary_public_beneficiary_catalog_page(
      target_beneficiary_types => ARRAY['CHILD', 'CHILD']
    )
  $$,
  '22023',
  'Invalid beneficiary type filter',
  'duplicate beneficiary type filters are rejected'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_primary_public_beneficiary_catalog_page(
      target_statuses => ARRAY['Draft']
    )
  $$,
  '22023',
  'Invalid beneficiary status filter',
  'nonpublic status filters are rejected at the RPC boundary'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_primary_public_beneficiary_catalog_page(
      target_min_age => 0,
      target_max_age => 131
    )
  $$,
  '22023',
  'Invalid beneficiary age filter',
  'the database enforces the same 130 year public age limit as the application'
);

SELECT extensions.ok(
  (
    SELECT
      (result ->> 'totalCount')::integer = 5
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(result -> 'items') item
        WHERE item ->> 'is_featured' <> 'false'
          OR item -> 'advocate_display_order' <> 'null'::jsonb
      )
    FROM public.read_public_advocate_beneficiary_catalog_page(
      'catalogall.creatorshare.com',
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  'all mode exposes every canonical beneficiary and ignores selection presentation fields'
);

SELECT extensions.ok(
  (
    SELECT
      (result ->> 'totalCount')::integer = 2
      AND ARRAY(
        SELECT item ->> 'id'
        FROM jsonb_array_elements(result -> 'items') item
      ) = ARRAY[
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001'
      ]::text[]
    FROM public.read_public_advocate_beneficiary_catalog_page(
      'catalogselected.creatorshare.com',
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  'selected mode returns only this tenant selections in feature and display order'
);

SELECT extensions.ok(
  (
    SELECT NOT result -> 'items' @> jsonb_build_array(
      jsonb_build_object(
        'id',
        '10000000-0000-4000-8000-000000000002'::uuid
      )
    )
    FROM public.read_public_advocate_beneficiary_catalog_page(
      'catalogselected.creatorshare.com',
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  'a selection owned by another advocate cannot cross the selected tenant boundary'
);

SELECT extensions.ok(
  (
    SELECT
      result -> 'items' @> jsonb_build_array(
        jsonb_build_object(
          'id',
          '10000000-0000-4000-8000-000000000004'::uuid
        )
      )
      AND NOT result -> 'items' @> jsonb_build_array(
        jsonb_build_object(
          'id',
          '10000000-0000-4000-8000-000000000006'::uuid
        )
      )
      AND NOT result -> 'items' @> jsonb_build_array(
        jsonb_build_object(
          'id',
          '10000000-0000-4000-8000-000000000007'::uuid
        )
      )
    FROM public.read_public_advocate_beneficiary_catalog_page(
      'catalogall.creatorshare.com',
      target_search => 'Catalog Fixture',
      target_page_size => 60
    ) result
  ),
  'advocate catalogs include open sponsorships but exclude fixed fulfilled and fulfillment-evidenced rows'
);

SELECT extensions.is(
  (
    SELECT result #>> '{items,0,id}'
    FROM public.read_public_advocate_beneficiary_catalog_page(
      'catalogall.creatorshare.com',
      target_search => '%_(),',
      target_page_size => 60
    ) result
  ),
  '10000000-0000-4000-8000-000000000005',
  'advocate search also treats punctuation literally'
);

CREATE TEMP TABLE catalog_test_pages (
  page_number integer PRIMARY KEY,
  value jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO catalog_test_pages (page_number, value)
SELECT
  1,
  public.read_public_advocate_beneficiary_catalog_page(
    'catalogfeatured.creatorshare.com',
    target_search => 'Catalog Fixture',
    target_page_size => 2
  );

WITH cursor_value AS (
  SELECT value #> '{pageInfo,nextCursor}' AS cursor
  FROM catalog_test_pages
  WHERE page_number = 1
)
INSERT INTO catalog_test_pages (page_number, value)
SELECT
  2,
  public.read_public_advocate_beneficiary_catalog_page(
    'catalogfeatured.creatorshare.com',
    target_search => 'Catalog Fixture',
    target_page_size => 2,
    after_feature_bucket => (cursor ->> 'featureBucket')::integer,
    after_display_order => (cursor ->> 'displayOrder')::integer,
    after_created_at => (cursor ->> 'createdAt')::timestamp with time zone,
    after_id => (cursor ->> 'id')::uuid
  )
FROM cursor_value;

WITH cursor_value AS (
  SELECT value #> '{pageInfo,nextCursor}' AS cursor
  FROM catalog_test_pages
  WHERE page_number = 2
)
INSERT INTO catalog_test_pages (page_number, value)
SELECT
  3,
  public.read_public_advocate_beneficiary_catalog_page(
    'catalogfeatured.creatorshare.com',
    target_search => 'Catalog Fixture',
    target_page_size => 2,
    after_feature_bucket => (cursor ->> 'featureBucket')::integer,
    after_display_order => (cursor ->> 'displayOrder')::integer,
    after_created_at => (cursor ->> 'createdAt')::timestamp with time zone,
    after_id => (cursor ->> 'id')::uuid
  )
FROM cursor_value;

SELECT extensions.ok(
  (
    SELECT
      ARRAY(
        SELECT item ->> 'id'
        FROM jsonb_array_elements(value -> 'items') item
      ) = ARRAY[
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000002'
      ]::text[]
      AND (value #>> '{items,0,is_featured}')::boolean
      AND (value #>> '{items,1,is_featured}')::boolean
    FROM catalog_test_pages
    WHERE page_number = 1
  ),
  'all featured mode places chosen beneficiaries first in configured order'
);

SELECT extensions.ok(
  (
    WITH paged_items AS (
      SELECT
        page.page_number,
        item ->> 'id' AS beneficiary_id
      FROM catalog_test_pages page
      CROSS JOIN LATERAL jsonb_array_elements(page.value -> 'items') item
    )
    SELECT
      count(*) = 5
      AND count(DISTINCT beneficiary_id) = 5
      AND min(page_number) = 1
      AND max(page_number) = 3
    FROM paged_items
  ),
  'keyset pagination walks the complete featured catalog without duplicate beneficiaries'
);

SELECT extensions.ok(
  (
    SELECT
      (first_page.value #>> '{pageInfo,hasMore}')::boolean
      AND (second_page.value #>> '{pageInfo,hasMore}')::boolean
      AND NOT (third_page.value #>> '{pageInfo,hasMore}')::boolean
      AND third_page.value #> '{pageInfo,nextCursor}' = 'null'::jsonb
    FROM catalog_test_pages first_page
    JOIN catalog_test_pages second_page ON second_page.page_number = 2
    JOIN catalog_test_pages third_page ON third_page.page_number = 3
    WHERE first_page.page_number = 1
  ),
  'keyset continuation terminates exactly after the final unique row'
);

SELECT extensions.ok(
  public.read_primary_public_beneficiary_by_username(
    'catalog-fixture-fulfillment-evidence'
  ) IS NOT NULL
  AND public.read_primary_public_beneficiary_media_by_id(
    '10000000-0000-4000-8000-000000000006'::uuid
  ) IS NOT NULL
  AND public.read_primary_public_beneficiary_activities_by_id(
    '10000000-0000-4000-8000-000000000006'::uuid
  ) IS NOT NULL,
  'primary purpose-specific reads preserve public history semantics'
);

SELECT extensions.ok(
  public.read_primary_public_beneficiary_by_username(
    'catalog-fixture-draft'
  ) IS NULL
  AND public.read_primary_public_beneficiary_media_by_id(
    '10000000-0000-4000-8000-000000000008'::uuid
  ) IS NULL
  AND public.read_primary_public_beneficiary_activities_by_id(
    '10000000-0000-4000-8000-000000000008'::uuid
  ) IS NULL,
  'primary purpose-specific reads never expose a hidden beneficiary'
);

SELECT extensions.ok(
  public.read_public_advocate_beneficiary_by_username(
    'catalogselected.creatorshare.com',
    'catalog-fixture-alpha'
  ) IS NOT NULL
  AND public.read_public_advocate_beneficiary_media_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000001'::uuid
  ) IS NOT NULL
  AND public.read_public_advocate_beneficiary_activities_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000001'::uuid
  ) IS NOT NULL,
  'selected advocate purpose-specific reads return an eligible tenant selection'
);

SELECT extensions.ok(
  public.read_public_advocate_beneficiary_by_username(
    'catalogselected.creatorshare.com',
    'catalog-fixture-beta'
  ) IS NULL
  AND public.read_public_advocate_beneficiary_media_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000002'::uuid
  ) IS NULL
  AND public.read_public_advocate_beneficiary_activities_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000002'::uuid
  ) IS NULL,
  'selected advocate purpose-specific reads cannot use another tenant selection'
);

SELECT extensions.ok(
  public.read_public_advocate_beneficiary_by_username(
    'catalogselected.creatorshare.com',
    'catalog-fixture-fulfillment-evidence'
  ) IS NULL
  AND public.read_public_advocate_beneficiary_media_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000006'::uuid
  ) IS NULL
  AND public.read_public_advocate_beneficiary_activities_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000006'::uuid
  ) IS NULL
  AND public.read_public_advocate_beneficiary_by_username(
    'catalogselected.creatorshare.com',
    'catalog-fixture-draft'
  ) IS NULL
  AND public.read_public_advocate_beneficiary_media_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000008'::uuid
  ) IS NULL
  AND public.read_public_advocate_beneficiary_activities_by_id(
    'catalogselected.creatorshare.com',
    '10000000-0000-4000-8000-000000000008'::uuid
  ) IS NULL,
  'selected advocate purpose-specific reads reject fulfillment-evidenced and hidden selections'
);

CREATE OR REPLACE FUNCTION pg_temp.materialize_catalog_media_objects()
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO storage.objects (bucket_id, name)
  SELECT
    'media',
    concat(
      media.parent_id::text,
      '/',
      media.type::text,
      '/',
      media.id::text,
      '.',
      media.extension
    )
  FROM public.media media
  WHERE media.id <> '20000000-0000-4000-8000-000000000003'::uuid
  ON CONFLICT DO NOTHING;
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.media (
  id,
  parent_id,
  extension,
  type,
  weight
)
SELECT
  md5('catalog-complete-media-' || item.value::text)::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'jpg',
  'IMAGE',
  item.value
FROM generate_series(1, 101) AS item(value);

INSERT INTO public.activities (
  id,
  created_at,
  beneficiary_id,
  title,
  description,
  activity_type,
  is_public
)
SELECT
  md5('catalog-complete-activity-' || item.value::text)::uuid,
  '2026-02-01 00:00:00+00'::timestamp with time zone
    + make_interval(secs => item.value),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Complete history activity ' || item.value::text,
  'This activity remains reachable through the complete deep read contract.',
  'INFO',
  true
FROM generate_series(1, 51) AS item(value);

INSERT INTO public.media (
  id,
  parent_id,
  extension,
  type,
  weight
)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'bad/ext',
    'IMAGE',
    0
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    md5('catalog-complete-activity-1')::uuid,
    repeat('x', 33),
    'DOCUMENT',
    0
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'jpg',
    'IMAGE',
    0
  );

SELECT pg_temp.materialize_catalog_media_objects();

INSERT INTO public.activities (
  id,
  created_at,
  beneficiary_id,
  title,
  description,
  activity_type,
  is_public
)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '2026-03-01 00:00:00+00',
  '10000000-0000-4000-8000-000000000001',
  E'Unsafe\001activity title',
  'This malformed public activity must be quarantined.',
  'INFO',
  true
);

SELECT extensions.ok(
  jsonb_array_length(
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 101
  AND NOT (
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) ->> 'hasMore'
  )::boolean
  AND jsonb_array_length(
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 51
  AND NOT (
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) ->> 'hasMore'
  )::boolean,
  'primary projections preserve bounded media and activity history beyond the former limits'
);

SELECT extensions.ok(
  NOT (
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) @> jsonb_build_array(
    jsonb_build_object(
      'id',
      '20000000-0000-4000-8000-000000000001'::uuid
    )
  )
  AND NOT (
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) @> jsonb_build_array(
    jsonb_build_object(
      'id',
      '20000000-0000-4000-8000-000000000003'::uuid
    )
  )
  AND NOT (
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) @> jsonb_build_array(
    jsonb_build_object(
      'id',
      '30000000-0000-4000-8000-000000000001'::uuid
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.read_primary_public_beneficiary_activities_by_id(
        '10000000-0000-4000-8000-000000000001'::uuid
      ) -> 'items'
    ) activity
    CROSS JOIN LATERAL jsonb_array_elements(activity -> 'media') media
    WHERE media ->> 'id' = '20000000-0000-4000-8000-000000000002'
  ),
  'malformed or unbacked media and activity rows are quarantined instead of poisoning a child detail response'
);

SELECT extensions.ok(
  jsonb_array_length(
    public.read_public_advocate_beneficiary_media_by_id(
      'catalogselected.creatorshare.com',
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 101
  AND jsonb_array_length(
    public.read_public_advocate_beneficiary_activities_by_id(
      'catalogselected.creatorshare.com',
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 51,
  'advocate projections preserve the same bounded history for an eligible tenant selection'
);

INSERT INTO public.media (
  id,
  parent_id,
  extension,
  type,
  weight
)
SELECT
  md5('catalog-overflow-media-' || item.value::text)::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'jpg',
  'IMAGE',
  101 + item.value
FROM generate_series(1, 399) AS item(value);

INSERT INTO public.activities (
  id,
  created_at,
  beneficiary_id,
  title,
  description,
  activity_type,
  is_public
)
SELECT
  md5('catalog-overflow-activity-' || item.value::text)::uuid,
  '2026-04-01 00:00:00+00'::timestamp with time zone
    + make_interval(secs => item.value),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Overflow history activity ' || item.value::text,
  'This row proves the public response reports an explicit safety ceiling.',
  'INFO',
  true
FROM generate_series(1, 49) AS item(value);

INSERT INTO public.media (
  id,
  parent_id,
  extension,
  type,
  weight
)
SELECT
  md5('catalog-overflow-activity-media-' || item.value::text)::uuid,
  md5('catalog-overflow-activity-49')::uuid,
  'jpg',
  'IMAGE',
  item.value
FROM generate_series(1, 500) AS item(value);

SELECT pg_temp.materialize_catalog_media_objects();

SELECT extensions.ok(
  jsonb_array_length(
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 500
  AND NOT (
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) ->> 'hasMore'
  )::boolean
  AND jsonb_array_length(
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 100
  AND NOT (
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) ->> 'hasMore'
  )::boolean
  AND (
    SELECT coalesce(sum(jsonb_array_length(activity -> 'media')), 0) = 500
    FROM jsonb_array_elements(
      public.read_primary_public_beneficiary_activities_by_id(
        '10000000-0000-4000-8000-000000000001'::uuid
      ) -> 'items'
    ) activity
  ),
  'deep projections keep hasMore false at the exact direct, activity, and nested media ceilings'
);

INSERT INTO public.media (
  id,
  parent_id,
  extension,
  type,
  weight
)
VALUES (
  md5('catalog-overflow-activity-media-501')::uuid,
  md5('catalog-overflow-activity-49')::uuid,
  'jpg',
  'IMAGE',
  501
);

SELECT pg_temp.materialize_catalog_media_objects();

SELECT extensions.ok(
  jsonb_array_length(
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 100
  AND (
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) ->> 'hasMore'
  )::boolean
  AND (
    SELECT coalesce(sum(jsonb_array_length(activity -> 'media')), 0) = 500
    FROM jsonb_array_elements(
      public.read_primary_public_beneficiary_activities_by_id(
        '10000000-0000-4000-8000-000000000001'::uuid
      ) -> 'items'
    ) activity
  ),
  'activity projections report nested media overflow without returning an oversized payload'
);

DELETE FROM public.media
WHERE id = md5('catalog-overflow-activity-media-501')::uuid;

INSERT INTO public.media (
  id,
  parent_id,
  extension,
  type,
  weight
)
VALUES (
  md5('catalog-overflow-media-400')::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'jpg',
  'IMAGE',
  501
);

SELECT pg_temp.materialize_catalog_media_objects();

INSERT INTO public.activities (
  id,
  created_at,
  beneficiary_id,
  title,
  description,
  activity_type,
  is_public
)
VALUES (
  md5('catalog-overflow-activity-50')::uuid,
  '2026-04-01 00:00:50+00',
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Overflow history activity 50',
  'This row proves the public response reports an explicit safety ceiling.',
  'INFO',
  true
);

SELECT extensions.ok(
  jsonb_array_length(
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 500
  AND (
    public.read_primary_public_beneficiary_media_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) ->> 'hasMore'
  )::boolean
  AND jsonb_array_length(
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ) = 100
  AND (
    public.read_primary_public_beneficiary_activities_by_id(
      '10000000-0000-4000-8000-000000000001'::uuid
    ) ->> 'hasMore'
  )::boolean,
  'deep projections report their explicit safety ceiling instead of silently truncating history'
);

UPDATE public.advocate_domains
SET
  status = 'failed',
  failure_code = 'catalog_test_inactive'
WHERE id = (
  SELECT value
  FROM catalog_test_ids
  WHERE key = 'domain:catalogall'
);

SELECT extensions.ok(
  public.read_public_advocate_beneficiary_catalog_page(
    'catalogall.creatorshare.com'
  ) IS NULL
  AND public.read_public_advocate_beneficiary_media_by_id(
    'catalogall.creatorshare.com',
    '10000000-0000-4000-8000-000000000001'::uuid
  ) IS NULL,
  'an inactive exact domain immediately loses catalog and projection access'
);

SELECT * FROM extensions.finish();

ROLLBACK;

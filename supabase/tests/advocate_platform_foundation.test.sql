BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(78);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'sponsorship_attribution_policies',
        'payment_provider_accounts',
        'browser_visitors',
        'sponsor_identities',
        'sponsor_identifiers',
        'advocate_exposures',
        'sponsorship_intents',
        'sponsorship_attributions',
        'sponsorship_payment_attempts',
        'payment_gateway_events',
        'sponsorship_account_claims',
        'email_outbox'
      )
      AND relation.relrowsecurity
  ),
  12,
  'all sponsorship identity and attribution tables have RLS enabled'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'sponsorship_attribution_policies',
        'payment_provider_accounts',
        'browser_visitors',
        'sponsor_identities',
        'sponsor_identifiers',
        'advocate_exposures',
        'sponsorship_intents',
        'sponsorship_attributions',
        'sponsorship_payment_attempts',
        'payment_gateway_events',
        'sponsorship_account_claims',
        'email_outbox'
      )
      AND has_table_privilege('anon', relation.oid, 'SELECT')
  ),
  0,
  'anonymous users cannot read sponsorship identity and attribution tables'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'sponsorship_attribution_policies',
        'payment_provider_accounts',
        'browser_visitors',
        'sponsor_identities',
        'sponsor_identifiers',
        'advocate_exposures',
        'sponsorship_intents',
        'sponsorship_attributions',
        'sponsorship_payment_attempts',
        'payment_gateway_events',
        'sponsorship_account_claims',
        'email_outbox'
      )
      AND has_table_privilege('anon', relation.oid, 'INSERT')
  ),
  0,
  'anonymous users cannot insert sponsorship identity and attribution rows'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'browser_visitors',
        'sponsor_identities',
        'sponsor_identifiers',
        'advocate_exposures',
        'sponsorship_intents',
        'sponsorship_attributions',
        'sponsorship_payment_attempts',
        'payment_gateway_events',
        'sponsorship_account_claims',
        'email_outbox'
      )
      AND has_table_privilege('authenticated', relation.oid, 'SELECT')
  ),
  0,
  'authenticated browser clients cannot read operational identity tables'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'browser_visitors',
        'sponsor_identities',
        'sponsor_identifiers',
        'advocate_exposures',
        'sponsorship_intents',
        'sponsorship_attributions',
        'sponsorship_payment_attempts',
        'payment_gateway_events',
        'sponsorship_account_claims',
        'email_outbox'
      )
      AND has_table_privilege('authenticated', relation.oid, 'UPDATE')
  ),
  0,
  'authenticated browser clients cannot mutate operational identity tables'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'sponsorship_attribution_policies',
        'payment_provider_accounts',
        'browser_visitors',
        'sponsor_identities',
        'sponsor_identifiers',
        'advocate_exposures',
        'sponsorship_intents',
        'sponsorship_attributions',
        'sponsorship_payment_attempts',
        'payment_gateway_events',
        'sponsorship_account_claims',
        'email_outbox'
      )
      AND has_table_privilege('service_role', relation.oid, 'TRUNCATE')
  ),
  0,
  'the application service role cannot truncate operational sponsorship tables'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'advocates',
        'advocate_reserved_subdomains',
        'advocate_domains',
        'advocate_domain_integrations',
        'domain_provisioning_jobs',
        'advocate_branding',
        'advocate_public_metric_selections',
        'advocate_beneficiaries',
        'advocate_memberships',
        'advocate_roles',
        'advocate_permissions',
        'advocate_role_permissions',
        'advocate_membership_roles',
        'advocate_invitations',
        'advocate_invitation_roles'
      )
      AND has_table_privilege('service_role', relation.oid, 'TRUNCATE')
  ),
  0,
  'the application service role cannot truncate advocate tenancy tables'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid = 'public.advocate_reserved_subdomains'::regclass
  ),
  'reserved subdomains are protected by RLS'
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
  'reserved subdomain policy is migration owned at runtime'
);

SELECT extensions.ok(
  (
    SELECT column_definition.column_default IS NULL
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'role_assignments'
      AND column_definition.column_name = 'advocate_id'
  ),
  'legacy role assignments never invent a random advocate scope'
);

SELECT extensions.ok(
  (
    SELECT column_definition.is_nullable = 'NO'
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'role_assignments'
      AND column_definition.column_name = 'role_id'
  ),
  'every legacy role assignment names a concrete role'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'public'
      AND index_definition.tablename = 'roles'
      AND index_definition.indexname = 'roles_name_case_insensitive_uidx'
      AND index_definition.indexdef LIKE '%lower(name)%'
  ),
  'legacy role names are unique without case ambiguity'
);

-- The tenancy invariant's source of truth.
--
-- "Each advocate is one tenant with one portal route" rests on two unique
-- indexes, and neither was asserted anywhere: grep for advocates_slug_uidx and
-- advocate_domains_one_primary_uidx across tests returned nothing, while
-- sibling indexes such as roles_name_case_insensitive_uidx above and
-- advocate_membership_roles_one_owner_uidx are covered exactly this way.
-- Dropping either index would have broken the invariant with the whole
-- required suite still green.

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'public'
      AND index_definition.tablename = 'advocates'
      AND index_definition.indexname = 'advocates_slug_uidx'
  ),
  'one advocate per slug is enforced by a unique index'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'public'
      AND index_definition.tablename = 'advocate_domains'
      AND index_definition.indexname = 'advocate_domains_one_primary_uidx'
  ),
  'one primary hostname per advocate is enforced by a unique index'
);

-- Existence alone would pass against a non-unique index, so prove the
-- behaviour: a second advocate on a taken slug must be rejected by the
-- database itself rather than by application validation. Self-contained so it
-- does not depend on whatever rows earlier assertions happen to have left.
INSERT INTO public.advocates (slug, display_name)
VALUES ('tenancy-uniqueness-probe', 'Tenancy Uniqueness Probe');

SELECT extensions.throws_ok(
  $slug_collision$
    INSERT INTO public.advocates (slug, display_name)
    VALUES ('tenancy-uniqueness-probe', 'Duplicate Slug Advocate')
  $slug_collision$,
  '23505',
  NULL,
  'a second advocate cannot take an existing slug'
);

DELETE FROM public.advocates WHERE slug = 'tenancy-uniqueness-probe';

SELECT extensions.is(
  (
    SELECT coalesce(array_to_string(function_definition.proconfig, ','), '')
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.handle_user_registration()'::regprocedure
  ),
  'search_path=""',
  'the auth registration trigger has a fixed empty search path'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.handle_user_registration()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.handle_user_registration()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.handle_user_registration()',
    'EXECUTE'
  ),
  'the auth registration trigger is not directly callable by application roles'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'public.role_assignments',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.role_assignments',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.role_assignments',
    'DELETE'
  ),
  'authenticated callers cannot directly mutate global role assignments'
);

SELECT extensions.ok(
  (
    SELECT count(*) >= 3
    FROM pg_trigger trigger
    WHERE trigger.tgrelid = 'public.sponsorship_intents'::regclass
      AND NOT trigger.tgisinternal
  ),
  'sponsorship intents have validation, attribution, audit, and truncate triggers'
);

SELECT extensions.ok(
  (
    SELECT count(*) >= 4
    FROM pg_trigger trigger
    WHERE trigger.tgrelid = 'public.advocate_exposures'::regclass
      AND NOT trigger.tgisinternal
  ),
  'advocate exposures have validation, append-only, audit, and truncate triggers'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'private.has_advocate_permission(uuid,text)'::regprocedure
  ) LIKE '%relationship_status <> ''archived''%',
  'delegate view permissions close when the advocate relationship is archived'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'private.has_advocate_mutation_permission(uuid,text)'::regprocedure
  ) LIKE '%relationship_status = ''active''%'
  AND pg_get_functiondef(
    'private.has_advocate_mutation_permission(uuid,text)'::regprocedure
  ) LIKE '%publication_status IN (''draft'', ''provisioning'', ''active'', ''failed'')%',
  'delegate mutation permissions require an active and unsuspended portal lifecycle'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'public'
      AND index_definition.tablename = 'advocate_domains'
      AND index_definition.indexdef LIKE '%(id, advocate_id)%'
  ),
  'the advocate domain composite key has no duplicate index'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocates (slug, display_name)
    VALUES ('admin', 'Reserved Label')
  $$,
  '23514',
  'Advocate subdomain label is reserved',
  'reserved advocate labels are rejected in the database'
);

CREATE TEMP TABLE test_advocate_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.activate_test_advocate_domain(
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
        'provider_resource_id', v_claim.provider::text || ':hosted_checkout',
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

WITH inserted AS (
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
    '90000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'foundation-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Foundation","last_name":"Owner"}'::jsonb,
    now(),
    now()
  )
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'owner_user', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsor_identities (auth_user_id)
  SELECT value
  FROM test_advocate_context
  WHERE key = 'owner_user'
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'sponsor_identity', id FROM inserted;

INSERT INTO public.sponsor_identifiers (
  sponsor_identity_id,
  kind,
  issuer_scope,
  identifier_digest,
  normalization_version,
  hmac_key_version,
  confidence,
  verified_at
)
SELECT
  value,
  'email',
  'creator_share',
  decode(repeat('22', 32), 'hex'),
  1,
  1,
  'verified',
  now()
FROM test_advocate_context
WHERE key = 'sponsor_identity';

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsor_identities
    SET auth_user_id = NULL
    WHERE id = (
      SELECT value FROM test_advocate_context WHERE key = 'sponsor_identity'
    )
  $$,
  '42501',
  'A verified sponsor account link cannot be replaced or manually removed while active',
  'an active sponsor identity cannot silently lose its verified account link'
);

WITH inserted AS (
  INSERT INTO public.advocates (slug, display_name, relationship_status)
  VALUES ('foundationtest', 'Foundation Test', 'active')
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_memberships (advocate_id, user_id, status)
  SELECT advocate.value, owner_user.value, 'active'
  FROM test_advocate_context advocate
  CROSS JOIN test_advocate_context owner_user
  WHERE advocate.key = 'advocate' AND owner_user.key = 'owner_user'
  RETURNING id, advocate_id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'owner_membership', id FROM inserted;

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
SELECT
  advocate.value,
  membership.value,
  '00000000-0000-4000-8000-000000000001'::uuid,
  owner_user.value
FROM test_advocate_context advocate
CROSS JOIN test_advocate_context membership
CROSS JOIN test_advocate_context owner_user
WHERE advocate.key = 'advocate'
  AND membership.key = 'owner_membership'
  AND owner_user.key = 'owner_user';

UPDATE public.advocates
SET
  owner_membership_id = (
    SELECT value FROM test_advocate_context WHERE key = 'owner_membership'
  ),
  publication_status = 'provisioning'
WHERE id = (
  SELECT value FROM test_advocate_context WHERE key = 'advocate'
);

INSERT INTO public.advocates (
  slug,
  display_name,
  relationship_status,
  publication_status
)
VALUES (
  'foundationlifecycle',
  'Foundation Lifecycle Test',
  'active',
  'draft'
);

UPDATE public.advocates
SET relationship_status = 'archived'
WHERE slug = 'foundationlifecycle';

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocates
    SET relationship_status = 'active'
    WHERE slug = 'foundationlifecycle'
  $$,
  '23514',
  'Illegal advocate relationship transition from archived to active',
  'archived advocate relationships cannot be resurrected'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.role_assignments (
      user_id,
      role_id,
      organization_id,
      advocate_id
    )
    SELECT
      assignment.user_id,
      assignment.role_id,
      assignment.organization_id,
      assignment.advocate_id
    FROM public.role_assignments assignment
    ORDER BY assignment.created_at, assignment.id
    LIMIT 1
  $$,
  '23505',
  'duplicate key value violates unique constraint "role_assignments_identity_uidx"',
  'duplicate legacy role assignments are rejected'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.role_assignments (
      user_id,
      role_id,
      advocate_id
    )
    SELECT
      owner_user.value,
      role.id,
      advocate.value
    FROM test_advocate_context owner_user
    CROSS JOIN test_advocate_context advocate
    CROSS JOIN public.roles role
    WHERE owner_user.key = 'owner_user'
      AND advocate.key = 'advocate'
      AND role.name = 'SUPER_ADMIN'
  $$,
  '23514',
  'SUPER_ADMIN assignments must be global and unscoped',
  'the global super admin role cannot be smuggled into an advocate scope'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.roles
    SET name = 'SUPER_ADMIN_RENAMED'
    WHERE name = 'SUPER_ADMIN'
  $$,
  '42501',
  'Role identity fields are immutable',
  'a benign legacy role cannot be renamed into or out of the super admin identity'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocate_domains (
      advocate_id,
      hostname,
      is_primary
    )
    SELECT value, 'somebodyelse.creatorshare.com', true
    FROM test_advocate_context
    WHERE key = 'advocate'
  $$,
  '23514',
  'Advocate domain hostname must match the immutable advocate slug',
  'a provisioning bug cannot attach another hostname to an advocate tenant'
);

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    value,
    'foundationtest.creatorshare.com',
    true
  FROM test_advocate_context
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'domain', id FROM inserted;

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
FROM test_advocate_context advocate
CROSS JOIN test_advocate_context domain
CROSS JOIN (
  VALUES
    ('cloudflare', 'production'),
    ('vercel', 'production'),
    ('stripe_us', 'live'),
    ('stripe_uk', 'live'),
    ('paypal', 'live')
) AS required(provider, environment)
WHERE advocate.key = 'advocate'
  AND domain.key = 'domain';

SELECT pg_temp.activate_test_advocate_domain(
  (SELECT value FROM test_advocate_context WHERE key = 'domain'),
  'foundation-test-worker'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT public.publish_advocate_portal(
  (SELECT value FROM test_advocate_context WHERE key = 'advocate'),
  (
    SELECT advocate.version
    FROM public.advocates advocate
    WHERE advocate.id = (
      SELECT value FROM test_advocate_context WHERE key = 'advocate'
    )
  ),
  (SELECT value FROM test_advocate_context WHERE key = 'domain'),
  'foundationtest.creatorshare.com',
  extensions.digest('foundation-test-publication-canary', 'sha256'),
  clock_timestamp(),
  'Publish the foundation fixture after all provider chains settle',
  'foundation-test-deployment',
  'foundation-test-publication-request',
  'foundation-test-publication-trace'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT extensions.ok(
  (
    SELECT advocate.published_at IS NOT NULL
      AND advocate.suspended_at IS NULL
      AND advocate.archived_at IS NULL
    FROM public.advocates advocate
    JOIN test_advocate_context context
      ON context.key = 'advocate' AND context.value = advocate.id
  ),
  'portal publication derives its lifecycle timestamp on the server'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocates
    SET published_at = clock_timestamp() + interval '1 day'
    WHERE id = (
      SELECT value FROM test_advocate_context WHERE key = 'advocate'
    )
  $$,
  '42501',
  'Advocate lifecycle timestamps are server managed',
  'callers cannot forge advocate lifecycle timestamps'
);

SELECT extensions.ok(
  (
    SELECT domain.status = 'active'
      AND domain.dns_verified_at IS NOT NULL
      AND domain.tls_ready_at IS NOT NULL
      AND domain.payments_ready_at IS NOT NULL
      AND domain.activated_at IS NOT NULL
    FROM public.advocate_domains domain
    JOIN test_advocate_context context
      ON context.key = 'domain' AND context.value = domain.id
  ),
  'domain activation derives readiness evidence from all five required integrations'
);

WITH inserted AS (
  INSERT INTO public.browser_visitors (token_digest, consent_state)
  VALUES (decode(repeat('11', 32), 'hex'), 'granted')
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'visitor', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_exposures (
    advocate_id,
    advocate_domain_id,
    browser_visitor_id,
    occurred_at,
    is_qualified,
    exclusion_reason,
    consent_state
  )
  SELECT
    advocate.value,
    domain.value,
    visitor.value,
    '2000-01-01'::timestamptz,
    true,
    NULL,
    'granted'
  FROM test_advocate_context advocate
  CROSS JOIN test_advocate_context domain
  CROSS JOIN test_advocate_context visitor
  WHERE advocate.key = 'advocate'
    AND domain.key = 'domain'
    AND visitor.key = 'visitor'
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'exposure', id FROM inserted;

SELECT extensions.ok(
  (
    SELECT exposure.occurred_at > clock_timestamp() - interval '1 minute'
      AND exposure.recorded_at = exposure.occurred_at
      AND exposure.retention_expires_at = exposure.occurred_at + interval '400 days'
    FROM public.advocate_exposures exposure
    JOIN test_advocate_context context
      ON context.key = 'exposure' AND context.value = exposure.id
  ),
  'exposure timestamps and retention are server owned'
);

WITH inserted AS (
  INSERT INTO public.sponsorship_intents (
    idempotency_key,
    source,
    source_host,
    browser_visitor_id,
    auth_user_id,
    sponsor_identity_id,
    contact_email_hmac,
    contact_email_normalization_version,
    contact_email_hmac_key_version,
    subject_kind,
    payment_mode,
    recurrence_interval,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'foundation-primary-0001',
    'primary_site',
    'creatorshare.com',
    visitor.value,
    owner_user.value,
    sponsor_identity.value,
    decode(repeat('22', 32), 'hex'),
    1,
    1,
    'blind',
    'recurring',
    'month',
    3333,
    3333,
    'USD',
    1,
    now(),
    'foundation-test'
  FROM test_advocate_context visitor
  CROSS JOIN test_advocate_context owner_user
  CROSS JOIN test_advocate_context sponsor_identity
  WHERE visitor.key = 'visitor'
    AND owner_user.key = 'owner_user'
    AND sponsor_identity.key = 'sponsor_identity'
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'primary_intent', id FROM inserted;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_attributions attribution
    JOIN test_advocate_context intent
      ON intent.key = 'primary_intent'
     AND intent.value = attribution.sponsorship_intent_id
  ),
  'an attribution row is created atomically with every intent'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_intents
    SET auth_user_id = NULL
    WHERE id = (
      SELECT value FROM test_advocate_context WHERE key = 'primary_intent'
    )
  $$,
  '42501',
  'An attached authenticated user cannot be replaced or manually removed',
  'an intent cannot silently lose its authenticated sponsor evidence'
);

SELECT extensions.is(
  (
    SELECT attribution.kind::text
    FROM public.sponsorship_attributions attribution
    JOIN test_advocate_context intent
      ON intent.key = 'primary_intent'
     AND intent.value = attribution.sponsorship_intent_id
  ),
  'post_visit_attributed',
  'a recent primary-site sponsorship is post-visit attributed'
);

SELECT extensions.ok(
  (
    SELECT attribution.advocate_id = advocate.value
      AND attribution.exposure_id = exposure.value
    FROM public.sponsorship_attributions attribution
    JOIN test_advocate_context intent
      ON intent.key = 'primary_intent'
     AND intent.value = attribution.sponsorship_intent_id
    JOIN test_advocate_context advocate ON advocate.key = 'advocate'
    JOIN test_advocate_context exposure ON exposure.key = 'exposure'
  ),
  'post-visit attribution names the correct advocate and most recent exposure'
);

WITH inserted AS (
  INSERT INTO public.sponsorship_intents (
    idempotency_key,
    source,
    source_host,
    source_advocate_id,
    source_advocate_domain_id,
    contact_email_hmac,
    contact_email_normalization_version,
    contact_email_hmac_key_version,
    subject_kind,
    payment_mode,
    recurrence_interval,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'foundation-direct-0001',
    'advocate_domain',
    'foundationtest.creatorshare.com',
    advocate.value,
    domain.value,
    decode(repeat('55', 32), 'hex'),
    1,
    1,
    'blind',
    'recurring',
    'month',
    3333,
    3333,
    'USD',
    1,
    now(),
    'foundation-test'
  FROM test_advocate_context advocate
  CROSS JOIN test_advocate_context domain
  WHERE advocate.key = 'advocate' AND domain.key = 'domain'
  RETURNING id
)
INSERT INTO test_advocate_context (key, value)
SELECT 'direct_intent', id FROM inserted;

SELECT extensions.is(
  (
    SELECT attribution.kind::text
    FROM public.sponsorship_attributions attribution
    JOIN test_advocate_context intent
      ON intent.key = 'direct_intent'
     AND intent.value = attribution.sponsorship_intent_id
  ),
  'direct',
  'an advocate-domain intent receives direct attribution'
);

SELECT extensions.ok(
  (
    SELECT intent.attribution_policy_version = attribution.policy_version
    FROM public.sponsorship_intents intent
    JOIN public.sponsorship_attributions attribution
      ON attribution.sponsorship_intent_id = intent.id
    JOIN test_advocate_context context
      ON context.key = 'primary_intent' AND context.value = intent.id
  ),
  'the attribution uses the policy selected by the database for the intent'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_intents
    SET base_amount_usd_cents = 9999
    WHERE id = (
      SELECT value FROM test_advocate_context WHERE key = 'primary_intent'
    )
  $$,
  '42501',
  'Sponsorship intent provenance and financial terms are immutable from creation',
  'intent financial truth cannot be rewritten after creation'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_attributions
    SET kind = 'unattributed'
    WHERE sponsorship_intent_id = (
      SELECT value FROM test_advocate_context WHERE key = 'primary_intent'
    )
  $$,
  '42501',
  'Final sponsorship attribution decisions are immutable',
  'attribution decisions cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.sponsorship_attributions
    WHERE sponsorship_intent_id = (
      SELECT value FROM test_advocate_context WHERE key = 'primary_intent'
    )
  $$,
  '42501',
  'Final sponsorship attribution decisions are immutable',
  'attribution decisions cannot be deleted'
);

SELECT extensions.throws_ok(
  'TRUNCATE public.sponsorship_attributions CASCADE',
  '42501',
  'Operational sponsorship tables cannot be truncated',
  'attribution decisions cannot be truncated'
);

UPDATE public.payment_provider_accounts
SET environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

INSERT INTO test_advocate_context (key, value)
SELECT 'payment_quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  (SELECT value FROM test_advocate_context WHERE key = 'primary_intent'),
  'STRIPE',
  'stripe_us',
  'foundation-quote-0001'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.sponsorship_payment_attempts (
      sponsorship_intent_id,
      payment_quote_id,
      checkout_receipt_digest,
      checkout_receipt_expires_at,
      attempt_number,
      provider,
      provider_account_scope,
      provider_idempotency_key,
      payment_mode,
      base_amount_usd_cents,
      charged_amount_minor,
      charged_currency,
      conversion_rate,
      currency_quote_at
    )
    SELECT
      intent.id,
      quote.value,
      decode(repeat('77', 32), 'hex'),
      clock_timestamp() + interval '1 day',
      1,
      'STRIPE',
      'stripe_us',
      'bad-terms-attempt-0001',
      intent.payment_mode,
      9999,
      intent.charged_amount_minor,
      intent.charged_currency,
      intent.conversion_rate,
      intent.currency_quote_at
    FROM public.sponsorship_intents intent
    JOIN test_advocate_context context
      ON context.key = 'primary_intent' AND context.value = intent.id
    CROSS JOIN test_advocate_context quote
    WHERE quote.key = 'payment_quote'
  $$,
  '23514',
  'Payment attempt terms must exactly match the sponsorship intent',
  'payment attempts cannot change intent financial terms'
);

INSERT INTO test_advocate_context (key, value)
SELECT 'payment_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  (SELECT value FROM test_advocate_context WHERE key = 'primary_intent'),
  (SELECT value FROM test_advocate_context WHERE key = 'payment_quote'),
  'STRIPE',
  'stripe_us',
  'foundation-attempt-0001',
  decode(repeat('88', 32), 'hex')
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM test_advocate_context WHERE key = 'payment_attempt'
  ),
  'a payment attempt with exact intent terms is accepted'
);

SELECT extensions.is(
  (
    SELECT attempt.provider_account_scope
    FROM public.sponsorship_payment_attempts attempt
    JOIN test_advocate_context context
      ON context.key = 'payment_attempt' AND context.value = attempt.id
  ),
  'stripe_us',
  'payment attempts reference the configured provider account registry'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_payment_attempts
    SET charged_amount_minor = 4444
    WHERE id = (
      SELECT value FROM test_advocate_context WHERE key = 'payment_attempt'
    )
  $$,
  '42501',
  'Payment attempt provenance and financial terms are immutable',
  'payment attempt financial terms are immutable'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.payment_gateway_events (
      provider,
      provider_account_scope,
      provider_event_id,
      event_type,
      payment_attempt_id,
      payload_sha256,
      signature_verified_at,
      occurred_at
    )
    SELECT
      'PAYPAL',
      'paypal',
      'gateway-mismatch-0001',
      'payment.completed',
      value,
      decode(repeat('33', 32), 'hex'),
      now(),
      now()
    FROM test_advocate_context
    WHERE key = 'payment_attempt'
  $$,
  '23514',
  'Gateway event provider account does not match its payment attempt',
  'gateway events cannot cross provider accounts'
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  (SELECT value FROM test_advocate_context WHERE key = 'payment_attempt'),
  'checkout_session',
  'cs_foundation_gateway_0001'
);

INSERT INTO test_advocate_context (key, value)
SELECT 'gateway_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM test_advocate_context WHERE key = 'payment_attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'gateway-valid-0001',
  target_event_type => 'checkout.session.async_payment_failed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_foundation_gateway_0001',
  target_redacted_payload => '{}'::jsonb,
  target_payload_ciphertext => decode(repeat('66', 32), 'hex'),
  target_payload_sha256 => decode(repeat('44', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM test_advocate_context WHERE key = 'payment_attempt'
  ),
  target_fact_failure_code => 'foundation_test_failure'
);

SELECT extensions.ok(
  (
    SELECT event.sponsorship_intent_id = attempt.sponsorship_intent_id
    FROM public.payment_gateway_events event
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = event.payment_attempt_id
    JOIN test_advocate_context context
      ON context.key = 'gateway_event' AND context.value = event.id
  ),
  'gateway events inherit and lock the intent from their payment attempt'
);

SELECT extensions.ok(
  (
    SELECT event.payload_retention_expires_at = event.received_at + interval '90 days'
      AND event.payload_redacted_at IS NULL
    FROM public.payment_gateway_events event
    JOIN test_advocate_context context
      ON context.key = 'gateway_event' AND context.value = event.id
  ),
  'encrypted gateway payloads receive an exact 90-day retention deadline'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.payment_gateway_events
    SET
      payload_ciphertext = NULL,
      payload_redacted_at = now()
    WHERE id = (
      SELECT value FROM test_advocate_context WHERE key = 'gateway_event'
    )
  $$,
  '42501',
  'Gateway event evidence is immutable',
  'gateway payload evidence cannot be redacted before its retention deadline'
);

SELECT audit.set_actor_context(
  'system',
  NULL,
  NULL,
  'foundation-test',
  'database-test',
  'request-foundation-1',
  NULL,
  NULL,
  NULL,
  '203.0.113.7',
  'foundation-test-agent',
  NULL,
  '{}'::jsonb
);

UPDATE public.advocates
SET display_name = 'Foundation Test Audited'
WHERE id = (
  SELECT value FROM test_advocate_context WHERE key = 'advocate'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.request_id = 'request-foundation-1'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'audit'
      AND column_definition.table_name = 'audit_events'
      AND column_definition.column_name IN ('client_ip', 'user_agent')
  ),
  'raw network evidence is absent from the indefinite audit ledger'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_event_forensics forensic
    JOIN audit.audit_events event ON event.id = forensic.audit_event_id
    WHERE event.request_id = 'request-foundation-1'
      AND forensic.client_ip = '203.0.113.7'
      AND forensic.expires_at = forensic.captured_at + interval '90 days'
  ),
  'raw audit forensics are isolated with an exact 90-day expiry'
);

SELECT extensions.throws_ok(
  $$
    DO $body$
    BEGIN
      SET CONSTRAINTS advocates_owner_invariant IMMEDIATE;
      INSERT INTO public.advocates (
        slug,
        display_name,
        relationship_status,
        publication_status
      )
      VALUES (
        'ownerlessactive',
        'Ownerless Active Portal',
        'active',
        'active'
      );
    END
    $body$
  $$,
  '23514',
  'An active advocate portal requires one active owner',
  'a published advocate portal cannot be ownerless'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'audit.set_actor_context(audit.audit_actor_type,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated callers cannot forge audit actor context'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.get_advocate_audit_events(uuid,bigint,integer)'
  ) IS NULL
  AND pg_get_function_result(
    'public.get_advocate_audit_history_page(uuid,uuid,integer)'::regprocedure
  ) = 'jsonb',
  'the raw row audit reader is removed in favor of one fixed JSON history page'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges privilege
    WHERE privilege.routine_schema = 'public'
      AND privilege.grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.routine_name = 'purge_expired_audit_forensics'
  ),
  'only the service role can invoke raw audit retention cleanup'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.purge_expired_gateway_event_payloads(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.purge_expired_gateway_event_payloads(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_gateway_event_payloads(integer)',
    'EXECUTE'
  ),
  'only the service role can invoke gateway payload retention cleanup'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.purge_expired_email_outbox_contact(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.purge_expired_email_outbox_contact(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_email_outbox_contact(integer)',
    'EXECUTE'
  ),
  'only the service role can invoke welcome email contact cleanup'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'public.role_assignments', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.role_assignments', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.role_assignments', 'DELETE')
  AND has_function_privilege(
    'authenticated',
    'public.replace_creator_share_user_roles(uuid,uuid[],text,text)',
    'EXECUTE'
  ),
  'global role changes use the narrow audited RPC instead of service table DML'
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
  '90000000-0000-4000-8000-000000000099'::uuid,
  'authenticated',
  'authenticated',
  'foundation-role-target@example.test',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

SELECT count(*)
FROM public.replace_creator_share_user_roles(
  '90000000-0000-4000-8000-000000000099'::uuid,
  ARRAY['5d45745a-cf33-40eb-b6d2-7e7826e8b1e1'::uuid],
  'Foundation role replacement test',
  'request-foundation-role-1'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id =
      '90000000-0000-4000-8000-000000000099'::uuid
      AND assignment.role_id =
        '5d45745a-cf33-40eb-b6d2-7e7826e8b1e1'::uuid
      AND assignment.organization_id IS NULL
      AND assignment.advocate_id IS NULL
  ),
  'the role replacement RPC assigns the requested global role'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'role_assignments'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        '3de44111-9900-4f04-815d-aeb42828229a'::uuid
      AND event.effective_user_id =
        '90000000-0000-4000-8000-000000000099'::uuid
      AND event.tool = 'creator-share-admin-users'
      AND event.request_id = 'request-foundation-role-1'
      AND event.reason = 'Foundation role replacement test'
  ),
  'global role replacement records actor, target, tool, request, and reason'
);

-- A global Creator Share role must not confer advocate portal access.
--
-- Every existing zero-access assertion covers actors who already hold an
-- advocate_memberships row: suspended, revoked, or archived. Nothing covered
-- the actor who holds only a global role and no membership at all, which is
-- exactly the shape a Creator Share staff account takes. Without this, a
-- change that widened get_my_advocate_portal_access() to consider global
-- role_assignments would pass the whole suite.

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '90000000-0000-4000-8000-000000000099',
  true
);

SELECT extensions.is(
  (SELECT count(*) FROM public.get_my_advocate_portal_access()),
  0::bigint,
  'a global Creator Share role grants no advocate portal access'
);

-- Repeat with the most privileged global role. Super administrator is the
-- account most likely to be mistaken for an advocate authority.
SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

SELECT count(*)
FROM public.replace_creator_share_user_roles(
  '90000000-0000-4000-8000-000000000099'::uuid,
  ARRAY['7363a1c9-5336-4a6d-a1df-16136313d385'::uuid],
  'Foundation super administrator portal isolation test',
  'request-foundation-role-2'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '90000000-0000-4000-8000-000000000099',
  true
);

SELECT extensions.is(
  (SELECT count(*) FROM public.get_my_advocate_portal_access()),
  0::bigint,
  'a global super administrator role still grants no advocate portal access'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.role_assignments assignment
    USING public.roles role
    WHERE role.id = assignment.role_id
      AND role.name = 'SUPER_ADMIN'
      AND assignment.organization_id IS NULL
      AND assignment.advocate_id IS NULL
  $$,
  '23514',
  'The final Creator Share super administrator cannot be removed',
  'concurrent and cascading role changes cannot remove the final super administrator'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.beneficiaries', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.activities', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.media', 'SELECT'),
  'anonymous callers cannot read public content base tables'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.activity_subscriptions', 'INSERT')
  AND NOT has_table_privilege(
    'authenticated',
    'public.activity_subscriptions',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.activity_subscriptions',
    'INSERT'
  )
  AND has_function_privilege(
    'service_role',
    'public.subscribe_to_beneficiary_updates(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.subscribe_to_beneficiary_updates(uuid,text,text)',
    'EXECUTE'
  ),
  'public update subscriptions use the server-only audited enrollment RPC'
);

SELECT extensions.ok(
  has_table_privilege('anon', 'public.public_beneficiaries', 'SELECT')
  AND has_table_privilege('anon', 'public.public_activities', 'SELECT')
  AND has_table_privilege('anon', 'public.public_media', 'SELECT'),
  'anonymous callers can read only explicit public content projections'
);

INSERT INTO public.beneficiaries (
  name,
  username,
  birth_date,
  status,
  location_geo,
  metadata
)
VALUES
  (
    'Foundation Public Beneficiary',
    'foundation-public-beneficiary',
    '2012-07-23',
    'New',
    public.ST_SetSRID(public.ST_MakePoint(-122.1234, 37.9876), 4326),
    '{"birth_date_is_estimate":true,"internal_case":"secret"}'::jsonb
  ),
  (
    'Foundation Draft Beneficiary',
    'foundation-draft-beneficiary',
    '2011-03-11',
    'Draft',
    public.ST_SetSRID(public.ST_MakePoint(-121.2222, 36.8888), 4326),
    '{"internal_case":"draft-secret"}'::jsonb
  );

SELECT public.subscribe_to_beneficiary_updates(
  (
    SELECT beneficiary.id
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.username = 'foundation-public-beneficiary'
  ),
  'subscriber@example.test',
  'request-foundation-subscribe-1'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.activity_subscriptions subscription
    JOIN public.beneficiaries beneficiary
      ON beneficiary.id = subscription.beneficiary_id
    WHERE beneficiary.username = 'foundation-public-beneficiary'
      AND subscription.email = 'subscriber@example.test'
  ),
  'the server enrollment RPC records a normalized subscription for a published beneficiary'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'activity_subscriptions'
      AND event.actor_type = 'system'
      AND event.system_actor = 'public-subscription-api'
      AND event.tool = 'beneficiary-update-subscription'
      AND event.request_id = 'request-foundation-subscribe-1'
  ),
  'public update enrollment records its trusted system actor, tool, and request'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.public_beneficiaries beneficiary
    WHERE beneficiary.username IN (
      'foundation-public-beneficiary',
      'foundation-draft-beneficiary'
    )
  ),
  1::bigint,
  'the public beneficiary projection excludes draft records'
);

SELECT extensions.ok(
  (
    SELECT
      beneficiary.birth_date = '2012-07-01'::date
      AND round(public.ST_X(beneficiary.location_geo)::numeric, 2) = -122.10
      AND round(public.ST_Y(beneficiary.location_geo)::numeric, 2) = 38.00
      AND beneficiary.metadata =
        '{"birth_date_is_estimate":true,"birth_date_precision":"month"}'::jsonb
    FROM public.public_beneficiaries beneficiary
    WHERE beneficiary.username = 'foundation-public-beneficiary'
  ),
  'the public beneficiary projection coarsens location and birth date and allowlists metadata'
);

INSERT INTO public.activities (
  beneficiary_id,
  title,
  description,
  is_public,
  user_id,
  created_by,
  metadata
)
SELECT
  beneficiary.id,
  activity.title,
  activity.description,
  activity.is_public,
  NULL,
  'system',
  '{"internal_note":"never public"}'::jsonb
FROM public.beneficiaries beneficiary
CROSS JOIN (
  VALUES
    ('Foundation Public Activity', 'Visible update', true),
    ('Foundation Private Activity', 'Private update', false)
) AS activity(title, description, is_public)
WHERE beneficiary.username = 'foundation-public-beneficiary';

SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM public.public_activities activity
    WHERE activity.title IN (
      'Foundation Public Activity',
      'Foundation Private Activity'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'public_activities'
      AND column_definition.column_name IN (
        'user_id',
        'created_by',
        'metadata',
        'images_url',
        'videos_url'
      )
  ),
  'the public activity projection excludes private rows and internal provenance fields'
);

INSERT INTO public.media (parent_id, extension, type, weight)
SELECT beneficiary.id, 'jpg', 'IMAGE', 1
FROM public.beneficiaries beneficiary
WHERE beneficiary.username IN (
  'foundation-public-beneficiary',
  'foundation-draft-beneficiary'
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.objects (bucket_id, name)
SELECT
  'media',
  media.parent_id::text
    || '/'
    || media.type::text
    || '/'
    || media.id::text
    || '.'
    || media.extension
FROM public.media media
JOIN public.beneficiaries beneficiary
  ON beneficiary.id = media.parent_id
WHERE beneficiary.username IN (
  'foundation-public-beneficiary',
  'foundation-draft-beneficiary'
);

SET LOCAL ROLE anon;

SELECT extensions.lives_ok(
  'SELECT count(*) FROM public.public_media',
  'anonymous public media reads use the private storage existence check through the view only'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.public_media media
    JOIN public.beneficiaries beneficiary ON beneficiary.id = media.parent_id
    WHERE beneficiary.username IN (
      'foundation-public-beneficiary',
      'foundation-draft-beneficiary'
    )
  ),
  1::bigint,
  'the public media projection requires stored objects and excludes media attached to unpublished beneficiaries'
);

SELECT extensions.ok(
  to_regclass('public.public_sponsorship_summaries') IS NULL
  AND to_regclass('public.public_beneficiary_sponsorship_milestones') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'public_beneficiary_sponsorship_milestones'
      AND column_definition.column_name NOT IN (
        'beneficiary_id',
        'sponsorship_count_floor'
      )
  )
  AND pg_get_viewdef(
    'public.public_beneficiary_sponsorship_milestones'::regclass,
    true
  ) LIKE '%floor(count(*)::numeric / 5%',
  'public sponsorship reporting exposes only milestones rounded down to groups of five'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'public_beneficiaries',
        'public_activities',
        'public_media',
        'public_beneficiary_sponsorship_milestones'
      )
      AND 'security_barrier=true' = ANY (relation.reloptions)
  ),
  4,
  'all public content projections use security barriers'
);

SELECT * FROM extensions.finish();

ROLLBACK;

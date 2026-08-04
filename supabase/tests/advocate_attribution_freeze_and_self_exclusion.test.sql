BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE attribution_freeze_test_context (
  key text PRIMARY KEY,
  uuid_value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE attribution_freeze_test_snapshots (
  label text PRIMARY KEY,
  sponsorship_intent_id uuid NOT NULL,
  kind public.sponsorship_attribution_kind NOT NULL,
  policy_version text NOT NULL,
  advocate_id uuid,
  exposure_id uuid,
  exposure_lag interval,
  decision_context jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  finalized_at timestamptz,
  conversion_occurred_at timestamptz,
  analytics_eligible boolean NOT NULL,
  analytics_exclusion_reason text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.activate_attribution_test_domain(
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

CREATE FUNCTION pg_temp.create_active_attribution_test_advocate(
  target_slug text,
  target_display_name text,
  target_owner_user_id uuid,
  target_hostname text,
  worker_id text
)
RETURNS TABLE (
  created_advocate_id uuid,
  created_domain_id uuid
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_advocate_id uuid;
  v_membership_id uuid;
  v_domain_id uuid;
BEGIN
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status
  )
  VALUES (
    target_slug,
    target_display_name,
    'active'
  )
  RETURNING id INTO v_advocate_id;

  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  VALUES (
    v_advocate_id,
    target_owner_user_id,
    'active'
  )
  RETURNING id INTO v_membership_id;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  VALUES (
    v_advocate_id,
    v_membership_id,
    '00000000-0000-4000-8000-000000000001'::uuid,
    target_owner_user_id
  );

  UPDATE public.advocates
  SET
    owner_membership_id = v_membership_id,
    publication_status = 'provisioning'
  WHERE id = v_advocate_id;

  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  VALUES (
    v_advocate_id,
    target_hostname,
    true
  )
  RETURNING id INTO v_domain_id;

  INSERT INTO public.advocate_domain_integrations (
    advocate_id,
    domain_id,
    provider,
    environment
  )
  SELECT
    v_advocate_id,
    v_domain_id,
    required.provider::public.advocate_domain_integration_provider,
    required.environment
  FROM (
    VALUES
      ('cloudflare', 'production'),
      ('vercel', 'production'),
      ('stripe_us', 'live'),
      ('stripe_uk', 'live'),
      ('paypal', 'live')
  ) AS required(provider, environment);

  PERFORM pg_temp.activate_attribution_test_domain(v_domain_id, worker_id);

  PERFORM public.publish_advocate_portal(
    v_advocate_id,
    (
      SELECT advocate.version
      FROM public.advocates advocate
      WHERE advocate.id = v_advocate_id
    ),
    v_domain_id,
    target_hostname,
    extensions.digest(target_slug || ':publication-canary', 'sha256'),
    clock_timestamp(),
    'Publish the attribution test fixture after provider settlement',
    worker_id || ':deployment',
    worker_id || ':publication-request',
    worker_id || ':publication-trace'
  );

  RETURN QUERY SELECT v_advocate_id, v_domain_id;
END;
$$;

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
SELECT
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  clock_timestamp(),
  '{}'::jsonb,
  jsonb_build_object('first_name', fixture.first_name, 'last_name', 'Test'),
  clock_timestamp(),
  clock_timestamp()
FROM (
  VALUES
    (
      '97000000-0000-4000-8000-000000000001'::uuid,
      'attribution-main-owner@example.test',
      'MainOwner'
    ),
    (
      '97000000-0000-4000-8000-000000000002'::uuid,
      'attribution-other-owner@example.test',
      'OtherOwner'
    ),
    (
      '97000000-0000-4000-8000-000000000003'::uuid,
      'attribution-employee@example.test',
      'Employee'
    ),
    (
      '97000000-0000-4000-8000-000000000004'::uuid,
      'attribution-superadmin@example.test',
      'Superadmin'
    ),
    (
      '97000000-0000-4000-8000-000000000005'::uuid,
      'attribution-active-member@example.test',
      'ActiveMember'
    ),
    (
      '97000000-0000-4000-8000-000000000006'::uuid,
      'attribution-suspended-member@example.test',
      'SuspendedMember'
    ),
    (
      '97000000-0000-4000-8000-000000000007'::uuid,
      'attribution-revoked-member@example.test',
      'RevokedMember'
    ),
    (
      '97000000-0000-4000-8000-000000000008'::uuid,
      'attribution-unrelated@example.test',
      'Unrelated'
    )
) AS fixture(id, email, first_name);

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT
  fixture.user_id,
  role.id,
  NULL,
  NULL
FROM (
  VALUES
    ('97000000-0000-4000-8000-000000000003'::uuid, 'EMPLOYEE'),
    ('97000000-0000-4000-8000-000000000004'::uuid, 'SUPER_ADMIN')
) AS fixture(user_id, role_name)
JOIN public.roles role ON role.name = fixture.role_name;

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

WITH created AS (
  SELECT *
  FROM pg_temp.create_active_attribution_test_advocate(
    'attributionfreeze',
    'Attribution Freeze',
    '97000000-0000-4000-8000-000000000001'::uuid,
    'attributionfreeze.creatorshare.com',
    'attribution-freeze-main-worker'
  )
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT fixture.key, fixture.uuid_value
FROM created
CROSS JOIN LATERAL (
  VALUES
    ('main_advocate', created.created_advocate_id),
    ('main_domain', created.created_domain_id)
) AS fixture(key, uuid_value);

WITH created AS (
  SELECT *
  FROM pg_temp.create_active_attribution_test_advocate(
    'attributionother',
    'Attribution Other',
    '97000000-0000-4000-8000-000000000002'::uuid,
    'attributionother.creatorshare.com',
    'attribution-freeze-other-worker'
  )
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT fixture.key, fixture.uuid_value
FROM created
CROSS JOIN LATERAL (
  VALUES
    ('other_advocate', created.created_advocate_id),
    ('other_domain', created.created_domain_id)
) AS fixture(key, uuid_value);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

INSERT INTO public.advocate_memberships (
  advocate_id,
  user_id,
  status,
  suspended_at,
  revoked_at
)
SELECT
  context.uuid_value,
  fixture.user_id,
  fixture.status::public.advocate_membership_status,
  CASE WHEN fixture.status = 'suspended' THEN clock_timestamp() END,
  CASE WHEN fixture.status = 'revoked' THEN clock_timestamp() END
FROM attribution_freeze_test_context context
CROSS JOIN (
  VALUES
    ('97000000-0000-4000-8000-000000000005'::uuid, 'active'),
    ('97000000-0000-4000-8000-000000000006'::uuid, 'suspended'),
    ('97000000-0000-4000-8000-000000000007'::uuid, 'revoked')
) AS fixture(user_id, status)
WHERE context.key = 'main_advocate';

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000001'::uuid,
      target_visitor_token_digest => decode(repeat('41', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000003'::uuid,
      context_request_id => 'attribution-exclude-employee'
    )
  ),
  0::bigint,
  'a global Creator Share employee silently creates no qualified exposure'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000002'::uuid,
      target_visitor_token_digest => decode(repeat('42', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000004'::uuid,
      context_request_id => 'attribution-exclude-superadmin'
    )
  ),
  0::bigint,
  'a global Creator Share super administrator silently creates no qualified exposure'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000003'::uuid,
      target_visitor_token_digest => decode(repeat('43', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000005'::uuid,
      context_request_id => 'attribution-exclude-active-member'
    )
  ),
  0::bigint,
  'an active member of the viewed portal silently creates no qualified exposure'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000004'::uuid,
      target_visitor_token_digest => decode(repeat('44', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000006'::uuid,
      context_request_id => 'attribution-exclude-suspended-member'
    )
  ),
  0::bigint,
  'a suspended member of the viewed portal silently creates no qualified exposure'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000005'::uuid,
      target_visitor_token_digest => decode(repeat('45', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000007'::uuid,
      context_request_id => 'attribution-exclude-revoked-member'
    )
  ),
  0::bigint,
  'a revoked member of the viewed portal silently creates no qualified exposure'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.browser_visitors visitor
    WHERE visitor.token_digest IN (
      decode(repeat('41', 32), 'hex'),
      decode(repeat('42', 32), 'hex'),
      decode(repeat('43', 32), 'hex'),
      decode(repeat('44', 32), 'hex'),
      decode(repeat('45', 32), 'hex')
    )
  ),
  0::bigint,
  'self traffic exclusion occurs before any browser visitor is persisted'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000006'::uuid,
      target_visitor_token_digest => decode(repeat('46', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000008'::uuid,
      context_request_id => 'attribution-unrelated-user'
    )
  ),
  1::bigint,
  'an authenticated user with no staff role or portal membership remains qualified'
);

SELECT extensions.ok(
  (
    SELECT exposure.auth_user_id = '97000000-0000-4000-8000-000000000008'::uuid
      AND exposure.advocate_id = context.uuid_value
    FROM public.advocate_exposures exposure
    JOIN attribution_freeze_test_context context ON context.key = 'main_advocate'
    WHERE exposure.event_key = '97100000-0000-4000-8000-000000000006'::uuid
  ),
  'the unrelated authenticated exposure retains its account and resolved tenant provenance'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000007'::uuid,
      target_visitor_token_digest => decode(repeat('47', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => NULL,
      context_request_id => 'attribution-guest-user'
    )
  ),
  1::bigint,
  'guest traffic remains qualified under the existing rules'
);

SELECT extensions.ok(
  (
    SELECT exposure.auth_user_id IS NULL
      AND exposure.advocate_id = context.uuid_value
    FROM public.advocate_exposures exposure
    JOIN attribution_freeze_test_context context ON context.key = 'main_advocate'
    WHERE exposure.event_key = '97100000-0000-4000-8000-000000000007'::uuid
  ),
  'the guest exposure remains anonymous and resolves to the viewed tenant'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000008'::uuid,
      target_visitor_token_digest => decode(repeat('48', 32), 'hex'),
      target_advocate_hostname => 'attributionfreeze.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000002'::uuid,
      context_request_id => 'attribution-cross-tenant-qualifies'
    )
  ),
  1::bigint,
  'a member of another advocate portal remains qualified on the viewed portal'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '97100000-0000-4000-8000-000000000009'::uuid,
      target_visitor_token_digest => decode(repeat('49', 32), 'hex'),
      target_advocate_hostname => 'attributionother.creatorshare.com',
      target_consent_state => 'not_required',
      target_auth_user_id => '97000000-0000-4000-8000-000000000002'::uuid,
      context_request_id => 'attribution-own-tenant-excluded'
    )
  ),
  0::bigint,
  'the same user is excluded when viewing the portal where they are a member'
);

INSERT INTO public.browser_visitors (
  token_digest,
  consent_state
)
SELECT
  decode(repeat(fixture.digest_pair, 32), 'hex'),
  'not_required'::public.visitor_consent_state
FROM (
  VALUES ('c1'), ('c2'), ('c3')
) AS fixture(digest_pair);

WITH prepared AS MATERIALIZED (
  SELECT
    fixture.label,
    checkout.resolved_sponsorship_intent_id
  FROM (
    VALUES
      (
        'staff',
        '97000000-0000-4000-8000-000000000003'::uuid,
        'c1',
        'd1'
      ),
      (
        'same_advocate_member',
        '97000000-0000-4000-8000-000000000005'::uuid,
        'c2',
        'd2'
      ),
      (
        'unrelated_sponsor',
        '97000000-0000-4000-8000-000000000008'::uuid,
        'c3',
        'd3'
      )
  ) AS fixture(label, auth_user_id, visitor_digest_pair, contact_digest_pair)
  CROSS JOIN LATERAL public.prepare_sponsorship_checkout_intent(
    target_idempotency_key =>
      'attribution-analytics-eligibility-' || fixture.label,
    target_source => 'advocate_domain',
    target_advocate_hostname => 'attributionfreeze.creatorshare.com',
    target_visitor_token_digest =>
      decode(repeat(fixture.visitor_digest_pair, 32), 'hex'),
    target_auth_user_id => fixture.auth_user_id,
    target_contact_email_hmac =>
      decode(repeat(fixture.contact_digest_pair, 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 2800,
    target_charged_amount_minor => 2800,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => clock_timestamp(),
    target_currency_rate_source => 'attribution-freeze-test',
    context_request_id =>
      'attribution-analytics-eligibility-' || fixture.label
  ) checkout
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT 'analytics_eligibility_' || prepared.label, prepared.resolved_sponsorship_intent_id
FROM prepared;

SELECT extensions.ok(
  (
    SELECT bool_and(
      attribution.kind = 'direct'
      AND attribution.advocate_id = advocate.uuid_value
    )
    FROM attribution_freeze_test_context intent
    JOIN public.sponsorship_attributions attribution
      ON attribution.sponsorship_intent_id = intent.uuid_value
    JOIN attribution_freeze_test_context advocate
      ON advocate.key = 'main_advocate'
    WHERE intent.key LIKE 'analytics_eligibility_%'
  ),
  'analytics eligibility never rewrites factual direct attribution provenance'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      NOT attribution.analytics_eligible
      AND attribution.analytics_exclusion_reason = CASE intent.key
        WHEN 'analytics_eligibility_staff' THEN 'creator_share_staff'
        ELSE 'same_advocate_member'
      END
    )
    FROM attribution_freeze_test_context intent
    JOIN public.sponsorship_attributions attribution
      ON attribution.sponsorship_intent_id = intent.uuid_value
    WHERE intent.key IN (
      'analytics_eligibility_staff',
      'analytics_eligibility_same_advocate_member'
    )
  ),
  'staff and same-advocate sponsorships receive immutable noncontact exclusion reasons'
);

SELECT extensions.ok(
  (
    SELECT attribution.analytics_eligible
      AND attribution.analytics_exclusion_reason IS NULL
    FROM attribution_freeze_test_context intent
    JOIN public.sponsorship_attributions attribution
      ON attribution.sponsorship_intent_id = intent.uuid_value
    WHERE intent.key = 'analytics_eligibility_unrelated_sponsor'
  ),
  'an unrelated authenticated sponsor remains eligible for advocate analytics'
);

WITH first_touch AS MATERIALIZED (
  SELECT *
  FROM public.record_qualified_advocate_exposure(
    target_event_key => '97200000-0000-4000-8000-000000000001'::uuid,
    target_visitor_token_digest => decode(repeat('a1', 32), 'hex'),
    target_advocate_hostname => 'attributionfreeze.creatorshare.com',
    target_consent_state => 'not_required',
    target_page_path => '/children',
    context_request_id => 'attribution-first-pre-intent-touch'
  )
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT fixture.key, fixture.uuid_value
FROM first_touch
CROSS JOIN LATERAL (
  VALUES
    ('frozen_visitor', first_touch.resolved_browser_visitor_id),
    ('frozen_first_exposure', first_touch.resolved_advocate_exposure_id)
) AS fixture(key, uuid_value);

WITH latest_touch AS MATERIALIZED (
  SELECT *
  FROM public.record_qualified_advocate_exposure(
    target_event_key => '97200000-0000-4000-8000-000000000002'::uuid,
    target_visitor_token_digest => decode(repeat('a1', 32), 'hex'),
    target_advocate_hostname => 'attributionother.creatorshare.com',
    target_consent_state => 'not_required',
    target_page_path => '/about',
    context_request_id => 'attribution-latest-pre-intent-touch'
  )
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT 'frozen_latest_exposure', resolved_advocate_exposure_id
FROM latest_touch;

WITH prepared AS MATERIALIZED (
  SELECT *
  FROM public.prepare_sponsorship_checkout_intent(
    target_idempotency_key => 'attribution-freeze-primary-intent-0001',
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => decode(repeat('a1', 32), 'hex'),
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(repeat('b1', 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 2500,
    target_charged_amount_minor => 2500,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => clock_timestamp(),
    target_currency_rate_source => 'attribution-freeze-test',
    context_request_id => 'attribution-freeze-primary-intent'
  )
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT 'frozen_intent', resolved_sponsorship_intent_id
FROM prepared;

INSERT INTO attribution_freeze_test_snapshots
SELECT
  'frozen',
  attribution.sponsorship_intent_id,
  attribution.kind,
  attribution.policy_version,
  attribution.advocate_id,
  attribution.exposure_id,
  attribution.exposure_lag,
  attribution.decision_context,
  attribution.decided_at,
  attribution.finalized_at,
  attribution.conversion_occurred_at,
  attribution.analytics_eligible,
  attribution.analytics_exclusion_reason
FROM public.sponsorship_attributions attribution
JOIN attribution_freeze_test_context context
  ON context.key = 'frozen_intent'
 AND context.uuid_value = attribution.sponsorship_intent_id;

SELECT extensions.ok(
  (
    SELECT snapshot.kind = 'post_visit_attributed'
      AND snapshot.advocate_id = advocate.uuid_value
      AND snapshot.exposure_id = exposure.uuid_value
      AND snapshot.exposure_lag IS NOT NULL
      AND snapshot.finalized_at IS NULL
    FROM attribution_freeze_test_snapshots snapshot
    JOIN attribution_freeze_test_context advocate ON advocate.key = 'other_advocate'
    JOIN attribution_freeze_test_context exposure ON exposure.key = 'frozen_latest_exposure'
    WHERE snapshot.label = 'frozen'
  ),
  'the intent provisionally locks the latest qualifying touch that existed before creation'
);

SELECT *
FROM public.record_qualified_advocate_exposure(
  target_event_key => '97200000-0000-4000-8000-000000000003'::uuid,
  target_visitor_token_digest => decode(repeat('a1', 32), 'hex'),
  target_advocate_hostname => 'attributionfreeze.creatorshare.com',
  target_consent_state => 'not_required',
  target_page_path => '/sponsor',
  context_request_id => 'attribution-post-intent-touch'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_attributions
    SET
      finalized_at = clock_timestamp(),
      conversion_occurred_at = clock_timestamp(),
      analytics_eligible = NOT analytics_eligible
    WHERE sponsorship_intent_id = (
      SELECT uuid_value
      FROM attribution_freeze_test_context
      WHERE key = 'frozen_intent'
    )
  $$,
  '42501',
  'Final sponsorship attribution decisions are immutable',
  'a finalization shaped update cannot rewrite frozen analytics eligibility'
);

SELECT private.finalize_sponsorship_attribution(
  (
    SELECT uuid_value
    FROM attribution_freeze_test_context
    WHERE key = 'frozen_intent'
  ),
  clock_timestamp() + interval '1 minute'
);

SELECT extensions.ok(
  (
    SELECT attribution.kind = snapshot.kind
      AND attribution.advocate_id IS NOT DISTINCT FROM snapshot.advocate_id
      AND attribution.exposure_id IS NOT DISTINCT FROM snapshot.exposure_id
      AND attribution.exposure_lag IS NOT DISTINCT FROM snapshot.exposure_lag
      AND attribution.policy_version = snapshot.policy_version
      AND attribution.decided_at = snapshot.decided_at
      AND attribution.analytics_eligible IS NOT DISTINCT FROM
        snapshot.analytics_eligible
      AND attribution.analytics_exclusion_reason IS NOT DISTINCT FROM
        snapshot.analytics_exclusion_reason
      AND attribution.finalized_at IS NOT NULL
      AND attribution.conversion_occurred_at IS NOT NULL
    FROM public.sponsorship_attributions attribution
    JOIN attribution_freeze_test_snapshots snapshot
      ON snapshot.sponsorship_intent_id = attribution.sponsorship_intent_id
    WHERE snapshot.label = 'frozen'
  ),
  'a post intent visit cannot replace the frozen kind, advocate, exposure, lag, policy, or decision time'
);

SELECT extensions.ok(
  (
    SELECT attribution.decision_context @> snapshot.decision_context
      AND attribution.decision_context ->> 'decision_stage' = 'first_verified_success'
      AND attribution.decision_context ->> 'provisional_kind' = snapshot.kind::text
      AND attribution.decision_context ? 'attribution_locked_at'
      AND attribution.decision_context ? 'conversion_occurred_at'
    FROM public.sponsorship_attributions attribution
    JOIN attribution_freeze_test_snapshots snapshot
      ON snapshot.sponsorship_intent_id = attribution.sponsorship_intent_id
    WHERE snapshot.label = 'frozen'
  ),
  'finalization preserves the provisional context and appends only safe decision metadata'
);

INSERT INTO public.browser_visitors (
  token_digest,
  consent_state
)
VALUES (
  decode(repeat('a2', 32), 'hex'),
  'not_required'
)
RETURNING id;

WITH visitor AS (
  SELECT id
  FROM public.browser_visitors
  WHERE token_digest = decode(repeat('a2', 32), 'hex')
), prepared AS MATERIALIZED (
  SELECT *
  FROM public.prepare_sponsorship_checkout_intent(
    target_idempotency_key => 'attribution-freeze-unattributed-0001',
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => decode(repeat('a2', 32), 'hex'),
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(repeat('b2', 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 2600,
    target_charged_amount_minor => 2600,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => clock_timestamp(),
    target_currency_rate_source => 'attribution-freeze-test',
    context_request_id => 'attribution-freeze-unattributed-intent'
  )
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT fixture.key, fixture.uuid_value
FROM prepared
CROSS JOIN visitor
CROSS JOIN LATERAL (
  VALUES
    ('unattributed_visitor', visitor.id),
    ('unattributed_intent', prepared.resolved_sponsorship_intent_id)
) AS fixture(key, uuid_value);

INSERT INTO attribution_freeze_test_snapshots
SELECT
  'unattributed',
  attribution.sponsorship_intent_id,
  attribution.kind,
  attribution.policy_version,
  attribution.advocate_id,
  attribution.exposure_id,
  attribution.exposure_lag,
  attribution.decision_context,
  attribution.decided_at,
  attribution.finalized_at,
  attribution.conversion_occurred_at,
  attribution.analytics_eligible,
  attribution.analytics_exclusion_reason
FROM public.sponsorship_attributions attribution
JOIN attribution_freeze_test_context context
  ON context.key = 'unattributed_intent'
 AND context.uuid_value = attribution.sponsorship_intent_id;

SELECT extensions.is(
  (
    SELECT kind::text
    FROM attribution_freeze_test_snapshots
    WHERE label = 'unattributed'
  ),
  'unattributed',
  'a visitor with no qualifying pre-intent exposure is provisionally unattributed'
);

SELECT *
FROM public.record_qualified_advocate_exposure(
  target_event_key => '97200000-0000-4000-8000-000000000004'::uuid,
  target_visitor_token_digest => decode(repeat('a2', 32), 'hex'),
  target_advocate_hostname => 'attributionfreeze.creatorshare.com',
  target_consent_state => 'not_required',
  context_request_id => 'attribution-unattributed-post-intent-touch'
);

SELECT private.finalize_sponsorship_attribution(
  (
    SELECT uuid_value
    FROM attribution_freeze_test_context
    WHERE key = 'unattributed_intent'
  ),
  clock_timestamp() + interval '1 minute'
);

SELECT extensions.ok(
  (
    SELECT attribution.kind = 'unattributed'
      AND attribution.advocate_id IS NULL
      AND attribution.exposure_id IS NULL
      AND attribution.exposure_lag IS NULL
      AND attribution.decided_at = snapshot.decided_at
      AND attribution.finalized_at IS NOT NULL
    FROM public.sponsorship_attributions attribution
    JOIN attribution_freeze_test_snapshots snapshot
      ON snapshot.sponsorship_intent_id = attribution.sponsorship_intent_id
    WHERE snapshot.label = 'unattributed'
  ),
  'a provisional unattributed decision stays unattributed after a later portal visit'
);

INSERT INTO public.browser_visitors (
  token_digest,
  consent_state
)
VALUES (
  decode(repeat('a3', 32), 'hex'),
  'not_required'
)
RETURNING id;

WITH visitor AS (
  SELECT id
  FROM public.browser_visitors
  WHERE token_digest = decode(repeat('a3', 32), 'hex')
), prepared AS MATERIALIZED (
  SELECT *
  FROM public.prepare_sponsorship_checkout_intent(
    target_idempotency_key => 'attribution-freeze-direct-intent-0001',
    target_source => 'advocate_domain',
    target_advocate_hostname => 'attributionfreeze.creatorshare.com',
    target_visitor_token_digest => decode(repeat('a3', 32), 'hex'),
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(repeat('b3', 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 2700,
    target_charged_amount_minor => 2700,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => clock_timestamp(),
    target_currency_rate_source => 'attribution-freeze-test',
    context_request_id => 'attribution-freeze-direct-intent'
  )
)
INSERT INTO attribution_freeze_test_context (key, uuid_value)
SELECT fixture.key, fixture.uuid_value
FROM prepared
CROSS JOIN visitor
CROSS JOIN LATERAL (
  VALUES
    ('direct_visitor', visitor.id),
    ('direct_intent', prepared.resolved_sponsorship_intent_id)
) AS fixture(key, uuid_value);

INSERT INTO attribution_freeze_test_snapshots
SELECT
  'direct',
  attribution.sponsorship_intent_id,
  attribution.kind,
  attribution.policy_version,
  attribution.advocate_id,
  attribution.exposure_id,
  attribution.exposure_lag,
  attribution.decision_context,
  attribution.decided_at,
  attribution.finalized_at,
  attribution.conversion_occurred_at,
  attribution.analytics_eligible,
  attribution.analytics_exclusion_reason
FROM public.sponsorship_attributions attribution
JOIN attribution_freeze_test_context context
  ON context.key = 'direct_intent'
 AND context.uuid_value = attribution.sponsorship_intent_id;

SELECT extensions.ok(
  (
    SELECT snapshot.kind = 'direct'
      AND snapshot.advocate_id = advocate.uuid_value
      AND snapshot.exposure_id IS NULL
      AND snapshot.exposure_lag IS NULL
    FROM attribution_freeze_test_snapshots snapshot
    JOIN attribution_freeze_test_context advocate ON advocate.key = 'main_advocate'
    WHERE snapshot.label = 'direct'
  ),
  'an advocate domain intent is provisionally direct to its source advocate'
);

SELECT *
FROM public.record_qualified_advocate_exposure(
  target_event_key => '97200000-0000-4000-8000-000000000005'::uuid,
  target_visitor_token_digest => decode(repeat('a3', 32), 'hex'),
  target_advocate_hostname => 'attributionother.creatorshare.com',
  target_consent_state => 'not_required',
  context_request_id => 'attribution-direct-post-intent-touch'
);

SELECT private.finalize_sponsorship_attribution(
  (
    SELECT uuid_value
    FROM attribution_freeze_test_context
    WHERE key = 'direct_intent'
  ),
  clock_timestamp() + interval '1 minute'
);

SELECT extensions.ok(
  (
    SELECT attribution.kind = 'direct'
      AND attribution.advocate_id = snapshot.advocate_id
      AND attribution.exposure_id IS NULL
      AND attribution.exposure_lag IS NULL
      AND attribution.decided_at = snapshot.decided_at
      AND attribution.finalized_at IS NOT NULL
    FROM public.sponsorship_attributions attribution
    JOIN attribution_freeze_test_snapshots snapshot
      ON snapshot.sponsorship_intent_id = attribution.sponsorship_intent_id
    WHERE snapshot.label = 'direct'
  ),
  'direct attribution stays bound to its source advocate after later visits elsewhere'
);

CREATE TEMP TABLE attribution_freeze_idempotency_snapshot ON COMMIT DROP AS
SELECT
  attribution.sponsorship_intent_id,
  attribution.finalized_at,
  attribution.conversion_occurred_at,
  attribution.decision_context
FROM public.sponsorship_attributions attribution
JOIN attribution_freeze_test_context context
  ON context.key = 'frozen_intent'
 AND context.uuid_value = attribution.sponsorship_intent_id;

SELECT private.finalize_sponsorship_attribution(
  (
    SELECT uuid_value
    FROM attribution_freeze_test_context
    WHERE key = 'frozen_intent'
  ),
  clock_timestamp() + interval '2 minutes'
);

SELECT extensions.ok(
  (
    SELECT attribution.finalized_at = snapshot.finalized_at
      AND attribution.conversion_occurred_at = snapshot.conversion_occurred_at
      AND attribution.decision_context = snapshot.decision_context
    FROM public.sponsorship_attributions attribution
    JOIN attribution_freeze_idempotency_snapshot snapshot
      USING (sponsorship_intent_id)
  ),
  'replayed finalization is idempotent and cannot replace the first verified conversion facts'
);

SELECT extensions.finish();

ROLLBACK;

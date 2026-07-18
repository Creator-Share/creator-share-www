BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE checkout_boundary_test_context (
  key text PRIMARY KEY,
  uuid_value uuid
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
    '96000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'checkout-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Checkout","last_name":"Owner"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '96000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'checkout-account-a@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Account","last_name":"Alpha"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '96000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'checkout-account-b@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Account","last_name":"Beta"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status
  )
  VALUES (
    'checkoutboundary',
    'Checkout Boundary',
    'active'
  )
  RETURNING id
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT 'advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  SELECT
    uuid_value,
    '96000000-0000-4000-8000-000000000001'::uuid,
    'active'
  FROM checkout_boundary_test_context
  WHERE key = 'advocate'
  RETURNING id, advocate_id
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT 'owner_membership', id FROM inserted;

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
SELECT
  advocate.uuid_value,
  membership.uuid_value,
  '00000000-0000-4000-8000-000000000001'::uuid,
  '96000000-0000-4000-8000-000000000001'::uuid
FROM checkout_boundary_test_context advocate
CROSS JOIN checkout_boundary_test_context membership
WHERE advocate.key = 'advocate'
  AND membership.key = 'owner_membership';

UPDATE public.advocates
SET
  owner_membership_id = (
    SELECT uuid_value
    FROM checkout_boundary_test_context
    WHERE key = 'owner_membership'
  ),
  publication_status = 'provisioning'
WHERE id = (
  SELECT uuid_value
  FROM checkout_boundary_test_context
  WHERE key = 'advocate'
);

UPDATE public.advocates
SET publication_status = 'active'
WHERE id = (
  SELECT uuid_value
  FROM checkout_boundary_test_context
  WHERE key = 'advocate'
);

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    uuid_value,
    'checkoutboundary.creatorshare.com',
    true
  FROM checkout_boundary_test_context
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT 'domain', id FROM inserted;

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.uuid_value,
  domain.uuid_value,
  required.provider::public.advocate_domain_integration_provider,
  required.environment
FROM checkout_boundary_test_context advocate
CROSS JOIN checkout_boundary_test_context domain
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

UPDATE public.advocate_domain_integrations
SET status = 'provisioning'
WHERE domain_id = (
  SELECT uuid_value
  FROM checkout_boundary_test_context
  WHERE key = 'domain'
);

UPDATE public.advocate_domain_integrations
SET status = 'ready'
WHERE domain_id = (
  SELECT uuid_value
  FROM checkout_boundary_test_context
  WHERE key = 'domain'
);

UPDATE public.advocate_domains
SET status = 'provisioning'
WHERE id = (
  SELECT uuid_value
  FROM checkout_boundary_test_context
  WHERE key = 'domain'
);

UPDATE public.advocate_domains
SET status = 'verifying'
WHERE id = (
  SELECT uuid_value
  FROM checkout_boundary_test_context
  WHERE key = 'domain'
);

UPDATE public.advocate_domains
SET status = 'active'
WHERE id = (
  SELECT uuid_value
  FROM checkout_boundary_test_context
  WHERE key = 'domain'
);

WITH recorded AS MATERIALIZED (
  SELECT *
  FROM public.record_qualified_advocate_exposure(
    target_event_key => '96100000-0000-4000-8000-000000000001'::uuid,
    target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
    target_advocate_hostname => 'checkoutboundary.creatorshare.com',
    target_consent_state => 'granted',
    target_page_path => '/children',
    target_referrer_host => 'social.example',
    context_request_id => 'checkout-exposure-first'
  )
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT fixture.key, fixture.uuid_value
FROM recorded
CROSS JOIN LATERAL (
  VALUES
    ('visitor', recorded.resolved_browser_visitor_id),
    ('first_exposure', recorded.resolved_advocate_exposure_id)
) AS fixture(key, uuid_value);

SELECT extensions.ok(
  (
    SELECT visitor.retention_expires_at = visitor.last_seen_at + interval '400 days'
      AND visitor.consent_state = 'granted'
      AND visitor.revoked_at IS NULL
    FROM public.browser_visitors visitor
    JOIN checkout_boundary_test_context context
      ON context.key = 'visitor'
     AND context.uuid_value = visitor.id
  ),
  'qualified exposure upserts one consented visitor with an exact 400 day rolling retention period'
);

SELECT extensions.ok(
  (
    SELECT exposure.is_qualified
      AND exposure.exclusion_reason IS NULL
      AND exposure.advocate_id = advocate.uuid_value
      AND exposure.advocate_domain_id = domain.uuid_value
      AND exposure.browser_visitor_id = visitor.uuid_value
      AND exposure.page_path = '/children'
      AND exposure.referrer_host = 'social.example'
    FROM public.advocate_exposures exposure
    JOIN checkout_boundary_test_context exposure_context
      ON exposure_context.key = 'first_exposure'
     AND exposure_context.uuid_value = exposure.id
    JOIN checkout_boundary_test_context advocate ON advocate.key = 'advocate'
    JOIN checkout_boundary_test_context domain ON domain.key = 'domain'
    JOIN checkout_boundary_test_context visitor ON visitor.key = 'visitor'
  ),
  'qualified exposure derives advocate and domain identity from the exact active hostname'
);

SELECT extensions.ok(
  (
    SELECT result.replayed
      AND result.resolved_advocate_exposure_id = context.uuid_value
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '96100000-0000-4000-8000-000000000001'::uuid,
      target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
      target_advocate_hostname => 'checkoutboundary.creatorshare.com',
      target_consent_state => 'granted',
      target_page_path => '/children',
      target_referrer_host => 'social.example',
      context_request_id => 'checkout-exposure-first-replay'
    ) result
    JOIN checkout_boundary_test_context context ON context.key = 'first_exposure'
  ),
  'an exact exposure event replay returns the original append-only exposure'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '96100000-0000-4000-8000-000000000001'::uuid,
      target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
      target_advocate_hostname => 'checkoutboundary.creatorshare.com',
      target_consent_state => 'granted',
      target_page_path => '/different-path',
      target_referrer_host => 'social.example'
    )
  $$,
  '23505',
  'Advocate exposure event key was replayed with different terms',
  'an exposure event key cannot be replayed with changed provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '96100000-0000-4000-8000-000000000010'::uuid,
      target_visitor_token_digest => decode(repeat('10', 32), 'hex'),
      target_advocate_hostname => 'not-active.creatorshare.com',
      target_consent_state => 'granted'
    )
  $$,
  '23514',
  'Qualified advocate exposure requires an exact active advocate domain',
  'unregistered Host input cannot manufacture an advocate exposure'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.record_qualified_advocate_exposure(
      target_event_key => '96100000-0000-4000-8000-000000000011'::uuid,
      target_visitor_token_digest => decode(repeat('12', 32), 'hex'),
      target_advocate_hostname => 'checkoutboundary.creatorshare.com',
      target_consent_state => 'unknown'
    )
  $$,
  '23514',
  'Qualified advocate exposure requires affirmative consent state',
  'unknown consent cannot be converted into a qualified exposure'
);

WITH recorded AS (
  SELECT *
  FROM public.record_qualified_advocate_exposure(
    target_event_key => '96100000-0000-4000-8000-000000000002'::uuid,
    target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
    target_advocate_hostname => 'checkoutboundary.creatorshare.com',
    target_consent_state => 'granted',
    target_page_path => '/sponsor',
    context_request_id => 'checkout-exposure-second'
  )
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT 'latest_exposure', resolved_advocate_exposure_id
FROM recorded;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.browser_visitors visitor
    WHERE visitor.token_digest = decode(repeat('11', 32), 'hex')
  ),
  1,
  'repeated qualified visits reuse one opaque browser visitor'
);

WITH prepared AS MATERIALIZED (
  SELECT *
  FROM public.prepare_sponsorship_checkout_intent(
    target_idempotency_key => 'checkout-boundary-direct-0001',
    target_source => 'advocate_domain',
    target_advocate_hostname => 'checkoutboundary.creatorshare.com',
    target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(repeat('aa', 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'recurring',
    target_recurrence_interval => 'month',
    target_base_amount_usd_cents => 3333,
    target_charged_amount_minor => 3333,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => now(),
    target_currency_rate_source => 'checkout-boundary-test',
    context_request_id => 'checkout-intent-direct'
  )
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT fixture.key, fixture.uuid_value
FROM prepared
CROSS JOIN LATERAL (
  VALUES
    ('direct_intent', prepared.resolved_sponsorship_intent_id),
    ('guest_identity', prepared.resolved_sponsor_identity_id)
) AS fixture(key, uuid_value);

SELECT extensions.ok(
  (
    SELECT intent.source = 'advocate_domain'
      AND intent.source_host = 'checkoutboundary.creatorshare.com'
      AND intent.source_advocate_id = advocate.uuid_value
      AND intent.source_advocate_domain_id = domain.uuid_value
      AND attribution.kind = 'direct'
      AND attribution.advocate_id = advocate.uuid_value
      AND attribution.exposure_id IS NULL
      AND attribution.finalized_at IS NULL
    FROM public.sponsorship_intents intent
    JOIN public.sponsorship_attributions attribution
      ON attribution.sponsorship_intent_id = intent.id
    JOIN checkout_boundary_test_context intent_context
      ON intent_context.key = 'direct_intent'
     AND intent_context.uuid_value = intent.id
    JOIN checkout_boundary_test_context advocate ON advocate.key = 'advocate'
    JOIN checkout_boundary_test_context domain ON domain.key = 'domain'
  ),
  'an exact active advocate source creates direct provisional attribution atomically'
);

SELECT extensions.is(
  (
    SELECT identifier.confidence::text
    FROM public.sponsor_identifiers identifier
    JOIN checkout_boundary_test_context identity
      ON identity.key = 'guest_identity'
     AND identity.uuid_value = identifier.sponsor_identity_id
    WHERE identifier.kind = 'email'
  ),
  'unverified',
  'guest checkout creates a stable but explicitly unverified email identity'
);

SELECT extensions.ok(
  (
    SELECT result.replayed
      AND result.resolved_sponsorship_intent_id = context.uuid_value
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key => 'checkout-boundary-direct-0001',
      target_source => 'advocate_domain',
      target_advocate_hostname => 'checkoutboundary.creatorshare.com',
      target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
      target_auth_user_id => NULL,
      target_contact_email_hmac => decode(repeat('aa', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_partnership_project => NULL,
      target_payment_mode => 'recurring',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 3333,
      target_charged_amount_minor => 3333,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => now(),
      target_currency_rate_source => 'checkout-boundary-test',
      context_request_id => 'checkout-intent-direct-replay'
    ) result
    JOIN checkout_boundary_test_context context ON context.key = 'direct_intent'
  ),
  'an exact sponsorship intent replay returns the original immutable intent'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.sponsorship_attributions attribution
    WHERE attribution.sponsorship_intent_id = (
      SELECT uuid_value
      FROM checkout_boundary_test_context
      WHERE key = 'direct_intent'
    )
  ),
  1,
  'intent replay cannot duplicate the attribution decision'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key => 'checkout-boundary-direct-0001',
      target_source => 'advocate_domain',
      target_advocate_hostname => 'checkoutboundary.creatorshare.com',
      target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
      target_auth_user_id => NULL,
      target_contact_email_hmac => decode(repeat('aa', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_partnership_project => NULL,
      target_payment_mode => 'recurring',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 4444,
      target_charged_amount_minor => 4444,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => now(),
      target_currency_rate_source => 'checkout-boundary-test'
    )
  $$,
  '23505',
  'Sponsorship intent idempotency key was replayed with different terms',
  'intent idempotency is bound to exact financial and provenance terms'
);

WITH prepared AS (
  SELECT *
  FROM public.prepare_sponsorship_checkout_intent(
    target_idempotency_key => 'checkout-boundary-primary-0001',
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => decode(repeat('11', 32), 'hex'),
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(repeat('aa', 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'recurring',
    target_recurrence_interval => 'month',
    target_base_amount_usd_cents => 3333,
    target_charged_amount_minor => 3333,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => now(),
    target_currency_rate_source => 'checkout-boundary-test',
    context_request_id => 'checkout-intent-primary'
  )
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT 'primary_intent', resolved_sponsorship_intent_id
FROM prepared;

SELECT extensions.ok(
  (
    SELECT intent.source = 'primary_site'
      AND intent.source_host = 'creatorshare.com'
      AND intent.source_advocate_id IS NULL
      AND intent.source_advocate_domain_id IS NULL
      AND intent.sponsor_identity_id = identity.uuid_value
    FROM public.sponsorship_intents intent
    JOIN checkout_boundary_test_context intent_context
      ON intent_context.key = 'primary_intent'
     AND intent_context.uuid_value = intent.id
    JOIN checkout_boundary_test_context identity ON identity.key = 'guest_identity'
  ),
  'local and production primary flows use one canonical conceptual host without persisting arbitrary Host input'
);

SELECT extensions.ok(
  (
    SELECT attribution.kind = 'post_visit_attributed'
      AND attribution.advocate_id = advocate.uuid_value
      AND attribution.exposure_id = latest_exposure.uuid_value
    FROM public.sponsorship_attributions attribution
    JOIN checkout_boundary_test_context intent
      ON intent.key = 'primary_intent'
     AND intent.uuid_value = attribution.sponsorship_intent_id
    JOIN checkout_boundary_test_context advocate ON advocate.key = 'advocate'
    JOIN checkout_boundary_test_context latest_exposure
      ON latest_exposure.key = 'latest_exposure'
  ),
  'a primary intent uses the most recent qualifying advocate visit for post visit attribution'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.sponsor_identifiers identifier
    WHERE identifier.kind = 'email'
      AND identifier.issuer_scope = 'creator_share'
      AND identifier.identifier_digest = decode(repeat('aa', 32), 'hex')
  ),
  1,
  'direct and later primary checkout resolve the same stable email identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key => 'checkout-boundary-local-host',
      target_source => 'primary_site',
      target_advocate_hostname => 'localhost',
      target_visitor_token_digest => NULL,
      target_auth_user_id => NULL,
      target_contact_email_hmac => decode(repeat('ac', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_partnership_project => NULL,
      target_payment_mode => 'recurring',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 3333,
      target_charged_amount_minor => 3333,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => now(),
      target_currency_rate_source => 'checkout-boundary-test'
    )
  $$,
  '22023',
  'Primary site intents use the canonical conceptual host',
  'primary intent preparation never trusts a caller supplied local or production Host value'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key => 'checkout-boundary-small-amount',
      target_source => 'primary_site',
      target_advocate_hostname => NULL,
      target_visitor_token_digest => NULL,
      target_auth_user_id => NULL,
      target_contact_email_hmac => decode(repeat('ad', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_partnership_project => NULL,
      target_payment_mode => 'recurring',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 499,
      target_charged_amount_minor => 499,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => now(),
      target_currency_rate_source => 'checkout-boundary-test'
    )
  $$,
  '23514',
  'Sponsorship amount is outside product bounds or fails currency conversion',
  'database amount bounds reject an underpriced browser request before identity or intent creation'
);

WITH prepared AS (
  SELECT *
  FROM public.prepare_sponsorship_checkout_intent(
    target_idempotency_key => 'checkout-boundary-guest-conflict',
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => NULL,
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(repeat('cc', 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'recurring',
    target_recurrence_interval => 'month',
    target_base_amount_usd_cents => 3333,
    target_charged_amount_minor => 3333,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => now(),
    target_currency_rate_source => 'checkout-boundary-test'
  )
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT 'conflicting_guest_identity', resolved_sponsor_identity_id
FROM prepared;

WITH prepared AS (
  SELECT *
  FROM public.prepare_sponsorship_checkout_intent(
    target_idempotency_key => 'checkout-boundary-account-a',
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => NULL,
    target_auth_user_id => '96000000-0000-4000-8000-000000000002'::uuid,
    target_contact_email_hmac => decode(repeat('bb', 32), 'hex'),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'recurring',
    target_recurrence_interval => 'month',
    target_base_amount_usd_cents => 3333,
    target_charged_amount_minor => 3333,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => now(),
    target_currency_rate_source => 'checkout-boundary-test',
    context_request_id => 'checkout-intent-account-a'
  )
)
INSERT INTO checkout_boundary_test_context (key, uuid_value)
SELECT 'account_a_identity', resolved_sponsor_identity_id
FROM prepared;

SELECT extensions.ok(
  (
    SELECT identity.auth_user_id = '96000000-0000-4000-8000-000000000002'::uuid
      AND identity.status = 'active'
      AND identifier.confidence = 'verified'
      AND identifier.verified_at IS NOT NULL
    FROM public.sponsor_identities identity
    JOIN public.sponsor_identifiers identifier
      ON identifier.sponsor_identity_id = identity.id
     AND identifier.kind = 'email'
    JOIN checkout_boundary_test_context context
      ON context.key = 'account_a_identity'
     AND context.uuid_value = identity.id
  ),
  'a confirmed authenticated checkout creates one verified account-owned sponsor identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key => 'checkout-boundary-account-a-conflict',
      target_source => 'primary_site',
      target_advocate_hostname => NULL,
      target_visitor_token_digest => NULL,
      target_auth_user_id => '96000000-0000-4000-8000-000000000002'::uuid,
      target_contact_email_hmac => decode(repeat('cc', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_partnership_project => NULL,
      target_payment_mode => 'recurring',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 3333,
      target_charged_amount_minor => 3333,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => now(),
      target_currency_rate_source => 'checkout-boundary-test'
    )
  $$,
  '23505',
  'Authenticated account and email histories belong to different sponsor identities',
  'authenticated checkout never merges two existing email histories automatically'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key => 'checkout-boundary-account-a-changed',
      target_source => 'primary_site',
      target_advocate_hostname => NULL,
      target_visitor_token_digest => NULL,
      target_auth_user_id => '96000000-0000-4000-8000-000000000002'::uuid,
      target_contact_email_hmac => decode(repeat('dd', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_partnership_project => NULL,
      target_payment_mode => 'recurring',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 3333,
      target_charged_amount_minor => 3333,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => now(),
      target_currency_rate_source => 'checkout-boundary-test'
    )
  $$,
  '23514',
  'Changing an account email does not claim another email history',
  'an authenticated account cannot silently add a new email identity during checkout'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key => 'checkout-boundary-account-b-takeover',
      target_source => 'primary_site',
      target_advocate_hostname => NULL,
      target_visitor_token_digest => NULL,
      target_auth_user_id => '96000000-0000-4000-8000-000000000003'::uuid,
      target_contact_email_hmac => decode(repeat('bb', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_partnership_project => NULL,
      target_payment_mode => 'recurring',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 3333,
      target_charged_amount_minor => 3333,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => now(),
      target_currency_rate_source => 'checkout-boundary-test'
    )
  $$,
  '23505',
  'Verified sponsor email history already belongs to another account',
  'a second account cannot take over a verified sponsor email identity'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.sponsor_identities identity
    WHERE identity.auth_user_id = '96000000-0000-4000-8000-000000000003'::uuid
  ),
  0,
  'rejected account takeover leaves no partial sponsor identity'
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
        'sponsorship_attributions'
      )
      AND (
        has_table_privilege('service_role', relation.oid, 'INSERT')
        OR has_table_privilege('service_role', relation.oid, 'UPDATE')
        OR has_table_privilege('service_role', relation.oid, 'DELETE')
        OR has_table_privilege('service_role', relation.oid, 'TRUNCATE')
      )
  ),
  0,
  'service role has no direct mutation privilege on checkout identity, exposure, intent, or attribution tables'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_qualified_advocate_exposure(uuid,bytea,text,public.visitor_consent_state,text,text,uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.prepare_sponsorship_checkout_intent(text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)',
    'EXECUTE'
  ),
  'service role can invoke both narrow checkout boundary RPCs'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.record_qualified_advocate_exposure(uuid,bytea,text,public.visitor_consent_state,text,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_qualified_advocate_exposure(uuid,bytea,text,public.visitor_consent_state,text,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.prepare_sponsorship_checkout_intent(text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.prepare_sponsorship_checkout_intent(text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)',
    'EXECUTE'
  ),
  'browser roles cannot invoke checkout mutation boundaries directly'
);

SELECT extensions.ok(
  (
    SELECT procedure.prosecdef
      AND coalesce(array_to_string(procedure.proconfig, ','), '') = 'search_path=""'
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.record_qualified_advocate_exposure(uuid,bytea,text,public.visitor_consent_state,text,text,uuid,text,text)'::regprocedure
  )
  AND (
    SELECT procedure.prosecdef
      AND coalesce(array_to_string(procedure.proconfig, ','), '') = 'search_path=""'
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.prepare_sponsorship_checkout_intent(text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)'::regprocedure
  ),
  'both checkout boundary RPCs are security definers with an empty search path'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.request_id = 'checkout-exposure-first'
      AND event.actor_type = 'system'
      AND event.system_actor = 'sponsorship_checkout_service'
      AND event.tool = 'record_qualified_advocate_exposure'
      AND event.table_name IN ('browser_visitors', 'advocate_exposures')
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.request_id = 'checkout-intent-direct'
      AND event.actor_type = 'system'
      AND event.system_actor = 'sponsorship_checkout_service'
      AND event.tool = 'prepare_sponsorship_checkout_intent'
      AND event.table_name IN (
        'sponsor_identities',
        'sponsor_identifiers',
        'sponsorship_intents',
        'sponsorship_attributions'
      )
  ),
  'checkout mutations carry fixed system actor, tool, and request audit provenance'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.sponsorship_intents intent
    WHERE intent.idempotency_key IN (
      'checkout-boundary-account-a-conflict',
      'checkout-boundary-account-a-changed',
      'checkout-boundary-account-b-takeover',
      'checkout-boundary-small-amount',
      'checkout-boundary-local-host'
    )
  ),
  0,
  'rejected source, amount, and identity requests leave no partial intents'
);

SELECT * FROM extensions.finish();

ROLLBACK;

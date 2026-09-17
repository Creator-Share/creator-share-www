BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE attribution_settlement_context (
  key text PRIMARY KEY,
  uuid_value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE attribution_settlement_facts (
  fixture_kind text NOT NULL,
  fixture_ordinal integer NOT NULL,
  checkout_operation_id uuid NOT NULL,
  checkout_receipt_digest bytea NOT NULL,
  sponsorship_intent_id uuid NOT NULL,
  sponsor_identity_id uuid NOT NULL,
  advocate_exposure_id uuid,
  payment_attempt_id uuid NOT NULL,
  gateway_event_id uuid NOT NULL,
  financial_movement_id uuid NOT NULL,
  PRIMARY KEY (fixture_kind, fixture_ordinal),
  UNIQUE (checkout_operation_id),
  UNIQUE (checkout_receipt_digest),
  UNIQUE (sponsorship_intent_id),
  UNIQUE (gateway_event_id),
  UNIQUE (financial_movement_id),
  CONSTRAINT attribution_settlement_fixture_kind_check CHECK (
    fixture_kind IN ('direct', 'post_visit_attributed')
  ),
  CONSTRAINT attribution_settlement_exposure_shape_check CHECK (
    (
      fixture_kind = 'direct'
      AND advocate_exposure_id IS NULL
    )
    OR (
      fixture_kind = 'post_visit_attributed'
      AND advocate_exposure_id IS NOT NULL
    )
  )
) ON COMMIT DROP;

CREATE TEMP TABLE attribution_settlement_snapshots (
  key text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE attribution_settlement_publication (
  run_id uuid PRIMARY KEY,
  lease_token uuid NOT NULL,
  report_text text NOT NULL,
  report_sha256 bytea NOT NULL,
  execution_started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  published_advocate_version bigint
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.activate_attribution_settlement_domain(
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
    RAISE EXCEPTION 'Attribution settlement test domain is missing';
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
      RAISE EXCEPTION 'Attribution settlement worker claimed an unrelated job';
    END IF;

    v_evidence := CASE v_claim.provider
      WHEN 'cloudflare' THEN jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('c', 32),
        'dns_record_id', repeat('c', 32),
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
    RAISE EXCEPTION 'Attribution settlement domain did not settle five jobs';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.attribution_settlement_provider_claims(
  target_operation_id uuid,
  target_intent_id uuid,
  target_quote_id uuid,
  target_request_fingerprint bytea,
  target_request_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'canonical_json_version', 1,
    'provider', operation.provider::text,
    'provider_account_scope', operation.provider_account_scope,
    'checkout_operation_id', operation.operation_id::text,
    'sponsorship_intent_id', intent.id::text,
    'payment_quote_id', quote.id::text,
    'payment_attempt_id_placeholder',
      '{"$creator_share":"server_payment_attempt_id","type":"uuid"}'::jsonb,
    'payment_attempt_id_placeholder_path', '/paymentAttemptId',
    'unresolved_placeholder_count', 1,
    'financial_terms', jsonb_build_object(
      'payment_mode', quote.payment_mode::text,
      'recurrence_interval', quote.recurrence_interval,
      'base_amount_usd_cents', quote.base_amount_usd_cents,
      'charged_amount_minor', quote.charged_amount_minor,
      'charged_currency', quote.charged_currency::text,
      'conversion_rate', quote.conversion_rate,
      'currency_quote_at_epoch_microseconds',
        (extract(epoch FROM intent.currency_quote_at) * 1000000)::bigint
    ),
    'sponsor_email_binding', jsonb_build_object(
      'representation', 'encrypted_in_template',
      'normalization_version', intent.contact_email_normalization_version,
      'hmac_key_version', intent.contact_email_hmac_key_version,
      'hmac_sha256', encode(intent.contact_email_hmac, 'hex')
    ),
    'product_display_fields_sha256', repeat('4a', 32),
    'return_urls_sha256', repeat('5b', 32),
    'provider_request_expires_at_epoch_microseconds',
      (extract(epoch FROM target_request_expires_at) * 1000000)::bigint,
    'canonical_template_sha256', encode(target_request_fingerprint, 'hex')
  )
  FROM public.sponsorship_checkout_operations operation
  JOIN public.sponsorship_intents intent
    ON intent.id = target_intent_id
  JOIN public.sponsorship_payment_quotes quote
    ON quote.id = target_quote_id
  WHERE operation.operation_id = target_operation_id;
$$;

CREATE FUNCTION pg_temp.set_attribution_settlement_actor(
  target_user_id uuid,
  target_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    target_user_id::text,
    true
  );
  PERFORM pg_catalog.set_config(
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

CREATE FUNCTION pg_temp.attribution_settlement_canary_report(
  target_run_id uuid,
  target_started_at timestamptz,
  target_completed_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH source AS (
    SELECT
      start.*,
      to_char(
        date_trunc('milliseconds', target_started_at) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS started_at_text,
      to_char(
        date_trunc('milliseconds', target_completed_at) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS completed_at_text,
      to_char(
        (date_trunc('milliseconds', start.started_at) - interval '1 day')
          AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS certificate_not_before_text,
      to_char(
        (date_trunc('milliseconds', start.started_at) + interval '1 day')
          AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS certificate_not_after_text
    FROM audit.advocate_publication_canary_starts start
    WHERE start.run_id = target_run_id
  ), steps AS (
    SELECT
      source.*,
      jsonb_build_array(
        jsonb_build_object(
          'name', 'dns_exact_host',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'resolved', true,
            'provider_target_matched', true,
            'record_types', jsonb_build_array('A', 'CNAME'),
            'answer_count', 2,
            'observed_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'tls_exact_host',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'server_name', source.hostname,
            'certificate_verified', true,
            'hostname_match', true,
            'normal_certificate_verification', true,
            'protocol', 'TLSv1.3',
            'certificate_not_before', source.certificate_not_before_text,
            'certificate_not_after', source.certificate_not_after_text,
            'observed_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'protected_exact_host_challenge',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'http_status', 200,
            'response_bytes', 128,
            'response_sha256', repeat('1', 64),
            'response_verified', true,
            'verified_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'verifying_tenant_root_hidden',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'http_status', 404,
            'content_type', 'text/html; charset=utf-8',
            'body_bytes', 64,
            'body_sha256', repeat('2', 64),
            'redirected', false,
            'generic_not_found', true
          )
        ),
        jsonb_build_object(
          'name', 'unprovisioned_sibling_dns_absent',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'hostname', 'unused-settlement.creatorshare.com',
            'unprovisioned', true,
            'resolved', false,
            'record_types', jsonb_build_array(),
            'answer_count', 0,
            'observed_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'negative_sentinel_hidden',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', 'publication-sentinel.creatorshare.com',
            'cloudflare_ready', true,
            'vercel_ready', true,
            'dns_target_matched', true,
            'tls_certificate_verified', true,
            'tls_hostname_match', true,
            'tls_normal_certificate_verification', true,
            'tls_protocol', 'TLSv1.3',
            'http_status', 404,
            'content_type', 'text/html; charset=utf-8',
            'body_bytes', 64,
            'body_sha256', repeat('2', 64),
            'redirected', false,
            'generic_not_found', true,
            'identical_to_tenant_root', true,
            'observed_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'stripe_us_payment_canary',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'provider', 'stripe_us',
            'provider_resource_id', 'cs_live_attribution_fixture_us',
            'provider_status', 'checkout_session_expired_unpaid',
            'provider_created_at', source.started_at_text,
            'provider_return_urls_sha256', repeat('3', 64),
            'outbound_request_id_sha256', repeat('4', 64),
            'create_http_status', 200,
            'create_provider_status', 'expired',
            'cleanup_request_id_sha256', repeat('5', 64),
            'cleanup_http_status', 200,
            'cleanup_performed', true,
            'provider_credential_request_id', NULL,
            'provider_create_request_id', 'req_attribution_stripe_us',
            'provider_cleanup_request_id', 'req_cleanup_attribution_stripe_us',
            'financial_charge_attempted', false,
            'provider_capture_attempted', false,
            'sponsorship_state_created', false,
            'webhook_delivery_verified', false,
            'verified', true,
            'verified_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'stripe_uk_payment_canary',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'provider', 'stripe_uk',
            'provider_resource_id', 'cs_live_attribution_fixture_uk',
            'provider_status', 'checkout_session_expired_unpaid',
            'provider_created_at', source.started_at_text,
            'provider_return_urls_sha256', repeat('6', 64),
            'outbound_request_id_sha256', repeat('7', 64),
            'create_http_status', 200,
            'create_provider_status', 'expired',
            'cleanup_request_id_sha256', repeat('8', 64),
            'cleanup_http_status', 200,
            'cleanup_performed', true,
            'provider_credential_request_id', NULL,
            'provider_create_request_id', 'req_attribution_stripe_uk',
            'provider_cleanup_request_id', 'req_cleanup_attribution_stripe_uk',
            'financial_charge_attempted', false,
            'provider_capture_attempted', false,
            'sponsorship_state_created', false,
            'webhook_delivery_verified', false,
            'verified', true,
            'verified_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'paypal_payment_canary',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'provider', 'paypal',
            'provider_resource_id', 'I-ATTRIBUTIONFIXTURE',
            'provider_status', 'subscription_approval_pending',
            'provider_created_at', source.started_at_text,
            'provider_return_urls_sha256', repeat('9', 64),
            'outbound_request_id_sha256', repeat('a', 64),
            'create_http_status', 201,
            'create_provider_status', NULL,
            'cleanup_request_id_sha256', NULL,
            'cleanup_http_status', NULL,
            'cleanup_performed', NULL,
            'provider_credential_request_id', 'req_credential_attribution_paypal',
            'provider_create_request_id', 'req_create_attribution_paypal',
            'provider_cleanup_request_id', NULL,
            'financial_charge_attempted', false,
            'provider_capture_attempted', false,
            'sponsorship_state_created', false,
            'webhook_delivery_verified', false,
            'verified', true,
            'verified_at', source.started_at_text
          )
        )
      ) AS payload
    FROM source
  )
  SELECT regexp_replace(
    jsonb_build_object(
      'schema_version', 1,
      'report_type', 'advocate_publication_canary',
      'canonicalization_version', 1,
      'target', jsonb_build_object(
        'run_id', report.run_id,
        'advocate_id', report.advocate_id,
        'domain_id', report.domain_id,
        'hostname', report.hostname,
        'expected_advocate_version', report.expected_advocate_version,
        'deployment_id', report.deployment_id,
        'revision', report.git_revision,
        'payment_attempt_ids', jsonb_build_object(
          'stripe_us', report.stripe_us_attempt_id,
          'stripe_uk', report.stripe_uk_attempt_id,
          'paypal', report.paypal_attempt_id
        )
      ),
      'started_at', report.started_at_text,
      'completed_at', report.completed_at_text,
      'outcome', 'succeeded',
      'error_code', NULL,
      'safety_claims', jsonb_build_object(
        'financial_charge_attempted', false,
        'provider_capture_attempted', false,
        'sponsorship_state_created', false,
        'webhook_delivery_verified', false
      ),
      'steps', report.payload
    )::text,
    '([,:]) ',
    '\1',
    'g'
  )
  FROM steps report;
$$;

CREATE FUNCTION pg_temp.create_and_settle_attribution_fixture(
  target_kind text,
  target_ordinal integer
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_hostname constant text := 'settlement.creatorshare.com';
  v_contact_digest bytea;
  v_visitor_digest bytea;
  v_exposure_event_key uuid;
  v_exposure_id uuid;
  v_operation_id uuid := gen_random_uuid();
  v_checkout_receipt_digest bytea;
  v_provider_request_fingerprint bytea;
  v_provider_request_ciphertext bytea;
  v_provider_request_expires_at timestamptz;
  v_intent_id uuid;
  v_identity_id uuid;
  v_quote_id uuid;
  v_attempt_id uuid;
  v_gateway_event_id uuid;
  v_processing_lease_token uuid;
  v_movement_id uuid;
  v_effect public.gateway_event_application_effect;
  v_provider_object_id text;
  v_provider_event_id text;
  v_provider_movement_id text;
  v_occurred_at timestamptz;
  v_material_operation_id uuid;
  v_material_intent_id uuid;
  v_material_attempt_id uuid;
  v_welcome_required boolean;
BEGIN
  IF target_kind NOT IN ('direct', 'post_visit_attributed')
     OR target_ordinal NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Attribution settlement fixture input is invalid';
  END IF;

  v_contact_digest := extensions.digest(
    format('attribution-settlement-contact:%s:%s', target_kind, target_ordinal),
    'sha256'
  );
  v_visitor_digest := extensions.digest(
    format('attribution-settlement-visitor:%s:%s', target_kind, target_ordinal),
    'sha256'
  );
  v_checkout_receipt_digest := extensions.digest(
    format('attribution-settlement-receipt:%s:%s', target_kind, target_ordinal),
    'sha256'
  );
  v_provider_request_fingerprint := extensions.digest(
    format(
      'attribution-settlement-provider-request:%s:%s',
      target_kind,
      target_ordinal
    ),
    'sha256'
  );
  v_provider_request_ciphertext := extensions.digest(
    format(
      'attribution-settlement-provider-ciphertext:%s:%s',
      target_kind,
      target_ordinal
    ),
    'sha256'
  );
  v_provider_request_expires_at := clock_timestamp() + interval '31 minutes';

  IF target_kind = 'post_visit_attributed' THEN
    v_exposure_event_key := gen_random_uuid();

    SELECT exposure.resolved_advocate_exposure_id
    INTO v_exposure_id
    FROM public.record_qualified_advocate_exposure(
      target_event_key => v_exposure_event_key,
      target_visitor_token_digest => v_visitor_digest,
      target_advocate_hostname => v_hostname,
      target_consent_state => 'granted',
      target_page_path => '/children',
      target_referrer_host => 'social.example',
      context_request_id => format(
        'attribution-settlement-exposure-%s',
        target_ordinal
      )
    ) exposure;
  END IF;

  SELECT
    prepared.resolved_sponsorship_intent_id,
    prepared.resolved_sponsor_identity_id
  INTO v_intent_id, v_identity_id
  FROM public.prepare_sponsorship_checkout_intent_v2(
    target_checkout_operation_id => v_operation_id,
    target_checkout_receipt_digest => v_checkout_receipt_digest,
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_idempotency_key =>
      'stripe-checkout:' || v_operation_id::text,
    target_idempotency_key => format(
      'checkout-v2:%s',
      v_operation_id
    ),
    target_source => CASE
      WHEN target_kind = 'direct'
        THEN 'advocate_domain'::public.sponsorship_intent_source
      ELSE 'primary_site'::public.sponsorship_intent_source
    END,
    target_advocate_hostname => CASE
      WHEN target_kind = 'direct' THEN v_hostname
      ELSE NULL
    END,
    target_visitor_token_digest => CASE
      WHEN target_kind = 'post_visit_attributed' THEN v_visitor_digest
      ELSE NULL
    END,
    target_auth_user_id => NULL,
    target_contact_email_hmac => v_contact_digest,
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 3333,
    target_charged_amount_minor => 3333,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => clock_timestamp(),
    target_currency_rate_source => 'attribution-settlement-test',
    context_request_id => format(
      'attribution-settlement-prepare-%s-%s',
      target_kind,
      target_ordinal
    )
  ) prepared;

  SELECT quote.payment_quote_id
  INTO v_quote_id
  FROM public.issue_sponsorship_payment_quote_v2(
    target_checkout_operation_id => v_operation_id,
    target_sponsorship_intent_id => v_intent_id,
    target_quote_idempotency_key => format(
      'quote:%s',
      v_operation_id
    ),
    context_request_id => format(
      'attribution-settlement-quote-%s-%s',
      target_kind,
      target_ordinal
    )
  ) quote;

  SELECT attempt.payment_attempt_id
  INTO v_attempt_id
  FROM public.begin_sponsorship_payment_v2(
    target_checkout_operation_id => v_operation_id,
    target_sponsorship_intent_id => v_intent_id,
    target_payment_quote_id => v_quote_id,
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_idempotency_key =>
      'stripe-checkout:' || v_operation_id::text,
    target_checkout_receipt_digest => v_checkout_receipt_digest,
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_template_claims =>
      pg_temp.attribution_settlement_provider_claims(
        v_operation_id,
        v_intent_id,
        v_quote_id,
        v_provider_request_fingerprint,
        v_provider_request_expires_at
      ),
    target_provider_request_fingerprint => v_provider_request_fingerprint,
    target_provider_request_expires_at => v_provider_request_expires_at,
    target_provider_request_ciphertext => v_provider_request_ciphertext,
    target_provider_request_encryption_key_version => 1::smallint,
    target_provider_request_ciphertext_sha256 => extensions.digest(
      v_provider_request_ciphertext,
      'sha256'
    ),
    target_metadata => jsonb_build_object(
      'test', 'attribution-settlement',
      'fixture_kind', target_kind
    )
  ) attempt;

  v_provider_object_id := format(
    'cs_attribution_settlement_%s_%s',
    target_kind,
    target_ordinal
  );
  v_provider_event_id := format(
    'evt_attribution_settlement_%s_%s',
    target_kind,
    target_ordinal
  );
  v_provider_movement_id := format(
    'pi_attribution_settlement_%s_%s',
    target_kind,
    target_ordinal
  );

  PERFORM public.attach_sponsorship_payment_provider_object_v2(
    target_payment_attempt_id => v_attempt_id,
    target_provider_object_type => 'checkout_session',
    target_provider_object_id => v_provider_object_id,
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_fingerprint => v_provider_request_fingerprint,
    target_provider_request_expires_at => v_provider_request_expires_at,
    target_recovery_lease_token => NULL,
    context_request_id => format(
      'attribution-settlement-attach-%s-%s',
      target_kind,
      target_ordinal
    )
  );

  v_occurred_at := clock_timestamp();

  SELECT gateway.gateway_event_id
  INTO v_gateway_event_id
  FROM public.ingest_verified_payment_gateway_event(
    target_payment_attempt_id => v_attempt_id,
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_event_id => v_provider_event_id,
    target_event_type => 'checkout.session.completed',
    target_provider_object_type => 'checkout_session',
    target_provider_object_id => v_provider_object_id,
    target_redacted_payload => jsonb_build_object('payment_status', 'paid'),
    target_payload_ciphertext => extensions.digest(
      format('attribution-settlement-payload:%s:%s', target_kind, target_ordinal),
      'sha256'
    ),
    target_payload_sha256 => extensions.digest(
      format('attribution-settlement-payload-digest:%s:%s', target_kind, target_ordinal),
      'sha256'
    ),
    target_signature_verified_at => v_occurred_at,
    target_occurred_at => v_occurred_at,
    target_verification_method => 'stripe_webhook_signature',
    target_fact_payment_status => 'paid',
    target_fact_server_payment_attempt_id => v_attempt_id,
    target_fact_provider_movement_type => 'payment_intent',
    target_fact_provider_movement_id => v_provider_movement_id,
    target_fact_base_amount_usd_cents => 3333,
    target_fact_charged_amount_minor => 3333,
    target_fact_charged_currency => 'USD',
    target_fact_conversion_rate => 1,
    context_request_id => format(
      'attribution-settlement-ingest-%s-%s',
      target_kind,
      target_ordinal
    )
  ) gateway;

  SELECT claimed.processing_lease_token
  INTO v_processing_lease_token
  FROM public.claim_payment_gateway_events(
    format('attribution-settlement-worker-%s-%s', target_kind, target_ordinal),
    1
  ) claimed
  WHERE claimed.gateway_event_id = v_gateway_event_id;

  IF v_processing_lease_token IS NULL THEN
    RAISE EXCEPTION 'Attribution settlement event was not claimed';
  END IF;

  SELECT
    material.checkout_operation_id,
    material.sponsorship_intent_id,
    material.payment_attempt_id,
    material.welcome_required
  INTO
    v_material_operation_id,
    v_material_intent_id,
    v_material_attempt_id,
    v_welcome_required
  FROM public.read_payment_gateway_event_success_material(
    target_gateway_event_id => v_gateway_event_id,
    target_processing_lease_token => v_processing_lease_token,
    context_request_id => format(
      'attribution-settlement-success-material-%s-%s',
      target_kind,
      target_ordinal
    )
  ) material;

  IF v_material_operation_id IS DISTINCT FROM v_operation_id
     OR v_material_intent_id IS DISTINCT FROM v_intent_id
     OR v_material_attempt_id IS DISTINCT FROM v_attempt_id
     OR v_welcome_required IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Attribution settlement success material is not bound';
  END IF;

  SELECT
    applied.financial_movement_id,
    applied.application_effect
  INTO v_movement_id, v_effect
  FROM public.apply_sponsorship_payment_success(
    target_gateway_event_id => v_gateway_event_id,
    target_processing_lease_token => v_processing_lease_token,
    target_claim_token_digest => extensions.digest(
      format('attribution-settlement-claim:%s:%s', target_kind, target_ordinal),
      'sha256'
    ),
    target_recipient_email_ciphertext => extensions.digest(
      format('attribution-settlement-recipient:%s:%s', target_kind, target_ordinal),
      'sha256'
    ),
    target_email_encryption_key_version => 1::smallint,
    target_secret_payload_ciphertext => extensions.digest(
      format('attribution-settlement-secret:%s:%s', target_kind, target_ordinal),
      'sha256'
    ),
    target_welcome_template_key => 'sponsor-welcome-v1',
    target_welcome_template_data => '{"locale":"en-US"}'::jsonb,
    context_request_id => format(
      'attribution-settlement-apply-%s-%s',
      target_kind,
      target_ordinal
    )
  ) applied;

  IF v_effect IS DISTINCT FROM 'payment_succeeded'
     OR v_movement_id IS NULL THEN
    RAISE EXCEPTION 'Attribution settlement payment was not applied';
  END IF;

  INSERT INTO attribution_settlement_facts (
    fixture_kind,
    fixture_ordinal,
    checkout_operation_id,
    checkout_receipt_digest,
    sponsorship_intent_id,
    sponsor_identity_id,
    advocate_exposure_id,
    payment_attempt_id,
    gateway_event_id,
    financial_movement_id
  )
  VALUES (
    target_kind,
    target_ordinal,
    v_operation_id,
    v_checkout_receipt_digest,
    v_intent_id,
    v_identity_id,
    v_exposure_id,
    v_attempt_id,
    v_gateway_event_id,
    v_movement_id
  );

  RETURN v_intent_id;
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
VALUES (
  '96000000-0000-4000-8000-000000000201'::uuid,
  'authenticated',
  'authenticated',
  'attribution-settlement-owner@example.test',
  clock_timestamp(),
  '{}'::jsonb,
  '{"first_name":"Settlement","last_name":"Owner"}'::jsonb,
  clock_timestamp(),
  clock_timestamp()
);

INSERT INTO auth.sessions (
  id,
  user_id,
  created_at,
  updated_at,
  aal,
  not_after
)
VALUES (
  '96000000-0000-4000-8000-000000000202'::uuid,
  '96000000-0000-4000-8000-000000000201'::uuid,
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
SELECT
  '96000000-0000-4000-8000-000000000201'::uuid,
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
    'settlement',
    'Attribution Settlement',
    'active'
  )
  RETURNING id
)
INSERT INTO attribution_settlement_context (key, uuid_value)
SELECT 'advocate', id FROM inserted;

INSERT INTO public.advocate_branding (
  advocate_id,
  primary_color,
  accent_color,
  logo_storage_path,
  logo_alt_text,
  opening_header_html,
  about_biography_html
)
SELECT
  uuid_value,
  '#123456',
  '#ABCDEF',
  NULL,
  NULL,
  '<h1>Attribution Settlement</h1>',
  '<p>Cross layer integration evidence.</p>'
FROM attribution_settlement_context
WHERE key = 'advocate';

WITH inserted AS (
  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  SELECT
    uuid_value,
    '96000000-0000-4000-8000-000000000201'::uuid,
    'active'
  FROM attribution_settlement_context
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO attribution_settlement_context (key, uuid_value)
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
  '96000000-0000-4000-8000-000000000201'::uuid
FROM attribution_settlement_context advocate
CROSS JOIN attribution_settlement_context membership
WHERE advocate.key = 'advocate'
  AND membership.key = 'owner_membership';

UPDATE public.advocates
SET
  owner_membership_id = (
    SELECT uuid_value
    FROM attribution_settlement_context
    WHERE key = 'owner_membership'
  ),
  publication_status = 'provisioning'
WHERE id = (
  SELECT uuid_value
  FROM attribution_settlement_context
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
    'settlement.creatorshare.com',
    true
  FROM attribution_settlement_context
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO attribution_settlement_context (key, uuid_value)
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
FROM attribution_settlement_context advocate
CROSS JOIN attribution_settlement_context domain
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

SELECT pg_temp.activate_attribution_settlement_domain(
  (
    SELECT uuid_value
    FROM attribution_settlement_context
    WHERE key = 'domain'
  ),
  'attribution-settlement-domain-worker'
);

SELECT pg_temp.set_attribution_settlement_actor(
  '96000000-0000-4000-8000-000000000201'::uuid,
  '96000000-0000-4000-8000-000000000202'::uuid
);

WITH started AS (
  SELECT operation.*
  FROM attribution_settlement_context advocate_context
  JOIN public.advocates advocate
    ON advocate.id = advocate_context.uuid_value
  CROSS JOIN LATERAL public.begin_or_resume_advocate_publication_canary(
    advocate.id,
    advocate.version,
    '96000000-0000-4000-8000-000000000301'::uuid,
    'dpl_attribution_settlement',
    repeat('a', 40),
    'attribution-settlement-publication-start',
    'Approve the provider-free attribution settlement publication fixture',
    NULL,
    NULL
  ) operation
  WHERE advocate_context.key = 'advocate'
)
INSERT INTO attribution_settlement_context (key, uuid_value)
SELECT 'canary_run', started.run_id
FROM started
WHERE started.created;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);

WITH claimed AS (
  SELECT claim.lease_token
  FROM attribution_settlement_context run_context
  CROSS JOIN LATERAL public.claim_advocate_publication_canary_execution(
    run_context.uuid_value,
    120
  ) claim
  WHERE run_context.key = 'canary_run'
)
INSERT INTO attribution_settlement_context (key, uuid_value)
SELECT 'canary_lease', claimed.lease_token
FROM claimed;

WITH timing AS (
  SELECT
    run_context.uuid_value AS run_id,
    lease_context.uuid_value AS lease_token,
    date_trunc('milliseconds', execution_lease.leased_at)
      AS execution_started_at,
    date_trunc('milliseconds', execution_lease.leased_at)
      + interval '1 millisecond' AS completed_at
  FROM attribution_settlement_context run_context
  CROSS JOIN attribution_settlement_context lease_context
  JOIN audit.advocate_publication_canary_execution_leases execution_lease
    ON execution_lease.run_id = run_context.uuid_value
   AND execution_lease.lease_token = lease_context.uuid_value
  WHERE run_context.key = 'canary_run'
    AND lease_context.key = 'canary_lease'
), report AS (
  SELECT
    timing.*,
    pg_temp.attribution_settlement_canary_report(
      timing.run_id,
      timing.execution_started_at,
      timing.completed_at
    ) AS report_text
  FROM timing
)
INSERT INTO attribution_settlement_publication (
  run_id,
  lease_token,
  report_text,
  report_sha256,
  execution_started_at,
  completed_at
)
SELECT
  report.run_id,
  report.lease_token,
  report.report_text,
  extensions.digest(
    pg_catalog.convert_to(report.report_text, 'UTF8'),
    'sha256'
  ),
  report.execution_started_at,
  report.completed_at
FROM report;

SELECT completion.*
FROM attribution_settlement_publication publication
CROSS JOIN LATERAL public.complete_claimed_advocate_publication_canary(
  publication.run_id,
  publication.report_text,
  publication.report_sha256,
  'succeeded',
  NULL,
  publication.completed_at,
  '96000000-0000-4000-8000-000000000302'::uuid,
  'attribution-settlement-publication-completion',
  'Approve the provider-free attribution settlement publication fixture',
  publication.lease_token
) completion;

WITH minted AS (
  SELECT capability.*
  FROM attribution_settlement_publication publication
  CROSS JOIN LATERAL public.mint_advocate_publication_deployment_capability(
    '96000000-0000-4000-8000-000000000301'::uuid,
    publication.run_id,
    'dpl_attribution_settlement',
    repeat('a', 40)
  ) capability
)
INSERT INTO attribution_settlement_context (key, uuid_value)
SELECT 'deployment_capability', minted.deployment_capability_id
FROM minted;

SELECT pg_temp.set_attribution_settlement_actor(
  '96000000-0000-4000-8000-000000000201'::uuid,
  '96000000-0000-4000-8000-000000000202'::uuid
);

UPDATE attribution_settlement_publication publication
SET published_advocate_version = public.publish_advocate_portal_from_canary_v2(
  advocate_context.uuid_value,
  canary_start.expected_advocate_version,
  '96000000-0000-4000-8000-000000000301'::uuid,
  publication.run_id,
  'dpl_attribution_settlement',
  publication.report_sha256,
  'Approve the provider-free attribution settlement publication fixture',
  '96000000-0000-5000-8000-000000000303'::uuid,
  'attribution-settlement-publication-approval',
  capability_context.uuid_value,
  NULL,
  NULL
)
FROM attribution_settlement_context advocate_context
CROSS JOIN attribution_settlement_context capability_context
CROSS JOIN audit.advocate_publication_canary_starts canary_start
WHERE advocate_context.key = 'advocate'
  AND capability_context.key = 'deployment_capability'
  AND canary_start.run_id = publication.run_id;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM attribution_settlement_publication publication
    JOIN audit.advocate_publication_canary_starts canary_start
      ON canary_start.run_id = publication.run_id
    JOIN audit.advocate_publication_canary_reports canary_report
      ON canary_report.run_id = publication.run_id
    JOIN audit.advocate_publication_canary_execution_leases execution_lease
      ON execution_lease.run_id = publication.run_id
    JOIN audit.advocate_publication_approvals approval
      ON approval.canary_run_id = publication.run_id
    WHERE canary_start.request_id =
        '96000000-0000-4000-8000-000000000301'::uuid
      AND canary_start.initiating_user_id =
        '96000000-0000-4000-8000-000000000201'::uuid
      AND canary_start.initiating_session_id =
        '96000000-0000-4000-8000-000000000202'
      AND canary_report.outcome = 'succeeded'
      AND canary_report.report_sha256 = publication.report_sha256
      AND execution_lease.completed_at IS NOT NULL
      AND approval.request_id =
        '96000000-0000-5000-8000-000000000303'::uuid
      AND approval.approving_user_id =
        '96000000-0000-4000-8000-000000000201'::uuid
      AND approval.approving_session_id =
        '96000000-0000-4000-8000-000000000202'
      AND publication.published_advocate_version =
        canary_start.expected_advocate_version + 1
  ),
  'publication binds the operation, lease, canonical report, approving actor, and resulting version'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM private.advocate_publication_deployment_capabilities capability
    WHERE capability.operation_id =
      '96000000-0000-4000-8000-000000000301'::uuid
  ),
  'successful publication consumes its short-lived deployment capability'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM attribution_settlement_context advocate_context
    JOIN public.advocates advocate
      ON advocate.id = advocate_context.uuid_value
    JOIN public.advocate_domains domain
      ON domain.advocate_id = advocate.id
     AND domain.is_primary
    WHERE advocate_context.key = 'advocate'
      AND advocate.publication_status = 'active'
      AND domain.status = 'active'
  ),
  'the current publication boundary activates the advocate and its primary domain'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);

INSERT INTO public.advocate_public_metric_selections (
  advocate_id,
  metric_key,
  display_order
)
SELECT
  context.uuid_value,
  metric.metric_key::public.advocate_public_metric_key,
  metric.display_order
FROM attribution_settlement_context context
CROSS JOIN (
  VALUES
    ('gross_raised_usd', 0),
    ('direct_sponsorships', 1),
    ('post_visit_attributed_sponsorships', 2)
) metric(metric_key, display_order)
WHERE context.key = 'advocate';

UPDATE public.payment_provider_accounts
SET environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

SELECT pg_temp.create_and_settle_attribution_fixture('direct', ordinal)
FROM generate_series(1, 5) ordinal;

SELECT pg_temp.create_and_settle_attribution_fixture(
  'post_visit_attributed',
  ordinal
)
FROM generate_series(1, 5) ordinal;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM attribution_settlement_facts
  ),
  10::bigint,
  'the cross layer fixture settles ten server owned sponsorship intents'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM attribution_settlement_facts fact
    JOIN public.sponsorship_checkout_operations operation
      ON operation.operation_id = fact.checkout_operation_id
     AND operation.sponsorship_intent_id = fact.sponsorship_intent_id
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.checkout_operation_id = operation.operation_id
     AND recovery.payment_attempt_id = fact.payment_attempt_id
    WHERE operation.checkout_boundary_version = 2
      AND operation.checkout_receipt_digest = fact.checkout_receipt_digest
      AND operation.provider = 'STRIPE'
      AND operation.provider_account_scope = 'stripe_us'
      AND recovery.status = 'closed'
      AND recovery.final_outcome = 'attempt_terminal'
      AND recovery.provider_attached_at IS NOT NULL
      AND recovery.finalized_at IS NOT NULL
  ),
  10::bigint,
  'the production checkout boundary binds every receipt and closes every settled operation'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM attribution_settlement_facts fact
    JOIN public.sponsorship_intents intent
      ON intent.id = fact.sponsorship_intent_id
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = fact.payment_attempt_id
     AND attempt.sponsorship_intent_id = intent.id
    JOIN public.payment_gateway_events gateway
      ON gateway.id = fact.gateway_event_id
     AND gateway.payment_attempt_id = attempt.id
     AND gateway.sponsorship_intent_id = intent.id
    JOIN public.sponsorship_financial_movements movement
      ON movement.id = fact.financial_movement_id
     AND movement.source_gateway_event_id = gateway.id
     AND movement.sponsorship_intent_id = intent.id
    WHERE intent.status = 'succeeded'
      AND attempt.status = 'succeeded'
      AND gateway.processing_status = 'processed'
      AND movement.entry_kind = 'sponsorship_payment'
  ),
  10::bigint,
  'authoritative settlement preserves every intent attempt event and movement chain'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM attribution_settlement_facts fact
    JOIN public.sponsorship_attributions attribution
      ON attribution.sponsorship_intent_id = fact.sponsorship_intent_id
    WHERE attribution.kind::text = fact.fixture_kind
      AND attribution.advocate_id = (
        SELECT uuid_value
        FROM attribution_settlement_context
        WHERE key = 'advocate'
      )
      AND attribution.analytics_eligible
      AND attribution.finalized_at IS NOT NULL
      AND attribution.conversion_occurred_at IS NOT NULL
      AND (
        (
          fact.fixture_kind = 'direct'
          AND attribution.exposure_id IS NULL
          AND attribution.exposure_lag IS NULL
        )
        OR (
          fact.fixture_kind = 'post_visit_attributed'
          AND attribution.exposure_id = fact.advocate_exposure_id
          AND attribution.exposure_lag BETWEEN interval '0 seconds'
            AND interval '30 days'
        )
      )
  ),
  10::bigint,
  'verified payment finalizes the immutable direct and latest visit decisions'
);

CREATE TEMP TABLE attribution_settlement_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

INSERT INTO attribution_settlement_times (key, value)
VALUES (
  'historical_conversion',
  (
    date_trunc('week', clock_timestamp() AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC'
  ) - interval '8 days'
);

SET LOCAL session_replication_role = replica;

UPDATE public.advocate_exposures exposure
SET
  occurred_at = historical.value - interval '1 hour',
  recorded_at = historical.value - interval '1 hour',
  retention_expires_at = historical.value - interval '1 hour'
    + interval '400 days'
FROM attribution_settlement_facts fact
CROSS JOIN attribution_settlement_times historical
WHERE fact.fixture_kind = 'post_visit_attributed'
  AND fact.advocate_exposure_id = exposure.id
  AND historical.key = 'historical_conversion';

UPDATE public.sponsorship_intents intent
SET
  created_at = historical.value - interval '2 minutes',
  committed_at = historical.value - interval '1 minute',
  succeeded_at = historical.value,
  updated_at = historical.value
FROM attribution_settlement_facts fact
CROSS JOIN attribution_settlement_times historical
WHERE fact.sponsorship_intent_id = intent.id
  AND historical.key = 'historical_conversion';

UPDATE public.sponsorship_attributions attribution
SET
  decided_at = historical.value - interval '1 minute',
  finalized_at = historical.value,
  conversion_occurred_at = historical.value,
  exposure_lag = CASE
    WHEN fact.fixture_kind = 'post_visit_attributed'
      THEN interval '1 hour'
    ELSE NULL
  END
FROM attribution_settlement_facts fact
CROSS JOIN attribution_settlement_times historical
WHERE fact.sponsorship_intent_id = attribution.sponsorship_intent_id
  AND historical.key = 'historical_conversion';

UPDATE public.sponsorship_financial_movements movement
SET
  occurred_at = historical.value,
  recorded_at = historical.value
FROM attribution_settlement_facts fact
CROSS JOIN attribution_settlement_times historical
WHERE fact.financial_movement_id = movement.id
  AND historical.key = 'historical_conversion';

SET LOCAL session_replication_role = origin;

SELECT set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000201',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO attribution_settlement_snapshots (key, payload)
SELECT
  'private',
  public.get_advocate_analytics_snapshot(
    (
      SELECT uuid_value
      FROM attribution_settlement_context
      WHERE key = 'advocate'
    )
  );

SELECT extensions.ok(
  (
    SELECT
      (payload #>> '{official,suppressed}')::boolean = false
      AND (payload #>> '{official,sponsorships}')::bigint = 10
      AND (payload #>> '{official,unique_sponsor_contacts}')::bigint = 10
      AND (
        payload #>> '{official,gross_collected_usd_cents}'
      )::bigint = 33330
      AND (
        payload #>> '{official,net_collected_usd_cents}'
      )::bigint = 33330
    FROM attribution_settlement_snapshots
    WHERE key = 'private'
  ),
  'private analytics reports payment backed official totals after settlement'
);

SELECT extensions.ok(
  (
    SELECT
      (direct.value #>> '{suppressed}')::boolean = false
      AND (direct.value #>> '{sponsorships}')::bigint = 5
      AND (direct.value #>> '{unique_sponsor_contacts}')::bigint = 5
      AND (post_visit.value #>> '{suppressed}')::boolean = false
      AND (post_visit.value #>> '{sponsorships}')::bigint = 5
      AND (
        post_visit.value #>> '{unique_sponsor_contacts}'
      )::bigint = 5
    FROM attribution_settlement_snapshots snapshot
    CROSS JOIN LATERAL (
      SELECT segment.value
      FROM jsonb_array_elements(snapshot.payload -> 'segments') segment(value)
      WHERE segment.value ->> 'key' = 'direct'
    ) direct
    CROSS JOIN LATERAL (
      SELECT segment.value
      FROM jsonb_array_elements(snapshot.payload -> 'segments') segment(value)
      WHERE segment.value ->> 'key' = 'post_visit_0_1_day'
    ) post_visit
    WHERE snapshot.key = 'private'
  ),
  'private analytics separates direct and zero to one day post visit outcomes'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO attribution_settlement_snapshots (key, payload)
SELECT
  'release',
  public.refresh_advocate_public_metric_releases(
    100,
    'attribution-settlement-public-metric-release',
    'attribution-settlement-public-metric-trace'
  );

SELECT extensions.is(
  (
    SELECT array_agg(
      concat_ws(
        ':',
        release.metric_key::text,
        release.released_bucket::text,
        release.unit
      )
      ORDER BY release.metric_key::text
    )
    FROM private.advocate_public_metric_releases release
    WHERE release.advocate_id = (
      SELECT uuid_value
      FROM attribution_settlement_context
      WHERE key = 'advocate'
    )
      AND release.policy_version = 'public-v1'
  ),
  ARRAY[
    'direct_sponsorships:5:count',
    'gross_raised_usd:30000:usd_cents',
    'post_visit_attributed_sponsorships:5:count'
  ]::text[],
  'public release calculation emits only rounded privacy safe settlement buckets'
);

INSERT INTO attribution_settlement_snapshots (key, payload)
SELECT
  'public',
  public.read_public_advocate_presentation_snapshot(
    'settlement.creatorshare.com'
  );

SELECT extensions.is(
  (
    SELECT array_agg(
      concat_ws(
        ':',
        metric.value ->> 'key',
        metric.value ->> 'status',
        metric.value ->> 'value',
        metric.value ->> 'qualifier'
      )
      ORDER BY metric.ordinality
    )
    FROM attribution_settlement_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(
      snapshot.payload -> 'metricSelections'
    ) WITH ORDINALITY metric(value, ordinality)
    WHERE snapshot.key = 'public'
  ),
  ARRAY[
    'gross_raised_usd:published:30000:at_least',
    'direct_sponsorships:published:5:at_least',
    'post_visit_attributed_sponsorships:published:5:at_least'
  ]::text[],
  'public presentation exposes the selected lower bounds without raw totals'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM attribution_settlement_facts fact
    JOIN public.sponsorship_account_claims claim
      ON claim.sponsorship_intent_id = fact.sponsorship_intent_id
    JOIN public.email_outbox outbox
      ON outbox.account_claim_id = claim.id
    WHERE outbox.template_key = 'sponsor-welcome-v1'
  ),
  10::bigint,
  'first successful settlements atomically materialize ten welcome and claim records'
);

SELECT set_config('request.jwt.claim.role', '', true);

SELECT extensions.finish();

ROLLBACK;

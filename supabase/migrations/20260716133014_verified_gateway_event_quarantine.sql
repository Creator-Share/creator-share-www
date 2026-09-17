BEGIN;

CREATE OR REPLACE FUNCTION public.quarantine_verified_payment_gateway_event(
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_event_id text,
  target_event_type text,
  target_provider_object_type text,
  target_provider_object_id text,
  target_redacted_payload jsonb,
  target_payload_ciphertext bytea,
  target_payload_sha256 bytea,
  target_signature_verified_at timestamptz,
  target_occurred_at timestamptz,
  target_verification_method text,
  target_error_code text,
  target_reason text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  processing_status public.gateway_event_processing_status,
  is_duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_lease_token uuid;
  v_ignored_reason text;
  v_redacted_payload jsonb;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider IS NULL
     OR target_provider_account_scope IS NULL
     OR target_provider_account_scope IS DISTINCT FROM
       lower(btrim(target_provider_account_scope))
     OR length(target_provider_account_scope) NOT BETWEEN 1 AND 120
     OR target_provider_account_scope !~ '^[a-z0-9][a-z0-9_-]*$'
     OR target_provider_event_id IS NULL
     OR target_provider_event_id IS DISTINCT FROM btrim(target_provider_event_id)
     OR length(target_provider_event_id) NOT BETWEEN 1 AND 255
     OR target_provider_event_id !~ '^[A-Za-z0-9_.:-]+$'
     OR target_event_type IS NULL
     OR target_event_type IS DISTINCT FROM btrim(target_event_type)
     OR length(target_event_type) NOT BETWEEN 1 AND 200
     OR target_event_type !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'Quarantined provider identifiers are malformed'
      USING ERRCODE = '22023';
  END IF;

  IF (target_provider_object_type IS NULL) IS DISTINCT FROM
       (target_provider_object_id IS NULL)
     OR (
       target_provider_object_type IS NOT NULL
       AND (
         target_provider_object_id IS NULL
         OR target_provider_object_type IS DISTINCT FROM
           btrim(target_provider_object_type)
         OR target_provider_object_type IS DISTINCT FROM
           lower(target_provider_object_type)
         OR length(target_provider_object_type) NOT BETWEEN 1 AND 80
         OR target_provider_object_type !~ '^[a-z][a-z0-9_]*$'
         OR target_provider_object_id IS DISTINCT FROM
           btrim(target_provider_object_id)
         OR length(target_provider_object_id) NOT BETWEEN 1 AND 255
         OR target_provider_object_id !~ '^[A-Za-z0-9_.:-]+$'
       )
     ) THEN
    RAISE EXCEPTION 'Quarantined provider object is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_redacted_payload IS NULL
     OR jsonb_typeof(target_redacted_payload) IS DISTINCT FROM 'object'
     OR pg_column_size(target_redacted_payload) > 65536
     OR target_redacted_payload ?| ARRAY[
       'quarantine',
       'quarantine_error_code',
       'requires_operational_review',
       'provider_event_disposition',
       'provider_state',
       'sponsorship_intent_id',
       'payment_attempt_id',
       'sponsor_identity_id',
       'original_financial_movement_id',
       'fact_payment_status',
       'fact_server_payment_attempt_id',
       'fact_parent_provider_object_type',
       'fact_parent_provider_object_id',
       'fact_provider_movement_type',
       'fact_provider_movement_id',
       'fact_provider_customer_id',
       'fact_provider_subscription_id',
       'fact_base_amount_usd_cents',
       'fact_charged_amount_minor',
       'fact_charged_currency',
       'fact_conversion_rate',
       'fact_period_start',
       'fact_period_end',
       'fact_failure_code',
       'fact_lifecycle_state'
     ]
     OR target_payload_ciphertext IS NULL
     OR octet_length(target_payload_ciphertext) NOT BETWEEN 1 AND 1048576
     OR target_payload_sha256 IS NULL
     OR octet_length(target_payload_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Quarantined provider evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_signature_verified_at IS NULL
     OR target_occurred_at IS NULL
     OR target_signature_verified_at > clock_timestamp() + interval '5 minutes'
     OR target_occurred_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Quarantined provider event time is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF target_verification_method IS NULL
     OR (target_provider = 'STRIPE'
      AND target_verification_method <> 'stripe_webhook_signature')
     OR (target_provider = 'PAYPAL'
      AND target_verification_method <> 'paypal_webhook_signature_api') THEN
    RAISE EXCEPTION 'Quarantine verification method does not match provider'
      USING ERRCODE = '22023';
  END IF;

  IF target_error_code IS NULL
     OR target_error_code IS DISTINCT FROM lower(btrim(target_error_code))
     OR target_error_code !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     OR target_reason IS NULL
     OR target_reason IS DISTINCT FROM btrim(target_reason)
     OR nullif(btrim(target_reason), '') IS NULL
     OR length(target_reason) > 800 THEN
    RAISE EXCEPTION 'Quarantine disposition is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_redacted_payload := target_redacted_payload || jsonb_build_object(
    'provider', target_provider::text,
    'source', 'verified_webhook',
    'event_type', target_event_type,
    'provider_object_type', target_provider_object_type,
    'quarantine', true,
    'quarantine_error_code', target_error_code,
    'requires_operational_review', true
  );

  IF pg_column_size(v_redacted_payload) > 65536 THEN
    RAISE EXCEPTION 'Quarantined provider evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_ignored_reason := left(
    'quarantine:' || target_error_code || ': ' || target_reason,
    1000
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        target_provider::text,
        target_provider_account_scope,
        target_provider_event_id
      )::text,
      0
    )
  );

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.provider = target_provider
    AND gateway_event.provider_account_scope = target_provider_account_scope
    AND gateway_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.event_type IS DISTINCT FROM target_event_type
       OR v_event.provider_object_type IS DISTINCT FROM target_provider_object_type
       OR v_event.provider_object_id IS DISTINCT FROM target_provider_object_id
       OR v_event.payload_sha256 IS DISTINCT FROM target_payload_sha256
       OR v_event.occurred_at IS DISTINCT FROM target_occurred_at
       OR v_event.verification_method IS DISTINCT FROM target_verification_method
       OR (
         v_event.redacted_payload
           - 'delivery_payload_sha256'
           - 'stripe_signature'
           - 'webhook_secret_version'
           - 'paypal_transmission_id'
           - 'paypal_transmission_time'
           - 'paypal_transmission_signature'
           - 'paypal_cert_url'
           - 'paypal_auth_algorithm'
           - 'paypal_verification_response_sha256'
       ) IS DISTINCT FROM (
         v_redacted_payload
           - 'delivery_payload_sha256'
           - 'stripe_signature'
           - 'webhook_secret_version'
           - 'paypal_transmission_id'
           - 'paypal_transmission_time'
           - 'paypal_transmission_signature'
           - 'paypal_cert_url'
           - 'paypal_auth_algorithm'
           - 'paypal_verification_response_sha256'
       )
       OR v_event.processing_status IS DISTINCT FROM 'ignored'
       OR v_event.ignored_reason IS DISTINCT FROM v_ignored_reason
       OR v_event.sponsorship_intent_id IS NOT NULL
       OR v_event.payment_attempt_id IS NOT NULL
       OR v_event.original_financial_movement_id IS NOT NULL
       OR v_event.fact_payment_status IS NOT NULL
       OR v_event.fact_server_payment_attempt_id IS NOT NULL
       OR v_event.fact_parent_provider_object_type IS NOT NULL
       OR v_event.fact_parent_provider_object_id IS NOT NULL
       OR v_event.fact_provider_movement_type IS NOT NULL
       OR v_event.fact_provider_movement_id IS NOT NULL
       OR v_event.fact_provider_customer_id IS NOT NULL
       OR v_event.fact_provider_subscription_id IS NOT NULL
       OR v_event.fact_base_amount_usd_cents IS NOT NULL
       OR v_event.fact_charged_amount_minor IS NOT NULL
       OR v_event.fact_charged_currency IS NOT NULL
       OR v_event.fact_conversion_rate IS NOT NULL
       OR v_event.fact_period_start IS NOT NULL
       OR v_event.fact_period_end IS NOT NULL
       OR v_event.fact_failure_code IS NOT NULL
       OR v_event.fact_lifecycle_state IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.payment_gateway_event_applications application
         WHERE application.gateway_event_id = v_event.id
           AND application.effect = 'ignored'
       ) THEN
      RAISE EXCEPTION 'Verified provider event identifier conflicts with durable evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT v_event.id, v_event.processing_status, true;
    RETURN;
  END IF;

  PERFORM private.set_payment_audit_context(
    'quarantine_verified_payment_gateway_event',
    target_provider,
    target_provider_account_scope,
    target_event_type,
    target_provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  INSERT INTO public.payment_gateway_events (
    provider,
    provider_account_scope,
    provider_event_id,
    event_type,
    provider_object_type,
    provider_object_id,
    redacted_payload,
    payload_ciphertext,
    payload_sha256,
    signature_verified_at,
    occurred_at,
    verification_method
  )
  VALUES (
    target_provider,
    target_provider_account_scope,
    target_provider_event_id,
    target_event_type,
    target_provider_object_type,
    target_provider_object_id,
    v_redacted_payload,
    target_payload_ciphertext,
    target_payload_sha256,
    target_signature_verified_at,
    target_occurred_at,
    target_verification_method
  )
  RETURNING * INTO v_event;

  v_lease_token := gen_random_uuid();
  UPDATE public.payment_gateway_events
  SET
    processing_status = 'processing',
    processing_locked_by = 'verified-event-quarantine:' || v_lease_token::text,
    processing_lease_token = v_lease_token
  WHERE id = v_event.id;

  SELECT *
  INTO v_event
  FROM public.ignore_sponsorship_payment_gateway_event(
    v_event.id,
    v_lease_token,
    v_ignored_reason,
    context_request_id,
    context_trace_id
  );

  RETURN QUERY SELECT v_event.id, v_event.processing_status, false;
END;
$$;

REVOKE ALL ON FUNCTION public.quarantine_verified_payment_gateway_event(
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  bytea,
  bytea,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.quarantine_verified_payment_gateway_event(
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  bytea,
  bytea,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.quarantine_verified_payment_gateway_event(
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  bytea,
  bytea,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Durably preserves signed provider evidence that cannot safely enter a money path, records an operational review marker, and idempotently closes it as quarantined.';

COMMIT;

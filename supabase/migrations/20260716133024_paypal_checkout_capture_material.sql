/*
 * One-time PayPal approval returns to the application after the order has
 * already crossed the v2 provider attachment boundary. Capture needs the
 * exact sealed request and attached order, but it must not consume a checkout
 * recovery lease or accept provider identity from the browser.
 */

CREATE OR REPLACE FUNCTION public.read_paypal_checkout_capture_material_v2(
  target_checkout_receipt_digest bytea,
  target_checkout_operation_id uuid
)
RETURNS TABLE (
  checkout_operation_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  payment_quote_id uuid,
  provider_account_scope text,
  provider_object_type text,
  provider_object_id text,
  provider_request_schema_version smallint,
  provider_request_template_claims jsonb,
  provider_request_fingerprint bytea,
  provider_request_expires_at timestamptz,
  provider_request_ciphertext bytea,
  provider_request_encryption_key_version smallint,
  provider_request_ciphertext_sha256 bytea
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'PayPal checkout capture material requires the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'PayPal checkout capture material requires the service role'
      USING ERRCODE = '42501';
  END IF;

  IF octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_checkout_operation_id IS NULL THEN
    RAISE EXCEPTION 'PayPal checkout capture scope is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id
     OR operation.checkout_receipt_digest = target_checkout_receipt_digest
  ORDER BY operation.created_at, operation.operation_id
  LIMIT 1;

  IF NOT FOUND
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_operations other_operation
       WHERE (
         other_operation.operation_id = target_checkout_operation_id
         OR other_operation.checkout_receipt_digest =
           target_checkout_receipt_digest
       )
         AND other_operation.operation_id <> v_operation.operation_id
     )
     OR v_operation.operation_id IS DISTINCT FROM
       target_checkout_operation_id
     OR v_operation.checkout_receipt_digest IS DISTINCT FROM
       target_checkout_receipt_digest
     OR v_operation.checkout_boundary_version IS DISTINCT FROM 2
     OR v_operation.provider IS DISTINCT FROM 'PAYPAL'
     OR v_operation.provider_account_scope IS DISTINCT FROM 'paypal'
     OR v_operation.provider_idempotency_key IS DISTINCT FROM
       'paypal-checkout:' || target_checkout_operation_id::text THEN
    RAISE EXCEPTION 'PayPal checkout capture scope conflicts with its immutable operation'
      USING ERRCODE = '23505';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.sponsorship_intent_id = v_operation.sponsorship_intent_id
    AND attempt.provider = v_operation.provider
    AND attempt.provider_account_scope = v_operation.provider_account_scope
    AND attempt.provider_idempotency_key =
      v_operation.provider_idempotency_key;

  IF NOT FOUND
     OR v_attempt.status <> 'pending'
     OR v_attempt.payment_mode <> 'one_time'
     OR v_attempt.checkout_receipt_digest IS DISTINCT FROM
       target_checkout_receipt_digest
     OR v_attempt.checkout_receipt_expires_at <= statement_timestamp()
     OR v_attempt.provider_object_type IS DISTINCT FROM 'order'
     OR v_attempt.provider_object_id !~ '^[A-Z0-9]{17}$' THEN
    RAISE EXCEPTION 'PayPal checkout capture requires one active attached order'
      USING ERRCODE = '23514';
  END IF;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.checkout_operation_id = v_operation.operation_id
    AND recovery.payment_attempt_id = v_attempt.id;

  IF NOT FOUND
     OR v_recovery.status <> 'available'
     OR v_recovery.lease_token IS NOT NULL
     OR v_recovery.lease_expires_at IS NOT NULL
     OR v_recovery.leased_by IS NOT NULL
     OR v_recovery.provider_attached_at IS NULL
     OR v_recovery.provider_request_expires_at <= statement_timestamp()
     OR v_recovery.provider_request_schema_version IS DISTINCT FROM 1
     OR octet_length(v_recovery.provider_request_fingerprint)
       IS DISTINCT FROM 32
     OR v_recovery.provider_request_ciphertext IS NULL
     OR octet_length(v_recovery.provider_request_ciphertext)
       NOT BETWEEN 32 AND 65536
     OR v_recovery.provider_request_encryption_key_version IS NULL
     OR v_recovery.provider_request_ciphertext_sha256 IS NULL
     OR octet_length(v_recovery.provider_request_ciphertext_sha256)
       IS DISTINCT FROM 32
     OR v_recovery.provider_request_ciphertext_sha256 IS DISTINCT FROM
       extensions.digest(v_recovery.provider_request_ciphertext, 'sha256')
     OR v_recovery.provider_request_template_claims ->> 'provider'
       IS DISTINCT FROM 'PAYPAL'
     OR v_recovery.provider_request_template_claims ->>
       'checkout_operation_id' IS DISTINCT FROM v_operation.operation_id::text
     OR v_recovery.provider_request_template_claims ->>
       'sponsorship_intent_id' IS DISTINCT FROM
         v_operation.sponsorship_intent_id::text
     OR v_recovery.provider_request_template_claims ->>
       'payment_quote_id' IS DISTINCT FROM v_attempt.payment_quote_id::text THEN
    RAISE EXCEPTION 'PayPal checkout capture material is unavailable or inconsistent'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT
    v_operation.operation_id,
    v_attempt.id,
    v_attempt.sponsorship_intent_id,
    v_attempt.payment_quote_id,
    v_attempt.provider_account_scope,
    v_attempt.provider_object_type,
    v_attempt.provider_object_id,
    v_recovery.provider_request_schema_version,
    v_recovery.provider_request_template_claims,
    v_recovery.provider_request_fingerprint,
    v_recovery.provider_request_expires_at,
    v_recovery.provider_request_ciphertext,
    v_recovery.provider_request_encryption_key_version,
    v_recovery.provider_request_ciphertext_sha256;
END;
$$;

REVOKE ALL ON FUNCTION public.read_paypal_checkout_capture_material_v2(
  bytea,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_paypal_checkout_capture_material_v2(
  bytea,
  uuid
) TO service_role;

COMMENT ON FUNCTION public.read_paypal_checkout_capture_material_v2(
  bytea,
  uuid
) IS
  'Returns the exact attached order and sealed request required to capture one pending v2 PayPal checkout. Service role only, read only, receipt and operation bound.';

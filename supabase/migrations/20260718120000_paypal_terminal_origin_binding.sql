/*
 * A completed PayPal capture must remain idempotently readable without
 * reopening provider capture material. Return only the immutable intent
 * origin needed to bind that terminal replay to its original site scope.
 */

CREATE OR REPLACE FUNCTION public.read_paypal_terminal_checkout_origin_v2(
  target_checkout_receipt_digest bytea,
  target_checkout_operation_id uuid
)
RETURNS TABLE (
  source public.sponsorship_intent_source,
  source_host text
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
  v_intent public.sponsorship_intents%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_checkout_operation_id IS NULL THEN
    RAISE EXCEPTION 'PayPal terminal checkout origin scope is malformed'
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
    RAISE EXCEPTION 'PayPal terminal checkout origin conflicts with its immutable operation'
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
     OR v_attempt.status <> 'succeeded'
     OR v_attempt.payment_mode <> 'one_time'
     OR v_attempt.checkout_receipt_digest IS DISTINCT FROM
       target_checkout_receipt_digest
     OR v_attempt.provider_object_type IS DISTINCT FROM 'order'
     OR v_attempt.provider_object_id !~ '^[A-Z0-9]{17}$' THEN
    RAISE EXCEPTION 'PayPal terminal checkout origin requires one succeeded attached order'
      USING ERRCODE = '23514';
  END IF;

  SELECT intent.*
  INTO STRICT v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_operation.sponsorship_intent_id;

  RETURN QUERY SELECT v_intent.source, v_intent.source_host;
END;
$$;

REVOKE ALL ON FUNCTION public.read_paypal_terminal_checkout_origin_v2(
  bytea,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_paypal_terminal_checkout_origin_v2(
  bytea,
  uuid
) TO service_role;

COMMENT ON FUNCTION public.read_paypal_terminal_checkout_origin_v2(
  bytea,
  uuid
) IS
  'Returns only the immutable intent source and host for one receipt-bound succeeded v2 PayPal order. Service role only and read only.';

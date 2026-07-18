BEGIN;

/*
 * A quote idempotency key identifies one immutable checkout quote globally.
 * Exact retries recover that quote after payment has begun. A different
 * intent, provider scope, or set of financial terms cannot reuse the key.
 */
CREATE OR REPLACE FUNCTION public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_quote_idempotency_key text,
  target_valid_for interval DEFAULT interval '15 minutes',
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  payment_quote_id uuid,
  sponsorship_intent_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  base_amount_usd_cents bigint,
  charged_amount_minor bigint,
  charged_currency public.payment_currency,
  conversion_rate numeric,
  issued_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
  v_now timestamptz;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_quote_idempotency_key IS NULL
     OR target_quote_idempotency_key IS DISTINCT FROM btrim(target_quote_idempotency_key)
     OR length(target_quote_idempotency_key) NOT BETWEEN 16 AND 255
     OR target_valid_for IS NULL
     OR target_valid_for < interval '1 minute'
     OR target_valid_for > interval '30 minutes' THEN
    RAISE EXCEPTION 'Payment quote issuance input is invalid'
      USING ERRCODE = '22023';
  END IF;

  /*
   * The advisory lock makes the key global across provider scopes. Direct
   * writes are already denied, so all runtime issuance passes this fence.
   */
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'sponsorship_payment_quote:' || target_quote_idempotency_key,
      0
    )
  );

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.quote_idempotency_key = target_quote_idempotency_key
  ORDER BY quote.issued_at, quote.id
  LIMIT 1;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.sponsorship_payment_quotes other_quote
      WHERE other_quote.quote_idempotency_key = target_quote_idempotency_key
        AND other_quote.id <> v_quote.id
    ) THEN
      RAISE EXCEPTION 'Payment quote idempotency key has conflicting checkout records'
        USING ERRCODE = '23505';
    END IF;

    IF v_quote.provider IS DISTINCT FROM target_provider
       OR v_quote.provider_account_scope IS DISTINCT FROM target_provider_account_scope
       OR v_quote.sponsorship_intent_id IS DISTINCT FROM target_sponsorship_intent_id THEN
      RAISE EXCEPTION 'Payment quote idempotency key belongs to another sponsorship checkout'
        USING ERRCODE = '23505';
    END IF;

    SELECT intent.*
    INTO v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = target_sponsorship_intent_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sponsorship intent does not exist'
        USING ERRCODE = '23503';
    END IF;

    IF v_intent.status NOT IN ('created', 'committed', 'processing', 'succeeded') THEN
      RAISE EXCEPTION 'Payment quote cannot replay for a terminal sponsorship intent'
        USING ERRCODE = '23514';
    END IF;

    IF v_quote.quote_source IS DISTINCT FROM v_intent.currency_rate_source
       OR v_quote.payment_mode IS DISTINCT FROM v_intent.payment_mode
       OR v_quote.recurrence_interval IS DISTINCT FROM v_intent.recurrence_interval
       OR v_quote.base_amount_usd_cents IS DISTINCT FROM v_intent.base_amount_usd_cents
       OR v_quote.charged_amount_minor IS DISTINCT FROM v_intent.charged_amount_minor
       OR v_quote.charged_currency IS DISTINCT FROM v_intent.charged_currency
       OR v_quote.conversion_rate IS DISTINCT FROM v_intent.conversion_rate THEN
      RAISE EXCEPTION 'Payment quote idempotency key was replayed with different terms'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_quote.id,
      v_quote.sponsorship_intent_id,
      v_quote.provider,
      v_quote.provider_account_scope,
      v_quote.base_amount_usd_cents,
      v_quote.charged_amount_minor,
      v_quote.charged_currency,
      v_quote.conversion_rate,
      v_quote.issued_at,
      v_quote.expires_at;
    RETURN;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR UPDATE;

  IF NOT FOUND OR v_intent.status <> 'created' THEN
    RAISE EXCEPTION 'Payment quote requires a newly created sponsorship intent'
      USING ERRCODE = '23514';
  END IF;

  v_now := clock_timestamp();

  IF v_intent.currency_quote_at > v_now + interval '1 minute'
     OR v_intent.currency_quote_at < v_now - interval '5 minutes' THEN
    RAISE EXCEPTION 'Intent currency basis is stale or future dated'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.validate_sponsorship_checkout_eligibility(v_intent.id);
  PERFORM private.validate_payment_provider_readiness(
    v_intent.id,
    target_provider,
    target_provider_account_scope
  );

  PERFORM private.set_payment_audit_context(
    'issue_sponsorship_payment_quote',
    target_provider,
    target_provider_account_scope,
    NULL,
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  INSERT INTO public.sponsorship_payment_quotes (
    sponsorship_intent_id,
    provider,
    provider_account_scope,
    quote_idempotency_key,
    quote_source,
    payment_mode,
    recurrence_interval,
    base_amount_usd_cents,
    charged_currency,
    conversion_rate,
    charged_amount_minor,
    issued_at,
    expires_at
  )
  VALUES (
    v_intent.id,
    target_provider,
    target_provider_account_scope,
    target_quote_idempotency_key,
    v_intent.currency_rate_source,
    v_intent.payment_mode,
    v_intent.recurrence_interval,
    v_intent.base_amount_usd_cents,
    v_intent.charged_currency,
    v_intent.conversion_rate,
    v_intent.charged_amount_minor,
    v_now,
    v_now + target_valid_for
  )
  RETURNING * INTO v_quote;

  RETURN QUERY SELECT
    v_quote.id,
    v_quote.sponsorship_intent_id,
    v_quote.provider,
    v_quote.provider_account_scope,
    v_quote.base_amount_usd_cents,
    v_quote.charged_amount_minor,
    v_quote.charged_currency,
    v_quote.conversion_rate,
    v_quote.issued_at,
    v_quote.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) IS
  'Issues one immutable provider scoped quote per global idempotency key, and recovers an exact quote after checkout begins without changing terms or expiry.';

COMMIT;

BEGIN;

/*
 * Preserve the original, battle tested cancellation state machine as a
 * private implementation. Public entrypoints below now select an explicit
 * sponsor or administrator authorization policy before reaching it.
 */
ALTER FUNCTION public.begin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) SET SCHEMA private;

ALTER FUNCTION private.begin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) RENAME TO execute_sponsorship_subscription_cancellation;

REVOKE ALL ON FUNCTION private.execute_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

/*
 * A successful server-side email token verification records a short-lived
 * receipt against the exact Supabase Auth session that verification created.
 * Sensitive sponsor actions trust this purpose-bound receipt, not the generic
 * JWT AMR vocabulary, which cannot distinguish every OTP delivery channel.
 */
CREATE TABLE private.sponsor_email_authentication_receipts (
  auth_session_id uuid PRIMARY KEY
    REFERENCES auth.sessions(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  request_id text,
  trace_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT sponsor_email_authentication_receipts_lifetime_check CHECK (
    expires_at = authenticated_at + interval '15 minutes'
  ),
  CONSTRAINT sponsor_email_authentication_receipts_time_order_check CHECK (
    authenticated_at >= created_at
    AND updated_at >= authenticated_at
  ),
  CONSTRAINT sponsor_email_authentication_receipts_request_id_check CHECK (
    request_id IS NULL
    OR (
      octet_length(request_id) BETWEEN 1 AND 255
      AND request_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT sponsor_email_authentication_receipts_trace_id_check CHECK (
    trace_id IS NULL
    OR (
      octet_length(trace_id) BETWEEN 1 AND 255
      AND trace_id !~ '[[:cntrl:]]'
    )
  )
);

CREATE INDEX sponsor_email_authentication_receipts_expiry_idx
  ON private.sponsor_email_authentication_receipts (expires_at);

ALTER TABLE private.sponsor_email_authentication_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.sponsor_email_authentication_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.sponsor_email_authentication_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_sponsor_management_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := NULLIF(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Sponsor management RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Sponsor management RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_sponsor_management_service_role()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_sponsor_email_authentication_receipt(
  target_auth_user_id uuid,
  target_auth_session_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  receipt_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_request_id text := NULLIF(pg_catalog.btrim(context_request_id), '');
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
  v_session_aal text;
  v_receipt_expires_at timestamptz;
BEGIN
  PERFORM private.require_sponsor_management_service_role();

  IF pg_catalog.octet_length(COALESCE(context_request_id, '')) > 255
     OR pg_catalog.octet_length(COALESCE(context_trace_id, '')) > 255
     OR COALESCE(context_request_id, '') ~ '[[:cntrl:]]'
     OR COALESCE(context_trace_id, '') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Sponsor email authentication receipt context is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT auth_session.aal::text
  INTO v_session_aal
  FROM auth.sessions auth_session
  JOIN auth.users account
    ON account.id = auth_session.user_id
  WHERE auth_session.id = target_auth_session_id
    AND auth_session.user_id = target_auth_user_id
    AND (
      auth_session.not_after IS NULL
      OR auth_session.not_after > v_now
    )
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (
      account.banned_until IS NULL
      OR account.banned_until <= v_now
    )
  FOR SHARE OF auth_session, account;

  IF NOT FOUND OR v_session_aal NOT IN ('aal1', 'aal2') THEN
    RAISE EXCEPTION 'Sponsor email authentication receipt is not authorized'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.sponsor_email_authentication_receipts AS receipt (
    auth_session_id,
    auth_user_id,
    authenticated_at,
    expires_at,
    request_id,
    trace_id,
    created_at,
    updated_at
  )
  VALUES (
    target_auth_session_id,
    target_auth_user_id,
    v_now,
    v_now + interval '15 minutes',
    v_request_id,
    v_trace_id,
    v_now,
    v_now
  )
  ON CONFLICT (auth_session_id) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    authenticated_at = EXCLUDED.authenticated_at,
    expires_at = EXCLUDED.expires_at,
    request_id = EXCLUDED.request_id,
    trace_id = EXCLUDED.trace_id,
    updated_at = EXCLUDED.updated_at
  WHERE receipt.auth_user_id = EXCLUDED.auth_user_id
  RETURNING receipt.expires_at
  INTO v_receipt_expires_at;

  IF v_receipt_expires_at IS NULL THEN
    RAISE EXCEPTION 'Sponsor email authentication receipt is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_receipt_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION private.require_recent_sponsor_email_authentication()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_now_epoch bigint := extract(epoch FROM v_now)::bigint;
  v_auth_user_id uuid := auth.uid();
  v_claims jsonb := COALESCE(auth.jwt(), '{}'::jsonb);
  v_claimed_user_id uuid;
  v_issued_at_epoch bigint;
  v_session_claim text;
  v_session_id uuid;
  v_aal text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_auth_user_id IS NULL THEN
    RAISE EXCEPTION
      'recent-verification-required: verify your email again to continue'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_claimed_user_id := NULLIF(v_claims ->> 'sub', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_claimed_user_id := NULL;
  END;

  BEGIN
    IF COALESCE(v_claims ->> 'iat', '') !~ '^[0-9]{1,12}$' THEN
      v_issued_at_epoch := NULL;
    ELSE
      v_issued_at_epoch := (v_claims ->> 'iat')::bigint;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_issued_at_epoch := NULL;
  END;

  v_session_claim := NULLIF(pg_catalog.btrim(v_claims ->> 'session_id'), '');
  v_aal := NULLIF(pg_catalog.btrim(v_claims ->> 'aal'), '');

  IF v_session_claim IS NOT NULL
     AND v_session_claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    BEGIN
      v_session_id := v_session_claim::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        v_session_id := NULL;
    END;
  END IF;

  IF v_claimed_user_id IS DISTINCT FROM v_auth_user_id
     OR v_issued_at_epoch IS NULL
     OR v_issued_at_epoch > v_now_epoch + 60
     OR v_session_id IS NULL
     OR v_aal NOT IN ('aal1', 'aal2') THEN
    RAISE EXCEPTION
      'recent-verification-required: verify your email again to continue'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.sessions auth_session
  JOIN private.sponsor_email_authentication_receipts receipt
    ON receipt.auth_session_id = auth_session.id
   AND receipt.auth_user_id = auth_session.user_id
  JOIN auth.users account
    ON account.id = auth_session.user_id
  WHERE auth_session.id = v_session_id
    AND auth_session.user_id = v_auth_user_id
    AND auth_session.aal::text = v_aal
    AND (
      auth_session.not_after IS NULL
      OR auth_session.not_after > v_now
    )
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (
      account.banned_until IS NULL
      OR account.banned_until <= v_now
    )
    AND receipt.authenticated_at <= v_now + interval '60 seconds'
    AND receipt.expires_at > v_now
    AND v_issued_at_epoch >=
      extract(epoch FROM receipt.authenticated_at)::bigint - 60
  FOR SHARE OF auth_session, receipt, account;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'recent-verification-required: verify your email again to continue'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_session_id::text;
END;
$$;

REVOKE ALL ON FUNCTION private.require_recent_sponsor_email_authentication()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sponsorship_subscription_is_owned_by(
  target_auth_user_id uuid,
  target_subscription_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions subscription
    LEFT JOIN public.sponsor_identities sponsor_identity
      ON sponsor_identity.id = subscription.sponsor_identity_id
     AND sponsor_identity.status = 'active'
    WHERE subscription.id = target_subscription_id
      AND target_auth_user_id IS NOT NULL
      AND NOT (
        subscription.user_id IS NOT NULL
        AND sponsor_identity.auth_user_id IS NOT NULL
        AND subscription.user_id <> sponsor_identity.auth_user_id
      )
      AND (
        COALESCE(subscription.user_id = target_auth_user_id, false)
        OR COALESCE(
          sponsor_identity.auth_user_id = target_auth_user_id,
          false
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.sponsorship_subscription_is_owned_by(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_recent_sponsor_subscription_cancellation(
  target_subscription_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL,
  request_reason text DEFAULT NULL
)
RETURNS TABLE (
  cancellation_operation_id uuid,
  cancellation_status text,
  is_terminal boolean,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  PERFORM private.require_recent_sponsor_email_authentication();

  IF target_subscription_id IS NULL
     OR NOT private.sponsorship_subscription_is_owned_by(
       v_auth_user_id,
       target_subscription_id
     ) THEN
    RAISE EXCEPTION 'Subscription cancellation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    cancellation.cancellation_operation_id,
    cancellation.cancellation_status,
    cancellation.is_terminal,
    cancellation.replayed
  FROM private.execute_sponsorship_subscription_cancellation(
    target_subscription_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent,
    request_reason
  ) cancellation;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_super_admin_sponsorship_subscription_cancellation(
  target_subscription_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL,
  request_reason text DEFAULT NULL
)
RETURNS TABLE (
  cancellation_operation_id uuid,
  cancellation_status text,
  is_terminal boolean,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_request_reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR auth.uid() IS NULL
     OR NOT COALESCE(private.is_creator_share_super_admin(), false) THEN
    RAISE EXCEPTION 'Subscription cancellation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  PERFORM private.require_healthy_creator_share_super_admin(
    'subscription_cancellation'
  );

  v_request_reason := private.sanitize_subscription_cancellation_reason(
    request_reason
  );
  IF v_request_reason IS NULL
     OR pg_catalog.length(
       pg_catalog.btrim(
         pg_catalog.replace(v_request_reason, '[redacted]', '')
       )
     ) < 10 THEN
    RAISE EXCEPTION 'A specific administrator cancellation reason is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    cancellation.cancellation_operation_id,
    cancellation.cancellation_status,
    cancellation.is_terminal,
    cancellation.replayed
  FROM private.execute_sponsorship_subscription_cancellation(
    target_subscription_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent,
    request_reason
  ) cancellation;
END;
$$;

/*
 * This compatibility entrypoint prevents deployment ordering from reopening
 * the old browser path. Every caller, including trusted SQL sessions, crosses
 * the same sponsor or administrator authorization boundary.
 */
CREATE OR REPLACE FUNCTION public.begin_sponsorship_subscription_cancellation(
  target_subscription_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL,
  request_reason text DEFAULT NULL
)
RETURNS TABLE (
  cancellation_operation_id uuid,
  cancellation_status text,
  is_terminal boolean,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required for subscription cancellation'
      USING ERRCODE = '28000';
  END IF;

  /*
   * A staff account can also be a sponsor. Personal sponsorships always use
   * the sponsor policy. The administrator policy is reserved for a true
   * override of another sponsor's subscription.
   */
  IF private.sponsorship_subscription_is_owned_by(
       auth.uid(),
       target_subscription_id
     ) THEN
    RETURN QUERY
    SELECT
      cancellation.cancellation_operation_id,
      cancellation.cancellation_status,
      cancellation.is_terminal,
      cancellation.replayed
    FROM public.begin_recent_sponsor_subscription_cancellation(
      target_subscription_id,
      context_request_id,
      context_trace_id,
      context_client_ip,
      context_user_agent,
      request_reason
    ) cancellation;
  ELSIF COALESCE(private.is_creator_share_super_admin(), false) THEN
    RETURN QUERY
    SELECT
      cancellation.cancellation_operation_id,
      cancellation.cancellation_status,
      cancellation.is_terminal,
      cancellation.replayed
    FROM public.begin_super_admin_sponsorship_subscription_cancellation(
      target_subscription_id,
      context_request_id,
      context_trace_id,
      context_client_ip,
      context_user_agent,
      request_reason
    ) cancellation;
  ELSE
    RETURN QUERY
    SELECT
      cancellation.cancellation_operation_id,
      cancellation.cancellation_status,
      cancellation.is_terminal,
      cancellation.replayed
    FROM public.begin_recent_sponsor_subscription_cancellation(
      target_subscription_id,
      context_request_id,
      context_trace_id,
      context_client_ip,
      context_user_agent,
      request_reason
    ) cancellation;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_sponsor_subscription_payment_management(
  target_subscription_id uuid
)
RETURNS TABLE (
  authorized boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  PERFORM private.require_recent_sponsor_email_authentication();

  IF target_subscription_id IS NULL
     OR NOT private.sponsorship_subscription_is_owned_by(
       v_auth_user_id,
       target_subscription_id
     ) THEN
    RAISE EXCEPTION 'Subscription payment management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_owned_subscription_payment_management(
  target_account_id uuid,
  target_subscription_id uuid
)
RETURNS TABLE (
  payment_provider public.sponsorship_method,
  provider_account_scope text,
  provider_customer_id text,
  provider_subscription_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_identity_auth_user_id uuid;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_initial_event public.payment_gateway_events%ROWTYPE;
  v_provider public.sponsorship_method;
  v_scope text;
  v_object_type text;
  v_modern_subscription_id text;
  v_legacy_subscription_id text;
  v_subscription_id text;
  v_customer_id text;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_account_id IS NULL
     OR target_subscription_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM auth.users account
       WHERE account.id = target_account_id
         AND account.email_confirmed_at IS NOT NULL
         AND account.deleted_at IS NULL
         AND account.is_anonymous IS NOT TRUE
         AND (
           account.banned_until IS NULL
           OR account.banned_until <= clock_timestamp()
         )
     ) THEN
    RAISE EXCEPTION 'Subscription payment management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = target_subscription_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription payment management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF v_subscription.sponsor_identity_id IS NOT NULL THEN
    SELECT identity.auth_user_id
    INTO v_identity_auth_user_id
    FROM public.sponsor_identities identity
    WHERE identity.id = v_subscription.sponsor_identity_id
      AND identity.status = 'active';
  END IF;

  IF (
       v_subscription.user_id IS NOT NULL
       AND v_identity_auth_user_id IS NOT NULL
       AND v_subscription.user_id <> v_identity_auth_user_id
     )
     OR NOT (
       COALESCE(v_subscription.user_id = target_account_id, false)
       OR COALESCE(v_identity_auth_user_id = target_account_id, false)
     ) THEN
    RAISE EXCEPTION 'Subscription payment management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  v_provider := v_subscription.sponsorship_method;
  v_scope := COALESCE(
    NULLIF(pg_catalog.btrim(v_subscription.provider_account_scope), ''),
    CASE v_provider
      WHEN 'STRIPE' THEN 'stripe_' || v_subscription.payment_region::text
      WHEN 'PAYPAL' THEN 'paypal'
      ELSE NULL
    END
  );
  v_object_type := COALESCE(
    NULLIF(
      pg_catalog.btrim(v_subscription.provider_subscription_object_type),
      ''
    ),
    CASE v_provider
      WHEN 'STRIPE' THEN 'subscription'
      WHEN 'PAYPAL' THEN 'billing_subscription'
      ELSE NULL
    END
  );
  v_modern_subscription_id := NULLIF(
    pg_catalog.btrim(v_subscription.provider_subscription_object_id),
    ''
  );
  v_legacy_subscription_id := NULLIF(
    pg_catalog.btrim(v_subscription.stripe_subscription_id),
    ''
  );
  v_subscription_id := COALESCE(
    v_modern_subscription_id,
    v_legacy_subscription_id
  );
  v_customer_id := NULLIF(pg_catalog.btrim(v_subscription.customer_id), '');

  IF v_provider IS NULL
     OR v_scope IS NULL
     OR v_object_type IS NULL
     OR v_subscription_id IS NULL
     OR (
       v_modern_subscription_id IS NOT NULL
       AND v_legacy_subscription_id IS NOT NULL
       AND v_modern_subscription_id <> v_legacy_subscription_id
     ) THEN
    RAISE EXCEPTION 'Subscription payment management provider chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_provider = 'STRIPE' THEN
    IF v_scope NOT IN ('stripe_us', 'stripe_uk')
       OR v_object_type <> 'subscription'
       OR v_customer_id IS NULL
       OR v_customer_id NOT LIKE 'cus\_%' ESCAPE '\'
       OR v_subscription_id NOT LIKE 'sub\_%' ESCAPE '\'
       OR (
         v_scope = 'stripe_us'
         AND v_subscription.payment_region::text <> 'us'
       )
       OR (
         v_scope = 'stripe_uk'
         AND v_subscription.payment_region::text <> 'uk'
       ) THEN
      RAISE EXCEPTION 'Subscription payment management provider chain is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_provider = 'PAYPAL' THEN
    IF v_scope <> 'paypal'
       OR v_object_type <> 'billing_subscription'
       OR v_subscription_id !~ '^I-[A-Z0-9-]{8,62}$' THEN
      RAISE EXCEPTION 'Subscription payment management provider chain is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Subscription payment management provider chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_provider = 'STRIPE' THEN
    /*
     * A Stripe Billing Portal session controls a customer, not merely the
     * selected subscription. Lock and reject every known legacy subscription
     * or modern payment chain that assigns this scoped customer to anyone
     * other than the requesting sponsor.
     */
    PERFORM related_subscription.id
    FROM public.subscriptions related_subscription
    WHERE related_subscription.sponsorship_method = 'STRIPE'
      AND (
        NULLIF(
          pg_catalog.btrim(related_subscription.provider_account_scope),
          ''
        ) = v_scope
        OR 'stripe_' || related_subscription.payment_region::text = v_scope
      )
      AND NULLIF(
        pg_catalog.btrim(related_subscription.customer_id),
        ''
      ) = v_customer_id
    FOR SHARE;

    PERFORM related_attempt.id
    FROM public.sponsorship_payment_attempts related_attempt
    WHERE related_attempt.provider = 'STRIPE'
      AND related_attempt.provider_account_scope = v_scope
      AND related_attempt.provider_customer_id = v_customer_id
    FOR SHARE;

    IF EXISTS (
      SELECT 1
      FROM public.subscriptions related_subscription
      LEFT JOIN public.sponsor_identities related_identity
        ON related_identity.id = related_subscription.sponsor_identity_id
       AND related_identity.status = 'active'
      WHERE related_subscription.sponsorship_method = 'STRIPE'
        AND (
          NULLIF(
            pg_catalog.btrim(related_subscription.provider_account_scope),
            ''
          ) = v_scope
          OR 'stripe_' || related_subscription.payment_region::text = v_scope
        )
        AND NULLIF(
          pg_catalog.btrim(related_subscription.customer_id),
          ''
        ) = v_customer_id
        AND (
          (
            related_subscription.user_id IS NOT NULL
            AND related_identity.auth_user_id IS NOT NULL
            AND related_subscription.user_id <>
              related_identity.auth_user_id
          )
          OR NOT (
            COALESCE(
              related_subscription.user_id = target_account_id,
              false
            )
            OR COALESCE(
              related_identity.auth_user_id = target_account_id,
              false
            )
          )
        )
    ) OR EXISTS (
      SELECT 1
      FROM public.sponsorship_payment_attempts related_attempt
      JOIN public.sponsorship_intents related_intent
        ON related_intent.id = related_attempt.sponsorship_intent_id
      LEFT JOIN public.sponsor_identities related_identity
        ON related_identity.id = related_intent.sponsor_identity_id
       AND related_identity.status = 'active'
      WHERE related_attempt.provider = 'STRIPE'
        AND related_attempt.provider_account_scope = v_scope
        AND related_attempt.provider_customer_id = v_customer_id
        AND (
          related_identity.auth_user_id IS DISTINCT FROM target_account_id
          OR (
            related_intent.auth_user_id IS NOT NULL
            AND related_intent.auth_user_id IS DISTINCT FROM target_account_id
          )
        )
    ) THEN
      RAISE EXCEPTION 'Subscription payment management provider customer ownership is ambiguous'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_subscription.sponsorship_intent_id IS NULL THEN
    IF v_subscription.payment_attempt_id IS NOT NULL
       OR v_subscription.initial_gateway_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'Subscription payment management provider chain is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT intent.*
    INTO v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = v_subscription.sponsorship_intent_id;

    SELECT attempt.*
    INTO v_attempt
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.id = v_subscription.payment_attempt_id;

    SELECT gateway_event.*
    INTO v_initial_event
    FROM public.payment_gateway_events gateway_event
    WHERE gateway_event.id = v_subscription.initial_gateway_event_id;

    IF v_intent.id IS NULL
       OR v_attempt.id IS NULL
       OR v_initial_event.id IS NULL
       OR v_identity_auth_user_id IS DISTINCT FROM target_account_id
       OR v_intent.sponsor_identity_id IS DISTINCT FROM
         v_subscription.sponsor_identity_id
       OR (
         v_intent.auth_user_id IS NOT NULL
         AND v_intent.auth_user_id IS DISTINCT FROM target_account_id
       )
       OR v_intent.payment_mode IS DISTINCT FROM 'recurring'
       OR v_attempt.sponsorship_intent_id IS DISTINCT FROM v_intent.id
       OR v_attempt.provider IS DISTINCT FROM v_provider
       OR v_attempt.provider_account_scope IS DISTINCT FROM v_scope
       OR v_attempt.payment_mode IS DISTINCT FROM 'recurring'
       OR v_attempt.provider_customer_id IS DISTINCT FROM v_customer_id
       OR v_attempt.provider_subscription_object_type IS DISTINCT FROM
         v_object_type
       OR v_attempt.provider_subscription_object_id IS DISTINCT FROM
         v_subscription_id
       OR v_initial_event.payment_attempt_id IS DISTINCT FROM v_attempt.id
       OR v_initial_event.sponsorship_intent_id IS DISTINCT FROM v_intent.id
       OR v_initial_event.provider IS DISTINCT FROM v_provider
       OR v_initial_event.provider_account_scope IS DISTINCT FROM v_scope
       OR v_initial_event.fact_provider_customer_id IS DISTINCT FROM
         v_customer_id
       OR v_initial_event.fact_provider_subscription_id IS DISTINCT FROM
         v_subscription_id
       OR NOT EXISTS (
         SELECT 1
         FROM public.payment_provider_object_links provider_link
         WHERE provider_link.payment_attempt_id = v_attempt.id
           AND provider_link.sponsorship_intent_id = v_intent.id
           AND provider_link.provider = v_provider
           AND provider_link.provider_account_scope = v_scope
           AND provider_link.provider_object_type = v_object_type
           AND provider_link.provider_object_id = v_subscription_id
           AND provider_link.relationship = 'subscription'
       ) THEN
      RAISE EXCEPTION 'Subscription payment management provider chain is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_provider,
    v_scope,
    v_customer_id,
    v_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_recent_sponsor_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_recent_sponsor_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.record_sponsor_email_authentication_receipt(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_email_authentication_receipt(
  uuid,
  uuid,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.begin_super_admin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_super_admin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.begin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.authorize_sponsor_subscription_payment_management(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_sponsor_subscription_payment_management(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_owned_subscription_payment_management(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_owned_subscription_payment_management(uuid, uuid)
  TO service_role;

COMMENT ON TABLE private.sponsor_email_authentication_receipts IS
  'Purpose-bound proof that Creator Share successfully verified an email token for an exact live Auth session. Rows expire after fifteen minutes.';
COMMENT ON FUNCTION private.require_sponsor_management_service_role() IS
  'Rejects calls outside the trusted server service-role boundary.';
COMMENT ON FUNCTION public.record_sponsor_email_authentication_receipt(
  uuid,
  uuid,
  text,
  text
) IS
  'Service-only recorder for a successful server-side email token verification. Returns the purpose-bound receipt expiry.';
COMMENT ON FUNCTION private.require_recent_sponsor_email_authentication() IS
  'Requires a provider-signed authenticated JWT bound to a live Auth session and a server-recorded email authentication receipt no older than fifteen minutes.';
COMMENT ON FUNCTION public.begin_recent_sponsor_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) IS
  'Owner-only cancellation boundary requiring recent provider signed email authentication. Returns no provider identifiers.';
COMMENT ON FUNCTION public.begin_super_admin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) IS
  'Global super administrator cancellation boundary requiring a specific sanitized reason. Returns no provider identifiers.';
COMMENT ON FUNCTION public.begin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) IS
  'Compatibility boundary. Every sponsor request requires recent email authentication and every administrator request remains account-health and reason gated.';
COMMENT ON FUNCTION public.authorize_sponsor_subscription_payment_management(uuid)
IS
  'Privacy-safe owner authorization requiring recent email authentication. Returns one boolean and no provider routing material.';
COMMENT ON FUNCTION public.resolve_owned_subscription_payment_management(uuid, uuid)
IS
  'Service-only exact ownership and provider-chain resolver for subscription payment management. Stripe customer scope must be exclusively sponsor-owned. Provider identifiers never cross an authenticated browser RPC.';

COMMIT;

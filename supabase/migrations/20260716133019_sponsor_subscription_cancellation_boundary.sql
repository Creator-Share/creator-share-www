BEGIN;

CREATE TYPE public.sponsorship_subscription_cancellation_status AS ENUM (
  'requested',
  'processing',
  'retryable',
  'cancelled',
  'manual_review'
);

CREATE TYPE public.sponsorship_subscription_cancellation_result AS ENUM (
  'subscription_already_cancelled',
  'provider_cancelled',
  'provider_already_cancelled',
  'provider_not_found',
  'provider_retryable_error',
  'provider_terminal_error',
  'provider_reference_missing',
  'provider_reference_conflict',
  'retry_exhausted'
);

CREATE TABLE public.sponsorship_subscription_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL UNIQUE
    REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  effective_user_id uuid
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_is_super_admin boolean NOT NULL DEFAULT false,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_object_type text,
  provider_object_id text,
  status public.sponsorship_subscription_cancellation_status NOT NULL
    DEFAULT 'requested',
  result public.sponsorship_subscription_cancellation_result,
  request_count integer NOT NULL DEFAULT 1,
  claim_attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  processing_lease_token uuid,
  processing_lease_owner text,
  processing_lease_expires_at timestamptz,
  provider_evidence_sha256 bytea,
  provider_evidence_recorded_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_subscription_cancellations_provider_scope_check CHECK (
    (provider IS NULL AND provider_account_scope IS NULL)
    OR (
      provider IS NOT NULL
      AND provider_account_scope IS NOT NULL
      AND provider_account_scope = lower(btrim(provider_account_scope))
      AND length(provider_account_scope) BETWEEN 1 AND 120
    )
  ),
  CONSTRAINT sponsorship_subscription_cancellations_provider_object_check CHECK (
    (provider_object_type IS NULL AND provider_object_id IS NULL)
    OR (
      provider IS NOT NULL
      AND provider_account_scope IS NOT NULL
      AND provider_object_type IS NOT NULL
      AND provider_object_id IS NOT NULL
      AND provider_object_type = lower(btrim(provider_object_type))
      AND length(provider_object_type) BETWEEN 1 AND 80
      AND provider_object_id = btrim(provider_object_id)
      AND length(provider_object_id) BETWEEN 1 AND 255
    )
  ),
  CONSTRAINT sponsorship_subscription_cancellations_counts_check CHECK (
    request_count BETWEEN 1 AND 2147483647
    AND claim_attempt_count BETWEEN 0 AND 8
  ),
  CONSTRAINT sponsorship_subscription_cancellations_lease_check CHECK (
    (
      status = 'processing'
      AND processing_lease_token IS NOT NULL
      AND processing_lease_owner IS NOT NULL
      AND processing_lease_owner = btrim(processing_lease_owner)
      AND length(processing_lease_owner) BETWEEN 1 AND 120
      AND processing_lease_expires_at IS NOT NULL
    )
    OR (
      status <> 'processing'
      AND processing_lease_token IS NULL
      AND processing_lease_owner IS NULL
      AND processing_lease_expires_at IS NULL
    )
  ),
  CONSTRAINT sponsorship_subscription_cancellations_schedule_check CHECK (
    (
      status IN ('requested', 'retryable')
      AND next_attempt_at IS NOT NULL
    )
    OR (
      status IN ('processing', 'cancelled', 'manual_review')
      AND next_attempt_at IS NULL
    )
  ),
  CONSTRAINT sponsorship_subscription_cancellations_result_check CHECK (
    (status = 'requested' AND result IS NULL AND settled_at IS NULL)
    OR (
      status = 'processing'
      AND result IS NOT NULL
      AND result IN ('provider_retryable_error')
      AND settled_at IS NULL
    )
    OR (status = 'processing' AND result IS NULL AND settled_at IS NULL)
    OR (
      status = 'retryable'
      AND result IS NOT NULL
      AND result = 'provider_retryable_error'
      AND settled_at IS NULL
    )
    OR (
      status = 'cancelled'
      AND result IS NOT NULL
      AND result IN (
        'subscription_already_cancelled',
        'provider_cancelled',
        'provider_already_cancelled',
        'provider_not_found'
      )
      AND settled_at IS NOT NULL
    )
    OR (
      status = 'manual_review'
      AND result IS NOT NULL
      AND result IN (
        'provider_terminal_error',
        'provider_reference_missing',
        'provider_reference_conflict',
        'retry_exhausted'
      )
      AND settled_at IS NOT NULL
    )
  ),
  CONSTRAINT sponsorship_subscription_cancellations_evidence_check CHECK (
    (
      result IN (
        'provider_cancelled',
        'provider_already_cancelled',
        'provider_not_found',
        'provider_retryable_error',
        'provider_terminal_error'
      )
      AND provider_evidence_sha256 IS NOT NULL
      AND octet_length(provider_evidence_sha256) = 32
      AND provider_evidence_recorded_at IS NOT NULL
    )
    OR (
      (
        result IS NULL
        OR result NOT IN (
        'provider_cancelled',
        'provider_already_cancelled',
        'provider_not_found',
        'provider_retryable_error',
        'provider_terminal_error'
        )
      )
      AND provider_evidence_sha256 IS NULL
      AND provider_evidence_recorded_at IS NULL
    )
  ),
  CONSTRAINT sponsorship_subscription_cancellations_time_check CHECK (
    updated_at >= created_at
    AND (
      provider_evidence_recorded_at IS NULL
      OR provider_evidence_recorded_at >= created_at
    )
    AND (settled_at IS NULL OR settled_at >= created_at)
  )
);

CREATE INDEX sponsorship_subscription_cancellations_claim_idx
  ON public.sponsorship_subscription_cancellations (
    status,
    next_attempt_at,
    processing_lease_expires_at,
    created_at
  )
  WHERE status IN ('requested', 'processing', 'retryable');

COMMENT ON TABLE public.sponsorship_subscription_cancellations IS
  'One durable, lease-fenced provider cancellation operation per recurring sponsorship subscription. Provider identifiers are server-only.';
COMMENT ON COLUMN public.sponsorship_subscription_cancellations.provider_object_id IS
  'Sensitive provider subscription identifier. Never returned to browser roles or copied into audit row images.';
COMMENT ON COLUMN public.sponsorship_subscription_cancellations.provider_evidence_sha256 IS
  'Digest of canonical safe provider outcome evidence. Raw provider responses are not retained here.';
COMMENT ON COLUMN public.sponsorship_subscription_cancellations.next_attempt_at IS
  'Earliest autonomous retry time. Provider retries use bounded exponential backoff. The operation UUID remains durable local correlation only.';

ALTER TABLE public.sponsorship_subscription_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsorship_subscription_cancellations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_sponsorship_subscription_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_writer text := nullif(
    pg_catalog.current_setting(
      'app.subscription_cancellation.writer',
      true
    ),
    ''
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Subscription cancellation operations cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF v_writer IS DISTINCT FROM 'rpc-v1' THEN
    RAISE EXCEPTION 'Subscription cancellation operations are RPC controlled'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    IF NEW.settled_at IS NOT NULL THEN
      NEW.settled_at := NEW.created_at;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.effective_user_id IS DISTINCT FROM OLD.effective_user_id
     OR NEW.requester_is_super_admin IS DISTINCT FROM OLD.requester_is_super_admin
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Subscription cancellation operation identity is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'cancelled' THEN
    IF NOT (
      OLD.result = 'subscription_already_cancelled'
      AND NEW.status = 'cancelled'
      AND NEW.result IN (
        'provider_cancelled',
        'provider_already_cancelled',
        'provider_not_found'
      )
      AND NEW.provider_evidence_sha256 IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Settled subscription cancellation is immutable'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'manual_review' THEN
    IF NOT (
      (
        OLD.result IN (
          'provider_reference_missing',
          'provider_reference_conflict'
        )
        AND OLD.claim_attempt_count = 0
        AND NEW.status = 'requested'
        AND NEW.result IS NULL
        AND NEW.provider IS NOT NULL
        AND NEW.provider_account_scope IS NOT NULL
        AND NEW.provider_object_type IS NOT NULL
        AND NEW.provider_object_id IS NOT NULL
      )
      OR (
        NEW.status = 'cancelled'
        AND NEW.result = 'subscription_already_cancelled'
        AND NEW.provider_evidence_sha256 IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'Manual subscription cancellation evidence is immutable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.claim_attempt_count > 0
     AND (
       NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope
       OR NEW.provider_object_type IS DISTINCT FROM OLD.provider_object_type
       OR NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id
     ) THEN
    RAISE EXCEPTION 'Claimed provider cancellation provenance is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'requested'
     AND NEW.status NOT IN ('requested', 'processing', 'cancelled', 'manual_review') THEN
    RAISE EXCEPTION 'Illegal requested cancellation transition'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'processing'
        AND NEW.status NOT IN (
          'processing',
          'retryable',
          'cancelled',
          'manual_review'
        ) THEN
    RAISE EXCEPTION 'Illegal processing cancellation transition'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'retryable'
        AND NEW.status NOT IN (
          'retryable',
          'processing',
          'cancelled',
          'manual_review'
        ) THEN
    RAISE EXCEPTION 'Illegal retryable cancellation transition'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_sponsorship_subscription_cancellation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER sponsorship_subscription_cancellations_protect
BEFORE INSERT OR UPDATE OR DELETE
ON public.sponsorship_subscription_cancellations
FOR EACH ROW
EXECUTE FUNCTION private.protect_sponsorship_subscription_cancellation();

CREATE TRIGGER sponsorship_subscription_cancellations_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.sponsorship_subscription_cancellations
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'provider_object_id',
  'processing_lease_token',
  'provider_evidence_sha256'
);

CREATE TRIGGER sponsorship_subscription_cancellations_no_truncate
BEFORE TRUNCATE ON public.sponsorship_subscription_cancellations
FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_audited_table_truncate();

CREATE OR REPLACE FUNCTION private.sanitize_subscription_cancellation_reason(
  raw_reason text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_reason text;
BEGIN
  IF raw_reason IS NULL THEN
    RETURN NULL;
  END IF;

  v_reason := pg_catalog.regexp_replace(
    pg_catalog.btrim(raw_reason),
    '[[:cntrl:]]+',
    ' ',
    'g'
  );
  v_reason := pg_catalog.regexp_replace(
    v_reason,
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_reason := pg_catalog.regexp_replace(
    v_reason,
    '[[:alnum:]._%+_-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}',
    '[redacted]',
    'gi'
  );
  v_reason := pg_catalog.regexp_replace(
    v_reason,
    '(https?://[^[:space:]]+|www\.[^[:space:]]+)',
    '[redacted]',
    'gi'
  );
  v_reason := pg_catalog.regexp_replace(
    v_reason,
    '(\m(sub|cus|evt|pi|cs)_[[:alnum:]_-]+\M|\mI-[[:alnum:]-]+\M)',
    '[redacted]',
    'gi'
  );
  v_reason := pg_catalog.regexp_replace(
    v_reason,
    '\+?[0-9][0-9() .-]{7,}[0-9]',
    '[redacted]',
    'g'
  );
  RETURN NULLIF(pg_catalog.btrim(v_reason), '');
END;
$$;

REVOKE ALL ON FUNCTION private.sanitize_subscription_cancellation_reason(text)
  FROM PUBLIC, anon, authenticated, service_role;

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
DECLARE
  v_now timestamptz := clock_timestamp();
  v_actor_user_id uuid := auth.uid();
  v_jwt_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_subscription public.subscriptions%ROWTYPE;
  v_operation public.sponsorship_subscription_cancellations%ROWTYPE;
  v_identity_auth_user_id uuid;
  v_has_ownership_conflict boolean := false;
  v_is_owner boolean := false;
  v_is_super_admin boolean := false;
  v_admin_override boolean := false;
  v_effective_user_id uuid;
  v_provider public.sponsorship_method;
  v_provider_account_scope text;
  v_provider_object_type text;
  v_provider_object_id text;
  v_modern_provider_object_id text;
  v_legacy_provider_object_id text;
  v_reference_result public.sponsorship_subscription_cancellation_result;
  v_operation_id uuid;
  v_request_reason text;
BEGIN
  IF v_jwt_role IS DISTINCT FROM 'authenticated'
     OR v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required for subscription cancellation'
      USING ERRCODE = '28000';
  END IF;

  IF target_subscription_id IS NULL THEN
    RAISE EXCEPTION 'Subscription cancellation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.octet_length(COALESCE(request_reason, '')) > 2000 THEN
    RAISE EXCEPTION 'Subscription cancellation reason is invalid'
      USING ERRCODE = '22023';
  END IF;
  v_request_reason := private.sanitize_subscription_cancellation_reason(
    request_reason
  );
  IF request_reason IS NOT NULL
     AND (
       v_request_reason IS NULL
       OR pg_catalog.length(v_request_reason) > 500
     ) THEN
    RAISE EXCEPTION 'Subscription cancellation reason is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = target_subscription_id;

  IF FOUND AND v_subscription.sponsor_identity_id IS NOT NULL THEN
    SELECT identity.auth_user_id
    INTO v_identity_auth_user_id
    FROM public.sponsor_identities identity
    WHERE identity.id = v_subscription.sponsor_identity_id
      AND identity.status = 'active';
  END IF;

  v_has_ownership_conflict :=
    v_subscription.user_id IS NOT NULL
    AND v_identity_auth_user_id IS NOT NULL
    AND v_subscription.user_id <> v_identity_auth_user_id;
  v_is_owner := v_subscription.id IS NOT NULL
    AND NOT v_has_ownership_conflict
    AND (
      COALESCE(v_subscription.user_id = v_actor_user_id, false)
      OR COALESCE(v_identity_auth_user_id = v_actor_user_id, false)
    );
  v_is_super_admin := COALESCE(
    private.is_creator_share_super_admin(),
    false
  );
  v_admin_override := v_is_super_admin AND NOT v_is_owner;

  IF NOT (v_is_owner OR v_is_super_admin) THEN
    RAISE EXCEPTION 'Subscription cancellation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_subscription_id::text, 716133019)
  );

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_subscription_cancellations operation
  WHERE operation.subscription_id = target_subscription_id
  FOR UPDATE;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = target_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription cancellation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  v_identity_auth_user_id := NULL;
  IF v_subscription.sponsor_identity_id IS NOT NULL THEN
    SELECT identity.auth_user_id
    INTO v_identity_auth_user_id
    FROM public.sponsor_identities identity
    WHERE identity.id = v_subscription.sponsor_identity_id
      AND identity.status = 'active';
  END IF;
  v_has_ownership_conflict :=
    v_subscription.user_id IS NOT NULL
    AND v_identity_auth_user_id IS NOT NULL
    AND v_subscription.user_id <> v_identity_auth_user_id;
  v_is_owner := NOT v_has_ownership_conflict
    AND (
      COALESCE(v_subscription.user_id = v_actor_user_id, false)
      OR COALESCE(v_identity_auth_user_id = v_actor_user_id, false)
    );
  v_is_super_admin := COALESCE(
    private.is_creator_share_super_admin(),
    false
  );
  v_admin_override := v_is_super_admin AND NOT v_is_owner;
  IF NOT (v_is_owner OR v_is_super_admin) THEN
    RAISE EXCEPTION 'Subscription cancellation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF v_admin_override
     AND (
       v_request_reason IS NULL
       OR pg_catalog.length(
         pg_catalog.btrim(
           pg_catalog.replace(v_request_reason, '[redacted]', '')
         )
       ) < 10
     ) THEN
    RAISE EXCEPTION 'A specific administrator cancellation reason is required'
      USING ERRCODE = '22023';
  END IF;

  v_effective_user_id := CASE
    WHEN v_has_ownership_conflict THEN NULL
    ELSE COALESCE(v_subscription.user_id, v_identity_auth_user_id)
  END;
  v_provider := v_subscription.sponsorship_method;
  v_modern_provider_object_id := nullif(
    btrim(v_subscription.provider_subscription_object_id),
    ''
  );
  v_legacy_provider_object_id := nullif(
    btrim(v_subscription.stripe_subscription_id),
    ''
  );
  v_provider_object_id := COALESCE(
    v_modern_provider_object_id,
    v_legacy_provider_object_id
  );
  v_provider_account_scope := COALESCE(
    nullif(btrim(v_subscription.provider_account_scope), ''),
    CASE v_provider
      WHEN 'STRIPE' THEN 'stripe_' || v_subscription.payment_region::text
      WHEN 'PAYPAL' THEN 'paypal'
      ELSE NULL
    END
  );
  v_provider_object_type := COALESCE(
    nullif(btrim(v_subscription.provider_subscription_object_type), ''),
    CASE v_provider
      WHEN 'STRIPE' THEN 'subscription'
      WHEN 'PAYPAL' THEN 'billing_subscription'
      ELSE NULL
    END
  );

  IF v_provider IS NULL
     OR v_provider_account_scope IS NULL
     OR v_provider_object_type IS NULL
     OR v_provider_object_id IS NULL THEN
    v_reference_result := 'provider_reference_missing';
  ELSIF (
    v_modern_provider_object_id IS NOT NULL
    AND v_legacy_provider_object_id IS NOT NULL
    AND v_modern_provider_object_id <> v_legacy_provider_object_id
  ) OR (
    v_provider = 'STRIPE'
    AND (
      v_provider_account_scope NOT IN ('stripe_us', 'stripe_uk')
      OR v_provider_object_type <> 'subscription'
    )
  ) OR (
    v_provider = 'PAYPAL'
    AND (
      v_provider_account_scope <> 'paypal'
      OR v_provider_object_type <> 'billing_subscription'
    )
  ) THEN
    v_reference_result := 'provider_reference_conflict';
  ELSE
    v_reference_result := NULL;
  END IF;

  IF v_reference_result = 'provider_reference_missing' THEN
    IF v_provider IS NULL OR v_provider_account_scope IS NULL THEN
      v_provider := NULL;
      v_provider_account_scope := NULL;
    END IF;
    IF v_provider IS NULL
       OR v_provider_account_scope IS NULL
       OR v_provider_object_type IS NULL
       OR v_provider_object_id IS NULL THEN
      v_provider_object_type := NULL;
      v_provider_object_id := NULL;
    END IF;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => CASE
      WHEN v_admin_override THEN 'creator_share_admin'::audit.audit_actor_type
      ELSE 'user'::audit.audit_actor_type
    END,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_effective_user_id,
    context_tool => 'begin_sponsorship_subscription_cancellation',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_client_ip => context_client_ip,
    context_user_agent => context_user_agent,
    context_reason => CASE
      WHEN v_admin_override THEN v_request_reason
      WHEN v_request_reason IS NOT NULL THEN v_request_reason
      ELSE 'Sponsor requested subscription cancellation'
    END,
    context_metadata => jsonb_build_object(
      'operation', 'begin_cancellation',
      'resource_kind', 'subscription',
      'resource_id', target_subscription_id::text,
      'ownership_conflict', v_has_ownership_conflict,
      'outcome', CASE
        WHEN v_subscription.status = 'cancelled' THEN 'already_cancelled'
        WHEN v_reference_result IS NOT NULL THEN 'manual_review'
        ELSE 'requested'
      END
    )
  );
  PERFORM pg_catalog.set_config(
    'app.subscription_cancellation.writer',
    'rpc-v1',
    true
  );

  IF v_operation.id IS NULL THEN
    v_operation_id := gen_random_uuid();
    INSERT INTO public.sponsorship_subscription_cancellations (
      id,
      subscription_id,
      requested_by_user_id,
      effective_user_id,
      requester_is_super_admin,
      provider,
      provider_account_scope,
      provider_object_type,
      provider_object_id,
      status,
      result,
      next_attempt_at,
      settled_at
    )
    VALUES (
      v_operation_id,
      target_subscription_id,
      v_actor_user_id,
      v_effective_user_id,
      v_admin_override,
      v_provider,
      v_provider_account_scope,
      v_provider_object_type,
      v_provider_object_id,
      CASE
        WHEN v_subscription.status = 'cancelled'
          THEN 'cancelled'::public.sponsorship_subscription_cancellation_status
        WHEN v_reference_result IS NOT NULL
          THEN 'manual_review'::public.sponsorship_subscription_cancellation_status
        ELSE 'requested'::public.sponsorship_subscription_cancellation_status
      END,
      CASE
        WHEN v_subscription.status = 'cancelled'
          THEN 'subscription_already_cancelled'::public.sponsorship_subscription_cancellation_result
        ELSE v_reference_result
      END,
      CASE
        WHEN v_subscription.status <> 'cancelled'
          AND v_reference_result IS NULL THEN v_now
        ELSE NULL
      END,
      CASE
        WHEN v_subscription.status = 'cancelled'
          OR v_reference_result IS NOT NULL THEN v_now
        ELSE NULL
      END
    )
    RETURNING * INTO v_operation;
  ELSE
    IF v_subscription.status = 'cancelled'
       AND v_operation.status <> 'cancelled'
       AND NOT (
         v_operation.status = 'processing'
         AND v_operation.processing_lease_expires_at > v_now
       ) THEN
      UPDATE public.sponsorship_subscription_cancellations operation
      SET
        status = 'cancelled',
        result = 'subscription_already_cancelled',
        processing_lease_token = NULL,
        processing_lease_owner = NULL,
        processing_lease_expires_at = NULL,
        next_attempt_at = NULL,
        provider_evidence_sha256 = NULL,
        provider_evidence_recorded_at = NULL,
        settled_at = v_now
      WHERE operation.id = v_operation.id
      RETURNING * INTO v_operation;
    ELSIF v_operation.status = 'manual_review'
          AND v_operation.result IN (
            'provider_reference_missing',
            'provider_reference_conflict'
          )
          AND v_operation.claim_attempt_count = 0
          AND v_reference_result IS NULL THEN
      UPDATE public.sponsorship_subscription_cancellations operation
      SET
        provider = v_provider,
        provider_account_scope = v_provider_account_scope,
        provider_object_type = v_provider_object_type,
        provider_object_id = v_provider_object_id,
        status = 'requested',
        result = NULL,
        request_count = operation.request_count + 1,
        next_attempt_at = v_now,
        settled_at = NULL
      WHERE operation.id = v_operation.id
      RETURNING * INTO v_operation;
    ELSIF v_operation.status IN ('requested', 'retryable') THEN
      UPDATE public.sponsorship_subscription_cancellations operation
      SET
        request_count = operation.request_count + 1,
        provider = CASE
          WHEN operation.claim_attempt_count = 0 THEN v_provider
          ELSE operation.provider
        END,
        provider_account_scope = CASE
          WHEN operation.claim_attempt_count = 0 THEN v_provider_account_scope
          ELSE operation.provider_account_scope
        END,
        provider_object_type = CASE
          WHEN operation.claim_attempt_count = 0 THEN v_provider_object_type
          ELSE operation.provider_object_type
        END,
        provider_object_id = CASE
          WHEN operation.claim_attempt_count = 0 THEN v_provider_object_id
          ELSE operation.provider_object_id
        END,
        status = CASE
          WHEN v_reference_result IS NOT NULL
            THEN 'manual_review'::public.sponsorship_subscription_cancellation_status
          ELSE operation.status
        END,
        result = COALESCE(v_reference_result, operation.result),
        provider_evidence_sha256 = CASE
          WHEN v_reference_result IS NOT NULL THEN NULL
          ELSE operation.provider_evidence_sha256
        END,
        provider_evidence_recorded_at = CASE
          WHEN v_reference_result IS NOT NULL THEN NULL
          ELSE operation.provider_evidence_recorded_at
        END,
        next_attempt_at = CASE
          WHEN v_reference_result IS NOT NULL THEN NULL
          ELSE operation.next_attempt_at
        END,
        settled_at = CASE
          WHEN v_reference_result IS NOT NULL THEN v_now
          ELSE operation.settled_at
        END
      WHERE operation.id = v_operation.id
      RETURNING * INTO v_operation;
    ELSIF v_operation.status = 'processing' THEN
      UPDATE public.sponsorship_subscription_cancellations operation
      SET request_count = operation.request_count + 1
      WHERE operation.id = v_operation.id
      RETURNING * INTO v_operation;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_operation.id,
    CASE v_operation.status
      WHEN 'requested' THEN 'pending'
      WHEN 'retryable' THEN 'pending'
      WHEN 'processing' THEN 'processing'
      WHEN 'cancelled' THEN 'cancelled'
      ELSE 'manual_review'
    END,
    v_operation.status IN ('cancelled', 'manual_review'),
    v_operation.id IS DISTINCT FROM v_operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_sponsorship_subscription_cancellation_candidates(
  target_batch_size integer DEFAULT 4
)
RETURNS TABLE (
  cancellation_operation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_batch_size IS NULL
     OR target_batch_size NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Subscription cancellation candidate batch is malformed'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT operation.id
  FROM public.sponsorship_subscription_cancellations operation
  WHERE (
      operation.status IN ('requested', 'retryable')
      AND operation.next_attempt_at <= v_now
    )
    OR (
      operation.status = 'processing'
      AND operation.processing_lease_expires_at <= v_now
    )
  ORDER BY
    COALESCE(
      operation.next_attempt_at,
      operation.processing_lease_expires_at
    ),
    operation.created_at,
    operation.id
  LIMIT target_batch_size;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_sponsorship_subscription_cancellation(
  target_cancellation_operation_id uuid,
  target_lease_owner text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  cancellation_operation_id uuid,
  cancellation_status text,
  processing_lease_token uuid,
  processing_lease_expires_at timestamptz,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_object_type text,
  provider_object_id text,
  claim_attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation public.sponsorship_subscription_cancellations%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_lease_token uuid;
  v_modern_provider_object_id text;
  v_legacy_provider_object_id text;
  v_provider public.sponsorship_method;
  v_provider_account_scope text;
  v_provider_object_type text;
  v_provider_object_id text;
  v_reference_result public.sponsorship_subscription_cancellation_result;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_cancellation_operation_id IS NULL
     OR target_lease_owner IS NULL
     OR target_lease_owner <> btrim(target_lease_owner)
     OR length(target_lease_owner) NOT BETWEEN 1 AND 120
     OR target_lease_owner !~ '^[A-Za-z0-9:._/-]+$' THEN
    RAISE EXCEPTION 'Subscription cancellation claim is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_subscription_cancellations operation
  WHERE operation.id = target_cancellation_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription cancellation operation does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_operation.status IN ('cancelled', 'manual_review')
     OR (
       v_operation.status = 'processing'
       AND v_operation.processing_lease_expires_at > v_now
     )
     OR (
       v_operation.status = 'retryable'
       AND v_operation.next_attempt_at > v_now
     ) THEN
    RETURN QUERY SELECT
      v_operation.id,
      CASE v_operation.status
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'manual_review' THEN 'manual_review'
        WHEN 'retryable' THEN 'pending'
        ELSE 'processing'
      END,
      NULL::uuid,
      NULL::timestamptz,
      NULL::public.sponsorship_method,
      NULL::text,
      NULL::text,
      NULL::text,
      v_operation.claim_attempt_count;
    RETURN;
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = v_operation.subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription cancellation target no longer exists'
      USING ERRCODE = '23503';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_effective_user_id => v_operation.effective_user_id,
    context_system_actor => 'subscription_cancellation_service',
    context_tool => 'claim_sponsorship_subscription_cancellation',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_client_ip => context_client_ip,
    context_user_agent => context_user_agent,
    context_reason => 'Claim provider subscription cancellation execution lease',
    context_metadata => jsonb_build_object(
      'operation', 'claim_cancellation',
      'resource_kind', 'subscription_cancellation',
      'resource_id', v_operation.id::text,
      'retry_count', v_operation.claim_attempt_count,
      'outcome', 'processing'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.subscription_cancellation.writer',
    'rpc-v1',
    true
  );

  IF v_subscription.status = 'cancelled' THEN
    UPDATE public.sponsorship_subscription_cancellations operation
    SET
      status = 'cancelled',
      result = 'subscription_already_cancelled',
      processing_lease_token = NULL,
      processing_lease_owner = NULL,
      processing_lease_expires_at = NULL,
      next_attempt_at = NULL,
      provider_evidence_sha256 = NULL,
      provider_evidence_recorded_at = NULL,
      settled_at = v_now
    WHERE operation.id = v_operation.id
    RETURNING * INTO v_operation;

    RETURN QUERY SELECT
      v_operation.id,
      'cancelled'::text,
      NULL::uuid,
      NULL::timestamptz,
      NULL::public.sponsorship_method,
      NULL::text,
      NULL::text,
      NULL::text,
      v_operation.claim_attempt_count;
    RETURN;
  END IF;

  IF v_operation.claim_attempt_count >= 8 THEN
    UPDATE public.sponsorship_subscription_cancellations operation
    SET
      status = 'manual_review',
      result = 'retry_exhausted',
      processing_lease_token = NULL,
      processing_lease_owner = NULL,
      processing_lease_expires_at = NULL,
      next_attempt_at = NULL,
      provider_evidence_sha256 = NULL,
      provider_evidence_recorded_at = NULL,
      settled_at = v_now
    WHERE operation.id = v_operation.id
    RETURNING * INTO v_operation;

    RETURN QUERY SELECT
      v_operation.id,
      'manual_review'::text,
      NULL::uuid,
      NULL::timestamptz,
      NULL::public.sponsorship_method,
      NULL::text,
      NULL::text,
      NULL::text,
      v_operation.claim_attempt_count;
    RETURN;
  END IF;

  v_provider := v_subscription.sponsorship_method;
  v_modern_provider_object_id := nullif(
    btrim(v_subscription.provider_subscription_object_id),
    ''
  );
  v_legacy_provider_object_id := nullif(
    btrim(v_subscription.stripe_subscription_id),
    ''
  );
  v_provider_object_id := COALESCE(
    v_modern_provider_object_id,
    v_legacy_provider_object_id
  );
  v_provider_account_scope := COALESCE(
    nullif(btrim(v_subscription.provider_account_scope), ''),
    CASE v_provider
      WHEN 'STRIPE' THEN 'stripe_' || v_subscription.payment_region::text
      WHEN 'PAYPAL' THEN 'paypal'
      ELSE NULL
    END
  );
  v_provider_object_type := COALESCE(
    nullif(btrim(v_subscription.provider_subscription_object_type), ''),
    CASE v_provider
      WHEN 'STRIPE' THEN 'subscription'
      WHEN 'PAYPAL' THEN 'billing_subscription'
      ELSE NULL
    END
  );

  IF v_provider IS NULL
     OR v_provider_account_scope IS NULL
     OR v_provider_object_type IS NULL
     OR v_provider_object_id IS NULL THEN
    v_reference_result := 'provider_reference_missing';
  ELSIF (
    v_modern_provider_object_id IS NOT NULL
    AND v_legacy_provider_object_id IS NOT NULL
    AND v_modern_provider_object_id <> v_legacy_provider_object_id
  ) OR (
    v_provider = 'STRIPE'
    AND (
      v_provider_account_scope NOT IN ('stripe_us', 'stripe_uk')
      OR v_provider_object_type <> 'subscription'
    )
  ) OR (
    v_provider = 'PAYPAL'
    AND (
      v_provider_account_scope <> 'paypal'
      OR v_provider_object_type <> 'billing_subscription'
    )
  ) OR (
    v_operation.claim_attempt_count > 0
    AND (
      v_operation.provider IS DISTINCT FROM v_provider
      OR v_operation.provider_account_scope IS DISTINCT FROM
        v_provider_account_scope
      OR v_operation.provider_object_type IS DISTINCT FROM
        v_provider_object_type
      OR v_operation.provider_object_id IS DISTINCT FROM v_provider_object_id
    )
  ) THEN
    v_reference_result := 'provider_reference_conflict';
  ELSE
    v_reference_result := NULL;
  END IF;

  IF v_reference_result IS NOT NULL THEN
    UPDATE public.sponsorship_subscription_cancellations operation
    SET
      status = 'manual_review',
      result = v_reference_result,
      processing_lease_token = NULL,
      processing_lease_owner = NULL,
      processing_lease_expires_at = NULL,
      next_attempt_at = NULL,
      provider_evidence_sha256 = NULL,
      provider_evidence_recorded_at = NULL,
      settled_at = v_now
    WHERE operation.id = v_operation.id
    RETURNING * INTO v_operation;

    RETURN QUERY SELECT
      v_operation.id,
      'manual_review'::text,
      NULL::uuid,
      NULL::timestamptz,
      NULL::public.sponsorship_method,
      NULL::text,
      NULL::text,
      NULL::text,
      v_operation.claim_attempt_count;
    RETURN;
  END IF;

  v_lease_token := gen_random_uuid();
  UPDATE public.sponsorship_subscription_cancellations operation
  SET
    provider = v_provider,
    provider_account_scope = v_provider_account_scope,
    provider_object_type = v_provider_object_type,
    provider_object_id = v_provider_object_id,
    status = 'processing',
    claim_attempt_count = operation.claim_attempt_count + 1,
    next_attempt_at = NULL,
    processing_lease_token = v_lease_token,
    processing_lease_owner = target_lease_owner,
    processing_lease_expires_at = v_now + interval '5 minutes'
  WHERE operation.id = v_operation.id
  RETURNING * INTO v_operation;

  RETURN QUERY SELECT
    v_operation.id,
    'processing'::text,
    v_operation.processing_lease_token,
    v_operation.processing_lease_expires_at,
    v_operation.provider,
    v_operation.provider_account_scope,
    v_operation.provider_object_type,
    v_operation.provider_object_id,
    v_operation.claim_attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_sponsorship_subscription_cancellation(
  target_cancellation_operation_id uuid,
  target_processing_lease_token uuid,
  target_provider_result public.sponsorship_subscription_cancellation_result,
  target_provider_evidence_sha256 bytea,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  cancellation_operation_id uuid,
  cancellation_status text,
  is_terminal boolean,
  provider_effect_recorded boolean,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation public.sponsorship_subscription_cancellations%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_provider_effect boolean;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_cancellation_operation_id IS NULL
     OR target_processing_lease_token IS NULL
     OR target_provider_result IS NULL
     OR target_provider_result NOT IN (
       'provider_cancelled',
       'provider_already_cancelled',
       'provider_not_found',
       'provider_retryable_error',
       'provider_terminal_error'
     )
     OR octet_length(target_provider_evidence_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Subscription cancellation settlement is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_subscription_cancellations operation
  WHERE operation.id = target_cancellation_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription cancellation operation does not exist'
      USING ERRCODE = '23503';
  END IF;

  v_provider_effect := target_provider_result IN (
    'provider_cancelled',
    'provider_already_cancelled',
    'provider_not_found'
  );

  IF v_operation.status IN ('cancelled', 'manual_review') THEN
    IF v_operation.result = target_provider_result
       AND v_operation.provider_evidence_sha256 =
         target_provider_evidence_sha256 THEN
      RETURN QUERY SELECT
        v_operation.id,
        CASE v_operation.status
          WHEN 'cancelled' THEN 'cancelled'
          ELSE 'manual_review'
        END,
        true,
        v_operation.status = 'cancelled',
        true;
      RETURN;
    ELSIF v_operation.status = 'cancelled'
          AND v_operation.result = 'subscription_already_cancelled'
          AND v_provider_effect THEN
      PERFORM audit.set_actor_context(
        context_actor_type => 'system'::audit.audit_actor_type,
        context_effective_user_id => v_operation.effective_user_id,
        context_system_actor => 'subscription_cancellation_service',
        context_tool => 'settle_sponsorship_subscription_cancellation',
        context_request_id => context_request_id,
        context_trace_id => context_trace_id,
        context_client_ip => context_client_ip,
        context_user_agent => context_user_agent,
        context_reason => 'Record provider cancellation evidence after local lifecycle convergence',
        context_metadata => jsonb_build_object(
          'operation', 'settle_cancellation',
          'resource_kind', 'subscription_cancellation',
          'resource_id', v_operation.id::text,
          'provider', COALESCE(v_operation.provider::text, 'unknown'),
          'provider_account_scope', v_operation.provider_account_scope,
          'outcome', target_provider_result::text
        )
      );
      PERFORM pg_catalog.set_config(
        'app.subscription_cancellation.writer',
        'rpc-v1',
        true
      );

      UPDATE public.sponsorship_subscription_cancellations operation
      SET
        result = target_provider_result,
        provider_evidence_sha256 = target_provider_evidence_sha256,
        provider_evidence_recorded_at = v_now
      WHERE operation.id = v_operation.id
      RETURNING * INTO v_operation;

      RETURN QUERY SELECT
        v_operation.id,
        'cancelled'::text,
        true,
        true,
        false;
      RETURN;
    ELSE
      RAISE EXCEPTION 'Subscription cancellation settlement conflicts with terminal evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_operation.status <> 'processing'
     OR v_operation.processing_lease_token IS DISTINCT FROM
       target_processing_lease_token
     OR v_operation.processing_lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Subscription cancellation processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = v_operation.subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription cancellation target no longer exists'
      USING ERRCODE = '23503';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_effective_user_id => v_operation.effective_user_id,
    context_system_actor => 'subscription_cancellation_service',
    context_tool => 'settle_sponsorship_subscription_cancellation',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_client_ip => context_client_ip,
    context_user_agent => context_user_agent,
    context_reason => 'Settle provider subscription cancellation result',
    context_metadata => jsonb_build_object(
      'operation', 'settle_cancellation',
      'resource_kind', 'subscription_cancellation',
      'resource_id', v_operation.id::text,
      'provider', COALESCE(v_operation.provider::text, 'unknown'),
      'provider_account_scope', v_operation.provider_account_scope,
      'outcome', target_provider_result::text
    )
  );
  PERFORM pg_catalog.set_config(
    'app.subscription_cancellation.writer',
    'rpc-v1',
    true
  );

  IF v_provider_effect THEN
    UPDATE public.subscriptions subscription
    SET
      status = 'cancelled',
      canceled_at = COALESCE(
        subscription.canceled_at,
        v_now AT TIME ZONE 'UTC'
      )
    WHERE subscription.id = v_operation.subscription_id;

    UPDATE public.sponsorship_subscription_cancellations operation
    SET
      status = 'cancelled',
      result = target_provider_result,
      processing_lease_token = NULL,
      processing_lease_owner = NULL,
      processing_lease_expires_at = NULL,
      next_attempt_at = NULL,
      provider_evidence_sha256 = target_provider_evidence_sha256,
      provider_evidence_recorded_at = v_now,
      settled_at = v_now
    WHERE operation.id = v_operation.id
    RETURNING * INTO v_operation;
  ELSIF target_provider_result = 'provider_retryable_error' THEN
    UPDATE public.sponsorship_subscription_cancellations operation
    SET
      status = 'retryable',
      result = target_provider_result,
      processing_lease_token = NULL,
      processing_lease_owner = NULL,
      processing_lease_expires_at = NULL,
      next_attempt_at = v_now + (
        LEAST(
          60::double precision,
          power(
            2::double precision,
            GREATEST(v_operation.claim_attempt_count - 1, 0)
          )
        ) * interval '1 minute'
      ),
      provider_evidence_sha256 = target_provider_evidence_sha256,
      provider_evidence_recorded_at = v_now,
      settled_at = NULL
    WHERE operation.id = v_operation.id
    RETURNING * INTO v_operation;
  ELSE
    UPDATE public.sponsorship_subscription_cancellations operation
    SET
      status = 'manual_review',
      result = target_provider_result,
      processing_lease_token = NULL,
      processing_lease_owner = NULL,
      processing_lease_expires_at = NULL,
      next_attempt_at = NULL,
      provider_evidence_sha256 = target_provider_evidence_sha256,
      provider_evidence_recorded_at = v_now,
      settled_at = v_now
    WHERE operation.id = v_operation.id
    RETURNING * INTO v_operation;
  END IF;

  RETURN QUERY SELECT
    v_operation.id,
    CASE v_operation.status
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'manual_review' THEN 'manual_review'
      ELSE 'pending'
    END,
    v_operation.status IN ('cancelled', 'manual_review'),
    v_operation.status = 'cancelled',
    false;
END;
$$;

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

REVOKE ALL ON FUNCTION public.list_sponsorship_subscription_cancellation_candidates(
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_sponsorship_subscription_cancellation_candidates(
  integer
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.settle_sponsorship_subscription_cancellation(
  uuid,
  uuid,
  public.sponsorship_subscription_cancellation_result,
  bytea,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_sponsorship_subscription_cancellation(
  uuid,
  uuid,
  public.sponsorship_subscription_cancellation_result,
  bytea,
  text,
  text,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.begin_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) IS
  'Authenticated owner or global super administrator boundary. Returns only an opaque operation id and safe status.';
COMMENT ON FUNCTION public.list_sponsorship_subscription_cancellation_candidates(
  integer
) IS
  'Service-only bounded retry candidate listing. Returns opaque operation ids only and never provider routing identifiers.';
COMMENT ON FUNCTION public.claim_sponsorship_subscription_cancellation(
  uuid,
  text,
  text,
  text,
  text,
  text
) IS
  'Service-only lease claim. This is the only cancellation RPC which returns provider account and object identifiers.';
COMMENT ON FUNCTION public.settle_sponsorship_subscription_cancellation(
  uuid,
  uuid,
  public.sponsorship_subscription_cancellation_result,
  bytea,
  text,
  text,
  text,
  text
) IS
  'Service-only lease-fenced settlement. Provider cancellation or authoritative absence atomically cancels local future billing. The existing subscription trigger recalculates derived beneficiary funding totals, but this RPC performs no beneficiary assignment, bespoke beneficiary mutation, or email delivery.';

COMMIT;

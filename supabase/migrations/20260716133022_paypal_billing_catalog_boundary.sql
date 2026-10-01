BEGIN;

/*
 * PayPal recurring checkout requires a provider billing plan before a
 * subscription can be created. This catalog makes that prerequisite durable,
 * reusable, lease protected, and fully audited. Sponsor contact never enters
 * the catalog. A later checkout seals only the active plan ID that exactly
 * matches its server owned financial terms. PayPal documents 72 hours of
 * request idempotency retention. This boundary stops reuse after 48 hours to
 * retain a conservative 24 hour safety margin.
 */

DO $$ BEGIN
  CREATE TYPE public.paypal_billing_catalog_request_phase AS ENUM (
    'product',
    'plan'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.paypal_billing_catalog_manual_review_code AS ENUM (
    'product_request_ambiguous',
    'product_response_recording_failed',
    'plan_request_ambiguous',
    'plan_response_recording_failed',
    'active_plan_drift',
    'product_request_window_expired',
    'plan_request_window_expired',
    'provisioning_attempts_exhausted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.paypal_billing_catalog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_key bytea NOT NULL UNIQUE,
  provider public.sponsorship_method NOT NULL DEFAULT 'PAYPAL',
  provider_account_scope text NOT NULL DEFAULT 'paypal',
  subject_kind public.sponsorship_subject_kind NOT NULL,
  beneficiary_id uuid REFERENCES public.beneficiaries(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  recurrence_interval text NOT NULL,
  base_amount_usd_cents bigint NOT NULL,
  charged_amount_minor bigint NOT NULL,
  charged_currency public.payment_currency NOT NULL,
  conversion_rate numeric(18, 8) NOT NULL,
  currency_rate_source text NOT NULL,
  product_request_id text NOT NULL UNIQUE,
  plan_request_id text NOT NULL UNIQUE,
  product_request_started_at timestamptz,
  product_request_last_started_at timestamptz,
  product_request_attempt_count smallint NOT NULL DEFAULT 0,
  plan_request_started_at timestamptz,
  plan_request_last_started_at timestamptz,
  plan_request_attempt_count smallint NOT NULL DEFAULT 0,
  provider_product_id text UNIQUE,
  provider_plan_id text UNIQUE,
  status text NOT NULL DEFAULT 'provisioning',
  provisioning_lease_token uuid,
  provisioning_lease_expires_at timestamptz,
  provisioning_attempt_count smallint NOT NULL DEFAULT 1,
  last_error_code text,
  activated_at timestamptz,
  failed_at timestamptz,
  manual_review_code public.paypal_billing_catalog_manual_review_code,
  manual_review_evidence_sha256 bytea,
  manual_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paypal_billing_catalog_key_check CHECK (
    octet_length(catalog_key) = 32
  ),
  CONSTRAINT paypal_billing_catalog_provider_check CHECK (
    provider = 'PAYPAL'
    AND provider_account_scope = 'paypal'
  ),
  CONSTRAINT paypal_billing_catalog_subject_check CHECK (
    (
      subject_kind = 'standard'
      AND beneficiary_id IS NOT NULL
    )
    OR (
      subject_kind = 'blind'
      AND beneficiary_id IS NULL
    )
  ),
  CONSTRAINT paypal_billing_catalog_name_check CHECK (
    product_name = btrim(product_name)
    AND length(product_name) BETWEEN 1 AND 127
    AND product_name !~ '[\r\n]'
  ),
  CONSTRAINT paypal_billing_catalog_recurrence_check CHECK (
    recurrence_interval IN ('month', 'year')
  ),
  CONSTRAINT paypal_billing_catalog_amount_check CHECK (
    base_amount_usd_cents > 0
    AND charged_amount_minor > 0
    AND conversion_rate > 0
    AND round(base_amount_usd_cents * conversion_rate) = charged_amount_minor
  ),
  CONSTRAINT paypal_billing_catalog_rate_source_check CHECK (
    currency_rate_source = btrim(currency_rate_source)
    AND length(currency_rate_source) BETWEEN 1 AND 120
  ),
  CONSTRAINT paypal_billing_catalog_request_id_check CHECK (
    product_request_id = id::text
    AND product_request_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND plan_request_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND product_request_id <> plan_request_id
    AND length(product_request_id) <= 38
    AND length(plan_request_id) <= 38
  ),
  CONSTRAINT paypal_billing_catalog_product_id_check CHECK (
    provider_product_id IS NULL
    OR provider_product_id ~ '^PROD-[A-Z0-9]{17}$'
  ),
  CONSTRAINT paypal_billing_catalog_plan_id_check CHECK (
    provider_plan_id IS NULL
    OR provider_plan_id ~ '^P-[A-Z0-9]{24}$'
  ),
  CONSTRAINT paypal_billing_catalog_attempt_check CHECK (
    provisioning_attempt_count BETWEEN 1 AND 32
  ),
  CONSTRAINT paypal_billing_catalog_request_marker_check CHECK (
    (
      product_request_attempt_count = 0
      AND product_request_started_at IS NULL
      AND product_request_last_started_at IS NULL
    )
    OR (
      product_request_attempt_count BETWEEN 1 AND 32
      AND product_request_started_at IS NOT NULL
      AND product_request_last_started_at IS NOT NULL
      AND product_request_last_started_at >= product_request_started_at
    )
  ),
  CONSTRAINT paypal_billing_catalog_plan_marker_check CHECK (
    (
      plan_request_attempt_count = 0
      AND plan_request_started_at IS NULL
      AND plan_request_last_started_at IS NULL
    )
    OR (
      plan_request_attempt_count BETWEEN 1 AND 32
      AND plan_request_started_at IS NOT NULL
      AND plan_request_last_started_at IS NOT NULL
      AND plan_request_last_started_at >= plan_request_started_at
      AND provider_product_id IS NOT NULL
    )
  ),
  CONSTRAINT paypal_billing_catalog_status_check CHECK (
    status IN ('provisioning', 'active', 'failed', 'manual_review')
  ),
  CONSTRAINT paypal_billing_catalog_state_check CHECK (
    (
      status = 'provisioning'
      AND provisioning_lease_token IS NOT NULL
      AND provisioning_lease_expires_at IS NOT NULL
      AND last_error_code IS NULL
      AND activated_at IS NULL
      AND failed_at IS NULL
      AND manual_review_code IS NULL
      AND manual_review_evidence_sha256 IS NULL
      AND manual_review_at IS NULL
      AND provider_plan_id IS NULL
    )
    OR (
      status = 'active'
      AND provisioning_lease_token IS NULL
      AND provisioning_lease_expires_at IS NULL
      AND provider_product_id IS NOT NULL
      AND provider_plan_id IS NOT NULL
      AND last_error_code IS NULL
      AND activated_at IS NOT NULL
      AND failed_at IS NULL
      AND manual_review_code IS NULL
      AND manual_review_evidence_sha256 IS NULL
      AND manual_review_at IS NULL
    )
    OR (
      status = 'failed'
      AND provisioning_lease_token IS NULL
      AND provisioning_lease_expires_at IS NULL
      AND provider_plan_id IS NULL
      AND last_error_code = 'provider_rejected'
      AND activated_at IS NULL
      AND failed_at IS NOT NULL
      AND manual_review_code IS NULL
      AND manual_review_evidence_sha256 IS NULL
      AND manual_review_at IS NULL
    )
    OR (
      status = 'manual_review'
      AND provisioning_lease_token IS NULL
      AND provisioning_lease_expires_at IS NULL
      AND last_error_code IS NULL
      AND failed_at IS NULL
      AND manual_review_code IS NOT NULL
      AND octet_length(manual_review_evidence_sha256) = 32
      AND manual_review_at IS NOT NULL
    )
  ),
  CONSTRAINT paypal_billing_catalog_manual_review_shape_check CHECK (
    manual_review_code IS NULL
    OR (
      (
        manual_review_code IN (
          'product_request_ambiguous',
          'product_request_window_expired'
        )
        AND product_request_started_at IS NOT NULL
        AND provider_plan_id IS NULL
        AND activated_at IS NULL
      )
      OR (
        manual_review_code = 'product_response_recording_failed'
        AND product_request_started_at IS NOT NULL
        AND provider_plan_id IS NULL
        AND activated_at IS NULL
      )
      OR (
        manual_review_code IN (
          'plan_request_ambiguous',
          'plan_request_window_expired'
        )
        AND provider_product_id IS NOT NULL
        AND plan_request_started_at IS NOT NULL
        AND provider_plan_id IS NULL
        AND activated_at IS NULL
      )
      OR (
        manual_review_code = 'plan_response_recording_failed'
        AND provider_product_id IS NOT NULL
        AND plan_request_started_at IS NOT NULL
        AND activated_at IS NULL
      )
      OR (
        manual_review_code = 'active_plan_drift'
        AND provider_product_id IS NOT NULL
        AND provider_plan_id IS NOT NULL
        AND activated_at IS NOT NULL
      )
      OR manual_review_code = 'provisioning_attempts_exhausted'
    )
  ),
  CONSTRAINT paypal_billing_catalog_provider_account_fkey
    FOREIGN KEY (provider, provider_account_scope)
    REFERENCES public.payment_provider_accounts(provider, scope)
    ON DELETE RESTRICT
);

CREATE INDEX paypal_billing_catalog_status_time_idx
  ON public.paypal_billing_catalog_entries (status, updated_at, id);

CREATE UNIQUE INDEX paypal_billing_catalog_lease_uidx
  ON public.paypal_billing_catalog_entries (provisioning_lease_token)
  WHERE provisioning_lease_token IS NOT NULL;

CREATE OR REPLACE FUNCTION private.paypal_billing_catalog_key(
  target_subject_kind public.sponsorship_subject_kind,
  target_beneficiary_id uuid,
  target_product_name text,
  target_recurrence_interval text,
  target_base_amount_usd_cents bigint,
  target_charged_amount_minor bigint,
  target_charged_currency public.payment_currency,
  target_conversion_rate numeric,
  target_currency_rate_source text
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        target_subject_kind::text,
        target_beneficiary_id,
        target_product_name,
        target_recurrence_interval,
        target_base_amount_usd_cents,
        target_charged_amount_minor,
        target_charged_currency::text,
        target_conversion_rate::numeric(18, 8),
        target_currency_rate_source
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

CREATE OR REPLACE FUNCTION private.protect_paypal_billing_catalog_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expected_key bytea;
  v_operation text := nullif(
    pg_catalog.current_setting(
      'app.paypal_billing_catalog.lifecycle_operation',
      true
    ),
    ''
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PayPal billing catalog entries cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  v_expected_key := private.paypal_billing_catalog_key(
    NEW.subject_kind,
    NEW.beneficiary_id,
    NEW.product_name,
    NEW.recurrence_interval,
    NEW.base_amount_usd_cents,
    NEW.charged_amount_minor,
    NEW.charged_currency,
    NEW.conversion_rate,
    NEW.currency_rate_source
  );

  IF NEW.catalog_key IS DISTINCT FROM v_expected_key THEN
    RAISE EXCEPTION 'PayPal billing catalog key does not match its terms'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'provisioning'
       OR NEW.provisioning_attempt_count <> 1
       OR NEW.product_request_id IS DISTINCT FROM NEW.id::text
       OR NEW.product_request_started_at IS NOT NULL
       OR NEW.product_request_last_started_at IS NOT NULL
       OR NEW.product_request_attempt_count <> 0
       OR NEW.plan_request_started_at IS NOT NULL
       OR NEW.plan_request_last_started_at IS NOT NULL
       OR NEW.plan_request_attempt_count <> 0
       OR NEW.provider_product_id IS NOT NULL
       OR NEW.provider_plan_id IS NOT NULL
       OR NEW.manual_review_code IS NOT NULL
       OR NEW.manual_review_evidence_sha256 IS NOT NULL
       OR NEW.manual_review_at IS NOT NULL THEN
      RAISE EXCEPTION 'PayPal billing catalog entry must begin provisioning'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.catalog_key IS DISTINCT FROM OLD.catalog_key
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope
     OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
     OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
     OR NEW.product_name IS DISTINCT FROM OLD.product_name
     OR NEW.recurrence_interval IS DISTINCT FROM OLD.recurrence_interval
     OR NEW.base_amount_usd_cents IS DISTINCT FROM OLD.base_amount_usd_cents
     OR NEW.charged_amount_minor IS DISTINCT FROM OLD.charged_amount_minor
     OR NEW.charged_currency IS DISTINCT FROM OLD.charged_currency
     OR NEW.conversion_rate IS DISTINCT FROM OLD.conversion_rate
     OR NEW.currency_rate_source IS DISTINCT FROM OLD.currency_rate_source
     OR NEW.product_request_id IS DISTINCT FROM OLD.product_request_id
     OR NEW.plan_request_id IS DISTINCT FROM OLD.plan_request_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'PayPal billing catalog terms are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.provider_product_id IS DISTINCT FROM OLD.provider_product_id
     AND (
       OLD.provider_product_id IS NOT NULL
       OR NEW.provider_product_id IS NULL
       OR v_operation IS NULL
       OR v_operation NOT IN ('record_product', 'quarantine')
     ) THEN
    RAISE EXCEPTION 'PayPal catalog product binding is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.provider_plan_id IS DISTINCT FROM OLD.provider_plan_id
     AND (
       OLD.provider_plan_id IS NOT NULL
       OR NEW.provider_plan_id IS NULL
       OR v_operation IS NULL
       OR v_operation NOT IN ('activate_plan', 'quarantine')
     ) THEN
    RAISE EXCEPTION 'PayPal catalog plan binding is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'manual_review' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Manual review PayPal catalog entries are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (
      OLD.status = 'provisioning'
      AND NEW.status IN ('provisioning', 'active', 'failed', 'manual_review')
    )
    OR (OLD.status = 'failed' AND NEW.status = 'provisioning')
    OR (
      OLD.status = 'active'
      AND NEW.status = 'manual_review'
      AND v_operation = 'quarantine'
    )
  ) THEN
    RAISE EXCEPTION 'PayPal billing catalog state transition is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_operation = 'claim' THEN
    IF (
      to_jsonb(NEW) - ARRAY[
        'status',
        'provisioning_lease_token',
        'provisioning_lease_expires_at',
        'provisioning_attempt_count',
        'last_error_code',
        'failed_at',
        'updated_at'
      ]::text[]
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY[
        'status',
        'provisioning_lease_token',
        'provisioning_lease_expires_at',
        'provisioning_attempt_count',
        'last_error_code',
        'failed_at',
        'updated_at'
      ]::text[]
    ) THEN
      RAISE EXCEPTION 'PayPal catalog claim changed protected evidence'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'start_product_request' THEN
    IF OLD.status <> 'provisioning'
       OR NEW.status <> 'provisioning'
       OR (
         to_jsonb(NEW) - ARRAY[
           'product_request_started_at',
           'product_request_last_started_at',
           'product_request_attempt_count',
           'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         to_jsonb(OLD) - ARRAY[
           'product_request_started_at',
           'product_request_last_started_at',
           'product_request_attempt_count',
           'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'PayPal product request marker changed protected evidence'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'start_plan_request' THEN
    IF OLD.status <> 'provisioning'
       OR NEW.status <> 'provisioning'
       OR (
         to_jsonb(NEW) - ARRAY[
           'plan_request_started_at',
           'plan_request_last_started_at',
           'plan_request_attempt_count',
           'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         to_jsonb(OLD) - ARRAY[
           'plan_request_started_at',
           'plan_request_last_started_at',
           'plan_request_attempt_count',
           'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'PayPal plan request marker changed protected evidence'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'record_product' THEN
    IF OLD.status <> 'provisioning'
       OR NEW.status <> 'provisioning'
       OR (
         to_jsonb(NEW) - ARRAY[
           'provider_product_id',
           'provisioning_lease_expires_at',
           'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         to_jsonb(OLD) - ARRAY[
           'provider_product_id',
           'provisioning_lease_expires_at',
           'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'PayPal product settlement changed protected evidence'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'activate_plan' THEN
    IF OLD.status <> 'provisioning'
       OR NEW.status <> 'active'
       OR (
         to_jsonb(NEW) - ARRAY[
           'provider_plan_id',
           'status',
           'provisioning_lease_token',
           'provisioning_lease_expires_at',
           'activated_at',
           'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         to_jsonb(OLD) - ARRAY[
           'provider_plan_id',
           'status',
           'provisioning_lease_token',
           'provisioning_lease_expires_at',
           'activated_at',
           'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'PayPal plan activation changed protected evidence'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'provider_rejected' THEN
    IF OLD.status <> 'provisioning'
       OR NEW.status <> 'failed'
       OR (
         to_jsonb(NEW) - ARRAY[
           'status',
           'provisioning_lease_token',
           'provisioning_lease_expires_at',
           'last_error_code',
           'failed_at',
           'product_request_started_at',
           'product_request_last_started_at',
           'product_request_attempt_count',
           'plan_request_started_at',
           'plan_request_last_started_at',
           'plan_request_attempt_count',
           'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         to_jsonb(OLD) - ARRAY[
           'status',
           'provisioning_lease_token',
           'provisioning_lease_expires_at',
           'last_error_code',
           'failed_at',
           'product_request_started_at',
           'product_request_last_started_at',
           'product_request_attempt_count',
           'plan_request_started_at',
           'plan_request_last_started_at',
           'plan_request_attempt_count',
           'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'PayPal provider rejection changed protected evidence'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'quarantine' THEN
    IF NEW.status <> 'manual_review'
       OR (
         to_jsonb(NEW) - ARRAY[
           'provider_product_id',
           'provider_plan_id',
           'status',
           'provisioning_lease_token',
           'provisioning_lease_expires_at',
           'last_error_code',
           'failed_at',
           'manual_review_code',
           'manual_review_evidence_sha256',
           'manual_review_at',
           'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         to_jsonb(OLD) - ARRAY[
           'provider_product_id',
           'provider_plan_id',
           'status',
           'provisioning_lease_token',
           'provisioning_lease_expires_at',
           'last_error_code',
           'failed_at',
           'manual_review_code',
           'manual_review_evidence_sha256',
           'manual_review_at',
           'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'PayPal quarantine changed protected evidence'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'PayPal billing catalog updates require a narrow lifecycle'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER paypal_billing_catalog_entries_protect
BEFORE INSERT OR UPDATE OR DELETE
ON public.paypal_billing_catalog_entries
FOR EACH ROW EXECUTE FUNCTION private.protect_paypal_billing_catalog_entry();

CREATE TRIGGER paypal_billing_catalog_entries_touch_updated_at
BEFORE UPDATE ON public.paypal_billing_catalog_entries
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER paypal_billing_catalog_entries_no_truncate
BEFORE TRUNCATE ON public.paypal_billing_catalog_entries
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER paypal_billing_catalog_entries_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.paypal_billing_catalog_entries
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'catalog_key,provisioning_lease_token'
);

ALTER TABLE public.paypal_billing_catalog_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paypal_billing_catalog_entries
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_paypal_billing_catalog_entry(
  target_subject_kind public.sponsorship_subject_kind,
  target_beneficiary_id uuid,
  target_product_name text,
  target_recurrence_interval text,
  target_base_amount_usd_cents bigint,
  target_charged_amount_minor bigint,
  target_charged_currency public.payment_currency,
  target_conversion_rate numeric,
  target_currency_rate_source text,
  target_lease_valid_for interval DEFAULT interval '90 seconds',
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  catalog_entry_id uuid,
  catalog_status text,
  provisioning_lease_token uuid,
  product_request_id text,
  plan_request_id text,
  provider_product_id text,
  provider_plan_id text,
  provisioning_attempt_count smallint,
  provisioning_required boolean,
  replayed boolean,
  manual_review_code public.paypal_billing_catalog_manual_review_code
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_key bytea;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
  v_entry public.paypal_billing_catalog_entries%ROWTYPE;
  v_provider_account public.payment_provider_accounts%ROWTYPE;
  v_existing boolean := false;
  v_review_code public.paypal_billing_catalog_manual_review_code;
  v_review_evidence bytea;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_subject_kind NOT IN ('standard', 'blind')
     OR (target_subject_kind = 'standard') IS DISTINCT FROM
       (target_beneficiary_id IS NOT NULL)
     OR target_product_name IS NULL
     OR target_product_name IS DISTINCT FROM btrim(target_product_name)
     OR length(target_product_name) NOT BETWEEN 1 AND 127
     OR target_product_name ~ '[\r\n]'
     OR target_recurrence_interval NOT IN ('month', 'year')
     OR target_base_amount_usd_cents IS NULL
     OR target_base_amount_usd_cents <= 0
     OR target_charged_amount_minor IS NULL
     OR target_charged_amount_minor <= 0
     OR target_charged_currency IS NULL
     OR target_conversion_rate IS NULL
     OR target_conversion_rate <= 0
     OR round(target_base_amount_usd_cents * target_conversion_rate)
       IS DISTINCT FROM target_charged_amount_minor
     OR target_currency_rate_source IS NULL
     OR target_currency_rate_source IS DISTINCT FROM
       btrim(target_currency_rate_source)
     OR length(target_currency_rate_source) NOT BETWEEN 1 AND 120
     OR target_lease_valid_for IS NULL
     OR target_lease_valid_for < interval '30 seconds'
     OR target_lease_valid_for > interval '5 minutes' THEN
    RAISE EXCEPTION 'PayPal billing catalog terms are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT account.*
  INTO v_provider_account
  FROM public.payment_provider_accounts account
  WHERE account.provider = 'PAYPAL'
    AND account.scope = 'paypal'
  FOR SHARE;

  IF NOT FOUND
     OR v_provider_account.status <> 'active'
     OR v_provider_account.environment <> 'live' THEN
    RAISE EXCEPTION 'PayPal provider account is not live and active'
      USING ERRCODE = '55000';
  END IF;

  v_key := private.paypal_billing_catalog_key(
    target_subject_kind,
    target_beneficiary_id,
    target_product_name,
    target_recurrence_interval,
    target_base_amount_usd_cents,
    target_charged_amount_minor,
    target_charged_currency,
    target_conversion_rate,
    target_currency_rate_source
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.encode(v_key, 'hex'), 0)
  );

  SELECT entry.*
  INTO v_entry
  FROM public.paypal_billing_catalog_entries entry
  WHERE entry.catalog_key = v_key
  FOR UPDATE;
  v_existing := FOUND;

  IF v_existing AND v_entry.status IN ('active', 'manual_review') THEN
    RETURN QUERY SELECT
      v_entry.id,
      v_entry.status,
      NULL::uuid,
      v_entry.product_request_id,
      v_entry.plan_request_id,
      v_entry.provider_product_id,
      v_entry.provider_plan_id,
      v_entry.provisioning_attempt_count,
      false,
      true,
      v_entry.manual_review_code;
    RETURN;
  END IF;

  IF v_existing
     AND v_entry.provider_product_id IS NULL
     AND v_entry.product_request_started_at IS NOT NULL
     AND v_entry.product_request_started_at <= v_now - interval '48 hours' THEN
    v_review_code := 'product_request_window_expired';
  ELSIF v_existing
     AND v_entry.provider_product_id IS NOT NULL
     AND v_entry.provider_plan_id IS NULL
     AND v_entry.plan_request_started_at IS NOT NULL
     AND v_entry.plan_request_started_at <= v_now - interval '48 hours' THEN
    v_review_code := 'plan_request_window_expired';
  ELSIF v_existing AND v_entry.provisioning_attempt_count >= 32 THEN
    v_review_code := 'provisioning_attempts_exhausted';
  END IF;

  IF v_review_code IS NOT NULL THEN
    v_review_evidence := extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'catalog_entry_id', v_entry.id,
          'manual_review_code', v_review_code,
          'product_request_id', v_entry.product_request_id,
          'product_request_started_at', v_entry.product_request_started_at,
          'product_request_attempt_count', v_entry.product_request_attempt_count,
          'plan_request_id', v_entry.plan_request_id,
          'plan_request_started_at', v_entry.plan_request_started_at,
          'plan_request_attempt_count', v_entry.plan_request_attempt_count,
          'provisioning_attempt_count', v_entry.provisioning_attempt_count
        )::text,
        'UTF8'
      ),
      'sha256'
    );

    PERFORM audit.set_actor_context(
      context_actor_type => 'system',
      context_system_actor => 'paypal_billing_catalog_service',
      context_tool => 'claim_paypal_billing_catalog_entry',
      context_request_id => context_request_id,
      context_trace_id => context_trace_id,
      context_reason => 'Quarantine an unsafe PayPal provider request before reclaim',
      context_metadata => jsonb_build_object(
        'operation', 'quarantine',
        'resource_kind', 'paypal_billing_catalog_entry',
        'resource_id', v_entry.id::text,
        'provider', 'PAYPAL',
        'outcome', v_review_code
      )
    );
    PERFORM pg_catalog.set_config(
      'app.paypal_billing_catalog.lifecycle_operation',
      'quarantine',
      true
    );

    UPDATE public.paypal_billing_catalog_entries entry
    SET
      status = 'manual_review',
      provisioning_lease_token = NULL,
      provisioning_lease_expires_at = NULL,
      last_error_code = NULL,
      failed_at = NULL,
      manual_review_code = v_review_code,
      manual_review_evidence_sha256 = v_review_evidence,
      manual_review_at = v_now
    WHERE entry.id = v_entry.id
    RETURNING * INTO v_entry;

    RETURN QUERY SELECT
      v_entry.id,
      v_entry.status,
      NULL::uuid,
      v_entry.product_request_id,
      v_entry.plan_request_id,
      v_entry.provider_product_id,
      v_entry.provider_plan_id,
      v_entry.provisioning_attempt_count,
      false,
      true,
      v_entry.manual_review_code;
    RETURN;
  END IF;

  IF v_existing
     AND v_entry.status = 'provisioning'
     AND v_entry.provisioning_lease_expires_at > v_now THEN
    RAISE EXCEPTION 'PayPal billing catalog entry is already provisioning'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'paypal_billing_catalog_service',
    context_tool => 'claim_paypal_billing_catalog_entry',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Claim an exact PayPal billing plan for provisioning',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'paypal_billing_catalog_entry',
      'provider', 'PAYPAL',
      'provider_account_scope', 'paypal'
    )
  );

  IF NOT v_existing THEN
    v_id := gen_random_uuid();
    INSERT INTO public.paypal_billing_catalog_entries (
      id,
      catalog_key,
      subject_kind,
      beneficiary_id,
      product_name,
      recurrence_interval,
      base_amount_usd_cents,
      charged_amount_minor,
      charged_currency,
      conversion_rate,
      currency_rate_source,
      product_request_id,
      plan_request_id,
      provisioning_lease_token,
      provisioning_lease_expires_at
    ) VALUES (
      v_id,
      v_key,
      target_subject_kind,
      target_beneficiary_id,
      target_product_name,
      target_recurrence_interval,
      target_base_amount_usd_cents,
      target_charged_amount_minor,
      target_charged_currency,
      target_conversion_rate,
      target_currency_rate_source,
      v_id::text,
      gen_random_uuid()::text,
      gen_random_uuid(),
      v_now + target_lease_valid_for
    )
    RETURNING * INTO v_entry;
  ELSE
    PERFORM pg_catalog.set_config(
      'app.paypal_billing_catalog.lifecycle_operation',
      'claim',
      true
    );
    UPDATE public.paypal_billing_catalog_entries entry
    SET
      status = 'provisioning',
      provisioning_lease_token = gen_random_uuid(),
      provisioning_lease_expires_at = v_now + target_lease_valid_for,
      provisioning_attempt_count = entry.provisioning_attempt_count + 1,
      last_error_code = NULL,
      failed_at = NULL
    WHERE entry.id = v_entry.id
    RETURNING * INTO v_entry;
  END IF;

  RETURN QUERY SELECT
    v_entry.id,
    v_entry.status,
    v_entry.provisioning_lease_token,
    v_entry.product_request_id,
    v_entry.plan_request_id,
    v_entry.provider_product_id,
    v_entry.provider_plan_id,
    v_entry.provisioning_attempt_count,
    true,
    v_entry.provisioning_attempt_count > 1,
    NULL::public.paypal_billing_catalog_manual_review_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id uuid,
  target_provisioning_lease_token uuid,
  target_request_phase public.paypal_billing_catalog_request_phase,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  catalog_entry_id uuid,
  catalog_status text,
  request_phase public.paypal_billing_catalog_request_phase,
  provider_request_id text,
  request_started_at timestamptz,
  request_last_started_at timestamptz,
  request_reuse_expires_at timestamptz,
  request_attempt_count smallint,
  provider_call_allowed boolean,
  replayed boolean,
  manual_review_code public.paypal_billing_catalog_manual_review_code
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_entry public.paypal_billing_catalog_entries%ROWTYPE;
  v_prior_attempt_count smallint;
  v_review_code public.paypal_billing_catalog_manual_review_code;
  v_review_evidence bytea;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_request_phase IS NULL THEN
    RAISE EXCEPTION 'PayPal provider request phase is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT entry.*
  INTO v_entry
  FROM public.paypal_billing_catalog_entries entry
  WHERE entry.id = target_catalog_entry_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_entry.status <> 'provisioning'
     OR v_entry.provisioning_lease_token IS DISTINCT FROM
       target_provisioning_lease_token
     OR v_entry.provisioning_lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'PayPal provider request lease is no longer owned'
      USING ERRCODE = '55P03';
  END IF;

  IF target_request_phase = 'product' THEN
    IF v_entry.provider_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'PayPal product request is already settled'
        USING ERRCODE = '23514';
    END IF;
    v_prior_attempt_count := v_entry.product_request_attempt_count;
    IF v_entry.product_request_started_at IS NOT NULL
       AND v_entry.product_request_started_at <= v_now - interval '48 hours' THEN
      v_review_code := 'product_request_window_expired';
    ELSIF v_entry.product_request_attempt_count >= 32 THEN
      v_review_code := 'provisioning_attempts_exhausted';
    END IF;
  ELSE
    IF v_entry.provider_product_id IS NULL
       OR v_entry.provider_plan_id IS NOT NULL THEN
      RAISE EXCEPTION 'PayPal plan request prerequisites are not satisfied'
        USING ERRCODE = '23514';
    END IF;
    v_prior_attempt_count := v_entry.plan_request_attempt_count;
    IF v_entry.plan_request_started_at IS NOT NULL
       AND v_entry.plan_request_started_at <= v_now - interval '48 hours' THEN
      v_review_code := 'plan_request_window_expired';
    ELSIF v_entry.plan_request_attempt_count >= 32 THEN
      v_review_code := 'provisioning_attempts_exhausted';
    END IF;
  END IF;

  IF v_review_code IS NOT NULL THEN
    v_review_evidence := extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'catalog_entry_id', v_entry.id,
          'manual_review_code', v_review_code,
          'request_phase', target_request_phase,
          'provider_request_id', CASE target_request_phase
            WHEN 'product' THEN v_entry.product_request_id
            ELSE v_entry.plan_request_id
          END,
          'request_started_at', CASE target_request_phase
            WHEN 'product' THEN v_entry.product_request_started_at
            ELSE v_entry.plan_request_started_at
          END,
          'request_attempt_count', v_prior_attempt_count
        )::text,
        'UTF8'
      ),
      'sha256'
    );

    PERFORM audit.set_actor_context(
      context_actor_type => 'system',
      context_system_actor => 'paypal_billing_catalog_service',
      context_tool => 'start_paypal_billing_catalog_provider_request',
      context_request_id => context_request_id,
      context_trace_id => context_trace_id,
      context_reason => 'Quarantine a PayPal provider request outside its safe reuse boundary',
      context_metadata => jsonb_build_object(
        'operation', 'quarantine',
        'resource_kind', 'paypal_billing_catalog_entry',
        'resource_id', v_entry.id::text,
        'provider', 'PAYPAL',
        'event_type', target_request_phase,
        'outcome', v_review_code
      )
    );
    PERFORM pg_catalog.set_config(
      'app.paypal_billing_catalog.lifecycle_operation',
      'quarantine',
      true
    );

    UPDATE public.paypal_billing_catalog_entries entry
    SET
      status = 'manual_review',
      provisioning_lease_token = NULL,
      provisioning_lease_expires_at = NULL,
      last_error_code = NULL,
      failed_at = NULL,
      manual_review_code = v_review_code,
      manual_review_evidence_sha256 = v_review_evidence,
      manual_review_at = v_now
    WHERE entry.id = v_entry.id
    RETURNING * INTO v_entry;

    RETURN QUERY SELECT
      v_entry.id,
      v_entry.status,
      target_request_phase,
      NULL::text,
      CASE target_request_phase
        WHEN 'product' THEN v_entry.product_request_started_at
        ELSE v_entry.plan_request_started_at
      END,
      CASE target_request_phase
        WHEN 'product' THEN v_entry.product_request_last_started_at
        ELSE v_entry.plan_request_last_started_at
      END,
      CASE target_request_phase
        WHEN 'product' THEN v_entry.product_request_started_at
        ELSE v_entry.plan_request_started_at
      END + interval '48 hours',
      v_prior_attempt_count,
      false,
      v_prior_attempt_count > 0,
      v_entry.manual_review_code;
    RETURN;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'paypal_billing_catalog_service',
    context_tool => 'start_paypal_billing_catalog_provider_request',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Durably mark a PayPal provider request before its external call',
    context_metadata => jsonb_build_object(
      'operation', 'start_provider_request',
      'resource_kind', 'paypal_billing_catalog_entry',
      'resource_id', v_entry.id::text,
      'provider', 'PAYPAL',
      'event_type', target_request_phase,
      'correlation_id', CASE target_request_phase
        WHEN 'product' THEN v_entry.product_request_id
        ELSE v_entry.plan_request_id
      END,
      'outcome', CASE
        WHEN v_prior_attempt_count > 0 THEN 'reused'
        ELSE 'started'
      END
    )
  );
  PERFORM pg_catalog.set_config(
    'app.paypal_billing_catalog.lifecycle_operation',
    CASE target_request_phase
      WHEN 'product' THEN 'start_product_request'
      ELSE 'start_plan_request'
    END,
    true
  );

  IF target_request_phase = 'product' THEN
    UPDATE public.paypal_billing_catalog_entries entry
    SET
      product_request_started_at = coalesce(
        entry.product_request_started_at,
        v_now
      ),
      product_request_last_started_at = v_now,
      product_request_attempt_count = entry.product_request_attempt_count + 1
    WHERE entry.id = v_entry.id
    RETURNING * INTO v_entry;
  ELSE
    UPDATE public.paypal_billing_catalog_entries entry
    SET
      plan_request_started_at = coalesce(
        entry.plan_request_started_at,
        v_now
      ),
      plan_request_last_started_at = v_now,
      plan_request_attempt_count = entry.plan_request_attempt_count + 1
    WHERE entry.id = v_entry.id
    RETURNING * INTO v_entry;
  END IF;

  RETURN QUERY SELECT
    v_entry.id,
    v_entry.status,
    target_request_phase,
    CASE target_request_phase
      WHEN 'product' THEN v_entry.product_request_id
      ELSE v_entry.plan_request_id
    END,
    CASE target_request_phase
      WHEN 'product' THEN v_entry.product_request_started_at
      ELSE v_entry.plan_request_started_at
    END,
    CASE target_request_phase
      WHEN 'product' THEN v_entry.product_request_last_started_at
      ELSE v_entry.plan_request_last_started_at
    END,
    CASE target_request_phase
      WHEN 'product' THEN v_entry.product_request_started_at
      ELSE v_entry.plan_request_started_at
    END + interval '48 hours',
    CASE target_request_phase
      WHEN 'product' THEN v_entry.product_request_attempt_count
      ELSE v_entry.plan_request_attempt_count
    END,
    true,
    v_prior_attempt_count > 0,
    NULL::public.paypal_billing_catalog_manual_review_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_paypal_billing_catalog_product(
  target_catalog_entry_id uuid,
  target_provisioning_lease_token uuid,
  target_provider_product_id text,
  target_lease_valid_for interval DEFAULT interval '90 seconds',
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  catalog_entry_id uuid,
  provider_product_id text,
  plan_request_id text,
  provisioning_lease_expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_entry public.paypal_billing_catalog_entries%ROWTYPE;
  v_replayed boolean;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider_product_id IS NULL
     OR target_provider_product_id !~ '^PROD-[A-Z0-9]{17}$'
     OR target_lease_valid_for IS NULL
     OR target_lease_valid_for < interval '30 seconds'
     OR target_lease_valid_for > interval '5 minutes' THEN
    RAISE EXCEPTION 'PayPal catalog product settlement is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT entry.*
  INTO v_entry
  FROM public.paypal_billing_catalog_entries entry
  WHERE entry.id = target_catalog_entry_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_entry.status <> 'provisioning'
     OR v_entry.provisioning_lease_token IS DISTINCT FROM
       target_provisioning_lease_token
     OR v_entry.provisioning_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'PayPal catalog product lease is no longer owned'
      USING ERRCODE = '55P03';
  END IF;

  IF v_entry.product_request_started_at IS NULL
     OR v_entry.product_request_attempt_count < 1 THEN
    RAISE EXCEPTION 'PayPal product response has no durable request marker'
      USING ERRCODE = '23514';
  END IF;

  IF v_entry.provider_product_id IS NOT NULL
     AND v_entry.provider_product_id IS DISTINCT FROM
       target_provider_product_id THEN
    RAISE EXCEPTION 'PayPal catalog product was replayed with another ID'
      USING ERRCODE = '23505';
  END IF;

  v_replayed := v_entry.provider_product_id IS NOT NULL;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'paypal_billing_catalog_service',
    context_tool => 'record_paypal_billing_catalog_product',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Record the idempotent PayPal catalog product response',
    context_metadata => jsonb_build_object(
      'operation', 'settle_product',
      'resource_kind', 'paypal_billing_catalog_entry',
      'resource_id', v_entry.id::text,
      'provider', 'PAYPAL',
      'outcome', CASE WHEN v_replayed THEN 'replayed' ELSE 'recorded' END
    )
  );
  PERFORM pg_catalog.set_config(
    'app.paypal_billing_catalog.lifecycle_operation',
    'record_product',
    true
  );

  UPDATE public.paypal_billing_catalog_entries entry
  SET
    provider_product_id = target_provider_product_id,
    provisioning_lease_expires_at = clock_timestamp() + target_lease_valid_for
  WHERE entry.id = v_entry.id
  RETURNING * INTO v_entry;

  RETURN QUERY SELECT
    v_entry.id,
    v_entry.provider_product_id,
    v_entry.plan_request_id,
    v_entry.provisioning_lease_expires_at,
    v_replayed;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_paypal_billing_catalog_entry(
  target_catalog_entry_id uuid,
  target_provisioning_lease_token uuid,
  target_provider_product_id text,
  target_provider_plan_id text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  catalog_entry_id uuid,
  catalog_status text,
  provider_product_id text,
  provider_plan_id text,
  activated_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_entry public.paypal_billing_catalog_entries%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider_product_id IS NULL
     OR target_provider_product_id !~ '^PROD-[A-Z0-9]{17}$'
     OR target_provider_plan_id IS NULL
     OR target_provider_plan_id !~ '^P-[A-Z0-9]{24}$' THEN
    RAISE EXCEPTION 'PayPal catalog activation identifiers are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT entry.*
  INTO v_entry
  FROM public.paypal_billing_catalog_entries entry
  WHERE entry.id = target_catalog_entry_id
  FOR UPDATE;

  IF FOUND AND v_entry.status = 'active' THEN
    IF v_entry.provider_product_id IS DISTINCT FROM target_provider_product_id
       OR v_entry.provider_plan_id IS DISTINCT FROM target_provider_plan_id THEN
      RAISE EXCEPTION 'PayPal catalog activation replay conflicts with the active plan'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_entry.id,
      v_entry.status,
      v_entry.provider_product_id,
      v_entry.provider_plan_id,
      v_entry.activated_at,
      true;
    RETURN;
  END IF;

  IF NOT FOUND
     OR v_entry.status <> 'provisioning'
     OR v_entry.provisioning_lease_token IS DISTINCT FROM
       target_provisioning_lease_token
     OR v_entry.provisioning_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'PayPal catalog activation lease is no longer owned'
      USING ERRCODE = '55P03';
  END IF;

  IF v_entry.provider_product_id IS DISTINCT FROM target_provider_product_id THEN
    RAISE EXCEPTION 'PayPal catalog plan does not match its recorded product'
      USING ERRCODE = '23514';
  END IF;

  IF v_entry.plan_request_started_at IS NULL
     OR v_entry.plan_request_attempt_count < 1 THEN
    RAISE EXCEPTION 'PayPal plan response has no durable request marker'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'paypal_billing_catalog_service',
    context_tool => 'activate_paypal_billing_catalog_entry',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Activate an exact PayPal billing plan',
    context_metadata => jsonb_build_object(
      'operation', 'activate',
      'resource_kind', 'paypal_billing_catalog_entry',
      'resource_id', v_entry.id::text,
      'provider', 'PAYPAL',
      'outcome', 'active'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.paypal_billing_catalog.lifecycle_operation',
    'activate_plan',
    true
  );

  UPDATE public.paypal_billing_catalog_entries entry
  SET
    provider_plan_id = target_provider_plan_id,
    status = 'active',
    provisioning_lease_token = NULL,
    provisioning_lease_expires_at = NULL,
    activated_at = clock_timestamp()
  WHERE entry.id = v_entry.id
  RETURNING * INTO v_entry;

  RETURN QUERY SELECT
    v_entry.id,
    v_entry.status,
    v_entry.provider_product_id,
    v_entry.provider_plan_id,
    v_entry.activated_at,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_paypal_billing_catalog_entry(
  target_catalog_entry_id uuid,
  target_provisioning_lease_token uuid,
  target_request_phase public.paypal_billing_catalog_request_phase,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  catalog_entry_id uuid,
  catalog_status text,
  failed_request_phase public.paypal_billing_catalog_request_phase,
  last_error_code text,
  failed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_entry public.paypal_billing_catalog_entries%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_request_phase IS NULL THEN
    RAISE EXCEPTION 'PayPal provider rejection phase is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT entry.*
  INTO v_entry
  FROM public.paypal_billing_catalog_entries entry
  WHERE entry.id = target_catalog_entry_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_entry.status <> 'provisioning'
     OR v_entry.provisioning_lease_token IS DISTINCT FROM
       target_provisioning_lease_token
     OR v_entry.provisioning_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'PayPal catalog failure lease is no longer owned'
      USING ERRCODE = '55P03';
  END IF;

  IF target_request_phase = 'product' AND (
       v_entry.provider_product_id IS NOT NULL
       OR v_entry.product_request_started_at IS NULL
       OR v_entry.product_request_attempt_count < 1
     ) THEN
    RAISE EXCEPTION 'PayPal product rejection does not match an unresolved request'
      USING ERRCODE = '23514';
  ELSIF target_request_phase = 'plan' AND (
       v_entry.provider_product_id IS NULL
       OR v_entry.provider_plan_id IS NOT NULL
       OR v_entry.plan_request_started_at IS NULL
       OR v_entry.plan_request_attempt_count < 1
     ) THEN
    RAISE EXCEPTION 'PayPal plan rejection does not match an unresolved request'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'paypal_billing_catalog_service',
    context_tool => 'fail_paypal_billing_catalog_entry',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Record a known PayPal rejection with no provider side effect',
    context_metadata => jsonb_build_object(
      'operation', 'provider_rejected',
      'resource_kind', 'paypal_billing_catalog_entry',
      'resource_id', v_entry.id::text,
      'provider', 'PAYPAL',
      'event_type', target_request_phase,
      'outcome', 'provider_rejected'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.paypal_billing_catalog.lifecycle_operation',
    'provider_rejected',
    true
  );

  UPDATE public.paypal_billing_catalog_entries entry
  SET
    status = 'failed',
    provisioning_lease_token = NULL,
    provisioning_lease_expires_at = NULL,
    last_error_code = 'provider_rejected',
    failed_at = clock_timestamp(),
    product_request_started_at = CASE
      WHEN target_request_phase = 'product' THEN NULL
      ELSE entry.product_request_started_at
    END,
    product_request_last_started_at = CASE
      WHEN target_request_phase = 'product' THEN NULL
      ELSE entry.product_request_last_started_at
    END,
    product_request_attempt_count = CASE
      WHEN target_request_phase = 'product' THEN 0
      ELSE entry.product_request_attempt_count
    END,
    plan_request_started_at = CASE
      WHEN target_request_phase = 'plan' THEN NULL
      ELSE entry.plan_request_started_at
    END,
    plan_request_last_started_at = CASE
      WHEN target_request_phase = 'plan' THEN NULL
      ELSE entry.plan_request_last_started_at
    END,
    plan_request_attempt_count = CASE
      WHEN target_request_phase = 'plan' THEN 0
      ELSE entry.plan_request_attempt_count
    END
  WHERE entry.id = v_entry.id
  RETURNING * INTO v_entry;

  RETURN QUERY SELECT
    v_entry.id,
    v_entry.status,
    target_request_phase,
    v_entry.last_error_code,
    v_entry.failed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.quarantine_paypal_billing_catalog_entry(
  target_catalog_entry_id uuid,
  target_provisioning_lease_token uuid,
  target_manual_review_code public.paypal_billing_catalog_manual_review_code,
  target_evidence_sha256 bytea,
  target_observed_provider_product_id text DEFAULT NULL,
  target_observed_provider_plan_id text DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  catalog_entry_id uuid,
  catalog_status text,
  provider_product_id text,
  provider_plan_id text,
  manual_review_code public.paypal_billing_catalog_manual_review_code,
  manual_review_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_entry public.paypal_billing_catalog_entries%ROWTYPE;
  v_bound_product_id text;
  v_bound_plan_id text;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_manual_review_code IS NULL
     OR target_manual_review_code NOT IN (
       'product_request_ambiguous',
       'product_response_recording_failed',
       'plan_request_ambiguous',
       'plan_response_recording_failed',
       'active_plan_drift'
     )
     OR target_evidence_sha256 IS NULL
     OR octet_length(target_evidence_sha256) <> 32
     OR (
       target_observed_provider_product_id IS NOT NULL
       AND target_observed_provider_product_id !~ '^PROD-[A-Z0-9]{17}$'
     )
     OR (
       target_observed_provider_plan_id IS NOT NULL
       AND target_observed_provider_plan_id !~ '^P-[A-Z0-9]{24}$'
     ) THEN
    RAISE EXCEPTION 'PayPal catalog quarantine evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT entry.*
  INTO v_entry
  FROM public.paypal_billing_catalog_entries entry
  WHERE entry.id = target_catalog_entry_id
  FOR UPDATE;

  IF FOUND AND v_entry.status = 'manual_review' THEN
    IF v_entry.manual_review_code IS DISTINCT FROM target_manual_review_code
       OR v_entry.manual_review_evidence_sha256 IS DISTINCT FROM
         target_evidence_sha256 THEN
      RAISE EXCEPTION 'PayPal catalog quarantine replay conflicts with prior evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_entry.id,
      v_entry.status,
      v_entry.provider_product_id,
      v_entry.provider_plan_id,
      v_entry.manual_review_code,
      v_entry.manual_review_at,
      true;
    RETURN;
  END IF;

  IF NOT FOUND OR v_entry.status NOT IN ('provisioning', 'active') THEN
    RAISE EXCEPTION 'PayPal catalog entry cannot enter manual review'
      USING ERRCODE = '23514';
  END IF;

  IF v_entry.status = 'provisioning' AND (
       target_provisioning_lease_token IS NULL
       OR v_entry.provisioning_lease_token IS DISTINCT FROM
         target_provisioning_lease_token
     ) THEN
    RAISE EXCEPTION 'PayPal catalog quarantine lease is no longer owned'
      USING ERRCODE = '55P03';
  ELSIF v_entry.status = 'active'
        AND target_provisioning_lease_token IS NOT NULL THEN
    RAISE EXCEPTION 'Active PayPal catalog quarantine must not carry a lease'
      USING ERRCODE = '22023';
  END IF;

  IF target_manual_review_code = 'product_request_ambiguous' AND (
       v_entry.status <> 'provisioning'
       OR v_entry.product_request_started_at IS NULL
       OR v_entry.provider_product_id IS NOT NULL
       OR target_observed_provider_product_id IS NOT NULL
       OR target_observed_provider_plan_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'PayPal product ambiguity does not match catalog state'
      USING ERRCODE = '23514';
  ELSIF target_manual_review_code = 'product_response_recording_failed' AND (
       v_entry.status <> 'provisioning'
       OR v_entry.product_request_started_at IS NULL
       OR v_entry.provider_plan_id IS NOT NULL
       OR target_observed_provider_product_id IS NULL
       OR target_observed_provider_plan_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'PayPal product response evidence does not match catalog state'
      USING ERRCODE = '23514';
  ELSIF target_manual_review_code = 'plan_request_ambiguous' AND (
       v_entry.status <> 'provisioning'
       OR v_entry.provider_product_id IS NULL
       OR v_entry.plan_request_started_at IS NULL
       OR v_entry.provider_plan_id IS NOT NULL
       OR target_observed_provider_plan_id IS NOT NULL
       OR (
         target_observed_provider_product_id IS NOT NULL
         AND target_observed_provider_product_id IS DISTINCT FROM
           v_entry.provider_product_id
       )
     ) THEN
    RAISE EXCEPTION 'PayPal plan ambiguity does not match catalog state'
      USING ERRCODE = '23514';
  ELSIF target_manual_review_code = 'plan_response_recording_failed' AND (
       v_entry.status <> 'provisioning'
       OR v_entry.provider_product_id IS NULL
       OR v_entry.plan_request_started_at IS NULL
       OR target_observed_provider_plan_id IS NULL
       OR (
         target_observed_provider_product_id IS NOT NULL
         AND target_observed_provider_product_id IS DISTINCT FROM
           v_entry.provider_product_id
       )
     ) THEN
    RAISE EXCEPTION 'PayPal plan response evidence does not match catalog state'
      USING ERRCODE = '23514';
  ELSIF target_manual_review_code = 'active_plan_drift' AND
        v_entry.status <> 'active' THEN
    RAISE EXCEPTION 'PayPal active plan drift does not match catalog state'
      USING ERRCODE = '23514';
  ELSIF target_manual_review_code <> 'active_plan_drift' AND
        v_entry.status = 'active' THEN
    RAISE EXCEPTION 'Active PayPal catalog entries may only quarantine for plan drift'
      USING ERRCODE = '23514';
  END IF;

  v_bound_product_id := v_entry.provider_product_id;
  v_bound_plan_id := v_entry.provider_plan_id;

  IF target_manual_review_code = 'product_response_recording_failed'
     AND v_bound_product_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.paypal_billing_catalog_entries other_entry
       WHERE other_entry.provider_product_id = target_observed_provider_product_id
         AND other_entry.id <> v_entry.id
     ) THEN
    v_bound_product_id := target_observed_provider_product_id;
  END IF;

  IF target_manual_review_code = 'plan_response_recording_failed'
     AND v_bound_plan_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.paypal_billing_catalog_entries other_entry
       WHERE other_entry.provider_plan_id = target_observed_provider_plan_id
         AND other_entry.id <> v_entry.id
     ) THEN
    v_bound_plan_id := target_observed_provider_plan_id;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'paypal_billing_catalog_service',
    context_tool => 'quarantine_paypal_billing_catalog_entry',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Fail closed after ambiguous PayPal provider settlement evidence',
    context_metadata => jsonb_strip_nulls(jsonb_build_object(
      'operation', 'quarantine',
      'resource_kind', 'paypal_billing_catalog_entry',
      'resource_id', v_entry.id::text,
      'provider', 'PAYPAL',
      'outcome', target_manual_review_code,
      'prior_status', v_entry.status,
      'manual_review_code', target_manual_review_code,
      'observed_provider_product_id', target_observed_provider_product_id,
      'observed_provider_plan_id', target_observed_provider_plan_id,
      'evidence_sha256', encode(target_evidence_sha256, 'hex'),
      'correlation_id', CASE
        WHEN target_manual_review_code IN (
          'product_request_ambiguous',
          'product_response_recording_failed'
        ) THEN v_entry.product_request_id
        WHEN target_manual_review_code IN (
          'plan_request_ambiguous',
          'plan_response_recording_failed'
        ) THEN v_entry.plan_request_id
        ELSE NULL
      END
    ))
  );
  PERFORM pg_catalog.set_config(
    'app.paypal_billing_catalog.lifecycle_operation',
    'quarantine',
    true
  );

  UPDATE public.paypal_billing_catalog_entries entry
  SET
    provider_product_id = v_bound_product_id,
    provider_plan_id = v_bound_plan_id,
    status = 'manual_review',
    provisioning_lease_token = NULL,
    provisioning_lease_expires_at = NULL,
    last_error_code = NULL,
    failed_at = NULL,
    manual_review_code = target_manual_review_code,
    manual_review_evidence_sha256 = target_evidence_sha256,
    manual_review_at = v_now
  WHERE entry.id = v_entry.id
  RETURNING * INTO v_entry;

  RETURN QUERY SELECT
    v_entry.id,
    v_entry.status,
    v_entry.provider_product_id,
    v_entry.provider_plan_id,
    v_entry.manual_review_code,
    v_entry.manual_review_at,
    false;
END;
$$;

REVOKE ALL ON FUNCTION private.paypal_billing_catalog_key(
  public.sponsorship_subject_kind,
  uuid,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_paypal_billing_catalog_entry()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TYPE public.paypal_billing_catalog_request_phase
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON TYPE public.paypal_billing_catalog_request_phase
  TO service_role;
REVOKE ALL ON TYPE public.paypal_billing_catalog_manual_review_code
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON TYPE public.paypal_billing_catalog_manual_review_code
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_paypal_billing_catalog_entry(
  public.sponsorship_subject_kind,
  uuid,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  text,
  interval,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_paypal_billing_catalog_entry(
  public.sponsorship_subject_kind,
  uuid,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  text,
  interval,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.start_paypal_billing_catalog_provider_request(
  uuid,
  uuid,
  public.paypal_billing_catalog_request_phase,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_paypal_billing_catalog_provider_request(
  uuid,
  uuid,
  public.paypal_billing_catalog_request_phase,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.record_paypal_billing_catalog_product(
  uuid,
  uuid,
  text,
  interval,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_paypal_billing_catalog_product(
  uuid,
  uuid,
  text,
  interval,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.activate_paypal_billing_catalog_entry(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_paypal_billing_catalog_entry(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.fail_paypal_billing_catalog_entry(
  uuid,
  uuid,
  public.paypal_billing_catalog_request_phase,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_paypal_billing_catalog_entry(
  uuid,
  uuid,
  public.paypal_billing_catalog_request_phase,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.quarantine_paypal_billing_catalog_entry(
  uuid,
  uuid,
  public.paypal_billing_catalog_manual_review_code,
  bytea,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quarantine_paypal_billing_catalog_entry(
  uuid,
  uuid,
  public.paypal_billing_catalog_manual_review_code,
  bytea,
  text,
  text,
  text,
  text
) TO service_role;

COMMENT ON TABLE public.paypal_billing_catalog_entries IS
  'Durable, contact-free PayPal product and plan catalog with lease-fenced provider request evidence, a 48 hour idempotency reuse boundary, and fail-closed manual review.';
COMMENT ON TYPE public.paypal_billing_catalog_request_phase IS
  'Closed set of PayPal catalog provider calls that require a durable pre-call marker.';
COMMENT ON TYPE public.paypal_billing_catalog_manual_review_code IS
  'Closed set of non-retryable PayPal catalog quarantine reasons.';
COMMENT ON COLUMN public.paypal_billing_catalog_entries.product_request_started_at IS
  'First durable product-call marker. Its age anchors the 48 hour request ID reuse window.';
COMMENT ON COLUMN public.paypal_billing_catalog_entries.plan_request_started_at IS
  'First durable plan-call marker. Its age anchors the 48 hour request ID reuse window.';
COMMENT ON COLUMN public.paypal_billing_catalog_entries.manual_review_evidence_sha256 IS
  'SHA256 digest of bounded provider or lifecycle evidence retained for forensic correlation.';
COMMENT ON FUNCTION public.claim_paypal_billing_catalog_entry(
  public.sponsorship_subject_kind,
  uuid,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  text,
  interval,
  text,
  text
) IS
  'Returns an active exact PayPal plan, leases a safe unresolved request, or fail-closed quarantines requests older than 48 hours.';
COMMENT ON FUNCTION public.start_paypal_billing_catalog_provider_request(
  uuid,
  uuid,
  public.paypal_billing_catalog_request_phase,
  text,
  text
) IS
  'Lease-fenced pre-call marker that reuses one provider request ID only during its first 48 hours and otherwise returns manual review without authorizing a call.';
COMMENT ON FUNCTION public.quarantine_paypal_billing_catalog_entry(
  uuid,
  uuid,
  public.paypal_billing_catalog_manual_review_code,
  bytea,
  text,
  text,
  text,
  text
) IS
  'Service-only fail-closed transition for ambiguous PayPal side effects, response recording failures, or detected active plan drift. Canonical provider IDs remain immutable.';
COMMENT ON FUNCTION public.fail_paypal_billing_catalog_entry(
  uuid,
  uuid,
  public.paypal_billing_catalog_request_phase,
  text,
  text
) IS
  'Records only a known provider rejection with no side effect and clears that phase marker before safe retry.';

COMMIT;

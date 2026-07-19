BEGIN;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_financial_entry_kind AS ENUM (
    'sponsorship_payment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.gateway_event_application_effect AS ENUM (
    'payment_succeeded',
    'payment_failed',
    'subscription_lifecycle',
    'duplicate_movement',
    'refund_required',
    'ignored'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_checkout_reservation_status AS ENUM (
    'active',
    'consumed',
    'released'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsor_email_verification_status AS ENUM (
    'issued',
    'consumed',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER FUNCTION public.reject_fulfilled_beneficiary_subscription()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.trigger_update_beneficiary_from_subscription()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_beneficiary_by_subscriptions(uuid)
  SET search_path = pg_catalog, public;

ALTER TABLE public.sponsorship_intents
  ADD CONSTRAINT sponsorship_intents_identity_chain_unique
  UNIQUE (id, sponsor_identity_id),
  ADD CONSTRAINT sponsorship_intents_beneficiary_chain_unique
  UNIQUE (id, beneficiary_id);

ALTER TABLE public.sponsorship_payment_attempts
  ADD COLUMN payment_quote_id uuid,
  ADD COLUMN checkout_receipt_digest bytea,
  ADD COLUMN checkout_receipt_expires_at timestamptz,
  ADD COLUMN provider_customer_id text,
  ADD COLUMN provider_subscription_object_type text,
  ADD COLUMN provider_subscription_object_id text,
  ADD CONSTRAINT sponsorship_payment_attempts_customer_id_check CHECK (
    provider_customer_id IS NULL
    OR (
      provider_customer_id = btrim(provider_customer_id)
      AND length(provider_customer_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT sponsorship_payment_attempts_checkout_receipt_check CHECK (
    octet_length(checkout_receipt_digest) = 32
    AND checkout_receipt_expires_at > created_at
    AND checkout_receipt_expires_at <= created_at + interval '7 days'
  ),
  ADD CONSTRAINT sponsorship_payment_attempts_subscription_object_check CHECK (
    (
      provider_subscription_object_type IS NULL
      AND provider_subscription_object_id IS NULL
    )
    OR (
      payment_mode = 'recurring'
      AND provider_customer_id IS NOT NULL
      AND provider_subscription_object_type = lower(btrim(provider_subscription_object_type))
      AND length(provider_subscription_object_type) BETWEEN 1 AND 80
      AND provider_subscription_object_id = btrim(provider_subscription_object_id)
      AND length(provider_subscription_object_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT sponsorship_payment_attempts_chain_unique
  UNIQUE (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  );

CREATE UNIQUE INDEX sponsorship_payment_attempts_checkout_receipt_uidx
  ON public.sponsorship_payment_attempts (checkout_receipt_digest);

ALTER TABLE public.payment_gateway_events
  ADD COLUMN provider_object_type text,
  ADD COLUMN verification_method text,
  ADD COLUMN processing_lease_token uuid,
  ADD COLUMN fact_payment_status text,
  ADD COLUMN fact_server_payment_attempt_id uuid,
  ADD COLUMN fact_parent_provider_object_type text,
  ADD COLUMN fact_parent_provider_object_id text,
  ADD COLUMN fact_provider_movement_type text,
  ADD COLUMN fact_provider_movement_id text,
  ADD COLUMN fact_provider_customer_id text,
  ADD COLUMN fact_provider_subscription_id text,
  ADD COLUMN fact_base_amount_usd_cents bigint,
  ADD COLUMN fact_charged_amount_minor bigint,
  ADD COLUMN fact_charged_currency public.payment_currency,
  ADD COLUMN fact_conversion_rate numeric(18, 8),
  ADD COLUMN fact_period_start timestamptz,
  ADD COLUMN fact_period_end timestamptz,
  ADD COLUMN fact_failure_code text,
  ADD COLUMN fact_lifecycle_state text,
  ADD CONSTRAINT payment_gateway_events_object_shape_check CHECK (
    (provider_object_type IS NULL AND provider_object_id IS NULL)
    OR (
      nullif(btrim(provider_object_type), '') IS NOT NULL
      AND nullif(btrim(provider_object_id), '') IS NOT NULL
      AND length(provider_object_type) <= 80
      AND length(provider_object_id) <= 255
    )
  ),
  ADD CONSTRAINT payment_gateway_events_verification_check CHECK (
    nullif(btrim(verification_method), '') IS NOT NULL
    AND length(verification_method) <= 120
  ),
  ADD CONSTRAINT payment_gateway_events_lease_token_check CHECK (
    (
      processing_status = 'processing'
      AND processing_lease_token IS NOT NULL
    )
    OR (
      processing_status <> 'processing'
      AND processing_lease_token IS NULL
    )
  ),
  ADD CONSTRAINT payment_gateway_events_attempt_presence_check CHECK (
    payment_attempt_id IS NULL OR sponsorship_intent_id IS NOT NULL
  ),
  ADD CONSTRAINT payment_gateway_events_fact_movement_shape_check CHECK (
    (
      fact_provider_movement_type IS NULL
      AND fact_provider_movement_id IS NULL
      AND fact_base_amount_usd_cents IS NULL
      AND fact_charged_amount_minor IS NULL
      AND fact_charged_currency IS NULL
      AND fact_conversion_rate IS NULL
    )
    OR (
      fact_provider_movement_type = lower(btrim(fact_provider_movement_type))
      AND length(fact_provider_movement_type) BETWEEN 1 AND 80
      AND fact_provider_movement_id = btrim(fact_provider_movement_id)
      AND length(fact_provider_movement_id) BETWEEN 1 AND 255
      AND fact_base_amount_usd_cents > 0
      AND fact_charged_amount_minor > 0
      AND fact_conversion_rate > 0
    )
  ),
  ADD CONSTRAINT payment_gateway_events_fact_customer_check CHECK (
    fact_provider_customer_id IS NULL
    OR (
      fact_provider_customer_id = btrim(fact_provider_customer_id)
      AND length(fact_provider_customer_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT payment_gateway_events_fact_parent_object_check CHECK (
    (
      fact_parent_provider_object_type IS NULL
      AND fact_parent_provider_object_id IS NULL
    )
    OR (
      fact_parent_provider_object_type = lower(btrim(fact_parent_provider_object_type))
      AND length(fact_parent_provider_object_type) BETWEEN 1 AND 80
      AND fact_parent_provider_object_id = btrim(fact_parent_provider_object_id)
      AND length(fact_parent_provider_object_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT payment_gateway_events_fact_subscription_check CHECK (
    fact_provider_subscription_id IS NULL
    OR (
      fact_provider_subscription_id = btrim(fact_provider_subscription_id)
      AND length(fact_provider_subscription_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT payment_gateway_events_fact_period_check CHECK (
    (fact_period_start IS NULL AND fact_period_end IS NULL)
    OR (
      fact_period_start IS NOT NULL
      AND fact_period_end IS NOT NULL
      AND fact_period_end > fact_period_start
    )
  ),
  ADD CONSTRAINT payment_gateway_events_fact_status_check CHECK (
    (fact_payment_status IS NULL OR length(btrim(fact_payment_status)) BETWEEN 1 AND 80)
    AND (fact_failure_code IS NULL OR length(btrim(fact_failure_code)) BETWEEN 1 AND 200)
    AND (
      fact_lifecycle_state IS NULL
      OR fact_lifecycle_state IN ('active', 'incomplete', 'cancelled')
    )
  );

UPDATE public.payment_gateway_events
SET verification_method = 'legacy_verified_event'
WHERE verification_method IS NULL;

ALTER TABLE public.payment_gateway_events
  ALTER COLUMN verification_method SET NOT NULL,
  ADD CONSTRAINT payment_gateway_events_chain_unique
  UNIQUE (
    id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  ),
  ADD CONSTRAINT payment_gateway_events_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX payment_gateway_events_lease_token_uidx
  ON public.payment_gateway_events (processing_lease_token)
  WHERE processing_lease_token IS NOT NULL;

ALTER TABLE public.sponsorship_attributions
  ADD COLUMN finalized_at timestamptz,
  ADD COLUMN conversion_occurred_at timestamptz,
  ADD CONSTRAINT sponsorship_attributions_finalization_check CHECK (
    (finalized_at IS NULL AND conversion_occurred_at IS NULL)
    OR (
      finalized_at IS NOT NULL
      AND conversion_occurred_at IS NOT NULL
    )
  );

CREATE TABLE public.sponsorship_payment_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_intent_id uuid NOT NULL
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  quote_idempotency_key text NOT NULL,
  quote_source text NOT NULL,
  rate_convention text NOT NULL
    DEFAULT 'charged_minor_units_per_usd_cent',
  payment_mode public.sponsorship_payment_mode NOT NULL,
  recurrence_interval text,
  base_amount_usd_cents bigint NOT NULL,
  charged_currency public.payment_currency NOT NULL,
  conversion_rate numeric(18, 8) NOT NULL,
  charged_amount_minor bigint NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_payment_quotes_scope_check CHECK (
    provider_account_scope = lower(btrim(provider_account_scope))
    AND length(provider_account_scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT sponsorship_payment_quotes_idempotency_check CHECK (
    quote_idempotency_key = btrim(quote_idempotency_key)
    AND length(quote_idempotency_key) BETWEEN 16 AND 255
  ),
  CONSTRAINT sponsorship_payment_quotes_source_check CHECK (
    nullif(btrim(quote_source), '') IS NOT NULL
    AND length(quote_source) <= 160
  ),
  CONSTRAINT sponsorship_payment_quotes_rate_convention_check CHECK (
    rate_convention = 'charged_minor_units_per_usd_cent'
  ),
  CONSTRAINT sponsorship_payment_quotes_recurrence_check CHECK (
    (payment_mode = 'one_time' AND recurrence_interval IS NULL)
    OR (payment_mode = 'recurring' AND recurrence_interval IN ('month', 'year'))
  ),
  CONSTRAINT sponsorship_payment_quotes_amount_check CHECK (
    base_amount_usd_cents BETWEEN 1 AND 2147483647
    AND charged_amount_minor BETWEEN 1 AND 2147483647
    AND conversion_rate > 0
    AND charged_amount_minor = round(base_amount_usd_cents * conversion_rate)
  ),
  CONSTRAINT sponsorship_payment_quotes_usd_check CHECK (
    charged_currency <> 'USD'
    OR (
      conversion_rate = 1
      AND charged_amount_minor = base_amount_usd_cents
    )
  ),
  CONSTRAINT sponsorship_payment_quotes_expiry_check CHECK (
    expires_at > issued_at
    AND expires_at <= issued_at + interval '30 minutes'
  ),
  CONSTRAINT sponsorship_payment_quotes_provider_account_fkey
    FOREIGN KEY (provider, provider_account_scope)
    REFERENCES public.payment_provider_accounts(provider, scope)
    ON DELETE RESTRICT,
  CONSTRAINT sponsorship_payment_quotes_provider_key_unique
    UNIQUE (provider, provider_account_scope, quote_idempotency_key),
  CONSTRAINT sponsorship_payment_quotes_chain_unique
    UNIQUE (id, sponsorship_intent_id, provider, provider_account_scope)
);

CREATE INDEX sponsorship_payment_quotes_intent_time_idx
  ON public.sponsorship_payment_quotes (
    sponsorship_intent_id,
    issued_at DESC,
    id DESC
  );

ALTER TABLE public.sponsorship_payment_attempts
  ALTER COLUMN payment_quote_id SET NOT NULL,
  ALTER COLUMN checkout_receipt_digest SET NOT NULL,
  ALTER COLUMN checkout_receipt_expires_at SET NOT NULL,
  ADD CONSTRAINT sponsorship_payment_attempts_quote_chain_fkey
  FOREIGN KEY (
    payment_quote_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_quotes (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT;

CREATE TABLE public.sponsorship_checkout_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id uuid NOT NULL
    REFERENCES public.beneficiaries(id) ON DELETE RESTRICT,
  sponsorship_intent_id uuid NOT NULL UNIQUE
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  payment_attempt_id uuid NOT NULL UNIQUE,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  status public.sponsorship_checkout_reservation_status NOT NULL DEFAULT 'active',
  lease_expires_at timestamptz NOT NULL,
  provider_object_expires_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  provider_reconciled_at timestamptz,
  release_reason text,
  reconciliation_evidence_sha256 bytea,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_checkout_reservations_scope_check CHECK (
    provider_account_scope = lower(btrim(provider_account_scope))
    AND length(provider_account_scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT sponsorship_checkout_reservations_expiry_check CHECK (
    lease_expires_at > created_at
    AND (
      provider_object_expires_at IS NULL
      OR provider_object_expires_at >= created_at
    )
  ),
  CONSTRAINT sponsorship_checkout_reservations_status_check CHECK (
    (
      status = 'active'
      AND consumed_at IS NULL
      AND released_at IS NULL
      AND provider_reconciled_at IS NULL
      AND release_reason IS NULL
      AND reconciliation_evidence_sha256 IS NULL
    )
    OR (
      status = 'consumed'
      AND consumed_at IS NOT NULL
      AND released_at IS NULL
      AND provider_reconciled_at IS NULL
      AND release_reason IS NULL
      AND reconciliation_evidence_sha256 IS NULL
    )
    OR (
      status = 'released'
      AND consumed_at IS NULL
      AND released_at IS NOT NULL
      AND provider_reconciled_at IS NOT NULL
      AND nullif(btrim(release_reason), '') IS NOT NULL
      AND octet_length(reconciliation_evidence_sha256) = 32
    )
  ),
  CONSTRAINT sponsorship_checkout_reservations_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT
);

CREATE UNIQUE INDEX sponsorship_checkout_reservations_fixed_active_uidx
  ON public.sponsorship_checkout_reservations (beneficiary_id)
  WHERE status IN ('active', 'consumed');

CREATE INDEX sponsorship_checkout_reservations_reconciliation_idx
  ON public.sponsorship_checkout_reservations (lease_expires_at, created_at)
  WHERE status = 'active';

CREATE TABLE public.payment_provider_object_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL,
  sponsorship_intent_id uuid NOT NULL,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  provider_object_type text NOT NULL,
  provider_object_id text NOT NULL,
  relationship text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payment_provider_object_links_scope_check CHECK (
    provider_account_scope = lower(btrim(provider_account_scope))
    AND length(provider_account_scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT payment_provider_object_links_type_check CHECK (
    provider_object_type = lower(btrim(provider_object_type))
    AND length(provider_object_type) BETWEEN 1 AND 80
  ),
  CONSTRAINT payment_provider_object_links_id_check CHECK (
    provider_object_id = btrim(provider_object_id)
    AND length(provider_object_id) BETWEEN 1 AND 255
  ),
  CONSTRAINT payment_provider_object_links_relationship_check CHECK (
    relationship IN ('checkout', 'event_subject', 'movement', 'subscription')
  ),
  CONSTRAINT payment_provider_object_links_expiry_check CHECK (
    expires_at IS NULL OR expires_at > created_at
  ),
  CONSTRAINT payment_provider_object_links_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  CONSTRAINT payment_provider_object_links_provider_object_unique
  UNIQUE (
    provider,
    provider_account_scope,
    provider_object_type,
    provider_object_id
  )
);

CREATE INDEX payment_provider_object_links_attempt_idx
  ON public.payment_provider_object_links (
    payment_attempt_id,
    relationship,
    created_at
  );

CREATE TABLE public.sponsorship_financial_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_gateway_event_id uuid NOT NULL UNIQUE,
  payment_attempt_id uuid NOT NULL,
  sponsorship_intent_id uuid NOT NULL,
  sponsor_identity_id uuid NOT NULL,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  provider_movement_type text NOT NULL,
  provider_movement_id text NOT NULL,
  entry_kind public.sponsorship_financial_entry_kind NOT NULL,
  payment_mode public.sponsorship_payment_mode NOT NULL,
  base_amount_usd_cents bigint NOT NULL,
  charged_amount_minor bigint NOT NULL,
  charged_currency public.payment_currency NOT NULL,
  conversion_rate numeric(18, 8) NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_financial_movements_scope_check CHECK (
    provider_account_scope = lower(btrim(provider_account_scope))
    AND length(provider_account_scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT sponsorship_financial_movements_type_check CHECK (
    provider_movement_type = lower(btrim(provider_movement_type))
    AND length(provider_movement_type) BETWEEN 1 AND 80
  ),
  CONSTRAINT sponsorship_financial_movements_id_check CHECK (
    provider_movement_id = btrim(provider_movement_id)
    AND length(provider_movement_id) BETWEEN 1 AND 255
  ),
  CONSTRAINT sponsorship_financial_movements_amount_check CHECK (
    base_amount_usd_cents > 0
    AND charged_amount_minor > 0
    AND conversion_rate > 0
  ),
  CONSTRAINT sponsorship_financial_movements_time_check CHECK (
    occurred_at <= recorded_at + interval '5 minutes'
  ),
  CONSTRAINT sponsorship_financial_movements_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_financial_movements_event_chain_fkey
  FOREIGN KEY (
    source_gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.payment_gateway_events (
    id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_financial_movements_identity_chain_fkey
  FOREIGN KEY (sponsorship_intent_id, sponsor_identity_id)
  REFERENCES public.sponsorship_intents (id, sponsor_identity_id)
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_financial_movements_attribution_fkey
  FOREIGN KEY (sponsorship_intent_id)
  REFERENCES public.sponsorship_attributions (sponsorship_intent_id)
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_financial_movements_provider_identity_unique
  UNIQUE (
    provider,
    provider_account_scope,
    provider_movement_type,
    provider_movement_id,
    entry_kind
  ),
  CONSTRAINT sponsorship_financial_movements_refund_chain_unique
  UNIQUE (
    id,
    source_gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
);

CREATE INDEX sponsorship_financial_movements_intent_time_idx
  ON public.sponsorship_financial_movements (
    sponsorship_intent_id,
    occurred_at
  );

CREATE UNIQUE INDEX sponsorship_financial_movements_one_time_attempt_uidx
  ON public.sponsorship_financial_movements (payment_attempt_id, entry_kind)
  WHERE payment_mode = 'one_time';

CREATE TABLE public.sponsorship_refund_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_movement_id uuid NOT NULL UNIQUE
    REFERENCES public.sponsorship_financial_movements(id) ON DELETE RESTRICT,
  source_gateway_event_id uuid NOT NULL UNIQUE
    REFERENCES public.payment_gateway_events(id) ON DELETE RESTRICT,
  payment_attempt_id uuid NOT NULL,
  sponsorship_intent_id uuid NOT NULL,
  beneficiary_id uuid NOT NULL
    REFERENCES public.beneficiaries(id) ON DELETE RESTRICT,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  operational_alert jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_refund_requirements_reason_check CHECK (
    length(btrim(reason)) BETWEEN 1 AND 500
  ),
  CONSTRAINT sponsorship_refund_requirements_status_check CHECK (
    status = 'pending'
  ),
  CONSTRAINT sponsorship_refund_requirements_alert_check CHECK (
    jsonb_typeof(operational_alert) = 'object'
    AND pg_column_size(operational_alert) <= 4096
  ),
  CONSTRAINT sponsorship_refund_requirements_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_refund_requirements_movement_chain_fkey
  FOREIGN KEY (
    financial_movement_id,
    source_gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_financial_movements (
    id,
    source_gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_refund_requirements_beneficiary_chain_fkey
  FOREIGN KEY (sponsorship_intent_id, beneficiary_id)
  REFERENCES public.sponsorship_intents (id, beneficiary_id)
  ON DELETE RESTRICT
);

CREATE INDEX sponsorship_refund_requirements_pending_idx
  ON public.sponsorship_refund_requirements (created_at, id)
  WHERE status = 'pending';

CREATE TABLE public.payment_gateway_event_applications (
  gateway_event_id uuid PRIMARY KEY
    REFERENCES public.payment_gateway_events(id) ON DELETE RESTRICT,
  effect public.gateway_event_application_effect NOT NULL,
  financial_movement_id uuid
    REFERENCES public.sponsorship_financial_movements(id) ON DELETE RESTRICT,
  subscription_id uuid
    REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payment_gateway_event_applications_summary_check CHECK (
    jsonb_typeof(summary) = 'object'
    AND pg_column_size(summary) <= 4096
  ),
  CONSTRAINT payment_gateway_event_applications_effect_check CHECK (
    (
      effect = 'payment_succeeded'
      AND financial_movement_id IS NOT NULL
    )
    OR (
      effect = 'duplicate_movement'
      AND financial_movement_id IS NOT NULL
    )
    OR (
      effect = 'refund_required'
      AND financial_movement_id IS NOT NULL
      AND subscription_id IS NULL
    )
    OR effect IN ('payment_failed', 'subscription_lifecycle', 'ignored')
  )
);

CREATE TABLE public.sponsor_account_email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  issuer_scope text NOT NULL DEFAULT 'creator_share',
  email_hmac bytea NOT NULL,
  normalization_version smallint NOT NULL DEFAULT 1,
  hmac_key_version smallint NOT NULL DEFAULT 1,
  status public.sponsor_email_verification_status NOT NULL DEFAULT 'issued',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsor_account_email_verifications_scope_check CHECK (
    issuer_scope = 'creator_share'
  ),
  CONSTRAINT sponsor_account_email_verifications_digest_check CHECK (
    octet_length(email_hmac) = 32
    AND normalization_version = 1
    AND hmac_key_version = 1
  ),
  CONSTRAINT sponsor_account_email_verifications_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '15 minutes'
  ),
  CONSTRAINT sponsor_account_email_verifications_status_check CHECK (
    (status = 'issued' AND consumed_at IS NULL)
    OR (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status = 'expired' AND consumed_at IS NULL)
  )
);

CREATE UNIQUE INDEX sponsor_account_email_verifications_issued_uidx
  ON public.sponsor_account_email_verifications (auth_user_id)
  WHERE status = 'issued';

CREATE INDEX sponsor_account_email_verifications_expiry_idx
  ON public.sponsor_account_email_verifications (expires_at)
  WHERE status = 'issued';

ALTER TABLE public.subscriptions
  ADD COLUMN provider_account_scope text,
  ADD COLUMN provider_subscription_object_type text,
  ADD COLUMN provider_subscription_object_id text,
  ADD COLUMN subject_kind public.sponsorship_subject_kind,
  ADD COLUMN partnership_project public.project_type,
  ADD COLUMN initial_gateway_event_id uuid,
  ADD COLUMN payment_health text,
  ADD COLUMN last_provider_payment_event_occurred_at timestamptz,
  ADD COLUMN last_provider_payment_event_precedence smallint,
  ADD COLUMN last_provider_payment_event_id text,
  ADD COLUMN last_provider_lifecycle_event_occurred_at timestamptz,
  ADD COLUMN last_provider_lifecycle_event_precedence smallint,
  ADD COLUMN last_provider_lifecycle_event_id text,
  ADD CONSTRAINT subscriptions_provider_scope_check CHECK (
    provider_account_scope IS NULL
    OR (
      provider_account_scope = lower(btrim(provider_account_scope))
      AND length(provider_account_scope) BETWEEN 1 AND 120
    )
  ),
  ADD CONSTRAINT subscriptions_provider_object_check CHECK (
    (
      provider_subscription_object_type IS NULL
      AND provider_subscription_object_id IS NULL
    )
    OR (
      provider_subscription_object_type = lower(btrim(provider_subscription_object_type))
      AND length(provider_subscription_object_type) BETWEEN 1 AND 80
      AND provider_subscription_object_id = btrim(provider_subscription_object_id)
      AND length(provider_subscription_object_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT subscriptions_payment_health_check CHECK (
    payment_health IS NULL OR payment_health IN ('paid', 'delinquent')
  ),
  ADD CONSTRAINT subscriptions_last_provider_payment_event_check CHECK (
    (
      last_provider_payment_event_occurred_at IS NULL
      AND last_provider_payment_event_precedence IS NULL
      AND last_provider_payment_event_id IS NULL
    )
    OR (
      payment_health IS NOT NULL
      AND last_provider_payment_event_occurred_at IS NOT NULL
      AND last_provider_payment_event_precedence IN (100, 200)
      AND last_provider_payment_event_id = btrim(last_provider_payment_event_id)
      AND length(last_provider_payment_event_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT subscriptions_last_provider_lifecycle_event_check CHECK (
    (
      last_provider_lifecycle_event_occurred_at IS NULL
      AND last_provider_lifecycle_event_precedence IS NULL
      AND last_provider_lifecycle_event_id IS NULL
    )
    OR (
      last_provider_lifecycle_event_occurred_at IS NOT NULL
      AND last_provider_lifecycle_event_precedence IN (100, 200, 300)
      AND last_provider_lifecycle_event_id = btrim(last_provider_lifecycle_event_id)
      AND length(last_provider_lifecycle_event_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT subscriptions_subject_shape_check CHECK (
    subject_kind IS NULL
    OR (
      subject_kind = 'standard'
      AND beneficiary_id IS NOT NULL
      AND partnership_project IS NULL
    )
    OR (
      subject_kind = 'blind'
      AND beneficiary_id IS NULL
      AND partnership_project IS NULL
    )
    OR (
      subject_kind = 'partnership'
      AND beneficiary_id IS NULL
      AND partnership_project IS NOT NULL
    )
  ),
  ADD CONSTRAINT subscriptions_payment_chain_shape_check CHECK (
    sponsorship_intent_id IS NULL
    OR (
      sponsor_identity_id IS NOT NULL
      AND payment_attempt_id IS NOT NULL
      AND sponsorship_method IS NOT NULL
      AND provider_account_scope IS NOT NULL
      AND provider_subscription_object_type IS NOT NULL
      AND provider_subscription_object_id IS NOT NULL
      AND subject_kind IS NOT NULL
      AND initial_gateway_event_id IS NOT NULL
      AND payment_health IS NOT NULL
      AND last_provider_payment_event_occurred_at IS NOT NULL
      AND last_provider_payment_event_precedence IS NOT NULL
      AND nullif(btrim(last_provider_payment_event_id), '') IS NOT NULL
      AND amount IS NOT NULL
      AND amount > 0
      AND charged_amount IS NOT NULL
      AND charged_amount > 0
      AND conversion_rate > 0
      AND status IS NOT NULL
    )
  ),
  ADD CONSTRAINT subscriptions_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    sponsorship_method,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  ADD CONSTRAINT subscriptions_identity_chain_fkey
  FOREIGN KEY (sponsorship_intent_id, sponsor_identity_id)
  REFERENCES public.sponsorship_intents (id, sponsor_identity_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT subscriptions_initial_event_chain_fkey
  FOREIGN KEY (
    initial_gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    sponsorship_method,
    provider_account_scope
  )
  REFERENCES public.payment_gateway_events (
    id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX subscriptions_provider_subscription_uidx
  ON public.subscriptions (
    sponsorship_method,
    provider_account_scope,
    provider_subscription_object_type,
    provider_subscription_object_id
  )
  WHERE provider_subscription_object_id IS NOT NULL;

ALTER TABLE public.transaction_ledger
  ADD COLUMN payment_provider public.sponsorship_method,
  ADD COLUMN provider_account_scope text,
  ADD COLUMN provider_movement_type text,
  ADD COLUMN provider_movement_id text,
  ADD COLUMN financial_entry_kind public.sponsorship_financial_entry_kind,
  ADD COLUMN financial_movement_id uuid,
  ADD COLUMN base_amount_usd_cents bigint,
  ADD COLUMN provider_occurred_at timestamptz,
  ADD CONSTRAINT transaction_ledger_provider_scope_check CHECK (
    provider_account_scope IS NULL
    OR (
      provider_account_scope = lower(btrim(provider_account_scope))
      AND length(provider_account_scope) BETWEEN 1 AND 120
    )
  ),
  ADD CONSTRAINT transaction_ledger_movement_shape_check CHECK (
    (
      provider_movement_type IS NULL
      AND provider_movement_id IS NULL
      AND financial_entry_kind IS NULL
      AND financial_movement_id IS NULL
      AND base_amount_usd_cents IS NULL
      AND provider_occurred_at IS NULL
    )
    OR (
      provider_movement_type = lower(btrim(provider_movement_type))
      AND length(provider_movement_type) BETWEEN 1 AND 80
      AND provider_movement_id = btrim(provider_movement_id)
      AND length(provider_movement_id) BETWEEN 1 AND 255
      AND financial_entry_kind IS NOT NULL
      AND financial_movement_id IS NOT NULL
      AND base_amount_usd_cents > 0
      AND provider_occurred_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT transaction_ledger_payment_chain_shape_check CHECK (
    sponsorship_intent_id IS NULL
    OR (
      sponsor_identity_id IS NOT NULL
      AND payment_attempt_id IS NOT NULL
      AND gateway_event_id IS NOT NULL
      AND payment_provider IS NOT NULL
      AND provider_account_scope IS NOT NULL
      AND financial_movement_id IS NOT NULL
      AND base_amount_usd_cents IS NOT NULL
    )
  ),
  ADD CONSTRAINT transaction_ledger_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    payment_provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  ADD CONSTRAINT transaction_ledger_event_chain_fkey
  FOREIGN KEY (
    gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    payment_provider,
    provider_account_scope
  )
  REFERENCES public.payment_gateway_events (
    id,
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  ADD CONSTRAINT transaction_ledger_identity_chain_fkey
  FOREIGN KEY (sponsorship_intent_id, sponsor_identity_id)
  REFERENCES public.sponsorship_intents (id, sponsor_identity_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT transaction_ledger_financial_movement_fkey
  FOREIGN KEY (financial_movement_id)
  REFERENCES public.sponsorship_financial_movements(id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX transaction_ledger_financial_movement_uidx
  ON public.transaction_ledger (financial_movement_id)
  WHERE financial_movement_id IS NOT NULL;

CREATE UNIQUE INDEX transaction_ledger_provider_movement_uidx
  ON public.transaction_ledger (
    payment_provider,
    provider_account_scope,
    provider_movement_type,
    provider_movement_id,
    financial_entry_kind
  )
  WHERE provider_movement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.require_payment_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Payment transaction RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Payment transaction RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.set_payment_audit_context(
  context_tool text,
  context_provider public.sponsorship_method,
  context_provider_scope text,
  context_event_type text DEFAULT NULL,
  context_provider_event_id text DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'sponsorship_payment_service',
    context_tool => context_tool,
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_provider_event_id => context_provider_event_id,
    context_client_ip => context_client_ip,
    context_user_agent => context_user_agent,
    context_metadata => jsonb_strip_nulls(jsonb_build_object(
      'provider', context_provider::text,
      'provider_account_scope', context_provider_scope,
      'event_type', context_event_type
    ))
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_provider_event_type(
  target_provider public.sponsorship_method,
  target_event_type text,
  target_provider_object_type text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_provider = 'STRIPE' AND NOT (
    (target_event_type IN (
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed'
    ) AND target_provider_object_type = 'checkout_session')
    OR
    (target_event_type IN (
      'invoice.paid',
      'invoice.payment_succeeded',
      'invoice.payment_failed'
    ) AND target_provider_object_type = 'invoice')
    OR
    (target_event_type IN (
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ) AND target_provider_object_type = 'subscription')
  ) THEN
    RAISE EXCEPTION 'Unsupported Stripe event and object type combination'
      USING ERRCODE = '22023';
  ELSIF target_provider = 'PAYPAL' AND NOT (
    (target_event_type IN (
      'PAYMENT.CAPTURE.COMPLETED',
      'PAYMENT.CAPTURE.DENIED',
      'PAYMENT.CAPTURE.REFUNDED',
      'PAYMENT.CAPTURE.REVERSED'
    ) AND target_provider_object_type = 'capture')
    OR
    (target_event_type IN (
      'PAYMENT.SALE.COMPLETED',
      'PAYMENT.SALE.DENIED',
      'PAYMENT.SALE.REFUNDED',
      'PAYMENT.SALE.REVERSED'
    ) AND target_provider_object_type = 'sale')
    OR
    (target_event_type IN (
      'BILLING.SUBSCRIPTION.ACTIVATED',
      'BILLING.SUBSCRIPTION.CANCELLED',
      'BILLING.SUBSCRIPTION.SUSPENDED',
      'BILLING.SUBSCRIPTION.EXPIRED',
      'BILLING.SUBSCRIPTION.UPDATED'
    ) AND target_provider_object_type = 'billing_subscription')
  ) THEN
    RAISE EXCEPTION 'Unsupported PayPal event and object type combination'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_sponsorship_checkout_eligibility(
  target_sponsorship_intent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_beneficiary public.beneficiaries%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
BEGIN
  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsorship intent does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_intent.base_amount_usd_cents < 500
     OR v_intent.base_amount_usd_cents > 2147483647
     OR v_intent.charged_amount_minor < 1
     OR v_intent.charged_amount_minor > 2147483647
     OR v_intent.charged_amount_minor IS DISTINCT FROM
       round(v_intent.base_amount_usd_cents * v_intent.conversion_rate) THEN
    RAISE EXCEPTION 'Sponsorship amount is outside product bounds or fails currency conversion'
      USING ERRCODE = '23514';
  END IF;

  IF (v_intent.payment_mode = 'one_time' AND v_intent.recurrence_interval IS NOT NULL)
     OR (v_intent.payment_mode = 'recurring'
       AND v_intent.recurrence_interval NOT IN ('month', 'year')) THEN
    RAISE EXCEPTION 'Sponsorship recurrence does not match the product rules'
      USING ERRCODE = '23514';
  END IF;

  IF v_intent.subject_kind = 'standard' THEN
    SELECT beneficiary.*
    INTO v_beneficiary
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id = v_intent.beneficiary_id
    FOR SHARE;

    IF NOT FOUND
       OR v_beneficiary.status IN ('Draft', 'Archived')
       OR (
         v_beneficiary.budget_goal <> -1
         AND v_beneficiary.status NOT IN ('New', 'Partially Funded')
       ) THEN
      RAISE EXCEPTION 'Beneficiary is not canonically eligible for sponsorship'
        USING ERRCODE = '23514';
    END IF;

    IF v_beneficiary.budget_goal <> -1
       AND v_intent.base_amount_usd_cents IS DISTINCT FROM v_beneficiary.budget_goal::bigint THEN
      RAISE EXCEPTION 'Fixed sponsorship amount must equal the beneficiary budget goal'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_intent.source = 'advocate_domain' THEN
    SELECT advocate.*
    INTO v_advocate
    FROM public.advocates advocate
    WHERE advocate.id = v_intent.source_advocate_id
    FOR SHARE;

    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.id = v_intent.source_advocate_domain_id
      AND domain.advocate_id = v_intent.source_advocate_id
    FOR SHARE;

    IF v_advocate.id IS NULL
       OR v_domain.id IS NULL
       OR v_advocate.relationship_status <> 'active'
       OR v_advocate.publication_status <> 'active'
       OR v_domain.status <> 'active'
       OR v_domain.hostname <> v_intent.source_host THEN
      RAISE EXCEPTION 'Advocate portal is not eligible to begin checkout'
        USING ERRCODE = '23514';
    END IF;

    IF v_intent.subject_kind = 'standard'
       AND v_advocate.beneficiary_mode = 'selected'
       AND NOT EXISTS (
         SELECT 1
         FROM public.advocate_beneficiaries selection
         WHERE selection.advocate_id = v_advocate.id
           AND selection.beneficiary_id = v_intent.beneficiary_id
       ) THEN
      RAISE EXCEPTION 'Beneficiary is not selected for this advocate portal'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_payment_provider_readiness(
  target_sponsorship_intent_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_account public.payment_provider_accounts%ROWTYPE;
BEGIN
  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR SHARE;

  SELECT account.*
  INTO v_account
  FROM public.payment_provider_accounts account
  WHERE account.provider = target_provider
    AND account.scope = target_provider_account_scope
  FOR SHARE;

  IF v_intent.id IS NULL
     OR v_account.provider IS NULL
     OR v_account.status <> 'active'
     OR v_account.environment <> 'live' THEN
    RAISE EXCEPTION 'Payment provider account is not live and active'
      USING ERRCODE = '55000';
  END IF;

  IF v_intent.source = 'advocate_domain' AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    JOIN public.advocate_domain_integrations integration
      ON integration.domain_id = domain.id
     AND integration.advocate_id = domain.advocate_id
    WHERE domain.id = v_intent.source_advocate_domain_id
      AND domain.advocate_id = v_intent.source_advocate_id
      AND domain.status = 'active'
      AND domain.payments_ready_at IS NOT NULL
      AND integration.provider::text = v_account.scope
      AND integration.environment = v_account.environment
      AND integration.is_required
      AND integration.status = 'ready'
      AND integration.ready_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Advocate domain payment readiness does not match the live provider account scope'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.finalize_sponsorship_attribution(
  target_sponsorship_intent_id uuid,
  target_conversion_occurred_at timestamptz
)
RETURNS public.sponsorship_attributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_attribution public.sponsorship_attributions%ROWTYPE;
  v_policy public.sponsorship_attribution_policies%ROWTYPE;
  v_exposure public.advocate_exposures%ROWTYPE;
  v_kind public.sponsorship_attribution_kind;
  v_lag interval;
BEGIN
  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR SHARE;

  SELECT attribution.*
  INTO v_attribution
  FROM public.sponsorship_attributions attribution
  WHERE attribution.sponsorship_intent_id = target_sponsorship_intent_id
  FOR UPDATE;

  IF v_intent.id IS NULL OR v_attribution.sponsorship_intent_id IS NULL THEN
    RAISE EXCEPTION 'Attribution cannot finalize without its intent and provisional row'
      USING ERRCODE = '23514';
  END IF;

  IF v_attribution.finalized_at IS NOT NULL THEN
    RETURN v_attribution;
  END IF;

  IF target_conversion_occurred_at < v_intent.created_at THEN
    RAISE EXCEPTION 'Verified conversion cannot precede its server owned intent'
      USING ERRCODE = '23514';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM public.sponsorship_attribution_policies policy
  WHERE policy.version = v_intent.attribution_policy_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attribution policy is unavailable for conversion finalization'
      USING ERRCODE = '23503';
  END IF;

  IF v_intent.source = 'advocate_domain' THEN
    v_kind := 'direct';
    v_attribution.advocate_id := v_intent.source_advocate_id;
    v_attribution.exposure_id := NULL;
    v_lag := NULL;
  ELSE
    SELECT exposure.*
    INTO v_exposure
    FROM public.advocate_exposures exposure
    WHERE exposure.is_qualified
      AND exposure.occurred_at <= target_conversion_occurred_at
      AND exposure.recorded_at <= target_conversion_occurred_at
      AND exposure.occurred_at >= target_conversion_occurred_at
        - make_interval(days => v_policy.observed_window_days)
      AND NOT (
        v_intent.auth_user_id IS NOT NULL
        AND exposure.auth_user_id IS NOT NULL
        AND exposure.auth_user_id <> v_intent.auth_user_id
      )
      AND (
        (
          v_intent.browser_visitor_id IS NOT NULL
          AND exposure.browser_visitor_id = v_intent.browser_visitor_id
          AND EXISTS (
            SELECT 1
            FROM public.browser_visitors visitor
            WHERE visitor.id = v_intent.browser_visitor_id
              AND visitor.consent_state IN ('granted', 'not_required')
              AND visitor.revoked_at IS NULL
              AND visitor.retention_expires_at > target_conversion_occurred_at
          )
        )
        OR (
          v_intent.auth_user_id IS NOT NULL
          AND exposure.auth_user_id = v_intent.auth_user_id
        )
      )
    ORDER BY exposure.occurred_at DESC, exposure.recorded_at DESC, exposure.id DESC
    LIMIT 1;

    IF v_exposure.id IS NULL THEN
      v_kind := 'unattributed';
      v_attribution.advocate_id := NULL;
      v_attribution.exposure_id := NULL;
      v_lag := NULL;
    ELSE
      v_lag := target_conversion_occurred_at - v_exposure.occurred_at;
      v_kind := CASE
        WHEN v_lag <= make_interval(days => v_policy.official_window_days)
          THEN 'post_visit_attributed'::public.sponsorship_attribution_kind
        ELSE 'post_visit_observed'::public.sponsorship_attribution_kind
      END;
      v_attribution.advocate_id := v_exposure.advocate_id;
      v_attribution.exposure_id := v_exposure.id;
    END IF;
  END IF;

  UPDATE public.sponsorship_attributions
  SET
    kind = v_kind,
    advocate_id = v_attribution.advocate_id,
    exposure_id = v_attribution.exposure_id,
    exposure_lag = v_lag,
    decision_context = jsonb_build_object(
      'decision_stage', 'first_verified_success',
      'conversion_occurred_at', target_conversion_occurred_at,
      'provisional_kind', v_attribution.kind::text,
      'provisional_decided_at', v_attribution.decided_at
    ),
    decided_at = clock_timestamp(),
    finalized_at = clock_timestamp(),
    conversion_occurred_at = target_conversion_occurred_at
  WHERE sponsorship_intent_id = target_sponsorship_intent_id
  RETURNING * INTO v_attribution;

  RETURN v_attribution;
END;
$$;

CREATE OR REPLACE FUNCTION private.prevent_sponsorship_attribution_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.finalized_at IS NULL
     AND OLD.conversion_occurred_at IS NULL
     AND NEW.finalized_at IS NOT NULL
     AND NEW.conversion_occurred_at IS NOT NULL
     AND NEW.sponsorship_intent_id IS NOT DISTINCT FROM OLD.sponsorship_intent_id
     AND NEW.policy_version IS NOT DISTINCT FROM OLD.policy_version THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Final sponsorship attribution decisions are immutable'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION private.link_payment_provider_object(
  target_attempt_id uuid,
  target_intent_id uuid,
  target_provider public.sponsorship_method,
  target_provider_scope text,
  target_object_type text,
  target_object_id text,
  target_relationship text,
  target_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link public.payment_provider_object_links%ROWTYPE;
BEGIN
  IF target_provider = 'STRIPE'
     AND target_object_type NOT IN (
       'checkout_session',
       'payment_intent',
       'invoice',
       'subscription',
       'charge',
       'refund',
       'dispute'
     ) THEN
    RAISE EXCEPTION 'Unsupported Stripe provider object type'
      USING ERRCODE = '22023';
  ELSIF target_provider = 'PAYPAL'
     AND target_object_type NOT IN (
       'order',
       'capture',
       'billing_subscription',
       'sale',
       'refund',
       'dispute'
     ) THEN
    RAISE EXCEPTION 'Unsupported PayPal provider object type'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_provider_object_links (
    payment_attempt_id,
    sponsorship_intent_id,
    provider,
    provider_account_scope,
    provider_object_type,
    provider_object_id,
    relationship,
    expires_at
  )
  VALUES (
    target_attempt_id,
    target_intent_id,
    target_provider,
    target_provider_scope,
    target_object_type,
    target_object_id,
    target_relationship,
    target_expires_at
  )
  ON CONFLICT (
    provider,
    provider_account_scope,
    provider_object_type,
    provider_object_id
  ) DO NOTHING
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    SELECT link.*
    INTO v_link
    FROM public.payment_provider_object_links link
    WHERE link.provider = target_provider
      AND link.provider_account_scope = target_provider_scope
      AND link.provider_object_type = target_object_type
      AND link.provider_object_id = target_object_id
    FOR SHARE;

    IF v_link.payment_attempt_id IS DISTINCT FROM target_attempt_id
       OR v_link.sponsorship_intent_id IS DISTINCT FROM target_intent_id THEN
      RAISE EXCEPTION 'Provider object is already linked to another payment chain'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN v_link.id;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_payment_transaction_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payment transaction evidence is append only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_gateway_event_extensions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.processing_lease_token IS NOT NULL THEN
      RAISE EXCEPTION 'Gateway events cannot begin with a processing lease token'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.provider_object_type IS DISTINCT FROM OLD.provider_object_type
     OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
     OR NEW.fact_payment_status IS DISTINCT FROM OLD.fact_payment_status
     OR NEW.fact_server_payment_attempt_id IS DISTINCT FROM OLD.fact_server_payment_attempt_id
     OR NEW.fact_parent_provider_object_type IS DISTINCT FROM OLD.fact_parent_provider_object_type
     OR NEW.fact_parent_provider_object_id IS DISTINCT FROM OLD.fact_parent_provider_object_id
     OR NEW.fact_provider_movement_type IS DISTINCT FROM OLD.fact_provider_movement_type
     OR NEW.fact_provider_movement_id IS DISTINCT FROM OLD.fact_provider_movement_id
     OR NEW.fact_provider_customer_id IS DISTINCT FROM OLD.fact_provider_customer_id
     OR NEW.fact_provider_subscription_id IS DISTINCT FROM OLD.fact_provider_subscription_id
     OR NEW.fact_base_amount_usd_cents IS DISTINCT FROM OLD.fact_base_amount_usd_cents
     OR NEW.fact_charged_amount_minor IS DISTINCT FROM OLD.fact_charged_amount_minor
     OR NEW.fact_charged_currency IS DISTINCT FROM OLD.fact_charged_currency
     OR NEW.fact_conversion_rate IS DISTINCT FROM OLD.fact_conversion_rate
     OR NEW.fact_period_start IS DISTINCT FROM OLD.fact_period_start
     OR NEW.fact_period_end IS DISTINCT FROM OLD.fact_period_end
     OR NEW.fact_failure_code IS DISTINCT FROM OLD.fact_failure_code
     OR NEW.fact_lifecycle_state IS DISTINCT FROM OLD.fact_lifecycle_state THEN
    RAISE EXCEPTION 'Gateway event verification evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.processing_status = 'processing'
     AND NEW.processing_lease_token IS NULL THEN
    RAISE EXCEPTION 'Processing gateway events require a lease token'
      USING ERRCODE = '23514';
  ELSIF NEW.processing_status <> 'processing'
     AND NEW.processing_lease_token IS NOT NULL THEN
    RAISE EXCEPTION 'Terminal gateway events cannot retain a lease token'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_payment_attempt_provider_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_quote_id IS NULL THEN
      RAISE EXCEPTION 'Payment attempts require an immutable server payment quote'
        USING ERRCODE = '23514';
    END IF;

    IF octet_length(NEW.checkout_receipt_digest) IS DISTINCT FROM 32
       OR NEW.checkout_receipt_expires_at IS NULL THEN
      RAISE EXCEPTION 'Payment attempts require a bounded opaque checkout receipt'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.provider_customer_id IS NOT NULL
       OR NEW.provider_subscription_object_type IS NOT NULL
       OR NEW.provider_subscription_object_id IS NOT NULL THEN
      RAISE EXCEPTION 'Payment attempts cannot begin with a provider subscription chain'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payment_quote_id IS DISTINCT FROM OLD.payment_quote_id THEN
    RAISE EXCEPTION 'Payment attempt quote binding is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.checkout_receipt_digest IS DISTINCT FROM OLD.checkout_receipt_digest
     OR NEW.checkout_receipt_expires_at IS DISTINCT FROM OLD.checkout_receipt_expires_at THEN
    RAISE EXCEPTION 'Opaque checkout receipt binding is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_customer_id IS NOT NULL AND (
    NEW.provider_customer_id IS DISTINCT FROM OLD.provider_customer_id
    OR NEW.provider_subscription_object_type IS DISTINCT FROM OLD.provider_subscription_object_type
    OR NEW.provider_subscription_object_id IS DISTINCT FROM OLD.provider_subscription_object_id
  ) THEN
    RAISE EXCEPTION 'Bound provider customer and subscription identifiers are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_customer_id IS NULL AND NEW.provider_customer_id IS NOT NULL THEN
    IF OLD.payment_mode <> 'recurring'
       OR OLD.status <> 'pending'
       OR NEW.status <> 'succeeded'
       OR NEW.provider_subscription_object_type IS NULL
       OR NEW.provider_subscription_object_id IS NULL THEN
      RAISE EXCEPTION 'Provider subscription chain can bind only on initial recurring success'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.provider_customer_id IS DISTINCT FROM OLD.provider_customer_id
     OR NEW.provider_subscription_object_type IS DISTINCT FROM OLD.provider_subscription_object_type
     OR NEW.provider_subscription_object_id IS DISTINCT FROM OLD.provider_subscription_object_id THEN
    RAISE EXCEPTION 'Provider subscription chain must bind atomically'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_sponsor_account_email_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_catalog.pg_trigger_depth() > 1 OR NOT EXISTS (
      SELECT 1
      FROM auth.users auth_user
      WHERE auth_user.id = OLD.auth_user_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Sponsor account email verification proofs cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'issued' OR NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Sponsor account email verification proofs must begin issued'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.issuer_scope IS DISTINCT FROM OLD.issuer_scope
     OR NEW.email_hmac IS DISTINCT FROM OLD.email_hmac
     OR NEW.normalization_version IS DISTINCT FROM OLD.normalization_version
     OR NEW.hmac_key_version IS DISTINCT FROM OLD.hmac_key_version
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sponsor account email verification proof evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status <> 'issued'
     OR NEW.status NOT IN ('consumed', 'expired') THEN
    RAISE EXCEPTION 'Sponsor account email verification proof is one use'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'consumed' THEN
    NEW.consumed_at := clock_timestamp();
  ELSE
    NEW.consumed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_sponsorship_checkout_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_budget_goal integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sponsorship checkout reservations cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT beneficiary.budget_goal
    INTO v_budget_goal
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id = NEW.beneficiary_id
    FOR SHARE;

    IF NOT FOUND OR v_budget_goal = -1 THEN
      RAISE EXCEPTION 'Only fixed sponsorship beneficiaries use checkout reservations'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status <> 'active'
       OR NEW.lease_expires_at > clock_timestamp() + interval '24 hours' THEN
      RAISE EXCEPTION 'Checkout reservation must begin active with a bounded reconciliation lease'
        USING ERRCODE = '23514';
    END IF;

    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
     OR NEW.sponsorship_intent_id IS DISTINCT FROM OLD.sponsorship_intent_id
     OR NEW.payment_attempt_id IS DISTINCT FROM OLD.payment_attempt_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Checkout reservation ownership and payment chain are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'Terminal checkout reservation evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'active' THEN
    IF NEW.provider_object_expires_at IS NULL
       OR NEW.lease_expires_at < OLD.lease_expires_at
       OR NEW.lease_expires_at < NEW.provider_object_expires_at
       OR NEW.lease_expires_at > clock_timestamp() + interval '24 hours'
       OR NEW.consumed_at IS NOT NULL
       OR NEW.released_at IS NOT NULL
       OR NEW.provider_reconciled_at IS NOT NULL
       OR NEW.release_reason IS NOT NULL
       OR NEW.reconciliation_evidence_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'Active checkout reservation extension is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'consumed' THEN
    NEW.consumed_at := clock_timestamp();
    NEW.released_at := NULL;
    NEW.provider_reconciled_at := NULL;
    NEW.release_reason := NULL;
    NEW.reconciliation_evidence_sha256 := NULL;
  ELSIF NEW.status = 'released' THEN
    IF NEW.provider_reconciled_at IS NULL
       OR NEW.provider_reconciled_at > clock_timestamp() + interval '1 minute'
       OR nullif(btrim(NEW.release_reason), '') IS NULL
       OR octet_length(NEW.reconciliation_evidence_sha256) <> 32 THEN
      RAISE EXCEPTION 'Reservation release requires provider reconciliation evidence'
        USING ERRCODE = '23514';
    END IF;
    NEW.consumed_at := NULL;
    NEW.released_at := clock_timestamp();
  ELSE
    RAISE EXCEPTION 'Illegal checkout reservation status transition'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_linked_payment_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
  v_movement public.sponsorship_financial_movements%ROWTYPE;
BEGIN
  IF NEW.sponsorship_intent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = NEW.sponsorship_intent_id
  FOR SHARE;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = NEW.payment_attempt_id
    AND attempt.sponsorship_intent_id = NEW.sponsorship_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked payment row does not resolve to one intent and attempt'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.sponsor_identity_id IS DISTINCT FROM v_intent.sponsor_identity_id THEN
    RAISE EXCEPTION 'Linked payment row sponsor identity does not match its intent'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'subscriptions' THEN
    IF v_intent.payment_mode <> 'recurring'
       OR NEW.sponsorship_method IS DISTINCT FROM v_attempt.provider
       OR NEW.provider_account_scope IS DISTINCT FROM v_attempt.provider_account_scope
       OR NEW.customer_id IS DISTINCT FROM v_attempt.provider_customer_id
       OR NEW.provider_subscription_object_type IS DISTINCT FROM v_attempt.provider_subscription_object_type
       OR NEW.provider_subscription_object_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
       OR NEW.subject_kind IS DISTINCT FROM v_intent.subject_kind
       OR NEW.beneficiary_id IS DISTINCT FROM v_intent.beneficiary_id
       OR NEW.partnership_project IS DISTINCT FROM v_intent.partnership_project
       OR NEW.amount::bigint IS DISTINCT FROM v_intent.base_amount_usd_cents
       OR NEW.charged_amount::bigint IS DISTINCT FROM v_intent.charged_amount_minor
       OR NEW.charged_currency IS DISTINCT FROM v_intent.charged_currency
       OR NEW.conversion_rate IS DISTINCT FROM v_intent.conversion_rate
       OR NEW.interval IS DISTINCT FROM v_intent.recurrence_interval THEN
      RAISE EXCEPTION 'Subscription terms do not match the server owned intent'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT movement.*
    INTO v_movement
    FROM public.sponsorship_financial_movements movement
    WHERE movement.id = NEW.financial_movement_id
    FOR SHARE;

    IF NOT FOUND
       OR NEW.gateway_event_id IS DISTINCT FROM v_movement.source_gateway_event_id
       OR NEW.payment_provider IS DISTINCT FROM v_movement.provider
       OR NEW.provider_account_scope IS DISTINCT FROM v_movement.provider_account_scope
       OR NEW.provider_movement_type IS DISTINCT FROM v_movement.provider_movement_type
       OR NEW.provider_movement_id IS DISTINCT FROM v_movement.provider_movement_id
       OR NEW.financial_entry_kind IS DISTINCT FROM v_movement.entry_kind
       OR NEW.base_amount_usd_cents IS DISTINCT FROM v_movement.base_amount_usd_cents
       OR NEW.charged_amount::bigint IS DISTINCT FROM v_movement.charged_amount_minor
       OR NEW.charged_currency IS DISTINCT FROM v_movement.charged_currency
       OR NEW.conversion_rate IS DISTINCT FROM v_movement.conversion_rate
       OR NEW.provider_occurred_at IS DISTINCT FROM v_movement.occurred_at THEN
      RAISE EXCEPTION 'Ledger entry does not exactly match its financial movement'
        USING ERRCODE = '23514';
    END IF;

    IF v_movement.payment_mode IS DISTINCT FROM v_attempt.payment_mode THEN
      RAISE EXCEPTION 'Financial movement payment mode does not match its attempt'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_payment_service_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.set_payment_audit_context(
  text,
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_provider_event_type(
  public.sponsorship_method,
  text,
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_sponsorship_checkout_eligibility(
  uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_payment_provider_readiness(
  uuid,
  public.sponsorship_method,
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.finalize_sponsorship_attribution(
  uuid,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_sponsorship_attribution_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.link_payment_provider_object(
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_payment_transaction_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_gateway_event_extensions() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_payment_attempt_provider_chain() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_sponsor_account_email_verification() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_sponsorship_checkout_reservation() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_linked_payment_chain() FROM PUBLIC;
CREATE TRIGGER payment_gateway_events_extension_protect
BEFORE INSERT OR UPDATE ON public.payment_gateway_events
FOR EACH ROW EXECUTE FUNCTION private.protect_gateway_event_extensions();

CREATE TRIGGER sponsorship_payment_attempts_provider_chain_protect
BEFORE INSERT OR UPDATE ON public.sponsorship_payment_attempts
FOR EACH ROW EXECUTE FUNCTION private.protect_payment_attempt_provider_chain();

CREATE TRIGGER sponsor_account_email_verifications_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsor_account_email_verifications
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsor_account_email_verification();

CREATE TRIGGER sponsorship_checkout_reservations_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsorship_checkout_reservations
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsorship_checkout_reservation();

CREATE TRIGGER payment_provider_object_links_protect
BEFORE UPDATE OR DELETE ON public.payment_provider_object_links
FOR EACH ROW EXECUTE FUNCTION private.protect_payment_transaction_evidence();

CREATE TRIGGER sponsorship_payment_quotes_protect
BEFORE UPDATE OR DELETE ON public.sponsorship_payment_quotes
FOR EACH ROW EXECUTE FUNCTION private.protect_payment_transaction_evidence();

CREATE TRIGGER sponsorship_financial_movements_protect
BEFORE UPDATE OR DELETE ON public.sponsorship_financial_movements
FOR EACH ROW EXECUTE FUNCTION private.protect_payment_transaction_evidence();

CREATE TRIGGER sponsorship_refund_requirements_protect
BEFORE UPDATE OR DELETE ON public.sponsorship_refund_requirements
FOR EACH ROW EXECUTE FUNCTION private.protect_payment_transaction_evidence();

CREATE TRIGGER payment_gateway_event_applications_protect
BEFORE UPDATE OR DELETE ON public.payment_gateway_event_applications
FOR EACH ROW EXECUTE FUNCTION private.protect_payment_transaction_evidence();

CREATE TRIGGER subscriptions_payment_chain_validate
BEFORE INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION private.validate_linked_payment_chain();

CREATE TRIGGER transaction_ledger_payment_chain_validate
BEFORE INSERT OR UPDATE ON public.transaction_ledger
FOR EACH ROW EXECUTE FUNCTION private.validate_linked_payment_chain();

CREATE TRIGGER payment_provider_object_links_no_truncate
BEFORE TRUNCATE ON public.payment_provider_object_links
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER sponsorship_payment_quotes_no_truncate
BEFORE TRUNCATE ON public.sponsorship_payment_quotes
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER sponsorship_financial_movements_no_truncate
BEFORE TRUNCATE ON public.sponsorship_financial_movements
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER sponsorship_checkout_reservations_no_truncate
BEFORE TRUNCATE ON public.sponsorship_checkout_reservations
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER sponsorship_refund_requirements_no_truncate
BEFORE TRUNCATE ON public.sponsorship_refund_requirements
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER payment_gateway_event_applications_no_truncate
BEFORE TRUNCATE ON public.payment_gateway_event_applications
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER sponsor_account_email_verifications_no_truncate
BEFORE TRUNCATE ON public.sponsor_account_email_verifications
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

ALTER TABLE public.payment_provider_object_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_payment_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_checkout_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_financial_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_refund_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateway_event_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_account_email_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_provider_object_links
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_payment_quotes
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_checkout_reservations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_financial_movements
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_refund_requirements
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.payment_gateway_event_applications
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsor_account_email_verifications
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.payment_provider_object_links TO service_role;
GRANT SELECT ON public.sponsorship_payment_quotes TO service_role;
GRANT SELECT ON public.sponsorship_checkout_reservations TO service_role;
GRANT SELECT ON public.sponsorship_financial_movements TO service_role;
GRANT SELECT ON public.sponsorship_refund_requirements TO service_role;
GRANT SELECT ON public.payment_gateway_event_applications TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.sponsorship_payment_attempts FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.payment_gateway_events FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.subscriptions FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.transaction_ledger FROM PUBLIC, anon, authenticated, service_role;
REVOKE UPDATE ON public.sponsorship_intents FROM service_role;
REVOKE INSERT ON public.sponsorship_account_claims FROM service_role;
REVOKE INSERT ON public.email_outbox FROM service_role;
REVOKE UPDATE ON public.sponsor_identities FROM service_role;
REVOKE UPDATE ON public.sponsor_identifiers FROM service_role;

CREATE TRIGGER payment_provider_object_links_audit
AFTER INSERT OR UPDATE OR DELETE ON public.payment_provider_object_links
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'provider_object_id');

CREATE TRIGGER sponsorship_payment_quotes_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_payment_quotes
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'quote_idempotency_key');

CREATE TRIGGER sponsorship_checkout_reservations_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_checkout_reservations
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'release_reason');

CREATE TRIGGER sponsorship_financial_movements_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_financial_movements
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'provider_movement_id');

CREATE TRIGGER sponsorship_refund_requirements_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_refund_requirements
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'operational_alert');

CREATE TRIGGER payment_gateway_event_applications_audit
AFTER INSERT OR UPDATE OR DELETE ON public.payment_gateway_event_applications
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'summary');

CREATE TRIGGER sponsor_account_email_verifications_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsor_account_email_verifications
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'email_hmac');

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

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR UPDATE;

  IF NOT FOUND OR v_intent.status <> 'created' THEN
    RAISE EXCEPTION 'Payment quote requires a newly created sponsorship intent'
      USING ERRCODE = '23514';
  END IF;

  IF v_intent.currency_quote_at > clock_timestamp() + interval '1 minute'
     OR v_intent.currency_quote_at < clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Intent currency basis is stale or future dated'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.validate_sponsorship_checkout_eligibility(v_intent.id);
  PERFORM private.validate_payment_provider_readiness(
    v_intent.id,
    target_provider,
    target_provider_account_scope
  );

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.provider = target_provider
    AND quote.provider_account_scope = target_provider_account_scope
    AND quote.quote_idempotency_key = target_quote_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_quote.sponsorship_intent_id IS DISTINCT FROM v_intent.id
       OR v_quote.payment_mode IS DISTINCT FROM v_intent.payment_mode
       OR v_quote.recurrence_interval IS DISTINCT FROM v_intent.recurrence_interval
       OR v_quote.base_amount_usd_cents IS DISTINCT FROM v_intent.base_amount_usd_cents
       OR v_quote.charged_amount_minor IS DISTINCT FROM v_intent.charged_amount_minor
       OR v_quote.charged_currency IS DISTINCT FROM v_intent.charged_currency
       OR v_quote.conversion_rate IS DISTINCT FROM v_intent.conversion_rate THEN
      RAISE EXCEPTION 'Payment quote idempotency key was replayed with different terms'
        USING ERRCODE = '23505';
    END IF;
  ELSE
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
      clock_timestamp() + target_valid_for
    )
    RETURNING * INTO v_quote;
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
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_sponsorship_payment(
  target_sponsorship_intent_id uuid,
  target_payment_quote_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_idempotency_key text,
  target_checkout_receipt_digest bytea,
  target_checkout_receipt_valid_for interval DEFAULT interval '24 hours',
  target_metadata jsonb DEFAULT '{}'::jsonb,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  attempt_number smallint,
  provider public.sponsorship_method,
  provider_account_scope text,
  status public.sponsorship_payment_attempt_status,
  payment_mode public.sponsorship_payment_mode,
  base_amount_usd_cents bigint,
  charged_amount_minor bigint,
  charged_currency public.payment_currency,
  conversion_rate numeric,
  currency_quote_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
  v_attempt_number smallint;
  v_beneficiary_budget_goal integer;
BEGIN
  PERFORM private.require_payment_service_role();

  IF jsonb_typeof(target_metadata) IS DISTINCT FROM 'object'
     OR pg_column_size(target_metadata) > 4096 THEN
    RAISE EXCEPTION 'Payment attempt metadata must be an object no larger than 4096 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_checkout_receipt_valid_for IS NULL
     OR target_checkout_receipt_valid_for < interval '5 minutes'
     OR target_checkout_receipt_valid_for > interval '7 days' THEN
    RAISE EXCEPTION 'Opaque checkout receipt input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF target_provider_idempotency_key IS NULL
     OR target_provider_idempotency_key IS DISTINCT FROM btrim(target_provider_idempotency_key)
     OR length(target_provider_idempotency_key) NOT BETWEEN 16 AND 255 THEN
    RAISE EXCEPTION 'Provider idempotency key is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        target_provider::text,
        target_provider_account_scope,
        target_provider_idempotency_key
      )::text,
      0
    )
  );

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.provider = target_provider
    AND attempt.provider_account_scope = target_provider_account_scope
    AND attempt.provider_idempotency_key = target_provider_idempotency_key;

  IF FOUND THEN
    IF v_attempt.sponsorship_intent_id IS DISTINCT FROM target_sponsorship_intent_id
       OR v_attempt.payment_quote_id IS DISTINCT FROM target_payment_quote_id
       OR v_attempt.checkout_receipt_digest IS DISTINCT FROM target_checkout_receipt_digest THEN
      RAISE EXCEPTION 'Provider idempotency key belongs to another sponsorship intent'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_attempt.id,
      v_attempt.sponsorship_intent_id,
      v_attempt.attempt_number,
      v_attempt.provider,
      v_attempt.provider_account_scope,
      v_attempt.status,
      v_attempt.payment_mode,
      v_attempt.base_amount_usd_cents,
      v_attempt.charged_amount_minor,
      v_attempt.charged_currency,
      v_attempt.conversion_rate,
      v_attempt.currency_quote_at;
    RETURN;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsorship intent does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_intent.sponsor_identity_id IS NULL THEN
    RAISE EXCEPTION 'Payment requires a server owned sponsor identity'
      USING ERRCODE = '23514';
  END IF;

  IF v_intent.status <> 'created' THEN
    RAISE EXCEPTION 'Sponsorship intent cannot begin payment in its current state'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_attributions attribution
    WHERE attribution.sponsorship_intent_id = v_intent.id
  ) THEN
    RAISE EXCEPTION 'Sponsorship intent is missing its immutable attribution decision'
      USING ERRCODE = '23514';
  END IF;

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.id = target_payment_quote_id
    AND quote.sponsorship_intent_id = v_intent.id
    AND quote.provider = target_provider
    AND quote.provider_account_scope = target_provider_account_scope
  FOR SHARE;

  IF NOT FOUND
     OR v_quote.expires_at <= clock_timestamp()
     OR v_quote.payment_mode IS DISTINCT FROM v_intent.payment_mode
     OR v_quote.recurrence_interval IS DISTINCT FROM v_intent.recurrence_interval
     OR v_quote.base_amount_usd_cents IS DISTINCT FROM v_intent.base_amount_usd_cents
     OR v_quote.charged_amount_minor IS DISTINCT FROM v_intent.charged_amount_minor
     OR v_quote.charged_currency IS DISTINCT FROM v_intent.charged_currency
     OR v_quote.conversion_rate IS DISTINCT FROM v_intent.conversion_rate THEN
    RAISE EXCEPTION 'Payment quote is missing, expired, or does not exactly match the intent'
      USING ERRCODE = '23514';
  END IF;

  IF v_quote.id IS DISTINCT FROM (
    SELECT latest_quote.id
    FROM public.sponsorship_payment_quotes latest_quote
    WHERE latest_quote.sponsorship_intent_id = v_intent.id
      AND latest_quote.provider = target_provider
      AND latest_quote.provider_account_scope = target_provider_account_scope
    ORDER BY latest_quote.issued_at DESC, latest_quote.id DESC
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Payment quote has been superseded by a newer server quote'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.validate_sponsorship_checkout_eligibility(v_intent.id);
  PERFORM private.validate_payment_provider_readiness(
    v_intent.id,
    target_provider,
    target_provider_account_scope
  );

  SELECT (COALESCE(max(attempt.attempt_number), 0) + 1)::smallint
  INTO v_attempt_number
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.sponsorship_intent_id = v_intent.id;

  PERFORM private.set_payment_audit_context(
    'begin_sponsorship_payment',
    target_provider,
    target_provider_account_scope,
    NULL,
    NULL,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  INSERT INTO public.sponsorship_payment_attempts (
    sponsorship_intent_id,
    payment_quote_id,
    checkout_receipt_digest,
    checkout_receipt_expires_at,
    attempt_number,
    provider,
    provider_account_scope,
    provider_idempotency_key,
    status,
    payment_mode,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    metadata
  )
  VALUES (
    v_intent.id,
    v_quote.id,
    target_checkout_receipt_digest,
    clock_timestamp() + target_checkout_receipt_valid_for,
    v_attempt_number,
    target_provider,
    target_provider_account_scope,
    target_provider_idempotency_key,
    'created',
    v_intent.payment_mode,
    v_intent.base_amount_usd_cents,
    v_intent.charged_amount_minor,
    v_intent.charged_currency,
    v_intent.conversion_rate,
    v_intent.currency_quote_at,
    target_metadata
  )
  RETURNING * INTO v_attempt;

  IF v_intent.subject_kind = 'standard' THEN
    SELECT beneficiary.budget_goal
    INTO v_beneficiary_budget_goal
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id = v_intent.beneficiary_id
    FOR UPDATE;

    IF v_beneficiary_budget_goal <> -1 THEN
      INSERT INTO public.sponsorship_checkout_reservations (
        beneficiary_id,
        sponsorship_intent_id,
        payment_attempt_id,
        provider,
        provider_account_scope,
        lease_expires_at
      )
      VALUES (
        v_intent.beneficiary_id,
        v_intent.id,
        v_attempt.id,
        v_attempt.provider,
        v_attempt.provider_account_scope,
        clock_timestamp() + interval '30 minutes'
      );
    END IF;
  END IF;

  IF v_intent.status = 'created' THEN
    UPDATE public.sponsorship_intents
    SET status = 'committed'
    WHERE id = v_intent.id;
  END IF;

  RETURN QUERY SELECT
    v_attempt.id,
    v_attempt.sponsorship_intent_id,
    v_attempt.attempt_number,
    v_attempt.provider,
    v_attempt.provider_account_scope,
    v_attempt.status,
    v_attempt.payment_mode,
    v_attempt.base_amount_usd_cents,
    v_attempt.charged_amount_minor,
    v_attempt.charged_currency,
    v_attempt.conversion_rate,
    v_attempt.currency_quote_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_sponsorship_checkout_status(
  target_checkout_receipt_digest bytea
)
RETURNS TABLE (
  checkout_status text,
  is_terminal boolean,
  status_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Checkout receipt digest is malformed'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN attempt.checkout_receipt_expires_at <= statement_timestamp()
        THEN 'expired'
      ELSE attempt.status::text
    END,
    CASE
      WHEN attempt.checkout_receipt_expires_at <= statement_timestamp()
        THEN true
      ELSE attempt.status IN ('succeeded', 'failed', 'cancelled', 'expired')
    END,
    attempt.updated_at
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.checkout_receipt_digest = target_checkout_receipt_digest;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id uuid,
  target_provider_object_type text,
  target_provider_object_id text,
  target_expires_at timestamptz DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_object_type text,
  provider_object_id text,
  status public.sponsorship_payment_attempt_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_expected_type text;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = target_payment_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment attempt does not exist'
      USING ERRCODE = '23503';
  END IF;

  v_expected_type := CASE
    WHEN v_attempt.provider = 'STRIPE' THEN 'checkout_session'
    WHEN v_attempt.payment_mode = 'one_time' THEN 'order'
    ELSE 'billing_subscription'
  END;

  IF target_provider_object_type IS DISTINCT FROM v_expected_type THEN
    RAISE EXCEPTION 'Initial provider object type does not match the payment path'
      USING ERRCODE = '22023';
  END IF;

  IF target_expires_at IS NOT NULL AND target_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Provider object expiry must be in the future'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_reservations reservation
       WHERE reservation.payment_attempt_id = v_attempt.id
         AND reservation.status = 'active'
     )
     AND target_expires_at IS NULL THEN
    RAISE EXCEPTION 'Fixed sponsorship checkout requires provider object expiry evidence'
      USING ERRCODE = '22023';
  END IF;

  IF v_attempt.provider_object_id IS NOT NULL THEN
    IF v_attempt.provider_object_type IS DISTINCT FROM target_provider_object_type
       OR v_attempt.provider_object_id IS DISTINCT FROM target_provider_object_id THEN
      RAISE EXCEPTION 'Payment attempt already has a different provider object'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    IF v_attempt.status <> 'created' THEN
      RAISE EXCEPTION 'Provider object can attach only to a created payment attempt'
        USING ERRCODE = '23514';
    END IF;

    PERFORM private.set_payment_audit_context(
      'attach_sponsorship_payment_provider_object',
      v_attempt.provider,
      v_attempt.provider_account_scope,
      NULL,
      NULL,
      context_request_id,
      context_trace_id,
      context_client_ip,
      context_user_agent
    );

    PERFORM private.link_payment_provider_object(
      v_attempt.id,
      v_attempt.sponsorship_intent_id,
      v_attempt.provider,
      v_attempt.provider_account_scope,
      target_provider_object_type,
      target_provider_object_id,
      'checkout',
      target_expires_at
    );

    UPDATE public.sponsorship_payment_attempts
    SET
      provider_object_type = target_provider_object_type,
      provider_object_id = target_provider_object_id,
      status = 'pending'
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;

    UPDATE public.sponsorship_checkout_reservations reservation
    SET
      provider_object_expires_at = target_expires_at,
      lease_expires_at = greatest(reservation.lease_expires_at, target_expires_at)
    WHERE reservation.payment_attempt_id = v_attempt.id
      AND reservation.status = 'active';

    UPDATE public.sponsorship_intents
    SET status = 'processing'
    WHERE id = v_attempt.sponsorship_intent_id
      AND status = 'committed';
  END IF;

  RETURN QUERY SELECT
    v_attempt.id,
    v_attempt.sponsorship_intent_id,
    v_attempt.provider,
    v_attempt.provider_account_scope,
    v_attempt.provider_object_type,
    v_attempt.provider_object_id,
    v_attempt.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_sponsorship_checkout_reservation(
  target_payment_attempt_id uuid,
  target_provider_terminal_status text,
  target_provider_reconciled_at timestamptz,
  target_reconciliation_evidence_sha256 bytea,
  target_release_reason text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS public.sponsorship_checkout_reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_reservation public.sponsorship_checkout_reservations%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider_terminal_status NOT IN ('expired', 'cancelled', 'voided', 'failed')
     OR target_provider_reconciled_at IS NULL
     OR target_provider_reconciled_at > clock_timestamp() + interval '1 minute'
     OR octet_length(target_reconciliation_evidence_sha256) IS DISTINCT FROM 32
     OR nullif(btrim(target_release_reason), '') IS NULL
     OR length(target_release_reason) > 500 THEN
    RAISE EXCEPTION 'Reservation release requires complete provider reconciliation evidence'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.*
  INTO v_reservation
  FROM public.sponsorship_checkout_reservations reservation
  WHERE reservation.payment_attempt_id = target_payment_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout reservation does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_reservation.status = 'released' THEN
    RETURN v_reservation;
  ELSIF v_reservation.status <> 'active' THEN
    RAISE EXCEPTION 'Consumed checkout reservation cannot be released'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.set_payment_audit_context(
    'release_sponsorship_checkout_reservation',
    v_reservation.provider,
    v_reservation.provider_account_scope,
    NULL,
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  UPDATE public.sponsorship_checkout_reservations
  SET
    status = 'released',
    provider_reconciled_at = target_provider_reconciled_at,
    release_reason = left(
      target_provider_terminal_status || ': ' || target_release_reason,
      500
    ),
    reconciliation_evidence_sha256 = target_reconciliation_evidence_sha256
  WHERE id = v_reservation.id
  RETURNING * INTO v_reservation;

  RETURN v_reservation;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id uuid,
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
  target_fact_payment_status text DEFAULT NULL,
  target_fact_server_payment_attempt_id uuid DEFAULT NULL,
  target_fact_parent_provider_object_type text DEFAULT NULL,
  target_fact_parent_provider_object_id text DEFAULT NULL,
  target_fact_provider_movement_type text DEFAULT NULL,
  target_fact_provider_movement_id text DEFAULT NULL,
  target_fact_provider_customer_id text DEFAULT NULL,
  target_fact_provider_subscription_id text DEFAULT NULL,
  target_fact_base_amount_usd_cents bigint DEFAULT NULL,
  target_fact_charged_amount_minor bigint DEFAULT NULL,
  target_fact_charged_currency public.payment_currency DEFAULT NULL,
  target_fact_conversion_rate numeric DEFAULT NULL,
  target_fact_period_start timestamptz DEFAULT NULL,
  target_fact_period_end timestamptz DEFAULT NULL,
  target_fact_failure_code text DEFAULT NULL,
  target_fact_lifecycle_state text DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  sponsorship_intent_id uuid,
  payment_attempt_id uuid,
  processing_status public.gateway_event_processing_status,
  is_duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_event public.payment_gateway_events%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF jsonb_typeof(target_redacted_payload) IS DISTINCT FROM 'object'
     OR pg_column_size(target_redacted_payload) > 65536 THEN
    RAISE EXCEPTION 'Redacted gateway payload must be an object no larger than 65536 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF target_payload_ciphertext IS NOT NULL
     AND octet_length(target_payload_ciphertext) > 1048576 THEN
    RAISE EXCEPTION 'Encrypted gateway payload exceeds 1048576 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF octet_length(target_payload_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Gateway payload digest must contain 32 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF target_signature_verified_at > clock_timestamp() + interval '5 minutes'
     OR target_signature_verified_at < target_occurred_at - interval '5 minutes'
     OR target_occurred_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Gateway event verification or occurrence time is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (target_provider = 'STRIPE' AND target_verification_method NOT IN (
        'stripe_webhook_signature',
        'provider_api_response'
      ))
     OR (target_provider = 'PAYPAL' AND target_verification_method NOT IN (
        'paypal_webhook_signature_api',
        'provider_api_response'
      )) THEN
    RAISE EXCEPTION 'Verification method does not match the payment provider'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.validate_provider_event_type(
    target_provider,
    target_event_type,
    target_provider_object_type
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

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = target_payment_attempt_id;

  IF NOT FOUND
     OR v_attempt.provider IS DISTINCT FROM target_provider
     OR v_attempt.provider_account_scope IS DISTINCT FROM target_provider_account_scope THEN
    RAISE EXCEPTION 'Gateway event does not match its payment attempt and provider scope'
      USING ERRCODE = '23514';
  END IF;

  IF target_occurred_at < v_attempt.started_at THEN
    RAISE EXCEPTION 'Gateway event cannot precede its server owned payment attempt'
      USING ERRCODE = '23514';
  END IF;

  IF target_event_type IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'checkout.session.async_payment_failed',
       'invoice.paid',
       'invoice.payment_succeeded',
       'invoice.payment_failed',
       'customer.subscription.created',
       'customer.subscription.updated',
       'customer.subscription.deleted',
       'PAYMENT.CAPTURE.COMPLETED',
       'PAYMENT.CAPTURE.DENIED',
       'PAYMENT.SALE.COMPLETED',
       'PAYMENT.SALE.DENIED',
       'BILLING.SUBSCRIPTION.ACTIVATED',
       'BILLING.SUBSCRIPTION.CANCELLED',
       'BILLING.SUBSCRIPTION.SUSPENDED',
       'BILLING.SUBSCRIPTION.EXPIRED',
       'BILLING.SUBSCRIPTION.UPDATED'
     )
     AND target_fact_server_payment_attempt_id IS DISTINCT FROM v_attempt.id THEN
    RAISE EXCEPTION 'Verified provider metadata does not bind the event to this payment attempt'
      USING ERRCODE = '23514';
  END IF;

  IF target_provider = 'PAYPAL'
     AND target_event_type IN (
       'PAYMENT.CAPTURE.COMPLETED',
       'PAYMENT.CAPTURE.DENIED'
     )
     AND (
       target_fact_parent_provider_object_type IS DISTINCT FROM 'order'
       OR target_fact_parent_provider_object_id IS DISTINCT FROM v_attempt.provider_object_id
       OR v_attempt.provider_object_type IS DISTINCT FROM 'order'
       OR v_attempt.status NOT IN ('pending', 'succeeded')
     ) THEN
    RAISE EXCEPTION 'PayPal capture does not belong to the payment attempt order'
      USING ERRCODE = '23514';
  END IF;

  IF target_provider = 'PAYPAL'
     AND target_event_type IN (
       'PAYMENT.SALE.COMPLETED',
       'PAYMENT.SALE.DENIED',
       'BILLING.SUBSCRIPTION.ACTIVATED',
       'BILLING.SUBSCRIPTION.CANCELLED',
       'BILLING.SUBSCRIPTION.SUSPENDED',
       'BILLING.SUBSCRIPTION.EXPIRED',
       'BILLING.SUBSCRIPTION.UPDATED'
     )
     AND (
       target_fact_provider_subscription_id IS DISTINCT FROM v_attempt.provider_object_id
       OR v_attempt.provider_object_type <> 'billing_subscription'
     ) THEN
    RAISE EXCEPTION 'PayPal recurring event does not belong to the payment attempt subscription'
      USING ERRCODE = '23514';
  END IF;

  IF target_event_type IN (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'invoice.paid',
    'invoice.payment_succeeded',
    'PAYMENT.CAPTURE.COMPLETED',
    'PAYMENT.SALE.COMPLETED'
  ) THEN
    IF target_fact_provider_movement_type IS NULL
       OR target_fact_provider_movement_id IS NULL
       OR target_fact_base_amount_usd_cents IS NULL
       OR target_fact_charged_amount_minor IS NULL
       OR target_fact_charged_currency IS NULL
       OR target_fact_conversion_rate IS NULL
       OR target_fact_failure_code IS NOT NULL
       OR target_fact_lifecycle_state IS NOT NULL THEN
      RAISE EXCEPTION 'Successful payment event requires complete typed financial facts'
        USING ERRCODE = '22023';
    END IF;

    IF target_fact_base_amount_usd_cents IS DISTINCT FROM v_attempt.base_amount_usd_cents
       OR target_fact_charged_amount_minor IS DISTINCT FROM v_attempt.charged_amount_minor
       OR target_fact_charged_currency IS DISTINCT FROM v_attempt.charged_currency
       OR target_fact_conversion_rate IS DISTINCT FROM v_attempt.conversion_rate THEN
      RAISE EXCEPTION 'Verified provider amounts do not match the server owned payment terms'
        USING ERRCODE = '23514';
    END IF;

    IF target_provider = 'STRIPE'
       AND target_event_type IN (
         'checkout.session.completed',
         'checkout.session.async_payment_succeeded'
       ) THEN
      IF target_provider_object_type IS DISTINCT FROM v_attempt.provider_object_type
         OR target_provider_object_id IS DISTINCT FROM v_attempt.provider_object_id
         OR target_fact_payment_status IS DISTINCT FROM 'paid' THEN
        RAISE EXCEPTION 'Stripe checkout success subject or payment status is invalid'
          USING ERRCODE = '23514';
      END IF;

      IF (v_attempt.payment_mode = 'one_time'
          AND target_fact_provider_movement_type IS DISTINCT FROM 'payment_intent')
         OR (v_attempt.payment_mode = 'recurring'
          AND target_fact_provider_movement_type IS DISTINCT FROM 'invoice') THEN
        RAISE EXCEPTION 'Stripe checkout movement type does not match payment mode'
          USING ERRCODE = '23514';
      END IF;
    ELSIF target_provider = 'STRIPE' THEN
      IF v_attempt.payment_mode <> 'recurring'
         OR target_fact_provider_movement_type IS DISTINCT FROM 'invoice'
         OR target_fact_provider_movement_id IS DISTINCT FROM target_provider_object_id THEN
        RAISE EXCEPTION 'Stripe invoice subject is not the verified financial movement'
          USING ERRCODE = '23514';
      END IF;
    ELSIF target_event_type = 'PAYMENT.CAPTURE.COMPLETED' THEN
      IF v_attempt.payment_mode <> 'one_time'
         OR target_fact_provider_movement_type IS DISTINCT FROM 'capture'
         OR target_fact_provider_movement_id IS DISTINCT FROM target_provider_object_id THEN
        RAISE EXCEPTION 'PayPal capture subject is not the verified one time movement'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF v_attempt.payment_mode <> 'recurring'
         OR target_fact_provider_movement_type IS DISTINCT FROM 'sale'
         OR target_fact_provider_movement_id IS DISTINCT FROM target_provider_object_id THEN
        RAISE EXCEPTION 'PayPal sale subject is not the verified recurring movement'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_attempt.payment_mode = 'recurring' THEN
      IF target_fact_provider_customer_id IS NULL
         OR target_fact_provider_subscription_id IS NULL
         OR target_fact_period_start IS NULL
         OR target_fact_period_end IS NULL THEN
        RAISE EXCEPTION 'Recurring success requires typed customer, subscription, and period facts'
          USING ERRCODE = '22023';
      END IF;

      IF v_attempt.provider_customer_id IS NOT NULL AND (
        target_fact_provider_customer_id IS DISTINCT FROM v_attempt.provider_customer_id
        OR target_fact_provider_subscription_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
      ) THEN
        RAISE EXCEPTION 'Recurring success does not match the bound provider chain'
          USING ERRCODE = '23514';
      END IF;
    ELSIF target_fact_provider_customer_id IS NOT NULL
       OR target_fact_provider_subscription_id IS NOT NULL
       OR target_fact_period_start IS NOT NULL
       OR target_fact_period_end IS NOT NULL THEN
      RAISE EXCEPTION 'One time success cannot carry recurring provider facts'
        USING ERRCODE = '22023';
    END IF;
  ELSIF target_event_type IN (
    'checkout.session.async_payment_failed',
    'invoice.payment_failed',
    'PAYMENT.CAPTURE.DENIED',
    'PAYMENT.SALE.DENIED'
  ) THEN
    IF target_fact_failure_code IS NULL
       OR target_fact_provider_movement_type IS NOT NULL
       OR target_fact_lifecycle_state IS NOT NULL THEN
      RAISE EXCEPTION 'Payment failure event requires a typed failure code only'
        USING ERRCODE = '22023';
    END IF;

    IF target_event_type = 'checkout.session.async_payment_failed' AND (
      target_provider_object_type IS DISTINCT FROM v_attempt.provider_object_type
      OR target_provider_object_id IS DISTINCT FROM v_attempt.provider_object_id
    ) THEN
      RAISE EXCEPTION 'Stripe checkout failure subject does not match its payment attempt'
        USING ERRCODE = '23514';
    END IF;

    IF v_attempt.provider_customer_id IS NOT NULL AND (
      target_fact_provider_customer_id IS DISTINCT FROM v_attempt.provider_customer_id
      OR target_fact_provider_subscription_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
    ) THEN
      RAISE EXCEPTION 'Payment failure does not match the bound recurring provider chain'
        USING ERRCODE = '23514';
    END IF;
  ELSIF target_event_type IN (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.SUSPENDED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.UPDATED'
  ) THEN
    IF v_attempt.payment_mode <> 'recurring'
       OR target_fact_provider_subscription_id IS DISTINCT FROM target_provider_object_id
       OR target_fact_provider_customer_id IS NULL
       OR target_fact_lifecycle_state IS NULL
       OR target_fact_provider_movement_type IS NOT NULL
       OR target_fact_failure_code IS NOT NULL THEN
      RAISE EXCEPTION 'Lifecycle event subject and typed subscription facts are invalid'
        USING ERRCODE = '22023';
    END IF;

    IF (target_event_type IN (
          'customer.subscription.deleted',
          'BILLING.SUBSCRIPTION.CANCELLED',
          'BILLING.SUBSCRIPTION.EXPIRED'
        ) AND target_fact_lifecycle_state IS DISTINCT FROM 'cancelled')
       OR (target_event_type = 'BILLING.SUBSCRIPTION.SUSPENDED'
          AND target_fact_lifecycle_state IS DISTINCT FROM 'incomplete')
       OR (target_event_type = 'BILLING.SUBSCRIPTION.ACTIVATED'
          AND target_fact_lifecycle_state IS DISTINCT FROM 'active') THEN
      RAISE EXCEPTION 'Lifecycle state does not match its signed provider event type'
        USING ERRCODE = '23514';
    END IF;

    IF v_attempt.provider_customer_id IS NOT NULL AND (
      target_fact_provider_customer_id IS DISTINCT FROM v_attempt.provider_customer_id
      OR target_fact_provider_subscription_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
    ) THEN
      RAISE EXCEPTION 'Lifecycle event does not match the bound recurring provider chain'
        USING ERRCODE = '23514';
    END IF;
  ELSIF target_fact_payment_status IS NOT NULL
     OR target_fact_server_payment_attempt_id IS NOT NULL
     OR target_fact_parent_provider_object_type IS NOT NULL
     OR target_fact_parent_provider_object_id IS NOT NULL
     OR target_fact_provider_movement_type IS NOT NULL
     OR target_fact_provider_movement_id IS NOT NULL
     OR target_fact_provider_customer_id IS NOT NULL
     OR target_fact_provider_subscription_id IS NOT NULL
     OR target_fact_base_amount_usd_cents IS NOT NULL
     OR target_fact_charged_amount_minor IS NOT NULL
     OR target_fact_charged_currency IS NOT NULL
     OR target_fact_conversion_rate IS NOT NULL
     OR target_fact_period_start IS NOT NULL
     OR target_fact_period_end IS NOT NULL
     OR target_fact_failure_code IS NOT NULL
     OR target_fact_lifecycle_state IS NOT NULL THEN
    RAISE EXCEPTION 'Non-applicable gateway event cannot carry typed payment facts'
      USING ERRCODE = '22023';
  END IF;

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.provider = target_provider
    AND gateway_event.provider_account_scope = target_provider_account_scope
    AND gateway_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.payment_attempt_id IS DISTINCT FROM target_payment_attempt_id
       OR v_event.event_type IS DISTINCT FROM target_event_type
       OR v_event.provider_object_type IS DISTINCT FROM target_provider_object_type
       OR v_event.provider_object_id IS DISTINCT FROM target_provider_object_id
       OR v_event.payload_sha256 IS DISTINCT FROM target_payload_sha256
       OR v_event.verification_method IS DISTINCT FROM target_verification_method
       OR v_event.fact_payment_status IS DISTINCT FROM target_fact_payment_status
       OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM target_fact_server_payment_attempt_id
       OR v_event.fact_parent_provider_object_type IS DISTINCT FROM target_fact_parent_provider_object_type
       OR v_event.fact_parent_provider_object_id IS DISTINCT FROM target_fact_parent_provider_object_id
       OR v_event.fact_provider_movement_type IS DISTINCT FROM target_fact_provider_movement_type
       OR v_event.fact_provider_movement_id IS DISTINCT FROM target_fact_provider_movement_id
       OR v_event.fact_provider_customer_id IS DISTINCT FROM target_fact_provider_customer_id
       OR v_event.fact_provider_subscription_id IS DISTINCT FROM target_fact_provider_subscription_id
       OR v_event.fact_base_amount_usd_cents IS DISTINCT FROM target_fact_base_amount_usd_cents
       OR v_event.fact_charged_amount_minor IS DISTINCT FROM target_fact_charged_amount_minor
       OR v_event.fact_charged_currency IS DISTINCT FROM target_fact_charged_currency
       OR v_event.fact_conversion_rate IS DISTINCT FROM target_fact_conversion_rate
       OR v_event.fact_period_start IS DISTINCT FROM target_fact_period_start
       OR v_event.fact_period_end IS DISTINCT FROM target_fact_period_end
       OR v_event.fact_failure_code IS DISTINCT FROM target_fact_failure_code
       OR v_event.fact_lifecycle_state IS DISTINCT FROM target_fact_lifecycle_state THEN
      RAISE EXCEPTION 'Provider event identifier was replayed with different evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_event.id,
      v_event.sponsorship_intent_id,
      v_event.payment_attempt_id,
      v_event.processing_status,
      true;
    RETURN;
  END IF;

  PERFORM private.set_payment_audit_context(
    'ingest_verified_payment_gateway_event',
    target_provider,
    target_provider_account_scope,
    target_event_type,
    target_provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  PERFORM private.link_payment_provider_object(
    v_attempt.id,
    v_attempt.sponsorship_intent_id,
    v_attempt.provider,
    v_attempt.provider_account_scope,
    target_provider_object_type,
    target_provider_object_id,
    'event_subject',
    NULL
  );

  INSERT INTO public.payment_gateway_events (
    provider,
    provider_account_scope,
    provider_event_id,
    event_type,
    provider_object_type,
    provider_object_id,
    sponsorship_intent_id,
    payment_attempt_id,
    redacted_payload,
    payload_ciphertext,
    payload_sha256,
    signature_verified_at,
    occurred_at,
    verification_method,
    fact_payment_status,
    fact_server_payment_attempt_id,
    fact_parent_provider_object_type,
    fact_parent_provider_object_id,
    fact_provider_movement_type,
    fact_provider_movement_id,
    fact_provider_customer_id,
    fact_provider_subscription_id,
    fact_base_amount_usd_cents,
    fact_charged_amount_minor,
    fact_charged_currency,
    fact_conversion_rate,
    fact_period_start,
    fact_period_end,
    fact_failure_code,
    fact_lifecycle_state
  )
  VALUES (
    target_provider,
    target_provider_account_scope,
    target_provider_event_id,
    target_event_type,
    target_provider_object_type,
    target_provider_object_id,
    v_attempt.sponsorship_intent_id,
    v_attempt.id,
    target_redacted_payload,
    target_payload_ciphertext,
    target_payload_sha256,
    target_signature_verified_at,
    target_occurred_at,
    target_verification_method,
    target_fact_payment_status,
    target_fact_server_payment_attempt_id,
    target_fact_parent_provider_object_type,
    target_fact_parent_provider_object_id,
    target_fact_provider_movement_type,
    target_fact_provider_movement_id,
    target_fact_provider_customer_id,
    target_fact_provider_subscription_id,
    target_fact_base_amount_usd_cents,
    target_fact_charged_amount_minor,
    target_fact_charged_currency,
    target_fact_conversion_rate,
    target_fact_period_start,
    target_fact_period_end,
    target_fact_failure_code,
    target_fact_lifecycle_state
  )
  RETURNING * INTO v_event;

  RETURN QUERY SELECT
    v_event.id,
    v_event.sponsorship_intent_id,
    v_event.payment_attempt_id,
    v_event.processing_status,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_payment_gateway_events(
  target_worker_id text,
  target_batch_size integer DEFAULT 20,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  processing_lease_token uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_event_id text,
  event_type text,
  provider_object_type text,
  provider_object_id text,
  sponsorship_intent_id uuid,
  payment_attempt_id uuid,
  redacted_payload jsonb,
  payload_ciphertext bytea,
  occurred_at timestamptz,
  processing_attempt_count smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.require_payment_service_role();

  IF nullif(btrim(target_worker_id), '') IS NULL
     OR length(target_worker_id) > 140 THEN
    RAISE EXCEPTION 'Gateway worker identifier must contain 1 to 140 characters'
      USING ERRCODE = '22023';
  END IF;

  IF target_batch_size IS NULL
     OR target_batch_size < 1
     OR target_batch_size > 100 THEN
    RAISE EXCEPTION 'Gateway claim batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.set_payment_audit_context(
    'claim_payment_gateway_events',
    'STRIPE',
    'worker_batch',
    NULL,
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  RETURN QUERY
  WITH candidates AS (
    SELECT
      gateway_event.id,
      gen_random_uuid() AS lease_token
    FROM public.payment_gateway_events gateway_event
    WHERE gateway_event.processing_attempt_count < gateway_event.max_processing_attempts
      AND (
        (
          gateway_event.processing_status IN ('received', 'failed')
          AND gateway_event.available_at <= clock_timestamp()
        )
        OR (
          gateway_event.processing_status = 'processing'
          AND gateway_event.processing_locked_at <= clock_timestamp() - interval '10 minutes'
        )
      )
    ORDER BY gateway_event.available_at, gateway_event.received_at, gateway_event.id
    LIMIT target_batch_size
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.payment_gateway_events gateway_event
    SET
      processing_status = 'processing',
      processing_locked_by = left(target_worker_id, 140) || ':' || candidates.lease_token::text,
      processing_lease_token = candidates.lease_token
    FROM candidates
    WHERE gateway_event.id = candidates.id
    RETURNING gateway_event.*
  )
  SELECT
    claimed.id,
    claimed.processing_lease_token,
    claimed.provider,
    claimed.provider_account_scope,
    claimed.provider_event_id,
    claimed.event_type,
    claimed.provider_object_type,
    claimed.provider_object_id,
    claimed.sponsorship_intent_id,
    claimed.payment_attempt_id,
    claimed.redacted_payload,
    claimed.payload_ciphertext,
    claimed.occurred_at,
    claimed.processing_attempt_count
  FROM claimed
  ORDER BY claimed.available_at, claimed.received_at, claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sponsorship_payment_success(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  target_claim_token_digest bytea DEFAULT NULL,
  target_recipient_email_ciphertext bytea DEFAULT NULL,
  target_email_encryption_key_version smallint DEFAULT NULL,
  target_secret_payload_ciphertext bytea DEFAULT NULL,
  target_welcome_template_key text DEFAULT 'sponsor-welcome-v1',
  target_welcome_template_data jsonb DEFAULT '{}'::jsonb,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  financial_movement_id uuid,
  subscription_id uuid,
  account_claim_id uuid,
  email_outbox_id uuid,
  application_effect public.gateway_event_application_effect
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_application public.payment_gateway_event_applications%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_movement public.sponsorship_financial_movements%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_account public.payment_provider_accounts%ROWTYPE;
  v_claim public.sponsorship_account_claims%ROWTYPE;
  v_email public.email_outbox%ROWTYPE;
  v_reservation public.sponsorship_checkout_reservations%ROWTYPE;
  v_subscription_object_type text;
  v_is_new_movement boolean := false;
  v_is_initial_payment boolean := false;
  v_requires_refund boolean := false;
  v_effect public.gateway_event_application_effect;
BEGIN
  PERFORM private.require_payment_service_role();

  IF jsonb_typeof(target_welcome_template_data) IS DISTINCT FROM 'object'
     OR pg_column_size(target_welcome_template_data) > 4096
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(target_welcome_template_data) AS template_key(key)
       WHERE template_key.key NOT IN (
         'subject_kind',
         'beneficiary_id',
         'partnership_project',
         'payment_mode',
         'recurrence_interval',
         'locale'
       )
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_each(target_welcome_template_data) AS template_value(key, value)
       WHERE jsonb_typeof(template_value.value) NOT IN (
         'string', 'number', 'boolean', 'null'
       )
     ) THEN
    RAISE EXCEPTION 'Welcome template data contains unsafe or unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT application.*
  INTO v_application
  FROM public.payment_gateway_event_applications application
  WHERE application.gateway_event_id = v_event.id;

  IF FOUND THEN
    SELECT movement.*
    INTO v_movement
    FROM public.sponsorship_financial_movements movement
    WHERE movement.id = v_application.financial_movement_id;

    SELECT claim.*
    INTO v_claim
    FROM public.sponsorship_account_claims claim
    WHERE claim.sponsorship_intent_id = v_event.sponsorship_intent_id
    ORDER BY claim.created_at
    LIMIT 1;

    IF v_claim.id IS NOT NULL THEN
      SELECT email.*
      INTO v_email
      FROM public.email_outbox email
      WHERE email.account_claim_id = v_claim.id;
    END IF;

    RETURN QUERY SELECT
      v_event.id,
      v_application.financial_movement_id,
      v_application.subscription_id,
      v_claim.id,
      v_email.id,
      v_application.effect;
    RETURN;
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM target_processing_lease_token THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = v_event.payment_attempt_id
    AND attempt.sponsorship_intent_id = v_event.sponsorship_intent_id
    AND attempt.provider = v_event.provider
    AND attempt.provider_account_scope = v_event.provider_account_scope
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event payment chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id
  FOR UPDATE;

  IF NOT FOUND OR v_intent.sponsor_identity_id IS NULL THEN
    RAISE EXCEPTION 'Successful payment requires a server owned sponsor identity'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_attributions attribution
    WHERE attribution.sponsorship_intent_id = v_intent.id
  ) THEN
    RAISE EXCEPTION 'Successful payment is missing its immutable attribution decision'
      USING ERRCODE = '23514';
  END IF;

  IF v_event.event_type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'invoice.paid',
       'invoice.payment_succeeded',
       'PAYMENT.CAPTURE.COMPLETED',
       'PAYMENT.SALE.COMPLETED'
     )
     OR v_event.fact_provider_movement_type IS NULL
     OR v_event.fact_provider_movement_id IS NULL
     OR v_event.fact_base_amount_usd_cents IS DISTINCT FROM v_attempt.base_amount_usd_cents
     OR v_event.fact_charged_amount_minor IS DISTINCT FROM v_attempt.charged_amount_minor
     OR v_event.fact_charged_currency IS DISTINCT FROM v_attempt.charged_currency
     OR v_event.fact_conversion_rate IS DISTINCT FROM v_attempt.conversion_rate THEN
    RAISE EXCEPTION 'Gateway event does not contain authoritative typed success facts'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.payment_mode = 'recurring' THEN
    v_subscription_object_type := CASE
      WHEN v_event.provider = 'STRIPE' THEN 'subscription'
      ELSE 'billing_subscription'
    END;

    IF v_event.fact_provider_customer_id IS NULL
       OR v_event.fact_provider_subscription_id IS NULL
       OR v_event.fact_period_start IS NULL
       OR v_event.fact_period_end IS NULL THEN
      RAISE EXCEPTION 'Recurring success is missing its immutable provider chain facts'
        USING ERRCODE = '23514';
    END IF;

    IF v_attempt.provider_customer_id IS NOT NULL AND (
      v_event.fact_provider_customer_id IS DISTINCT FROM v_attempt.provider_customer_id
      OR v_subscription_object_type IS DISTINCT FROM v_attempt.provider_subscription_object_type
      OR v_event.fact_provider_subscription_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
    ) THEN
      RAISE EXCEPTION 'Recurring success does not match the bound provider chain'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT account.*
  INTO v_account
  FROM public.payment_provider_accounts account
  WHERE account.provider = v_event.provider
    AND account.scope = v_event.provider_account_scope
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment provider account no longer exists'
      USING ERRCODE = '23503';
  END IF;

  PERFORM private.set_payment_audit_context(
    'apply_sponsorship_payment_success',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  PERFORM private.link_payment_provider_object(
    v_attempt.id,
    v_intent.id,
    v_event.provider,
    v_event.provider_account_scope,
    v_event.fact_provider_movement_type,
    v_event.fact_provider_movement_id,
    'movement',
    NULL
  );

  IF v_attempt.payment_mode = 'recurring' THEN
    PERFORM private.link_payment_provider_object(
      v_attempt.id,
      v_intent.id,
      v_event.provider,
      v_event.provider_account_scope,
      v_subscription_object_type,
      v_event.fact_provider_subscription_id,
      'subscription',
      NULL
    );
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_financial_movements prior_movement
    WHERE prior_movement.sponsorship_intent_id = v_intent.id
      AND prior_movement.entry_kind = 'sponsorship_payment'
  )
  INTO v_is_initial_payment;

  IF v_is_initial_payment
     AND v_intent.subject_kind = 'standard'
     AND EXISTS (
       SELECT 1
       FROM public.beneficiaries beneficiary
       WHERE beneficiary.id = v_intent.beneficiary_id
         AND beneficiary.budget_goal <> -1
     ) THEN
    SELECT reservation.*
    INTO v_reservation
    FROM public.sponsorship_checkout_reservations reservation
    WHERE reservation.beneficiary_id = v_intent.beneficiary_id
      AND reservation.sponsorship_intent_id = v_intent.id
      AND reservation.payment_attempt_id = v_attempt.id
      AND reservation.provider = v_attempt.provider
      AND reservation.provider_account_scope = v_attempt.provider_account_scope
    FOR UPDATE;

    v_requires_refund := v_reservation.id IS NULL
      OR v_reservation.status <> 'active';
  END IF;

  IF v_is_initial_payment AND NOT v_requires_refund THEN
    PERFORM private.finalize_sponsorship_attribution(
      v_intent.id,
      v_event.occurred_at
    );
  END IF;

  INSERT INTO public.sponsorship_financial_movements (
    source_gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    sponsor_identity_id,
    provider,
    provider_account_scope,
    provider_movement_type,
    provider_movement_id,
    entry_kind,
    payment_mode,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    occurred_at
  )
  VALUES (
    v_event.id,
    v_attempt.id,
    v_intent.id,
    v_intent.sponsor_identity_id,
    v_event.provider,
    v_event.provider_account_scope,
    v_event.fact_provider_movement_type,
    v_event.fact_provider_movement_id,
    'sponsorship_payment',
    v_attempt.payment_mode,
    v_event.fact_base_amount_usd_cents,
    v_event.fact_charged_amount_minor,
    v_event.fact_charged_currency,
    v_event.fact_conversion_rate,
    v_event.occurred_at
  )
  ON CONFLICT (
    provider,
    provider_account_scope,
    provider_movement_type,
    provider_movement_id,
    entry_kind
  ) DO NOTHING
  RETURNING * INTO v_movement;

  v_is_new_movement := v_movement.id IS NOT NULL;

  IF NOT v_is_new_movement THEN
    SELECT movement.*
    INTO v_movement
    FROM public.sponsorship_financial_movements movement
    WHERE movement.provider = v_event.provider
      AND movement.provider_account_scope = v_event.provider_account_scope
      AND movement.provider_movement_type = v_event.fact_provider_movement_type
      AND movement.provider_movement_id = v_event.fact_provider_movement_id
      AND movement.entry_kind = 'sponsorship_payment'
    FOR SHARE;

    IF v_movement.payment_attempt_id IS DISTINCT FROM v_attempt.id
       OR v_movement.sponsorship_intent_id IS DISTINCT FROM v_intent.id
       OR v_movement.sponsor_identity_id IS DISTINCT FROM v_intent.sponsor_identity_id
       OR v_movement.payment_mode IS DISTINCT FROM v_attempt.payment_mode
       OR v_movement.base_amount_usd_cents IS DISTINCT FROM v_event.fact_base_amount_usd_cents
       OR v_movement.charged_amount_minor IS DISTINCT FROM v_event.fact_charged_amount_minor
       OR v_movement.charged_currency IS DISTINCT FROM v_event.fact_charged_currency
       OR v_movement.conversion_rate IS DISTINCT FROM v_event.fact_conversion_rate THEN
      RAISE EXCEPTION 'Provider movement identity conflicts with another financial fact'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_is_new_movement AND v_requires_refund THEN
    IF v_attempt.status <> 'pending'
       OR v_intent.status NOT IN ('committed', 'processing') THEN
      RAISE EXCEPTION 'Reservation exception requires an initial pending payment'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.sponsorship_payment_attempts
    SET
      status = 'succeeded',
      provider_customer_id = CASE
        WHEN payment_mode = 'recurring' THEN v_event.fact_provider_customer_id
        ELSE NULL
      END,
      provider_subscription_object_type = CASE
        WHEN payment_mode = 'recurring' THEN v_subscription_object_type
        ELSE NULL
      END,
      provider_subscription_object_id = CASE
        WHEN payment_mode = 'recurring' THEN v_event.fact_provider_subscription_id
        ELSE NULL
      END
    WHERE id = v_attempt.id;

    UPDATE public.sponsorship_intents
    SET status = 'failed'
    WHERE id = v_intent.id;

    INSERT INTO public.sponsorship_refund_requirements (
      financial_movement_id,
      source_gateway_event_id,
      payment_attempt_id,
      sponsorship_intent_id,
      beneficiary_id,
      provider,
      provider_account_scope,
      reason,
      operational_alert
    )
    VALUES (
      v_movement.id,
      v_event.id,
      v_attempt.id,
      v_intent.id,
      v_intent.beneficiary_id,
      v_event.provider,
      v_event.provider_account_scope,
      'Verified payment arrived without the active fixed beneficiary reservation',
      jsonb_build_object(
        'severity', 'critical',
        'operation', 'refund_required',
        'provider', v_event.provider::text,
        'provider_account_scope', v_event.provider_account_scope,
        'payment_attempt_id', v_attempt.id,
        'gateway_event_id', v_event.id
      )
    );

    INSERT INTO public.payment_gateway_event_applications (
      gateway_event_id,
      effect,
      financial_movement_id,
      summary
    )
    VALUES (
      v_event.id,
      'refund_required',
      v_movement.id,
      jsonb_build_object(
        'provider', v_event.provider::text,
        'provider_account_scope', v_event.provider_account_scope,
        'event_type', v_event.event_type,
        'operation', 'refund_required'
      )
    );

    UPDATE public.payment_gateway_events
    SET
      processing_status = 'processed',
      processing_lease_token = NULL
    WHERE id = v_event.id;

    RETURN QUERY SELECT
      v_event.id,
      v_movement.id,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      'refund_required'::public.gateway_event_application_effect;
    RETURN;
  END IF;

  IF v_is_new_movement THEN
    IF v_is_initial_payment THEN
      IF v_attempt.status <> 'pending'
         OR v_intent.status NOT IN ('committed', 'processing') THEN
        RAISE EXCEPTION 'Initial payment success requires a pending attempt and committed intent'
          USING ERRCODE = '23514';
      END IF;

      UPDATE public.sponsorship_payment_attempts
      SET
        status = 'succeeded',
        provider_customer_id = CASE
          WHEN payment_mode = 'recurring' THEN v_event.fact_provider_customer_id
          ELSE NULL
        END,
        provider_subscription_object_type = CASE
          WHEN payment_mode = 'recurring' THEN v_subscription_object_type
          ELSE NULL
        END,
        provider_subscription_object_id = CASE
          WHEN payment_mode = 'recurring' THEN v_event.fact_provider_subscription_id
          ELSE NULL
        END
      WHERE id = v_attempt.id;

      SELECT attempt.*
      INTO v_attempt
      FROM public.sponsorship_payment_attempts attempt
      WHERE attempt.id = v_attempt.id;

      UPDATE public.sponsorship_intents
      SET status = 'succeeded'
      WHERE id = v_intent.id;

      IF v_reservation.id IS NOT NULL THEN
        UPDATE public.sponsorship_checkout_reservations
        SET status = 'consumed'
        WHERE id = v_reservation.id
          AND status = 'active';

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Fixed beneficiary reservation was not consumed atomically'
            USING ERRCODE = '40001';
        END IF;
      END IF;
    ELSIF v_attempt.status <> 'succeeded' THEN
      RAISE EXCEPTION 'Recurring payment success requires the original successful attempt'
        USING ERRCODE = '23514';
    END IF;

    IF v_attempt.payment_mode = 'recurring' THEN
      SELECT subscription.*
      INTO v_subscription
      FROM public.subscriptions subscription
      WHERE subscription.sponsorship_intent_id = v_intent.id
      ORDER BY subscription.created_at
      LIMIT 1
      FOR UPDATE;

      IF v_subscription.id IS NULL THEN
        INSERT INTO public.subscriptions (
          user_id,
          beneficiary_id,
          status,
          amount,
          interval,
          current_period_start,
          current_period_end,
          customer_id,
          email_notification,
          sponsorship_method,
          stripe_subscription_id,
          payment_region,
          charged_amount,
          charged_currency,
          conversion_rate,
          provider_event_id,
          email,
          sponsorship_intent_id,
          sponsor_identity_id,
          payment_attempt_id,
          provider_account_scope,
          provider_subscription_object_type,
          provider_subscription_object_id,
          subject_kind,
          partnership_project,
          initial_gateway_event_id,
          payment_health,
          last_provider_payment_event_occurred_at,
          last_provider_payment_event_precedence,
          last_provider_payment_event_id
        )
        VALUES (
          v_intent.auth_user_id,
          v_intent.beneficiary_id,
          'complete',
          v_intent.base_amount_usd_cents::integer,
          v_intent.recurrence_interval,
          v_event.fact_period_start AT TIME ZONE 'UTC',
          v_event.fact_period_end AT TIME ZONE 'UTC',
          v_event.fact_provider_customer_id,
          true,
          v_event.provider,
          v_event.fact_provider_subscription_id,
          COALESCE(v_account.stripe_region, 'us'),
          v_intent.charged_amount_minor::integer,
          v_intent.charged_currency,
          v_intent.conversion_rate,
          NULL,
          NULL,
          v_intent.id,
          v_intent.sponsor_identity_id,
          v_attempt.id,
          v_event.provider_account_scope,
          v_subscription_object_type,
          v_event.fact_provider_subscription_id,
          v_intent.subject_kind,
          v_intent.partnership_project,
          v_event.id,
          'paid',
          v_event.occurred_at,
          100,
          v_event.provider_event_id
        )
        RETURNING * INTO v_subscription;
      ELSE
        IF v_subscription.sponsorship_intent_id IS DISTINCT FROM v_intent.id
           OR v_subscription.payment_attempt_id IS DISTINCT FROM v_attempt.id
           OR v_subscription.customer_id IS DISTINCT FROM v_attempt.provider_customer_id
           OR v_subscription.provider_subscription_object_type IS DISTINCT FROM v_attempt.provider_subscription_object_type
           OR v_subscription.provider_subscription_object_id IS DISTINCT FROM v_attempt.provider_subscription_object_id THEN
          RAISE EXCEPTION 'Provider subscription belongs to another sponsorship payment chain'
            USING ERRCODE = '23505';
        END IF;

        IF v_event.occurred_at > v_subscription.last_provider_payment_event_occurred_at
           OR (
             v_event.occurred_at = v_subscription.last_provider_payment_event_occurred_at
             AND v_subscription.last_provider_payment_event_precedence < 100
           ) THEN
          UPDATE public.subscriptions
          SET
            current_period_start = v_event.fact_period_start AT TIME ZONE 'UTC',
            current_period_end = v_event.fact_period_end AT TIME ZONE 'UTC',
            payment_health = 'paid',
            last_provider_payment_event_occurred_at = v_event.occurred_at,
            last_provider_payment_event_precedence = 100,
            last_provider_payment_event_id = v_event.provider_event_id
          WHERE id = v_subscription.id
          RETURNING * INTO v_subscription;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.transaction_ledger (
      user_id,
      beneficiary_id,
      credit,
      customer_email,
      customer_name,
      reference,
      description,
      tx_action,
      subscription_type,
      customer_id,
      payment_intent,
      payment_method_id,
      charged_amount,
      charged_currency,
      conversion_rate,
      provider_event_id,
      subscription_id,
      sponsorship_intent_id,
      sponsor_identity_id,
      payment_attempt_id,
      gateway_event_id,
      payment_provider,
      provider_account_scope,
      provider_movement_type,
      provider_movement_id,
      financial_entry_kind,
      financial_movement_id,
      base_amount_usd_cents,
      provider_occurred_at
    )
    VALUES (
      v_intent.auth_user_id,
      v_intent.beneficiary_id,
      v_intent.base_amount_usd_cents::integer,
      NULL,
      NULL,
      v_event.fact_provider_movement_id,
      'Verified Creator Share sponsorship payment',
      'SPONSORSHIP',
      COALESCE(v_intent.recurrence_interval, 'one_time'),
      v_event.fact_provider_customer_id,
      NULL,
      NULL,
      v_intent.charged_amount_minor::integer,
      v_intent.charged_currency,
      v_intent.conversion_rate,
      NULL,
      v_subscription.id,
      v_intent.id,
      v_intent.sponsor_identity_id,
      v_attempt.id,
      v_event.id,
      v_event.provider,
      v_event.provider_account_scope,
      v_event.fact_provider_movement_type,
      v_event.fact_provider_movement_id,
      'sponsorship_payment',
      v_movement.id,
      v_intent.base_amount_usd_cents,
      v_event.occurred_at
    );

    IF v_is_initial_payment THEN
      PERFORM 1
      FROM public.sponsor_identities identity
      WHERE identity.id = v_intent.sponsor_identity_id
        AND identity.status = 'active'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Sponsor identity is no longer active'
          USING ERRCODE = '23514';
      END IF;

      SELECT email.*
      INTO v_email
      FROM public.email_outbox email
      WHERE email.kind = 'sponsor_welcome'
        AND email.sponsor_identity_id = v_intent.sponsor_identity_id
      FOR SHARE;

      IF v_email.id IS NULL THEN
        IF octet_length(target_claim_token_digest) <> 32
           OR target_recipient_email_ciphertext IS NULL
           OR octet_length(target_recipient_email_ciphertext) = 0
           OR target_email_encryption_key_version IS NULL
           OR target_email_encryption_key_version < 1
           OR target_secret_payload_ciphertext IS NULL
           OR octet_length(target_secret_payload_ciphertext) = 0 THEN
          RAISE EXCEPTION 'First successful sponsorship requires a complete encrypted welcome and claim bundle'
            USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.sponsorship_account_claims (
          sponsorship_intent_id,
          requested_browser_visitor_id,
          email_hmac,
          email_normalization_version,
          email_hmac_key_version,
          token_digest,
          status,
          sponsor_identity_id,
          expires_at
        )
        VALUES (
          v_intent.id,
          v_intent.browser_visitor_id,
          v_intent.contact_email_hmac,
          v_intent.contact_email_normalization_version,
          v_intent.contact_email_hmac_key_version,
          target_claim_token_digest,
          'pending',
          v_intent.sponsor_identity_id,
          clock_timestamp() + interval '6 days 23 hours 59 minutes'
        )
        RETURNING * INTO v_claim;

        INSERT INTO public.email_outbox (
          kind,
          account_claim_id,
          sponsor_identity_id,
          dedupe_key,
          recipient_email_ciphertext,
          recipient_email_hmac,
          email_normalization_version,
          email_hmac_key_version,
          email_encryption_key_version,
          template_key,
          template_data,
          secret_payload_ciphertext,
          status
        )
        VALUES (
          'sponsor_welcome',
          v_claim.id,
          v_intent.sponsor_identity_id,
          'sponsor_welcome:' || v_intent.sponsor_identity_id::text,
          target_recipient_email_ciphertext,
          v_intent.contact_email_hmac,
          v_intent.contact_email_normalization_version,
          v_intent.contact_email_hmac_key_version,
          target_email_encryption_key_version,
          target_welcome_template_key,
          jsonb_strip_nulls(jsonb_build_object(
            'subject_kind', v_intent.subject_kind::text,
            'beneficiary_id', v_intent.beneficiary_id,
            'partnership_project', v_intent.partnership_project::text,
            'payment_mode', v_intent.payment_mode::text,
            'recurrence_interval', v_intent.recurrence_interval,
            'locale', target_welcome_template_data -> 'locale'
          )),
          target_secret_payload_ciphertext,
          'pending'
        )
        RETURNING * INTO v_email;
      END IF;
    END IF;

    v_effect := 'payment_succeeded';
  ELSE
    v_effect := 'duplicate_movement';
  END IF;

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    financial_movement_id,
    subscription_id,
    summary
  )
  VALUES (
    v_event.id,
    v_effect,
    v_movement.id,
    v_subscription.id,
    jsonb_build_object(
      'provider', v_event.provider::text,
      'provider_account_scope', v_event.provider_account_scope,
      'event_type', v_event.event_type,
      'operation', v_effect::text
    )
  )
  RETURNING * INTO v_application;

  IF v_effect = 'duplicate_movement' THEN
    UPDATE public.payment_gateway_events
    SET
      processing_status = 'ignored',
      ignored_reason = 'Duplicate verified provider movement',
      processing_lease_token = NULL
    WHERE id = v_event.id;
  ELSE
    UPDATE public.payment_gateway_events
    SET
      processing_status = 'processed',
      processing_lease_token = NULL
    WHERE id = v_event.id;
  END IF;

  RETURN QUERY SELECT
    v_event.id,
    v_movement.id,
    v_subscription.id,
    v_claim.id,
    v_email.id,
    v_effect;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sponsorship_payment_failure(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  subscription_id uuid,
  application_effect public.gateway_event_application_effect
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_application public.payment_gateway_event_applications%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT application.*
  INTO v_application
  FROM public.payment_gateway_event_applications application
  WHERE application.gateway_event_id = v_event.id;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_event.id,
      v_event.payment_attempt_id,
      v_event.sponsorship_intent_id,
      v_application.subscription_id,
      v_application.effect;
    RETURN;
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM target_processing_lease_token THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  IF (v_event.provider = 'STRIPE' AND v_event.event_type NOT IN (
        'checkout.session.async_payment_failed',
        'invoice.payment_failed'
      ))
     OR (v_event.provider = 'PAYPAL' AND v_event.event_type NOT IN (
        'PAYMENT.CAPTURE.DENIED',
        'PAYMENT.SALE.DENIED'
      ))
     OR v_event.fact_failure_code IS NULL THEN
    RAISE EXCEPTION 'Gateway event is not authoritative for payment failure'
      USING ERRCODE = '23514';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = v_event.payment_attempt_id
    AND attempt.sponsorship_intent_id = v_event.sponsorship_intent_id
    AND attempt.provider = v_event.provider
    AND attempt.provider_account_scope = v_event.provider_account_scope
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event payment chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id
  FOR UPDATE;

  IF v_attempt.payment_mode = 'recurring' THEN
    SELECT subscription.*
    INTO v_subscription
    FROM public.subscriptions subscription
    WHERE subscription.sponsorship_intent_id = v_intent.id
    LIMIT 1
    FOR UPDATE;

    IF v_attempt.status = 'succeeded' AND (
      v_subscription.id IS NULL
      OR v_event.fact_provider_customer_id IS DISTINCT FROM v_attempt.provider_customer_id
      OR v_event.fact_provider_subscription_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
      OR v_subscription.customer_id IS DISTINCT FROM v_attempt.provider_customer_id
      OR v_subscription.provider_subscription_object_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
    ) THEN
      RAISE EXCEPTION 'Recurring payment failure does not match its materialized provider chain'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM private.set_payment_audit_context(
    'apply_sponsorship_payment_failure',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  IF v_attempt.status = 'pending' THEN
    UPDATE public.sponsorship_payment_attempts
    SET
      status = 'failed',
      failure_code = v_event.fact_failure_code
    WHERE id = v_attempt.id;

    UPDATE public.sponsorship_intents
    SET status = 'failed'
    WHERE id = v_intent.id
      AND status IN ('committed', 'processing');

    UPDATE public.sponsorship_checkout_reservations
    SET
      status = 'released',
      provider_reconciled_at = v_event.signature_verified_at,
      release_reason = left(
        'failed: verified provider payment failure ' || v_event.fact_failure_code,
        500
      ),
      reconciliation_evidence_sha256 = v_event.payload_sha256
    WHERE payment_attempt_id = v_attempt.id
      AND status = 'active';
  ELSIF v_attempt.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Payment failure cannot apply to the current attempt state'
      USING ERRCODE = '23514';
  END IF;

  IF v_subscription.id IS NOT NULL THEN
    IF v_event.occurred_at > v_subscription.last_provider_payment_event_occurred_at
       OR (
         v_event.occurred_at = v_subscription.last_provider_payment_event_occurred_at
         AND v_subscription.last_provider_payment_event_precedence < 200
       ) THEN
      UPDATE public.subscriptions
      SET
        payment_health = 'delinquent',
        last_provider_payment_event_occurred_at = v_event.occurred_at,
        last_provider_payment_event_precedence = 200,
        last_provider_payment_event_id = v_event.provider_event_id
      WHERE id = v_subscription.id
      RETURNING * INTO v_subscription;
    END IF;
  END IF;

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    subscription_id,
    summary
  )
  VALUES (
    v_event.id,
    'payment_failed',
    v_subscription.id,
    jsonb_build_object(
      'provider', v_event.provider::text,
      'provider_account_scope', v_event.provider_account_scope,
      'event_type', v_event.event_type,
      'outcome', 'payment_failed'
    )
  );

  UPDATE public.payment_gateway_events
  SET
    processing_status = 'processed',
    processing_lease_token = NULL
  WHERE id = v_event.id;

  RETURN QUERY SELECT
    v_event.id,
    v_attempt.id,
    v_intent.id,
    v_subscription.id,
    'payment_failed'::public.gateway_event_application_effect;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sponsorship_subscription_lifecycle(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  subscription_id uuid,
  subscription_status public."SubscriptionStatus",
  application_effect public.gateway_event_application_effect
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_application public.payment_gateway_event_applications%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_status public."SubscriptionStatus";
  v_precedence smallint;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT application.*
  INTO v_application
  FROM public.payment_gateway_event_applications application
  WHERE application.gateway_event_id = v_event.id;

  IF FOUND THEN
    SELECT subscription.*
    INTO v_subscription
    FROM public.subscriptions subscription
    WHERE subscription.id = v_application.subscription_id;

    RETURN QUERY SELECT
      v_event.id,
      v_subscription.id,
      v_subscription.status,
      v_application.effect;
    RETURN;
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM target_processing_lease_token THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  IF v_event.provider = 'STRIPE' THEN
    IF v_event.event_type = 'customer.subscription.deleted'
       AND v_event.fact_lifecycle_state <> 'cancelled' THEN
      RAISE EXCEPTION 'Stripe deletion event can only cancel a subscription'
        USING ERRCODE = '23514';
    ELSIF v_event.event_type NOT IN (
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ) THEN
      RAISE EXCEPTION 'Stripe event is not authoritative for subscription lifecycle'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (v_event.event_type IN (
          'BILLING.SUBSCRIPTION.CANCELLED',
          'BILLING.SUBSCRIPTION.EXPIRED'
        ) AND v_event.fact_lifecycle_state <> 'cancelled')
       OR (v_event.event_type = 'BILLING.SUBSCRIPTION.SUSPENDED'
          AND v_event.fact_lifecycle_state <> 'incomplete')
       OR (v_event.event_type = 'BILLING.SUBSCRIPTION.ACTIVATED'
          AND v_event.fact_lifecycle_state <> 'active')
       OR v_event.event_type NOT IN (
          'BILLING.SUBSCRIPTION.ACTIVATED',
          'BILLING.SUBSCRIPTION.CANCELLED',
          'BILLING.SUBSCRIPTION.SUSPENDED',
          'BILLING.SUBSCRIPTION.EXPIRED',
          'BILLING.SUBSCRIPTION.UPDATED'
        ) THEN
      RAISE EXCEPTION 'PayPal lifecycle state does not match its provider event'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_event.fact_provider_subscription_id IS NULL
     OR v_event.fact_provider_customer_id IS NULL
     OR v_event.fact_lifecycle_state IS NULL THEN
    RAISE EXCEPTION 'Lifecycle event is missing immutable typed provider facts'
      USING ERRCODE = '23514';
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_event.sponsorship_intent_id
  FOR SHARE;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.sponsorship_intent_id = v_intent.id
    AND subscription.sponsorship_method = v_event.provider
    AND subscription.provider_account_scope = v_event.provider_account_scope
    AND subscription.provider_subscription_object_id = v_event.fact_provider_subscription_id
  LIMIT 1
  FOR UPDATE;

  PERFORM private.set_payment_audit_context(
    'apply_sponsorship_subscription_lifecycle',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  IF v_subscription.id IS NULL THEN
    UPDATE public.payment_gateway_events
    SET
      processing_status = 'failed',
      last_error = 'Awaiting first verified financial movement',
      available_at = clock_timestamp() + interval '1 minute',
      processing_lease_token = NULL
    WHERE id = v_event.id;

    RETURN QUERY SELECT
      v_event.id,
      NULL::uuid,
      NULL::public."SubscriptionStatus",
      NULL::public.gateway_event_application_effect;
    RETURN;
  END IF;

  IF v_event.fact_provider_customer_id IS DISTINCT FROM v_subscription.customer_id
     OR v_event.fact_provider_customer_id IS DISTINCT FROM (
       SELECT attempt.provider_customer_id
       FROM public.sponsorship_payment_attempts attempt
       WHERE attempt.id = v_event.payment_attempt_id
     )
     OR v_event.fact_provider_subscription_id IS DISTINCT FROM v_subscription.provider_subscription_object_id THEN
    RAISE EXCEPTION 'Lifecycle event does not match the exact materialized provider chain'
      USING ERRCODE = '23514';
  END IF;

  v_status := CASE
    WHEN v_event.fact_lifecycle_state = 'cancelled' THEN 'cancelled'::public."SubscriptionStatus"
    WHEN v_event.fact_lifecycle_state = 'active' AND v_intent.status = 'succeeded'
      THEN 'complete'::public."SubscriptionStatus"
    ELSE 'incomplete'::public."SubscriptionStatus"
  END;

  v_precedence := CASE v_event.fact_lifecycle_state
    WHEN 'cancelled' THEN 300
    WHEN 'incomplete' THEN 200
    ELSE 100
  END;

  IF v_subscription.last_provider_lifecycle_event_occurred_at IS NOT NULL
     AND (
       v_event.occurred_at < v_subscription.last_provider_lifecycle_event_occurred_at
       OR (
         v_event.occurred_at = v_subscription.last_provider_lifecycle_event_occurred_at
         AND v_precedence <= v_subscription.last_provider_lifecycle_event_precedence
       )
     ) THEN
    INSERT INTO public.payment_gateway_event_applications (
      gateway_event_id,
      effect,
      subscription_id,
      summary
    )
    VALUES (
      v_event.id,
      'ignored',
      v_subscription.id,
      jsonb_build_object(
        'provider', v_event.provider::text,
        'provider_account_scope', v_event.provider_account_scope,
        'event_type', v_event.event_type,
        'outcome', 'stale_lifecycle_event'
      )
    );

    UPDATE public.payment_gateway_events
    SET
      processing_status = 'ignored',
      ignored_reason = 'Stale provider lifecycle event',
      processing_lease_token = NULL
    WHERE id = v_event.id;

    RETURN QUERY SELECT
      v_event.id,
      v_subscription.id,
      v_subscription.status,
      'ignored'::public.gateway_event_application_effect;
    RETURN;
  END IF;

  UPDATE public.subscriptions
  SET
    status = v_status,
    current_period_start = COALESCE(
      v_event.fact_period_start AT TIME ZONE 'UTC',
      current_period_start
    ),
    current_period_end = COALESCE(
      v_event.fact_period_end AT TIME ZONE 'UTC',
      current_period_end
    ),
    canceled_at = CASE
      WHEN v_status = 'cancelled' THEN v_event.occurred_at AT TIME ZONE 'UTC'
      ELSE NULL
    END,
    last_provider_lifecycle_event_occurred_at = v_event.occurred_at,
    last_provider_lifecycle_event_precedence = v_precedence,
    last_provider_lifecycle_event_id = v_event.provider_event_id
  WHERE id = v_subscription.id
  RETURNING * INTO v_subscription;

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    subscription_id,
    summary
  )
  VALUES (
    v_event.id,
    'subscription_lifecycle',
    v_subscription.id,
    jsonb_build_object(
      'provider', v_event.provider::text,
      'provider_account_scope', v_event.provider_account_scope,
      'event_type', v_event.event_type,
      'outcome', v_event.fact_lifecycle_state
    )
  );

  UPDATE public.payment_gateway_events
  SET
    processing_status = 'processed',
    processing_lease_token = NULL
  WHERE id = v_event.id;

  RETURN QUERY SELECT
    v_event.id,
    v_subscription.id,
    v_subscription.status,
    'subscription_lifecycle'::public.gateway_event_application_effect;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_sponsor_account_email_verification(
  target_auth_user_id uuid,
  target_email_hmac bytea,
  target_email_normalization_version smallint DEFAULT 1,
  target_email_hmac_key_version smallint DEFAULT 1,
  target_valid_for interval DEFAULT interval '10 minutes',
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS public.sponsor_account_email_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_proof public.sponsor_account_email_verifications%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF octet_length(target_email_hmac) IS DISTINCT FROM 32
     OR target_email_normalization_version IS DISTINCT FROM 1
     OR target_email_hmac_key_version IS DISTINCT FROM 1
     OR target_valid_for IS NULL
     OR target_valid_for < interval '1 minute'
     OR target_valid_for > interval '15 minutes' THEN
    RAISE EXCEPTION 'Account email verification proof input is malformed or unsupported'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM auth.users auth_user
  JOIN public.users application_user ON application_user.id = auth_user.id
  WHERE auth_user.id = target_auth_user_id
    AND auth_user.email_confirmed_at IS NOT NULL
    AND nullif(btrim(auth_user.email), '') IS NOT NULL
  FOR UPDATE OF auth_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Email verification proof requires a confirmed application user'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.sponsor_account_email_verifications proof
  SET status = 'expired'
  WHERE proof.auth_user_id = target_auth_user_id
    AND proof.status = 'issued'
    AND proof.expires_at <= clock_timestamp();

  SELECT proof.*
  INTO v_proof
  FROM public.sponsor_account_email_verifications proof
  WHERE proof.auth_user_id = target_auth_user_id
    AND proof.status = 'issued'
  FOR UPDATE;

  IF FOUND THEN
    IF v_proof.email_hmac IS DISTINCT FROM target_email_hmac
       OR v_proof.normalization_version IS DISTINCT FROM target_email_normalization_version
       OR v_proof.hmac_key_version IS DISTINCT FROM target_email_hmac_key_version THEN
      RAISE EXCEPTION 'An unexpired proof already binds this account to another email digest'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_proof;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_effective_user_id => target_auth_user_id,
    context_system_actor => 'account_email_verifier',
    context_tool => 'issue_sponsor_account_email_verification',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Application verified confirmed auth email and computed canonical HMAC',
    context_metadata => jsonb_build_object(
      'operation', 'issue_email_proof',
      'resource_kind', 'sponsor_account_email_verification',
      'resource_id', target_auth_user_id::text,
      'outcome', 'issued'
    )
  );

  INSERT INTO public.sponsor_account_email_verifications (
    auth_user_id,
    issuer_scope,
    email_hmac,
    normalization_version,
    hmac_key_version,
    expires_at
  )
  VALUES (
    target_auth_user_id,
    'creator_share',
    target_email_hmac,
    1,
    1,
    clock_timestamp() + target_valid_for
  )
  RETURNING * INTO v_proof;

  RETURN v_proof;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_sponsorship_account_claim(
  target_claim_token_digest bytea,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  account_claim_id uuid,
  sponsor_identity_id uuid,
  auth_user_id uuid,
  linked_subscription_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_claim public.sponsorship_account_claims%ROWTYPE;
  v_identity public.sponsor_identities%ROWTYPE;
  v_identifier public.sponsor_identifiers%ROWTYPE;
  v_proof public.sponsor_account_email_verifications%ROWTYPE;
  v_target_auth_user_id uuid := auth.uid();
  v_linked_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_target_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Account claim consumption requires the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  IF octet_length(target_claim_token_digest) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Account claim token digest is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users auth_user
    JOIN public.users application_user ON application_user.id = auth_user.id
    WHERE auth_user.id = v_target_auth_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
      AND nullif(btrim(auth_user.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account claim requires a confirmed application user'
      USING ERRCODE = '23514';
  END IF;

  SELECT claim.*
  INTO v_claim
  FROM public.sponsorship_account_claims claim
  WHERE claim.token_digest = target_claim_token_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account claim token is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_claim.status = 'consumed'
     AND v_claim.target_auth_user_id = v_target_auth_user_id THEN
    SELECT count(*)::integer
    INTO v_linked_count
    FROM public.subscriptions subscription
    WHERE subscription.sponsor_identity_id = v_claim.sponsor_identity_id
      AND subscription.user_id = v_target_auth_user_id;

    RETURN QUERY SELECT
      v_claim.id,
      v_claim.sponsor_identity_id,
      v_target_auth_user_id,
      v_linked_count;
    RETURN;
  END IF;

  IF v_claim.status <> 'pending'
     OR v_claim.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Account claim is no longer available'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.sponsor_account_email_verifications proof
  SET status = 'expired'
  WHERE proof.auth_user_id = v_target_auth_user_id
    AND proof.status = 'issued'
    AND proof.expires_at <= clock_timestamp();

  SELECT proof.*
  INTO v_proof
  FROM public.sponsor_account_email_verifications proof
  WHERE proof.auth_user_id = v_target_auth_user_id
    AND proof.issuer_scope = 'creator_share'
    AND proof.email_hmac = v_claim.email_hmac
    AND proof.normalization_version = v_claim.email_normalization_version
    AND proof.hmac_key_version = v_claim.email_hmac_key_version
    AND proof.status = 'issued'
    AND proof.expires_at > clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified account email does not match the account claim'
      USING ERRCODE = '23514';
  END IF;

  SELECT identity.*
  INTO v_identity
  FROM public.sponsor_identities identity
  WHERE identity.id = v_claim.sponsor_identity_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_identity.status <> 'active'
     OR (
       v_identity.auth_user_id IS NOT NULL
       AND v_identity.auth_user_id <> v_target_auth_user_id
     ) THEN
    RAISE EXCEPTION 'Sponsor identity cannot attach to this account'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sponsor_identities identity
    WHERE identity.auth_user_id = v_target_auth_user_id
      AND identity.id <> v_identity.id
  ) THEN
    RAISE EXCEPTION 'Account already owns another sponsor identity'
      USING ERRCODE = '23505';
  END IF;

  SELECT identifier.*
  INTO v_identifier
  FROM public.sponsor_identifiers identifier
  WHERE identifier.sponsor_identity_id = v_identity.id
    AND identifier.kind = 'email'
    AND identifier.issuer_scope = 'creator_share'
    AND identifier.identifier_digest = v_proof.email_hmac
    AND identifier.normalization_version = 1
    AND identifier.hmac_key_version = 1
    AND identifier.revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor identity is missing its canonical email identifier'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user',
    context_actor_user_id => v_target_auth_user_id,
    context_effective_user_id => v_target_auth_user_id,
    context_tool => 'consume_sponsorship_account_claim',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_client_ip => context_client_ip,
    context_user_agent => context_user_agent,
    context_reason => 'Verified email account claim',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'sponsor_identity',
      'resource_id', v_identity.id::text,
      'outcome', 'verified'
    )
  );

  IF v_identifier.confidence <> 'verified' THEN
    UPDATE public.sponsor_identifiers
    SET
      confidence = 'verified',
      last_seen_at = clock_timestamp()
    WHERE id = v_identifier.id;
  END IF;

  IF v_identity.auth_user_id IS NULL THEN
    UPDATE public.sponsor_identities
    SET auth_user_id = v_target_auth_user_id
    WHERE id = v_identity.id;
  END IF;

  UPDATE public.sponsor_account_email_verifications
  SET status = 'consumed'
  WHERE id = v_proof.id;

  UPDATE public.sponsorship_account_claims
  SET
    status = 'consumed',
    target_auth_user_id = v_target_auth_user_id
  WHERE id = v_claim.id
  RETURNING * INTO v_claim;

  UPDATE public.sponsorship_intents
  SET auth_user_id = v_target_auth_user_id
  WHERE sponsor_identity_id = v_identity.id
    AND auth_user_id IS NULL;

  UPDATE public.subscriptions
  SET user_id = v_target_auth_user_id
  WHERE sponsor_identity_id = v_identity.id
    AND user_id IS NULL;

  GET DIAGNOSTICS v_linked_count = ROW_COUNT;

  RETURN QUERY SELECT
    v_claim.id,
    v_identity.id,
    v_target_auth_user_id,
    v_linked_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.ignore_sponsorship_payment_gateway_event(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  target_ignored_reason text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS public.payment_gateway_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF nullif(btrim(target_ignored_reason), '') IS NULL
     OR length(target_ignored_reason) > 1000 THEN
    RAISE EXCEPTION 'Ignored event reason must contain 1 to 1000 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_event.processing_status IN ('processed', 'ignored') THEN
    RETURN v_event;
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM target_processing_lease_token THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM private.set_payment_audit_context(
    'ignore_sponsorship_payment_gateway_event',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    summary
  )
  VALUES (
    v_event.id,
    'ignored',
    jsonb_build_object(
      'provider', v_event.provider::text,
      'provider_account_scope', v_event.provider_account_scope,
      'event_type', v_event.event_type,
      'outcome', 'ignored'
    )
  );

  UPDATE public.payment_gateway_events
  SET
    processing_status = 'ignored',
    ignored_reason = target_ignored_reason,
    processing_lease_token = NULL
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_sponsorship_payment_gateway_event(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  target_error_summary text,
  target_retry_delay interval DEFAULT interval '1 minute',
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS public.payment_gateway_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF nullif(btrim(target_error_summary), '') IS NULL
     OR length(target_error_summary) > 2000
     OR target_retry_delay < interval '1 second'
     OR target_retry_delay > interval '1 day' THEN
    RAISE EXCEPTION 'Gateway retry input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM target_processing_lease_token THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM private.set_payment_audit_context(
    'retry_sponsorship_payment_gateway_event',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  UPDATE public.payment_gateway_events
  SET
    processing_status = 'failed',
    last_error = target_error_summary,
    available_at = clock_timestamp() + target_retry_delay,
    processing_lease_token = NULL
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN v_event;
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
REVOKE ALL ON FUNCTION public.begin_sponsorship_payment(
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_sponsorship_checkout_status(
  bytea
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attach_sponsorship_payment_provider_object(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_sponsorship_checkout_reservation(
  uuid,
  text,
  timestamptz,
  bytea,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ingest_verified_payment_gateway_event(
  uuid,
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
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_payment_gateway_events(
  text,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_sponsorship_payment_success(
  uuid,
  uuid,
  bytea,
  bytea,
  smallint,
  bytea,
  text,
  jsonb,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_sponsorship_payment_failure(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_sponsorship_subscription_lifecycle(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_sponsor_account_email_verification(
  uuid,
  bytea,
  smallint,
  smallint,
  interval,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_sponsorship_account_claim(
  bytea,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ignore_sponsorship_payment_gateway_event(
  uuid,
  uuid,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retry_sponsorship_payment_gateway_event(
  uuid,
  uuid,
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
GRANT EXECUTE ON FUNCTION public.begin_sponsorship_payment(
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_sponsorship_checkout_status(
  bytea
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_sponsorship_payment_provider_object(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_sponsorship_checkout_reservation(
  uuid,
  text,
  timestamptz,
  bytea,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_verified_payment_gateway_event(
  uuid,
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
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payment_gateway_events(
  text,
  integer,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sponsorship_payment_success(
  uuid,
  uuid,
  bytea,
  bytea,
  smallint,
  bytea,
  text,
  jsonb,
  text,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sponsorship_payment_failure(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sponsorship_subscription_lifecycle(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_sponsor_account_email_verification(
  uuid,
  bytea,
  smallint,
  smallint,
  interval,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_sponsorship_account_claim(
  bytea,
  text,
  text,
  text,
  text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ignore_sponsorship_payment_gateway_event(
  uuid,
  uuid,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_sponsorship_payment_gateway_event(
  uuid,
  uuid,
  text,
  interval,
  text,
  text
) TO service_role;

COMMENT ON TABLE public.payment_provider_object_links IS
  'Append only map from provider objects to exactly one server owned payment attempt and provider account scope.';
COMMENT ON TABLE public.sponsorship_payment_quotes IS
  'Immutable server issued checkout terms, including the exact provider scope, conversion basis, amount, recurrence, and bounded validity period.';
COMMENT ON TABLE public.sponsorship_checkout_reservations IS
  'Provider reconciled checkout reservation for a fixed sponsorship beneficiary. Time passing alone never releases an active reservation.';
COMMENT ON TABLE public.sponsorship_financial_movements IS
  'Canonical idempotent record of verified Stripe or PayPal financial movements. Provider lifecycle events do not create rows here.';
COMMENT ON TABLE public.sponsorship_refund_requirements IS
  'Immutable operational exception requiring a refund when a verified payment arrives without a valid fixed beneficiary reservation.';
COMMENT ON TABLE public.payment_gateway_event_applications IS
  'One immutable application result per verified gateway event, committed in the same transaction as all downstream payment effects.';
COMMENT ON TABLE public.sponsor_account_email_verifications IS
  'Short lived one use proof that a confirmed authenticated account controls the canonical email HMAC used by a sponsorship account claim.';
COMMENT ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) IS
  'Issues immutable provider specific checkout terms after revalidating sponsorship eligibility and live payment readiness.';
COMMENT ON FUNCTION public.read_sponsorship_checkout_status(bytea) IS
  'Returns only minimal terminal status for an opaque high entropy checkout receipt digest.';
COMMENT ON FUNCTION public.apply_sponsorship_payment_success(
  uuid,
  uuid,
  bytea,
  bytea,
  smallint,
  bytea,
  text,
  jsonb,
  text,
  text,
  text,
  text
) IS
  'Atomically applies one verified provider financial fact to the immutable intent, attribution, subscription, ledger, account claim, and single sponsor welcome email.';

COMMIT;

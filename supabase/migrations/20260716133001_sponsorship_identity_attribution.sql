BEGIN;

/*
 * Attribution policy is versioned so every immutable decision can name the
 * exact rule that produced it. The first release intentionally fixes these
 * durations. A future policy requires a new migration and a new policy row.
 */

DO $$ BEGIN
  CREATE TYPE public.visitor_consent_state AS ENUM (
    'unknown',
    'granted',
    'denied',
    'not_required'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsor_identity_status AS ENUM (
    'active',
    'merged',
    'erased'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsor_identifier_kind AS ENUM (
    'email',
    'stripe_customer',
    'paypal_payer',
    'external'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsor_identifier_confidence AS ENUM (
    'unverified',
    'provider_asserted',
    'verified'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_intent_source AS ENUM (
    'primary_site',
    'advocate_domain'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_intent_status AS ENUM (
    'created',
    'committed',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_payment_mode AS ENUM (
    'one_time',
    'recurring'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_subject_kind AS ENUM (
    'standard',
    'blind',
    'partnership'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_provider_account_status AS ENUM (
    'active',
    'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_attribution_kind AS ENUM (
    'direct',
    'post_visit_attributed',
    'post_visit_observed',
    'unattributed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_payment_attempt_status AS ENUM (
    'created',
    'pending',
    'succeeded',
    'failed',
    'cancelled',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.gateway_event_processing_status AS ENUM (
    'received',
    'processing',
    'processed',
    'failed',
    'ignored'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_account_claim_status AS ENUM (
    'pending',
    'consumed',
    'expired',
    'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.email_outbox_status AS ENUM (
    'pending',
    'processing',
    'sent',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.email_outbox_kind AS ENUM (
    'sponsor_welcome'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.sponsorship_attribution_policies (
  version text PRIMARY KEY,
  official_window_days smallint NOT NULL DEFAULT 30,
  observed_window_days smallint NOT NULL DEFAULT 365,
  visitor_token_retention_days smallint NOT NULL DEFAULT 400,
  effective_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_attribution_policies_version_check
    CHECK (version = btrim(version) AND length(version) BETWEEN 1 AND 80),
  CONSTRAINT sponsorship_attribution_policies_official_window_check
    CHECK (official_window_days = 30),
  CONSTRAINT sponsorship_attribution_policies_observed_window_check
    CHECK (observed_window_days = 365),
  CONSTRAINT sponsorship_attribution_policies_retention_check
    CHECK (visitor_token_retention_days = 400),
  CONSTRAINT sponsorship_attribution_policies_window_order_check
    CHECK (
      official_window_days < observed_window_days
      AND observed_window_days < visitor_token_retention_days
    )
);

CREATE UNIQUE INDEX sponsorship_attribution_policies_one_active_uidx
  ON public.sponsorship_attribution_policies (is_active)
  WHERE is_active;

INSERT INTO public.sponsorship_attribution_policies (
  version,
  official_window_days,
  observed_window_days,
  visitor_token_retention_days,
  effective_at,
  is_active
)
VALUES (
  '2026-07-16-v1',
  30,
  365,
  400,
  '2026-07-16 00:00:00+00'::timestamptz,
  true
);

CREATE TABLE public.payment_provider_accounts (
  provider public.sponsorship_method NOT NULL,
  scope text NOT NULL,
  status public.payment_provider_account_status NOT NULL DEFAULT 'active',
  stripe_region public.stripe_region,
  environment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, scope),
  CONSTRAINT payment_provider_accounts_scope_check CHECK (
    scope = lower(btrim(scope))
    AND length(scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT payment_provider_accounts_environment_check CHECK (
    environment IN ('configured', 'test', 'live', 'sandbox')
  ),
  CONSTRAINT payment_provider_accounts_region_check CHECK (
    (provider = 'STRIPE' AND stripe_region IS NOT NULL)
    OR (provider = 'PAYPAL' AND stripe_region IS NULL)
  )
);

INSERT INTO public.payment_provider_accounts (
  provider,
  scope,
  stripe_region,
  environment
)
VALUES
  ('STRIPE', 'stripe_us', 'us', 'configured'),
  ('STRIPE', 'stripe_uk', 'uk', 'configured'),
  ('PAYPAL', 'paypal', NULL, 'configured');

CREATE TABLE public.browser_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_digest bytea NOT NULL UNIQUE,
  policy_version text NOT NULL DEFAULT '2026-07-16-v1'
    REFERENCES public.sponsorship_attribution_policies(version),
  consent_state public.visitor_consent_state NOT NULL DEFAULT 'unknown',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL DEFAULT (now() + interval '400 days'),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT browser_visitors_token_digest_check
    CHECK (octet_length(token_digest) = 32),
  CONSTRAINT browser_visitors_seen_order_check
    CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT browser_visitors_retention_check
    CHECK (retention_expires_at = last_seen_at + interval '400 days'),
  CONSTRAINT browser_visitors_revocation_check
    CHECK (
      (revoked_at IS NULL AND revocation_reason IS NULL)
      OR
      (revoked_at IS NOT NULL AND nullif(btrim(revocation_reason), '') IS NOT NULL)
    )
);

CREATE INDEX browser_visitors_retention_expires_at_idx
  ON public.browser_visitors (retention_expires_at);

CREATE TABLE public.sponsor_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.sponsor_identity_status NOT NULL DEFAULT 'active',
  merged_into_id uuid REFERENCES public.sponsor_identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsor_identities_merge_shape_check
    CHECK (
      (status = 'merged' AND merged_into_id IS NOT NULL)
      OR
      (status IN ('active', 'erased') AND merged_into_id IS NULL)
    ),
  CONSTRAINT sponsor_identities_no_self_merge_check
    CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);

CREATE UNIQUE INDEX sponsor_identities_auth_user_id_uidx
  ON public.sponsor_identities (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX sponsor_identities_merged_into_id_idx
  ON public.sponsor_identities (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

CREATE TABLE public.sponsor_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_identity_id uuid NOT NULL
    REFERENCES public.sponsor_identities(id) ON DELETE RESTRICT,
  kind public.sponsor_identifier_kind NOT NULL,
  issuer_scope text NOT NULL,
  identifier_digest bytea NOT NULL,
  normalization_version smallint NOT NULL DEFAULT 1,
  hmac_key_version smallint NOT NULL DEFAULT 1,
  confidence public.sponsor_identifier_confidence NOT NULL,
  verified_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsor_identifiers_scope_check
    CHECK (
      issuer_scope = lower(btrim(issuer_scope))
      AND length(issuer_scope) BETWEEN 1 AND 120
    ),
  CONSTRAINT sponsor_identifiers_digest_check
    CHECK (octet_length(identifier_digest) = 32),
  CONSTRAINT sponsor_identifiers_version_check
    CHECK (normalization_version > 0 AND hmac_key_version > 0),
  CONSTRAINT sponsor_identifiers_email_scope_check CHECK (
    kind <> 'email'
    OR (
      issuer_scope = 'creator_share'
      AND normalization_version = 1
      AND hmac_key_version = 1
    )
  ),
  CONSTRAINT sponsor_identifiers_verified_check
    CHECK (
      (confidence = 'verified' AND verified_at IS NOT NULL)
      OR confidence IN ('unverified', 'provider_asserted')
    ),
  CONSTRAINT sponsor_identifiers_seen_order_check
    CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT sponsor_identifiers_revocation_check CHECK (
    (revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (
      revoked_at IS NOT NULL
      AND revoked_at >= first_seen_at
      AND nullif(btrim(revocation_reason), '') IS NOT NULL
    )
  ),
  CONSTRAINT sponsor_identifiers_scoped_value_unique
    UNIQUE (kind, issuer_scope, identifier_digest)
);

CREATE INDEX sponsor_identifiers_identity_idx
  ON public.sponsor_identifiers (sponsor_identity_id, kind)
  WHERE revoked_at IS NULL;

CREATE TABLE public.advocate_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL
    REFERENCES public.advocates(id) ON DELETE RESTRICT,
  advocate_domain_id uuid NOT NULL,
  browser_visitor_id uuid
    REFERENCES public.browser_visitors(id) ON DELETE CASCADE,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL DEFAULT (now() + interval '400 days'),
  is_qualified boolean NOT NULL DEFAULT false,
  exclusion_reason text DEFAULT 'consent_pending',
  consent_state public.visitor_consent_state NOT NULL DEFAULT 'unknown',
  page_path text NOT NULL DEFAULT '/',
  referrer_host text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT advocate_exposures_domain_advocate_fkey
    FOREIGN KEY (advocate_domain_id, advocate_id)
    REFERENCES public.advocate_domains(id, advocate_id)
    ON DELETE RESTRICT,
  CONSTRAINT advocate_exposures_qualification_check
    CHECK (
      (is_qualified AND exclusion_reason IS NULL)
      OR
      (NOT is_qualified AND nullif(btrim(exclusion_reason), '') IS NOT NULL)
    ),
  CONSTRAINT advocate_exposures_consent_check CHECK (
    NOT is_qualified OR consent_state IN ('granted', 'not_required')
  ),
  CONSTRAINT advocate_exposures_retention_check CHECK (
    retention_expires_at = occurred_at + interval '400 days'
  ),
  CONSTRAINT advocate_exposures_page_path_check
    CHECK (
      page_path LIKE '/%'
      AND position('?' IN page_path) = 0
      AND position('#' IN page_path) = 0
      AND length(page_path) <= 500
    ),
  CONSTRAINT advocate_exposures_referrer_host_check
    CHECK (
      referrer_host IS NULL
      OR (
        referrer_host = lower(btrim(referrer_host))
        AND position('/' IN referrer_host) = 0
        AND length(referrer_host) <= 253
      )
    ),
  CONSTRAINT advocate_exposures_context_check
    CHECK (jsonb_typeof(context) = 'object')
);

CREATE INDEX advocate_exposures_advocate_time_idx
  ON public.advocate_exposures (advocate_id, occurred_at DESC)
  WHERE is_qualified;

CREATE INDEX advocate_exposures_domain_time_idx
  ON public.advocate_exposures (advocate_domain_id, occurred_at DESC)
  WHERE is_qualified;

CREATE INDEX advocate_exposures_visitor_time_idx
  ON public.advocate_exposures (browser_visitor_id, occurred_at DESC)
  WHERE is_qualified AND browser_visitor_id IS NOT NULL;

CREATE INDEX advocate_exposures_auth_user_time_idx
  ON public.advocate_exposures (auth_user_id, occurred_at DESC)
  WHERE is_qualified AND auth_user_id IS NOT NULL;

CREATE INDEX advocate_exposures_retention_expires_at_idx
  ON public.advocate_exposures (retention_expires_at, id);

CREATE TABLE public.sponsorship_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  source public.sponsorship_intent_source NOT NULL,
  source_host text NOT NULL,
  source_advocate_id uuid REFERENCES public.advocates(id) ON DELETE RESTRICT,
  source_advocate_domain_id uuid,
  browser_visitor_id uuid
    REFERENCES public.browser_visitors(id) ON DELETE SET NULL,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sponsor_identity_id uuid
    REFERENCES public.sponsor_identities(id) ON DELETE SET NULL,
  attribution_policy_version text NOT NULL DEFAULT '2026-07-16-v1'
    REFERENCES public.sponsorship_attribution_policies(version) ON DELETE RESTRICT,
  contact_email_hmac bytea NOT NULL,
  contact_email_normalization_version smallint NOT NULL,
  contact_email_hmac_key_version smallint NOT NULL,
  subject_kind public.sponsorship_subject_kind NOT NULL,
  beneficiary_id uuid REFERENCES public.beneficiaries(id) ON DELETE RESTRICT,
  partnership_project public.project_type,
  payment_mode public.sponsorship_payment_mode NOT NULL,
  recurrence_interval text,
  base_amount_usd_cents bigint NOT NULL,
  charged_amount_minor bigint NOT NULL,
  charged_currency public.payment_currency NOT NULL,
  conversion_rate numeric(18, 8) NOT NULL,
  currency_quote_at timestamptz NOT NULL,
  currency_rate_source text NOT NULL,
  status public.sponsorship_intent_status NOT NULL DEFAULT 'created',
  committed_at timestamptz,
  succeeded_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_intents_domain_advocate_fkey
    FOREIGN KEY (source_advocate_domain_id, source_advocate_id)
    REFERENCES public.advocate_domains(id, advocate_id)
    ON DELETE RESTRICT,
  CONSTRAINT sponsorship_intents_idempotency_key_check
    CHECK (
      idempotency_key = btrim(idempotency_key)
      AND length(idempotency_key) BETWEEN 16 AND 200
    ),
  CONSTRAINT sponsorship_intents_source_check
    CHECK (
      (
        source = 'primary_site'
        AND source_advocate_id IS NULL
        AND source_advocate_domain_id IS NULL
      )
      OR
      (
        source = 'advocate_domain'
        AND source_advocate_id IS NOT NULL
        AND source_advocate_domain_id IS NOT NULL
      )
    ),
  CONSTRAINT sponsorship_intents_source_host_check
    CHECK (
      source_host = lower(btrim(source_host))
      AND position('/' IN source_host) = 0
      AND position(':' IN source_host) = 0
      AND length(source_host) BETWEEN 1 AND 253
      AND (
        source <> 'primary_site'
        OR source_host IN ('creatorshare.com', 'www.creatorshare.com')
      )
    ),
  CONSTRAINT sponsorship_intents_contact_email_hmac_check CHECK (
    octet_length(contact_email_hmac) = 32
    AND contact_email_normalization_version > 0
    AND contact_email_hmac_key_version > 0
  ),
  CONSTRAINT sponsorship_intents_account_identity_check CHECK (
    auth_user_id IS NULL OR sponsor_identity_id IS NOT NULL
  ),
  CONSTRAINT sponsorship_intents_subject_check
    CHECK (
      (
        subject_kind = 'standard'
        AND beneficiary_id IS NOT NULL
        AND partnership_project IS NULL
      )
      OR
      (
        subject_kind = 'blind'
        AND beneficiary_id IS NULL
        AND partnership_project IS NULL
      )
      OR
      (
        subject_kind = 'partnership'
        AND beneficiary_id IS NULL
        AND partnership_project IS NOT NULL
      )
    ),
  CONSTRAINT sponsorship_intents_recurrence_check
    CHECK (
      (payment_mode = 'one_time' AND recurrence_interval IS NULL)
      OR
      (payment_mode = 'recurring' AND recurrence_interval IN ('month', 'year'))
    ),
  CONSTRAINT sponsorship_intents_amount_check
    CHECK (base_amount_usd_cents > 0 AND charged_amount_minor > 0),
  CONSTRAINT sponsorship_intents_conversion_rate_check
    CHECK (conversion_rate > 0),
  CONSTRAINT sponsorship_intents_usd_conversion_check
    CHECK (
      charged_currency <> 'USD'
      OR (
        charged_amount_minor = base_amount_usd_cents
        AND conversion_rate = 1
      )
    ),
  CONSTRAINT sponsorship_intents_currency_source_check
    CHECK (nullif(btrim(currency_rate_source), '') IS NOT NULL),
  CONSTRAINT sponsorship_intents_status_time_check
    CHECK (
      (status = 'created' AND committed_at IS NULL)
      OR
      (status IN ('cancelled', 'expired'))
      OR
      (status NOT IN ('created', 'cancelled', 'expired') AND committed_at IS NOT NULL)
    ),
  CONSTRAINT sponsorship_intents_terminal_time_check
    CHECK (
      (status = 'succeeded' AND succeeded_at IS NOT NULL)
      OR (status <> 'succeeded' AND succeeded_at IS NULL)
    ),
  CONSTRAINT sponsorship_intents_failure_time_check
    CHECK (
      (status = 'failed' AND failed_at IS NOT NULL)
      OR (status <> 'failed' AND failed_at IS NULL)
    ),
  CONSTRAINT sponsorship_intents_cancellation_time_check
    CHECK (
      (status = 'cancelled' AND cancelled_at IS NOT NULL)
      OR (status <> 'cancelled' AND cancelled_at IS NULL)
    ),
  CONSTRAINT sponsorship_intents_expiry_time_check
    CHECK (
      (status = 'expired' AND expires_at IS NOT NULL)
      OR (status <> 'expired' AND expires_at IS NULL)
    ),
  CONSTRAINT sponsorship_intents_expiry_order_check
    CHECK (expires_at IS NULL OR expires_at >= created_at),
  CONSTRAINT sponsorship_intents_commit_order_check
    CHECK (committed_at IS NULL OR committed_at >= created_at),
  CONSTRAINT sponsorship_intents_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX sponsorship_intents_advocate_time_idx
  ON public.sponsorship_intents (source_advocate_id, created_at DESC)
  WHERE source_advocate_id IS NOT NULL;

CREATE INDEX sponsorship_intents_visitor_time_idx
  ON public.sponsorship_intents (browser_visitor_id, created_at DESC)
  WHERE browser_visitor_id IS NOT NULL;

CREATE INDEX sponsorship_intents_auth_user_time_idx
  ON public.sponsorship_intents (auth_user_id, created_at DESC)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX sponsorship_intents_sponsor_identity_time_idx
  ON public.sponsorship_intents (sponsor_identity_id, created_at DESC)
  WHERE sponsor_identity_id IS NOT NULL;

CREATE INDEX sponsorship_intents_status_time_idx
  ON public.sponsorship_intents (status, created_at);

CREATE TABLE public.sponsorship_attributions (
  sponsorship_intent_id uuid PRIMARY KEY
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  kind public.sponsorship_attribution_kind NOT NULL,
  policy_version text NOT NULL DEFAULT '2026-07-16-v1'
    REFERENCES public.sponsorship_attribution_policies(version) ON DELETE RESTRICT,
  advocate_id uuid REFERENCES public.advocates(id) ON DELETE RESTRICT,
  exposure_id uuid,
  exposure_lag interval,
  decision_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_attributions_shape_check
    CHECK (
      (
        kind = 'direct'
        AND advocate_id IS NOT NULL
        AND exposure_id IS NULL
        AND exposure_lag IS NULL
      )
      OR
      (
        kind IN ('post_visit_attributed', 'post_visit_observed')
        AND advocate_id IS NOT NULL
        AND exposure_id IS NOT NULL
        AND exposure_lag IS NOT NULL
        AND exposure_lag >= interval '0 seconds'
      )
      OR
      (
        kind = 'unattributed'
        AND advocate_id IS NULL
        AND exposure_id IS NULL
        AND exposure_lag IS NULL
      )
    ),
  CONSTRAINT sponsorship_attributions_context_check
    CHECK (jsonb_typeof(decision_context) = 'object')
);

CREATE INDEX sponsorship_attributions_advocate_kind_time_idx
  ON public.sponsorship_attributions (advocate_id, kind, decided_at DESC)
  WHERE advocate_id IS NOT NULL;

CREATE INDEX sponsorship_attributions_exposure_id_idx
  ON public.sponsorship_attributions (exposure_id)
  WHERE exposure_id IS NOT NULL;

CREATE TABLE public.sponsorship_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_intent_id uuid NOT NULL
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  attempt_number smallint NOT NULL,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  provider_object_type text,
  provider_object_id text,
  provider_idempotency_key text NOT NULL,
  status public.sponsorship_payment_attempt_status NOT NULL DEFAULT 'created',
  payment_mode public.sponsorship_payment_mode NOT NULL,
  base_amount_usd_cents bigint NOT NULL,
  charged_amount_minor bigint NOT NULL,
  charged_currency public.payment_currency NOT NULL,
  conversion_rate numeric(18, 8) NOT NULL,
  currency_quote_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_payment_attempts_number_check
    CHECK (attempt_number > 0),
  CONSTRAINT sponsorship_payment_attempts_scope_check
    CHECK (
      provider_account_scope = lower(btrim(provider_account_scope))
      AND length(provider_account_scope) BETWEEN 1 AND 120
    ),
  CONSTRAINT sponsorship_payment_attempts_provider_object_check
    CHECK (
      (provider_object_id IS NULL AND provider_object_type IS NULL)
      OR
      (
        nullif(btrim(provider_object_id), '') IS NOT NULL
        AND nullif(btrim(provider_object_type), '') IS NOT NULL
      )
    ),
  CONSTRAINT sponsorship_payment_attempts_idempotency_key_check
    CHECK (
      provider_idempotency_key = btrim(provider_idempotency_key)
      AND length(provider_idempotency_key) BETWEEN 16 AND 255
    ),
  CONSTRAINT sponsorship_payment_attempts_amount_check
    CHECK (base_amount_usd_cents > 0 AND charged_amount_minor > 0),
  CONSTRAINT sponsorship_payment_attempts_conversion_rate_check
    CHECK (conversion_rate > 0),
  CONSTRAINT sponsorship_payment_attempts_usd_conversion_check
    CHECK (
      charged_currency <> 'USD'
      OR (
        charged_amount_minor = base_amount_usd_cents
        AND conversion_rate = 1
      )
    ),
  CONSTRAINT sponsorship_payment_attempts_completion_check
    CHECK (
      (status = 'succeeded' AND completed_at IS NOT NULL)
      OR (status <> 'succeeded' AND completed_at IS NULL)
    ),
  CONSTRAINT sponsorship_payment_attempts_failure_check
    CHECK (
      (
        status = 'failed'
        AND failed_at IS NOT NULL
        AND nullif(btrim(failure_code), '') IS NOT NULL
      )
      OR
      (status <> 'failed' AND failed_at IS NULL)
    ),
  CONSTRAINT sponsorship_payment_attempts_expiry_check
    CHECK (
      (status = 'expired' AND expires_at IS NOT NULL)
      OR (status <> 'expired' AND expires_at IS NULL)
    ),
  CONSTRAINT sponsorship_payment_attempts_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT sponsorship_payment_attempts_provider_account_fkey
    FOREIGN KEY (provider, provider_account_scope)
    REFERENCES public.payment_provider_accounts(provider, scope)
    ON DELETE RESTRICT,
  CONSTRAINT sponsorship_payment_attempts_intent_attempt_unique
    UNIQUE (sponsorship_intent_id, attempt_number),
  CONSTRAINT sponsorship_payment_attempts_provider_key_unique
    UNIQUE (provider, provider_account_scope, provider_idempotency_key)
);

CREATE UNIQUE INDEX sponsorship_payment_attempts_provider_object_uidx
  ON public.sponsorship_payment_attempts (
    provider,
    provider_account_scope,
    provider_object_type,
    provider_object_id
  )
  WHERE provider_object_id IS NOT NULL;

CREATE INDEX sponsorship_payment_attempts_status_time_idx
  ON public.sponsorship_payment_attempts (status, started_at);

CREATE TABLE public.payment_gateway_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  provider_object_id text,
  sponsorship_intent_id uuid
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  payment_attempt_id uuid
    REFERENCES public.sponsorship_payment_attempts(id) ON DELETE RESTRICT,
  redacted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_ciphertext bytea,
  payload_sha256 bytea NOT NULL,
  payload_retention_expires_at timestamptz,
  payload_redacted_at timestamptz,
  signature_verified_at timestamptz NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_status public.gateway_event_processing_status NOT NULL DEFAULT 'received',
  processing_attempt_count smallint NOT NULL DEFAULT 0,
  max_processing_attempts smallint NOT NULL DEFAULT 12,
  processing_locked_at timestamptz,
  processing_locked_by text,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  ignored_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_gateway_events_scope_check
    CHECK (
      provider_account_scope = lower(btrim(provider_account_scope))
      AND length(provider_account_scope) BETWEEN 1 AND 120
    ),
  CONSTRAINT payment_gateway_events_event_id_check
    CHECK (
      provider_event_id = btrim(provider_event_id)
      AND length(provider_event_id) BETWEEN 1 AND 255
    ),
  CONSTRAINT payment_gateway_events_event_type_check
    CHECK (
      event_type = btrim(event_type)
      AND length(event_type) BETWEEN 1 AND 200
    ),
  CONSTRAINT payment_gateway_events_redacted_payload_check
    CHECK (jsonb_typeof(redacted_payload) = 'object'),
  CONSTRAINT payment_gateway_events_payload_digest_check
    CHECK (octet_length(payload_sha256) = 32),
  CONSTRAINT payment_gateway_events_payload_retention_check CHECK (
    (
      payload_ciphertext IS NULL
      AND payload_retention_expires_at IS NULL
      AND payload_redacted_at IS NULL
    )
    OR
    (
      payload_ciphertext IS NOT NULL
      AND octet_length(payload_ciphertext) > 0
      AND payload_retention_expires_at IS NOT NULL
      AND payload_redacted_at IS NULL
    )
    OR
    (
      payload_ciphertext IS NULL
      AND payload_retention_expires_at IS NOT NULL
      AND payload_redacted_at IS NOT NULL
      AND payload_redacted_at >= payload_retention_expires_at
    )
  ),
  CONSTRAINT payment_gateway_events_attempt_count_check
    CHECK (
      processing_attempt_count >= 0
      AND max_processing_attempts > 0
      AND processing_attempt_count <= max_processing_attempts
    ),
  CONSTRAINT payment_gateway_events_lease_check CHECK (
    (
      processing_status = 'processing'
      AND processing_locked_at IS NOT NULL
      AND nullif(btrim(processing_locked_by), '') IS NOT NULL
    )
    OR
    (
      processing_status <> 'processing'
      AND processing_locked_at IS NULL
      AND processing_locked_by IS NULL
    )
  ),
  CONSTRAINT payment_gateway_events_worker_check CHECK (
    processing_locked_by IS NULL OR length(btrim(processing_locked_by)) <= 200
  ),
  CONSTRAINT payment_gateway_events_status_check
    CHECK (
      (
        processing_status = 'processed'
        AND processed_at IS NOT NULL
        AND ignored_reason IS NULL
      )
      OR
      (
        processing_status = 'ignored'
        AND processed_at IS NOT NULL
        AND nullif(btrim(ignored_reason), '') IS NOT NULL
      )
      OR
      (
        processing_status = 'failed'
        AND processed_at IS NULL
        AND nullif(btrim(last_error), '') IS NOT NULL
      )
      OR processing_status IN ('received', 'processing')
    ),
  CONSTRAINT payment_gateway_events_provider_account_fkey
    FOREIGN KEY (provider, provider_account_scope)
    REFERENCES public.payment_provider_accounts(provider, scope)
    ON DELETE RESTRICT,
  CONSTRAINT payment_gateway_events_provider_event_unique
    UNIQUE (provider, provider_account_scope, provider_event_id)
);

CREATE INDEX payment_gateway_events_processing_idx
  ON public.payment_gateway_events (processing_status, available_at, received_at)
  WHERE processing_status IN ('received', 'failed');

CREATE INDEX payment_gateway_events_stale_lease_idx
  ON public.payment_gateway_events (processing_locked_at)
  WHERE processing_status = 'processing';

CREATE INDEX payment_gateway_events_intent_idx
  ON public.payment_gateway_events (sponsorship_intent_id, occurred_at)
  WHERE sponsorship_intent_id IS NOT NULL;

CREATE INDEX payment_gateway_events_attempt_idx
  ON public.payment_gateway_events (payment_attempt_id, occurred_at)
  WHERE payment_attempt_id IS NOT NULL;

CREATE TABLE public.sponsorship_account_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_intent_id uuid NOT NULL
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  requested_browser_visitor_id uuid
    REFERENCES public.browser_visitors(id) ON DELETE SET NULL,
  email_hmac bytea NOT NULL,
  email_normalization_version smallint NOT NULL DEFAULT 1,
  email_hmac_key_version smallint NOT NULL DEFAULT 1,
  token_digest bytea NOT NULL UNIQUE,
  status public.sponsorship_account_claim_status NOT NULL DEFAULT 'pending',
  target_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sponsor_identity_id uuid NOT NULL
    REFERENCES public.sponsor_identities(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_account_claims_email_hmac_check
    CHECK (
      octet_length(email_hmac) = 32
      AND email_normalization_version > 0
      AND email_hmac_key_version > 0
    ),
  CONSTRAINT sponsorship_account_claims_token_digest_check
    CHECK (octet_length(token_digest) = 32),
  CONSTRAINT sponsorship_account_claims_expiry_check
    CHECK (
      expires_at > requested_at
      AND expires_at <= requested_at + interval '7 days'
    ),
  CONSTRAINT sponsorship_account_claims_status_shape_check
    CHECK (
      (
        status = 'pending'
        AND target_auth_user_id IS NULL
        AND consumed_at IS NULL
        AND revoked_at IS NULL
        AND revocation_reason IS NULL
      )
      OR
      (
        status = 'consumed'
        AND consumed_at IS NOT NULL
        AND revoked_at IS NULL
        AND revocation_reason IS NULL
      )
      OR
      (
        status = 'expired'
        AND target_auth_user_id IS NULL
        AND consumed_at IS NULL
        AND revoked_at IS NULL
        AND revocation_reason IS NULL
      )
      OR
      (
        status = 'revoked'
        AND target_auth_user_id IS NULL
        AND consumed_at IS NULL
        AND revoked_at IS NOT NULL
        AND nullif(btrim(revocation_reason), '') IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX sponsorship_account_claims_one_pending_uidx
  ON public.sponsorship_account_claims (sponsorship_intent_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX sponsorship_account_claims_one_consumed_uidx
  ON public.sponsorship_account_claims (sponsorship_intent_id)
  WHERE status = 'consumed';

CREATE INDEX sponsorship_account_claims_expiry_idx
  ON public.sponsorship_account_claims (expires_at)
  WHERE status = 'pending';

CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.email_outbox_kind NOT NULL,
  account_claim_id uuid
    REFERENCES public.sponsorship_account_claims(id) ON DELETE RESTRICT,
  sponsor_identity_id uuid
    REFERENCES public.sponsor_identities(id) ON DELETE RESTRICT,
  dedupe_key text NOT NULL UNIQUE,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  template_key text NOT NULL,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_payload_ciphertext bytea,
  status public.email_outbox_status NOT NULL DEFAULT 'pending',
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 8,
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  provider_message_id text,
  email_log_id uuid REFERENCES public.email_logs(id) ON DELETE SET NULL,
  last_error text,
  cancelled_at timestamptz,
  contact_retention_expires_at timestamptz,
  contact_redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_dedupe_key_check
    CHECK (dedupe_key = btrim(dedupe_key) AND length(dedupe_key) BETWEEN 1 AND 255),
  CONSTRAINT email_outbox_recipient_check
    CHECK (
      (
        recipient_email_ciphertext IS NOT NULL
        AND octet_length(recipient_email_hmac) = 32
        AND email_normalization_version > 0
        AND email_hmac_key_version > 0
        AND email_encryption_key_version > 0
        AND secret_payload_ciphertext IS NOT NULL
        AND contact_redacted_at IS NULL
      )
      OR
      (
        recipient_email_ciphertext IS NULL
        AND recipient_email_hmac IS NULL
        AND email_normalization_version IS NULL
        AND email_hmac_key_version IS NULL
        AND email_encryption_key_version IS NULL
        AND secret_payload_ciphertext IS NULL
        AND contact_redacted_at IS NOT NULL
      )
    ),
  CONSTRAINT email_outbox_template_key_check
    CHECK (template_key = btrim(template_key) AND length(template_key) BETWEEN 1 AND 120),
  CONSTRAINT email_outbox_template_data_check
    CHECK (jsonb_typeof(template_data) = 'object'),
  CONSTRAINT email_outbox_subject_check
    CHECK (
      kind = 'sponsor_welcome'
      AND account_claim_id IS NOT NULL
      AND sponsor_identity_id IS NOT NULL
    ),
  CONSTRAINT email_outbox_attempt_count_check
    CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
  CONSTRAINT email_outbox_contact_retention_check CHECK (
    contact_retention_expires_at IS NULL
    OR contact_retention_expires_at >= created_at
  ),
  CONSTRAINT email_outbox_status_shape_check
    CHECK (
      (
        status = 'pending'
        AND locked_at IS NULL
        AND locked_by IS NULL
        AND sent_at IS NULL
        AND cancelled_at IS NULL
      )
      OR
      (
        status = 'processing'
        AND locked_at IS NOT NULL
        AND nullif(btrim(locked_by), '') IS NOT NULL
        AND sent_at IS NULL
        AND cancelled_at IS NULL
      )
      OR
      (
        status = 'sent'
        AND locked_at IS NULL
        AND locked_by IS NULL
        AND sent_at IS NOT NULL
        AND cancelled_at IS NULL
      )
      OR
      (
        status = 'failed'
        AND locked_at IS NULL
        AND locked_by IS NULL
        AND sent_at IS NULL
        AND cancelled_at IS NULL
        AND nullif(btrim(last_error), '') IS NOT NULL
      )
      OR
      (
        status = 'cancelled'
        AND locked_at IS NULL
        AND locked_by IS NULL
        AND sent_at IS NULL
        AND cancelled_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX email_outbox_account_claim_uidx
  ON public.email_outbox (account_claim_id)
  WHERE kind = 'sponsor_welcome';

CREATE UNIQUE INDEX email_outbox_sponsor_welcome_uidx
  ON public.email_outbox (sponsor_identity_id)
  WHERE kind = 'sponsor_welcome';

CREATE INDEX email_outbox_delivery_idx
  ON public.email_outbox (available_at, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.subscriptions
  ADD COLUMN sponsorship_intent_id uuid
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  ADD COLUMN sponsor_identity_id uuid
    REFERENCES public.sponsor_identities(id) ON DELETE SET NULL,
  ADD COLUMN payment_attempt_id uuid
    REFERENCES public.sponsorship_payment_attempts(id) ON DELETE RESTRICT;

ALTER TABLE public.transaction_ledger
  ADD COLUMN sponsorship_intent_id uuid
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  ADD COLUMN sponsor_identity_id uuid
    REFERENCES public.sponsor_identities(id) ON DELETE SET NULL,
  ADD COLUMN payment_attempt_id uuid
    REFERENCES public.sponsorship_payment_attempts(id) ON DELETE RESTRICT,
  ADD COLUMN gateway_event_id uuid
    REFERENCES public.payment_gateway_events(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX subscriptions_sponsorship_intent_uidx
  ON public.subscriptions (sponsorship_intent_id)
  WHERE sponsorship_intent_id IS NOT NULL;

CREATE UNIQUE INDEX subscriptions_payment_attempt_uidx
  ON public.subscriptions (payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;

CREATE INDEX subscriptions_sponsor_identity_idx
  ON public.subscriptions (sponsor_identity_id)
  WHERE sponsor_identity_id IS NOT NULL;

CREATE INDEX transaction_ledger_sponsorship_intent_idx
  ON public.transaction_ledger (sponsorship_intent_id, created_at)
  WHERE sponsorship_intent_id IS NOT NULL;

CREATE INDEX transaction_ledger_sponsor_identity_idx
  ON public.transaction_ledger (sponsor_identity_id, created_at)
  WHERE sponsor_identity_id IS NOT NULL;

CREATE INDEX transaction_ledger_payment_attempt_idx
  ON public.transaction_ledger (payment_attempt_id, created_at)
  WHERE payment_attempt_id IS NOT NULL;

CREATE UNIQUE INDEX transaction_ledger_gateway_event_uidx
  ON public.transaction_ledger (gateway_event_id)
  WHERE gateway_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.protect_sponsorship_attribution_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attribution policy rows cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version
     OR NEW.official_window_days IS DISTINCT FROM OLD.official_window_days
     OR NEW.observed_window_days IS DISTINCT FROM OLD.observed_window_days
     OR NEW.visitor_token_retention_days IS DISTINCT FROM OLD.visitor_token_retention_days
     OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Published attribution policy rules are immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_advocate_exposure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_visitor public.browser_visitors%ROWTYPE;
  v_domain_status public.advocate_domain_status;
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
BEGIN
  NEW.occurred_at := clock_timestamp();
  NEW.recorded_at := NEW.occurred_at;
  NEW.retention_expires_at := NEW.occurred_at + interval '400 days';

  IF NEW.is_qualified
     AND NEW.browser_visitor_id IS NULL
     AND NEW.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'A qualified exposure requires a browser visitor or authenticated user'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_qualified
     AND NEW.consent_state NOT IN ('granted', 'not_required') THEN
    RAISE EXCEPTION 'A qualified exposure requires granted or not-required consent'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    domain.status,
    advocate.relationship_status,
    advocate.publication_status
  INTO
    v_domain_status,
    v_relationship_status,
    v_publication_status
  FROM public.advocate_domains domain
  JOIN public.advocates advocate ON advocate.id = domain.advocate_id
  WHERE domain.id = NEW.advocate_domain_id
    AND domain.advocate_id = NEW.advocate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exposure domain does not belong to the advocate'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.is_qualified AND (
    v_domain_status <> 'active'
    OR v_relationship_status <> 'active'
    OR v_publication_status <> 'active'
  ) THEN
    RAISE EXCEPTION 'Qualified exposure requires an active advocate portal and domain'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.browser_visitor_id IS NOT NULL THEN
    SELECT visitor.*
    INTO v_visitor
    FROM public.browser_visitors visitor
    WHERE visitor.id = NEW.browser_visitor_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Browser visitor does not exist'
        USING ERRCODE = '23503';
    END IF;

    IF v_visitor.revoked_at IS NOT NULL
       OR v_visitor.retention_expires_at <= NEW.occurred_at THEN
      RAISE EXCEPTION 'Browser visitor token is revoked or outside retention'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.consent_state IS DISTINCT FROM v_visitor.consent_state THEN
      RAISE EXCEPTION 'Exposure consent snapshot does not match browser visitor state'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.browser_visitors
    SET last_seen_at = NEW.occurred_at
    WHERE id = NEW.browser_visitor_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.prepare_browser_visitor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_seen_at := v_now;
    NEW.last_seen_at := v_now;
    NEW.retention_expires_at := v_now + interval '400 days';
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    NEW.revoked_at := NULL;
    NEW.revocation_reason := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.retention_expires_at > v_now THEN
      RAISE EXCEPTION 'Browser visitor cannot be deleted before retention expiry'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Browser visitor identity fields are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.revoked_at IS NOT NULL AND (
    NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
    OR NEW.consent_state IS DISTINCT FROM OLD.consent_state
    OR NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
    OR NEW.retention_expires_at IS DISTINCT FROM OLD.retention_expires_at
  ) THEN
    RAISE EXCEPTION 'Revoked browser visitors cannot be refreshed or changed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    IF nullif(btrim(NEW.revocation_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Browser visitor revocation requires a reason'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
       OR NEW.retention_expires_at IS DISTINCT FROM OLD.retention_expires_at THEN
      RAISE EXCEPTION 'Browser visitor revocation cannot also refresh retention'
        USING ERRCODE = '42501';
    END IF;
    NEW.revoked_at := v_now;
  END IF;

  IF NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN
    IF OLD.retention_expires_at <= v_now THEN
      RAISE EXCEPTION 'Expired browser visitors cannot be refreshed'
        USING ERRCODE = '22023';
    END IF;
    NEW.last_seen_at := v_now;
    NEW.retention_expires_at := v_now + interval '400 days';
  ELSIF NEW.retention_expires_at IS DISTINCT FROM OLD.retention_expires_at THEN
    RAISE EXCEPTION 'Browser visitor retention expiry is server managed'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_advocate_exposure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.auth_user_id IS NOT NULL
     AND NEW.auth_user_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM auth.users account
       WHERE account.id = OLD.auth_user_id
     )
     AND (to_jsonb(NEW) - 'auth_user_id') = (to_jsonb(OLD) - 'auth_user_id') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.retention_expires_at <= clock_timestamp() THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Advocate exposures are append-only until retention expiry'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_and_protect_sponsorship_intent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hostname text;
  v_domain_status public.advocate_domain_status;
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
  v_visitor public.browser_visitors%ROWTYPE;
  v_identity public.sponsor_identities%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_policy_version text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sponsorship intents cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'created'
       OR NEW.committed_at IS NOT NULL
       OR NEW.succeeded_at IS NOT NULL
       OR NEW.failed_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'A sponsorship intent must begin in the created state'
        USING ERRCODE = '23514';
    END IF;

    NEW.created_at := v_now;
    NEW.updated_at := v_now;

    SELECT policy.version
    INTO v_policy_version
    FROM public.sponsorship_attribution_policies policy
    WHERE policy.is_active
      AND policy.effective_at <= v_now
    ORDER BY policy.effective_at DESC, policy.version DESC
    LIMIT 1;

    IF v_policy_version IS NULL THEN
      RAISE EXCEPTION 'No active attribution policy is effective for this intent'
        USING ERRCODE = '55000';
    END IF;

    NEW.attribution_policy_version := v_policy_version;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.source_host IS DISTINCT FROM OLD.source_host
       OR NEW.source_advocate_id IS DISTINCT FROM OLD.source_advocate_id
       OR NEW.source_advocate_domain_id IS DISTINCT FROM OLD.source_advocate_domain_id
       OR NEW.attribution_policy_version IS DISTINCT FROM OLD.attribution_policy_version
       OR NEW.contact_email_hmac IS DISTINCT FROM OLD.contact_email_hmac
       OR NEW.contact_email_normalization_version IS DISTINCT FROM OLD.contact_email_normalization_version
       OR NEW.contact_email_hmac_key_version IS DISTINCT FROM OLD.contact_email_hmac_key_version
       OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
       OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
       OR NEW.partnership_project IS DISTINCT FROM OLD.partnership_project
       OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode
       OR NEW.recurrence_interval IS DISTINCT FROM OLD.recurrence_interval
       OR NEW.base_amount_usd_cents IS DISTINCT FROM OLD.base_amount_usd_cents
       OR NEW.charged_amount_minor IS DISTINCT FROM OLD.charged_amount_minor
       OR NEW.charged_currency IS DISTINCT FROM OLD.charged_currency
       OR NEW.conversion_rate IS DISTINCT FROM OLD.conversion_rate
       OR NEW.currency_quote_at IS DISTINCT FROM OLD.currency_quote_at
       OR NEW.currency_rate_source IS DISTINCT FROM OLD.currency_rate_source
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Sponsorship intent provenance and financial terms are immutable from creation'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.browser_visitor_id IS DISTINCT FROM OLD.browser_visitor_id
       AND NOT (
         OLD.browser_visitor_id IS NOT NULL
         AND NEW.browser_visitor_id IS NULL
         AND OLD.created_at + interval '400 days' <= v_now
       ) THEN
      RAISE EXCEPTION 'Intent browser provenance can only be unlinked after retention expiry'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.auth_user_id IS NOT NULL
       AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
      IF NEW.auth_user_id IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM auth.users account
           WHERE account.id = OLD.auth_user_id
         ) THEN
        RAISE EXCEPTION 'An attached authenticated user cannot be replaced or manually removed'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF OLD.sponsor_identity_id IS NOT NULL
       AND NEW.sponsor_identity_id IS DISTINCT FROM OLD.sponsor_identity_id THEN
      RAISE EXCEPTION 'An attached sponsor identity cannot be replaced or removed'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.committed_at IS NOT NULL
       AND NEW.committed_at IS DISTINCT FROM OLD.committed_at THEN
      RAISE EXCEPTION 'Intent commitment time is immutable once recorded'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS NOT DISTINCT FROM OLD.status AND (
      NEW.committed_at IS DISTINCT FROM OLD.committed_at
      OR NEW.succeeded_at IS DISTINCT FROM OLD.succeeded_at
      OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
      OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    ) THEN
      RAISE EXCEPTION 'Intent lifecycle timestamps require a legal status transition'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'created' AND NEW.status IN ('committed', 'cancelled', 'expired'))
      OR (OLD.status = 'committed' AND NEW.status IN ('processing', 'succeeded', 'failed', 'cancelled', 'expired'))
      OR (OLD.status = 'processing' AND NEW.status IN ('succeeded', 'failed', 'cancelled'))
      OR (OLD.status = 'failed' AND NEW.status = 'processing')
    ) THEN
      RAISE EXCEPTION 'Illegal sponsorship intent status transition from % to %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'committed' THEN
        NEW.committed_at := COALESCE(OLD.committed_at, v_now);
      ELSIF NEW.status = 'processing' THEN
        NEW.failed_at := NULL;
      ELSIF NEW.status = 'succeeded' THEN
        NEW.succeeded_at := v_now;
        NEW.failed_at := NULL;
        NEW.cancelled_at := NULL;
      ELSIF NEW.status = 'failed' THEN
        NEW.failed_at := v_now;
        NEW.succeeded_at := NULL;
        NEW.cancelled_at := NULL;
      ELSIF NEW.status = 'cancelled' THEN
        NEW.committed_at := OLD.committed_at;
        NEW.cancelled_at := v_now;
        NEW.succeeded_at := NULL;
        NEW.failed_at := NULL;
      ELSIF NEW.status = 'expired' THEN
        NEW.committed_at := OLD.committed_at;
        NEW.expires_at := v_now;
        NEW.succeeded_at := NULL;
        NEW.failed_at := NULL;
        NEW.cancelled_at := NULL;
      END IF;
    END IF;

    NEW.updated_at := v_now;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.browser_visitor_id IS NOT NULL THEN
    SELECT visitor.*
    INTO v_visitor
    FROM public.browser_visitors visitor
    WHERE visitor.id = NEW.browser_visitor_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Intent browser visitor does not exist'
        USING ERRCODE = '23503';
    END IF;

    IF v_visitor.revoked_at IS NOT NULL
       OR v_visitor.retention_expires_at <= v_now THEN
      RAISE EXCEPTION 'Intent browser visitor is revoked or outside retention'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.browser_visitors
    SET last_seen_at = v_now
    WHERE id = NEW.browser_visitor_id;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.sponsor_identity_id IS DISTINCT FROM OLD.sponsor_identity_id THEN
    IF NEW.sponsor_identity_id IS NOT NULL THEN
      SELECT identity.*
      INTO v_identity
      FROM public.sponsor_identities identity
      WHERE identity.id = NEW.sponsor_identity_id
      FOR SHARE;

      IF NOT FOUND OR v_identity.status <> 'active' THEN
        RAISE EXCEPTION 'Intent sponsor identity must be active'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.auth_user_id IS NOT NULL
         AND v_identity.auth_user_id IS DISTINCT FROM NEW.auth_user_id THEN
        RAISE EXCEPTION 'Intent account does not own the sponsor identity'
          USING ERRCODE = '23514';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.sponsor_identifiers identifier
        WHERE identifier.sponsor_identity_id = NEW.sponsor_identity_id
          AND identifier.kind = 'email'
          AND identifier.identifier_digest = NEW.contact_email_hmac
          AND identifier.normalization_version = NEW.contact_email_normalization_version
          AND identifier.hmac_key_version = NEW.contact_email_hmac_key_version
          AND identifier.revoked_at IS NULL
          AND (
            NEW.auth_user_id IS NULL
            OR identifier.confidence = 'verified'
          )
      ) THEN
        RAISE EXCEPTION 'Intent email does not belong to the sponsor identity'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Authenticated intents require a sponsor identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.source = 'advocate_domain' THEN
    SELECT
      domain.hostname,
      domain.status,
      advocate.relationship_status,
      advocate.publication_status
    INTO
      v_hostname,
      v_domain_status,
      v_relationship_status,
      v_publication_status
    FROM public.advocate_domains domain
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
    WHERE domain.id = NEW.source_advocate_domain_id
      AND domain.advocate_id = NEW.source_advocate_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Advocate source domain does not belong to the advocate'
        USING ERRCODE = '23503';
    END IF;

    IF NEW.source_host <> v_hostname THEN
      RAISE EXCEPTION 'Intent source host does not match the advocate domain'
        USING ERRCODE = '22023';
    END IF;

    IF v_domain_status <> 'active'
       OR v_relationship_status <> 'active'
       OR v_publication_status <> 'active' THEN
      RAISE EXCEPTION 'Advocate source portal and domain must be active'
      USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_and_protect_payment_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_expected_attempt smallint;
  v_account public.payment_provider_accounts%ROWTYPE;
  v_expected_region public.stripe_region;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment attempts cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT intent.*
    INTO v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = NEW.sponsorship_intent_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment attempt intent does not exist'
        USING ERRCODE = '23503';
    END IF;

    IF v_intent.status NOT IN ('created', 'committed', 'failed') THEN
      RAISE EXCEPTION 'Payment attempts cannot be created for the current intent state'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.sponsorship_payment_attempts active_attempt
      WHERE active_attempt.sponsorship_intent_id = NEW.sponsorship_intent_id
        AND active_attempt.status IN ('created', 'pending')
    ) THEN
      RAISE EXCEPTION 'Intent already has an active payment attempt'
        USING ERRCODE = '23514';
    END IF;

    SELECT account.*
    INTO v_account
    FROM public.payment_provider_accounts account
    WHERE account.provider = NEW.provider
      AND account.scope = NEW.provider_account_scope;

    IF NOT FOUND OR v_account.status <> 'active' THEN
      RAISE EXCEPTION 'Payment provider account is unavailable'
        USING ERRCODE = '23503';
    END IF;

    IF NEW.payment_mode IS DISTINCT FROM v_intent.payment_mode
       OR NEW.base_amount_usd_cents IS DISTINCT FROM v_intent.base_amount_usd_cents
       OR NEW.charged_amount_minor IS DISTINCT FROM v_intent.charged_amount_minor
       OR NEW.charged_currency IS DISTINCT FROM v_intent.charged_currency
       OR NEW.conversion_rate IS DISTINCT FROM v_intent.conversion_rate
       OR NEW.currency_quote_at IS DISTINCT FROM v_intent.currency_quote_at THEN
      RAISE EXCEPTION 'Payment attempt terms must exactly match the sponsorship intent'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.provider = 'STRIPE' THEN
      v_expected_region := CASE
        WHEN NEW.charged_currency IN ('USD', 'AUD') THEN 'us'::public.stripe_region
        ELSE 'uk'::public.stripe_region
      END;

      IF v_account.stripe_region IS DISTINCT FROM v_expected_region THEN
        RAISE EXCEPTION 'Stripe account region does not match the charged currency'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT (COALESCE(max(attempt.attempt_number), 0) + 1)::smallint
    INTO v_expected_attempt
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.sponsorship_intent_id = NEW.sponsorship_intent_id;

    IF NEW.attempt_number <> v_expected_attempt THEN
      RAISE EXCEPTION 'Payment attempt number must be the next sequence value'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status <> 'created'
       OR NEW.completed_at IS NOT NULL
       OR NEW.failed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Payment attempts must begin in the created state'
        USING ERRCODE = '23514';
    END IF;

    NEW.started_at := v_now;
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.sponsorship_intent_id IS DISTINCT FROM OLD.sponsorship_intent_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope
     OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
     OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode
     OR NEW.base_amount_usd_cents IS DISTINCT FROM OLD.base_amount_usd_cents
     OR NEW.charged_amount_minor IS DISTINCT FROM OLD.charged_amount_minor
     OR NEW.charged_currency IS DISTINCT FROM OLD.charged_currency
     OR NEW.conversion_rate IS DISTINCT FROM OLD.conversion_rate
     OR NEW.currency_quote_at IS DISTINCT FROM OLD.currency_quote_at
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'Payment attempt provenance and financial terms are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_object_id IS NOT NULL AND (
    NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id
    OR NEW.provider_object_type IS DISTINCT FROM OLD.provider_object_type
  ) THEN
    RAISE EXCEPTION 'Attached payment provider object is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_object_id IS NULL
     AND NEW.provider_object_id IS NOT NULL
     AND OLD.status NOT IN ('created', 'pending') THEN
    RAISE EXCEPTION 'A provider object can only attach before payment completion'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'created' AND NEW.status IN ('pending', 'cancelled', 'expired'))
    OR (OLD.status = 'pending' AND NEW.status IN ('succeeded', 'failed', 'cancelled', 'expired'))
  ) THEN
    RAISE EXCEPTION 'Illegal payment attempt status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status AND (
    NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
    OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'Payment attempt outcome fields require a legal status transition'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT intent.*
    INTO v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = NEW.sponsorship_intent_id
    FOR SHARE;

    IF NEW.status = 'succeeded' THEN
      IF NEW.provider_object_id IS NULL THEN
        RAISE EXCEPTION 'Successful payment attempts require a provider object'
          USING ERRCODE = '23514';
      END IF;
      IF v_intent.status NOT IN ('committed', 'processing', 'succeeded') THEN
        RAISE EXCEPTION 'Payment attempt cannot succeed before its intent is committed'
          USING ERRCODE = '23514';
      END IF;
      NEW.completed_at := v_now;
      NEW.failed_at := NULL;
      NEW.failure_code := NULL;
    ELSIF NEW.status = 'failed' THEN
      NEW.failed_at := v_now;
      NEW.completed_at := NULL;
      IF nullif(btrim(NEW.failure_code), '') IS NULL THEN
        RAISE EXCEPTION 'Failed payment attempts require a failure code'
        USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status = 'expired' THEN
      NEW.expires_at := v_now;
      NEW.completed_at := NULL;
      NEW.failed_at := NULL;
      NEW.failure_code := NULL;
    ELSE
      IF NEW.status = 'pending' AND NEW.provider_object_id IS NULL THEN
        RAISE EXCEPTION 'Pending payment attempts require a provider object'
          USING ERRCODE = '23514';
      END IF;
      NEW.completed_at := NULL;
      NEW.failed_at := NULL;
      NEW.failure_code := NULL;
    END IF;
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_sponsorship_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_exposure public.advocate_exposures%ROWTYPE;
  v_policy public.sponsorship_attribution_policies%ROWTYPE;
  v_latest_exposure_id uuid;
  v_official_window interval;
  v_observed_window interval;
  v_lag interval;
BEGIN
  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = NEW.sponsorship_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsorship intent does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM public.sponsorship_attribution_policies policy
  WHERE policy.version = NEW.policy_version;

  IF NOT FOUND
     OR NEW.policy_version <> v_intent.attribution_policy_version
     OR v_policy.effective_at > v_intent.created_at THEN
    RAISE EXCEPTION 'Attribution policy is unavailable for the intent time'
      USING ERRCODE = '22023';
  END IF;

  v_official_window := make_interval(days => v_policy.official_window_days);
  v_observed_window := make_interval(days => v_policy.observed_window_days);
  NEW.decided_at := clock_timestamp();

  IF NEW.kind = 'direct' THEN
    IF v_intent.source <> 'advocate_domain' THEN
      RAISE EXCEPTION 'Direct attribution requires an advocate-domain intent'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.exposure_id IS NOT NULL THEN
      RAISE EXCEPTION 'Direct attribution does not use a prior exposure'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.advocate_id IS NOT NULL
       AND NEW.advocate_id <> v_intent.source_advocate_id THEN
      RAISE EXCEPTION 'Direct attribution advocate does not match intent source'
        USING ERRCODE = '23514';
    END IF;

    NEW.advocate_id := v_intent.source_advocate_id;
    NEW.exposure_lag := NULL;
    RETURN NEW;
  END IF;

  IF v_intent.source <> 'primary_site' THEN
    RAISE EXCEPTION 'Non-direct attribution requires a primary-site intent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind IN ('post_visit_attributed', 'post_visit_observed') THEN
    IF NEW.exposure_id IS NULL THEN
      RAISE EXCEPTION 'Post-visit attribution requires an exposure'
        USING ERRCODE = '23514';
    END IF;

    SELECT exposure.*
    INTO v_exposure
    FROM public.advocate_exposures exposure
    WHERE exposure.id = NEW.exposure_id;

    IF NOT FOUND OR NOT v_exposure.is_qualified THEN
      RAISE EXCEPTION 'Attribution exposure is missing or unqualified'
        USING ERRCODE = '23514';
    END IF;

    IF v_intent.auth_user_id IS NOT NULL
       AND v_exposure.auth_user_id IS NOT NULL
       AND v_exposure.auth_user_id <> v_intent.auth_user_id THEN
      RAISE EXCEPTION 'Attribution exposure has contradictory account identity'
        USING ERRCODE = '23514';
    END IF;

    IF NOT (
      (
        v_intent.browser_visitor_id IS NOT NULL
        AND v_exposure.browser_visitor_id = v_intent.browser_visitor_id
      )
      OR
      (
        v_intent.auth_user_id IS NOT NULL
        AND v_exposure.auth_user_id = v_intent.auth_user_id
      )
    ) THEN
      RAISE EXCEPTION 'Attribution exposure is not linked to the intent identity'
        USING ERRCODE = '23514';
    END IF;

    IF v_exposure.occurred_at > v_intent.created_at
       OR v_exposure.recorded_at > v_intent.created_at THEN
      RAISE EXCEPTION 'Attribution exposure was recorded after the intent was created'
      USING ERRCODE = '23514';
    END IF;

    SELECT exposure.id
    INTO v_latest_exposure_id
    FROM public.advocate_exposures exposure
    WHERE exposure.is_qualified
      AND exposure.occurred_at <= v_intent.created_at
      AND exposure.recorded_at <= v_intent.created_at
      AND exposure.occurred_at >= v_intent.created_at - v_observed_window
      AND NOT (
        v_intent.auth_user_id IS NOT NULL
        AND exposure.auth_user_id IS NOT NULL
        AND exposure.auth_user_id <> v_intent.auth_user_id
      )
      AND (
        (
          v_intent.browser_visitor_id IS NOT NULL
          AND exposure.browser_visitor_id = v_intent.browser_visitor_id
        )
        OR
        (
          v_intent.auth_user_id IS NOT NULL
          AND exposure.auth_user_id = v_intent.auth_user_id
        )
      )
    ORDER BY exposure.occurred_at DESC, exposure.recorded_at DESC, exposure.id DESC
    LIMIT 1;

    IF v_latest_exposure_id IS DISTINCT FROM NEW.exposure_id THEN
      RAISE EXCEPTION 'Attribution exposure is not the most recent eligible visit'
        USING ERRCODE = '23514';
    END IF;

    v_lag := v_intent.created_at - v_exposure.occurred_at;

    IF NEW.kind = 'post_visit_attributed'
       AND (v_lag < interval '0 seconds' OR v_lag > v_official_window) THEN
      RAISE EXCEPTION 'Attributed post-visit lag must be within 30 days'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.kind = 'post_visit_observed'
       AND (v_lag <= v_official_window OR v_lag > v_observed_window) THEN
      RAISE EXCEPTION 'Observed post-visit lag must be over 30 and through 365 days'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.advocate_id IS NOT NULL
       AND NEW.advocate_id <> v_exposure.advocate_id THEN
      RAISE EXCEPTION 'Attribution advocate does not match exposure'
        USING ERRCODE = '23514';
    END IF;

    NEW.advocate_id := v_exposure.advocate_id;
    NEW.exposure_lag := v_lag;
    RETURN NEW;
  END IF;

  IF NEW.kind = 'unattributed' THEN
    IF NEW.exposure_id IS NOT NULL OR NEW.advocate_id IS NOT NULL THEN
      RAISE EXCEPTION 'Unattributed decisions cannot carry advocate evidence'
        USING ERRCODE = '23514';
    END IF;

    SELECT exposure.id
    INTO v_latest_exposure_id
    FROM public.advocate_exposures exposure
    WHERE exposure.is_qualified
      AND exposure.occurred_at <= v_intent.created_at
      AND exposure.recorded_at <= v_intent.created_at
      AND exposure.occurred_at >= v_intent.created_at - v_observed_window
      AND NOT (
        v_intent.auth_user_id IS NOT NULL
        AND exposure.auth_user_id IS NOT NULL
        AND exposure.auth_user_id <> v_intent.auth_user_id
      )
      AND (
        (
          v_intent.browser_visitor_id IS NOT NULL
          AND exposure.browser_visitor_id = v_intent.browser_visitor_id
        )
        OR
        (
          v_intent.auth_user_id IS NOT NULL
          AND exposure.auth_user_id = v_intent.auth_user_id
        )
      )
    ORDER BY exposure.occurred_at DESC, exposure.recorded_at DESC, exposure.id DESC
    LIMIT 1;

    IF v_latest_exposure_id IS NOT NULL THEN
      RAISE EXCEPTION 'Unattributed decision has an eligible exposure'
        USING ERRCODE = '23514';
    END IF;

    NEW.advocate_id := NULL;
    NEW.exposure_id := NULL;
    NEW.exposure_lag := NULL;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported sponsorship attribution kind'
    USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION private.prevent_sponsorship_attribution_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Sponsorship attribution decisions are immutable'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION private.create_sponsorship_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy public.sponsorship_attribution_policies%ROWTYPE;
  v_exposure public.advocate_exposures%ROWTYPE;
  v_kind public.sponsorship_attribution_kind;
  v_lag interval;
  v_match_kind text;
BEGIN
  SELECT policy.*
  INTO STRICT v_policy
  FROM public.sponsorship_attribution_policies policy
  WHERE policy.version = NEW.attribution_policy_version;

  IF NEW.source = 'advocate_domain' THEN
    INSERT INTO public.sponsorship_attributions (
      sponsorship_intent_id,
      kind,
      policy_version,
      advocate_id,
      decision_context
    )
    VALUES (
      NEW.id,
      'direct',
      NEW.attribution_policy_version,
      NEW.source_advocate_id,
      jsonb_build_object('locked_at', NEW.created_at)
    );

    RETURN NULL;
  END IF;

  SELECT exposure.*
  INTO v_exposure
  FROM public.advocate_exposures exposure
  WHERE exposure.is_qualified
    AND exposure.occurred_at <= NEW.created_at
    AND exposure.recorded_at <= NEW.created_at
    AND exposure.occurred_at >= NEW.created_at
      - make_interval(days => v_policy.observed_window_days)
    AND NOT (
      NEW.auth_user_id IS NOT NULL
      AND exposure.auth_user_id IS NOT NULL
      AND exposure.auth_user_id <> NEW.auth_user_id
    )
    AND (
      (
        NEW.browser_visitor_id IS NOT NULL
        AND exposure.browser_visitor_id = NEW.browser_visitor_id
      )
      OR
      (
        NEW.auth_user_id IS NOT NULL
        AND exposure.auth_user_id = NEW.auth_user_id
      )
    )
  ORDER BY exposure.occurred_at DESC, exposure.recorded_at DESC, exposure.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.sponsorship_attributions (
      sponsorship_intent_id,
      kind,
      policy_version,
      decision_context
    )
    VALUES (
      NEW.id,
      'unattributed',
      NEW.attribution_policy_version,
      jsonb_build_object('locked_at', NEW.created_at)
    );

    RETURN NULL;
  END IF;

  v_lag := NEW.created_at - v_exposure.occurred_at;
  IF v_lag <= make_interval(days => v_policy.official_window_days) THEN
    v_kind := 'post_visit_attributed';
  ELSE
    v_kind := 'post_visit_observed';
  END IF;

  v_match_kind := CASE
    WHEN NEW.browser_visitor_id IS NOT NULL
      AND v_exposure.browser_visitor_id = NEW.browser_visitor_id
      AND NEW.auth_user_id IS NOT NULL
      AND v_exposure.auth_user_id = NEW.auth_user_id
      THEN 'browser_and_account'
    WHEN NEW.auth_user_id IS NOT NULL
      AND v_exposure.auth_user_id = NEW.auth_user_id
      THEN 'account'
    ELSE 'browser'
  END;

  INSERT INTO public.sponsorship_attributions (
    sponsorship_intent_id,
    kind,
    policy_version,
    advocate_id,
    exposure_id,
    exposure_lag,
    decision_context
  )
  VALUES (
    NEW.id,
    v_kind,
    NEW.attribution_policy_version,
    v_exposure.advocate_id,
    v_exposure.id,
    v_lag,
    jsonb_build_object(
      'identity_match', v_match_kind,
      'locked_at', NEW.created_at,
      'exposure_occurred_at', v_exposure.occurred_at
    )
  );

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_sponsor_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_status public.sponsor_identity_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sponsor identities cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.merged_into_id IS NOT NULL THEN
      RAISE EXCEPTION 'Sponsor identities must begin active and canonical'
        USING ERRCODE = '23514';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sponsor identity keys are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.auth_user_id IS NOT NULL
     AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    IF NEW.auth_user_id IS NOT NULL
       OR (
         NEW.status = 'active'
         AND EXISTS (
           SELECT 1
           FROM auth.users account
           WHERE account.id = OLD.auth_user_id
         )
       ) THEN
      RAISE EXCEPTION 'A verified sponsor account link cannot be replaced or manually removed while active'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.auth_user_id IS NULL
     AND NEW.auth_user_id IS NOT NULL
     AND OLD.status <> 'active' THEN
    RAISE EXCEPTION 'An account can attach only to an active sponsor identity'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'active' AND (
    NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
    OR NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id
  ) THEN
    RAISE EXCEPTION 'Terminal sponsor identity evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    OLD.status = 'active' AND NEW.status IN ('merged', 'erased')
  ) THEN
    RAISE EXCEPTION 'Illegal sponsor identity status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'merged' THEN
    IF NEW.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'An account link must be transferred or removed before identity merge'
        USING ERRCODE = '23514';
    END IF;
    SELECT identity.status
    INTO v_target_status
    FROM public.sponsor_identities identity
    WHERE identity.id = NEW.merged_into_id
    FOR SHARE;

    IF NOT FOUND OR v_target_status <> 'active' THEN
      RAISE EXCEPTION 'Sponsor identities may merge only into an active canonical identity'
      USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'erased' AND NEW.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'An erased sponsor identity cannot retain an account link'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_sponsor_identifier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity_status public.sponsor_identity_status;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sponsor identifiers cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT identity.status
    INTO v_identity_status
    FROM public.sponsor_identities identity
    WHERE identity.id = NEW.sponsor_identity_id
    FOR SHARE;

    IF NOT FOUND OR v_identity_status <> 'active' THEN
      RAISE EXCEPTION 'Identifiers may attach only to an active sponsor identity'
        USING ERRCODE = '23514';
    END IF;

    NEW.first_seen_at := v_now;
    NEW.last_seen_at := v_now;
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    IF NEW.confidence = 'verified' THEN
      NEW.verified_at := v_now;
    ELSE
      NEW.verified_at := NULL;
    END IF;
    NEW.revoked_at := NULL;
    NEW.revocation_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.sponsor_identity_id IS DISTINCT FROM OLD.sponsor_identity_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.issuer_scope IS DISTINCT FROM OLD.issuer_scope
     OR NEW.identifier_digest IS DISTINCT FROM OLD.identifier_digest
     OR NEW.normalization_version IS DISTINCT FROM OLD.normalization_version
     OR NEW.hmac_key_version IS DISTINCT FROM OLD.hmac_key_version
     OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sponsor identifier provenance is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.revoked_at IS NOT NULL AND (
    NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
  ) THEN
    RAISE EXCEPTION 'Sponsor identifier revocation is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.confidence < OLD.confidence THEN
    RAISE EXCEPTION 'Sponsor identifier confidence cannot decrease'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.confidence = 'verified' AND OLD.confidence <> 'verified' THEN
    NEW.verified_at := v_now;
  ELSIF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'Sponsor identifier verification time is server managed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    IF nullif(btrim(NEW.revocation_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Sponsor identifier revocation requires a reason'
        USING ERRCODE = '23514';
    END IF;
    NEW.revoked_at := v_now;
  END IF;

  IF NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Revoked sponsor identifiers cannot be refreshed'
        USING ERRCODE = '42501';
    END IF;
    NEW.last_seen_at := v_now;
  END IF;
  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_and_protect_gateway_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_lease_timeout interval := interval '10 minutes';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment gateway events cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_attempt_id IS NOT NULL THEN
      SELECT attempt.*
      INTO v_attempt
      FROM public.sponsorship_payment_attempts attempt
      WHERE attempt.id = NEW.payment_attempt_id
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Gateway event payment attempt does not exist'
          USING ERRCODE = '23503';
      END IF;

      IF NEW.sponsorship_intent_id IS NOT NULL
         AND NEW.sponsorship_intent_id <> v_attempt.sponsorship_intent_id THEN
        RAISE EXCEPTION 'Gateway event intent does not match its payment attempt'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.provider <> v_attempt.provider
         OR NEW.provider_account_scope <> v_attempt.provider_account_scope THEN
        RAISE EXCEPTION 'Gateway event provider account does not match its payment attempt'
          USING ERRCODE = '23514';
      END IF;

      NEW.sponsorship_intent_id := v_attempt.sponsorship_intent_id;
    END IF;

    IF NEW.processing_status <> 'received'
       OR NEW.processing_attempt_count <> 0
       OR NEW.processed_at IS NOT NULL
       OR NEW.last_error IS NOT NULL
       OR NEW.ignored_reason IS NOT NULL
       OR NEW.processing_locked_at IS NOT NULL
       OR NEW.processing_locked_by IS NOT NULL THEN
      RAISE EXCEPTION 'Gateway events must begin in the received state'
        USING ERRCODE = '23514';
    END IF;

    NEW.processing_attempt_count := 0;
    NEW.max_processing_attempts := 12;
    NEW.processing_locked_at := NULL;
    NEW.processing_locked_by := NULL;
    NEW.available_at := v_now;
    NEW.received_at := v_now;
    IF NEW.payload_ciphertext IS NOT NULL THEN
      NEW.payload_retention_expires_at := v_now + interval '90 days';
      NEW.payload_redacted_at := NULL;
    ELSE
      NEW.payload_retention_expires_at := NULL;
      NEW.payload_redacted_at := NULL;
    END IF;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF OLD.payload_ciphertext IS NOT NULL
     AND OLD.payload_retention_expires_at <= v_now
     AND NEW.payload_ciphertext IS NULL
     AND NEW.payload_redacted_at IS NOT NULL
     AND (
       to_jsonb(NEW) - ARRAY[
         'payload_ciphertext',
         'payload_redacted_at',
         'updated_at'
       ]::text[]
     ) = (
       to_jsonb(OLD) - ARRAY[
         'payload_ciphertext',
         'payload_redacted_at',
         'updated_at'
       ]::text[]
     ) THEN
    NEW.payload_redacted_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope
     OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id
     OR NEW.sponsorship_intent_id IS DISTINCT FROM OLD.sponsorship_intent_id
     OR NEW.payment_attempt_id IS DISTINCT FROM OLD.payment_attempt_id
     OR NEW.redacted_payload IS DISTINCT FROM OLD.redacted_payload
     OR NEW.payload_ciphertext IS DISTINCT FROM OLD.payload_ciphertext
     OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.payload_retention_expires_at IS DISTINCT FROM OLD.payload_retention_expires_at
     OR NEW.payload_redacted_at IS DISTINCT FROM OLD.payload_redacted_at
     OR NEW.signature_verified_at IS DISTINCT FROM OLD.signature_verified_at
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.max_processing_attempts IS DISTINCT FROM OLD.max_processing_attempts THEN
    RAISE EXCEPTION 'Gateway event evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.processing_status IS NOT DISTINCT FROM OLD.processing_status THEN
    IF OLD.processing_status = 'processing'
       AND NEW.processing_locked_by IS DISTINCT FROM OLD.processing_locked_by THEN
      IF OLD.processing_locked_at > v_now - v_lease_timeout THEN
        RAISE EXCEPTION 'Gateway event processing lease is still active'
          USING ERRCODE = '55P03';
      END IF;
      IF OLD.processing_attempt_count >= OLD.max_processing_attempts THEN
        RAISE EXCEPTION 'Gateway event retry limit has been reached'
          USING ERRCODE = '23514';
      END IF;
      IF nullif(btrim(NEW.processing_locked_by), '') IS NULL THEN
        RAISE EXCEPTION 'Gateway event lease reclaim requires a worker identity'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.processing_attempt_count IS DISTINCT FROM OLD.processing_attempt_count
         OR NEW.processing_locked_at IS DISTINCT FROM OLD.processing_locked_at
         OR NEW.available_at IS DISTINCT FROM OLD.available_at
         OR NEW.processed_at IS DISTINCT FROM OLD.processed_at
         OR NEW.last_error IS DISTINCT FROM OLD.last_error
         OR NEW.ignored_reason IS DISTINCT FROM OLD.ignored_reason THEN
        RAISE EXCEPTION 'Gateway event lease fields are server managed'
          USING ERRCODE = '42501';
      END IF;
      NEW.processing_attempt_count := OLD.processing_attempt_count + 1;
      NEW.processing_locked_at := v_now;
      NEW.processed_at := NULL;
      NEW.last_error := NULL;
      NEW.ignored_reason := NULL;
    ELSIF NEW.processing_attempt_count IS DISTINCT FROM OLD.processing_attempt_count
       OR NEW.processing_locked_at IS DISTINCT FROM OLD.processing_locked_at
       OR NEW.processing_locked_by IS DISTINCT FROM OLD.processing_locked_by
       OR NEW.available_at IS DISTINCT FROM OLD.available_at
       OR NEW.processed_at IS DISTINCT FROM OLD.processed_at
       OR NEW.last_error IS DISTINCT FROM OLD.last_error
       OR NEW.ignored_reason IS DISTINCT FROM OLD.ignored_reason THEN
      RAISE EXCEPTION 'Gateway event lifecycle fields require a transition or stale lease reclaim'
        USING ERRCODE = '42501';
    END IF;

    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.processing_status IS DISTINCT FROM OLD.processing_status AND NOT (
    (OLD.processing_status IN ('received', 'failed') AND NEW.processing_status = 'processing')
    OR (OLD.processing_status = 'processing' AND NEW.processing_status IN ('processed', 'failed', 'ignored'))
  ) THEN
    RAISE EXCEPTION 'Illegal gateway event transition from % to %', OLD.processing_status, NEW.processing_status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.processing_status IS DISTINCT FROM OLD.processing_status THEN
    IF NEW.processing_attempt_count IS DISTINCT FROM OLD.processing_attempt_count
       OR NEW.processing_locked_at IS DISTINCT FROM OLD.processing_locked_at THEN
      RAISE EXCEPTION 'Gateway event counters and lease times are server managed'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.processing_status = 'processing'
       AND NEW.processing_locked_by IS DISTINCT FROM OLD.processing_locked_by THEN
      RAISE EXCEPTION 'Only the current gateway event lease owner may finish processing'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.processing_status <> 'failed'
       AND NEW.available_at IS DISTINCT FROM OLD.available_at THEN
      RAISE EXCEPTION 'Gateway retry availability can change only after processing failure'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.processing_status = 'processing' THEN
      IF OLD.available_at > v_now THEN
        RAISE EXCEPTION 'Gateway event is not yet available for retry'
          USING ERRCODE = '55P03';
      END IF;
      IF OLD.processing_attempt_count >= OLD.max_processing_attempts THEN
        RAISE EXCEPTION 'Gateway event retry limit has been reached'
          USING ERRCODE = '23514';
      END IF;
      IF nullif(btrim(NEW.processing_locked_by), '') IS NULL THEN
        RAISE EXCEPTION 'Processing gateway events require a worker identity'
          USING ERRCODE = '23514';
      END IF;
      NEW.processing_attempt_count := OLD.processing_attempt_count + 1;
      NEW.processing_locked_at := v_now;
      NEW.processed_at := NULL;
      NEW.last_error := NULL;
      NEW.ignored_reason := NULL;
    ELSIF NEW.processing_status = 'processed' THEN
      NEW.processed_at := v_now;
      NEW.last_error := NULL;
      NEW.ignored_reason := NULL;
      NEW.processing_locked_at := NULL;
      NEW.processing_locked_by := NULL;
    ELSIF NEW.processing_status = 'ignored' THEN
      IF nullif(btrim(NEW.ignored_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Ignored gateway events require a reason'
          USING ERRCODE = '23514';
      END IF;
      NEW.processed_at := v_now;
      NEW.last_error := NULL;
      NEW.processing_locked_at := NULL;
      NEW.processing_locked_by := NULL;
    ELSIF NEW.processing_status = 'failed' THEN
      IF nullif(btrim(NEW.last_error), '') IS NULL THEN
        RAISE EXCEPTION 'Failed gateway events require an error summary'
          USING ERRCODE = '23514';
      END IF;
      NEW.processed_at := NULL;
      NEW.ignored_reason := NULL;
      NEW.available_at := greatest(NEW.available_at, v_now);
      NEW.processing_locked_at := NULL;
      NEW.processing_locked_by := NULL;
    END IF;
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_account_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_visitor public.browser_visitors%ROWTYPE;
  v_identity_user_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sponsorship account claims cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Account claims must begin pending'
        USING ERRCODE = '23514';
    END IF;

    SELECT intent.*
    INTO v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = NEW.sponsorship_intent_id
    FOR SHARE;

    IF NOT FOUND OR v_intent.status <> 'succeeded' THEN
      RAISE EXCEPTION 'Account claims require a successful sponsorship intent'
        USING ERRCODE = '23514';
    END IF;

    IF v_intent.sponsor_identity_id IS NULL THEN
      RAISE EXCEPTION 'Account claims require an attached sponsor identity'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.email_hmac IS DISTINCT FROM v_intent.contact_email_hmac
       OR NEW.email_normalization_version IS DISTINCT FROM v_intent.contact_email_normalization_version
       OR NEW.email_hmac_key_version IS DISTINCT FROM v_intent.contact_email_hmac_key_version THEN
      RAISE EXCEPTION 'Account claim email does not match the sponsorship intent'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.sponsorship_account_claims prior_claim
      WHERE prior_claim.sponsorship_intent_id = NEW.sponsorship_intent_id
        AND prior_claim.status = 'consumed'
    ) THEN
      RAISE EXCEPTION 'A consumed sponsorship account claim cannot be reissued'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.requested_browser_visitor_id IS NOT NULL THEN
      SELECT visitor.*
      INTO v_visitor
      FROM public.browser_visitors visitor
      WHERE visitor.id = NEW.requested_browser_visitor_id
      FOR UPDATE;

      IF NOT FOUND
         OR v_visitor.revoked_at IS NOT NULL
         OR v_visitor.retention_expires_at <= v_now THEN
        RAISE EXCEPTION 'Claim browser visitor is revoked or outside retention'
          USING ERRCODE = '22023';
      END IF;

      UPDATE public.browser_visitors
      SET last_seen_at = v_now
      WHERE id = NEW.requested_browser_visitor_id;
    END IF;

    NEW.sponsor_identity_id := v_intent.sponsor_identity_id;
    NEW.target_auth_user_id := NULL;
    NEW.consumed_at := NULL;
    NEW.revoked_at := NULL;
    NEW.revocation_reason := NULL;
    NEW.requested_at := v_now;
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.sponsorship_intent_id IS DISTINCT FROM OLD.sponsorship_intent_id
     OR NEW.email_hmac IS DISTINCT FROM OLD.email_hmac
     OR NEW.email_normalization_version IS DISTINCT FROM OLD.email_normalization_version
     OR NEW.email_hmac_key_version IS DISTINCT FROM OLD.email_hmac_key_version
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.sponsor_identity_id IS DISTINCT FROM OLD.sponsor_identity_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Account claim evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.requested_browser_visitor_id IS DISTINCT FROM OLD.requested_browser_visitor_id
     AND NOT (
       OLD.requested_browser_visitor_id IS NOT NULL
       AND NEW.requested_browser_visitor_id IS NULL
       AND OLD.requested_at + interval '400 days' <= v_now
     ) THEN
    RAISE EXCEPTION 'Claim browser evidence can only be unlinked after retention expiry'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    OLD.status = 'pending' AND NEW.status IN ('consumed', 'expired', 'revoked')
  ) THEN
    RAISE EXCEPTION 'Illegal account claim transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status AND (
    NEW.sponsor_identity_id IS DISTINCT FROM OLD.sponsor_identity_id
    OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
    OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
    OR (
      NEW.target_auth_user_id IS DISTINCT FROM OLD.target_auth_user_id
      AND NOT (
        OLD.target_auth_user_id IS NOT NULL
        AND NEW.target_auth_user_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM auth.users account
          WHERE account.id = OLD.target_auth_user_id
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'Account claim lifecycle evidence requires a legal transition'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'consumed' AND OLD.status = 'pending' THEN
    IF OLD.expires_at <= v_now THEN
      RAISE EXCEPTION 'Expired account claim cannot be consumed'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.target_auth_user_id IS NULL THEN
      RAISE EXCEPTION 'Consumed account claims require a target account'
        USING ERRCODE = '23514';
    END IF;

    SELECT identity.auth_user_id
    INTO v_identity_user_id
    FROM public.sponsor_identities identity
    WHERE identity.id = NEW.sponsor_identity_id
      AND identity.status = 'active';

    IF NOT FOUND OR v_identity_user_id IS DISTINCT FROM NEW.target_auth_user_id THEN
      RAISE EXCEPTION 'Claim identity must be active and belong to the target account'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.sponsor_identifiers identifier
      WHERE identifier.sponsor_identity_id = NEW.sponsor_identity_id
        AND identifier.kind = 'email'
        AND identifier.identifier_digest = NEW.email_hmac
        AND identifier.normalization_version = NEW.email_normalization_version
        AND identifier.hmac_key_version = NEW.email_hmac_key_version
        AND identifier.confidence = 'verified'
        AND identifier.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Claim email must be verified for the sponsor identity'
        USING ERRCODE = '23514';
    END IF;

    NEW.consumed_at := v_now;
    NEW.revoked_at := NULL;
    NEW.revocation_reason := NULL;
  ELSIF NEW.status = 'expired' AND OLD.status = 'pending' THEN
    IF OLD.expires_at > v_now THEN
      RAISE EXCEPTION 'Account claim cannot expire before its deadline'
        USING ERRCODE = '23514';
    END IF;
    NEW.target_auth_user_id := NULL;
    NEW.consumed_at := NULL;
    NEW.revoked_at := NULL;
    NEW.revocation_reason := NULL;
  ELSIF NEW.status = 'revoked' AND OLD.status = 'pending' THEN
    NEW.target_auth_user_id := NULL;
    NEW.consumed_at := NULL;
    NEW.revoked_at := v_now;
    IF nullif(btrim(NEW.revocation_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Revoked account claims require a reason'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_email_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim public.sponsorship_account_claims%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_lease_timeout interval := interval '10 minutes';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Email outbox rows cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Email outbox rows must begin pending'
        USING ERRCODE = '23514';
    END IF;

    SELECT claim.*
    INTO v_claim
    FROM public.sponsorship_account_claims claim
    WHERE claim.id = NEW.account_claim_id
    FOR SHARE;

    IF NOT FOUND
       OR v_claim.status <> 'pending'
       OR NEW.sponsor_identity_id IS DISTINCT FROM v_claim.sponsor_identity_id THEN
      RAISE EXCEPTION 'Sponsor welcome email must match a pending account claim'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.recipient_email_hmac IS DISTINCT FROM v_claim.email_hmac
       OR NEW.email_normalization_version IS DISTINCT FROM v_claim.email_normalization_version
       OR NEW.email_hmac_key_version IS DISTINCT FROM v_claim.email_hmac_key_version THEN
      RAISE EXCEPTION 'Sponsor welcome recipient does not match the account claim'
        USING ERRCODE = '23514';
    END IF;

    NEW.max_attempts := 8;
    NEW.available_at := v_now;
    NEW.attempt_count := 0;
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    NEW.sent_at := NULL;
    NEW.provider_message_id := NULL;
    NEW.email_log_id := NULL;
    NEW.last_error := NULL;
    NEW.cancelled_at := NULL;
    NEW.contact_retention_expires_at := NULL;
    NEW.contact_redacted_at := NULL;
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF OLD.contact_redacted_at IS NULL
     AND OLD.contact_retention_expires_at IS NOT NULL
     AND OLD.contact_retention_expires_at <= v_now
     AND NEW.recipient_email_ciphertext IS NULL
     AND NEW.recipient_email_hmac IS NULL
     AND NEW.email_normalization_version IS NULL
     AND NEW.email_hmac_key_version IS NULL
     AND NEW.email_encryption_key_version IS NULL
     AND NEW.secret_payload_ciphertext IS NULL
     AND NEW.contact_redacted_at IS NOT NULL
     AND (
       to_jsonb(NEW) - ARRAY[
         'recipient_email_ciphertext',
         'recipient_email_hmac',
         'email_normalization_version',
         'email_hmac_key_version',
         'email_encryption_key_version',
         'secret_payload_ciphertext',
         'contact_redacted_at',
         'updated_at'
       ]::text[]
     ) = (
       to_jsonb(OLD) - ARRAY[
         'recipient_email_ciphertext',
         'recipient_email_hmac',
         'email_normalization_version',
         'email_hmac_key_version',
         'email_encryption_key_version',
         'secret_payload_ciphertext',
         'contact_redacted_at',
         'updated_at'
       ]::text[]
     ) THEN
    NEW.contact_redacted_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.account_claim_id IS DISTINCT FROM OLD.account_claim_id
     OR NEW.sponsor_identity_id IS DISTINCT FROM OLD.sponsor_identity_id
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.recipient_email_ciphertext IS DISTINCT FROM OLD.recipient_email_ciphertext
     OR NEW.recipient_email_hmac IS DISTINCT FROM OLD.recipient_email_hmac
     OR NEW.email_normalization_version IS DISTINCT FROM OLD.email_normalization_version
     OR NEW.email_hmac_key_version IS DISTINCT FROM OLD.email_hmac_key_version
     OR NEW.email_encryption_key_version IS DISTINCT FROM OLD.email_encryption_key_version
     OR NEW.template_key IS DISTINCT FROM OLD.template_key
     OR NEW.template_data IS DISTINCT FROM OLD.template_data
     OR NEW.secret_payload_ciphertext IS DISTINCT FROM OLD.secret_payload_ciphertext
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.contact_redacted_at IS DISTINCT FROM OLD.contact_redacted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Email outbox delivery payload is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status IN ('pending', 'failed') AND NEW.status IN ('processing', 'cancelled'))
    OR (OLD.status = 'processing' AND NEW.status IN ('sent', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Illegal email outbox transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF OLD.status = 'processing'
       AND NEW.locked_by IS DISTINCT FROM OLD.locked_by THEN
      IF OLD.locked_at > v_now - v_lease_timeout THEN
        RAISE EXCEPTION 'Email delivery lease is still active'
          USING ERRCODE = '55P03';
      END IF;
      IF OLD.attempt_count >= OLD.max_attempts THEN
        RAISE EXCEPTION 'Email delivery retry limit has been reached'
          USING ERRCODE = '23514';
      END IF;
      IF nullif(btrim(NEW.locked_by), '') IS NULL THEN
        RAISE EXCEPTION 'Email delivery lease reclaim requires a worker identity'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.available_at IS DISTINCT FROM OLD.available_at
         OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
         OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
         OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
         OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
         OR NEW.email_log_id IS DISTINCT FROM OLD.email_log_id
         OR NEW.last_error IS DISTINCT FROM OLD.last_error
         OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
         OR NEW.contact_retention_expires_at IS DISTINCT FROM OLD.contact_retention_expires_at THEN
        RAISE EXCEPTION 'Email delivery lease fields are server managed'
          USING ERRCODE = '42501';
      END IF;
      NEW.attempt_count := OLD.attempt_count + 1;
      NEW.locked_at := v_now;
      NEW.sent_at := NULL;
      NEW.cancelled_at := NULL;
      NEW.last_error := NULL;
    ELSIF NEW.available_at IS DISTINCT FROM OLD.available_at
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
       OR NEW.email_log_id IS DISTINCT FROM OLD.email_log_id
       OR NEW.last_error IS DISTINCT FROM OLD.last_error
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.contact_retention_expires_at IS DISTINCT FROM OLD.contact_retention_expires_at THEN
      RAISE EXCEPTION 'Email delivery lifecycle fields require a legal status transition or stale lease reclaim'
        USING ERRCODE = '42501';
    END IF;

    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'processing' THEN
      IF OLD.available_at > v_now THEN
        RAISE EXCEPTION 'Email delivery is not yet available for retry'
          USING ERRCODE = '55P03';
      END IF;
      IF OLD.attempt_count >= OLD.max_attempts THEN
        RAISE EXCEPTION 'Email delivery retry limit has been reached'
          USING ERRCODE = '23514';
      END IF;
      IF nullif(btrim(NEW.locked_by), '') IS NULL THEN
        RAISE EXCEPTION 'Processing email requires a worker identity'
          USING ERRCODE = '23514';
      END IF;
      NEW.locked_at := v_now;
      NEW.attempt_count := OLD.attempt_count + 1;
      NEW.sent_at := NULL;
      NEW.cancelled_at := NULL;
      NEW.last_error := NULL;
      NEW.contact_retention_expires_at := NULL;
    ELSIF NEW.status = 'sent' THEN
      NEW.sent_at := v_now;
      NEW.cancelled_at := NULL;
      NEW.last_error := NULL;
      NEW.locked_at := NULL;
      NEW.locked_by := NULL;
      NEW.contact_retention_expires_at := v_now + interval '90 days';
    ELSIF NEW.status = 'failed' THEN
      IF nullif(btrim(NEW.last_error), '') IS NULL THEN
        RAISE EXCEPTION 'Failed email delivery requires an error summary'
          USING ERRCODE = '23514';
      END IF;
      NEW.sent_at := NULL;
      NEW.cancelled_at := NULL;
      NEW.locked_at := NULL;
      NEW.locked_by := NULL;
      IF OLD.attempt_count >= OLD.max_attempts THEN
        NEW.contact_retention_expires_at := v_now + interval '90 days';
      ELSE
        NEW.contact_retention_expires_at := NULL;
      END IF;
    ELSIF NEW.status = 'cancelled' THEN
      NEW.cancelled_at := v_now;
      NEW.sent_at := NULL;
      NEW.locked_at := NULL;
      NEW.locked_by := NULL;
      NEW.contact_retention_expires_at := v_now + interval '90 days';
    END IF;
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.prevent_operational_table_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Operational sponsorship tables cannot be truncated'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_advocate_tracking(
  batch_size integer DEFAULT 500
)
RETURNS TABLE (
  exposures_deleted bigint,
  visitors_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_exposures_deleted bigint;
  v_visitors_deleted bigint;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'database-retention',
    context_reason => 'Expired advocate tracking retention',
    context_metadata => jsonb_build_object(
      'operation', 'delete',
      'resource_kind', 'advocate_tracking'
    )
  );

  WITH candidates AS MATERIALIZED (
    SELECT exposure.id
    FROM public.advocate_exposures exposure
    WHERE exposure.retention_expires_at <= v_now
    ORDER BY exposure.retention_expires_at, exposure.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.advocate_exposures exposure
    USING candidates candidate
    WHERE exposure.id = candidate.id
    RETURNING exposure.id
  )
  SELECT count(*)
  INTO v_exposures_deleted
  FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT visitor.id
    FROM public.browser_visitors visitor
    WHERE visitor.retention_expires_at <= v_now
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_exposures exposure
        WHERE exposure.browser_visitor_id = visitor.id
      )
    ORDER BY visitor.retention_expires_at, visitor.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.browser_visitors visitor
    USING candidates candidate
    WHERE visitor.id = candidate.id
    RETURNING visitor.id
  )
  SELECT count(*)
  INTO v_visitors_deleted
  FROM deleted;

  RETURN QUERY
  SELECT v_exposures_deleted, v_visitors_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_advocate_tracking(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_advocate_tracking(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_gateway_event_payloads(
  batch_size integer DEFAULT 500
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_redacted_count bigint;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'database-retention',
    context_reason => 'Expired encrypted gateway payload retention',
    context_metadata => jsonb_build_object(
      'operation', 'redact',
      'resource_kind', 'payment_gateway_event_payload'
    )
  );

  WITH candidates AS MATERIALIZED (
    SELECT event.id
    FROM public.payment_gateway_events event
    WHERE event.payload_ciphertext IS NOT NULL
      AND event.payload_retention_expires_at <= v_now
    ORDER BY event.payload_retention_expires_at, event.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), redacted AS (
    UPDATE public.payment_gateway_events event
    SET
      payload_ciphertext = NULL,
      payload_redacted_at = v_now
    FROM candidates candidate
    WHERE event.id = candidate.id
    RETURNING event.id
  )
  SELECT count(*)
  INTO v_redacted_count
  FROM redacted;

  RETURN v_redacted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_gateway_event_payloads(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_gateway_event_payloads(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_email_outbox_contact(
  batch_size integer DEFAULT 500
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_redacted_count bigint;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'database-retention',
    context_reason => 'Expired welcome email contact retention',
    context_metadata => jsonb_build_object(
      'operation', 'redact',
      'resource_kind', 'email_outbox_contact'
    )
  );

  WITH candidates AS MATERIALIZED (
    SELECT outbox.id
    FROM public.email_outbox outbox
    WHERE outbox.contact_redacted_at IS NULL
      AND outbox.contact_retention_expires_at <= v_now
    ORDER BY outbox.contact_retention_expires_at, outbox.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), redacted AS (
    UPDATE public.email_outbox outbox
    SET
      recipient_email_ciphertext = NULL,
      recipient_email_hmac = NULL,
      email_normalization_version = NULL,
      email_hmac_key_version = NULL,
      email_encryption_key_version = NULL,
      secret_payload_ciphertext = NULL,
      contact_redacted_at = v_now
    FROM candidates candidate
    WHERE outbox.id = candidate.id
    RETURNING outbox.id
  )
  SELECT count(*)
  INTO v_redacted_count
  FROM redacted;

  RETURN v_redacted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_email_outbox_contact(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_email_outbox_contact(integer)
  TO service_role;

REVOKE ALL ON FUNCTION private.protect_sponsorship_attribution_policy()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_advocate_exposure()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prepare_browser_visitor()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_advocate_exposure()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_and_protect_sponsorship_intent()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_and_protect_payment_attempt()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_sponsorship_attribution()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prevent_sponsorship_attribution_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.create_sponsorship_attribution()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_sponsor_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_sponsor_identifier()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_and_protect_gateway_event()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_account_claim()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_email_outbox()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prevent_operational_table_truncate()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER sponsorship_attribution_policies_protect
BEFORE UPDATE OR DELETE ON public.sponsorship_attribution_policies
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsorship_attribution_policy();

CREATE TRIGGER payment_provider_accounts_touch_updated_at
BEFORE UPDATE ON public.payment_provider_accounts
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER browser_visitors_prepare_and_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.browser_visitors
FOR EACH ROW EXECUTE FUNCTION private.prepare_browser_visitor();

CREATE TRIGGER sponsor_identities_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsor_identities
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsor_identity();

CREATE TRIGGER sponsor_identifiers_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsor_identifiers
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsor_identifier();

CREATE TRIGGER advocate_exposures_validate
BEFORE INSERT ON public.advocate_exposures
FOR EACH ROW EXECUTE FUNCTION private.validate_advocate_exposure();

CREATE TRIGGER advocate_exposures_protect
BEFORE UPDATE OR DELETE ON public.advocate_exposures
FOR EACH ROW EXECUTE FUNCTION private.protect_advocate_exposure();

CREATE TRIGGER sponsorship_intents_validate_and_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsorship_intents
FOR EACH ROW EXECUTE FUNCTION private.validate_and_protect_sponsorship_intent();

CREATE TRIGGER sponsorship_intents_create_attribution
AFTER INSERT ON public.sponsorship_intents
FOR EACH ROW EXECUTE FUNCTION private.create_sponsorship_attribution();

CREATE TRIGGER sponsorship_attributions_validate
BEFORE INSERT ON public.sponsorship_attributions
FOR EACH ROW EXECUTE FUNCTION private.validate_sponsorship_attribution();

CREATE TRIGGER sponsorship_attributions_protect
BEFORE UPDATE OR DELETE ON public.sponsorship_attributions
FOR EACH ROW EXECUTE FUNCTION private.prevent_sponsorship_attribution_mutation();

CREATE TRIGGER sponsorship_payment_attempts_validate_and_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsorship_payment_attempts
FOR EACH ROW EXECUTE FUNCTION private.validate_and_protect_payment_attempt();

CREATE TRIGGER payment_gateway_events_validate_and_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.payment_gateway_events
FOR EACH ROW EXECUTE FUNCTION private.validate_and_protect_gateway_event();

CREATE TRIGGER sponsorship_account_claims_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsorship_account_claims
FOR EACH ROW EXECUTE FUNCTION private.protect_account_claim();

CREATE TRIGGER email_outbox_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION private.protect_email_outbox();

CREATE TRIGGER sponsorship_attribution_policies_no_truncate
BEFORE TRUNCATE ON public.sponsorship_attribution_policies
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER payment_provider_accounts_no_truncate
BEFORE TRUNCATE ON public.payment_provider_accounts
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER browser_visitors_no_truncate
BEFORE TRUNCATE ON public.browser_visitors
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER sponsor_identities_no_truncate
BEFORE TRUNCATE ON public.sponsor_identities
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER sponsor_identifiers_no_truncate
BEFORE TRUNCATE ON public.sponsor_identifiers
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER advocate_exposures_no_truncate
BEFORE TRUNCATE ON public.advocate_exposures
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER sponsorship_intents_no_truncate
BEFORE TRUNCATE ON public.sponsorship_intents
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER sponsorship_attributions_no_truncate
BEFORE TRUNCATE ON public.sponsorship_attributions
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER sponsorship_payment_attempts_no_truncate
BEFORE TRUNCATE ON public.sponsorship_payment_attempts
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER payment_gateway_events_no_truncate
BEFORE TRUNCATE ON public.payment_gateway_events
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER sponsorship_account_claims_no_truncate
BEFORE TRUNCATE ON public.sponsorship_account_claims
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER email_outbox_no_truncate
BEFORE TRUNCATE ON public.email_outbox
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

ALTER TABLE public.sponsorship_attribution_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateway_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_account_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sponsorship_attribution_policies FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.payment_provider_accounts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.browser_visitors FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsor_identities FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsor_identifiers FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_exposures FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_intents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_attributions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_payment_attempts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.payment_gateway_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_account_claims FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.email_outbox FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.sponsorship_attribution_policies TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payment_provider_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.browser_visitors TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sponsor_identities TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sponsor_identifiers TO service_role;
GRANT SELECT, INSERT, DELETE ON public.advocate_exposures TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sponsorship_intents TO service_role;
GRANT SELECT, INSERT ON public.sponsorship_attributions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sponsorship_payment_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payment_gateway_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sponsorship_account_claims TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.email_outbox TO service_role;

CREATE TRIGGER sponsorship_attribution_policies_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_attribution_policies
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');
CREATE TRIGGER payment_provider_accounts_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.payment_provider_accounts
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');
CREATE TRIGGER browser_visitors_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.browser_visitors
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'token_digest');
CREATE TRIGGER sponsor_identities_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.sponsor_identities
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'auth_user_id');
CREATE TRIGGER sponsor_identifiers_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.sponsor_identifiers
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'identifier_digest');
CREATE TRIGGER advocate_exposures_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_exposures
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'browser_visitor_id',
  'auth_user_id',
  'page_path',
  'referrer_host',
  'context'
);
CREATE TRIGGER sponsorship_intents_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_intents
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'browser_visitor_id',
  'auth_user_id',
  'sponsor_identity_id',
  'contact_email_hmac',
  'metadata'
);
CREATE TRIGGER sponsorship_attributions_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_attributions
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');
CREATE TRIGGER sponsorship_payment_attempts_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_payment_attempts
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'metadata');
CREATE TRIGGER payment_gateway_events_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.payment_gateway_events
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'redacted_payload',
  'payload_ciphertext',
  'payload_sha256',
  'last_error'
);
CREATE TRIGGER sponsorship_account_claims_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_account_claims
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'email_hmac',
  'token_digest',
  'requested_browser_visitor_id',
  'target_auth_user_id',
  'sponsor_identity_id'
);
CREATE TRIGGER email_outbox_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'recipient_email_ciphertext',
  'recipient_email_hmac',
  'email_normalization_version',
  'email_hmac_key_version',
  'email_encryption_key_version',
  'template_data',
  'secret_payload_ciphertext',
  'provider_message_id',
  'last_error'
);

COMMENT ON TABLE public.sponsorship_intents IS
  'Server-owned immutable sponsorship facts. Attribution is generated automatically and frozen at the database creation timestamp.';
COMMENT ON COLUMN public.sponsorship_intents.attribution_policy_version IS
  'Exact policy selected by the database at intent creation. Callers cannot choose or later change it.';
COMMENT ON TABLE public.advocate_exposures IS
  'Server-timestamped, append-only qualified and excluded advocate visits. Raw rows expire after 400 days.';
COMMENT ON TABLE public.sponsorship_attributions IS
  'One immutable direct, post-visit attributed, post-visit observed, or unattributed decision per intent.';
COMMENT ON TABLE public.payment_gateway_events IS
  'Signature-verified provider event envelope with immutable evidence and a retryable processing state machine.';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;

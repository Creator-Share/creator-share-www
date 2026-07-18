BEGIN;

/*
 * Historical subscriptions predate the server owned sponsor identity chain.
 * Their email addresses remain in legacy contact columns, but those plaintext
 * values are never copied into this ownership model. A server worker performs
 * normalization and HMAC-SHA256 in the application secret tier, records a
 * complete evidence manifest, and then finalizes the manifest as either one
 * unambiguous digest or a durable quarantine.
 *
 * Email normalization version 1 is shared with sponsorship intents:
 * Unicode NFKC, trim surrounding Unicode whitespace, lowercase the complete
 * address, and do not remove plus tags or provider-specific punctuation.
 */

DO $$ BEGIN
  CREATE TYPE public.legacy_subscription_evidence_source AS ENUM (
    'subscription_record',
    'transaction_ledger_record',
    'provider_api'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.legacy_subscription_evidence_outcome AS ENUM (
    'email_observed',
    'email_absent',
    'source_unavailable'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.legacy_subscription_source_failure AS ENUM (
    'timeout',
    'not_found',
    'permission_denied',
    'malformed_response',
    'provider_error',
    'missing_reference'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.legacy_subscription_reconciliation_status AS ENUM (
    'collecting',
    'resolved',
    'quarantined'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.legacy_subscription_quarantine_reason AS ENUM (
    'provider_unknown',
    'provider_reference_missing',
    'incomplete_manifest',
    'source_unavailable',
    'no_email_evidence',
    'email_conflict',
    'identity_conflict',
    'account_conflict',
    'modern_payment_conflict'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.legacy_subscription_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL
    REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_subscription_reference_digest bytea,
  status public.legacy_subscription_reconciliation_status NOT NULL
    DEFAULT 'collecting',
  canonical_email_hmac bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  quarantine_reason public.legacy_subscription_quarantine_reason,
  evidence_count integer NOT NULL DEFAULT 0,
  observed_email_count integer NOT NULL DEFAULT 0,
  distinct_email_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  CONSTRAINT legacy_subscription_reconciliation_runs_batch_unique
    UNIQUE (subscription_id, batch_id),
  CONSTRAINT legacy_subscription_reconciliation_runs_chain_unique
    UNIQUE (id, subscription_id),
  CONSTRAINT legacy_subscription_reconciliation_runs_scope_check CHECK (
    provider_account_scope IS NULL
    OR (
      provider_account_scope = lower(btrim(provider_account_scope))
      AND length(provider_account_scope) BETWEEN 1 AND 120
    )
  ),
  CONSTRAINT legacy_subscription_reconciliation_runs_provider_shape_check CHECK (
    (
      provider IS NULL
      AND provider_account_scope IS NULL
      AND provider_subscription_reference_digest IS NULL
    )
    OR (
      provider IS NOT NULL
      AND provider_account_scope IS NOT NULL
      AND (
        provider_subscription_reference_digest IS NULL
        OR octet_length(provider_subscription_reference_digest) = 32
      )
    )
  ),
  CONSTRAINT legacy_subscription_reconciliation_runs_counts_check CHECK (
    evidence_count >= 0
    AND observed_email_count >= 0
    AND distinct_email_count >= 0
    AND observed_email_count <= evidence_count
    AND distinct_email_count <= observed_email_count
  ),
  CONSTRAINT legacy_subscription_reconciliation_runs_status_shape_check CHECK (
    (
      status = 'collecting'
      AND canonical_email_hmac IS NULL
      AND email_normalization_version IS NULL
      AND email_hmac_key_version IS NULL
      AND quarantine_reason IS NULL
      AND evidence_count = 0
      AND observed_email_count = 0
      AND distinct_email_count = 0
      AND finalized_at IS NULL
    )
    OR (
      status = 'resolved'
      AND canonical_email_hmac IS NOT NULL
      AND octet_length(canonical_email_hmac) = 32
      AND email_normalization_version IS NOT NULL
      AND email_normalization_version = 1
      AND email_hmac_key_version IS NOT NULL
      AND email_hmac_key_version = 1
      AND quarantine_reason IS NULL
      AND evidence_count > 0
      AND observed_email_count > 0
      AND distinct_email_count = 1
      AND finalized_at IS NOT NULL
    )
    OR (
      status = 'quarantined'
      AND canonical_email_hmac IS NULL
      AND email_normalization_version IS NULL
      AND email_hmac_key_version IS NULL
      AND quarantine_reason IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  )
);

CREATE INDEX legacy_subscription_reconciliation_runs_latest_idx
  ON public.legacy_subscription_reconciliation_runs (
    subscription_id,
    finalized_at DESC,
    id DESC
  )
  WHERE status <> 'collecting';

CREATE INDEX legacy_subscription_reconciliation_runs_digest_idx
  ON public.legacy_subscription_reconciliation_runs (
    canonical_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    finalized_at DESC
  )
  WHERE status = 'resolved';

CREATE TABLE public.legacy_subscription_reconciliation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  source public.legacy_subscription_evidence_source NOT NULL,
  source_record_id uuid,
  source_reference_digest bytea NOT NULL,
  outcome public.legacy_subscription_evidence_outcome NOT NULL,
  email_hmac bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  source_failure public.legacy_subscription_source_failure,
  evidence_payload_sha256 bytea NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT legacy_subscription_reconciliation_evidence_run_fkey
    FOREIGN KEY (reconciliation_run_id, subscription_id)
    REFERENCES public.legacy_subscription_reconciliation_runs(id, subscription_id)
    ON DELETE RESTRICT,
  CONSTRAINT legacy_subscription_reconciliation_evidence_source_unique
    UNIQUE (reconciliation_run_id, source, source_reference_digest),
  CONSTRAINT legacy_subscription_reconciliation_evidence_reference_check
    CHECK (octet_length(source_reference_digest) = 32),
  CONSTRAINT legacy_subscription_reconciliation_evidence_payload_check
    CHECK (octet_length(evidence_payload_sha256) = 32),
  CONSTRAINT legacy_subscription_reconciliation_evidence_time_check CHECK (
    observed_at <= recorded_at + interval '5 minutes'
  ),
  CONSTRAINT legacy_subscription_reconciliation_evidence_outcome_check CHECK (
    (
      outcome = 'email_observed'
      AND email_hmac IS NOT NULL
      AND octet_length(email_hmac) = 32
      AND email_normalization_version IS NOT NULL
      AND email_normalization_version = 1
      AND email_hmac_key_version IS NOT NULL
      AND email_hmac_key_version = 1
      AND source_failure IS NULL
    )
    OR (
      outcome = 'email_absent'
      AND email_hmac IS NULL
      AND email_normalization_version IS NULL
      AND email_hmac_key_version IS NULL
      AND source_failure IS NULL
    )
    OR (
      outcome = 'source_unavailable'
      AND email_hmac IS NULL
      AND email_normalization_version IS NULL
      AND email_hmac_key_version IS NULL
      AND source_failure IS NOT NULL
    )
  ),
  CONSTRAINT legacy_subscription_reconciliation_evidence_record_shape_check CHECK (
    (
      source IN ('subscription_record', 'transaction_ledger_record')
      AND source_record_id IS NOT NULL
    )
    OR (
      source = 'provider_api'
      AND source_record_id IS NULL
    )
  )
);

CREATE INDEX legacy_subscription_reconciliation_evidence_run_idx
  ON public.legacy_subscription_reconciliation_evidence (
    reconciliation_run_id,
    source
  );

CREATE TABLE public.legacy_subscription_ownership_links (
  subscription_id uuid PRIMARY KEY
    REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  reconciliation_run_id uuid NOT NULL UNIQUE,
  sponsor_identity_id uuid NOT NULL
    REFERENCES public.sponsor_identities(id) ON DELETE RESTRICT,
  claimed_email_hmac bytea NOT NULL,
  email_normalization_version smallint NOT NULL,
  email_hmac_key_version smallint NOT NULL,
  claimed_auth_user_id uuid NOT NULL,
  email_verification_id uuid NOT NULL
    REFERENCES public.sponsor_account_email_verifications(id) ON DELETE RESTRICT,
  account_claim_id uuid
    REFERENCES public.sponsorship_account_claims(id) ON DELETE RESTRICT,
  attached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT legacy_subscription_ownership_links_run_fkey
    FOREIGN KEY (reconciliation_run_id, subscription_id)
    REFERENCES public.legacy_subscription_reconciliation_runs(id, subscription_id)
    ON DELETE RESTRICT,
  CONSTRAINT legacy_subscription_ownership_links_email_check CHECK (
    octet_length(claimed_email_hmac) = 32
    AND email_normalization_version = 1
    AND email_hmac_key_version = 1
  )
);

CREATE INDEX legacy_subscription_ownership_links_identity_idx
  ON public.legacy_subscription_ownership_links (
    sponsor_identity_id,
    attached_at DESC
  );

CREATE TABLE public.legacy_subscription_ownership_quarantines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL
    REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  reconciliation_run_id uuid NOT NULL,
  attempted_sponsor_identity_id uuid NOT NULL
    REFERENCES public.sponsor_identities(id) ON DELETE RESTRICT,
  attempted_auth_user_id uuid NOT NULL,
  reason public.legacy_subscription_quarantine_reason NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT legacy_subscription_ownership_quarantines_run_fkey
    FOREIGN KEY (reconciliation_run_id, subscription_id)
    REFERENCES public.legacy_subscription_reconciliation_runs(id, subscription_id)
    ON DELETE RESTRICT,
  CONSTRAINT legacy_subscription_ownership_quarantines_reason_check CHECK (
    reason IN (
      'identity_conflict',
      'account_conflict',
      'modern_payment_conflict'
    )
  ),
  CONSTRAINT legacy_subscription_ownership_quarantines_dedupe
    UNIQUE (
      subscription_id,
      reconciliation_run_id,
      attempted_sponsor_identity_id,
      attempted_auth_user_id,
      reason
    )
);

COMMENT ON TABLE public.legacy_subscription_reconciliation_runs IS
  'One immutable, complete app-tier HMAC reconciliation attempt for a pre-intent recurring sponsorship. Finalized attempts resolve to one digest or remain durably quarantined.';
COMMENT ON TABLE public.legacy_subscription_reconciliation_evidence IS
  'Digest-only provenance from the subscription row, safely correlated ledger rows, and the exact Stripe or PayPal subscription API. Plaintext email is never stored here.';
COMMENT ON COLUMN public.legacy_subscription_reconciliation_evidence.evidence_payload_sha256 IS
  'SHA-256 of a canonical evidence envelope containing the source identity, HMAC digest, non-contact facts, and batch nonce. It must never be a bare low-entropy email hash.';
COMMENT ON TABLE public.legacy_subscription_ownership_links IS
  'Append-only proof that a fresh verified account email attached one resolved historical subscription to a stable sponsor identity.';
COMMENT ON COLUMN public.legacy_subscription_ownership_links.claimed_auth_user_id IS
  'Forensic account UUID retained as immutable ownership evidence. Runtime authorization follows sponsor_identity_id and subscriptions.user_id.';

CREATE OR REPLACE FUNCTION private.protect_legacy_subscription_reconciliation_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legacy subscription reconciliation runs cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'collecting' THEN
      RAISE EXCEPTION 'Legacy subscription reconciliation runs must begin collecting'
        USING ERRCODE = '23514';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status <> 'collecting' THEN
    RAISE EXCEPTION 'Finalized legacy subscription reconciliation evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope
     OR NEW.provider_subscription_reference_digest IS DISTINCT FROM OLD.provider_subscription_reference_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Legacy subscription reconciliation provenance is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status NOT IN ('resolved', 'quarantined') THEN
    RAISE EXCEPTION 'Legacy subscription reconciliation must finalize as resolved or quarantined'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
     AND NEW.finalized_at IS NOT NULL THEN
    NEW.finalized_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.prevent_legacy_subscription_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Legacy subscription evidence is append only'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION private.is_legacy_subscription_ledger_candidate(
  target_subscription_id uuid,
  target_ledger_id uuid
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
    JOIN public.transaction_ledger ledger
      ON ledger.id = target_ledger_id
    WHERE subscription.id = target_subscription_id
      AND subscription.sponsorship_intent_id IS NULL
      AND ledger.sponsorship_intent_id IS NULL
      AND (
        ledger.subscription_id = subscription.id
        OR (
          ledger.subscription_id IS NULL
          AND ledger.tx_action = 'SPONSORSHIP'
          AND ledger.subscription_type = 'subscription'
          AND nullif(btrim(ledger.reference), '') IS NOT NULL
          AND ledger.reference = subscription.stripe_subscription_id
        )
        OR (
          ledger.subscription_id IS NULL
          AND ledger.tx_action = 'SPONSORSHIP'
          AND ledger.subscription_type = 'subscription'
          AND nullif(btrim(ledger.customer_id), '') IS NOT NULL
          AND ledger.customer_id = subscription.customer_id
          AND ledger.beneficiary_id IS NOT DISTINCT FROM subscription.beneficiary_id
          AND ledger.created_at >= subscription.created_at - interval '1 day'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.protect_legacy_subscription_reconciliation_run()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_legacy_subscription_evidence_mutation()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_legacy_subscription_ledger_candidate(uuid, uuid)
  FROM PUBLIC;

CREATE TRIGGER legacy_subscription_reconciliation_runs_protect
BEFORE INSERT OR UPDATE OR DELETE
ON public.legacy_subscription_reconciliation_runs
FOR EACH ROW EXECUTE FUNCTION private.protect_legacy_subscription_reconciliation_run();

CREATE TRIGGER legacy_subscription_reconciliation_evidence_protect
BEFORE UPDATE OR DELETE
ON public.legacy_subscription_reconciliation_evidence
FOR EACH ROW EXECUTE FUNCTION private.prevent_legacy_subscription_evidence_mutation();

CREATE TRIGGER legacy_subscription_ownership_links_protect
BEFORE UPDATE OR DELETE
ON public.legacy_subscription_ownership_links
FOR EACH ROW EXECUTE FUNCTION private.prevent_legacy_subscription_evidence_mutation();

CREATE TRIGGER legacy_subscription_ownership_quarantines_protect
BEFORE UPDATE OR DELETE
ON public.legacy_subscription_ownership_quarantines
FOR EACH ROW EXECUTE FUNCTION private.prevent_legacy_subscription_evidence_mutation();

ALTER TABLE public.legacy_subscription_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_subscription_reconciliation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_subscription_ownership_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_subscription_ownership_quarantines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.legacy_subscription_reconciliation_runs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.legacy_subscription_reconciliation_evidence
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.legacy_subscription_ownership_links
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.legacy_subscription_ownership_quarantines
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.legacy_subscription_reconciliation_runs TO service_role;
GRANT SELECT ON public.legacy_subscription_reconciliation_evidence TO service_role;
GRANT SELECT ON public.legacy_subscription_ownership_links TO service_role;
GRANT SELECT ON public.legacy_subscription_ownership_quarantines TO service_role;

CREATE TRIGGER legacy_subscription_reconciliation_runs_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.legacy_subscription_reconciliation_runs
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'canonical_email_hmac',
  'provider_subscription_reference_digest'
);

CREATE TRIGGER legacy_subscription_reconciliation_evidence_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.legacy_subscription_reconciliation_evidence
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'source_reference_digest',
  'email_hmac',
  'evidence_payload_sha256'
);

CREATE TRIGGER legacy_subscription_ownership_links_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.legacy_subscription_ownership_links
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'claimed_email_hmac'
);

CREATE TRIGGER legacy_subscription_ownership_quarantines_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.legacy_subscription_ownership_quarantines
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE OR REPLACE FUNCTION public.begin_legacy_subscription_reconciliation(
  target_subscription_id uuid,
  target_batch_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS public.legacy_subscription_reconciliation_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_run public.legacy_subscription_reconciliation_runs%ROWTYPE;
  v_provider public.sponsorship_method;
  v_provider_account_scope text;
  v_provider_reference_digest bytea;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_subscription_id IS NULL OR target_batch_id IS NULL THEN
    RAISE EXCEPTION 'Legacy reconciliation requires a subscription and batch id'
      USING ERRCODE = '22023';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = target_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy subscription does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_subscription.sponsorship_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Modern payment-chain subscriptions do not use legacy reconciliation'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.legacy_subscription_ownership_links ownership
    WHERE ownership.subscription_id = v_subscription.id
  ) THEN
    RAISE EXCEPTION 'Legacy subscription ownership is already attached'
      USING ERRCODE = '23505';
  END IF;

  v_provider := v_subscription.sponsorship_method;
  v_provider_account_scope := CASE
    WHEN v_provider = 'STRIPE'
      THEN 'stripe_' || v_subscription.payment_region::text
    WHEN v_provider = 'PAYPAL'
      THEN 'paypal'
    ELSE NULL
  END;

  IF v_provider IS NOT NULL
     AND nullif(btrim(v_subscription.stripe_subscription_id), '') IS NOT NULL THEN
    v_provider_reference_digest := extensions.digest(
      concat_ws(
        ':',
        'provider_subscription',
        v_provider::text,
        v_provider_account_scope,
        v_subscription.stripe_subscription_id
      ),
      'sha256'
    );
  END IF;

  SELECT run.*
  INTO v_run
  FROM public.legacy_subscription_reconciliation_runs run
  WHERE run.subscription_id = target_subscription_id
    AND run.batch_id = target_batch_id;

  IF FOUND THEN
    IF v_run.provider IS DISTINCT FROM v_provider
       OR v_run.provider_account_scope IS DISTINCT FROM v_provider_account_scope
       OR v_run.provider_subscription_reference_digest IS DISTINCT FROM v_provider_reference_digest THEN
      RAISE EXCEPTION 'Replayed legacy reconciliation no longer matches provider provenance'
        USING ERRCODE = '23514';
    END IF;
    RETURN v_run;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'legacy_subscription_reconciler',
    context_tool => 'begin_legacy_subscription_reconciliation',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Begin digest-only historical subscription ownership scan',
    context_metadata => jsonb_build_object(
      'operation', 'begin_reconciliation',
      'resource_kind', 'subscription',
      'resource_id', target_subscription_id::text,
      'batch_id', target_batch_id::text,
      'outcome', 'collecting'
    )
  );

  INSERT INTO public.legacy_subscription_reconciliation_runs (
    subscription_id,
    batch_id,
    provider,
    provider_account_scope,
    provider_subscription_reference_digest
  )
  VALUES (
    target_subscription_id,
    target_batch_id,
    v_provider,
    v_provider_account_scope,
    v_provider_reference_digest
  )
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_legacy_subscription_email_evidence(
  target_reconciliation_run_id uuid,
  target_source public.legacy_subscription_evidence_source,
  target_source_record_id uuid,
  target_provider_subscription_id text,
  target_outcome public.legacy_subscription_evidence_outcome,
  target_email_hmac bytea,
  target_email_normalization_version smallint,
  target_email_hmac_key_version smallint,
  target_source_failure public.legacy_subscription_source_failure,
  target_evidence_payload_sha256 bytea,
  target_observed_at timestamptz,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS public.legacy_subscription_reconciliation_evidence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_run public.legacy_subscription_reconciliation_runs%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_ledger public.transaction_ledger%ROWTYPE;
  v_evidence public.legacy_subscription_reconciliation_evidence%ROWTYPE;
  v_source_reference_digest bytea;
  v_contact_is_present boolean;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_reconciliation_run_id IS NULL
     OR target_source IS NULL
     OR target_outcome IS NULL
     OR octet_length(target_evidence_payload_sha256) IS DISTINCT FROM 32
     OR target_observed_at IS NULL
     OR target_observed_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Legacy reconciliation evidence input is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_outcome = 'email_observed' AND (
    octet_length(target_email_hmac) IS DISTINCT FROM 32
    OR target_email_normalization_version IS DISTINCT FROM 1
    OR target_email_hmac_key_version IS DISTINCT FROM 1
    OR target_source_failure IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Observed email evidence requires the canonical versioned HMAC'
      USING ERRCODE = '22023';
  ELSIF target_outcome = 'email_absent' AND (
    target_email_hmac IS NOT NULL
    OR target_email_normalization_version IS NOT NULL
    OR target_email_hmac_key_version IS NOT NULL
    OR target_source_failure IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Absent email evidence cannot contain contact or failure facts'
      USING ERRCODE = '22023';
  ELSIF target_outcome = 'source_unavailable' AND (
    target_email_hmac IS NOT NULL
    OR target_email_normalization_version IS NOT NULL
    OR target_email_hmac_key_version IS NOT NULL
    OR target_source_failure IS NULL
  ) THEN
    RAISE EXCEPTION 'Unavailable source evidence requires one allowlisted failure fact'
      USING ERRCODE = '22023';
  END IF;

  SELECT run.*
  INTO v_run
  FROM public.legacy_subscription_reconciliation_runs run
  WHERE run.id = target_reconciliation_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy reconciliation run does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_run.status <> 'collecting' THEN
    RAISE EXCEPTION 'Finalized legacy reconciliation runs cannot accept evidence'
      USING ERRCODE = '42501';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = v_run.subscription_id
  FOR SHARE;

  IF target_source = 'subscription_record' THEN
    IF target_source_record_id IS DISTINCT FROM v_subscription.id
       OR target_provider_subscription_id IS NOT NULL
       OR target_outcome = 'source_unavailable' THEN
      RAISE EXCEPTION 'Subscription evidence must describe the exact local row'
        USING ERRCODE = '23514';
    END IF;

    v_contact_is_present := nullif(btrim(v_subscription.email), '') IS NOT NULL;
    v_source_reference_digest := extensions.digest(
      'subscription:' || v_subscription.id::text,
      'sha256'
    );
  ELSIF target_source = 'transaction_ledger_record' THEN
    IF target_source_record_id IS NULL
       OR target_provider_subscription_id IS NOT NULL
       OR target_outcome = 'source_unavailable'
       OR NOT private.is_legacy_subscription_ledger_candidate(
         v_subscription.id,
         target_source_record_id
       ) THEN
      RAISE EXCEPTION 'Ledger evidence must be safely correlated to the legacy subscription'
        USING ERRCODE = '23514';
    END IF;

    SELECT ledger.*
    INTO v_ledger
    FROM public.transaction_ledger ledger
    WHERE ledger.id = target_source_record_id
    FOR SHARE;

    v_contact_is_present := nullif(btrim(v_ledger.customer_email), '') IS NOT NULL;
    v_source_reference_digest := extensions.digest(
      'transaction_ledger:' || v_ledger.id::text,
      'sha256'
    );
  ELSE
    IF target_source_record_id IS NOT NULL
       OR v_run.provider IS NULL
       OR v_run.provider_subscription_reference_digest IS NULL
       OR nullif(btrim(target_provider_subscription_id), '') IS NULL
       OR target_provider_subscription_id IS DISTINCT FROM
         v_subscription.stripe_subscription_id THEN
      RAISE EXCEPTION 'Provider evidence must describe the exact Stripe or PayPal subscription'
        USING ERRCODE = '23514';
    END IF;

    v_source_reference_digest := extensions.digest(
      concat_ws(
        ':',
        'provider_subscription',
        v_run.provider::text,
        v_run.provider_account_scope,
        target_provider_subscription_id
      ),
      'sha256'
    );

    IF v_source_reference_digest IS DISTINCT FROM
       v_run.provider_subscription_reference_digest THEN
      RAISE EXCEPTION 'Provider evidence reference does not match the reconciliation run'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF target_source <> 'provider_api' AND (
    (v_contact_is_present AND target_outcome <> 'email_observed')
    OR (NOT v_contact_is_present AND target_outcome <> 'email_absent')
  ) THEN
    RAISE EXCEPTION 'Local evidence outcome does not match contact presence'
      USING ERRCODE = '23514';
  END IF;

  SELECT evidence.*
  INTO v_evidence
  FROM public.legacy_subscription_reconciliation_evidence evidence
  WHERE evidence.reconciliation_run_id = v_run.id
    AND evidence.source = target_source
    AND evidence.source_reference_digest = v_source_reference_digest;

  IF FOUND THEN
    IF v_evidence.source_record_id IS DISTINCT FROM target_source_record_id
       OR v_evidence.outcome IS DISTINCT FROM target_outcome
       OR v_evidence.email_hmac IS DISTINCT FROM target_email_hmac
       OR v_evidence.email_normalization_version IS DISTINCT FROM target_email_normalization_version
       OR v_evidence.email_hmac_key_version IS DISTINCT FROM target_email_hmac_key_version
       OR v_evidence.source_failure IS DISTINCT FROM target_source_failure
       OR v_evidence.evidence_payload_sha256 IS DISTINCT FROM target_evidence_payload_sha256
       OR v_evidence.observed_at IS DISTINCT FROM target_observed_at THEN
      RAISE EXCEPTION 'Evidence source was already recorded with different facts'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_evidence;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'legacy_subscription_reconciler',
    context_tool => 'record_legacy_subscription_email_evidence',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Record app-tier HMAC historical ownership evidence',
    context_metadata => jsonb_build_object(
      'operation', 'record_evidence',
      'resource_kind', 'subscription',
      'resource_id', v_subscription.id::text,
      'batch_id', v_run.batch_id::text,
      'provider', COALESCE(v_run.provider::text, 'unknown'),
      'provider_account_scope', v_run.provider_account_scope,
      'outcome', target_outcome::text
    )
  );

  INSERT INTO public.legacy_subscription_reconciliation_evidence (
    reconciliation_run_id,
    subscription_id,
    source,
    source_record_id,
    source_reference_digest,
    outcome,
    email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    source_failure,
    evidence_payload_sha256,
    observed_at
  )
  VALUES (
    v_run.id,
    v_subscription.id,
    target_source,
    target_source_record_id,
    v_source_reference_digest,
    target_outcome,
    target_email_hmac,
    target_email_normalization_version,
    target_email_hmac_key_version,
    target_source_failure,
    target_evidence_payload_sha256,
    target_observed_at
  )
  RETURNING * INTO v_evidence;

  RETURN v_evidence;
END;
$$;

CREATE OR REPLACE FUNCTION private.attach_resolved_legacy_subscriptions(
  target_email_hmac bytea,
  target_email_normalization_version smallint,
  target_email_hmac_key_version smallint,
  target_sponsor_identity_id uuid,
  target_auth_user_id uuid,
  target_email_verification_id uuid,
  target_account_claim_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_run public.legacy_subscription_reconciliation_runs%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_conflict_reason public.legacy_subscription_quarantine_reason;
  v_attached_count integer := 0;
  v_quarantined_count integer := 0;
BEGIN
  IF octet_length(target_email_hmac) IS DISTINCT FROM 32
     OR target_email_normalization_version IS DISTINCT FROM 1
     OR target_email_hmac_key_version IS DISTINCT FROM 1
     OR target_sponsor_identity_id IS NULL
     OR target_auth_user_id IS NULL
     OR target_email_verification_id IS NULL THEN
    RAISE EXCEPTION 'Legacy ownership attachment proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sponsor_identities identity
    JOIN public.sponsor_identifiers identifier
      ON identifier.sponsor_identity_id = identity.id
    WHERE identity.id = target_sponsor_identity_id
      AND identity.auth_user_id = target_auth_user_id
      AND identity.status = 'active'
      AND identifier.kind = 'email'
      AND identifier.issuer_scope = 'creator_share'
      AND identifier.identifier_digest = target_email_hmac
      AND identifier.normalization_version = target_email_normalization_version
      AND identifier.hmac_key_version = target_email_hmac_key_version
      AND identifier.confidence = 'verified'
      AND identifier.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Legacy ownership attachment requires the account verified sponsor identity'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sponsor_account_email_verifications proof
    WHERE proof.id = target_email_verification_id
      AND proof.auth_user_id = target_auth_user_id
      AND proof.issuer_scope = 'creator_share'
      AND proof.email_hmac = target_email_hmac
      AND proof.normalization_version = target_email_normalization_version
      AND proof.hmac_key_version = target_email_hmac_key_version
      AND proof.status = 'consumed'
  ) THEN
    RAISE EXCEPTION 'Legacy ownership attachment requires consumed email verification proof'
      USING ERRCODE = '23514';
  END IF;

  IF target_account_claim_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_account_claims claim
    WHERE claim.id = target_account_claim_id
      AND claim.target_auth_user_id = target_auth_user_id
      AND claim.sponsor_identity_id = target_sponsor_identity_id
      AND claim.email_hmac = target_email_hmac
      AND claim.email_normalization_version = target_email_normalization_version
      AND claim.email_hmac_key_version = target_email_hmac_key_version
      AND claim.status = 'consumed'
  ) THEN
    RAISE EXCEPTION 'Legacy ownership account claim does not match the verified account'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.encode(target_email_hmac, 'hex'),
      716133006
    )
  );

  FOR v_run IN
    WITH latest AS (
      SELECT DISTINCT ON (run.subscription_id)
        run.*
      FROM public.legacy_subscription_reconciliation_runs run
      WHERE run.status <> 'collecting'
      ORDER BY
        run.subscription_id,
        run.finalized_at DESC,
        run.created_at DESC,
        run.id DESC
    )
    SELECT latest.*
    FROM latest
    LEFT JOIN public.legacy_subscription_ownership_links ownership
      ON ownership.subscription_id = latest.subscription_id
    WHERE latest.status = 'resolved'
      AND latest.canonical_email_hmac = target_email_hmac
      AND latest.email_normalization_version = target_email_normalization_version
      AND latest.email_hmac_key_version = target_email_hmac_key_version
      AND ownership.subscription_id IS NULL
    ORDER BY latest.finalized_at, latest.id
  LOOP
    SELECT subscription.*
    INTO v_subscription
    FROM public.subscriptions subscription
    WHERE subscription.id = v_run.subscription_id
    FOR UPDATE;

    v_conflict_reason := NULL;

    IF v_subscription.sponsorship_intent_id IS NOT NULL THEN
      v_conflict_reason := 'modern_payment_conflict';
    ELSIF v_subscription.sponsor_identity_id IS NOT NULL
       AND v_subscription.sponsor_identity_id <> target_sponsor_identity_id THEN
      v_conflict_reason := 'identity_conflict';
    ELSIF EXISTS (
      SELECT 1
      FROM public.legacy_subscription_reconciliation_evidence evidence
      JOIN public.transaction_ledger ledger
        ON ledger.id = evidence.source_record_id
      WHERE evidence.reconciliation_run_id = v_run.id
        AND evidence.source = 'transaction_ledger_record'
        AND ledger.sponsor_identity_id IS NOT NULL
        AND ledger.sponsor_identity_id <> target_sponsor_identity_id
    ) THEN
      v_conflict_reason := 'identity_conflict';
    ELSIF v_subscription.user_id IS NOT NULL
       AND v_subscription.user_id <> target_auth_user_id THEN
      v_conflict_reason := 'account_conflict';
    ELSIF EXISTS (
      SELECT 1
      FROM public.legacy_subscription_reconciliation_evidence evidence
      JOIN public.transaction_ledger ledger
        ON ledger.id = evidence.source_record_id
      WHERE evidence.reconciliation_run_id = v_run.id
        AND evidence.source = 'transaction_ledger_record'
        AND ledger.user_id IS NOT NULL
        AND ledger.user_id <> target_auth_user_id
    ) THEN
      v_conflict_reason := 'account_conflict';
    END IF;

    IF v_conflict_reason IS NOT NULL THEN
      INSERT INTO public.legacy_subscription_ownership_quarantines (
        subscription_id,
        reconciliation_run_id,
        attempted_sponsor_identity_id,
        attempted_auth_user_id,
        reason
      )
      VALUES (
        v_subscription.id,
        v_run.id,
        target_sponsor_identity_id,
        target_auth_user_id,
        v_conflict_reason
      )
      ON CONFLICT DO NOTHING;

      v_quarantined_count := v_quarantined_count + 1;
      CONTINUE;
    END IF;

    UPDATE public.subscriptions
    SET
      sponsor_identity_id = target_sponsor_identity_id,
      user_id = target_auth_user_id
    WHERE id = v_subscription.id;

    UPDATE public.transaction_ledger ledger
    SET
      sponsor_identity_id = target_sponsor_identity_id,
      user_id = target_auth_user_id
    FROM public.legacy_subscription_reconciliation_evidence evidence
    WHERE evidence.reconciliation_run_id = v_run.id
      AND evidence.source = 'transaction_ledger_record'
      AND evidence.source_record_id = ledger.id;

    INSERT INTO public.legacy_subscription_ownership_links (
      subscription_id,
      reconciliation_run_id,
      sponsor_identity_id,
      claimed_email_hmac,
      email_normalization_version,
      email_hmac_key_version,
      claimed_auth_user_id,
      email_verification_id,
      account_claim_id
    )
    VALUES (
      v_subscription.id,
      v_run.id,
      target_sponsor_identity_id,
      target_email_hmac,
      target_email_normalization_version,
      target_email_hmac_key_version,
      target_auth_user_id,
      target_email_verification_id,
      target_account_claim_id
    )
    ON CONFLICT (subscription_id) DO NOTHING;

    IF FOUND THEN
      v_attached_count := v_attached_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'attached_count', v_attached_count,
    'quarantined_count', v_quarantined_count
  );
END;
$$;

REVOKE ALL ON FUNCTION private.attach_resolved_legacy_subscriptions(
  bytea,
  smallint,
  smallint,
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_legacy_subscriptions_for_verified_email(
  target_email_hmac bytea,
  target_email_normalization_version smallint DEFAULT 1,
  target_email_hmac_key_version smallint DEFAULT 1,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  sponsor_identity_id uuid,
  auth_user_id uuid,
  attached_subscription_count integer,
  quarantined_subscription_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_identity public.sponsor_identities%ROWTYPE;
  v_digest_identity public.sponsor_identities%ROWTYPE;
  v_identifier public.sponsor_identifiers%ROWTYPE;
  v_proof public.sponsor_account_email_verifications%ROWTYPE;
  v_attach_result jsonb;
  v_requires_fresh_proof boolean := false;
BEGIN
  IF pg_catalog.current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'authenticated'
     OR v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Legacy subscription claims require the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  IF octet_length(target_email_hmac) IS DISTINCT FROM 32
     OR target_email_normalization_version IS DISTINCT FROM 1
     OR target_email_hmac_key_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Legacy subscription claim email proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users auth_user
    JOIN public.users application_user ON application_user.id = auth_user.id
    WHERE auth_user.id = v_auth_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
      AND nullif(btrim(auth_user.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Legacy subscription claim requires a confirmed application user'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_auth_user_id::text, 716133006)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.encode(target_email_hmac, 'hex'),
      716133006
    )
  );

  UPDATE public.sponsor_account_email_verifications proof
  SET status = 'expired'
  WHERE proof.auth_user_id = v_auth_user_id
    AND proof.status = 'issued'
    AND proof.expires_at <= clock_timestamp();

  SELECT identity.*
  INTO v_identity
  FROM public.sponsor_identities identity
  WHERE identity.auth_user_id = v_auth_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_identity.status <> 'active' THEN
      RAISE EXCEPTION 'Account sponsor identity is not active'
        USING ERRCODE = '23514';
    END IF;

    SELECT identifier.*
    INTO v_identifier
    FROM public.sponsor_identifiers identifier
    WHERE identifier.sponsor_identity_id = v_identity.id
      AND identifier.kind = 'email'
      AND identifier.issuer_scope = 'creator_share'
      AND identifier.identifier_digest = target_email_hmac
      AND identifier.normalization_version = target_email_normalization_version
      AND identifier.hmac_key_version = target_email_hmac_key_version
      AND identifier.revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Changing an account email does not claim another email history'
        USING ERRCODE = '23514';
    END IF;

    v_requires_fresh_proof := v_identifier.confidence <> 'verified';
  ELSE
    SELECT identity.*
    INTO v_digest_identity
    FROM public.sponsor_identities identity
    WHERE identity.id = (
      SELECT identifier.sponsor_identity_id
      FROM public.sponsor_identifiers identifier
      WHERE identifier.kind = 'email'
        AND identifier.issuer_scope = 'creator_share'
        AND identifier.identifier_digest = target_email_hmac
        AND identifier.normalization_version = target_email_normalization_version
        AND identifier.hmac_key_version = target_email_hmac_key_version
        AND identifier.revoked_at IS NULL
    )
    FOR UPDATE;

    IF FOUND THEN
      SELECT identifier.*
      INTO v_identifier
      FROM public.sponsor_identifiers identifier
      WHERE identifier.sponsor_identity_id = v_digest_identity.id
        AND identifier.kind = 'email'
        AND identifier.issuer_scope = 'creator_share'
        AND identifier.identifier_digest = target_email_hmac
        AND identifier.normalization_version = target_email_normalization_version
        AND identifier.hmac_key_version = target_email_hmac_key_version
        AND identifier.revoked_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Sponsor email identity changed during claim attachment'
          USING ERRCODE = '40001';
      END IF;

      IF v_digest_identity.status <> 'active'
         OR (
           v_digest_identity.auth_user_id IS NOT NULL
           AND v_digest_identity.auth_user_id <> v_auth_user_id
         ) THEN
        RAISE EXCEPTION 'Verified email history already belongs to another account'
          USING ERRCODE = '23505';
      END IF;
      v_identity := v_digest_identity;
    END IF;

    v_requires_fresh_proof := true;
  END IF;

  SELECT proof.*
  INTO v_proof
  FROM public.sponsor_account_email_verifications proof
  WHERE proof.auth_user_id = v_auth_user_id
    AND proof.issuer_scope = 'creator_share'
    AND proof.email_hmac = target_email_hmac
    AND proof.normalization_version = target_email_normalization_version
    AND proof.hmac_key_version = target_email_hmac_key_version
    AND proof.status = 'issued'
    AND proof.expires_at > clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND AND NOT v_requires_fresh_proof THEN
    SELECT proof.*
    INTO v_proof
    FROM public.sponsor_account_email_verifications proof
    WHERE proof.auth_user_id = v_auth_user_id
      AND proof.issuer_scope = 'creator_share'
      AND proof.email_hmac = target_email_hmac
      AND proof.normalization_version = target_email_normalization_version
      AND proof.hmac_key_version = target_email_hmac_key_version
      AND proof.status = 'consumed'
    ORDER BY proof.consumed_at DESC, proof.id DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A fresh verified account email proof is required'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user',
    context_actor_user_id => v_auth_user_id,
    context_effective_user_id => v_auth_user_id,
    context_tool => 'claim_legacy_subscriptions_for_verified_email',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Attach resolved historical subscriptions after verified email claim',
    context_metadata => jsonb_build_object(
      'operation', 'claim_legacy_subscriptions',
      'resource_kind', 'sponsor_identity',
      'resource_id', COALESCE(v_identity.id::text, v_auth_user_id::text),
      'outcome', 'verified'
    )
  );

  IF v_identity.id IS NULL THEN
    INSERT INTO public.sponsor_identities (auth_user_id)
    VALUES (v_auth_user_id)
    RETURNING * INTO v_identity;

    INSERT INTO public.sponsor_identifiers (
      sponsor_identity_id,
      kind,
      issuer_scope,
      identifier_digest,
      normalization_version,
      hmac_key_version,
      confidence
    )
    VALUES (
      v_identity.id,
      'email',
      'creator_share',
      target_email_hmac,
      target_email_normalization_version,
      target_email_hmac_key_version,
      'verified'
    )
    RETURNING * INTO v_identifier;
  ELSE
    IF v_identity.auth_user_id IS NULL THEN
      UPDATE public.sponsor_identities
      SET auth_user_id = v_auth_user_id
      WHERE id = v_identity.id
      RETURNING * INTO v_identity;
    END IF;

    IF v_identifier.confidence <> 'verified' THEN
      UPDATE public.sponsor_identifiers
      SET
        confidence = 'verified',
        last_seen_at = clock_timestamp()
      WHERE id = v_identifier.id
      RETURNING * INTO v_identifier;
    END IF;
  END IF;

  IF v_proof.status = 'issued' THEN
    UPDATE public.sponsor_account_email_verifications
    SET status = 'consumed'
    WHERE id = v_proof.id
    RETURNING * INTO v_proof;
  END IF;

  v_attach_result := private.attach_resolved_legacy_subscriptions(
    target_email_hmac,
    target_email_normalization_version,
    target_email_hmac_key_version,
    v_identity.id,
    v_auth_user_id,
    v_proof.id,
    NULL
  );

  RETURN QUERY SELECT
    v_identity.id,
    v_auth_user_id,
    COALESCE((v_attach_result ->> 'attached_count')::integer, 0),
    COALESCE((v_attach_result ->> 'quarantined_count')::integer, 0);
END;
$$;

CREATE OR REPLACE FUNCTION private.attach_legacy_subscriptions_after_account_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_proof_id uuid;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'consumed' THEN
    SELECT proof.id
    INTO v_proof_id
    FROM public.sponsor_account_email_verifications proof
    WHERE proof.auth_user_id = NEW.target_auth_user_id
      AND proof.issuer_scope = 'creator_share'
      AND proof.email_hmac = NEW.email_hmac
      AND proof.normalization_version = NEW.email_normalization_version
      AND proof.hmac_key_version = NEW.email_hmac_key_version
      AND proof.status = 'consumed'
    ORDER BY proof.consumed_at DESC, proof.id DESC
    LIMIT 1;

    IF v_proof_id IS NULL THEN
      RAISE EXCEPTION 'Consumed sponsorship claim is missing its email verification proof'
        USING ERRCODE = '23514';
    END IF;

    PERFORM private.attach_resolved_legacy_subscriptions(
      NEW.email_hmac,
      NEW.email_normalization_version,
      NEW.email_hmac_key_version,
      NEW.sponsor_identity_id,
      NEW.target_auth_user_id,
      v_proof_id,
      NEW.id
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.attach_legacy_subscriptions_after_account_claim()
  FROM PUBLIC;

CREATE TRIGGER sponsorship_account_claims_attach_legacy_subscriptions
AFTER UPDATE ON public.sponsorship_account_claims
FOR EACH ROW
WHEN (OLD.status = 'pending' AND NEW.status = 'consumed')
EXECUTE FUNCTION private.attach_legacy_subscriptions_after_account_claim();

CREATE OR REPLACE FUNCTION public.finalize_legacy_subscription_reconciliation(
  target_reconciliation_run_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS public.legacy_subscription_reconciliation_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_run public.legacy_subscription_reconciliation_runs%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_evidence_count integer;
  v_observed_email_count integer;
  v_distinct_email_count integer;
  v_subscription_evidence_count integer;
  v_provider_evidence_count integer;
  v_expected_ledger_count integer;
  v_recorded_ledger_count integer;
  v_canonical_email_hmac bytea;
  v_quarantine_reason public.legacy_subscription_quarantine_reason;
  v_existing_identity_count integer;
  v_existing_identity_id uuid;
  v_existing_account_count integer;
  v_existing_account_id uuid;
  v_identity_auth_user_id uuid;
  v_auto_identity_id uuid;
  v_auto_auth_user_id uuid;
  v_auto_proof_id uuid;
  v_auto_claim_id uuid;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT run.*
  INTO v_run
  FROM public.legacy_subscription_reconciliation_runs run
  WHERE run.id = target_reconciliation_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy reconciliation run does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_run.status <> 'collecting' THEN
    RETURN v_run;
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = v_run.subscription_id
  FOR UPDATE;

  IF v_subscription.sponsorship_intent_id IS NOT NULL THEN
    v_quarantine_reason := 'modern_payment_conflict';
  ELSIF v_run.provider IS NULL THEN
    v_quarantine_reason := 'provider_unknown';
  ELSIF v_run.provider_subscription_reference_digest IS NULL THEN
    v_quarantine_reason := 'provider_reference_missing';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE evidence.outcome = 'email_observed')::integer,
    count(DISTINCT ROW(
      evidence.email_hmac,
      evidence.email_normalization_version,
      evidence.email_hmac_key_version
    )) FILTER (WHERE evidence.outcome = 'email_observed')::integer
  INTO
    v_evidence_count,
    v_observed_email_count,
    v_distinct_email_count
  FROM public.legacy_subscription_reconciliation_evidence evidence
  WHERE evidence.reconciliation_run_id = v_run.id;

  SELECT evidence.email_hmac
  INTO v_canonical_email_hmac
  FROM public.legacy_subscription_reconciliation_evidence evidence
  WHERE evidence.reconciliation_run_id = v_run.id
    AND evidence.outcome = 'email_observed'
  ORDER BY evidence.id
  LIMIT 1;

  SELECT count(*)::integer
  INTO v_subscription_evidence_count
  FROM public.legacy_subscription_reconciliation_evidence evidence
  WHERE evidence.reconciliation_run_id = v_run.id
    AND evidence.source = 'subscription_record'
    AND evidence.source_record_id = v_subscription.id;

  SELECT count(*)::integer
  INTO v_provider_evidence_count
  FROM public.legacy_subscription_reconciliation_evidence evidence
  WHERE evidence.reconciliation_run_id = v_run.id
    AND evidence.source = 'provider_api'
    AND evidence.source_reference_digest =
      v_run.provider_subscription_reference_digest;

  SELECT count(*)::integer
  INTO v_expected_ledger_count
  FROM public.transaction_ledger ledger
  WHERE private.is_legacy_subscription_ledger_candidate(
    v_subscription.id,
    ledger.id
  );

  SELECT count(*)::integer
  INTO v_recorded_ledger_count
  FROM public.legacy_subscription_reconciliation_evidence evidence
  WHERE evidence.reconciliation_run_id = v_run.id
    AND evidence.source = 'transaction_ledger_record';

  IF v_quarantine_reason IS NULL AND (
    v_subscription_evidence_count <> 1
    OR v_provider_evidence_count <> 1
    OR v_recorded_ledger_count <> v_expected_ledger_count
    OR v_evidence_count <> 2 + v_expected_ledger_count
  ) THEN
    v_quarantine_reason := 'incomplete_manifest';
  END IF;

  IF v_quarantine_reason IS NULL AND EXISTS (
    SELECT 1
    FROM public.legacy_subscription_reconciliation_evidence evidence
    WHERE evidence.reconciliation_run_id = v_run.id
      AND evidence.outcome = 'source_unavailable'
      AND NOT (
        evidence.source = 'provider_api'
        AND evidence.source_failure = 'not_found'
        AND v_subscription.status = 'cancelled'
      )
  ) THEN
    v_quarantine_reason := 'source_unavailable';
  END IF;

  IF v_quarantine_reason IS NULL AND v_observed_email_count = 0 THEN
    v_quarantine_reason := 'no_email_evidence';
  ELSIF v_quarantine_reason IS NULL AND v_distinct_email_count <> 1 THEN
    v_quarantine_reason := 'email_conflict';
  END IF;

  IF v_quarantine_reason IS NULL THEN
    SELECT
      count(DISTINCT identities.identity_id)::integer,
      min(identities.identity_id::text)::uuid
    INTO v_existing_identity_count, v_existing_identity_id
    FROM (
      SELECT v_subscription.sponsor_identity_id AS identity_id
      WHERE v_subscription.sponsor_identity_id IS NOT NULL
      UNION ALL
      SELECT ledger.sponsor_identity_id
      FROM public.legacy_subscription_reconciliation_evidence evidence
      JOIN public.transaction_ledger ledger
        ON ledger.id = evidence.source_record_id
      WHERE evidence.reconciliation_run_id = v_run.id
        AND evidence.source = 'transaction_ledger_record'
        AND ledger.sponsor_identity_id IS NOT NULL
    ) identities;

    IF v_existing_identity_count > 1 THEN
      v_quarantine_reason := 'identity_conflict';
    ELSIF v_existing_identity_count = 1 THEN
      SELECT identity.auth_user_id
      INTO v_identity_auth_user_id
      FROM public.sponsor_identities identity
      WHERE identity.id = v_existing_identity_id
        AND identity.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM public.sponsor_identifiers identifier
          WHERE identifier.sponsor_identity_id = identity.id
            AND identifier.kind = 'email'
            AND identifier.issuer_scope = 'creator_share'
            AND identifier.identifier_digest = v_canonical_email_hmac
            AND identifier.normalization_version = 1
            AND identifier.hmac_key_version = 1
            AND identifier.revoked_at IS NULL
        );

      IF NOT FOUND THEN
        v_quarantine_reason := 'identity_conflict';
      END IF;
    END IF;
  END IF;

  IF v_quarantine_reason IS NULL THEN
    SELECT
      count(DISTINCT accounts.account_id)::integer,
      min(accounts.account_id::text)::uuid
    INTO v_existing_account_count, v_existing_account_id
    FROM (
      SELECT v_subscription.user_id AS account_id
      WHERE v_subscription.user_id IS NOT NULL
      UNION ALL
      SELECT ledger.user_id
      FROM public.legacy_subscription_reconciliation_evidence evidence
      JOIN public.transaction_ledger ledger
        ON ledger.id = evidence.source_record_id
      WHERE evidence.reconciliation_run_id = v_run.id
        AND evidence.source = 'transaction_ledger_record'
        AND ledger.user_id IS NOT NULL
    ) accounts;

    IF v_existing_account_count > 1
       OR (
         v_existing_account_count = 1
         AND v_identity_auth_user_id IS NOT NULL
         AND v_identity_auth_user_id <> v_existing_account_id
       ) THEN
      v_quarantine_reason := 'account_conflict';
    END IF;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_system_actor => 'legacy_subscription_reconciler',
    context_tool => 'finalize_legacy_subscription_reconciliation',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Finalize complete historical subscription ownership evidence manifest',
    context_metadata => jsonb_build_object(
      'operation', 'finalize_reconciliation',
      'resource_kind', 'subscription',
      'resource_id', v_subscription.id::text,
      'batch_id', v_run.batch_id::text,
      'provider', COALESCE(v_run.provider::text, 'unknown'),
      'provider_account_scope', v_run.provider_account_scope,
      'outcome', CASE
        WHEN v_quarantine_reason IS NULL THEN 'resolved'
        ELSE 'quarantined'
      END
    )
  );

  IF v_quarantine_reason IS NULL THEN
    UPDATE public.legacy_subscription_reconciliation_runs
    SET
      status = 'resolved',
      canonical_email_hmac = v_canonical_email_hmac,
      email_normalization_version = 1,
      email_hmac_key_version = 1,
      evidence_count = v_evidence_count,
      observed_email_count = v_observed_email_count,
      distinct_email_count = v_distinct_email_count,
      finalized_at = clock_timestamp()
    WHERE id = v_run.id
    RETURNING * INTO v_run;
  ELSE
    UPDATE public.legacy_subscription_reconciliation_runs
    SET
      status = 'quarantined',
      quarantine_reason = v_quarantine_reason,
      evidence_count = v_evidence_count,
      observed_email_count = v_observed_email_count,
      distinct_email_count = v_distinct_email_count,
      finalized_at = clock_timestamp()
    WHERE id = v_run.id
    RETURNING * INTO v_run;
  END IF;

  IF v_run.status = 'resolved' THEN
    SELECT
      identity.id,
      identity.auth_user_id,
      proof.id
    INTO
      v_auto_identity_id,
      v_auto_auth_user_id,
      v_auto_proof_id
    FROM public.sponsor_identifiers identifier
    JOIN public.sponsor_identities identity
      ON identity.id = identifier.sponsor_identity_id
    JOIN LATERAL (
      SELECT verification.id
      FROM public.sponsor_account_email_verifications verification
      WHERE verification.auth_user_id = identity.auth_user_id
        AND verification.issuer_scope = 'creator_share'
        AND verification.email_hmac = identifier.identifier_digest
        AND verification.normalization_version = identifier.normalization_version
        AND verification.hmac_key_version = identifier.hmac_key_version
        AND verification.status = 'consumed'
      ORDER BY verification.consumed_at DESC, verification.id DESC
      LIMIT 1
    ) proof ON true
    WHERE identifier.kind = 'email'
      AND identifier.issuer_scope = 'creator_share'
      AND identifier.identifier_digest = v_run.canonical_email_hmac
      AND identifier.normalization_version = v_run.email_normalization_version
      AND identifier.hmac_key_version = v_run.email_hmac_key_version
      AND identifier.confidence = 'verified'
      AND identifier.revoked_at IS NULL
      AND identity.status = 'active'
      AND identity.auth_user_id IS NOT NULL;

    IF v_auto_identity_id IS NOT NULL THEN
      SELECT claim.id
      INTO v_auto_claim_id
      FROM public.sponsorship_account_claims claim
      WHERE claim.sponsor_identity_id = v_auto_identity_id
        AND claim.target_auth_user_id = v_auto_auth_user_id
        AND claim.email_hmac = v_run.canonical_email_hmac
        AND claim.email_normalization_version = v_run.email_normalization_version
        AND claim.email_hmac_key_version = v_run.email_hmac_key_version
        AND claim.status = 'consumed'
      ORDER BY claim.consumed_at DESC, claim.id DESC
      LIMIT 1;

      PERFORM private.attach_resolved_legacy_subscriptions(
        v_run.canonical_email_hmac,
        v_run.email_normalization_version,
        v_run.email_hmac_key_version,
        v_auto_identity_id,
        v_auto_auth_user_id,
        v_auto_proof_id,
        v_auto_claim_id
      );
    END IF;
  END IF;

  RETURN v_run;
END;
$$;

CREATE TRIGGER legacy_subscription_reconciliation_runs_no_truncate
BEFORE TRUNCATE ON public.legacy_subscription_reconciliation_runs
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER legacy_subscription_reconciliation_evidence_no_truncate
BEFORE TRUNCATE ON public.legacy_subscription_reconciliation_evidence
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER legacy_subscription_ownership_links_no_truncate
BEFORE TRUNCATE ON public.legacy_subscription_ownership_links
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER legacy_subscription_ownership_quarantines_no_truncate
BEFORE TRUNCATE ON public.legacy_subscription_ownership_quarantines
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

REVOKE ALL ON FUNCTION public.begin_legacy_subscription_reconciliation(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_legacy_subscription_email_evidence(
  uuid,
  public.legacy_subscription_evidence_source,
  uuid,
  text,
  public.legacy_subscription_evidence_outcome,
  bytea,
  smallint,
  smallint,
  public.legacy_subscription_source_failure,
  bytea,
  timestamptz,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_legacy_subscription_reconciliation(
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_legacy_subscriptions_for_verified_email(
  bytea,
  smallint,
  smallint,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.begin_legacy_subscription_reconciliation(
  uuid,
  uuid,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_legacy_subscription_email_evidence(
  uuid,
  public.legacy_subscription_evidence_source,
  uuid,
  text,
  public.legacy_subscription_evidence_outcome,
  bytea,
  smallint,
  smallint,
  public.legacy_subscription_source_failure,
  bytea,
  timestamptz,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_legacy_subscription_reconciliation(
  uuid,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_legacy_subscriptions_for_verified_email(
  bytea,
  smallint,
  smallint,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.begin_legacy_subscription_reconciliation(
  uuid,
  uuid,
  text,
  text
) IS
  'Service-only idempotent start for one legacy subscription and app-tier scan batch. Provider and account scope are derived from the stored subscription, never trusted from the worker.';
COMMENT ON FUNCTION public.record_legacy_subscription_email_evidence(
  uuid,
  public.legacy_subscription_evidence_source,
  uuid,
  text,
  public.legacy_subscription_evidence_outcome,
  bytea,
  smallint,
  smallint,
  public.legacy_subscription_source_failure,
  bytea,
  timestamptz,
  text,
  text
) IS
  'Service-only idempotent evidence ingestion. Local source membership and contact presence are checked in the database; the application supplies only normalized HMAC contact evidence and an envelope checksum.';
COMMENT ON FUNCTION public.finalize_legacy_subscription_reconciliation(
  uuid,
  text,
  text
) IS
  'Service-only one-way finalization. A complete local plus provider manifest resolves exactly one email digest, while unavailable, incomplete, conflicting, or pre-owned evidence is quarantined.';
COMMENT ON FUNCTION public.claim_legacy_subscriptions_for_verified_email(
  bytea,
  smallint,
  smallint,
  text,
  text
) IS
  'Authenticated attachment of every latest resolved historical subscription for a freshly verified email. Existing account identities cannot claim a different digest after an email change.';

COMMIT;

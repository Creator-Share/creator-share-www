BEGIN;

/*
 * Checkout recovery starts before the first provider request. One operation
 * binds the immutable intent, opaque receipt digest, provider account scope,
 * and provider idempotency key. No browser supplied provider object can enter
 * this chain.
 */

ALTER TABLE public.sponsorship_payment_attempts
  ADD CONSTRAINT sponsorship_payment_attempts_recovery_chain_unique
  UNIQUE (
    id,
    sponsorship_intent_id,
    payment_quote_id,
    provider,
    provider_account_scope
  );

ALTER TABLE public.sponsorship_checkout_reservations
  DROP CONSTRAINT sponsorship_checkout_reservations_sponsorship_intent_id_key;

CREATE UNIQUE INDEX sponsorship_checkout_reservations_intent_live_uidx
  ON public.sponsorship_checkout_reservations (sponsorship_intent_id)
  WHERE status IN ('active', 'consumed');

CREATE TABLE public.sponsorship_checkout_operations (
  operation_id uuid PRIMARY KEY,
  checkout_boundary_version smallint NOT NULL DEFAULT 2,
  checkout_receipt_digest bytea NOT NULL UNIQUE,
  sponsorship_intent_id uuid NOT NULL
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  operation_sequence smallint NOT NULL,
  predecessor_operation_id uuid
    REFERENCES public.sponsorship_checkout_operations(operation_id)
    ON DELETE RESTRICT,
  retry_after_payment_attempt_id uuid
    REFERENCES public.sponsorship_payment_attempts(id) ON DELETE RESTRICT,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  provider_idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_checkout_operations_scope_check CHECK (
    provider_account_scope = lower(btrim(provider_account_scope))
    AND length(provider_account_scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT sponsorship_checkout_operations_receipt_check CHECK (
    octet_length(checkout_receipt_digest) = 32
  ),
  CONSTRAINT sponsorship_checkout_operations_version_check CHECK (
    checkout_boundary_version = 2
  ),
  CONSTRAINT sponsorship_checkout_operations_sequence_check CHECK (
    (
      operation_sequence = 1
      AND predecessor_operation_id IS NULL
      AND retry_after_payment_attempt_id IS NULL
    )
    OR (
      operation_sequence BETWEEN 2 AND 32767
      AND predecessor_operation_id IS NOT NULL
    )
  ),
  CONSTRAINT sponsorship_checkout_operations_provider_key_check CHECK (
    provider_idempotency_key = btrim(provider_idempotency_key)
    AND length(provider_idempotency_key) BETWEEN 16 AND 255
    AND right(
      provider_idempotency_key,
      length(operation_id::text) + 1
    ) = ':' || operation_id::text
    AND substring(
      provider_idempotency_key
      FROM '^([a-z0-9][a-z0-9_-]{2,63}):'
    ) IS NOT NULL
  ),
  CONSTRAINT sponsorship_checkout_operations_provider_key_unique
    UNIQUE (provider, provider_account_scope, provider_idempotency_key),
  CONSTRAINT sponsorship_checkout_operations_intent_sequence_unique
    UNIQUE (sponsorship_intent_id, operation_sequence),
  CONSTRAINT sponsorship_checkout_operations_predecessor_unique
    UNIQUE (predecessor_operation_id),
  CONSTRAINT sponsorship_checkout_operations_provider_account_fkey
    FOREIGN KEY (provider, provider_account_scope)
    REFERENCES public.payment_provider_accounts(provider, scope)
    ON DELETE RESTRICT
);

CREATE TABLE public.sponsorship_checkout_recovery_states (
  payment_attempt_id uuid PRIMARY KEY,
  checkout_operation_id uuid NOT NULL
    REFERENCES public.sponsorship_checkout_operations(operation_id)
    ON DELETE RESTRICT,
  sponsorship_intent_id uuid NOT NULL,
  payment_quote_id uuid NOT NULL,
  provider public.sponsorship_method NOT NULL,
  provider_account_scope text NOT NULL,
  provider_request_schema_version smallint NOT NULL,
  provider_request_template_claims jsonb NOT NULL,
  provider_request_fingerprint bytea NOT NULL,
  provider_request_expires_at timestamptz NOT NULL,
  provider_request_ciphertext bytea NOT NULL,
  provider_request_encryption_key_version smallint NOT NULL,
  provider_request_ciphertext_sha256 bytea NOT NULL,
  status text NOT NULL DEFAULT 'available',
  next_reconciliation_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 8,
  lease_token uuid,
  lease_expires_at timestamptz,
  leased_by text,
  provider_attached_at timestamptz,
  provider_attached_expires_at timestamptz,
  finalized_at timestamptz,
  final_outcome text,
  provider_terminal_status text,
  provider_reconciled_at timestamptz,
  reconciliation_evidence_sha256 bytea,
  reconciliation_evidence_ciphertext bytea,
  reconciliation_evidence_encryption_key_version smallint,
  reconciliation_evidence_ciphertext_sha256 bytea,
  last_error_code text,
  last_finalized_lease_token_digest bytea,
  last_finalization_fingerprint bytea,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_checkout_recovery_states_attempt_chain_fkey
  FOREIGN KEY (
    payment_attempt_id,
    sponsorship_intent_id,
    payment_quote_id,
    provider,
    provider_account_scope
  )
  REFERENCES public.sponsorship_payment_attempts (
    id,
    sponsorship_intent_id,
    payment_quote_id,
    provider,
    provider_account_scope
  )
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_checkout_recovery_states_scope_check CHECK (
    provider_account_scope = lower(btrim(provider_account_scope))
    AND length(provider_account_scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_request_check CHECK (
    provider_request_schema_version = 1
    AND jsonb_typeof(provider_request_template_claims) = 'object'
    AND pg_column_size(provider_request_template_claims) <= 8192
    AND octet_length(provider_request_fingerprint) = 32
    AND provider_request_expires_at > created_at
    AND provider_request_expires_at <= created_at + interval '24 hours'
    AND octet_length(provider_request_ciphertext) BETWEEN 32 AND 65536
    AND provider_request_encryption_key_version BETWEEN 1 AND 32767
    AND octet_length(provider_request_ciphertext_sha256) = 32
    AND provider_request_ciphertext_sha256 = extensions.digest(
      provider_request_ciphertext,
      'sha256'
    )
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_schedule_check CHECK (
    next_reconciliation_at >= created_at
    AND attempt_count BETWEEN 0 AND max_attempts
    AND max_attempts BETWEEN 1 AND 20
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_lease_check CHECK (
    (
      status = 'available'
      AND attempt_count < max_attempts
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND leased_by IS NULL
      AND finalized_at IS NULL
      AND final_outcome IS NULL
    )
    OR (
      status = 'leased'
      AND attempt_count BETWEEN 1 AND max_attempts
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND nullif(btrim(leased_by), '') IS NOT NULL
      AND finalized_at IS NULL
      AND final_outcome IS NULL
    )
    OR (
      status = 'manual_review'
      AND attempt_count = max_attempts
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND leased_by IS NULL
      AND finalized_at IS NULL
      AND final_outcome IS NULL
      AND last_error_code IS NOT NULL
    )
    OR (
      status = 'closed'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND leased_by IS NULL
      AND finalized_at IS NOT NULL
      AND final_outcome IN ('provider_terminal', 'attempt_terminal')
    )
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_attachment_check CHECK (
    (
      provider_attached_at IS NULL
      AND provider_attached_expires_at IS NULL
    )
    OR (
      provider_attached_at IS NOT NULL
      AND provider_attached_expires_at = provider_request_expires_at
    )
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_terminal_check CHECK (
    (
      status <> 'closed'
      AND provider_terminal_status IS NULL
      AND provider_reconciled_at IS NULL
      AND reconciliation_evidence_sha256 IS NULL
      AND reconciliation_evidence_ciphertext IS NULL
      AND reconciliation_evidence_encryption_key_version IS NULL
      AND reconciliation_evidence_ciphertext_sha256 IS NULL
    )
    OR (
      status = 'closed'
      AND final_outcome = 'provider_terminal'
      AND provider_terminal_status IN ('failed', 'cancelled', 'voided', 'expired')
      AND provider_reconciled_at IS NOT NULL
      AND octet_length(reconciliation_evidence_sha256) = 32
      AND reconciliation_evidence_ciphertext IS NOT NULL
      AND octet_length(reconciliation_evidence_ciphertext)
        BETWEEN 32 AND 1048576
      AND reconciliation_evidence_encryption_key_version IS NOT NULL
      AND reconciliation_evidence_encryption_key_version
        BETWEEN 1 AND 32767
      AND reconciliation_evidence_ciphertext_sha256 IS NOT NULL
      AND octet_length(reconciliation_evidence_ciphertext_sha256) = 32
      AND reconciliation_evidence_ciphertext_sha256 = extensions.digest(
        reconciliation_evidence_ciphertext,
        'sha256'
      )
    )
    OR (
      status = 'closed'
      AND final_outcome = 'attempt_terminal'
      AND provider_terminal_status IS NULL
      AND provider_reconciled_at IS NULL
      AND reconciliation_evidence_sha256 IS NULL
      AND reconciliation_evidence_ciphertext IS NULL
      AND reconciliation_evidence_encryption_key_version IS NULL
      AND reconciliation_evidence_ciphertext_sha256 IS NULL
    )
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_error_check CHECK (
    last_error_code IS NULL
    OR (
      last_error_code = lower(btrim(last_error_code))
      AND last_error_code ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
    )
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_replay_check CHECK (
    (
      last_finalized_lease_token_digest IS NULL
      AND last_finalization_fingerprint IS NULL
    )
    OR (
      octet_length(last_finalized_lease_token_digest) = 32
      AND octet_length(last_finalization_fingerprint) = 32
    )
  ),
  CONSTRAINT sponsorship_checkout_recovery_states_operation_unique
    UNIQUE (checkout_operation_id)
);

CREATE UNIQUE INDEX sponsorship_checkout_recovery_states_lease_token_uidx
  ON public.sponsorship_checkout_recovery_states (lease_token)
  WHERE lease_token IS NOT NULL;

CREATE INDEX sponsorship_checkout_recovery_states_claim_idx
  ON public.sponsorship_checkout_recovery_states (
    next_reconciliation_at,
    created_at,
    payment_attempt_id
  )
  WHERE status IN ('available', 'leased');

CREATE INDEX sponsorship_checkout_recovery_states_manual_review_idx
  ON public.sponsorship_checkout_recovery_states (
    updated_at,
    payment_attempt_id
  )
  WHERE status = 'manual_review';

/*
 * Historical attribution is immutable, but permission to create or recreate
 * a provider checkout is not. Every provider capable replay must bind the
 * stored advocate and domain identifiers back to their current active rows.
 * The row locks make an authorization decision and a database boundary call
 * serial with an administrative suspension in the opposite transaction.
 */
CREATE OR REPLACE FUNCTION private.require_current_checkout_tenant_authorization_v2(
  target_sponsorship_intent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_authorized boolean := false;
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

  IF v_intent.source = 'primary_site' THEN
    RETURN;
  END IF;

  IF v_intent.source = 'advocate_domain' THEN
    SELECT true
    INTO v_authorized
    FROM public.advocate_domains domain
    JOIN public.advocates advocate
      ON advocate.id = domain.advocate_id
    WHERE domain.id = v_intent.source_advocate_domain_id
      AND domain.advocate_id = v_intent.source_advocate_id
      AND domain.hostname = v_intent.source_host
      AND domain.status = 'active'
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status = 'active'
    FOR SHARE OF domain, advocate;
  END IF;

  IF NOT COALESCE(v_authorized, false) THEN
    RAISE EXCEPTION 'Advocate portal is not currently authorized for checkout'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_current_checkout_tenant_authorization_v2(
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.require_current_checkout_tenant_authorization_v2(
  uuid
) IS
  'Rechecks the exact persisted advocate and domain against current active tenant publication before a provider capable v2 checkout boundary may proceed.';

CREATE OR REPLACE FUNCTION private.validate_provider_request_template_v2(
  target_checkout_operation_id uuid,
  target_sponsorship_intent_id uuid,
  target_payment_quote_id uuid,
  target_provider_request_schema_version smallint,
  target_provider_request_template_claims jsonb,
  target_provider_request_fingerprint bytea,
  target_provider_request_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
  v_expected_placeholder_path text;
  v_expected_financial_terms jsonb;
  v_expected_email_binding jsonb;
BEGIN
  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id;

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.id = target_payment_quote_id;

  IF v_operation.operation_id IS NULL
     OR v_intent.id IS NULL
     OR v_quote.id IS NULL
     OR v_operation.checkout_boundary_version IS DISTINCT FROM 2
     OR v_operation.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR v_quote.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR v_quote.provider IS DISTINCT FROM v_operation.provider
     OR v_quote.provider_account_scope IS DISTINCT FROM
       v_operation.provider_account_scope
     OR target_provider_request_schema_version IS DISTINCT FROM 1
     OR octet_length(target_provider_request_fingerprint) IS DISTINCT FROM 32
     OR target_provider_request_expires_at IS NULL
     OR jsonb_typeof(target_provider_request_template_claims)
       IS DISTINCT FROM 'object'
     OR pg_column_size(target_provider_request_template_claims) > 8192 THEN
    RAISE EXCEPTION 'Provider request template does not bind one exact v2 checkout chain'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(
      target_provider_request_template_claims
    ) AS claim_key(key)
    WHERE claim_key.key NOT IN (
      'canonical_json_version',
      'provider',
      'provider_account_scope',
      'checkout_operation_id',
      'sponsorship_intent_id',
      'payment_quote_id',
      'payment_attempt_id_placeholder',
      'payment_attempt_id_placeholder_path',
      'unresolved_placeholder_count',
      'financial_terms',
      'sponsor_email_binding',
      'product_display_fields_sha256',
      'return_urls_sha256',
      'provider_request_expires_at_epoch_microseconds',
      'canonical_template_sha256'
    )
  ) OR (
    SELECT count(*)
    FROM pg_catalog.jsonb_object_keys(
      target_provider_request_template_claims
    )
  ) <> 15 THEN
    RAISE EXCEPTION 'Provider request template claims contain unsupported or missing fields'
      USING ERRCODE = '22023';
  END IF;

  v_expected_placeholder_path := '/paymentAttemptId';

  v_expected_financial_terms := pg_catalog.jsonb_build_object(
    'payment_mode', v_quote.payment_mode::text,
    'recurrence_interval', v_quote.recurrence_interval,
    'base_amount_usd_cents', v_quote.base_amount_usd_cents,
    'charged_amount_minor', v_quote.charged_amount_minor,
    'charged_currency', v_quote.charged_currency::text,
    'conversion_rate', v_quote.conversion_rate,
    'currency_quote_at_epoch_microseconds',
      (
        extract(epoch FROM v_intent.currency_quote_at)
        * 1000000
      )::bigint
  );
  v_expected_email_binding := pg_catalog.jsonb_build_object(
    'representation', 'encrypted_in_template',
    'normalization_version', v_intent.contact_email_normalization_version,
    'hmac_key_version', v_intent.contact_email_hmac_key_version,
    'hmac_sha256', pg_catalog.encode(v_intent.contact_email_hmac, 'hex')
  );

  IF target_provider_request_template_claims -> 'canonical_json_version'
       IS DISTINCT FROM '1'::jsonb
     OR target_provider_request_template_claims ->> 'provider'
       IS DISTINCT FROM v_operation.provider::text
     OR target_provider_request_template_claims ->>
       'provider_account_scope' IS DISTINCT FROM
         v_operation.provider_account_scope
     OR target_provider_request_template_claims ->>
       'checkout_operation_id' IS DISTINCT FROM v_operation.operation_id::text
     OR target_provider_request_template_claims ->>
       'sponsorship_intent_id' IS DISTINCT FROM v_intent.id::text
     OR target_provider_request_template_claims ->>
       'payment_quote_id' IS DISTINCT FROM v_quote.id::text
     OR target_provider_request_template_claims ->
       'payment_attempt_id_placeholder' IS DISTINCT FROM
         '{"$creator_share":"server_payment_attempt_id","type":"uuid"}'::jsonb
     OR target_provider_request_template_claims ->>
       'payment_attempt_id_placeholder_path' IS DISTINCT FROM
         v_expected_placeholder_path
     OR target_provider_request_template_claims ->
       'unresolved_placeholder_count' IS DISTINCT FROM '1'::jsonb
     OR target_provider_request_template_claims -> 'financial_terms'
       IS DISTINCT FROM v_expected_financial_terms
     OR target_provider_request_template_claims -> 'sponsor_email_binding'
       IS DISTINCT FROM v_expected_email_binding
     OR target_provider_request_template_claims ->>
       'product_display_fields_sha256' IS NULL
     OR target_provider_request_template_claims ->>
       'product_display_fields_sha256' !~ '^[0-9a-f]{64}$'
     OR target_provider_request_template_claims ->>
       'return_urls_sha256' IS NULL
     OR target_provider_request_template_claims ->>
       'return_urls_sha256' !~ '^[0-9a-f]{64}$'
     OR target_provider_request_template_claims ->>
       'provider_request_expires_at_epoch_microseconds' IS DISTINCT FROM
         (
           extract(epoch FROM target_provider_request_expires_at)
           * 1000000
         )::bigint::text
     OR target_provider_request_template_claims ->>
       'canonical_template_sha256' IS DISTINCT FROM
         pg_catalog.encode(target_provider_request_fingerprint, 'hex') THEN
    RAISE EXCEPTION 'Provider request template claims do not match canonical checkout evidence'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_sponsorship_checkout_operation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_predecessor public.sponsorship_checkout_operations%ROWTYPE;
  v_retry_attempt public.sponsorship_payment_attempts%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Sponsorship checkout operations are append only'
      USING ERRCODE = '42501';
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = NEW.sponsorship_intent_id
  FOR SHARE;

  IF NOT FOUND OR NEW.checkout_boundary_version IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Checkout operation must bind one exact v2 intent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.operation_sequence = 1 THEN
    IF NEW.retry_after_payment_attempt_id IS NOT NULL
       OR v_intent.idempotency_key IS DISTINCT FROM
         'checkout-v2:' || NEW.operation_id::text
       OR v_intent.status <> 'created' THEN
      RAISE EXCEPTION 'Initial checkout operation must bind one newly prepared exact v2 intent'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT predecessor.*
    INTO v_predecessor
    FROM public.sponsorship_checkout_operations predecessor
    WHERE predecessor.operation_id = NEW.predecessor_operation_id
    FOR SHARE;

    SELECT attempt.*
    INTO v_retry_attempt
    FROM public.sponsorship_checkout_recovery_states recovery
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = recovery.payment_attempt_id
    WHERE recovery.checkout_operation_id = v_predecessor.operation_id
    FOR SHARE OF recovery, attempt;

    IF v_predecessor.operation_id IS NULL
       OR v_predecessor.sponsorship_intent_id IS DISTINCT FROM v_intent.id
       OR v_predecessor.operation_sequence IS DISTINCT FROM
         NEW.operation_sequence - 1
       OR (
         v_retry_attempt.id IS NULL
         AND NEW.retry_after_payment_attempt_id IS NOT NULL
       )
       OR (
         v_retry_attempt.id IS NOT NULL
         AND (
           NEW.retry_after_payment_attempt_id IS DISTINCT FROM
             v_retry_attempt.id
           OR v_retry_attempt.status NOT IN ('failed', 'cancelled', 'expired')
         )
       )
       OR (
         NOT EXISTS (
           SELECT 1
           FROM public.sponsorship_payment_attempts attempt
           WHERE attempt.sponsorship_intent_id = v_intent.id
         )
         AND v_intent.status <> 'created'
       )
       OR (
         EXISTS (
           SELECT 1
           FROM public.sponsorship_payment_attempts attempt
           WHERE attempt.sponsorship_intent_id = v_intent.id
         )
         AND v_intent.status <> 'failed'
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_operations prior_operation
         LEFT JOIN public.sponsorship_checkout_recovery_states prior_recovery
           ON prior_recovery.checkout_operation_id = prior_operation.operation_id
         LEFT JOIN public.sponsorship_payment_attempts prior_attempt
           ON prior_attempt.id = prior_recovery.payment_attempt_id
         WHERE prior_operation.sponsorship_intent_id = v_intent.id
           AND (
             (
               prior_recovery.payment_attempt_id IS NOT NULL
               AND (
                 prior_recovery.status <> 'closed'
                 OR prior_attempt.status NOT IN ('failed', 'cancelled', 'expired')
               )
             )
             OR (
               prior_recovery.payment_attempt_id IS NULL
               AND prior_operation.operation_id <>
                 v_predecessor.operation_id
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.sponsorship_checkout_operations successor
                 WHERE successor.predecessor_operation_id =
                   prior_operation.operation_id
               )
             )
           )
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_payment_attempts prior_attempt
         WHERE prior_attempt.sponsorship_intent_id = v_intent.id
           AND prior_attempt.status = 'succeeded'
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_operations prior_operation
         JOIN public.sponsorship_payment_attempts prior_attempt
           ON prior_attempt.provider = prior_operation.provider
          AND prior_attempt.provider_account_scope =
            prior_operation.provider_account_scope
          AND prior_attempt.provider_idempotency_key =
            prior_operation.provider_idempotency_key
         LEFT JOIN public.sponsorship_checkout_recovery_states prior_recovery
           ON prior_recovery.checkout_operation_id = prior_operation.operation_id
         WHERE prior_operation.sponsorship_intent_id = v_intent.id
           AND prior_recovery.payment_attempt_id IS NULL
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_financial_movements movement
         WHERE movement.sponsorship_intent_id = v_intent.id
           AND movement.entry_kind = 'sponsorship_payment'
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_reservations reservation
         WHERE reservation.sponsorship_intent_id = v_intent.id
           AND reservation.status IN ('active', 'consumed')
       ) THEN
      RAISE EXCEPTION 'Retry checkout operation requires a fully terminal unsuccessful v2 intent chain'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_sponsorship_checkout_recovery_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_auto_terminal_attempt_id text := current_setting(
    'app.checkout_recovery.auto_terminal_attempt_id',
    true
  );
  v_last_finalization_changed boolean;
  v_tenant_policy_stop boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sponsorship checkout recovery state cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT attempt.*
    INTO v_attempt
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.id = NEW.payment_attempt_id
      AND attempt.sponsorship_intent_id = NEW.sponsorship_intent_id
      AND attempt.payment_quote_id = NEW.payment_quote_id
      AND attempt.provider = NEW.provider
      AND attempt.provider_account_scope = NEW.provider_account_scope
    FOR SHARE;

    SELECT operation.*
    INTO v_operation
    FROM public.sponsorship_checkout_operations operation
    WHERE operation.operation_id = NEW.checkout_operation_id
    FOR SHARE;

    IF v_attempt.id IS NULL
       OR v_operation.operation_id IS NULL
       OR v_attempt.status <> 'created'
       OR v_attempt.provider_object_id IS NOT NULL
       OR v_operation.sponsorship_intent_id IS DISTINCT FROM
         v_attempt.sponsorship_intent_id
       OR v_operation.provider IS DISTINCT FROM v_attempt.provider
       OR v_operation.provider_account_scope IS DISTINCT FROM
         v_attempt.provider_account_scope
       OR v_operation.provider_idempotency_key IS DISTINCT FROM
         v_attempt.provider_idempotency_key
       OR v_operation.checkout_receipt_digest IS DISTINCT FROM
         v_attempt.checkout_receipt_digest
       OR NEW.status <> 'available'
       OR NEW.attempt_count <> 0
       OR NEW.max_attempts <> 8
       OR NEW.next_reconciliation_at < v_now
       OR NEW.next_reconciliation_at > v_now + interval '10 minutes' THEN
      RAISE EXCEPTION 'Checkout recovery state must bind one newly created exact payment attempt'
        USING ERRCODE = '23514';
    END IF;

    PERFORM private.validate_provider_request_template_v2(
      NEW.checkout_operation_id,
      NEW.sponsorship_intent_id,
      NEW.payment_quote_id,
      NEW.provider_request_schema_version,
      NEW.provider_request_template_claims,
      NEW.provider_request_fingerprint,
      NEW.provider_request_expires_at
    );

    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.payment_attempt_id IS DISTINCT FROM OLD.payment_attempt_id
     OR NEW.checkout_operation_id IS DISTINCT FROM OLD.checkout_operation_id
     OR NEW.sponsorship_intent_id IS DISTINCT FROM OLD.sponsorship_intent_id
     OR NEW.payment_quote_id IS DISTINCT FROM OLD.payment_quote_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_account_scope IS DISTINCT FROM OLD.provider_account_scope
     OR NEW.provider_request_schema_version IS DISTINCT FROM
       OLD.provider_request_schema_version
     OR NEW.provider_request_template_claims IS DISTINCT FROM
       OLD.provider_request_template_claims
     OR NEW.provider_request_fingerprint IS DISTINCT FROM
       OLD.provider_request_fingerprint
     OR NEW.provider_request_expires_at IS DISTINCT FROM
       OLD.provider_request_expires_at
     OR NEW.provider_request_ciphertext IS DISTINCT FROM
       OLD.provider_request_ciphertext
     OR NEW.provider_request_encryption_key_version IS DISTINCT FROM
       OLD.provider_request_encryption_key_version
     OR NEW.provider_request_ciphertext_sha256 IS DISTINCT FROM
       OLD.provider_request_ciphertext_sha256
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Checkout recovery ownership and provider request are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Closed checkout recovery evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_attached_at IS NOT NULL AND (
    NEW.provider_attached_at IS DISTINCT FROM OLD.provider_attached_at
    OR NEW.provider_attached_expires_at IS DISTINCT FROM
      OLD.provider_attached_expires_at
  ) THEN
    RAISE EXCEPTION 'Checkout provider attachment evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_attached_at IS NULL
     AND NEW.provider_attached_at IS NOT NULL
     AND NEW.provider_attached_expires_at IS DISTINCT FROM
       OLD.provider_request_expires_at THEN
    RAISE EXCEPTION 'Checkout provider attachment expiry does not match its immutable request'
      USING ERRCODE = '23514';
  END IF;

  v_last_finalization_changed :=
    NEW.last_finalized_lease_token_digest IS DISTINCT FROM
      OLD.last_finalized_lease_token_digest
    OR NEW.last_finalization_fingerprint IS DISTINCT FROM
      OLD.last_finalization_fingerprint;

  v_tenant_policy_stop :=
    OLD.status IN ('available', 'leased')
    AND (
      OLD.status = 'available'
      OR OLD.lease_expires_at <= v_now
    )
    AND NEW.status = 'manual_review'
    AND OLD.attempt_count < OLD.max_attempts
    AND NEW.attempt_count = NEW.max_attempts
    AND NEW.lease_token IS NULL
    AND NEW.lease_expires_at IS NULL
    AND NEW.leased_by IS NULL
    AND NEW.last_error_code = 'advocate_portal_inactive'
    AND NEW.next_reconciliation_at IS NOT DISTINCT FROM
      OLD.next_reconciliation_at
    AND NEW.provider_attached_at IS NOT DISTINCT FROM
      OLD.provider_attached_at
    AND NEW.provider_attached_expires_at IS NOT DISTINCT FROM
      OLD.provider_attached_expires_at
    AND NOT v_last_finalization_changed
    AND EXISTS (
      SELECT 1
      FROM public.sponsorship_payment_attempts attempt
      JOIN public.sponsorship_intents intent
        ON intent.id = attempt.sponsorship_intent_id
      WHERE attempt.id = OLD.payment_attempt_id
        AND attempt.status = 'created'
        AND attempt.provider_object_id IS NULL
        AND intent.source = 'advocate_domain'
        AND NOT EXISTS (
          SELECT 1
          FROM public.advocate_domains domain
          JOIN public.advocates advocate
            ON advocate.id = domain.advocate_id
          WHERE domain.id = intent.source_advocate_domain_id
            AND domain.advocate_id = intent.source_advocate_id
            AND domain.hostname = intent.source_host
            AND domain.status = 'active'
            AND advocate.relationship_status = 'active'
            AND advocate.publication_status = 'active'
        )
    );

  IF (
       NEW.attempt_count < OLD.attempt_count
       OR NEW.attempt_count > OLD.attempt_count + 1
     )
     AND NOT v_tenant_policy_stop THEN
    RAISE EXCEPTION 'Checkout recovery attempt count is monotonic'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'closed'
     AND NEW.final_outcome = 'attempt_terminal'
     AND v_auto_terminal_attempt_id = OLD.payment_attempt_id::text THEN
    SELECT attempt.*
    INTO v_attempt
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.id = OLD.payment_attempt_id
    FOR SHARE;

    IF v_attempt.status NOT IN ('succeeded', 'failed', 'cancelled', 'expired')
       OR NEW.attempt_count <> OLD.attempt_count
       OR NEW.provider_terminal_status IS NOT NULL
       OR NEW.provider_reconciled_at IS NOT NULL
       OR NEW.reconciliation_evidence_sha256 IS NOT NULL
       OR NEW.reconciliation_evidence_ciphertext IS NOT NULL
       OR NEW.reconciliation_evidence_encryption_key_version IS NOT NULL
       OR NEW.reconciliation_evidence_ciphertext_sha256 IS NOT NULL
       OR octet_length(NEW.last_finalized_lease_token_digest) IS DISTINCT FROM 32
       OR octet_length(NEW.last_finalization_fingerprint) IS DISTINCT FROM 32 THEN
      RAISE EXCEPTION 'Automatic checkout recovery closure lacks a terminal attempt'
        USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF OLD.status = 'leased'
     AND NEW.status = 'leased'
     AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token
     AND NEW.lease_expires_at IS NOT DISTINCT FROM OLD.lease_expires_at
     AND NEW.leased_by IS NOT DISTINCT FROM OLD.leased_by
     AND NEW.attempt_count = OLD.attempt_count
     AND OLD.provider_attached_at IS NULL
     AND NEW.provider_attached_at IS NOT NULL THEN
    IF NEW.next_reconciliation_at IS DISTINCT FROM
         NEW.provider_request_expires_at
       OR v_last_finalization_changed THEN
      RAISE EXCEPTION 'Leased checkout attachment schedule is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'manual_review'
        AND NEW.status = 'manual_review'
        AND NEW.attempt_count = OLD.attempt_count
        AND OLD.provider_attached_at IS NULL
        AND NEW.provider_attached_at IS NOT NULL THEN
    IF NEW.next_reconciliation_at IS DISTINCT FROM
         NEW.provider_request_expires_at
       OR NEW.last_error_code IS DISTINCT FROM OLD.last_error_code
       OR v_last_finalization_changed THEN
      RAISE EXCEPTION 'Manual review checkout attachment schedule is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'leased' THEN
    IF OLD.status NOT IN ('available', 'leased')
       OR NEW.lease_expires_at <= v_now
       OR NEW.lease_expires_at > v_now + interval '15 minutes'
       OR length(NEW.leased_by) NOT BETWEEN 3 AND 120
       OR NEW.attempt_count <> OLD.attempt_count + 1
       OR NEW.next_reconciliation_at IS DISTINCT FROM
         OLD.next_reconciliation_at
       OR v_last_finalization_changed
       OR (
         OLD.status = 'leased'
         AND OLD.lease_expires_at > v_now
       ) THEN
      RAISE EXCEPTION 'Checkout recovery lease transition is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'leased' AND NEW.status = 'available' THEN
    IF NEW.attempt_count <> OLD.attempt_count
       OR NEW.lease_token IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.leased_by IS NOT NULL
       OR (
         v_last_finalization_changed
         AND (
           NEW.provider_attached_at IS NULL
           OR NEW.next_reconciliation_at IS DISTINCT FROM
             NEW.provider_request_expires_at
           OR NEW.last_error_code IS NOT NULL
           OR octet_length(NEW.last_finalized_lease_token_digest)
             IS DISTINCT FROM 32
           OR octet_length(NEW.last_finalization_fingerprint)
             IS DISTINCT FROM 32
         )
       )
       OR (
         NOT v_last_finalization_changed
         AND (
           NEW.next_reconciliation_at <= v_now
           OR NEW.last_error_code IS NULL
         )
       ) THEN
      RAISE EXCEPTION 'Checkout recovery retry or attachment schedule is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'available' AND NEW.status = 'available' THEN
    IF NEW.attempt_count <> OLD.attempt_count
       OR OLD.provider_attached_at IS NOT NULL
       OR NEW.provider_attached_at IS NULL
       OR NEW.next_reconciliation_at IS DISTINCT FROM
         NEW.provider_attached_expires_at
       OR v_last_finalization_changed THEN
      RAISE EXCEPTION 'Checkout recovery attachment transition is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status IN ('available', 'leased')
        AND NEW.status = 'manual_review' THEN
    IF NEW.attempt_count <> NEW.max_attempts
       OR (
         NEW.attempt_count <> OLD.attempt_count
         AND NOT v_tenant_policy_stop
       )
       OR NEW.lease_token IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.leased_by IS NOT NULL
       OR NEW.last_error_code IS NULL
       OR (
         v_last_finalization_changed
         AND (
           OLD.status <> 'leased'
           OR NEW.provider_attached_at IS NULL
           OR NEW.next_reconciliation_at IS DISTINCT FROM
             NEW.provider_request_expires_at
           OR octet_length(NEW.last_finalized_lease_token_digest)
             IS DISTINCT FROM 32
           OR octet_length(NEW.last_finalization_fingerprint)
             IS DISTINCT FROM 32
         )
       ) THEN
      RAISE EXCEPTION 'Checkout recovery manual review transition is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'leased' AND NEW.status = 'closed' THEN
    IF NEW.attempt_count <> OLD.attempt_count
       OR NEW.lease_token IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.leased_by IS NOT NULL
       OR NOT v_last_finalization_changed
       OR octet_length(NEW.last_finalized_lease_token_digest) IS DISTINCT FROM 32
       OR octet_length(NEW.last_finalization_fingerprint) IS DISTINCT FROM 32 THEN
      RAISE EXCEPTION 'Checkout recovery closure evidence is incomplete'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Illegal checkout recovery state transition'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.close_checkout_recovery_on_attempt_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_terminal_digest bytea;
BEGIN
  IF OLD.status NOT IN ('created', 'pending')
     OR NEW.status NOT IN ('succeeded', 'failed', 'cancelled', 'expired') THEN
    RETURN NEW;
  END IF;

  v_terminal_digest := extensions.digest(
    pg_catalog.convert_to(
      'attempt_terminal:' || NEW.id::text || ':' || NEW.status::text,
      'UTF8'
    ),
    'sha256'
  );

  PERFORM pg_catalog.set_config(
    'app.checkout_recovery.auto_terminal_attempt_id',
    NEW.id::text,
    true
  );

  UPDATE public.sponsorship_checkout_recovery_states recovery
  SET
    status = 'closed',
    lease_token = NULL,
    lease_expires_at = NULL,
    leased_by = NULL,
    finalized_at = clock_timestamp(),
    final_outcome = 'attempt_terminal',
    provider_terminal_status = NULL,
    provider_reconciled_at = NULL,
    reconciliation_evidence_sha256 = NULL,
    reconciliation_evidence_ciphertext = NULL,
    reconciliation_evidence_encryption_key_version = NULL,
    reconciliation_evidence_ciphertext_sha256 = NULL,
    last_error_code = NULL,
    last_finalized_lease_token_digest = v_terminal_digest,
    last_finalization_fingerprint = extensions.digest(
      v_terminal_digest || pg_catalog.convert_to('finalization', 'UTF8'),
      'sha256'
    )
  WHERE recovery.payment_attempt_id = NEW.id
    AND recovery.status <> 'closed';

  PERFORM pg_catalog.set_config(
    'app.checkout_recovery.auto_terminal_attempt_id',
    '',
    true
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_checkout_recovery_terminal_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_intent_status public.sponsorship_intent_status;
BEGIN
  IF OLD.status NOT IN ('created', 'pending')
     OR NEW.status NOT IN ('succeeded', 'failed', 'cancelled', 'expired') THEN
    RETURN NULL;
  END IF;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = NEW.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT intent.status
  INTO STRICT v_intent_status
  FROM public.sponsorship_intents intent
  WHERE intent.id = NEW.sponsorship_intent_id;

  IF v_recovery.status <> 'closed'
     OR NOT (
       (NEW.status = 'succeeded' AND v_intent_status = 'succeeded')
       OR (
         NEW.status IN ('failed', 'cancelled', 'expired')
         AND v_intent_status = 'failed'
       )
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_reservations reservation
       WHERE reservation.payment_attempt_id = NEW.id
         AND reservation.status = 'active'
     ) THEN
    RAISE EXCEPTION 'Terminal checkout attempt did not settle its recovery, intent, and reservation chain'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_provider_request_template_v2(
  uuid,
  uuid,
  uuid,
  smallint,
  jsonb,
  bytea,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_sponsorship_checkout_operation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_sponsorship_checkout_recovery_state()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.close_checkout_recovery_on_attempt_terminal()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_checkout_recovery_terminal_chain()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER sponsorship_checkout_operations_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsorship_checkout_operations
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsorship_checkout_operation();

CREATE TRIGGER sponsorship_checkout_operations_no_truncate
BEFORE TRUNCATE ON public.sponsorship_checkout_operations
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER sponsorship_checkout_operations_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_checkout_operations
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'checkout_receipt_digest'
);

CREATE TRIGGER sponsorship_checkout_recovery_states_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsorship_checkout_recovery_states
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsorship_checkout_recovery_state();

CREATE TRIGGER sponsorship_checkout_recovery_states_no_truncate
BEFORE TRUNCATE ON public.sponsorship_checkout_recovery_states
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER sponsorship_checkout_recovery_states_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_checkout_recovery_states
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'provider_request_template_claims,provider_request_fingerprint,provider_request_ciphertext,provider_request_ciphertext_sha256,lease_token,reconciliation_evidence_sha256,reconciliation_evidence_ciphertext,reconciliation_evidence_encryption_key_version,reconciliation_evidence_ciphertext_sha256,last_finalized_lease_token_digest,last_finalization_fingerprint'
);

CREATE TRIGGER sponsorship_payment_attempts_close_checkout_recovery
AFTER UPDATE OF status ON public.sponsorship_payment_attempts
FOR EACH ROW EXECUTE FUNCTION private.close_checkout_recovery_on_attempt_terminal();

CREATE CONSTRAINT TRIGGER sponsorship_payment_attempts_recovery_terminal_invariant
AFTER UPDATE OF status ON public.sponsorship_payment_attempts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_checkout_recovery_terminal_chain();

ALTER TABLE public.sponsorship_checkout_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorship_checkout_recovery_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sponsorship_checkout_operations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.sponsorship_checkout_recovery_states
  FROM PUBLIC, anon, authenticated, service_role;

/*
 * The v2 prepare entry point creates the operation ledger in the same
 * transaction as the intent. Exact replays return the original state without
 * applying current currency freshness rules to the original quote timestamp.
 */

ALTER FUNCTION public.prepare_sponsorship_checkout_intent(
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) SET SCHEMA private;

ALTER FUNCTION private.prepare_sponsorship_checkout_intent(
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) RENAME TO prepare_sponsorship_checkout_intent_core_v1;

REVOKE ALL ON FUNCTION private.prepare_sponsorship_checkout_intent_core_v1(
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_sponsorship_checkout_intent(
  target_idempotency_key text,
  target_source public.sponsorship_intent_source,
  target_advocate_hostname text,
  target_visitor_token_digest bytea,
  target_auth_user_id uuid,
  target_contact_email_hmac bytea,
  target_contact_email_normalization_version smallint,
  target_contact_email_hmac_key_version smallint,
  target_subject_kind public.sponsorship_subject_kind,
  target_beneficiary_id uuid,
  target_partnership_project public.project_type,
  target_payment_mode public.sponsorship_payment_mode,
  target_recurrence_interval text,
  target_base_amount_usd_cents bigint,
  target_charged_amount_minor bigint,
  target_charged_currency public.payment_currency,
  target_conversion_rate numeric,
  target_currency_quote_at timestamptz,
  target_currency_rate_source text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  resolved_sponsorship_intent_id uuid,
  resolved_sponsor_identity_id uuid,
  resolved_browser_visitor_id uuid,
  resolved_source public.sponsorship_intent_source,
  resolved_source_host text,
  resolved_attribution_kind public.sponsorship_attribution_kind,
  resolved_attribution_advocate_id uuid,
  resolved_attribution_exposure_id uuid,
  resolved_intent_status public.sponsorship_intent_status,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_idempotency_key LIKE 'checkout-v2:%' THEN
    RAISE EXCEPTION 'Legacy checkout preparation cannot enter a v2 operation scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT core.*
  FROM private.prepare_sponsorship_checkout_intent_core_v1(
    target_idempotency_key,
    target_source,
    target_advocate_hostname,
    target_visitor_token_digest,
    target_auth_user_id,
    target_contact_email_hmac,
    target_contact_email_normalization_version,
    target_contact_email_hmac_key_version,
    target_subject_kind,
    target_beneficiary_id,
    target_partnership_project,
    target_payment_mode,
    target_recurrence_interval,
    target_base_amount_usd_cents,
    target_charged_amount_minor,
    target_charged_currency,
    target_conversion_rate,
    target_currency_quote_at,
    target_currency_rate_source,
    context_request_id,
    context_trace_id
  ) core;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_sponsorship_checkout_intent_v2(
  target_checkout_operation_id uuid,
  target_checkout_receipt_digest bytea,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_idempotency_key text,
  target_idempotency_key text,
  target_source public.sponsorship_intent_source,
  target_advocate_hostname text,
  target_visitor_token_digest bytea,
  target_auth_user_id uuid,
  target_contact_email_hmac bytea,
  target_contact_email_normalization_version smallint,
  target_contact_email_hmac_key_version smallint,
  target_subject_kind public.sponsorship_subject_kind,
  target_beneficiary_id uuid,
  target_partnership_project public.project_type,
  target_payment_mode public.sponsorship_payment_mode,
  target_recurrence_interval text,
  target_base_amount_usd_cents bigint,
  target_charged_amount_minor bigint,
  target_charged_currency public.payment_currency,
  target_conversion_rate numeric,
  target_currency_quote_at timestamptz,
  target_currency_rate_source text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  resolved_sponsorship_intent_id uuid,
  resolved_sponsor_identity_id uuid,
  resolved_browser_visitor_id uuid,
  resolved_source public.sponsorship_intent_source,
  resolved_source_host text,
  resolved_attribution_kind public.sponsorship_attribution_kind,
  resolved_attribution_advocate_id uuid,
  resolved_attribution_exposure_id uuid,
  resolved_intent_status public.sponsorship_intent_status,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_attribution public.sponsorship_attributions%ROWTYPE;
  v_browser_visitor_id uuid;
  v_expected_source_host text;
  v_core_result record;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_checkout_operation_id IS NULL
     OR octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_provider IS NULL
     OR target_provider_account_scope IS NULL
     OR target_provider_account_scope IS DISTINCT FROM
       lower(btrim(target_provider_account_scope))
     OR length(target_provider_account_scope) NOT BETWEEN 1 AND 120
     OR target_provider_idempotency_key IS NULL
     OR target_provider_idempotency_key IS DISTINCT FROM
       btrim(target_provider_idempotency_key)
     OR length(target_provider_idempotency_key) NOT BETWEEN 16 AND 255
     OR right(
       target_provider_idempotency_key,
       length(target_checkout_operation_id::text) + 1
     ) IS DISTINCT FROM ':' || target_checkout_operation_id::text
     OR target_idempotency_key IS DISTINCT FROM
       'checkout-v2:' || target_checkout_operation_id::text
     OR (
       target_visitor_token_digest IS NOT NULL
       AND octet_length(target_visitor_token_digest) IS DISTINCT FROM 32
     ) THEN
    RAISE EXCEPTION 'Checkout operation preparation scope is malformed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        'sponsorship_checkout_operation',
        target_checkout_operation_id,
        pg_catalog.encode(target_checkout_receipt_digest, 'hex'),
        target_provider::text,
        target_provider_account_scope,
        target_provider_idempotency_key
      )::text,
      0
    )
  );

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id
    OR operation.checkout_receipt_digest = target_checkout_receipt_digest
    OR (
      operation.provider = target_provider
      AND operation.provider_account_scope = target_provider_account_scope
      AND operation.provider_idempotency_key = target_provider_idempotency_key
    )
  ORDER BY operation.created_at, operation.operation_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.sponsorship_checkout_operations other_operation
      WHERE (
        other_operation.operation_id = target_checkout_operation_id
        OR other_operation.checkout_receipt_digest =
          target_checkout_receipt_digest
        OR (
          other_operation.provider = target_provider
          AND other_operation.provider_account_scope =
            target_provider_account_scope
          AND other_operation.provider_idempotency_key =
            target_provider_idempotency_key
        )
      )
        AND other_operation.operation_id <> v_operation.operation_id
    )
       OR v_operation.operation_id IS DISTINCT FROM
         target_checkout_operation_id
       OR v_operation.checkout_receipt_digest IS DISTINCT FROM
         target_checkout_receipt_digest
       OR v_operation.provider IS DISTINCT FROM target_provider
       OR v_operation.provider_account_scope IS DISTINCT FROM
         target_provider_account_scope
       OR v_operation.provider_idempotency_key IS DISTINCT FROM
         target_provider_idempotency_key THEN
      RAISE EXCEPTION 'Checkout operation scope belongs to another immutable checkout'
        USING ERRCODE = '23505';
    END IF;

    SELECT intent.*
    INTO STRICT v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = v_operation.sponsorship_intent_id
    FOR SHARE;

    IF target_source = 'primary_site' THEN
      IF target_advocate_hostname IS NOT NULL THEN
        RAISE EXCEPTION 'Primary checkout operation cannot name an advocate host'
          USING ERRCODE = '23505';
      END IF;
      v_expected_source_host := 'creatorshare.com';
    ELSIF target_source = 'advocate_domain' THEN
      IF target_advocate_hostname IS NULL
         OR target_advocate_hostname IS DISTINCT FROM
           lower(btrim(target_advocate_hostname)) THEN
        RAISE EXCEPTION 'Advocate checkout operation host is malformed'
          USING ERRCODE = '22023';
      END IF;
      v_expected_source_host := target_advocate_hostname;
    ELSE
      RAISE EXCEPTION 'Checkout operation source is unsupported'
        USING ERRCODE = '22023';
    END IF;

    IF target_visitor_token_digest IS NOT NULL THEN
      SELECT visitor.id
      INTO v_browser_visitor_id
      FROM public.browser_visitors visitor
      WHERE visitor.token_digest = target_visitor_token_digest;
    END IF;

    IF v_intent.idempotency_key IS DISTINCT FROM target_idempotency_key
       OR v_intent.source IS DISTINCT FROM target_source
       OR v_intent.source_host IS DISTINCT FROM v_expected_source_host
       OR v_intent.browser_visitor_id IS DISTINCT FROM v_browser_visitor_id
       OR v_intent.auth_user_id IS DISTINCT FROM target_auth_user_id
       OR v_intent.contact_email_hmac IS DISTINCT FROM
         target_contact_email_hmac
       OR v_intent.contact_email_normalization_version IS DISTINCT FROM
         target_contact_email_normalization_version
       OR v_intent.contact_email_hmac_key_version IS DISTINCT FROM
         target_contact_email_hmac_key_version
       OR v_intent.subject_kind IS DISTINCT FROM target_subject_kind
       OR v_intent.beneficiary_id IS DISTINCT FROM target_beneficiary_id
       OR v_intent.partnership_project IS DISTINCT FROM
         target_partnership_project
       OR v_intent.payment_mode IS DISTINCT FROM target_payment_mode
       OR v_intent.recurrence_interval IS DISTINCT FROM
         target_recurrence_interval
       OR v_intent.base_amount_usd_cents IS DISTINCT FROM
         target_base_amount_usd_cents
       OR v_intent.charged_amount_minor IS DISTINCT FROM
         target_charged_amount_minor
       OR v_intent.charged_currency IS DISTINCT FROM target_charged_currency
       OR v_intent.conversion_rate IS DISTINCT FROM target_conversion_rate
       OR v_intent.currency_quote_at IS DISTINCT FROM target_currency_quote_at
       OR v_intent.currency_rate_source IS DISTINCT FROM
         target_currency_rate_source
       OR v_intent.metadata IS DISTINCT FROM pg_catalog.jsonb_build_object(
         'checkout_boundary_version',
         '2026-07-16-v1'
       ) THEN
      RAISE EXCEPTION 'Checkout operation was replayed with different immutable intent terms'
        USING ERRCODE = '23505';
    END IF;

    PERFORM private.require_current_checkout_tenant_authorization_v2(
      v_intent.id
    );

    SELECT attribution.*
    INTO STRICT v_attribution
    FROM public.sponsorship_attributions attribution
    WHERE attribution.sponsorship_intent_id = v_intent.id;

    RETURN QUERY SELECT
      v_intent.id,
      v_intent.sponsor_identity_id,
      v_intent.browser_visitor_id,
      v_intent.source,
      v_intent.source_host,
      v_attribution.kind,
      v_attribution.advocate_id,
      v_attribution.exposure_id,
      v_intent.status,
      true;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_intents intent
    WHERE intent.idempotency_key = target_idempotency_key
  ) THEN
    RAISE EXCEPTION 'Existing sponsorship intent lacks an immutable checkout operation'
      USING ERRCODE = '23514';
  END IF;

  SELECT core.*
  INTO STRICT v_core_result
  FROM private.prepare_sponsorship_checkout_intent_core_v1(
    target_idempotency_key,
    target_source,
    target_advocate_hostname,
    target_visitor_token_digest,
    target_auth_user_id,
    target_contact_email_hmac,
    target_contact_email_normalization_version,
    target_contact_email_hmac_key_version,
    target_subject_kind,
    target_beneficiary_id,
    target_partnership_project,
    target_payment_mode,
    target_recurrence_interval,
    target_base_amount_usd_cents,
    target_charged_amount_minor,
    target_charged_currency,
    target_conversion_rate,
    target_currency_quote_at,
    target_currency_rate_source,
    context_request_id,
    context_trace_id
  ) core;

  PERFORM private.set_payment_audit_context(
    'prepare_sponsorship_checkout_operation_v2',
    target_provider,
    target_provider_account_scope,
    NULL,
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  INSERT INTO public.sponsorship_checkout_operations (
    operation_id,
    checkout_receipt_digest,
    sponsorship_intent_id,
    operation_sequence,
    provider,
    provider_account_scope,
    provider_idempotency_key
  )
  VALUES (
    target_checkout_operation_id,
    target_checkout_receipt_digest,
    v_core_result.resolved_sponsorship_intent_id,
    1,
    target_provider,
    target_provider_account_scope,
    target_provider_idempotency_key
  );

  RETURN QUERY SELECT
    v_core_result.resolved_sponsorship_intent_id,
    v_core_result.resolved_sponsor_identity_id,
    v_core_result.resolved_browser_visitor_id,
    v_core_result.resolved_source,
    v_core_result.resolved_source_host,
    v_core_result.resolved_attribution_kind,
    v_core_result.resolved_attribution_advocate_id,
    v_core_result.resolved_attribution_exposure_id,
    v_core_result.resolved_intent_status,
    false;
END;
$$;

/*
 * A later operation may supersede one unbegun operation, or follow one exact
 * terminal unsuccessful attempt. It cannot replace sponsor, attribution, or
 * financial terms and it cannot cross a successful or unsettled chain.
 */

CREATE OR REPLACE FUNCTION public.prepare_sponsorship_checkout_operation_v2(
  target_checkout_operation_id uuid,
  target_checkout_receipt_digest bytea,
  target_sponsorship_intent_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_idempotency_key text,
  target_predecessor_operation_id uuid,
  target_retry_after_payment_attempt_id uuid DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  checkout_operation_id uuid,
  sponsorship_intent_id uuid,
  operation_sequence smallint,
  predecessor_operation_id uuid,
  retry_after_payment_attempt_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_idempotency_key text,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_predecessor public.sponsorship_checkout_operations%ROWTYPE;
  v_predecessor_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_predecessor_attempt public.sponsorship_payment_attempts%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_checkout_operation_id IS NULL
     OR octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_sponsorship_intent_id IS NULL
     OR target_provider IS NULL
     OR target_provider_account_scope IS NULL
     OR target_provider_account_scope IS DISTINCT FROM
       lower(btrim(target_provider_account_scope))
     OR length(target_provider_account_scope) NOT BETWEEN 1 AND 120
     OR target_provider_idempotency_key IS NULL
     OR target_provider_idempotency_key IS DISTINCT FROM
       btrim(target_provider_idempotency_key)
     OR length(target_provider_idempotency_key) NOT BETWEEN 16 AND 255
     OR right(
       target_provider_idempotency_key,
       length(target_checkout_operation_id::text) + 1
     ) IS DISTINCT FROM ':' || target_checkout_operation_id::text
     OR target_predecessor_operation_id IS NULL THEN
    RAISE EXCEPTION 'Checkout operation succession scope is malformed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        'sponsorship_checkout_operation_v2',
        target_sponsorship_intent_id
      )::text,
      0
    )
  );

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id
     OR operation.checkout_receipt_digest = target_checkout_receipt_digest
     OR (
       operation.provider = target_provider
       AND operation.provider_account_scope = target_provider_account_scope
       AND operation.provider_idempotency_key = target_provider_idempotency_key
     )
  ORDER BY operation.created_at, operation.operation_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_operation.operation_id IS DISTINCT FROM target_checkout_operation_id
       OR v_operation.checkout_receipt_digest IS DISTINCT FROM
         target_checkout_receipt_digest
       OR v_operation.sponsorship_intent_id IS DISTINCT FROM
         target_sponsorship_intent_id
       OR v_operation.predecessor_operation_id IS DISTINCT FROM
         target_predecessor_operation_id
       OR v_operation.retry_after_payment_attempt_id IS DISTINCT FROM
         target_retry_after_payment_attempt_id
       OR v_operation.provider IS DISTINCT FROM target_provider
       OR v_operation.provider_account_scope IS DISTINCT FROM
         target_provider_account_scope
       OR v_operation.provider_idempotency_key IS DISTINCT FROM
         target_provider_idempotency_key THEN
      RAISE EXCEPTION 'Checkout operation succession scope belongs to another immutable operation'
        USING ERRCODE = '23505';
    END IF;

    PERFORM private.require_current_checkout_tenant_authorization_v2(
      v_operation.sponsorship_intent_id
    );

    RETURN QUERY SELECT
      v_operation.operation_id,
      v_operation.sponsorship_intent_id,
      v_operation.operation_sequence,
      v_operation.predecessor_operation_id,
      v_operation.retry_after_payment_attempt_id,
      v_operation.provider,
      v_operation.provider_account_scope,
      v_operation.provider_idempotency_key,
      true;
    RETURN;
  END IF;

  SELECT operation.*
  INTO v_predecessor
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.sponsorship_intent_id = target_sponsorship_intent_id
  ORDER BY operation.operation_sequence DESC
  LIMIT 1
  FOR UPDATE;

  SELECT attempt.*
  INTO v_predecessor_attempt
  FROM public.sponsorship_checkout_recovery_states recovery
  JOIN public.sponsorship_payment_attempts attempt
    ON attempt.id = recovery.payment_attempt_id
  WHERE recovery.checkout_operation_id = v_predecessor.operation_id
  FOR SHARE OF attempt;

  IF FOUND THEN
    SELECT recovery.*
    INTO STRICT v_predecessor_recovery
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.checkout_operation_id = v_predecessor.operation_id
      AND recovery.payment_attempt_id = v_predecessor_attempt.id
    FOR SHARE;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR UPDATE;

  IF v_intent.id IS NULL
     OR v_predecessor.operation_id IS NULL
     OR v_predecessor.operation_id IS DISTINCT FROM
       target_predecessor_operation_id
     OR v_predecessor.operation_sequence >= 32767
     OR v_intent.status NOT IN ('created', 'failed')
     OR v_intent.currency_quote_at > clock_timestamp() + interval '1 minute'
     OR v_intent.currency_quote_at < clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Checkout operation succession requires the latest retryable v2 intent state'
      USING ERRCODE = '23514';
  END IF;

  IF (
       v_predecessor_recovery.payment_attempt_id IS NULL
       AND target_retry_after_payment_attempt_id IS NOT NULL
     )
     OR (
       v_predecessor_recovery.payment_attempt_id IS NOT NULL
       AND (
         target_retry_after_payment_attempt_id IS DISTINCT FROM
           v_predecessor_attempt.id
         OR v_predecessor_recovery.status <> 'closed'
         OR v_predecessor_attempt.status NOT IN (
           'failed',
           'cancelled',
           'expired'
         )
       )
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_payment_attempts attempt
       WHERE attempt.sponsorship_intent_id = v_intent.id
         AND attempt.status IN ('created', 'pending', 'succeeded')
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_recovery_states recovery
       WHERE recovery.sponsorship_intent_id = v_intent.id
         AND recovery.status <> 'closed'
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_operations prior_operation
       JOIN public.sponsorship_payment_attempts prior_attempt
         ON prior_attempt.provider = prior_operation.provider
        AND prior_attempt.provider_account_scope =
          prior_operation.provider_account_scope
        AND prior_attempt.provider_idempotency_key =
          prior_operation.provider_idempotency_key
       LEFT JOIN public.sponsorship_checkout_recovery_states prior_recovery
         ON prior_recovery.checkout_operation_id = prior_operation.operation_id
       WHERE prior_operation.sponsorship_intent_id = v_intent.id
         AND prior_recovery.payment_attempt_id IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_financial_movements movement
       WHERE movement.sponsorship_intent_id = v_intent.id
         AND movement.entry_kind = 'sponsorship_payment'
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_reservations reservation
       WHERE reservation.sponsorship_intent_id = v_intent.id
         AND reservation.status IN ('active', 'consumed')
     )
     OR (
       v_intent.status = 'created'
       AND EXISTS (
         SELECT 1
         FROM public.sponsorship_payment_attempts attempt
         WHERE attempt.sponsorship_intent_id = v_intent.id
       )
     )
     OR (
       v_intent.status = 'failed'
       AND NOT EXISTS (
         SELECT 1
         FROM public.sponsorship_payment_attempts attempt
         WHERE attempt.sponsorship_intent_id = v_intent.id
       )
     ) THEN
    RAISE EXCEPTION 'Checkout operation succession cannot cross unsettled or successful payment evidence'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.validate_sponsorship_checkout_eligibility(v_intent.id);
  PERFORM private.validate_payment_provider_readiness(
    v_intent.id,
    target_provider,
    target_provider_account_scope
  );

  PERFORM private.set_payment_audit_context(
    'prepare_sponsorship_checkout_operation_v2',
    target_provider,
    target_provider_account_scope,
    'successor',
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  INSERT INTO public.sponsorship_checkout_operations (
    operation_id,
    checkout_receipt_digest,
    sponsorship_intent_id,
    operation_sequence,
    predecessor_operation_id,
    retry_after_payment_attempt_id,
    provider,
    provider_account_scope,
    provider_idempotency_key
  )
  VALUES (
    target_checkout_operation_id,
    target_checkout_receipt_digest,
    v_intent.id,
    v_predecessor.operation_sequence + 1,
    v_predecessor.operation_id,
    target_retry_after_payment_attempt_id,
    target_provider,
    target_provider_account_scope,
    target_provider_idempotency_key
  )
  RETURNING * INTO v_operation;

  RETURN QUERY SELECT
    v_operation.operation_id,
    v_operation.sponsorship_intent_id,
    v_operation.operation_sequence,
    v_operation.predecessor_operation_id,
    v_operation.retry_after_payment_attempt_id,
    v_operation.provider,
    v_operation.provider_account_scope,
    v_operation.provider_idempotency_key,
    false;
END;
$$;

ALTER FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) SET SCHEMA private;

ALTER FUNCTION private.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) RENAME TO issue_sponsorship_payment_quote_core_v1;

REVOKE ALL ON FUNCTION private.issue_sponsorship_payment_quote_core_v1(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
  PERFORM private.require_payment_service_role();

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_operations operation
    WHERE operation.sponsorship_intent_id = target_sponsorship_intent_id
      AND operation.checkout_boundary_version = 2
  ) THEN
    RAISE EXCEPTION 'Legacy payment quote cannot mutate a v2 checkout operation'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT core.*
  FROM private.issue_sponsorship_payment_quote_core_v1(
    target_sponsorship_intent_id,
    target_provider,
    target_provider_account_scope,
    target_quote_idempotency_key,
    target_valid_for,
    context_request_id,
    context_trace_id
  ) core;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_sponsorship_payment_quote_v2(
  target_checkout_operation_id uuid,
  target_sponsorship_intent_id uuid,
  target_quote_idempotency_key text,
  target_valid_for interval DEFAULT interval '15 minutes',
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  checkout_operation_id uuid,
  payment_quote_id uuid,
  sponsorship_intent_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  base_amount_usd_cents bigint,
  charged_amount_minor bigint,
  charged_currency public.payment_currency,
  conversion_rate numeric,
  issued_at timestamptz,
  expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_checkout_operation_id IS NULL
     OR target_sponsorship_intent_id IS NULL
     OR target_quote_idempotency_key IS DISTINCT FROM
       'quote:' || target_checkout_operation_id::text
     OR target_valid_for IS NULL
     OR target_valid_for < interval '1 minute'
     OR target_valid_for > interval '30 minutes' THEN
    RAISE EXCEPTION 'V2 payment quote issuance scope is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'sponsorship_payment_quote:' || target_quote_idempotency_key,
      0
    )
  );

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_operation.checkout_boundary_version IS DISTINCT FROM 2
     OR v_operation.sponsorship_intent_id IS DISTINCT FROM
       target_sponsorship_intent_id THEN
    RAISE EXCEPTION 'V2 payment quote does not match its immutable operation'
      USING ERRCODE = '23505';
  END IF;

  PERFORM private.require_current_checkout_tenant_authorization_v2(
    v_operation.sponsorship_intent_id
  );

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.quote_idempotency_key = target_quote_idempotency_key
  ORDER BY quote.issued_at, quote.id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.sponsorship_payment_quotes other_quote
      WHERE other_quote.quote_idempotency_key = target_quote_idempotency_key
        AND other_quote.id <> v_quote.id
    )
       OR v_quote.sponsorship_intent_id IS DISTINCT FROM
         v_operation.sponsorship_intent_id
       OR v_quote.provider IS DISTINCT FROM v_operation.provider
       OR v_quote.provider_account_scope IS DISTINCT FROM
         v_operation.provider_account_scope THEN
      RAISE EXCEPTION 'V2 payment quote idempotency key belongs to another checkout'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_operation.operation_id,
      v_quote.id,
      v_quote.sponsorship_intent_id,
      v_quote.provider,
      v_quote.provider_account_scope,
      v_quote.base_amount_usd_cents,
      v_quote.charged_amount_minor,
      v_quote.charged_currency,
      v_quote.conversion_rate,
      v_quote.issued_at,
      v_quote.expires_at,
      true;
    RETURN;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_operation.sponsorship_intent_id
  FOR UPDATE;

  IF v_intent.status NOT IN ('created', 'failed')
     OR v_intent.currency_quote_at > clock_timestamp() + interval '1 minute'
     OR v_intent.currency_quote_at < clock_timestamp() - interval '5 minutes'
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_operations later_operation
       WHERE later_operation.sponsorship_intent_id = v_intent.id
         AND later_operation.operation_sequence > v_operation.operation_sequence
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_recovery_states recovery
       WHERE recovery.checkout_operation_id = v_operation.operation_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_payment_attempts attempt
       WHERE attempt.provider = v_operation.provider
         AND attempt.provider_account_scope = v_operation.provider_account_scope
         AND attempt.provider_idempotency_key =
           v_operation.provider_idempotency_key
     ) THEN
    RAISE EXCEPTION 'V2 payment quote requires the latest unbegun retryable operation'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.validate_sponsorship_checkout_eligibility(v_intent.id);
  PERFORM private.validate_payment_provider_readiness(
    v_intent.id,
    v_operation.provider,
    v_operation.provider_account_scope
  );

  PERFORM private.set_payment_audit_context(
    'issue_sponsorship_payment_quote_v2',
    v_operation.provider,
    v_operation.provider_account_scope,
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
    v_operation.provider,
    v_operation.provider_account_scope,
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

  RETURN QUERY SELECT
    v_operation.operation_id,
    v_quote.id,
    v_quote.sponsorship_intent_id,
    v_quote.provider,
    v_quote.provider_account_scope,
    v_quote.base_amount_usd_cents,
    v_quote.charged_amount_minor,
    v_quote.charged_currency,
    v_quote.conversion_rate,
    v_quote.issued_at,
    v_quote.expires_at,
    false;
END;
$$;

/*
 * The legacy begin implementation becomes a private primitive. The additive
 * v2 signature atomically creates the recovery row and seals an encrypted copy
 * of the canonical provider request. Randomized ciphertext may differ on an
 * exact retry, but its canonical request fingerprint may not.
 */

ALTER FUNCTION public.begin_sponsorship_payment(
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
) SET SCHEMA private;

ALTER FUNCTION private.begin_sponsorship_payment(
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
) RENAME TO begin_sponsorship_payment_core_v1;

REVOKE ALL ON FUNCTION private.begin_sponsorship_payment_core_v1(
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
BEGIN
  PERFORM private.require_payment_service_role();

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_operations operation
    WHERE operation.sponsorship_intent_id = target_sponsorship_intent_id
      AND operation.checkout_boundary_version = 2
  ) THEN
    RAISE EXCEPTION 'Legacy payment begin cannot mutate a v2 checkout operation'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT core.*
  FROM private.begin_sponsorship_payment_core_v1(
    target_sponsorship_intent_id,
    target_payment_quote_id,
    target_provider,
    target_provider_account_scope,
    target_provider_idempotency_key,
    target_checkout_receipt_digest,
    target_checkout_receipt_valid_for,
    target_metadata,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  ) core;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_sponsorship_payment_v2(
  target_checkout_operation_id uuid,
  target_sponsorship_intent_id uuid,
  target_payment_quote_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_idempotency_key text,
  target_checkout_receipt_digest bytea,
  target_provider_request_schema_version smallint,
  target_provider_request_template_claims jsonb,
  target_provider_request_fingerprint bytea,
  target_provider_request_expires_at timestamptz,
  target_provider_request_ciphertext bytea,
  target_provider_request_encryption_key_version smallint,
  target_provider_request_ciphertext_sha256 bytea,
  target_checkout_receipt_valid_for interval DEFAULT interval '24 hours',
  target_metadata jsonb DEFAULT '{}'::jsonb,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  checkout_operation_id uuid,
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
  currency_quote_at timestamptz,
  provider_request_expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz;
  v_existing_attempt_id uuid;
  v_attempt_number smallint;
  v_beneficiary_budget_goal integer;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_attempt_metadata jsonb;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_checkout_operation_id IS NULL
     OR octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_checkout_receipt_valid_for IS NULL
     OR target_checkout_receipt_valid_for < interval '5 minutes'
     OR target_checkout_receipt_valid_for > interval '7 days'
     OR jsonb_typeof(target_metadata) IS DISTINCT FROM 'object'
     OR pg_column_size(target_metadata) > 4096
     OR target_provider_request_schema_version IS DISTINCT FROM 1
     OR jsonb_typeof(target_provider_request_template_claims)
       IS DISTINCT FROM 'object'
     OR pg_column_size(target_provider_request_template_claims) > 8192
     OR octet_length(target_provider_request_fingerprint) IS DISTINCT FROM 32
     OR target_provider_request_expires_at IS NULL
     OR target_provider_request_ciphertext IS NULL
     OR octet_length(target_provider_request_ciphertext) NOT BETWEEN 32 AND 65536
     OR target_provider_request_encryption_key_version IS NULL
     OR target_provider_request_encryption_key_version NOT BETWEEN 1 AND 32767
     OR octet_length(target_provider_request_ciphertext_sha256) IS DISTINCT FROM 32
     OR target_provider_request_ciphertext_sha256 IS DISTINCT FROM
       extensions.digest(target_provider_request_ciphertext, 'sha256') THEN
    RAISE EXCEPTION 'Immutable encrypted provider checkout request evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_operation.checkout_boundary_version IS DISTINCT FROM 2
     OR v_operation.sponsorship_intent_id IS DISTINCT FROM
       target_sponsorship_intent_id
     OR v_operation.checkout_receipt_digest IS DISTINCT FROM
       target_checkout_receipt_digest
     OR v_operation.provider IS DISTINCT FROM target_provider
     OR v_operation.provider_account_scope IS DISTINCT FROM
       target_provider_account_scope
     OR v_operation.provider_idempotency_key IS DISTINCT FROM
       target_provider_idempotency_key THEN
    RAISE EXCEPTION 'Payment begin scope does not match its immutable checkout operation'
      USING ERRCODE = '23505';
  END IF;

  PERFORM private.require_current_checkout_tenant_authorization_v2(
    v_operation.sponsorship_intent_id
  );

  v_attempt_metadata := target_metadata || pg_catalog.jsonb_build_object(
    'checkout_boundary_version', 2,
    'checkout_operation_id', v_operation.operation_id
  );

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.id = target_payment_quote_id
    AND quote.sponsorship_intent_id = v_operation.sponsorship_intent_id
    AND quote.provider = v_operation.provider
    AND quote.provider_account_scope = v_operation.provider_account_scope
    AND quote.quote_idempotency_key =
      'quote:' || v_operation.operation_id::text
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment quote does not match its immutable checkout operation'
      USING ERRCODE = '23505';
  END IF;

  PERFORM private.validate_provider_request_template_v2(
    v_operation.operation_id,
    v_operation.sponsorship_intent_id,
    v_quote.id,
    target_provider_request_schema_version,
    target_provider_request_template_claims,
    target_provider_request_fingerprint,
    target_provider_request_expires_at
  );

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

  SELECT attempt.id
  INTO v_existing_attempt_id
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.provider = target_provider
    AND attempt.provider_account_scope = target_provider_account_scope
    AND attempt.provider_idempotency_key = target_provider_idempotency_key
  FOR UPDATE;

  IF v_existing_attempt_id IS NULL THEN
    v_now := clock_timestamp();

    IF (
         target_provider = 'STRIPE'
         AND target_provider_request_expires_at <
           v_now + interval '30 minutes'
       )
       OR (
         target_provider <> 'STRIPE'
         AND target_provider_request_expires_at <
           v_now + interval '5 minutes'
       )
       OR target_provider_request_expires_at > v_now + interval '24 hours'
       OR v_quote.expires_at <= v_now
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_operations later_operation
         WHERE later_operation.sponsorship_intent_id =
           v_operation.sponsorship_intent_id
           AND later_operation.operation_sequence >
             v_operation.operation_sequence
       ) THEN
      RAISE EXCEPTION 'Initial provider checkout request expiry is outside provider bounds'
        USING ERRCODE = '22023';
    END IF;

    SELECT intent.*
    INTO v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = v_operation.sponsorship_intent_id
    FOR UPDATE;

    IF v_intent.status NOT IN ('created', 'failed')
       OR (
         v_intent.status = 'failed'
         AND (
           v_intent.currency_quote_at > v_now + interval '1 minute'
           OR v_intent.currency_quote_at < v_now - interval '5 minutes'
         )
       )
       OR (
         v_intent.status = 'created'
         AND EXISTS (
           SELECT 1
           FROM public.sponsorship_payment_attempts prior_attempt
           WHERE prior_attempt.sponsorship_intent_id = v_intent.id
         )
       )
       OR (
         v_intent.status = 'failed'
         AND NOT EXISTS (
           SELECT 1
           FROM public.sponsorship_payment_attempts prior_attempt
           WHERE prior_attempt.sponsorship_intent_id = v_intent.id
         )
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_payment_attempts prior_attempt
         WHERE prior_attempt.sponsorship_intent_id = v_intent.id
           AND prior_attempt.status IN ('created', 'pending', 'succeeded')
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_recovery_states prior_recovery
         WHERE prior_recovery.sponsorship_intent_id = v_intent.id
           AND prior_recovery.status <> 'closed'
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_operations prior_operation
         JOIN public.sponsorship_payment_attempts prior_attempt
           ON prior_attempt.sponsorship_intent_id =
                prior_operation.sponsorship_intent_id
          AND prior_attempt.provider = prior_operation.provider
          AND prior_attempt.provider_account_scope =
                prior_operation.provider_account_scope
          AND prior_attempt.provider_idempotency_key =
                prior_operation.provider_idempotency_key
         LEFT JOIN public.sponsorship_checkout_recovery_states prior_recovery
           ON prior_recovery.checkout_operation_id = prior_operation.operation_id
          AND prior_recovery.payment_attempt_id = prior_attempt.id
         WHERE prior_operation.sponsorship_intent_id = v_intent.id
           AND prior_operation.checkout_boundary_version = 2
           AND prior_recovery.payment_attempt_id IS NULL
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_financial_movements movement
         WHERE movement.sponsorship_intent_id = v_intent.id
           AND movement.entry_kind = 'sponsorship_payment'
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_reservations reservation
         WHERE reservation.sponsorship_intent_id = v_intent.id
           AND reservation.status IN ('active', 'consumed')
       ) THEN
      RAISE EXCEPTION 'V2 payment begin cannot cross unsettled or successful intent evidence'
        USING ERRCODE = '23514';
    END IF;

    PERFORM private.validate_sponsorship_checkout_eligibility(v_intent.id);
    PERFORM private.validate_payment_provider_readiness(
      v_intent.id,
      v_operation.provider,
      v_operation.provider_account_scope
    );

    SELECT (COALESCE(max(attempt.attempt_number), 0) + 1)::smallint
    INTO v_attempt_number
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.sponsorship_intent_id = v_intent.id;

    PERFORM private.set_payment_audit_context(
      'begin_sponsorship_payment_v2',
      v_operation.provider,
      v_operation.provider_account_scope,
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
      v_operation.checkout_receipt_digest,
      v_now + target_checkout_receipt_valid_for,
      v_attempt_number,
      v_operation.provider,
      v_operation.provider_account_scope,
      v_operation.provider_idempotency_key,
      'created',
      v_intent.payment_mode,
      v_intent.base_amount_usd_cents,
      v_intent.charged_amount_minor,
      v_intent.charged_currency,
      v_intent.conversion_rate,
      v_intent.currency_quote_at,
      v_attempt_metadata
    )
    RETURNING * INTO v_attempt;

    IF v_intent.subject_kind = 'standard' THEN
      SELECT beneficiary.budget_goal
      INTO STRICT v_beneficiary_budget_goal
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
          target_provider_request_expires_at
        );
      END IF;
    END IF;

    IF v_intent.status = 'created' THEN
      UPDATE public.sponsorship_intents intent
      SET status = 'committed'
      WHERE intent.id = v_intent.id
      RETURNING * INTO v_intent;
    END IF;
  ELSE
    SELECT attempt.*
    INTO STRICT v_attempt
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.id = v_existing_attempt_id
    FOR UPDATE;
  END IF;

  IF v_attempt.sponsorship_intent_id IS DISTINCT FROM
       v_operation.sponsorship_intent_id
     OR v_attempt.payment_quote_id IS DISTINCT FROM v_quote.id
     OR v_attempt.provider IS DISTINCT FROM v_operation.provider
     OR v_attempt.provider_account_scope IS DISTINCT FROM
       v_operation.provider_account_scope
     OR v_attempt.provider_idempotency_key IS DISTINCT FROM
       v_operation.provider_idempotency_key
     OR v_attempt.checkout_receipt_digest IS DISTINCT FROM
       v_operation.checkout_receipt_digest
     OR v_attempt.metadata IS DISTINCT FROM v_attempt_metadata THEN
    RAISE EXCEPTION 'Payment attempt broke its immutable checkout operation chain'
      USING ERRCODE = '23514';
  END IF;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = v_attempt.id
  FOR UPDATE;

  IF FOUND THEN
    IF v_recovery.checkout_operation_id IS DISTINCT FROM
         target_checkout_operation_id
       OR v_recovery.provider_request_schema_version IS DISTINCT FROM
         target_provider_request_schema_version
       OR v_recovery.provider_request_template_claims IS DISTINCT FROM
         target_provider_request_template_claims
       OR v_recovery.provider_request_fingerprint IS DISTINCT FROM
         target_provider_request_fingerprint
       OR v_recovery.provider_request_expires_at IS DISTINCT FROM
         target_provider_request_expires_at
       OR v_recovery.provider_request_encryption_key_version IS DISTINCT FROM
         target_provider_request_encryption_key_version THEN
      RAISE EXCEPTION 'Provider checkout request was replayed with different immutable evidence'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    IF v_existing_attempt_id IS NOT NULL THEN
      RAISE EXCEPTION 'Existing payment attempt has no exact checkout recovery state'
        USING ERRCODE = '23514';
    END IF;

    PERFORM private.set_payment_audit_context(
      'begin_sponsorship_payment_recovery_v2',
      v_attempt.provider,
      v_attempt.provider_account_scope,
      NULL,
      NULL,
      context_request_id,
      context_trace_id,
      context_client_ip,
      context_user_agent
    );

    v_now := clock_timestamp();

    INSERT INTO public.sponsorship_checkout_recovery_states (
      payment_attempt_id,
      checkout_operation_id,
      sponsorship_intent_id,
      payment_quote_id,
      provider,
      provider_account_scope,
      provider_request_schema_version,
      provider_request_template_claims,
      provider_request_fingerprint,
      provider_request_expires_at,
      provider_request_ciphertext,
      provider_request_encryption_key_version,
      provider_request_ciphertext_sha256,
      next_reconciliation_at
    )
    VALUES (
      v_attempt.id,
      v_operation.operation_id,
      v_attempt.sponsorship_intent_id,
      v_attempt.payment_quote_id,
      v_attempt.provider,
      v_attempt.provider_account_scope,
      target_provider_request_schema_version,
      target_provider_request_template_claims,
      target_provider_request_fingerprint,
      target_provider_request_expires_at,
      target_provider_request_ciphertext,
      target_provider_request_encryption_key_version,
      target_provider_request_ciphertext_sha256,
      v_now + interval '2 minutes'
    )
    RETURNING * INTO v_recovery;
  END IF;

  RETURN QUERY SELECT
    v_operation.operation_id,
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
    v_attempt.currency_quote_at,
    v_recovery.provider_request_expires_at,
    v_existing_attempt_id IS NOT NULL;
END;
$$;

/*
 * Attachment is exact and replayable after terminal completion. The public
 * result never includes the provider object identifier.
 */

ALTER FUNCTION public.attach_sponsorship_payment_provider_object(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text
)
SET SCHEMA private;

ALTER FUNCTION private.attach_sponsorship_payment_provider_object(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text
)
RENAME TO attach_sponsorship_payment_provider_object_core_v1;

REVOKE ALL ON FUNCTION private.attach_sponsorship_payment_provider_object_core_v1(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
  PERFORM private.require_payment_service_role();

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.payment_attempt_id = target_payment_attempt_id
  ) THEN
    RAISE EXCEPTION 'Legacy provider attachment cannot mutate a v2 checkout operation'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT core.*
  FROM private.attach_sponsorship_payment_provider_object_core_v1(
    target_payment_attempt_id,
    target_provider_object_type,
    target_provider_object_id,
    target_expires_at,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  ) core;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_sponsorship_payment_provider_object_v2(
  target_payment_attempt_id uuid,
  target_provider_object_type text,
  target_provider_object_id text,
  target_provider_request_schema_version smallint,
  target_provider_request_fingerprint bytea,
  target_provider_request_expires_at timestamptz,
  target_recovery_lease_token uuid DEFAULT NULL,
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
  status public.sponsorship_payment_attempt_status,
  provider_object_attached boolean,
  provider_request_expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_reservation public.sponsorship_checkout_reservations%ROWTYPE;
  v_expected_type text;
  v_beneficiary_budget_goal integer;
  v_requires_active_reservation boolean := false;
  v_updated_rows integer;
  v_replayed boolean := false;
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

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = v_attempt.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment attempt has no exact checkout recovery state'
      USING ERRCODE = '23514';
  END IF;

  v_expected_type := CASE
    WHEN v_attempt.provider = 'STRIPE' THEN 'checkout_session'
    WHEN v_attempt.payment_mode = 'one_time' THEN 'order'
    ELSE 'billing_subscription'
  END;

  IF target_provider_object_type IS DISTINCT FROM v_expected_type
     OR target_provider_object_id IS NULL
     OR target_provider_object_id IS DISTINCT FROM
       btrim(target_provider_object_id)
     OR length(target_provider_object_id) NOT BETWEEN 1 AND 255
     OR target_provider_request_schema_version IS DISTINCT FROM
       v_recovery.provider_request_schema_version
     OR target_provider_request_fingerprint IS DISTINCT FROM
       v_recovery.provider_request_fingerprint
     OR target_provider_request_expires_at IS DISTINCT FROM
       v_recovery.provider_request_expires_at THEN
    RAISE EXCEPTION 'Provider object attachment does not match its immutable checkout request'
      USING ERRCODE = '23505';
  END IF;

  IF v_attempt.provider_object_id IS NOT NULL THEN
    IF v_attempt.provider_object_type IS DISTINCT FROM
         target_provider_object_type
       OR v_attempt.provider_object_id IS DISTINCT FROM
         target_provider_object_id
       OR v_recovery.provider_attached_at IS NULL
       OR v_recovery.provider_attached_expires_at IS DISTINCT FROM
         target_provider_request_expires_at
       OR NOT EXISTS (
         SELECT 1
         FROM public.payment_provider_object_links link
         WHERE link.payment_attempt_id = v_attempt.id
           AND link.sponsorship_intent_id = v_attempt.sponsorship_intent_id
           AND link.provider = v_attempt.provider
           AND link.provider_account_scope = v_attempt.provider_account_scope
           AND link.provider_object_type = target_provider_object_type
           AND link.provider_object_id = target_provider_object_id
           AND link.relationship = 'checkout'
           AND link.expires_at IS NOT DISTINCT FROM
             target_provider_request_expires_at
       ) THEN
      RAISE EXCEPTION 'Payment attempt already has different provider attachment evidence'
        USING ERRCODE = '23505';
    END IF;

    v_replayed := true;
  ELSE
    IF v_attempt.status <> 'created'
       OR v_recovery.provider_request_expires_at <= clock_timestamp()
       OR NOT (
         (
           v_recovery.status = 'available'
           AND v_recovery.attempt_count = 0
           AND target_recovery_lease_token IS NULL
         )
         OR (
           v_recovery.status = 'leased'
           AND v_recovery.lease_token IS NOT DISTINCT FROM
             target_recovery_lease_token
           AND v_recovery.lease_expires_at > clock_timestamp()
         )
       ) THEN
      RAISE EXCEPTION 'Provider object can attach only to an active exact checkout request'
        USING ERRCODE = '23514';
    END IF;

    SELECT intent.*
    INTO STRICT v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = v_attempt.sponsorship_intent_id
    FOR UPDATE;

    IF (v_attempt.attempt_number = 1 AND v_intent.status <> 'committed')
       OR (v_attempt.attempt_number > 1 AND v_intent.status <> 'failed') THEN
      RAISE EXCEPTION 'Provider object attachment requires the exact initial or retryable intent state'
        USING ERRCODE = '23514';
    END IF;

    IF v_intent.subject_kind = 'standard' THEN
      SELECT beneficiary.budget_goal
      INTO STRICT v_beneficiary_budget_goal
      FROM public.beneficiaries beneficiary
      WHERE beneficiary.id = v_intent.beneficiary_id
      FOR SHARE;
    END IF;

    SELECT reservation.*
    INTO v_reservation
    FROM public.sponsorship_checkout_reservations reservation
    WHERE reservation.payment_attempt_id = v_attempt.id
    FOR UPDATE;

    v_requires_active_reservation :=
      v_intent.subject_kind = 'standard'
      AND (
        v_beneficiary_budget_goal <> -1
        OR v_reservation.id IS NOT NULL
      );

    IF (
      v_requires_active_reservation
      AND (
        v_reservation.id IS NULL
        OR v_reservation.status <> 'active'
      )
    )
       OR (
         NOT v_requires_active_reservation
         AND v_reservation.id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Provider object attachment requires the exact active beneficiary reservation state'
        USING ERRCODE = '23514';
    END IF;

    PERFORM private.set_payment_audit_context(
      'attach_sponsorship_payment_provider_object_v2',
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
      target_provider_request_expires_at
    );

    UPDATE public.sponsorship_payment_attempts attempt
    SET
      provider_object_type = target_provider_object_type,
      provider_object_id = target_provider_object_id,
      status = 'pending'
    WHERE attempt.id = v_attempt.id
    RETURNING * INTO v_attempt;

    UPDATE public.sponsorship_checkout_reservations reservation
    SET
      provider_object_expires_at = target_provider_request_expires_at,
      lease_expires_at = greatest(
        reservation.lease_expires_at,
        target_provider_request_expires_at
      )
    WHERE reservation.payment_attempt_id = v_attempt.id
      AND reservation.status = 'active';

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    IF v_requires_active_reservation AND v_updated_rows <> 1
       OR NOT v_requires_active_reservation AND v_updated_rows <> 0 THEN
      RAISE EXCEPTION 'Provider attachment did not preserve its beneficiary reservation'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.sponsorship_intents intent
    SET status = 'processing'
    WHERE intent.id = v_attempt.sponsorship_intent_id
      AND intent.status = v_intent.status;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    IF v_updated_rows <> 1 THEN
      RAISE EXCEPTION 'Provider attachment did not advance its exact sponsorship intent state'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.sponsorship_checkout_recovery_states recovery
    SET
      provider_attached_at = clock_timestamp(),
      provider_attached_expires_at = target_provider_request_expires_at,
      next_reconciliation_at = target_provider_request_expires_at,
      last_error_code = CASE
        WHEN recovery.status = 'manual_review' THEN recovery.last_error_code
        ELSE NULL
      END
    WHERE recovery.payment_attempt_id = v_attempt.id
    RETURNING * INTO v_recovery;
  END IF;

  RETURN QUERY SELECT
    v_attempt.id,
    v_attempt.sponsorship_intent_id,
    v_attempt.provider,
    v_attempt.provider_account_scope,
    v_attempt.status,
    true,
    v_recovery.provider_request_expires_at,
    v_replayed;
END;
$$;

/*
 * Recovery starts from the opaque receipt digest and exact operation scope.
 * It can return an intent before a quote and a quote before an attempt. It
 * intentionally omits sponsor identity, contact data, provider object IDs,
 * the raw receipt, and encrypted provider request bytes.
 */

CREATE OR REPLACE FUNCTION public.recover_sponsorship_checkout_v2(
  target_checkout_receipt_digest bytea,
  target_expected_operation_id uuid,
  target_expected_provider public.sponsorship_method,
  target_expected_provider_account_scope text,
  target_expected_provider_idempotency_key text
)
RETURNS TABLE (
  operation_id uuid,
  operation_created_at timestamptz,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  payment_quote_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  intent_status public.sponsorship_intent_status,
  attempt_status public.sponsorship_payment_attempt_status,
  subject_kind public.sponsorship_subject_kind,
  beneficiary_id uuid,
  payment_mode public.sponsorship_payment_mode,
  recurrence_interval text,
  base_amount_usd_cents bigint,
  charged_amount_minor bigint,
  charged_currency public.payment_currency,
  conversion_rate numeric,
  currency_quote_at timestamptz,
  quote_issued_at timestamptz,
  quote_expires_at timestamptz,
  checkout_receipt_expires_at timestamptz,
  provider_request_schema_version smallint,
  provider_request_fingerprint bytea,
  provider_request_expires_at timestamptz,
  provider_request_encryption_key_version smallint,
  provider_object_attached boolean,
  recovery_status text,
  recovery_attempt_count smallint,
  recovery_max_attempts smallint,
  next_reconciliation_at timestamptz
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
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_expected_operation_id IS NULL
     OR target_expected_provider IS NULL
     OR target_expected_provider_account_scope IS NULL
     OR target_expected_provider_account_scope IS DISTINCT FROM
       lower(btrim(target_expected_provider_account_scope))
     OR target_expected_provider_idempotency_key IS NULL
     OR target_expected_provider_idempotency_key IS DISTINCT FROM
       btrim(target_expected_provider_idempotency_key)
     OR right(
       target_expected_provider_idempotency_key,
       length(target_expected_operation_id::text) + 1
     ) IS DISTINCT FROM ':' || target_expected_operation_id::text THEN
    RAISE EXCEPTION 'Checkout recovery scope is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_expected_operation_id
    OR operation.checkout_receipt_digest = target_checkout_receipt_digest
  ORDER BY operation.created_at, operation.operation_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_operations other_operation
    WHERE (
      other_operation.operation_id = target_expected_operation_id
      OR other_operation.checkout_receipt_digest =
        target_checkout_receipt_digest
    )
      AND other_operation.operation_id <> v_operation.operation_id
  )
     OR v_operation.operation_id IS DISTINCT FROM target_expected_operation_id
     OR v_operation.checkout_receipt_digest IS DISTINCT FROM
       target_checkout_receipt_digest
     OR v_operation.provider IS DISTINCT FROM target_expected_provider
     OR v_operation.provider_account_scope IS DISTINCT FROM
       target_expected_provider_account_scope
     OR v_operation.provider_idempotency_key IS DISTINCT FROM
       target_expected_provider_idempotency_key THEN
    RAISE EXCEPTION 'Checkout recovery scope does not match its immutable operation'
      USING ERRCODE = '23505';
  END IF;

  SELECT intent.*
  INTO STRICT v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_operation.sponsorship_intent_id;

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.sponsorship_intent_id = v_intent.id
    AND quote.provider = v_operation.provider
    AND quote.provider_account_scope = v_operation.provider_account_scope
    AND quote.quote_idempotency_key =
      'quote:' || v_operation.operation_id::text;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.sponsorship_intent_id = v_intent.id
    AND attempt.provider = v_operation.provider
    AND attempt.provider_account_scope = v_operation.provider_account_scope
    AND attempt.provider_idempotency_key =
      v_operation.provider_idempotency_key;

  IF v_attempt.id IS NOT NULL THEN
    IF v_quote.id IS NULL
       OR v_attempt.payment_quote_id IS DISTINCT FROM v_quote.id
       OR v_attempt.checkout_receipt_digest IS DISTINCT FROM
         v_operation.checkout_receipt_digest THEN
      RAISE EXCEPTION 'Recovered payment attempt has a broken checkout operation chain'
        USING ERRCODE = '23514';
    END IF;

    SELECT recovery.*
    INTO v_recovery
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.payment_attempt_id = v_attempt.id;

    IF NOT FOUND
       OR v_recovery.checkout_operation_id IS DISTINCT FROM
         v_operation.operation_id THEN
      RAISE EXCEPTION 'Recovered payment attempt lacks its exact durable recovery state'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_operation.operation_id,
    v_operation.created_at,
    v_attempt.id,
    v_intent.id,
    v_quote.id,
    v_operation.provider,
    v_operation.provider_account_scope,
    v_intent.status,
    v_attempt.status,
    v_intent.subject_kind,
    v_intent.beneficiary_id,
    v_intent.payment_mode,
    v_intent.recurrence_interval,
    v_intent.base_amount_usd_cents,
    v_intent.charged_amount_minor,
    v_intent.charged_currency,
    v_intent.conversion_rate,
    v_intent.currency_quote_at,
    v_quote.issued_at,
    v_quote.expires_at,
    v_attempt.checkout_receipt_expires_at,
    v_recovery.provider_request_schema_version,
    v_recovery.provider_request_fingerprint,
    v_recovery.provider_request_expires_at,
    v_recovery.provider_request_encryption_key_version,
    COALESCE(v_attempt.provider_object_id IS NOT NULL, false),
    CASE
      WHEN v_attempt.id IS NOT NULL THEN v_recovery.status
      WHEN v_quote.id IS NOT NULL THEN 'quote_issued'
      ELSE 'intent_prepared'
    END,
    v_recovery.attempt_count,
    v_recovery.max_attempts,
    v_recovery.next_reconciliation_at;
END;
$$;

/*
 * Foreground recovery acquires an immediate lease only before any worker has
 * touched the operation. The application can decrypt the canonical template,
 * materialize the one typed attempt identifier, and repeat provider creation
 * under the same idempotency key. Attached provider identifiers never leave
 * the payment service boundary.
 */

CREATE OR REPLACE FUNCTION public.resume_sponsorship_checkout_operation_v2(
  target_checkout_receipt_digest bytea,
  target_checkout_operation_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_idempotency_key text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  checkout_operation_id uuid,
  payment_attempt_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_idempotency_key text,
  attempt_status public.sponsorship_payment_attempt_status,
  provider_object_attached boolean,
  provider_request_schema_version smallint,
  provider_request_template_claims jsonb,
  provider_request_fingerprint bytea,
  provider_request_expires_at timestamptz,
  provider_request_ciphertext bytea,
  provider_request_encryption_key_version smallint,
  provider_request_ciphertext_sha256 bytea,
  foreground_lease_token uuid,
  foreground_lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_now timestamptz;
BEGIN
  PERFORM private.require_payment_service_role();

  IF octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_checkout_operation_id IS NULL
     OR target_provider IS NULL
     OR target_provider_account_scope IS NULL
     OR target_provider_account_scope IS DISTINCT FROM
       lower(btrim(target_provider_account_scope))
     OR target_provider_idempotency_key IS NULL
     OR target_provider_idempotency_key IS DISTINCT FROM
       btrim(target_provider_idempotency_key) THEN
    RAISE EXCEPTION 'Foreground checkout resume scope is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id
     OR operation.checkout_receipt_digest = target_checkout_receipt_digest
     OR (
       operation.provider = target_provider
       AND operation.provider_account_scope = target_provider_account_scope
       AND operation.provider_idempotency_key = target_provider_idempotency_key
     )
  ORDER BY operation.created_at, operation.operation_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND
     OR v_operation.checkout_boundary_version IS DISTINCT FROM 2
     OR v_operation.operation_id IS DISTINCT FROM target_checkout_operation_id
     OR v_operation.checkout_receipt_digest IS DISTINCT FROM
       target_checkout_receipt_digest
     OR v_operation.provider IS DISTINCT FROM target_provider
     OR v_operation.provider_account_scope IS DISTINCT FROM
       target_provider_account_scope
     OR v_operation.provider_idempotency_key IS DISTINCT FROM
       target_provider_idempotency_key THEN
    RAISE EXCEPTION 'Foreground checkout resume scope conflicts with immutable operation evidence'
      USING ERRCODE = '23505';
  END IF;

  PERFORM private.require_current_checkout_tenant_authorization_v2(
    v_operation.sponsorship_intent_id
  );

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_checkout_recovery_states recovery
  JOIN public.sponsorship_payment_attempts attempt
    ON attempt.id = recovery.payment_attempt_id
  WHERE recovery.checkout_operation_id = v_operation.operation_id
  FOR UPDATE OF attempt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Foreground checkout resume requires an existing v2 payment attempt'
      USING ERRCODE = '23503';
  END IF;

  SELECT recovery.*
  INTO STRICT v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.checkout_operation_id = v_operation.operation_id
    AND recovery.payment_attempt_id = v_attempt.id
  FOR UPDATE;

  v_now := clock_timestamp();

  IF v_attempt.status NOT IN ('created', 'pending')
     OR v_recovery.status <> 'available'
     OR v_recovery.attempt_count <> 0
     OR v_recovery.lease_token IS NOT NULL
     OR v_recovery.lease_expires_at IS NOT NULL
     OR v_recovery.leased_by IS NOT NULL
     OR v_recovery.provider_request_expires_at <= v_now
     OR (
       v_attempt.status = 'created'
       AND (
         v_attempt.provider_object_id IS NOT NULL
         OR v_recovery.provider_attached_at IS NOT NULL
       )
     )
     OR (
       v_attempt.status = 'pending'
       AND (
         v_attempt.provider_object_id IS NULL
         OR v_recovery.provider_attached_at IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Foreground checkout resume cannot race prior recovery work or a terminal chain'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM private.set_payment_audit_context(
    'resume_sponsorship_checkout_operation_v2',
    v_attempt.provider,
    v_attempt.provider_account_scope,
    'foreground_resume',
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  UPDATE public.sponsorship_checkout_recovery_states recovery
  SET
    status = 'leased',
    attempt_count = 1,
    lease_token = gen_random_uuid(),
    lease_expires_at = least(
      v_now + interval '5 minutes',
      recovery.provider_request_expires_at
    ),
    leased_by = 'foreground_resume_v2'
  WHERE recovery.payment_attempt_id = v_attempt.id
  RETURNING * INTO v_recovery;

  RETURN QUERY SELECT
    v_operation.operation_id,
    v_attempt.id,
    v_attempt.provider,
    v_attempt.provider_account_scope,
    v_attempt.provider_idempotency_key,
    v_attempt.status,
    v_attempt.provider_object_id IS NOT NULL,
    v_recovery.provider_request_schema_version,
    v_recovery.provider_request_template_claims,
    v_recovery.provider_request_fingerprint,
    v_recovery.provider_request_expires_at,
    v_recovery.provider_request_ciphertext,
    v_recovery.provider_request_encryption_key_version,
    v_recovery.provider_request_ciphertext_sha256,
    v_recovery.lease_token,
    v_recovery.lease_expires_at;
END;
$$;

/*
 * The scheduled claim is the only routine that returns a provider object
 * identifier. Both claim paths are confined to the payment service role.
 */

CREATE OR REPLACE FUNCTION public.claim_sponsorship_checkout_recoveries_v2(
  target_worker_id text,
  target_batch_size integer DEFAULT 10,
  target_lease_seconds integer DEFAULT 300,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  operation_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  payment_quote_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  attempt_status public.sponsorship_payment_attempt_status,
  recovery_stage text,
  subject_kind public.sponsorship_subject_kind,
  beneficiary_id uuid,
  payment_mode public.sponsorship_payment_mode,
  recurrence_interval text,
  base_amount_usd_cents bigint,
  charged_amount_minor bigint,
  charged_currency public.payment_currency,
  conversion_rate numeric,
  currency_quote_at timestamptz,
  quote_issued_at timestamptz,
  quote_expires_at timestamptz,
  checkout_receipt_expires_at timestamptz,
  provider_idempotency_key text,
  provider_request_schema_version smallint,
  provider_request_template_claims jsonb,
  provider_request_fingerprint bytea,
  provider_request_expires_at timestamptz,
  provider_request_ciphertext bytea,
  provider_request_encryption_key_version smallint,
  provider_request_ciphertext_sha256 bytea,
  provider_object_type text,
  provider_object_id text,
  recovery_attempt_count smallint,
  recovery_max_attempts smallint,
  recovery_lease_token uuid,
  recovery_lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_worker_id IS NULL
     OR target_worker_id IS DISTINCT FROM btrim(target_worker_id)
     OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$'
     OR target_batch_size IS NULL
     OR target_batch_size NOT BETWEEN 1 AND 20
     OR target_lease_seconds IS NULL
     OR target_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Checkout recovery claim parameters are invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.set_payment_audit_context(
    'claim_sponsorship_checkout_recoveries_v2',
    NULL,
    NULL,
    NULL,
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  UPDATE public.sponsorship_checkout_recovery_states recovery
  SET
    status = 'manual_review',
    lease_token = NULL,
    lease_expires_at = NULL,
    leased_by = NULL,
    last_error_code = COALESCE(
      recovery.last_error_code,
      'recovery_attempts_exhausted'
    )
  WHERE recovery.attempt_count >= recovery.max_attempts
    AND (
      recovery.status = 'available'
      OR (
        recovery.status = 'leased'
        AND recovery.lease_expires_at <= clock_timestamp()
      )
    );

  /*
   * A created attempt has no locally known provider object. Repeating its
   * sealed request can therefore create a new hosted checkout. Once its exact
   * advocate tenant is inactive, keep the ciphertext out of worker claims and
   * make the stopped operation visible for manual review. Pending attempts
   * already have provider objects and remain eligible for reconciliation.
   */
  UPDATE public.sponsorship_checkout_recovery_states recovery
  SET
    status = 'manual_review',
    attempt_count = recovery.max_attempts,
    lease_token = NULL,
    lease_expires_at = NULL,
    leased_by = NULL,
    last_error_code = 'advocate_portal_inactive'
  FROM public.sponsorship_payment_attempts attempt
  JOIN public.sponsorship_intents intent
    ON intent.id = attempt.sponsorship_intent_id
  WHERE recovery.payment_attempt_id = attempt.id
    AND attempt.status = 'created'
    AND attempt.provider_object_id IS NULL
    AND intent.source = 'advocate_domain'
    AND recovery.attempt_count < recovery.max_attempts
    AND (
      recovery.status = 'available'
      OR (
        recovery.status = 'leased'
        AND recovery.lease_expires_at <= clock_timestamp()
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.advocate_domains domain
      JOIN public.advocates advocate
        ON advocate.id = domain.advocate_id
      WHERE domain.id = intent.source_advocate_domain_id
        AND domain.advocate_id = intent.source_advocate_id
        AND domain.hostname = intent.source_host
        AND domain.status = 'active'
        AND advocate.relationship_status = 'active'
        AND advocate.publication_status = 'active'
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT recovery.payment_attempt_id
    FROM public.sponsorship_checkout_recovery_states recovery
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = recovery.payment_attempt_id
    JOIN public.sponsorship_intents intent
      ON intent.id = attempt.sponsorship_intent_id
    WHERE attempt.status IN ('created', 'pending')
      AND recovery.attempt_count < recovery.max_attempts
      AND (
        (
          recovery.status = 'available'
          AND recovery.next_reconciliation_at <= clock_timestamp()
        )
        OR (
          recovery.status = 'leased'
          AND recovery.lease_expires_at <= clock_timestamp()
        )
      )
      AND (
        (
          attempt.status = 'created'
          AND attempt.provider_object_id IS NULL
          AND recovery.provider_attached_at IS NULL
        )
        OR (
          attempt.status = 'pending'
          AND attempt.provider_object_id IS NOT NULL
          AND recovery.provider_attached_at IS NOT NULL
        )
      )
      AND (
        attempt.status = 'pending'
        OR intent.source = 'primary_site'
        OR (
          intent.source = 'advocate_domain'
          AND EXISTS (
            SELECT 1
            FROM public.advocate_domains domain
            JOIN public.advocates advocate
              ON advocate.id = domain.advocate_id
            WHERE domain.id = intent.source_advocate_domain_id
              AND domain.advocate_id = intent.source_advocate_id
              AND domain.hostname = intent.source_host
              AND domain.status = 'active'
              AND advocate.relationship_status = 'active'
              AND advocate.publication_status = 'active'
          )
        )
      )
    ORDER BY
      recovery.next_reconciliation_at,
      recovery.created_at,
      recovery.payment_attempt_id
    FOR UPDATE OF recovery SKIP LOCKED
    LIMIT target_batch_size
  ),
  claimed AS (
    UPDATE public.sponsorship_checkout_recovery_states recovery
    SET
      status = 'leased',
      attempt_count = recovery.attempt_count + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp()
        + make_interval(secs => target_lease_seconds),
      leased_by = target_worker_id
    FROM candidates
    WHERE recovery.payment_attempt_id = candidates.payment_attempt_id
    RETURNING recovery.*
  )
  SELECT
    operation.operation_id,
    attempt.id,
    intent.id,
    quote.id,
    attempt.provider,
    attempt.provider_account_scope,
    attempt.status,
    CASE
      WHEN attempt.status = 'created' THEN 'create_or_attach'
      ELSE 'reconcile_pending'
    END,
    intent.subject_kind,
    intent.beneficiary_id,
    attempt.payment_mode,
    intent.recurrence_interval,
    attempt.base_amount_usd_cents,
    attempt.charged_amount_minor,
    attempt.charged_currency,
    attempt.conversion_rate,
    attempt.currency_quote_at,
    quote.issued_at,
    quote.expires_at,
    attempt.checkout_receipt_expires_at,
    attempt.provider_idempotency_key,
    claimed.provider_request_schema_version,
    claimed.provider_request_template_claims,
    claimed.provider_request_fingerprint,
    claimed.provider_request_expires_at,
    claimed.provider_request_ciphertext,
    claimed.provider_request_encryption_key_version,
    claimed.provider_request_ciphertext_sha256,
    attempt.provider_object_type,
    attempt.provider_object_id,
    claimed.attempt_count,
    claimed.max_attempts,
    claimed.lease_token,
    claimed.lease_expires_at
  FROM claimed
  JOIN public.sponsorship_payment_attempts attempt
    ON attempt.id = claimed.payment_attempt_id
  JOIN public.sponsorship_intents intent
    ON intent.id = attempt.sponsorship_intent_id
  JOIN public.sponsorship_payment_quotes quote
    ON quote.id = attempt.payment_quote_id
  JOIN public.sponsorship_checkout_operations operation
    ON operation.operation_id = claimed.checkout_operation_id
  ORDER BY claimed.next_reconciliation_at, claimed.payment_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_sponsorship_checkout_recovery_v2(
  target_payment_attempt_id uuid,
  target_recovery_lease_token uuid,
  target_retry_delay interval,
  target_error_code text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  payment_attempt_id uuid,
  recovery_status text,
  recovery_attempt_count smallint,
  recovery_max_attempts smallint,
  next_reconciliation_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_recovery_lease_token IS NULL
     OR target_retry_delay IS NULL
     OR target_retry_delay < interval '15 seconds'
     OR target_retry_delay > interval '24 hours'
     OR target_error_code IS NULL
     OR target_error_code IS DISTINCT FROM lower(btrim(target_error_code))
     OR target_error_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'Checkout recovery retry evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = target_payment_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment attempt does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_attempt.status NOT IN ('created', 'pending') THEN
    RAISE EXCEPTION 'Terminal checkout attempt cannot be scheduled for retry'
      USING ERRCODE = '23514';
  END IF;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = v_attempt.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout recovery state does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_recovery.status <> 'leased'
     OR v_recovery.lease_token IS DISTINCT FROM target_recovery_lease_token
     OR v_recovery.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Checkout recovery lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM private.set_payment_audit_context(
    'retry_sponsorship_checkout_recovery_v2',
    v_recovery.provider,
    v_recovery.provider_account_scope,
    target_error_code,
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  UPDATE public.sponsorship_checkout_recovery_states recovery
  SET
    status = CASE
      WHEN recovery.attempt_count >= recovery.max_attempts
        THEN 'manual_review'
      ELSE 'available'
    END,
    next_reconciliation_at = CASE
      WHEN recovery.attempt_count >= recovery.max_attempts
        THEN recovery.next_reconciliation_at
      ELSE clock_timestamp() + target_retry_delay
    END,
    lease_token = NULL,
    lease_expires_at = NULL,
    leased_by = NULL,
    last_error_code = target_error_code
  WHERE recovery.payment_attempt_id = v_recovery.payment_attempt_id
  RETURNING * INTO v_recovery;

  RETURN QUERY SELECT
    v_recovery.payment_attempt_id,
    v_recovery.status,
    v_recovery.attempt_count,
    v_recovery.max_attempts,
    v_recovery.next_reconciliation_at;
END;
$$;

/*
 * Manual review must be discoverable without granting broad table access or
 * exposing provider identifiers, encrypted material, receipts, or sponsor PII.
 */

CREATE OR REPLACE FUNCTION public.list_sponsorship_checkout_manual_reviews_v2(
  target_after_updated_at timestamptz DEFAULT NULL,
  target_after_payment_attempt_id uuid DEFAULT NULL,
  target_limit integer DEFAULT 50,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  checkout_operation_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  attempt_status public.sponsorship_payment_attempt_status,
  recovery_stage text,
  recovery_attempt_count smallint,
  recovery_max_attempts smallint,
  provider_object_attached boolean,
  active_reservation_retained boolean,
  provider_request_expires_at timestamptz,
  last_error_code text,
  manual_review_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_limit IS NULL
     OR target_limit NOT BETWEEN 1 AND 100
     OR (
       (target_after_updated_at IS NULL)
       <> (target_after_payment_attempt_id IS NULL)
     ) THEN
    RAISE EXCEPTION 'Checkout manual review list parameters are invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    recovery.checkout_operation_id,
    attempt.id,
    attempt.sponsorship_intent_id,
    attempt.provider,
    attempt.provider_account_scope,
    attempt.status,
    CASE
      WHEN attempt.status = 'created' THEN 'create_or_attach'
      ELSE 'reconcile_pending'
    END,
    recovery.attempt_count,
    recovery.max_attempts,
    attempt.provider_object_id IS NOT NULL,
    EXISTS (
      SELECT 1
      FROM public.sponsorship_checkout_reservations reservation
      WHERE reservation.payment_attempt_id = attempt.id
        AND reservation.status = 'active'
    ),
    recovery.provider_request_expires_at,
    recovery.last_error_code,
    recovery.updated_at
  FROM public.sponsorship_checkout_recovery_states recovery
  JOIN public.sponsorship_payment_attempts attempt
    ON attempt.id = recovery.payment_attempt_id
  WHERE recovery.status = 'manual_review'
    AND attempt.status IN ('created', 'pending')
    AND (
      target_after_updated_at IS NULL
      OR (
        recovery.updated_at,
        recovery.payment_attempt_id
      ) > (
        target_after_updated_at,
        target_after_payment_attempt_id
      )
    )
  ORDER BY recovery.updated_at, recovery.payment_attempt_id
  LIMIT target_limit;
END;
$$;

/*
 * Provider success found by reconciliation never enters the terminal release
 * branch below. The worker ingests the authenticated response through
 * ingest_verified_payment_gateway_event with provider_api_response evidence.
 * The existing gateway event worker then applies the one canonical success.
 * Until that succeeds, recovery and its reservation remain open or move to
 * manual review. The terminal attempt update closes recovery automatically.
 */

CREATE OR REPLACE FUNCTION public.finalize_sponsorship_checkout_recovery_v2(
  target_payment_attempt_id uuid,
  target_recovery_lease_token uuid,
  target_resolution text,
  target_provider_request_schema_version smallint,
  target_provider_request_fingerprint bytea,
  target_provider_request_expires_at timestamptz,
  target_provider_object_type text DEFAULT NULL,
  target_provider_object_id text DEFAULT NULL,
  target_provider_terminal_status text DEFAULT NULL,
  target_provider_reconciled_at timestamptz DEFAULT NULL,
  target_reconciliation_evidence_sha256 bytea DEFAULT NULL,
  target_reconciliation_evidence_ciphertext bytea DEFAULT NULL,
  target_reconciliation_evidence_encryption_key_version smallint DEFAULT NULL,
  target_release_reason text DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  payment_attempt_id uuid,
  attempt_status public.sponsorship_payment_attempt_status,
  intent_status public.sponsorship_intent_status,
  recovery_status text,
  resolution text,
  provider_object_attached boolean,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_lease_token_digest bytea;
  v_finalization_fingerprint bytea;
  v_next_attempt_status public.sponsorship_payment_attempt_status;
  v_next_intent_status public.sponsorship_intent_status;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_recovery_lease_token IS NULL
     OR target_resolution IS NULL
     OR target_resolution NOT IN (
       'provider_attached',
       'provider_terminal',
       'attempt_terminal'
     )
     OR target_provider_request_schema_version IS DISTINCT FROM 1
     OR octet_length(target_provider_request_fingerprint) IS DISTINCT FROM 32
     OR target_provider_request_expires_at IS NULL
     OR (
       target_resolution = 'provider_terminal'
       AND (
         target_reconciliation_evidence_ciphertext IS NULL
         OR octet_length(target_reconciliation_evidence_ciphertext)
           NOT BETWEEN 32 AND 1048576
         OR target_reconciliation_evidence_encryption_key_version IS NULL
         OR target_reconciliation_evidence_encryption_key_version
           NOT BETWEEN 1 AND 32767
       )
     )
     OR (
       target_resolution <> 'provider_terminal'
       AND (
         target_reconciliation_evidence_ciphertext IS NOT NULL
         OR target_reconciliation_evidence_encryption_key_version IS NOT NULL
       )
     ) THEN
    RAISE EXCEPTION 'Checkout recovery finalization scope is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_lease_token_digest := extensions.digest(
    pg_catalog.convert_to(target_recovery_lease_token::text, 'UTF8'),
    'sha256'
  );
  v_finalization_fingerprint := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'payment_attempt_id', target_payment_attempt_id,
        'resolution', target_resolution,
        'provider_request_schema_version',
          target_provider_request_schema_version,
        'provider_request_fingerprint',
          pg_catalog.encode(target_provider_request_fingerprint, 'hex'),
        'provider_request_expires_at', target_provider_request_expires_at,
        'provider_object_type', target_provider_object_type,
        'provider_object_id', target_provider_object_id,
        'provider_terminal_status', target_provider_terminal_status,
        'provider_reconciled_at', target_provider_reconciled_at,
        'reconciliation_evidence_sha256', CASE
          WHEN target_reconciliation_evidence_sha256 IS NULL THEN NULL
          ELSE pg_catalog.encode(
            target_reconciliation_evidence_sha256,
            'hex'
          )
        END,
        'reconciliation_evidence_ciphertext_present',
          target_reconciliation_evidence_ciphertext IS NOT NULL,
        'reconciliation_evidence_encryption_key_version',
          target_reconciliation_evidence_encryption_key_version,
        'release_reason', target_release_reason
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = target_payment_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment attempt does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = v_attempt.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout recovery state does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT intent.*
  INTO STRICT v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id
  FOR UPDATE;

  IF v_recovery.provider_request_schema_version IS DISTINCT FROM
       target_provider_request_schema_version
     OR v_recovery.provider_request_fingerprint IS DISTINCT FROM
       target_provider_request_fingerprint
     OR v_recovery.provider_request_expires_at IS DISTINCT FROM
       target_provider_request_expires_at THEN
    RAISE EXCEPTION 'Checkout recovery finalization changed immutable provider request evidence'
      USING ERRCODE = '23505';
  END IF;

  IF v_recovery.status = 'closed'
     AND v_recovery.final_outcome = 'attempt_terminal'
     AND target_resolution = 'attempt_terminal' THEN
    IF target_provider_object_type IS NOT NULL
       OR target_provider_object_id IS NOT NULL
       OR target_provider_terminal_status IS NOT NULL
       OR target_provider_reconciled_at IS NOT NULL
       OR target_reconciliation_evidence_sha256 IS NOT NULL
       OR target_reconciliation_evidence_ciphertext IS NOT NULL
       OR target_reconciliation_evidence_encryption_key_version IS NOT NULL
       OR target_release_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Attempt terminal replay supplied inconsistent provider evidence'
        USING ERRCODE = '23505';
    END IF;

    IF NOT (
         (v_attempt.status = 'succeeded' AND v_intent.status = 'succeeded')
         OR (
           v_attempt.status IN ('failed', 'cancelled', 'expired')
           AND v_intent.status = 'failed'
         )
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_reservations reservation
         WHERE reservation.payment_attempt_id = v_attempt.id
           AND reservation.status = 'active'
       ) THEN
      RAISE EXCEPTION 'Automatic attempt terminal recovery is not yet fully settled'
        USING ERRCODE = '23514';
    END IF;

    RETURN QUERY SELECT
      v_attempt.id,
      v_attempt.status,
      v_intent.status,
      v_recovery.status,
      target_resolution,
      v_attempt.provider_object_id IS NOT NULL,
      true;
    RETURN;
  END IF;

  IF v_recovery.last_finalized_lease_token_digest IS NOT DISTINCT FROM
       v_lease_token_digest
     AND v_recovery.last_finalization_fingerprint IS NOT DISTINCT FROM
       v_finalization_fingerprint THEN
    RETURN QUERY SELECT
      v_attempt.id,
      v_attempt.status,
      v_intent.status,
      v_recovery.status,
      target_resolution,
      v_attempt.provider_object_id IS NOT NULL,
      true;
    RETURN;
  END IF;

  IF v_recovery.status = 'closed' THEN
    RAISE EXCEPTION 'Closed checkout recovery evidence conflicts with this finalization'
      USING ERRCODE = '23505';
  END IF;

  IF v_recovery.status <> 'leased'
     OR v_recovery.lease_token IS DISTINCT FROM target_recovery_lease_token
     OR v_recovery.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Checkout recovery lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  IF target_resolution = 'provider_attached' THEN
    IF target_provider_object_type IS NULL
       OR target_provider_object_id IS NULL
       OR target_provider_terminal_status IS NOT NULL
       OR target_provider_reconciled_at IS NOT NULL
       OR target_reconciliation_evidence_sha256 IS NOT NULL
       OR target_reconciliation_evidence_ciphertext IS NOT NULL
       OR target_reconciliation_evidence_encryption_key_version IS NOT NULL
       OR target_release_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Provider attachment finalization evidence is inconsistent'
        USING ERRCODE = '22023';
    END IF;

    PERFORM public.attach_sponsorship_payment_provider_object_v2(
      target_payment_attempt_id,
      target_provider_object_type,
      target_provider_object_id,
      target_provider_request_schema_version,
      target_provider_request_fingerprint,
      target_provider_request_expires_at,
      target_recovery_lease_token,
      context_request_id,
      context_trace_id,
      NULL,
      NULL
    );

    SELECT attempt.*
    INTO STRICT v_attempt
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.id = target_payment_attempt_id;

    SELECT intent.*
    INTO STRICT v_intent
    FROM public.sponsorship_intents intent
    WHERE intent.id = v_attempt.sponsorship_intent_id;

    PERFORM private.set_payment_audit_context(
      'finalize_sponsorship_checkout_recovery_v2',
      v_attempt.provider,
      v_attempt.provider_account_scope,
      'provider_attached',
      NULL,
      context_request_id,
      context_trace_id,
      NULL,
      NULL
    );

    UPDATE public.sponsorship_checkout_recovery_states recovery
    SET
      status = CASE
        WHEN recovery.attempt_count >= recovery.max_attempts
          THEN 'manual_review'
        ELSE 'available'
      END,
      next_reconciliation_at = recovery.provider_request_expires_at,
      lease_token = NULL,
      lease_expires_at = NULL,
      leased_by = NULL,
      last_error_code = CASE
        WHEN recovery.attempt_count >= recovery.max_attempts
          THEN 'recovery_attempts_exhausted_after_attachment'
        ELSE NULL
      END,
      last_finalized_lease_token_digest = v_lease_token_digest,
      last_finalization_fingerprint = v_finalization_fingerprint
    WHERE recovery.payment_attempt_id = target_payment_attempt_id
    RETURNING * INTO v_recovery;
  ELSIF target_resolution = 'provider_terminal' THEN
    IF target_provider_object_type IS NOT NULL
       OR target_provider_object_id IS NOT NULL
       OR target_provider_terminal_status IS NULL
       OR target_provider_terminal_status NOT IN (
         'failed',
         'cancelled',
         'voided',
         'expired'
       )
       OR target_provider_reconciled_at IS NULL
       OR target_provider_reconciled_at <
         v_recovery.created_at - interval '1 minute'
       OR target_provider_reconciled_at >
         clock_timestamp() + interval '1 minute'
       OR octet_length(target_reconciliation_evidence_sha256)
         IS DISTINCT FROM 32
       OR target_reconciliation_evidence_ciphertext IS NULL
       OR octet_length(target_reconciliation_evidence_ciphertext)
         NOT BETWEEN 32 AND 1048576
       OR target_reconciliation_evidence_encryption_key_version IS NULL
       OR target_reconciliation_evidence_encryption_key_version
         NOT BETWEEN 1 AND 32767
       OR target_release_reason IS NULL
       OR target_release_reason IS DISTINCT FROM btrim(target_release_reason)
       OR length(target_release_reason) NOT BETWEEN 1 AND 400 THEN
      RAISE EXCEPTION 'Provider terminal finalization requires explicit bounded evidence'
        USING ERRCODE = '22023';
    END IF;

    IF v_attempt.status NOT IN ('created', 'pending')
       OR NOT (
         (
           v_attempt.status = 'created'
           AND (
             (v_attempt.attempt_number = 1 AND v_intent.status = 'committed')
             OR (v_attempt.attempt_number > 1 AND v_intent.status = 'failed')
           )
         )
         OR (
           v_attempt.status = 'pending'
           AND v_intent.status = 'processing'
         )
       )
       OR (
         v_attempt.status = 'created'
         AND (
           v_attempt.provider_object_id IS NOT NULL
           OR v_recovery.provider_attached_at IS NOT NULL
         )
       )
       OR (
         v_attempt.status = 'pending'
         AND (
           v_attempt.provider_object_id IS NULL
           OR v_recovery.provider_attached_at IS NULL
         )
       )
       OR (
         v_attempt.status = 'created'
         AND target_provider_terminal_status = 'failed'
       ) THEN
      RAISE EXCEPTION 'Provider terminal evidence does not match an active checkout state'
        USING ERRCODE = '23514';
    END IF;

    v_next_attempt_status := CASE
      WHEN target_provider_terminal_status = 'failed'
        THEN 'failed'::public.sponsorship_payment_attempt_status
      WHEN target_provider_terminal_status = 'expired'
        THEN 'expired'::public.sponsorship_payment_attempt_status
      ELSE 'cancelled'::public.sponsorship_payment_attempt_status
    END;
    v_next_intent_status := 'failed'::public.sponsorship_intent_status;

    PERFORM private.set_payment_audit_context(
      'finalize_sponsorship_checkout_recovery_v2',
      v_attempt.provider,
      v_attempt.provider_account_scope,
      target_provider_terminal_status,
      NULL,
      context_request_id,
      context_trace_id,
      NULL,
      NULL
    );

    UPDATE public.sponsorship_checkout_recovery_states recovery
    SET
      status = 'closed',
      lease_token = NULL,
      lease_expires_at = NULL,
      leased_by = NULL,
      finalized_at = clock_timestamp(),
      final_outcome = 'provider_terminal',
      provider_terminal_status = target_provider_terminal_status,
      provider_reconciled_at = target_provider_reconciled_at,
      reconciliation_evidence_sha256 =
        target_reconciliation_evidence_sha256,
      reconciliation_evidence_ciphertext =
        target_reconciliation_evidence_ciphertext,
      reconciliation_evidence_encryption_key_version =
        target_reconciliation_evidence_encryption_key_version,
      reconciliation_evidence_ciphertext_sha256 = extensions.digest(
        target_reconciliation_evidence_ciphertext,
        'sha256'
      ),
      last_error_code = NULL,
      last_finalized_lease_token_digest = v_lease_token_digest,
      last_finalization_fingerprint = v_finalization_fingerprint
    WHERE recovery.payment_attempt_id = v_attempt.id
    RETURNING * INTO v_recovery;

    UPDATE public.sponsorship_payment_attempts attempt
    SET
      status = v_next_attempt_status,
      failure_code = CASE
        WHEN v_next_attempt_status = 'failed'
          THEN 'checkout_recovery_provider_failed'
        ELSE NULL
      END
    WHERE attempt.id = v_attempt.id
    RETURNING * INTO v_attempt;

    UPDATE public.sponsorship_intents intent
    SET status = v_next_intent_status
    WHERE intent.id = v_intent.id
    RETURNING * INTO v_intent;

    IF EXISTS (
      SELECT 1
      FROM public.sponsorship_checkout_reservations reservation
      WHERE reservation.payment_attempt_id = v_attempt.id
        AND reservation.status = 'active'
    ) THEN
      PERFORM public.release_sponsorship_checkout_reservation(
        v_attempt.id,
        target_provider_terminal_status,
        target_provider_reconciled_at,
        target_reconciliation_evidence_sha256,
        target_release_reason,
        context_request_id,
        context_trace_id
      );
    END IF;

  ELSE
    IF target_provider_object_type IS NOT NULL
       OR target_provider_object_id IS NOT NULL
       OR target_provider_terminal_status IS NOT NULL
       OR target_provider_reconciled_at IS NOT NULL
       OR target_reconciliation_evidence_sha256 IS NOT NULL
       OR target_reconciliation_evidence_ciphertext IS NOT NULL
       OR target_reconciliation_evidence_encryption_key_version IS NOT NULL
       OR target_release_reason IS NOT NULL
       OR v_attempt.status NOT IN (
         'succeeded',
         'failed',
         'cancelled',
         'expired'
       )
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_reservations reservation
         WHERE reservation.payment_attempt_id = v_attempt.id
           AND reservation.status = 'active'
       ) THEN
      RAISE EXCEPTION 'Attempt terminal finalization requires an already settled payment chain'
        USING ERRCODE = '23514';
    END IF;

    PERFORM private.set_payment_audit_context(
      'finalize_sponsorship_checkout_recovery_v2',
      v_attempt.provider,
      v_attempt.provider_account_scope,
      'attempt_terminal',
      NULL,
      context_request_id,
      context_trace_id,
      NULL,
      NULL
    );

    UPDATE public.sponsorship_checkout_recovery_states recovery
    SET
      status = 'closed',
      lease_token = NULL,
      lease_expires_at = NULL,
      leased_by = NULL,
      finalized_at = clock_timestamp(),
      final_outcome = 'attempt_terminal',
      provider_terminal_status = NULL,
      provider_reconciled_at = NULL,
      reconciliation_evidence_sha256 = NULL,
      reconciliation_evidence_ciphertext = NULL,
      reconciliation_evidence_encryption_key_version = NULL,
      reconciliation_evidence_ciphertext_sha256 = NULL,
      last_error_code = NULL,
      last_finalized_lease_token_digest = v_lease_token_digest,
      last_finalization_fingerprint = v_finalization_fingerprint
    WHERE recovery.payment_attempt_id = v_attempt.id
    RETURNING * INTO v_recovery;
  END IF;

  RETURN QUERY SELECT
    v_attempt.id,
    v_attempt.status,
    v_intent.status,
    v_recovery.status,
    target_resolution,
    v_attempt.provider_object_id IS NOT NULL,
    false;
END;
$$;

/*
 * Receipt expiry only ends browser status lookup. It does not mutate the
 * payment attempt, close recovery, or release a beneficiary reservation.
 */

CREATE OR REPLACE FUNCTION public.read_sponsorship_checkout_status_v2(
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
    attempt.status::text,
    attempt.status IN ('succeeded', 'failed', 'cancelled', 'expired'),
    attempt.updated_at
  FROM public.sponsorship_payment_attempts attempt
  JOIN public.sponsorship_checkout_recovery_states recovery
    ON recovery.payment_attempt_id = attempt.id
  JOIN public.sponsorship_checkout_operations operation
    ON operation.operation_id = recovery.checkout_operation_id
  WHERE attempt.checkout_receipt_digest = target_checkout_receipt_digest
    AND attempt.checkout_receipt_expires_at > statement_timestamp()
    AND operation.checkout_boundary_version = 2;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_sponsorship_checkout_rpc_release_gate_v2()
RETURNS TABLE (
  checkout_schema_version smallint,
  legacy_rpc_enabled boolean,
  v2_rpc_enabled boolean,
  caller_cutover_required boolean,
  later_legacy_drain_migration_required boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 2::smallint, true, true, true, true;
$$;

REVOKE ALL ON FUNCTION public.prepare_sponsorship_checkout_intent(
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.prepare_sponsorship_checkout_intent_v2(
  uuid,
  bytea,
  public.sponsorship_method,
  text,
  text,
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.prepare_sponsorship_checkout_operation_v2(
  uuid,
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text,
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.issue_sponsorship_payment_quote_v2(
  uuid,
  uuid,
  text,
  interval,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.begin_sponsorship_payment_v2(
  uuid,
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  smallint,
  jsonb,
  bytea,
  timestamptz,
  bytea,
  smallint,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.attach_sponsorship_payment_provider_object_v2(
  uuid,
  text,
  text,
  smallint,
  bytea,
  timestamptz,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.recover_sponsorship_checkout_v2(
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.resume_sponsorship_checkout_operation_v2(
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_sponsorship_checkout_recoveries_v2(
  text,
  integer,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.retry_sponsorship_checkout_recovery_v2(
  uuid,
  uuid,
  interval,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_sponsorship_checkout_manual_reviews_v2(
  timestamptz,
  uuid,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.finalize_sponsorship_checkout_recovery_v2(
  uuid,
  uuid,
  text,
  smallint,
  bytea,
  timestamptz,
  text,
  text,
  text,
  timestamptz,
  bytea,
  bytea,
  smallint,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.read_sponsorship_checkout_status_v2(bytea)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.read_sponsorship_checkout_rpc_release_gate_v2()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prepare_sponsorship_checkout_intent(
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) TO service_role;

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

GRANT EXECUTE ON FUNCTION public.prepare_sponsorship_checkout_intent_v2(
  uuid,
  bytea,
  public.sponsorship_method,
  text,
  text,
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.prepare_sponsorship_checkout_operation_v2(
  uuid,
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text,
  uuid,
  uuid,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.issue_sponsorship_payment_quote_v2(
  uuid,
  uuid,
  text,
  interval,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.begin_sponsorship_payment_v2(
  uuid,
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  smallint,
  jsonb,
  bytea,
  timestamptz,
  bytea,
  smallint,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.attach_sponsorship_payment_provider_object_v2(
  uuid,
  text,
  text,
  smallint,
  bytea,
  timestamptz,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.recover_sponsorship_checkout_v2(
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.resume_sponsorship_checkout_operation_v2(
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.claim_sponsorship_checkout_recoveries_v2(
  text,
  integer,
  integer,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.retry_sponsorship_checkout_recovery_v2(
  uuid,
  uuid,
  interval,
  text,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.list_sponsorship_checkout_manual_reviews_v2(
  timestamptz,
  uuid,
  integer,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.finalize_sponsorship_checkout_recovery_v2(
  uuid,
  uuid,
  text,
  smallint,
  bytea,
  timestamptz,
  text,
  text,
  text,
  timestamptz,
  bytea,
  bytea,
  smallint,
  text,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.read_sponsorship_checkout_status_v2(bytea)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.read_sponsorship_checkout_rpc_release_gate_v2()
  TO service_role;

COMMENT ON FUNCTION public.prepare_sponsorship_checkout_intent(
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) IS
  'Temporary guarded v1 compatibility RPC. It cannot create a v2 checkout intent and remains available only for the two phase caller cutover.';

COMMENT ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) IS
  'Temporary guarded v1 compatibility RPC. It rejects every intent registered to a v2 checkout operation.';

COMMENT ON FUNCTION public.begin_sponsorship_payment(
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
) IS
  'Temporary guarded v1 compatibility RPC. It rejects every intent registered to a v2 checkout operation.';

COMMENT ON FUNCTION public.attach_sponsorship_payment_provider_object(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text
) IS
  'Temporary guarded v1 compatibility RPC. It rejects every payment attempt with v2 recovery state.';

COMMENT ON TABLE public.sponsorship_checkout_operations IS
  'Append only v2 preprovider checkout operation lineage keyed by one opaque receipt digest and one exact provider idempotency scope. Failed intents may continue through one serial successor operation while successful or unsettled chains are closed.';

COMMENT ON TABLE public.sponsorship_checkout_recovery_states IS
  'Lease fenced provider request creation and reconciliation state. Local elapsed time only schedules provider inspection and can never terminalize payment or release a reservation.';

COMMENT ON COLUMN public.sponsorship_checkout_recovery_states.provider_request_ciphertext IS
  'Application encrypted canonical provider request template. Only service role resume and claim routines return these bytes.';

COMMENT ON COLUMN public.sponsorship_checkout_recovery_states.provider_request_template_claims IS
  'PII safe claims for canonical JSON version 1. The encrypted template contains one typed root payment attempt placeholder. The strict payment service materializer must duplicate the returned database attempt ID into all provider fields.';

COMMENT ON COLUMN public.sponsorship_checkout_recovery_states.reconciliation_evidence_ciphertext IS
  'Application encrypted bounded provider reconciliation response retained for forensic reconstruction. Canonical plaintext digest and key version define exact replay, so randomized ciphertext never changes identity.';

COMMENT ON FUNCTION public.prepare_sponsorship_checkout_intent_v2(
  uuid,
  bytea,
  public.sponsorship_method,
  text,
  text,
  text,
  public.sponsorship_intent_source,
  text,
  bytea,
  uuid,
  bytea,
  smallint,
  smallint,
  public.sponsorship_subject_kind,
  uuid,
  public.project_type,
  public.sponsorship_payment_mode,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
  timestamptz,
  text,
  text,
  text
) IS
  'Prepares one immutable sponsorship intent and its opaque checkout operation atomically. Exact replay retains the original financial quote timestamp and requires its advocate tenant to remain active.';

COMMENT ON FUNCTION public.prepare_sponsorship_checkout_operation_v2(
  uuid,
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text,
  uuid,
  uuid,
  text,
  text
) IS
  'Appends or exactly replays one successor operation for an unbegun predecessor or a fully terminal unsuccessful failed intent. Every advocate invocation requires current tenant authorization.';

COMMENT ON FUNCTION public.issue_sponsorship_payment_quote_v2(
  uuid,
  uuid,
  text,
  interval,
  text,
  text
) IS
  'Issues one immutable operation scoped v2 quote. Same intent provider retry remains bounded by the original five minute currency basis.';

COMMENT ON FUNCTION public.begin_sponsorship_payment_v2(
  uuid,
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  smallint,
  jsonb,
  bytea,
  timestamptz,
  bytea,
  smallint,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) IS
  'Begins one payment attempt while atomically sealing canonical provider request fingerprint, expiry, encrypted envelope, idempotency scope, quote, and opaque receipt evidence.';

COMMENT ON FUNCTION public.attach_sponsorship_payment_provider_object_v2(
  uuid,
  text,
  text,
  smallint,
  bytea,
  timestamptz,
  uuid,
  text,
  text,
  text,
  text
) IS
  'Attaches one exact provider checkout object and supports identical replay after terminal completion without returning the provider object identifier.';

COMMENT ON FUNCTION public.recover_sponsorship_checkout_v2(
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text
) IS
  'Recovers intent, quote, attempt, and safe recovery state for an exact opaque receipt and operation scope. It returns no sponsor PII, raw receipt, provider object identifier, or ciphertext.';

COMMENT ON FUNCTION public.resume_sponsorship_checkout_operation_v2(
  bytea,
  uuid,
  public.sponsorship_method,
  text,
  text,
  text,
  text
) IS
  'Acquires the first immediate fenced recovery lease and returns the encrypted template to the payment service only while its advocate tenant remains active. It never returns an attached provider object identifier.';

COMMENT ON FUNCTION public.claim_sponsorship_checkout_recoveries_v2(
  text,
  integer,
  integer,
  text,
  text
) IS
  'Claims bounded due or stale checkout work with skip locked leases. Exhausted work becomes visible manual review and retains any active reservation.';

COMMENT ON FUNCTION public.retry_sponsorship_checkout_recovery_v2(
  uuid,
  uuid,
  interval,
  text,
  text,
  text
) IS
  'Schedules a fenced recovery retry or moves the exact exhausted lease to manual review without changing payment or reservation state.';

COMMENT ON FUNCTION public.list_sponsorship_checkout_manual_reviews_v2(
  timestamptz,
  uuid,
  integer,
  text,
  text
) IS
  'Lists a bounded cursor paginated service queue for exhausted checkout recovery without exposing sponsor PII, receipts, provider identifiers, leases, or encrypted evidence.';

COMMENT ON FUNCTION public.finalize_sponsorship_checkout_recovery_v2(
  uuid,
  uuid,
  text,
  smallint,
  bytea,
  timestamptz,
  text,
  text,
  text,
  timestamptz,
  bytea,
  bytea,
  smallint,
  text,
  text,
  text
) IS
  'Finalizes one exact recovery lease. Only explicit provider failed, cancelled, voided, or expired evidence may terminalize an active checkout and release its reservation.';

COMMENT ON FUNCTION public.read_sponsorship_checkout_status_v2(bytea) IS
  'Reads a live opaque checkout receipt without treating receipt expiry as payment terminal evidence.';

COMMENT ON FUNCTION public.read_sponsorship_checkout_rpc_release_gate_v2() IS
  'Deployment capability gate. V1 and v2 remain concurrently enabled until a later caller drain migration explicitly revokes v1.';

COMMIT;

BEGIN;

/*
 * Browser tokens are resumable hints. Only their SHA256 digest reaches the
 * database, and only an exact active advocate hostname can create a qualified
 * exposure. The caller has already excluded bots, previews, prefetches, and
 * other traffic that is not eligible for conversion analytics.
 */

CREATE OR REPLACE FUNCTION public.record_qualified_advocate_exposure(
  target_event_key uuid,
  target_visitor_token_digest bytea,
  target_advocate_hostname text,
  target_consent_state public.visitor_consent_state,
  target_page_path text DEFAULT '/',
  target_referrer_host text DEFAULT NULL,
  target_auth_user_id uuid DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  resolved_browser_visitor_id uuid,
  resolved_advocate_exposure_id uuid,
  resolved_advocate_id uuid,
  resolved_advocate_domain_id uuid,
  resolved_retention_expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_policy_version text;
  v_advocate_id uuid;
  v_domain_id uuid;
  v_visitor public.browser_visitors%ROWTYPE;
  v_exposure public.advocate_exposures%ROWTYPE;
  v_exposure_context jsonb := jsonb_build_object(
    'qualification_source',
    'application_filtered'
  );
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_event_key IS NULL
     OR octet_length(target_visitor_token_digest) IS DISTINCT FROM 32
     OR target_advocate_hostname IS NULL
     OR target_advocate_hostname IS DISTINCT FROM lower(btrim(target_advocate_hostname))
     OR position('/' IN target_advocate_hostname) > 0
     OR position(':' IN target_advocate_hostname) > 0
     OR length(target_advocate_hostname) NOT BETWEEN 1 AND 253 THEN
    RAISE EXCEPTION 'Qualified advocate exposure identity is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_consent_state IS NULL
     OR target_consent_state NOT IN ('granted', 'not_required') THEN
    RAISE EXCEPTION 'Qualified advocate exposure requires affirmative consent state'
      USING ERRCODE = '23514';
  END IF;

  IF target_page_path IS NULL
     OR target_page_path NOT LIKE '/%'
     OR position('?' IN target_page_path) > 0
     OR position('#' IN target_page_path) > 0
     OR length(target_page_path) > 500 THEN
    RAISE EXCEPTION 'Qualified advocate exposure page path is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_referrer_host IS NOT NULL AND (
    target_referrer_host IS DISTINCT FROM lower(btrim(target_referrer_host))
    OR position('/' IN target_referrer_host) > 0
    OR position(':' IN target_referrer_host) > 0
    OR length(target_referrer_host) NOT BETWEEN 1 AND 253
  ) THEN
    RAISE EXCEPTION 'Qualified advocate exposure referrer host is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT domain.advocate_id, domain.id
  INTO v_advocate_id, v_domain_id
  FROM public.advocate_domains domain
  JOIN public.advocates advocate ON advocate.id = domain.advocate_id
  WHERE domain.hostname = target_advocate_hostname
    AND domain.status = 'active'
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status = 'active'
  FOR SHARE OF domain, advocate;

  IF v_domain_id IS NULL THEN
    RAISE EXCEPTION 'Qualified advocate exposure requires an exact active advocate domain'
      USING ERRCODE = '23514';
  END IF;

  IF target_auth_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM auth.users auth_user
    JOIN public.users application_user ON application_user.id = auth_user.id
    WHERE auth_user.id = target_auth_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Qualified advocate exposure authenticated user is unavailable'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_effective_user_id => target_auth_user_id,
    context_system_actor => 'sponsorship_checkout_service',
    context_tool => 'record_qualified_advocate_exposure',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Record a server-qualified advocate portal exposure',
    context_metadata => jsonb_build_object(
      'operation', 'record_exposure',
      'resource_kind', 'advocate_exposure',
      'resource_id', target_event_key::text,
      'domain_hostname', target_advocate_hostname,
      'outcome', 'qualified'
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.encode(target_visitor_token_digest, 'hex'),
      716133007
    )
  );

  SELECT visitor.*
  INTO v_visitor
  FROM public.browser_visitors visitor
  WHERE visitor.token_digest = target_visitor_token_digest
  FOR UPDATE;

  IF FOUND THEN
    IF v_visitor.revoked_at IS NOT NULL
       OR v_visitor.retention_expires_at <= v_now THEN
      RAISE EXCEPTION 'Browser visitor token is revoked or outside retention'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.browser_visitors
    SET
      consent_state = target_consent_state,
      last_seen_at = v_now
    WHERE id = v_visitor.id
    RETURNING * INTO v_visitor;
  ELSE
    SELECT policy.version
    INTO v_policy_version
    FROM public.sponsorship_attribution_policies policy
    WHERE policy.is_active
      AND policy.effective_at <= v_now
    ORDER BY policy.effective_at DESC, policy.version DESC
    LIMIT 1;

    IF v_policy_version IS NULL THEN
      RAISE EXCEPTION 'No active attribution policy is available for visitor tracking'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.browser_visitors (
      token_digest,
      policy_version,
      consent_state
    )
    VALUES (
      target_visitor_token_digest,
      v_policy_version,
      target_consent_state
    )
    RETURNING * INTO v_visitor;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_event_key::text, 716133007)
  );

  SELECT exposure.*
  INTO v_exposure
  FROM public.advocate_exposures exposure
  WHERE exposure.event_key = target_event_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_exposure.advocate_id IS DISTINCT FROM v_advocate_id
       OR v_exposure.advocate_domain_id IS DISTINCT FROM v_domain_id
       OR v_exposure.browser_visitor_id IS DISTINCT FROM v_visitor.id
       OR v_exposure.auth_user_id IS DISTINCT FROM target_auth_user_id
       OR v_exposure.is_qualified IS DISTINCT FROM true
       OR v_exposure.exclusion_reason IS NOT NULL
       OR v_exposure.consent_state IS DISTINCT FROM target_consent_state
       OR v_exposure.page_path IS DISTINCT FROM target_page_path
       OR v_exposure.referrer_host IS DISTINCT FROM target_referrer_host
       OR v_exposure.context IS DISTINCT FROM v_exposure_context THEN
      RAISE EXCEPTION 'Advocate exposure event key was replayed with different terms'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_visitor.id,
      v_exposure.id,
      v_advocate_id,
      v_domain_id,
      v_visitor.retention_expires_at,
      true;
    RETURN;
  END IF;

  INSERT INTO public.advocate_exposures (
    event_key,
    advocate_id,
    advocate_domain_id,
    browser_visitor_id,
    auth_user_id,
    is_qualified,
    exclusion_reason,
    consent_state,
    page_path,
    referrer_host,
    context
  )
  VALUES (
    target_event_key,
    v_advocate_id,
    v_domain_id,
    v_visitor.id,
    target_auth_user_id,
    true,
    NULL,
    target_consent_state,
    target_page_path,
    target_referrer_host,
    v_exposure_context
  )
  RETURNING * INTO v_exposure;

  SELECT visitor.*
  INTO STRICT v_visitor
  FROM public.browser_visitors visitor
  WHERE visitor.id = v_visitor.id;

  RETURN QUERY SELECT
    v_visitor.id,
    v_exposure.id,
    v_advocate_id,
    v_domain_id,
    v_visitor.retention_expires_at,
    false;
END;
$$;

COMMENT ON FUNCTION public.record_qualified_advocate_exposure(
  uuid,
  bytea,
  text,
  public.visitor_consent_state,
  text,
  text,
  uuid,
  text,
  text
) IS
  'Upserts one opaque 400 day browser visitor and appends one idempotent, server-qualified exposure for an exact active advocate domain.';

/*
 * The application service supplies canonical HMAC and pricing inputs. This
 * function still validates identity ownership, source lifecycle, beneficiary
 * eligibility, amount arithmetic, currency freshness, and exact idempotent
 * replay before the immutable intent is allowed to leave the transaction.
 *
 * A primary request never supplies or persists its runtime Host header. The
 * conceptual primary source is always creatorshare.com, including local
 * development. Advocate requests resolve only through the exact domain table.
 */

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
DECLARE
  v_now timestamptz := clock_timestamp();
  v_source_host text;
  v_source_advocate_id uuid;
  v_source_domain_id uuid;
  v_browser_visitor_id uuid;
  v_account_identity public.sponsor_identities%ROWTYPE;
  v_email_identity public.sponsor_identities%ROWTYPE;
  v_identifier public.sponsor_identifiers%ROWTYPE;
  v_identity public.sponsor_identities%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_attribution public.sponsorship_attributions%ROWTYPE;
  v_has_account_identity boolean := false;
  v_has_identifier boolean := false;
  v_replayed boolean := false;
  v_intent_metadata jsonb := jsonb_build_object(
    'checkout_boundary_version',
    '2026-07-16-v1'
  );
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_idempotency_key IS NULL
     OR target_idempotency_key IS DISTINCT FROM btrim(target_idempotency_key)
     OR length(target_idempotency_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'Sponsorship intent idempotency key is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF octet_length(target_contact_email_hmac) IS DISTINCT FROM 32
     OR target_contact_email_normalization_version IS DISTINCT FROM 1
     OR target_contact_email_hmac_key_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Sponsorship intent email HMAC is malformed or unsupported'
      USING ERRCODE = '22023';
  END IF;

  IF target_visitor_token_digest IS NOT NULL
     AND octet_length(target_visitor_token_digest) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Sponsorship intent browser visitor hint is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_subject_kind IS NULL
     OR target_payment_mode IS NULL
     OR target_charged_currency IS NULL
     OR target_conversion_rate IS NULL
     OR target_currency_quote_at IS NULL
     OR target_currency_rate_source IS NULL
     OR target_currency_rate_source IS DISTINCT FROM btrim(target_currency_rate_source)
     OR length(target_currency_rate_source) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Sponsorship intent product terms are incomplete'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (
    (
      target_subject_kind = 'standard'
      AND target_beneficiary_id IS NOT NULL
      AND target_partnership_project IS NULL
    )
    OR (
      target_subject_kind = 'blind'
      AND target_beneficiary_id IS NULL
      AND target_partnership_project IS NULL
    )
    OR (
      target_subject_kind = 'partnership'
      AND target_beneficiary_id IS NULL
      AND target_partnership_project IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'Sponsorship intent subject terms are inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      target_payment_mode = 'one_time'
      AND target_recurrence_interval IS NULL
    )
    OR (
      target_payment_mode = 'recurring'
      AND target_recurrence_interval IN ('month', 'year')
    )
  ) THEN
    RAISE EXCEPTION 'Sponsorship intent recurrence terms are inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF target_base_amount_usd_cents IS NULL
     OR target_base_amount_usd_cents < 500
     OR target_base_amount_usd_cents > 2147483647
     OR target_charged_amount_minor IS NULL
     OR target_charged_amount_minor < 1
     OR target_charged_amount_minor > 2147483647
     OR target_conversion_rate <= 0
     OR target_charged_amount_minor IS DISTINCT FROM
       round(target_base_amount_usd_cents * target_conversion_rate)
     OR (
       target_charged_currency = 'USD'
       AND (
         target_conversion_rate IS DISTINCT FROM 1::numeric
         OR target_charged_amount_minor IS DISTINCT FROM target_base_amount_usd_cents
       )
     ) THEN
    RAISE EXCEPTION 'Sponsorship amount is outside product bounds or fails currency conversion'
      USING ERRCODE = '23514';
  END IF;

  IF target_currency_quote_at > v_now + interval '1 minute'
     OR target_currency_quote_at < v_now - interval '5 minutes' THEN
    RAISE EXCEPTION 'Sponsorship intent currency basis is stale or future dated'
      USING ERRCODE = '22023';
  END IF;

  IF target_source = 'primary_site' THEN
    IF target_advocate_hostname IS NOT NULL THEN
      RAISE EXCEPTION 'Primary site intents use the canonical conceptual host'
        USING ERRCODE = '22023';
    END IF;

    v_source_host := 'creatorshare.com';
  ELSIF target_source = 'advocate_domain' THEN
    IF target_advocate_hostname IS NULL
       OR target_advocate_hostname IS DISTINCT FROM lower(btrim(target_advocate_hostname))
       OR position('/' IN target_advocate_hostname) > 0
       OR position(':' IN target_advocate_hostname) > 0
       OR length(target_advocate_hostname) NOT BETWEEN 1 AND 253 THEN
      RAISE EXCEPTION 'Advocate sponsorship source hostname is malformed'
        USING ERRCODE = '22023';
    END IF;

    SELECT domain.hostname, domain.advocate_id, domain.id
    INTO v_source_host, v_source_advocate_id, v_source_domain_id
    FROM public.advocate_domains domain
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
    WHERE domain.hostname = target_advocate_hostname
      AND domain.status = 'active'
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status = 'active'
    FOR SHARE OF domain, advocate;

    IF v_source_domain_id IS NULL THEN
      RAISE EXCEPTION 'Advocate sponsorship requires an exact active advocate domain'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Sponsorship intent source is unsupported'
      USING ERRCODE = '22023';
  END IF;

  IF target_auth_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM auth.users auth_user
    JOIN public.users application_user ON application_user.id = auth_user.id
    WHERE auth_user.id = target_auth_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Sponsorship intent authenticated user is unavailable'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_idempotency_key, 716133007)
  );

  /*
   * Identity resolution is deliberately serialized. Checkout volume is low,
   * while conflicting account and email histories can otherwise acquire two
   * sponsor identity rows in opposite orders. Existing account claim paths
   * lock account identity before email identity, and this function does too.
   */
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sponsorship_identity_resolution', 716133007)
  );

  IF target_auth_user_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(target_auth_user_id::text, 716133006)
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.encode(target_contact_email_hmac, 'hex'),
      716133006
    )
  );

  IF target_visitor_token_digest IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        pg_catalog.encode(target_visitor_token_digest, 'hex'),
        716133007
      )
    );

    SELECT visitor.id
    INTO v_browser_visitor_id
    FROM public.browser_visitors visitor
    WHERE visitor.token_digest = target_visitor_token_digest
      AND visitor.revoked_at IS NULL
      AND visitor.retention_expires_at > v_now
    FOR UPDATE;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system',
    context_effective_user_id => target_auth_user_id,
    context_system_actor => 'sponsorship_checkout_service',
    context_tool => 'prepare_sponsorship_checkout_intent',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Resolve sponsor identity and prepare immutable checkout intent',
    context_metadata => jsonb_strip_nulls(jsonb_build_object(
      'operation', 'prepare_checkout',
      'resource_kind', 'sponsorship_intent',
      'resource_id', target_idempotency_key,
      'domain_hostname', v_source_host,
      'outcome', 'requested'
    ))
  );

  IF target_auth_user_id IS NOT NULL THEN
    SELECT identity.*
    INTO v_account_identity
    FROM public.sponsor_identities identity
    WHERE identity.auth_user_id = target_auth_user_id
    FOR UPDATE;
    v_has_account_identity := FOUND;

    IF v_has_account_identity AND v_account_identity.status <> 'active' THEN
      RAISE EXCEPTION 'Authenticated sponsor identity is not active'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT identity.*
  INTO v_email_identity
  FROM public.sponsor_identities identity
  WHERE identity.id = (
    SELECT identifier.sponsor_identity_id
    FROM public.sponsor_identifiers identifier
    WHERE identifier.kind = 'email'
      AND identifier.issuer_scope = 'creator_share'
      AND identifier.identifier_digest = target_contact_email_hmac
  )
  FOR UPDATE;

  SELECT identifier.*
  INTO v_identifier
  FROM public.sponsor_identifiers identifier
  WHERE identifier.kind = 'email'
    AND identifier.issuer_scope = 'creator_share'
    AND identifier.identifier_digest = target_contact_email_hmac
  FOR UPDATE;
  v_has_identifier := FOUND;

  IF v_has_identifier THEN
    IF v_identifier.normalization_version IS DISTINCT FROM
         target_contact_email_normalization_version
       OR v_identifier.hmac_key_version IS DISTINCT FROM
         target_contact_email_hmac_key_version THEN
      RAISE EXCEPTION 'Sponsor email HMAC version conflicts with existing evidence'
        USING ERRCODE = '23505';
    END IF;

    IF v_identifier.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Sponsor email identity has been revoked'
        USING ERRCODE = '23514';
    END IF;

    IF v_email_identity.id IS NULL OR v_email_identity.status <> 'active' THEN
      RAISE EXCEPTION 'Sponsor email identity is not active'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF target_auth_user_id IS NOT NULL AND v_has_account_identity THEN
    IF NOT v_has_identifier THEN
      RAISE EXCEPTION 'Changing an account email does not claim another email history'
        USING ERRCODE = '23514';
    END IF;

    IF v_identifier.sponsor_identity_id IS DISTINCT FROM v_account_identity.id THEN
      RAISE EXCEPTION 'Authenticated account and email histories belong to different sponsor identities'
        USING ERRCODE = '23505';
    END IF;

    v_identity := v_account_identity;

    UPDATE public.sponsor_identifiers
    SET
      confidence = 'verified',
      last_seen_at = v_now
    WHERE id = v_identifier.id
    RETURNING * INTO v_identifier;
  ELSIF target_auth_user_id IS NOT NULL THEN
    IF v_has_identifier THEN
      IF v_email_identity.auth_user_id IS NOT NULL
         AND v_email_identity.auth_user_id <> target_auth_user_id THEN
        RAISE EXCEPTION 'Verified sponsor email history already belongs to another account'
          USING ERRCODE = '23505';
      END IF;

      IF v_email_identity.auth_user_id IS NULL THEN
        UPDATE public.sponsor_identities
        SET auth_user_id = target_auth_user_id
        WHERE id = v_email_identity.id
        RETURNING * INTO v_email_identity;
      END IF;

      v_identity := v_email_identity;

      UPDATE public.sponsor_identifiers
      SET
        confidence = 'verified',
        last_seen_at = v_now
      WHERE id = v_identifier.id
      RETURNING * INTO v_identifier;
    ELSE
      INSERT INTO public.sponsor_identities (auth_user_id)
      VALUES (target_auth_user_id)
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
        target_contact_email_hmac,
        target_contact_email_normalization_version,
        target_contact_email_hmac_key_version,
        'verified'
      )
      RETURNING * INTO v_identifier;
    END IF;
  ELSIF v_has_identifier THEN
    v_identity := v_email_identity;

    UPDATE public.sponsor_identifiers
    SET last_seen_at = v_now
    WHERE id = v_identifier.id
    RETURNING * INTO v_identifier;
  ELSE
    INSERT INTO public.sponsor_identities DEFAULT VALUES
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
      target_contact_email_hmac,
      target_contact_email_normalization_version,
      target_contact_email_hmac_key_version,
      'unverified'
    )
    RETURNING * INTO v_identifier;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.idempotency_key = target_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    v_replayed := true;

    IF v_intent.source IS DISTINCT FROM target_source
       OR v_intent.source_host IS DISTINCT FROM v_source_host
       OR v_intent.source_advocate_id IS DISTINCT FROM v_source_advocate_id
       OR v_intent.source_advocate_domain_id IS DISTINCT FROM v_source_domain_id
       OR v_intent.browser_visitor_id IS DISTINCT FROM v_browser_visitor_id
       OR v_intent.auth_user_id IS DISTINCT FROM target_auth_user_id
       OR v_intent.sponsor_identity_id IS DISTINCT FROM v_identity.id
       OR v_intent.contact_email_hmac IS DISTINCT FROM target_contact_email_hmac
       OR v_intent.contact_email_normalization_version IS DISTINCT FROM
         target_contact_email_normalization_version
       OR v_intent.contact_email_hmac_key_version IS DISTINCT FROM
         target_contact_email_hmac_key_version
       OR v_intent.subject_kind IS DISTINCT FROM target_subject_kind
       OR v_intent.beneficiary_id IS DISTINCT FROM target_beneficiary_id
       OR v_intent.partnership_project IS DISTINCT FROM target_partnership_project
       OR v_intent.payment_mode IS DISTINCT FROM target_payment_mode
       OR v_intent.recurrence_interval IS DISTINCT FROM target_recurrence_interval
       OR v_intent.base_amount_usd_cents IS DISTINCT FROM target_base_amount_usd_cents
       OR v_intent.charged_amount_minor IS DISTINCT FROM target_charged_amount_minor
       OR v_intent.charged_currency IS DISTINCT FROM target_charged_currency
       OR v_intent.conversion_rate IS DISTINCT FROM target_conversion_rate
       OR v_intent.currency_quote_at IS DISTINCT FROM target_currency_quote_at
       OR v_intent.currency_rate_source IS DISTINCT FROM target_currency_rate_source
       OR v_intent.metadata IS DISTINCT FROM v_intent_metadata THEN
      RAISE EXCEPTION 'Sponsorship intent idempotency key was replayed with different terms'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.sponsorship_intents (
      idempotency_key,
      source,
      source_host,
      source_advocate_id,
      source_advocate_domain_id,
      browser_visitor_id,
      auth_user_id,
      sponsor_identity_id,
      contact_email_hmac,
      contact_email_normalization_version,
      contact_email_hmac_key_version,
      subject_kind,
      beneficiary_id,
      partnership_project,
      payment_mode,
      recurrence_interval,
      base_amount_usd_cents,
      charged_amount_minor,
      charged_currency,
      conversion_rate,
      currency_quote_at,
      currency_rate_source,
      metadata
    )
    VALUES (
      target_idempotency_key,
      target_source,
      v_source_host,
      v_source_advocate_id,
      v_source_domain_id,
      v_browser_visitor_id,
      target_auth_user_id,
      v_identity.id,
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
      v_intent_metadata
    )
    RETURNING * INTO v_intent;
  END IF;

  PERFORM private.validate_sponsorship_checkout_eligibility(v_intent.id);

  SELECT attribution.*
  INTO v_attribution
  FROM public.sponsorship_attributions attribution
  WHERE attribution.sponsorship_intent_id = v_intent.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsorship intent attribution trigger did not produce a decision'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY SELECT
    v_intent.id,
    v_identity.id,
    v_browser_visitor_id,
    v_intent.source,
    v_intent.source_host,
    v_attribution.kind,
    v_attribution.advocate_id,
    v_attribution.exposure_id,
    v_intent.status,
    v_replayed;
END;
$$;

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
  'Resolves one stable email-backed sponsor identity and prepares one exact, immutable, idempotent sponsorship intent with server-triggered attribution.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.browser_visitors
  FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.sponsor_identities
  FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.sponsor_identifiers
  FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.advocate_exposures
  FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.sponsorship_intents
  FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.sponsorship_attributions
  FROM service_role;

REVOKE ALL ON FUNCTION public.record_qualified_advocate_exposure(
  uuid,
  bytea,
  text,
  public.visitor_consent_state,
  text,
  text,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
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

GRANT EXECUTE ON FUNCTION public.record_qualified_advocate_exposure(
  uuid,
  bytea,
  text,
  public.visitor_consent_state,
  text,
  text,
  uuid,
  text,
  text
) TO service_role;
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

COMMIT;

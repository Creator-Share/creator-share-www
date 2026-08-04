BEGIN;

/*
 * Attribution is decided when the server creates the sponsorship intent.
 * Verified payment success may finalize that decision, but it may not use
 * later browsing activity to rewrite the advocate, exposure, kind, or lag.
 */
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

  IF target_conversion_occurred_at IS NULL
     OR target_conversion_occurred_at < v_intent.created_at THEN
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

  IF v_attribution.policy_version IS DISTINCT FROM v_intent.attribution_policy_version THEN
    RAISE EXCEPTION 'Provisional attribution policy does not match its intent'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.sponsorship_attributions
  SET
    decision_context = v_attribution.decision_context || jsonb_build_object(
      'decision_stage', 'first_verified_success',
      'attribution_locked_at', v_intent.created_at,
      'conversion_occurred_at', target_conversion_occurred_at,
      'provisional_kind', v_attribution.kind::text,
      'provisional_decided_at', v_attribution.decided_at
    ),
    finalized_at = clock_timestamp(),
    conversion_occurred_at = target_conversion_occurred_at
  WHERE sponsorship_intent_id = target_sponsorship_intent_id
  RETURNING * INTO v_attribution;

  RETURN v_attribution;
END;
$$;

REVOKE ALL ON FUNCTION private.finalize_sponsorship_attribution(
  uuid,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

/*
 * Creator Share staff and members of the portal they are viewing are not
 * audience traffic. Their authenticated visits return no row and create no
 * browser visitor or exposure. Guest traffic and users from another portal
 * remain eligible under the existing qualification rules.
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

  IF target_auth_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      WHERE assignment.user_id = target_auth_user_id
        AND assignment.organization_id IS NULL
        AND assignment.advocate_id IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.advocate_memberships membership
      WHERE membership.user_id = target_auth_user_id
        AND membership.advocate_id = v_advocate_id
    )
  ) THEN
    RETURN;
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
  'Upserts one opaque 400 day browser visitor and appends one idempotent, server-qualified exposure for an exact active advocate domain. Authenticated Creator Share staff and same-portal members are silently excluded.';

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

COMMIT;

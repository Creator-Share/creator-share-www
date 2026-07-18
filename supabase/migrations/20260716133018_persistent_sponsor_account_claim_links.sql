BEGIN;

/*
 * The welcome email is also the sponsor's durable account entry point. A
 * pending claim may create the first account. A consumed claim may only sign
 * in to the account which already owns the sponsor identity. Expired or
 * revoked claims never regain account creation authority.
 */
CREATE OR REPLACE FUNCTION public.resolve_sponsor_account_claim_start(
  target_claim_token_digest bytea,
  target_email_hmac bytea,
  target_email_normalization_version smallint DEFAULT 1,
  target_email_hmac_key_version smallint DEFAULT 1,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  claim_start_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_claim public.sponsorship_account_claims%ROWTYPE;
  v_mode text;
BEGIN
  PERFORM private.require_payment_service_role();

  IF octet_length(target_claim_token_digest) IS DISTINCT FROM 32
     OR octet_length(target_email_hmac) IS DISTINCT FROM 32
     OR target_email_normalization_version IS DISTINCT FROM 1
     OR target_email_hmac_key_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Sponsor account claim start proof is malformed or unsupported'
      USING ERRCODE = '22023';
  END IF;

  SELECT claim.*
  INTO v_claim
  FROM public.sponsorship_account_claims claim
  WHERE claim.token_digest = target_claim_token_digest
    AND claim.email_hmac = target_email_hmac
    AND claim.email_normalization_version =
      target_email_normalization_version
    AND claim.email_hmac_key_version = target_email_hmac_key_version
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_claim.status = 'pending'
     AND v_claim.expires_at > v_now
     AND v_claim.target_auth_user_id IS NULL
     AND v_claim.revoked_at IS NULL THEN
    v_mode := 'initial-claim';
  ELSIF v_claim.status = 'consumed'
        AND v_claim.target_auth_user_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.sponsor_identities identity
          JOIN auth.users auth_user
            ON auth_user.id = identity.auth_user_id
          WHERE identity.id = v_claim.sponsor_identity_id
            AND identity.status = 'active'
            AND identity.auth_user_id = v_claim.target_auth_user_id
            AND auth_user.email_confirmed_at IS NOT NULL
        ) THEN
    v_mode := 'account-reauth';
  ELSE
    RETURN;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'sponsor_account_claim_start',
    context_tool => 'resolve_sponsor_account_claim_start',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Resolve passwordless sponsor account entry mode',
    context_metadata => jsonb_build_object(
      'operation', 'resolve_claim_start',
      'resource_kind', 'sponsorship_account_claim',
      'resource_id', v_claim.id::text,
      'outcome', v_mode
    )
  );

  RETURN QUERY SELECT v_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_sponsor_account_claim_start(
  bytea,
  bytea,
  smallint,
  smallint,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_sponsor_account_claim_start(
  bytea,
  bytea,
  smallint,
  smallint,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.resolve_sponsor_account_claim_start(
  bytea,
  bytea,
  smallint,
  smallint,
  text,
  text
) IS
  'Resolves a live first account claim or a consumed same-account reauthentication link without exposing sponsor contact data. Expired and revoked claims return no row.';

COMMIT;

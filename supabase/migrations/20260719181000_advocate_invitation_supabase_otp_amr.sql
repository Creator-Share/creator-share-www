BEGIN;

CREATE OR REPLACE FUNCTION public.redeem_advocate_delegate_invitation_legacy(
  plaintext_capability text,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  advocate_id uuid,
  membership_id uuid,
  membership_version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(change_reason), '');
  v_claims jsonb := COALESCE(auth.jwt(), '{}'::jsonb);
  v_issued_at_epoch bigint;
  v_otp_authenticated_at_epoch bigint;
  v_session_claim text;
  v_aal text;
  v_user_email text;
  v_invitation_id uuid;
  v_advocate_id uuid;
  v_invitation public.advocate_invitations%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_membership public.advocate_memberships%ROWTYPE;
  v_membership_id uuid;
  v_membership_version bigint;
  v_role_count integer;
  v_valid_role_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF plaintext_capability IS NULL
     OR plaintext_capability !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'An invitation acceptance reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255
     OR octet_length(COALESCE(client_ip, '')) > 1024
     OR octet_length(COALESCE(user_agent, '')) > 4096 THEN
    RAISE EXCEPTION 'Invitation acceptance context exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_issued_at_epoch := (v_claims ->> 'iat')::bigint;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_issued_at_epoch := NULL;
  END;

  v_session_claim := nullif(btrim(v_claims ->> 'session_id'), '');
  v_aal := nullif(btrim(v_claims ->> 'aal'), '');

  IF jsonb_typeof(v_claims -> 'amr') = 'array' THEN
    SELECT max((authentication_method.entry ->> 'timestamp')::bigint)
    INTO v_otp_authenticated_at_epoch
    FROM jsonb_array_elements(v_claims -> 'amr') AS authentication_method(entry)
    WHERE authentication_method.entry ->> 'method' = 'otp'
      AND authentication_method.entry ->> 'timestamp' ~ '^[0-9]{1,12}$';
  END IF;

  IF v_issued_at_epoch IS NULL
     OR v_session_claim IS NULL
     OR char_length(v_session_claim) > 255
     OR v_aal NOT IN ('aal1', 'aal2')
     OR v_issued_at_epoch > extract(epoch FROM v_now)::bigint + 60
     OR v_otp_authenticated_at_epoch IS NULL
     OR v_otp_authenticated_at_epoch >
       extract(epoch FROM v_now)::bigint + 60
     OR v_otp_authenticated_at_epoch <
       extract(epoch FROM v_now)::bigint - 900 THEN
    RAISE EXCEPTION 'Fresh email authentication is required to accept an invitation'
      USING ERRCODE = '42501';
  END IF;

  SELECT invitation.id, invitation.advocate_id
  INTO v_invitation_id, v_advocate_id
  FROM public.advocate_invitations invitation
  WHERE invitation.token_digest = extensions.digest(
    plaintext_capability,
    'sha256'
  );

  IF v_invitation_id IS NULL THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'active',
       'failed'
     ) THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.id = v_invitation_id
    AND invitation.advocate_id = v_advocate.id
    AND invitation.token_digest = extensions.digest(
      plaintext_capability,
      'sha256'
    )
  FOR UPDATE;

  IF NOT FOUND
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= v_now
     OR v_invitation.target_auth_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = v_advocate.id
    AND membership.user_id = v_user_id
  FOR UPDATE;

  SELECT lower(btrim(account.email))
  INTO v_user_email
  FROM auth.users account
  WHERE account.id = v_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  FOR SHARE;

  IF NOT FOUND OR v_user_email IS DISTINCT FROM v_invitation.email THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE role_definition.can_be_invited
        AND role_definition.key = ANY (ARRAY[
          'administrator',
          'brand_editor',
          'catalog_curator',
          'analytics_viewer',
          'audit_viewer'
        ]::text[])
    )
  INTO v_role_count, v_valid_role_count
  FROM public.advocate_invitation_roles invitation_role
  JOIN public.advocate_roles role_definition
    ON role_definition.id = invitation_role.role_id
  WHERE invitation_role.invitation_id = v_invitation.id
    AND invitation_role.advocate_id = v_invitation.advocate_id;

  IF v_role_count NOT BETWEEN 1 AND 5
     OR v_valid_role_count <> v_role_count THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_membership.id IS NOT NULL
     AND (
       v_membership.status <> 'revoked'
       OR v_membership.id = v_advocate.owner_membership_id
     ) THEN
    RAISE EXCEPTION 'Existing active or suspended memberships must be managed separately'
      USING ERRCODE = '23505';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_user_id,
    context_effective_user_id => v_user_id,
    context_tool => 'advocate-invitation-acceptance',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => v_session_claim,
    context_client_ip => NULL,
    context_user_agent => NULL,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'redeem_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', v_invitation.id::text,
      'outcome', 'accepted'
    )
  );

  IF v_membership.id IS NULL THEN
    INSERT INTO public.advocate_memberships (
      advocate_id,
      user_id,
      status
    )
    VALUES (
      v_advocate.id,
      v_user_id,
      'active'
    )
    RETURNING id INTO v_membership_id;
  ELSE
    v_membership_id := v_membership.id;
    PERFORM pg_catalog.set_config(
      'app.advocate.reactivation_membership_id',
      v_membership.id::text,
      true
    );

    UPDATE public.advocate_memberships membership
    SET
      status = 'active',
      version = membership.version + 1
    WHERE membership.id = v_membership.id
      AND membership.advocate_id = v_advocate.id
      AND membership.status = 'revoked';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership changed during invitation redemption'
        USING ERRCODE = '40001';
    END IF;

    DELETE FROM public.advocate_membership_roles membership_role
    WHERE membership_role.advocate_id = v_advocate.id
      AND membership_role.membership_id = v_membership.id;
  END IF;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  SELECT
    v_advocate.id,
    v_membership_id,
    invitation_role.role_id,
    v_invitation.created_by_user_id
  FROM public.advocate_invitation_roles invitation_role
  JOIN public.advocate_roles role_definition
    ON role_definition.id = invitation_role.role_id
   AND role_definition.can_be_invited
  WHERE invitation_role.invitation_id = v_invitation.id
    AND invitation_role.advocate_id = v_advocate.id
  ORDER BY role_definition.key;

  SELECT membership.version
  INTO v_membership_version
  FROM public.advocate_memberships membership
  WHERE membership.id = v_membership_id;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'redeem',
    true
  );

  UPDATE public.advocate_invitations invitation
  SET
    accepted_at = v_now,
    accepted_by_user_id = v_user_id
  WHERE invitation.id = v_invitation.id;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'cancel',
    true
  );

  UPDATE public.advocate_invitation_email_outbox outbox
  SET
    status = CASE
      WHEN outbox.status = 'sent'
        THEN 'sent'::public.email_outbox_status
      ELSE 'cancelled'::public.email_outbox_status
    END,
    recipient_email_ciphertext = NULL,
    recipient_email_hmac = NULL,
    email_normalization_version = NULL,
    email_hmac_key_version = NULL,
    email_encryption_key_version = NULL,
    secret_payload_ciphertext = NULL,
    secret_payload_ciphertext_sha256 = NULL,
    contact_redacted_at = v_now
  WHERE outbox.invitation_id = v_invitation.id
    AND outbox.contact_redacted_at IS NULL;

  RETURN QUERY
  SELECT v_advocate.id, v_membership_id, v_membership_version;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_advocate_delegate_invitation_legacy(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.redeem_advocate_delegate_invitation_legacy(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Internal delegate invitation redemption requires the exact fresh otp AMR emitted by Supabase email proof verification, in addition to the bound user, verified email, and single-use capability.';

CREATE OR REPLACE FUNCTION private.redeem_advocate_invitation_once_legacy(
  plaintext_capability text,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  advocate_id uuid,
  membership_id uuid,
  membership_version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(change_reason), '');
  v_claims jsonb := COALESCE(auth.jwt(), '{}'::jsonb);
  v_issued_at_epoch bigint;
  v_otp_authenticated_at_epoch bigint;
  v_session_claim text;
  v_aal text;
  v_user_email text;
  v_invitation_id uuid;
  v_advocate_id uuid;
  v_invitation_kind public.advocate_invitation_kind;
  v_invitation public.advocate_invitations%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_receipt audit.creator_share_advocate_onboarding_receipts%ROWTYPE;
  v_membership_id uuid;
  v_membership_version bigint;
  v_owner_ready_version bigint;
  v_provisioned_version bigint;
  v_trace_id text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF plaintext_capability IS NULL
     OR plaintext_capability !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'An invitation acceptance reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255
     OR octet_length(COALESCE(client_ip, '')) > 1024
     OR octet_length(COALESCE(user_agent, '')) > 4096 THEN
    RAISE EXCEPTION 'Invitation acceptance context exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_issued_at_epoch := (v_claims ->> 'iat')::bigint;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_issued_at_epoch := NULL;
  END;

  v_session_claim := nullif(btrim(v_claims ->> 'session_id'), '');
  v_aal := nullif(btrim(v_claims ->> 'aal'), '');

  IF jsonb_typeof(v_claims -> 'amr') = 'array' THEN
    SELECT max((authentication_method.entry ->> 'timestamp')::bigint)
    INTO v_otp_authenticated_at_epoch
    FROM jsonb_array_elements(v_claims -> 'amr') AS authentication_method(entry)
    WHERE authentication_method.entry ->> 'method' = 'otp'
      AND authentication_method.entry ->> 'timestamp' ~ '^[0-9]{1,12}$';
  END IF;

  IF v_issued_at_epoch IS NULL
     OR v_session_claim IS NULL
     OR char_length(v_session_claim) > 255
     OR v_aal NOT IN ('aal1', 'aal2')
     OR v_issued_at_epoch > extract(epoch FROM v_now)::bigint + 60
     OR v_otp_authenticated_at_epoch IS NULL
     OR v_otp_authenticated_at_epoch >
       extract(epoch FROM v_now)::bigint + 60
     OR v_otp_authenticated_at_epoch <
       extract(epoch FROM v_now)::bigint - 900 THEN
    RAISE EXCEPTION 'Fresh email authentication is required to accept an invitation'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    invitation.id,
    invitation.advocate_id,
    invitation.invitation_kind
  INTO v_invitation_id, v_advocate_id, v_invitation_kind
  FROM public.advocate_invitations invitation
  WHERE invitation.token_digest = extensions.digest(
    plaintext_capability,
    'sha256'
  );

  IF v_invitation_id IS NULL THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation_kind = 'delegate' THEN
    RETURN QUERY
    SELECT
      redeemed.advocate_id,
      redeemed.membership_id,
      redeemed.membership_version
    FROM public.redeem_advocate_delegate_invitation_legacy(
      plaintext_capability,
      change_reason,
      request_id,
      trace_id,
      session_id,
      client_ip,
      user_agent
    ) redeemed;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_advocate_id::text, 932741)
  );

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_advocate.relationship_status <> 'invited'
     OR v_advocate.publication_status <> 'draft'
     OR v_advocate.owner_membership_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.id = v_invitation_id
    AND invitation.advocate_id = v_advocate.id
    AND invitation.invitation_kind = 'initial_owner'
    AND invitation.token_digest = extensions.digest(
      plaintext_capability,
      'sha256'
    )
  FOR UPDATE;

  IF NOT FOUND
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= v_now
     OR v_invitation.target_auth_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(account.email))
  INTO v_user_email
  FROM auth.users account
  WHERE account.id = v_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  FOR SHARE;

  IF NOT FOUND OR v_user_email IS DISTINCT FROM v_invitation.email THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.advocate_id = v_advocate.id
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_invitation_roles invitation_role
    WHERE invitation_role.invitation_id = v_invitation.id
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_advocate.id
  ) OR EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
  ) THEN
    RAISE EXCEPTION 'Initial-owner invitation state is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  SELECT receipt.*
  INTO v_receipt
  FROM audit.creator_share_advocate_onboarding_receipts receipt
  WHERE receipt.advocate_id = v_advocate.id
    AND private.advocate_initial_owner_invitation_is_authorized(
      v_advocate.id,
      v_invitation.id
    )
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Initial-owner onboarding authority is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_trace_id := COALESCE(
    NULLIF(btrim(trace_id), ''),
    'initial-owner-acceptance:' || v_invitation.id::text
  );

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_user_id,
    context_effective_user_id => v_user_id,
    context_tool => 'advocate-invitation-acceptance',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => v_trace_id,
    context_session_id => v_session_claim,
    context_client_ip => NULL,
    context_user_agent => NULL,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'redeem_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', v_invitation.id::text,
      'outcome', 'accepted'
    )
  );

  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  VALUES (
    v_advocate.id,
    v_user_id,
    'active'
  )
  RETURNING id, version
  INTO v_membership_id, v_membership_version;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  VALUES (
    v_advocate.id,
    v_membership_id,
    '00000000-0000-4000-8000-000000000001'::uuid,
    v_invitation.created_by_user_id
  );

  UPDATE public.advocates advocate
  SET
    owner_membership_id = v_membership_id,
    relationship_status = 'active'
  WHERE advocate.id = v_advocate.id
    AND advocate.version = v_advocate.version
    AND advocate.relationship_status = 'invited'
    AND advocate.publication_status = 'draft'
    AND advocate.owner_membership_id IS NULL
  RETURNING advocate.version INTO v_owner_ready_version;

  IF NOT FOUND OR v_owner_ready_version <> v_advocate.version + 1 THEN
    RAISE EXCEPTION 'Advocate changed during initial-owner acceptance'
      USING ERRCODE = '40001';
  END IF;

  SELECT provisioned.advocate_version
  INTO v_provisioned_version
  FROM private.start_advocate_portal_provisioning_internal(
    v_advocate.id,
    v_owner_ready_version,
    v_receipt.provisioning_request_id,
    v_trace_id,
    v_user_id,
    'initial_owner_acceptance',
    v_invitation.id
  ) provisioned;

  IF v_provisioned_version <> v_owner_ready_version + 1 THEN
    RAISE EXCEPTION 'Initial-owner provisioning did not advance exactly once'
      USING ERRCODE = '40001';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_user_id,
    context_effective_user_id => v_user_id,
    context_tool => 'advocate-invitation-acceptance',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => v_trace_id,
    context_session_id => v_session_claim,
    context_client_ip => NULL,
    context_user_agent => NULL,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'redeem_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', v_invitation.id::text,
      'outcome', 'accepted'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'redeem',
    true
  );

  UPDATE public.advocate_invitations invitation
  SET
    accepted_at = v_now,
    accepted_by_user_id = v_user_id
  WHERE invitation.id = v_invitation.id;

  RETURN QUERY
  SELECT v_advocate.id, v_membership_id, v_membership_version;
END;
$$;

REVOKE ALL ON FUNCTION private.redeem_advocate_invitation_once_legacy(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.redeem_advocate_invitation_once_legacy(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Internal kind-aware invitation redemption requires the exact fresh otp AMR emitted by Supabase email proof verification. Phone sign-in and phone MFA must remain disabled while otp is used as the email-proof session signal.';

COMMIT;

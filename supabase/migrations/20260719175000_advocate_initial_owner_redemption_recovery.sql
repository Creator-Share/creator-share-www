BEGIN;

CREATE OR REPLACE FUNCTION private.require_active_advocate_invitation_actor(
  target_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM target_actor_user_id THEN
    RAISE EXCEPTION 'An active invitation authentication session is required'
      USING ERRCODE = '28000';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = target_actor_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (
      account.banned_until IS NULL
      OR account.banned_until <= clock_timestamp()
    )
  FOR SHARE OF account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active invitation authentication session is required'
      USING ERRCODE = '28000';
  END IF;

  BEGIN
    v_session_id := private.require_active_signed_auth_session_id(
      target_actor_user_id
    );
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      RAISE EXCEPTION 'An active invitation authentication session is required'
        USING ERRCODE = '28000';
  END;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION private.require_active_advocate_invitation_actor(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE audit.creator_share_advocate_invitation_redemption_receipts (
  operation_id uuid PRIMARY KEY,
  invitation_kind public.advocate_invitation_kind NOT NULL,
  initiating_user_id uuid NOT NULL,
  request_fingerprint bytea NOT NULL,
  advocate_id uuid NOT NULL,
  invitation_id uuid NOT NULL UNIQUE,
  membership_id uuid NOT NULL,
  membership_version bigint NOT NULL,
  provisioning_request_id uuid UNIQUE,
  resulting_advocate_version bigint,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT creator_share_invitation_redemption_fingerprint_check CHECK (
    octet_length(request_fingerprint) = 32
  ),
  CONSTRAINT creator_share_invitation_redemption_versions_check CHECK (
    membership_version > 0
    AND (
      (
        invitation_kind = 'initial_owner'
        AND provisioning_request_id IS NOT NULL
        AND resulting_advocate_version > 1
      )
      OR (
        invitation_kind = 'delegate'
        AND provisioning_request_id IS NULL
        AND resulting_advocate_version IS NULL
      )
    )
  ),
  CONSTRAINT creator_share_invitation_redemption_operation_advocate_key
    UNIQUE (operation_id, advocate_id),
  CONSTRAINT creator_share_invitation_redemption_advocate_fkey
    FOREIGN KEY (advocate_id)
    REFERENCES public.advocates(id) ON DELETE RESTRICT,
  CONSTRAINT creator_share_invitation_redemption_invitation_fkey
    FOREIGN KEY (invitation_id, advocate_id)
    REFERENCES public.advocate_invitations(id, advocate_id) ON DELETE RESTRICT,
  CONSTRAINT creator_share_invitation_redemption_membership_fkey
    FOREIGN KEY (membership_id, advocate_id)
    REFERENCES public.advocate_memberships(id, advocate_id) ON DELETE RESTRICT,
  CONSTRAINT creator_share_invitation_redemption_provisioning_fkey
    FOREIGN KEY (provisioning_request_id)
    REFERENCES audit.advocate_portal_provisioning_starts(request_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX creator_share_owner_redemption_advocate_uidx
  ON audit.creator_share_advocate_invitation_redemption_receipts (advocate_id)
  WHERE invitation_kind = 'initial_owner';

COMMENT ON TABLE audit.creator_share_advocate_invitation_redemption_receipts IS
  'Append-only, contact-free invitation acceptance outcomes. The operation UUID is never bearer authority; recovery also requires the same user with a current active signed authentication session.';

COMMENT ON COLUMN audit.creator_share_advocate_invitation_redemption_receipts.request_fingerprint IS
  'One-way binding over the authenticated user, tenant, invitation kind, invitation, and normalized reason. It does not contain or derive from the invitation capability, email proof, recipient contact, or session secret.';

ALTER TABLE audit.creator_share_advocate_invitation_redemption_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_invitation_redemption_receipts
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON audit.creator_share_advocate_invitation_redemption_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER creator_share_invitation_redemption_receipts_no_mutation
BEFORE UPDATE OR DELETE
ON audit.creator_share_advocate_invitation_redemption_receipts
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

CREATE TRIGGER creator_share_invitation_redemption_receipts_no_truncate
BEFORE TRUNCATE
ON audit.creator_share_advocate_invitation_redemption_receipts
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

ALTER FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) SET SCHEMA private;

ALTER FUNCTION private.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) RENAME TO redeem_advocate_invitation_once_legacy;

REVOKE ALL ON FUNCTION private.redeem_advocate_invitation_once_legacy(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.redeem_advocate_invitation(
  plaintext_capability text,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL,
  redemption_operation_id uuid DEFAULT NULL
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
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(change_reason), '');
  v_invitation_id uuid;
  v_advocate_id uuid;
  v_invitation_kind public.advocate_invitation_kind;
  v_fingerprint bytea;
  v_existing audit.creator_share_advocate_invitation_redemption_receipts%ROWTYPE;
  v_membership_id uuid;
  v_membership_version bigint;
  v_provisioning_request_id uuid;
  v_resulting_advocate_version bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  PERFORM private.require_active_advocate_invitation_actor(v_user_id);

  IF plaintext_capability IS NULL
     OR plaintext_capability !~ '^[0-9a-f]{64}$'
     OR v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]'
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255
     OR octet_length(COALESCE(client_ip, '')) > 1024
     OR octet_length(COALESCE(user_agent, '')) > 4096 THEN
    RAISE EXCEPTION 'Invitation redemption input is invalid'
      USING ERRCODE = '22023';
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

  IF v_invitation_kind = 'delegate'
     AND redemption_operation_id IS NULL THEN
    RETURN QUERY
    SELECT
      redeemed.advocate_id,
      redeemed.membership_id,
      redeemed.membership_version
    FROM private.redeem_advocate_invitation_once_legacy(
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

  IF redemption_operation_id IS NULL
     OR redemption_operation_id::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR request_id IS DISTINCT FROM redemption_operation_id::text THEN
    RAISE EXCEPTION 'Invitation redemption operation identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_fingerprint := extensions.digest(
    pg_catalog.convert_to(
      concat_ws(
        E'\n',
        'creator-share-advocate-invitation-redemption-v1',
        v_user_id::text,
        v_advocate_id::text,
        v_invitation_kind::text,
        v_invitation_id::text,
        v_reason
      ),
      'UTF8'
    ),
    'sha256'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(redemption_operation_id::text, 614243)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_invitation_id::text, 614244)
  );

  SELECT receipt.*
  INTO v_existing
  FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
  WHERE receipt.operation_id = redemption_operation_id
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.initiating_user_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'Invitation is invalid or unavailable'
        USING ERRCODE = '42501';
    END IF;

    IF v_existing.advocate_id IS DISTINCT FROM v_advocate_id
       OR v_existing.invitation_id IS DISTINCT FROM v_invitation_id
       OR v_existing.invitation_kind IS DISTINCT FROM v_invitation_kind
       OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint
       OR NOT EXISTS (
         SELECT 1
         FROM public.advocate_invitations invitation
         WHERE invitation.id = v_existing.invitation_id
           AND invitation.advocate_id = v_existing.advocate_id
           AND invitation.invitation_kind = v_existing.invitation_kind
           AND invitation.token_digest = extensions.digest(
             plaintext_capability,
             'sha256'
           )
           AND invitation.accepted_at IS NOT NULL
           AND invitation.accepted_by_user_id = v_existing.initiating_user_id
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.advocate_memberships membership
         WHERE membership.id = v_existing.membership_id
           AND membership.advocate_id = v_existing.advocate_id
           AND membership.user_id = v_existing.initiating_user_id
           AND membership.version >= v_existing.membership_version
       )
       OR (
         v_existing.invitation_kind = 'initial_owner'
         AND NOT EXISTS (
           SELECT 1
           FROM audit.advocate_portal_provisioning_starts provisioning_start
           WHERE provisioning_start.request_id =
             v_existing.provisioning_request_id
             AND provisioning_start.advocate_id = v_existing.advocate_id
             AND provisioning_start.initiating_user_id =
               v_existing.initiating_user_id
             AND provisioning_start.initiator_kind =
               'initial_owner_acceptance'
             AND provisioning_start.initial_owner_invitation_id =
               v_existing.invitation_id
             AND provisioning_start.resulting_advocate_version =
               v_existing.resulting_advocate_version
         )
       ) THEN
      RAISE EXCEPTION 'Invitation redemption operation conflicts with its receipt'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_existing.advocate_id,
      v_existing.membership_id,
      v_existing.membership_version;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
    WHERE receipt.invitation_id = v_invitation_id
  ) THEN
    RAISE EXCEPTION 'Invitation was redeemed by another operation'
      USING ERRCODE = '40001';
  END IF;

  SELECT
    redeemed.advocate_id,
    redeemed.membership_id,
    redeemed.membership_version
  INTO v_advocate_id, v_membership_id, v_membership_version
  FROM private.redeem_advocate_invitation_once_legacy(
    plaintext_capability,
    change_reason,
    request_id,
    trace_id,
    session_id,
    client_ip,
    user_agent
  ) redeemed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation redemption did not return an outcome'
      USING ERRCODE = '40001';
  END IF;

  IF v_invitation_kind = 'initial_owner' THEN
    SELECT advocate.version, provisioning_start.request_id
    INTO v_resulting_advocate_version, v_provisioning_request_id
    FROM public.advocates advocate
    JOIN public.advocate_invitations invitation
      ON invitation.advocate_id = advocate.id
     AND invitation.id = v_invitation_id
     AND invitation.invitation_kind = 'initial_owner'
     AND invitation.accepted_at IS NOT NULL
     AND invitation.accepted_by_user_id = v_user_id
    JOIN public.advocate_memberships membership
      ON membership.advocate_id = advocate.id
     AND membership.id = v_membership_id
     AND membership.user_id = v_user_id
     AND membership.version >= v_membership_version
    JOIN public.advocate_membership_roles membership_role
      ON membership_role.advocate_id = advocate.id
     AND membership_role.membership_id = membership.id
     AND membership_role.role_id =
       '00000000-0000-4000-8000-000000000001'::uuid
    JOIN audit.advocate_portal_provisioning_starts provisioning_start
      ON provisioning_start.advocate_id = advocate.id
     AND provisioning_start.initiating_user_id = v_user_id
     AND provisioning_start.initiator_kind = 'initial_owner_acceptance'
     AND provisioning_start.initial_owner_invitation_id = v_invitation_id
     AND provisioning_start.resulting_advocate_version = advocate.version
    WHERE advocate.id = v_advocate_id
      AND advocate.owner_membership_id = v_membership_id
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status = 'provisioning'
    FOR SHARE OF advocate, invitation, membership;

    IF NOT FOUND OR v_resulting_advocate_version <= 1 THEN
      RAISE EXCEPTION 'Initial-owner redemption outcome is inconsistent'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    PERFORM 1
    FROM public.advocate_invitations invitation
    JOIN public.advocate_memberships membership
      ON membership.advocate_id = invitation.advocate_id
     AND membership.id = v_membership_id
     AND membership.user_id = v_user_id
     AND membership.version >= v_membership_version
    WHERE invitation.id = v_invitation_id
      AND invitation.advocate_id = v_advocate_id
      AND invitation.invitation_kind = 'delegate'
      AND invitation.accepted_at IS NOT NULL
      AND invitation.accepted_by_user_id = v_user_id
    FOR SHARE OF invitation, membership;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Delegate redemption outcome is inconsistent'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO audit.creator_share_advocate_invitation_redemption_receipts (
    operation_id,
    invitation_kind,
    initiating_user_id,
    request_fingerprint,
    advocate_id,
    invitation_id,
    membership_id,
    membership_version,
    provisioning_request_id,
    resulting_advocate_version
  )
  VALUES (
    redemption_operation_id,
    v_invitation_kind,
    v_user_id,
    v_fingerprint,
    v_advocate_id,
    v_invitation_id,
    v_membership_id,
    v_membership_version,
    v_provisioning_request_id,
    v_resulting_advocate_version
  );

  RETURN QUERY SELECT
    v_advocate_id,
    v_membership_id,
    v_membership_version;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) TO authenticated;

COMMENT ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) IS
  'Operation-bound invitation redemption. Browser initial-owner and delegate acceptance writes a contact-free immutable receipt in the same transaction and supports exact replay. Legacy delegate callers may omit the operation until migrated. The operation UUID is never authority.';

CREATE OR REPLACE FUNCTION public.recover_advocate_invitation_redemption(
  redemption_operation_id uuid
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
  v_user_id uuid := auth.uid();
  v_existing audit.creator_share_advocate_invitation_redemption_receipts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  PERFORM private.require_active_advocate_invitation_actor(v_user_id);

  IF redemption_operation_id IS NULL
     OR redemption_operation_id::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'A client-generated redemption operation UUID is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(redemption_operation_id::text, 614243)
  );

  SELECT receipt.*
  INTO v_existing
  FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
  WHERE receipt.operation_id = redemption_operation_id
    AND receipt.initiating_user_id = v_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation redemption recovery is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    v_existing.advocate_id,
    v_existing.membership_id,
    v_existing.membership_version;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_advocate_invitation_redemption(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_advocate_invitation_redemption(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.recover_advocate_invitation_redemption(uuid) IS
  'Returns an immutable committed invitation acceptance outcome only to the exact user with a current active signed authentication session. The operation UUID is a lookup key, never a bearer credential.';

COMMIT;

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.advocate_invitation_kind AS ENUM (
    'delegate',
    'initial_owner'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.advocate_invitations
  ADD COLUMN invitation_kind public.advocate_invitation_kind
    NOT NULL DEFAULT 'delegate';

ALTER TABLE public.advocates
  ADD COLUMN owner_onboarding_revision bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT advocates_owner_onboarding_revision_check CHECK (
    owner_onboarding_revision >= 0
  );

COMMENT ON COLUMN public.advocates.owner_onboarding_revision IS
  'Non-contact optimistic lifecycle counter incremented once for every committed initial-owner recovery mutation, including replacement and revocation. It fences stale Creator Share administrator recovery actions.';

COMMENT ON COLUMN public.advocate_invitations.invitation_kind IS
  'Immutable purpose of an invitation. Delegate invitations grant one to five predefined non-owner roles. Initial-owner invitations grant only the fixed Owner role during atomic first acceptance.';

CREATE UNIQUE INDEX advocate_invitations_one_live_initial_owner_uidx
  ON public.advocate_invitations (advocate_id)
  WHERE invitation_kind = 'initial_owner'
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION private.jsonb_object_has_exact_keys(
  target_object jsonb,
  expected_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    jsonb_typeof(target_object) = 'object'
    AND ARRAY(
      SELECT key
      FROM jsonb_object_keys(target_object) AS actual(key)
      ORDER BY key
    ) = ARRAY(
      SELECT DISTINCT key
      FROM unnest(expected_keys) AS expected(key)
      ORDER BY key
    );
$$;

REVOKE ALL ON FUNCTION private.jsonb_object_has_exact_keys(jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.advocate_invitation_email_outbox
  DROP CONSTRAINT advocate_invitation_email_outbox_template_check,
  ADD CONSTRAINT advocate_invitation_email_outbox_template_check CHECK (
    jsonb_typeof(template_data) = 'object'
    AND (
      (
        template_key = 'advocate_delegate_invitation_v1'
        AND private.jsonb_object_has_exact_keys(
          template_data,
          ARRAY['advocate_display_name', 'invitation_id', 'role_keys']::text[]
        )
        AND jsonb_typeof(template_data -> 'role_keys') = 'array'
        AND template_data ? 'advocate_display_name'
        AND template_data ? 'invitation_id'
      )
      OR
      (
        template_key = 'advocate_initial_owner_invitation_v1'
        AND private.jsonb_object_has_exact_keys(
          template_data,
          ARRAY['advocate_display_name', 'invitation_id']::text[]
        )
        AND template_data ? 'advocate_display_name'
        AND template_data ? 'invitation_id'
      )
    )
  );

CREATE TABLE audit.creator_share_advocate_onboarding_receipts (
  operation_id uuid PRIMARY KEY,
  initiating_user_id uuid NOT NULL,
  request_fingerprint bytea NOT NULL,
  advocate_id uuid NOT NULL UNIQUE,
  invitation_id uuid NOT NULL UNIQUE,
  provisioning_request_id uuid NOT NULL UNIQUE,
  committed_advocate_version bigint NOT NULL,
  onboarding_status text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT creator_share_advocate_onboarding_fingerprint_check CHECK (
    octet_length(request_fingerprint) = 32
  ),
  CONSTRAINT creator_share_advocate_onboarding_version_check CHECK (
    committed_advocate_version = 1
  ),
  CONSTRAINT creator_share_advocate_onboarding_status_check CHECK (
    onboarding_status = 'initial_owner_invitation_queued'
  )
);

CREATE TABLE audit.creator_share_advocate_initial_owner_reissue_receipts (
  operation_id uuid PRIMARY KEY,
  initiating_user_id uuid NOT NULL,
  request_fingerprint bytea NOT NULL,
  advocate_id uuid NOT NULL,
  prior_invitation_id uuid NOT NULL,
  invitation_id uuid NOT NULL UNIQUE,
  expected_advocate_version bigint NOT NULL,
  resulting_advocate_version bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT creator_share_advocate_owner_reissue_fingerprint_check CHECK (
    octet_length(request_fingerprint) = 32
  ),
  CONSTRAINT creator_share_advocate_owner_reissue_version_check CHECK (
    expected_advocate_version > 0
    AND resulting_advocate_version = expected_advocate_version + 1
  ),
  CONSTRAINT creator_share_advocate_owner_reissue_distinct_invitation_check
    CHECK (prior_invitation_id <> invitation_id),
  CONSTRAINT creator_share_advocate_owner_reissue_prior_unique
    UNIQUE (prior_invitation_id),
  CONSTRAINT creator_share_advocate_owner_reissue_operation_advocate_unique
    UNIQUE (operation_id, advocate_id)
);

CREATE TABLE audit.creator_share_advocate_initial_owner_revocation_receipts (
  operation_id uuid PRIMARY KEY,
  initiating_user_id uuid NOT NULL,
  request_fingerprint bytea NOT NULL,
  advocate_id uuid NOT NULL,
  invitation_id uuid NOT NULL UNIQUE,
  expected_advocate_version bigint NOT NULL,
  resulting_advocate_version bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT creator_share_advocate_owner_revocation_fingerprint_check CHECK (
    octet_length(request_fingerprint) = 32
  ),
  CONSTRAINT creator_share_advocate_owner_revocation_version_check CHECK (
    expected_advocate_version > 0
    AND resulting_advocate_version = expected_advocate_version + 1
  ),
  CONSTRAINT creator_share_advocate_owner_revocation_operation_advocate_unique
    UNIQUE (operation_id, advocate_id)
);

ALTER TABLE audit.creator_share_advocate_onboarding_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_onboarding_receipts
  FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_initial_owner_reissue_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_initial_owner_reissue_receipts
  FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_initial_owner_revocation_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_initial_owner_revocation_receipts
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON audit.creator_share_advocate_onboarding_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON audit.creator_share_advocate_initial_owner_reissue_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON audit.creator_share_advocate_initial_owner_revocation_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_advocate_onboarding_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Advocate onboarding receipts are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_advocate_onboarding_receipt_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER creator_share_advocate_onboarding_receipts_no_mutation
BEFORE UPDATE OR DELETE ON audit.creator_share_advocate_onboarding_receipts
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

CREATE TRIGGER creator_share_advocate_onboarding_receipts_no_truncate
BEFORE TRUNCATE ON audit.creator_share_advocate_onboarding_receipts
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

CREATE TRIGGER creator_share_advocate_owner_reissue_receipts_no_mutation
BEFORE UPDATE OR DELETE
ON audit.creator_share_advocate_initial_owner_reissue_receipts
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

CREATE TRIGGER creator_share_advocate_owner_reissue_receipts_no_truncate
BEFORE TRUNCATE
ON audit.creator_share_advocate_initial_owner_reissue_receipts
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

CREATE TRIGGER creator_share_advocate_owner_revocation_receipts_no_mutation
BEFORE UPDATE OR DELETE
ON audit.creator_share_advocate_initial_owner_revocation_receipts
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

CREATE TRIGGER creator_share_advocate_owner_revocation_receipts_no_truncate
BEFORE TRUNCATE
ON audit.creator_share_advocate_initial_owner_revocation_receipts
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_onboarding_receipt_mutation();

CREATE OR REPLACE FUNCTION private.advocate_initial_owner_invitation_is_authorized(
  target_advocate_id uuid,
  target_invitation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE authorized_invitation(invitation_id) AS (
    SELECT receipt.invitation_id
    FROM audit.creator_share_advocate_onboarding_receipts receipt
    WHERE receipt.advocate_id = target_advocate_id

    UNION

    SELECT reissue.invitation_id
    FROM audit.creator_share_advocate_initial_owner_reissue_receipts reissue
    JOIN authorized_invitation prior
      ON prior.invitation_id = reissue.prior_invitation_id
    WHERE reissue.advocate_id = target_advocate_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM authorized_invitation authorized
    JOIN public.advocate_invitations invitation
      ON invitation.id = authorized.invitation_id
     AND invitation.advocate_id = target_advocate_id
     AND invitation.invitation_kind = 'initial_owner'
    WHERE authorized.invitation_id = target_invitation_id
  );
$$;

REVOKE ALL ON FUNCTION private.advocate_initial_owner_invitation_is_authorized(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_advocate_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := nullif(
    pg_catalog.current_setting('app.advocate.invitation_operation', true),
    ''
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Advocate invitation rows cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_operation <> 'issue'
       OR NEW.accepted_at IS NOT NULL
       OR NEW.accepted_by_user_id IS NOT NULL
       OR NEW.revoked_at IS NOT NULL
       OR NEW.revoked_by_user_id IS NOT NULL
       OR NEW.last_sent_at IS NOT NULL
       OR NEW.expires_at IS DISTINCT FROM NEW.created_at + interval '7 days'
       OR NEW.issuance_idempotency_key IS NULL
       OR octet_length(NEW.issuance_fingerprint) <> 32 THEN
      RAISE EXCEPTION 'Advocate invitations require the secure issuance boundary'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.invitation_kind IS DISTINCT FROM OLD.invitation_kind
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.issuance_idempotency_key IS DISTINCT FROM OLD.issuance_idempotency_key
     OR NEW.issuance_fingerprint IS DISTINCT FROM OLD.issuance_fingerprint THEN
    RAISE EXCEPTION 'Advocate invitation issuance facts are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF v_operation = 'bind_target' THEN
    IF OLD.target_auth_user_id IS NOT NULL
       OR NEW.target_auth_user_id IS NULL
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id
       OR NEW.last_sent_at IS DISTINCT FROM OLD.last_sent_at THEN
      RAISE EXCEPTION 'Invitation target binding is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'record_delivery' THEN
    IF OLD.accepted_at IS NOT NULL
       OR OLD.revoked_at IS NOT NULL
       OR NEW.target_auth_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id
       OR NEW.last_sent_at IS NULL
       OR NEW.last_sent_at < COALESCE(OLD.last_sent_at, OLD.created_at) THEN
      RAISE EXCEPTION 'Invitation delivery update is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation IN (
    'revoke',
    'issuer_membership_revocation'
  ) THEN
    IF OLD.accepted_at IS NOT NULL
       OR OLD.revoked_at IS NOT NULL
       OR NEW.revoked_at IS NULL
       OR NEW.revoked_by_user_id IS NULL
       OR NEW.target_auth_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
       OR NEW.last_sent_at IS DISTINCT FROM OLD.last_sent_at THEN
      RAISE EXCEPTION 'Invitation revocation update is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'redeem' THEN
    IF OLD.accepted_at IS NOT NULL
       OR OLD.revoked_at IS NOT NULL
       OR NEW.accepted_at IS NULL
       OR NEW.accepted_by_user_id IS NULL
       OR NEW.target_auth_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id
       OR NEW.last_sent_at IS DISTINCT FROM OLD.last_sent_at THEN
      RAISE EXCEPTION 'Invitation redemption update is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Advocate invitation lifecycle changes require a narrow operation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_advocate_invitation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_advocate_invitation_kind_invariant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitation_id uuid;
  v_invitation_ids uuid[];
  v_kind public.advocate_invitation_kind;
  v_role_count integer;
  v_valid_delegate_role_count integer;
BEGIN
  IF TG_TABLE_NAME = 'advocate_invitations' THEN
    IF TG_OP = 'INSERT' THEN
      v_invitation_ids := ARRAY[NEW.id];
    ELSIF TG_OP = 'DELETE' THEN
      v_invitation_ids := ARRAY[OLD.id];
    ELSE
      v_invitation_ids := ARRAY[OLD.id, NEW.id];
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      v_invitation_ids := ARRAY[NEW.invitation_id];
    ELSIF TG_OP = 'DELETE' THEN
      v_invitation_ids := ARRAY[OLD.invitation_id];
    ELSE
      v_invitation_ids := ARRAY[OLD.invitation_id, NEW.invitation_id];
    END IF;
  END IF;

  FOR v_invitation_id IN
    SELECT DISTINCT candidate.invitation_id
    FROM unnest(v_invitation_ids) AS candidate(invitation_id)
    WHERE candidate.invitation_id IS NOT NULL
  LOOP
    SELECT invitation.invitation_kind
    INTO v_kind
    FROM public.advocate_invitations invitation
    WHERE invitation.id = v_invitation_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT
      count(*)::integer,
      count(*) FILTER (
        WHERE role_definition.can_be_invited
          AND role_definition.key = ANY (ARRAY[
            'administrator',
            'brand_editor',
            'catalog_curator',
            'analytics_viewer',
            'audit_viewer'
          ]::text[])
      )::integer
    INTO v_role_count, v_valid_delegate_role_count
    FROM public.advocate_invitation_roles invitation_role
    JOIN public.advocate_roles role_definition
      ON role_definition.id = invitation_role.role_id
    WHERE invitation_role.invitation_id = v_invitation_id;

    IF v_kind = 'delegate'
       AND (
         v_role_count NOT BETWEEN 1 AND 5
         OR v_valid_delegate_role_count <> v_role_count
       ) THEN
      RAISE EXCEPTION 'Delegate invitations require one to five valid non-owner roles'
        USING ERRCODE = '23514';
    END IF;

    IF v_kind = 'initial_owner' AND v_role_count <> 0 THEN
      RAISE EXCEPTION 'Initial-owner invitations cannot carry delegate roles'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_advocate_invitation_kind_invariant()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER advocate_invitations_kind_invariant
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_invitations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.assert_advocate_invitation_kind_invariant();

CREATE CONSTRAINT TRIGGER advocate_invitation_roles_kind_invariant
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_invitation_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.assert_advocate_invitation_kind_invariant();

CREATE OR REPLACE FUNCTION private.assert_advocate_invitation_template_invariant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitation_id uuid;
  v_invitation_ids uuid[];
  v_kind public.advocate_invitation_kind;
  v_template_key text;
BEGIN
  IF TG_TABLE_NAME = 'advocate_invitations' THEN
    IF TG_OP = 'INSERT' THEN
      v_invitation_ids := ARRAY[NEW.id];
    ELSIF TG_OP = 'DELETE' THEN
      v_invitation_ids := ARRAY[OLD.id];
    ELSE
      v_invitation_ids := ARRAY[OLD.id, NEW.id];
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      v_invitation_ids := ARRAY[NEW.invitation_id];
    ELSIF TG_OP = 'DELETE' THEN
      v_invitation_ids := ARRAY[OLD.invitation_id];
    ELSE
      v_invitation_ids := ARRAY[OLD.invitation_id, NEW.invitation_id];
    END IF;
  END IF;

  FOR v_invitation_id IN
    SELECT DISTINCT candidate.invitation_id
    FROM unnest(v_invitation_ids) AS candidate(invitation_id)
    WHERE candidate.invitation_id IS NOT NULL
  LOOP
    SELECT invitation.invitation_kind, outbox.template_key
    INTO v_kind, v_template_key
    FROM public.advocate_invitations invitation
    LEFT JOIN public.advocate_invitation_email_outbox outbox
      ON outbox.invitation_id = invitation.id
     AND outbox.advocate_id = invitation.advocate_id
    WHERE invitation.id = v_invitation_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_template_key IS NOT NULL
       AND (
         (
         v_kind = 'delegate'
         AND v_template_key <> 'advocate_delegate_invitation_v1'
         )
         OR (
         v_kind = 'initial_owner'
         AND v_template_key <> 'advocate_initial_owner_invitation_v1'
         )
       ) THEN
      RAISE EXCEPTION 'Invitation kind and delivery template do not match'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_advocate_invitation_template_invariant()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER advocate_invitations_template_invariant
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_invitations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.assert_advocate_invitation_template_invariant();

CREATE CONSTRAINT TRIGGER advocate_invitation_outbox_template_invariant
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_invitation_email_outbox
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.assert_advocate_invitation_template_invariant();

CREATE OR REPLACE FUNCTION private.advocate_invitation_delivery_is_eligible(
  target_invitation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    JOIN public.advocates advocate
      ON advocate.id = invitation.advocate_id
    WHERE invitation.id = target_invitation_id
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL
      AND invitation.expires_at > clock_timestamp()
      AND (
        (
          invitation.invitation_kind = 'delegate'
          AND advocate.relationship_status = 'active'
          AND advocate.publication_status IN (
            'draft',
            'provisioning',
            'active',
            'failed'
          )
        )
        OR
        (
          invitation.invitation_kind = 'initial_owner'
          AND advocate.relationship_status = 'invited'
          AND advocate.publication_status = 'draft'
          AND advocate.owner_membership_id IS NULL
          AND private.advocate_initial_owner_invitation_is_authorized(
            advocate.id,
            invitation.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.advocate_domains domain
            WHERE domain.advocate_id = advocate.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.advocate_domain_integrations integration
            WHERE integration.advocate_id = advocate.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.domain_provisioning_jobs job
            WHERE job.advocate_id = advocate.id
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.advocate_invitation_delivery_is_eligible(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE audit.advocate_portal_provisioning_starts
  ADD COLUMN initiator_kind text NOT NULL DEFAULT 'creator_share_admin',
  ADD COLUMN initial_owner_invitation_id uuid,
  ADD CONSTRAINT advocate_portal_provisioning_starts_initiator_check CHECK (
    (
      initiator_kind = 'creator_share_admin'
      AND initial_owner_invitation_id IS NULL
    )
    OR
    (
      initiator_kind = 'initial_owner_acceptance'
      AND initial_owner_invitation_id IS NOT NULL
    )
  );

COMMENT ON COLUMN audit.advocate_portal_provisioning_starts.initiating_user_id IS
  'Authenticated healthy user who initiated provisioning, either a Creator Share super administrator or the verified first owner accepting the initial-owner invitation.';
COMMENT ON COLUMN audit.advocate_portal_provisioning_starts.initiator_kind IS
  'Fixed authority path that initiated the exact provider topology.';
COMMENT ON COLUMN audit.advocate_portal_provisioning_starts.initial_owner_invitation_id IS
  'Initial-owner invitation whose successful acceptance atomically initiated provisioning, or null for the Creator Share administrator path.';

CREATE OR REPLACE FUNCTION private.start_advocate_portal_provisioning_internal(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  request_id uuid,
  trace_id text,
  initiating_user_id uuid,
  initiator_kind text,
  initial_owner_invitation_id uuid DEFAULT NULL
)
RETURNS TABLE (
  advocate_id uuid,
  advocate_version bigint,
  domain_id uuid,
  hostname text,
  job_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate public.advocates%ROWTYPE;
  v_existing audit.advocate_portal_provisioning_starts%ROWTYPE;
  v_domain_id uuid := gen_random_uuid();
  v_hostname text;
  v_integration_id uuid;
  v_job_id uuid;
  v_job_ids uuid[] := ARRAY[]::uuid[];
  v_resulting_version bigint;
  v_topology_digest bytea :=
    private.advocate_required_provider_topology_digest();
  v_provider record;
BEGIN
  IF target_advocate_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1
     OR request_id IS NULL
     OR trace_id IS NULL
     OR trace_id <> btrim(trace_id)
     OR char_length(trace_id) NOT BETWEEN 1 AND 255
     OR $5 IS NULL
     OR $6 NOT IN (
       'creator_share_admin',
       'initial_owner_acceptance'
     )
     OR (
       $6 = 'creator_share_admin'
       AND $7 IS NOT NULL
     )
     OR (
       $6 = 'initial_owner_acceptance'
       AND $7 IS NULL
     ) THEN
    RAISE EXCEPTION 'Advocate provisioning start input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT start.*
  INTO v_existing
  FROM audit.advocate_portal_provisioning_starts start
  WHERE start.request_id = $3
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.advocate_id IS DISTINCT FROM target_advocate_id
       OR v_existing.initiating_user_id IS DISTINCT FROM $5
       OR v_existing.expected_advocate_version IS DISTINCT FROM
          expected_advocate_version
       OR v_existing.initiator_kind IS DISTINCT FROM $6
       OR v_existing.initial_owner_invitation_id IS DISTINCT FROM
          $7
       OR NOT private.advocate_provisioning_replay_is_exact(
         v_existing.advocate_id,
         v_existing.domain_id,
         v_existing.hostname,
         v_existing.resulting_advocate_version,
         v_existing.job_ids,
         v_existing.provider_topology_digest
       ) THEN
      RAISE EXCEPTION 'Advocate provisioning replay does not match the committed request'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_existing.advocate_id,
      v_existing.resulting_advocate_version,
      v_existing.domain_id,
      v_existing.hostname,
      v_existing.job_ids;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit.advocate_portal_provisioning_starts start
    WHERE start.advocate_id = target_advocate_id
  ) THEN
    RAISE EXCEPTION 'Advocate provisioning already began with another request'
      USING ERRCODE = '40001';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate portal version changed before provisioning began'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN ('draft', 'failed') THEN
    RAISE EXCEPTION 'Advocate portal is not eligible to begin provisioning'
      USING ERRCODE = '55000';
  END IF;

  IF $6 = 'initial_owner_acceptance'
     AND NOT EXISTS (
       SELECT 1
       FROM public.advocate_invitations invitation
       JOIN audit.creator_share_advocate_onboarding_receipts receipt
         ON receipt.advocate_id = invitation.advocate_id
        AND receipt.provisioning_request_id = $3
       WHERE invitation.id = $7
         AND invitation.advocate_id = v_advocate.id
         AND invitation.invitation_kind = 'initial_owner'
         AND invitation.target_auth_user_id = $5
         AND invitation.accepted_at IS NULL
         AND invitation.revoked_at IS NULL
         AND private.advocate_initial_owner_invitation_is_authorized(
           v_advocate.id,
           invitation.id
         )
         AND EXISTS (
           SELECT 1
           FROM public.advocate_memberships owner_membership
           JOIN public.advocate_membership_roles owner_role
             ON owner_role.membership_id = owner_membership.id
            AND owner_role.advocate_id = owner_membership.advocate_id
           WHERE owner_membership.id = v_advocate.owner_membership_id
             AND owner_membership.advocate_id = v_advocate.id
             AND owner_membership.user_id = $5
             AND owner_membership.status = 'active'
             AND owner_role.role_id =
               '00000000-0000-4000-8000-000000000001'::uuid
         )
         AND (
           SELECT count(*)
           FROM public.advocate_membership_roles owner_role
           WHERE owner_role.advocate_id = v_advocate.id
             AND owner_role.role_id =
               '00000000-0000-4000-8000-000000000001'::uuid
         ) = 1
     ) THEN
    RAISE EXCEPTION 'Initial-owner provisioning authority is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_hostname := v_advocate.slug || '.creatorshare.com';

  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = v_advocate.slug
  ) THEN
    RAISE EXCEPTION 'Advocate portal uses a reserved subdomain label'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
       OR domain.hostname = v_hostname
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_advocate.id
  ) OR EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
  ) THEN
    RAISE EXCEPTION 'Advocate provisioning requires an empty domain topology'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => CASE
      WHEN $6 = 'creator_share_admin'
        THEN 'creator_share_admin'::audit.audit_actor_type
      ELSE 'user'::audit.audit_actor_type
    END,
    context_actor_user_id => $5,
    context_effective_user_id => $5,
    context_tool => CASE
      WHEN $6 = 'creator_share_admin'
        THEN 'creator-share-admin-domains'
      ELSE 'advocate-initial-owner-acceptance'
    END,
    context_request_id => $3::text,
    context_trace_id => $4,
    context_reason => 'Atomically begin exact advocate portal provisioning',
    context_metadata => jsonb_build_object(
      'operation', 'start_provisioning',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'domain_hostname', v_hostname,
      'correlation_id', $4,
      'outcome', 'queued'
    )
  );

  INSERT INTO public.advocate_domains (
    id,
    advocate_id,
    hostname,
    is_primary
  )
  VALUES (
    v_domain_id,
    v_advocate.id,
    v_hostname,
    true
  );

  FOR v_provider IN
    SELECT expected.provider, expected.environment
    FROM (
      VALUES
        (1, 'cloudflare'::public.advocate_domain_integration_provider, 'production'::text),
        (2, 'vercel'::public.advocate_domain_integration_provider, 'production'::text),
        (3, 'stripe_us'::public.advocate_domain_integration_provider, 'live'::text),
        (4, 'stripe_uk'::public.advocate_domain_integration_provider, 'live'::text),
        (5, 'paypal'::public.advocate_domain_integration_provider, 'live'::text)
    ) AS expected(ordinal, provider, environment)
    ORDER BY expected.ordinal
  LOOP
    INSERT INTO public.advocate_domain_integrations (
      advocate_id,
      domain_id,
      provider,
      environment,
      is_required
    )
    VALUES (
      v_advocate.id,
      v_domain_id,
      v_provider.provider,
      v_provider.environment,
      true
    )
    RETURNING id INTO v_integration_id;

    v_job_id := private.enqueue_domain_provisioning_job_internal(
      v_domain_id,
      v_integration_id,
      'provision',
      clock_timestamp()
    );
    v_job_ids := array_append(v_job_ids, v_job_id);
  END LOOP;

  UPDATE public.advocate_domains domain
  SET status = 'provisioning'
  WHERE domain.id = v_domain_id
    AND domain.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate primary domain changed while provisioning began'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.advocates advocate
  SET publication_status = 'provisioning'
  WHERE advocate.id = v_advocate.id
    AND advocate.version = $2
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status IN ('draft', 'failed')
  RETURNING advocate.version INTO v_resulting_version;

  IF NOT FOUND OR v_resulting_version <> $2 + 1 THEN
    RAISE EXCEPTION 'Advocate portal changed while provisioning began'
      USING ERRCODE = '40001';
  END IF;

  IF cardinality(v_job_ids) <> 5 THEN
    RAISE EXCEPTION 'Advocate provider topology did not produce five initial jobs'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO audit.advocate_portal_provisioning_starts (
    request_id,
    trace_id,
    initiating_user_id,
    initiator_kind,
    initial_owner_invitation_id,
    advocate_id,
    expected_advocate_version,
    resulting_advocate_version,
    domain_id,
    hostname,
    provider_topology_digest,
    job_ids
  )
  VALUES (
    $3,
    $4,
    $5,
    $6,
    $7,
    v_advocate.id,
    $2,
    v_resulting_version,
    v_domain_id,
    v_hostname,
    v_topology_digest,
    v_job_ids
  );

  RETURN QUERY SELECT
    v_advocate.id,
    v_resulting_version,
    v_domain_id,
    v_hostname,
    v_job_ids;
END;
$$;

REVOKE ALL ON FUNCTION private.start_advocate_portal_provisioning_internal(
  uuid,
  bigint,
  uuid,
  text,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.start_advocate_portal_provisioning(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  request_id uuid,
  trace_id text
)
RETURNS TABLE (
  advocate_id uuid,
  advocate_version bigint,
  domain_id uuid,
  hostname text,
  job_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
BEGIN
  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'start_advocate_provisioning'
  );

  IF target_advocate_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1
     OR request_id IS NULL
     OR trace_id IS NULL
     OR trace_id <> btrim(trace_id)
     OR char_length(trace_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Advocate provisioning start input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_advocate_id::text, 932741)
  );

  RETURN QUERY
  SELECT result.advocate_id,
    result.advocate_version,
    result.domain_id,
    result.hostname,
    result.job_ids
  FROM private.start_advocate_portal_provisioning_internal(
    target_advocate_id,
    expected_advocate_version,
    request_id,
    trace_id,
    v_actor_user_id,
    'creator_share_admin',
    NULL
  ) result;
END;
$$;

REVOKE ALL ON FUNCTION public.start_advocate_portal_provisioning(
  uuid,
  bigint,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_advocate_portal_provisioning(
  uuid,
  bigint,
  uuid,
  text
) TO authenticated;

COMMENT ON FUNCTION public.start_advocate_portal_provisioning(
  uuid,
  bigint,
  uuid,
  text
) IS
  'Authenticated healthy Creator Share super-administrator wrapper for the one shared atomic provider-topology implementation. Exact replay remains bound to the administrator, tenant, optimistic version, and request identity.';

CREATE OR REPLACE FUNCTION public.onboard_creator_share_advocate(
  onboarding_operation_id uuid,
  portal_slug text,
  portal_display_name text,
  portal_advocate_type text,
  owner_email text,
  capability_digest bytea,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  secret_payload_ciphertext bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  operation_id uuid,
  advocate_id uuid,
  advocate_version bigint,
  onboarding_status text,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_actor_user_id uuid;
  v_signed_session_id text;
  v_slug text := lower(btrim(portal_slug));
  v_display_name text := btrim(portal_display_name);
  v_advocate_type text := lower(btrim(portal_advocate_type));
  v_owner_email text := lower(btrim(owner_email));
  v_reason text := nullif(btrim(change_reason), '');
  v_fingerprint bytea;
  v_existing audit.creator_share_advocate_onboarding_receipts%ROWTYPE;
  v_advocate_id uuid := gen_random_uuid();
  v_invitation_id uuid := gen_random_uuid();
  v_outbox_id uuid := gen_random_uuid();
  v_provisioning_request_id uuid := gen_random_uuid();
  v_target_user_id uuid;
BEGIN
  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'onboard_advocate'
  );
  v_signed_session_id := private.require_signed_auth_session_id();

  IF onboarding_operation_id IS NULL
     OR onboarding_operation_id::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'A client-generated onboarding operation UUID is required'
      USING ERRCODE = '22023';
  END IF;

  IF session_id IS NOT NULL
     AND nullif(btrim(session_id), '') IS DISTINCT FROM v_signed_session_id THEN
    RAISE EXCEPTION 'Onboarding session context does not match the signed session'
      USING ERRCODE = '28000';
  END IF;

  IF v_slug IS NULL
     OR char_length(v_slug) NOT BETWEEN 1 AND 63
     OR v_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'A valid Creator Share subdomain label is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_display_name IS NULL
     OR char_length(v_display_name) NOT BETWEEN 1 AND 160
     OR v_display_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'An advocate display name between 1 and 160 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_advocate_type IS NULL
     OR v_advocate_type !~ '^[a-z][a-z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'A valid advocate type is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_owner_email IS NULL
     OR octet_length(v_owner_email) NOT BETWEEN 3 AND 254
     OR octet_length(split_part(v_owner_email, '@', 1)) > 64
     OR v_owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A valid initial owner email is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'An onboarding reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF request_id IS NULL
     OR request_id IS DISTINCT FROM onboarding_operation_id::text
     OR trace_id IS NULL
     OR trace_id IS DISTINCT FROM btrim(trace_id)
     OR char_length(trace_id) NOT BETWEEN 1 AND 255
     OR trace_id ~ '[[:cntrl:]]'
     OR (
       client_ip IS NOT NULL
       AND (
         octet_length(client_ip) NOT BETWEEN 1 AND 256
         OR client_ip ~ '[[:cntrl:]]'
       )
     )
     OR (
       user_agent IS NOT NULL
       AND (
         octet_length(user_agent) NOT BETWEEN 1 AND 1024
         OR user_agent ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Onboarding request context exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  v_fingerprint := extensions.digest(
    pg_catalog.convert_to(
      concat_ws(
        E'\n',
        'creator-share-advocate-onboarding-v1',
        v_actor_user_id::text,
        v_slug,
        v_display_name,
        v_advocate_type,
        v_reason
      ),
      'UTF8'
    ),
    'sha256'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      onboarding_operation_id::text,
      614233
    )
  );

  SELECT receipt.*
  INTO v_existing
  FROM audit.creator_share_advocate_onboarding_receipts receipt
  WHERE receipt.operation_id = onboarding_operation_id
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.initiating_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint
       OR NOT EXISTS (
         SELECT 1
         FROM public.advocates advocate
         JOIN public.advocate_invitations invitation
           ON invitation.id = v_existing.invitation_id
          AND invitation.advocate_id = advocate.id
         JOIN public.advocate_invitation_email_outbox outbox
           ON outbox.invitation_id = invitation.id
          AND outbox.advocate_id = advocate.id
         WHERE advocate.id = v_existing.advocate_id
           AND invitation.invitation_kind = 'initial_owner'
           AND invitation.email = v_owner_email
       ) THEN
      RAISE EXCEPTION 'Advocate onboarding operation was reused with different material'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_existing.operation_id,
      v_existing.advocate_id,
      v_existing.committed_advocate_version,
      v_existing.onboarding_status,
      false;
    RETURN;
  END IF;

  IF octet_length(capability_digest) <> 32
     OR octet_length(recipient_email_ciphertext) NOT BETWEEN 32 AND 4096
     OR octet_length(recipient_email_hmac) <> 32
     OR octet_length(secret_payload_ciphertext) NOT BETWEEN 32 AND 16384
     OR email_normalization_version NOT BETWEEN 1 AND 32767
     OR email_hmac_key_version NOT BETWEEN 1 AND 32767
     OR email_encryption_key_version NOT BETWEEN 1 AND 32767 THEN
    RAISE EXCEPTION 'Invalid encrypted initial-owner delivery material'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = v_slug
  ) THEN
    RAISE EXCEPTION 'Advocate subdomain label is reserved'
      USING ERRCODE = '23514';
  END IF;

  SELECT account.id
  INTO v_target_user_id
  FROM auth.users account
  WHERE lower(btrim(account.email)) = v_owner_email
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  ORDER BY account.created_at, account.id
  LIMIT 1
  FOR KEY SHARE;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_target_user_id,
    context_tool => 'creator-share-admin-advocates',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => v_signed_session_id,
    context_client_ip => NULLIF(client_ip, ''),
    context_user_agent => NULLIF(user_agent, ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'onboard_advocate',
      'resource_kind', 'advocate',
      'resource_id', v_advocate_id::text,
      'outcome', 'initial_owner_invitation_queued'
    )
  );

  INSERT INTO public.advocates (
    id,
    slug,
    display_name,
    advocate_type,
    relationship_status,
    publication_status,
    beneficiary_mode,
    created_by_user_id
  )
  VALUES (
    v_advocate_id,
    v_slug,
    v_display_name,
    v_advocate_type,
    'invited',
    'draft',
    'all',
    v_actor_user_id
  );

  INSERT INTO public.advocate_branding (advocate_id)
  VALUES (v_advocate_id);

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'issue',
    true
  );

  INSERT INTO public.advocate_invitations (
    id,
    advocate_id,
    invitation_kind,
    email,
    token_digest,
    expires_at,
    target_auth_user_id,
    created_by_user_id,
    created_at,
    last_sent_at,
    issuance_idempotency_key,
    issuance_fingerprint
  )
  VALUES (
    v_invitation_id,
    v_advocate_id,
    'initial_owner',
    v_owner_email,
    capability_digest,
    v_now + interval '7 days',
    v_target_user_id,
    v_actor_user_id,
    v_now,
    NULL,
    'initial-owner-onboarding:' || onboarding_operation_id::text,
    v_fingerprint
  );

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'issue',
    true
  );

  INSERT INTO public.advocate_invitation_email_outbox (
    id,
    advocate_id,
    invitation_id,
    recipient_email_ciphertext,
    recipient_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    email_encryption_key_version,
    secret_payload_ciphertext,
    secret_payload_ciphertext_sha256,
    template_key,
    template_data,
    provider_idempotency_key
  )
  VALUES (
    v_outbox_id,
    v_advocate_id,
    v_invitation_id,
    recipient_email_ciphertext,
    recipient_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    email_encryption_key_version,
    secret_payload_ciphertext,
    extensions.digest(secret_payload_ciphertext, 'sha256'),
    'advocate_initial_owner_invitation_v1',
    jsonb_build_object(
      'advocate_display_name', v_display_name,
      'invitation_id', v_invitation_id::text
    ),
    'advocate-invitation:' || v_outbox_id::text
  );

  INSERT INTO audit.creator_share_advocate_onboarding_receipts (
    operation_id,
    initiating_user_id,
    request_fingerprint,
    advocate_id,
    invitation_id,
    provisioning_request_id,
    committed_advocate_version,
    onboarding_status
  )
  VALUES (
    onboarding_operation_id,
    v_actor_user_id,
    v_fingerprint,
    v_advocate_id,
    v_invitation_id,
    v_provisioning_request_id,
    1,
    'initial_owner_invitation_queued'
  );

  RETURN QUERY SELECT
    onboarding_operation_id,
    v_advocate_id,
    1::bigint,
    'initial_owner_invitation_queued'::text,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.onboard_creator_share_advocate(
  uuid,
  text,
  text,
  text,
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.onboard_creator_share_advocate(
  uuid,
  text,
  text,
  text,
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.onboard_creator_share_advocate(
  uuid,
  text,
  text,
  text,
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Healthy Creator Share super-administrator boundary that atomically creates an ownerless invited tenant, default branding, one encrypted initial-owner invitation, and append-only semantic replay evidence. Provider topology is prohibited until successful initial-owner acceptance.';

CREATE OR REPLACE FUNCTION public.claim_advocate_invitation_email_jobs(
  worker_id text,
  batch_size integer DEFAULT 10,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  outbox_id uuid,
  invitation_id uuid,
  advocate_id uuid,
  lease_token text,
  lease_expires_at timestamp with time zone,
  target_auth_user_id uuid,
  template_key text,
  template_data jsonb,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  secret_payload_ciphertext bytea,
  capability_digest bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  provider_idempotency_key text,
  attempt_count smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF worker_id IS NULL
     OR worker_id <> btrim(worker_id)
     OR char_length(worker_id) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Worker identity must contain between 1 and 120 characters'
      USING ERRCODE = '22023';
  END IF;

  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invitation email claim batch size must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255 THEN
    RAISE EXCEPTION 'Invitation worker request identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => worker_id,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_reason => 'Redact invitation delivery envelopes that are no longer usable',
    context_metadata => jsonb_build_object(
      'operation', 'redact',
      'resource_kind', 'advocate_invitation_email_outbox'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'purge',
    true
  );

  WITH candidates AS MATERIALIZED (
    SELECT outbox.id
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE outbox.contact_redacted_at IS NULL
      AND (
        invitation.accepted_at IS NOT NULL
        OR invitation.revoked_at IS NOT NULL
        OR invitation.expires_at <= v_now
      )
    ORDER BY invitation.expires_at, outbox.id
    LIMIT 500
    FOR UPDATE OF outbox SKIP LOCKED
  )
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
  FROM candidates candidate
  WHERE outbox.id = candidate.id;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => worker_id,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_reason => 'Claim encrypted advocate invitation delivery envelopes',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'advocate_invitation_email_outbox',
      'outcome', 'claimed'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'claim',
    true
  );

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT outbox.id
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE private.advocate_invitation_delivery_is_eligible(invitation.id)
      AND outbox.contact_redacted_at IS NULL
      AND outbox.attempt_count < outbox.max_attempts
      AND (
        (
          outbox.status IN ('pending', 'failed')
          AND outbox.available_at <= v_now
        )
        OR
        (
          outbox.status = 'processing'
          AND outbox.delivery_started_at IS NULL
          AND outbox.locked_at <= v_now - interval '5 minutes'
        )
      )
    ORDER BY outbox.available_at, outbox.created_at, outbox.id
    LIMIT batch_size
    FOR UPDATE OF outbox SKIP LOCKED
  ), leases AS MATERIALIZED (
    SELECT
      candidate.id,
      encode(extensions.gen_random_bytes(32), 'hex') AS plaintext_token
    FROM candidates candidate
  ), claimed AS (
    UPDATE public.advocate_invitation_email_outbox outbox
    SET
      status = 'processing',
      attempt_count = outbox.attempt_count + 1,
      locked_at = v_now,
      locked_by = worker_id,
      locked_lease_token_digest = extensions.digest(
        lease.plaintext_token,
        'sha256'
      ),
      delivery_started_at = NULL,
      provider_message_id = NULL,
      sent_at = NULL,
      last_error_code = NULL,
      cancelled_at = NULL
    FROM leases lease
    WHERE outbox.id = lease.id
    RETURNING outbox.*
  )
  SELECT
    claimed.id,
    claimed.invitation_id,
    claimed.advocate_id,
    lease.plaintext_token,
    claimed.locked_at + interval '5 minutes',
    invitation.target_auth_user_id,
    claimed.template_key,
    claimed.template_data,
    claimed.recipient_email_ciphertext,
    claimed.recipient_email_hmac,
    claimed.secret_payload_ciphertext,
    invitation.token_digest,
    claimed.email_normalization_version,
    claimed.email_hmac_key_version,
    claimed.email_encryption_key_version,
    claimed.provider_idempotency_key,
    claimed.attempt_count
  FROM claimed
  JOIN leases lease ON lease.id = claimed.id
  JOIN public.advocate_invitations invitation
    ON invitation.id = claimed.invitation_id
   AND invitation.advocate_id = claimed.advocate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_advocate_invitation_email_delivery(
  target_outbox_id uuid,
  lease_token text,
  verified_recipient_email_hmac bytea,
  verified_capability_digest bytea,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_advocate_id uuid;
  v_outbox public.advocate_invitation_email_outbox%ROWTYPE;
  v_invitation public.advocate_invitations%ROWTYPE;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR octet_length(verified_recipient_email_hmac) <> 32
     OR octet_length(verified_capability_digest) <> 32 THEN
    RAISE EXCEPTION 'Invitation delivery proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT outbox.advocate_id
  INTO v_advocate_id
  FROM public.advocate_invitation_email_outbox outbox
  WHERE outbox.id = target_outbox_id;

  PERFORM 1
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation delivery lease is unavailable'
      USING ERRCODE = '55P03';
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.advocate_invitation_email_outbox outbox
  WHERE outbox.id = target_outbox_id
  FOR UPDATE;

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.id = v_outbox.invitation_id
    AND invitation.advocate_id = v_outbox.advocate_id
  FOR UPDATE;

  IF v_outbox.status <> 'processing'
     OR v_outbox.locked_at <= v_now - interval '5 minutes'
     OR v_outbox.delivery_started_at IS NOT NULL
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       extensions.digest(lease_token, 'sha256')
     OR v_outbox.recipient_email_hmac IS DISTINCT FROM
       verified_recipient_email_hmac
     OR v_invitation.token_digest IS DISTINCT FROM
       verified_capability_digest
     OR v_invitation.target_auth_user_id IS NULL
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= v_now
     OR NOT private.advocate_invitation_delivery_is_eligible(v_invitation.id) THEN
    RAISE EXCEPTION 'Invitation delivery proof does not match the active lease'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = v_invitation.target_auth_user_id
    AND lower(btrim(account.email)) = v_invitation.email
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation target account is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_effective_user_id => v_invitation.target_auth_user_id,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_reason => 'Fence advocate invitation provider delivery',
    context_metadata => jsonb_build_object(
      'operation', 'begin_delivery',
      'resource_kind', 'advocate_invitation_email_outbox',
      'resource_id', v_outbox.id::text,
      'outcome', 'started'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'begin_delivery',
    true
  );

  UPDATE public.advocate_invitation_email_outbox outbox
  SET delivery_started_at = v_now
  WHERE outbox.id = v_outbox.id;

  RETURN v_outbox.provider_idempotency_key;
END;
$$;

ALTER FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) RENAME TO redeem_advocate_delegate_invitation_legacy;

REVOKE ALL ON FUNCTION public.redeem_advocate_delegate_invitation_legacy(
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
  v_magiclink_authenticated_at_epoch bigint;
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
    INTO v_magiclink_authenticated_at_epoch
    FROM jsonb_array_elements(v_claims -> 'amr') AS authentication_method(entry)
    WHERE authentication_method.entry ->> 'method' = 'magiclink'
      AND authentication_method.entry ->> 'timestamp' ~ '^[0-9]{1,12}$';
  END IF;

  IF v_issued_at_epoch IS NULL
     OR v_session_claim IS NULL
     OR char_length(v_session_claim) > 255
     OR v_aal NOT IN ('aal1', 'aal2')
     OR v_issued_at_epoch > extract(epoch FROM v_now)::bigint + 60
     OR v_magiclink_authenticated_at_epoch IS NULL
     OR v_magiclink_authenticated_at_epoch >
       extract(epoch FROM v_now)::bigint + 60
     OR v_magiclink_authenticated_at_epoch <
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

REVOKE ALL ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Kind-aware single-use invitation redemption. Delegate behavior is preserved, while initial-owner acceptance atomically creates the sole Owner membership, activates the tenant, creates the exact five-provider topology through the shared private implementation, consumes the capability, and redacts its delivery material.';

CREATE OR REPLACE FUNCTION public.revoke_advocate_initial_owner_invitation(
  revocation_operation_id uuid,
  target_advocate_id uuid,
  expected_advocate_version bigint,
  change_reason text,
  request_id text,
  trace_id text,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  operation_id uuid,
  advocate_id uuid,
  advocate_version bigint,
  revocation_status text,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_actor_user_id uuid;
  v_signed_session_id text;
  v_reason text := nullif(btrim(change_reason), '');
  v_fingerprint bytea;
  v_existing audit.creator_share_advocate_initial_owner_revocation_receipts%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_invitation public.advocate_invitations%ROWTYPE;
  v_outbox public.advocate_invitation_email_outbox%ROWTYPE;
  v_resulting_advocate_version bigint;
BEGIN
  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'revoke_initial_owner_invitation'
  );
  v_signed_session_id := private.require_signed_auth_session_id();

  IF revocation_operation_id IS NULL
     OR revocation_operation_id::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR target_advocate_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1
     OR v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]'
     OR request_id IS DISTINCT FROM revocation_operation_id::text
     OR trace_id IS NULL
     OR trace_id IS DISTINCT FROM btrim(trace_id)
     OR char_length(trace_id) NOT BETWEEN 1 AND 255
     OR trace_id ~ '[[:cntrl:]]'
     OR (
       client_ip IS NOT NULL
       AND (
         octet_length(client_ip) NOT BETWEEN 1 AND 256
         OR client_ip ~ '[[:cntrl:]]'
       )
     )
     OR (
       user_agent IS NOT NULL
       AND (
         octet_length(user_agent) NOT BETWEEN 1 AND 1024
         OR user_agent ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Initial-owner revocation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF session_id IS NOT NULL
     AND nullif(btrim(session_id), '') IS DISTINCT FROM v_signed_session_id THEN
    RAISE EXCEPTION 'Revocation session context does not match the signed session'
      USING ERRCODE = '28000';
  END IF;

  v_fingerprint := extensions.digest(
    pg_catalog.convert_to(
      concat_ws(
        E'\n',
        'creator-share-initial-owner-revocation-v1',
        v_actor_user_id::text,
        target_advocate_id::text,
        expected_advocate_version::text,
        v_reason
      ),
      'UTF8'
    ),
    'sha256'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(revocation_operation_id::text, 614241)
  );

  SELECT receipt.*
  INTO v_existing
  FROM audit.creator_share_advocate_initial_owner_revocation_receipts receipt
  WHERE receipt.operation_id = revocation_operation_id
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.initiating_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing.advocate_id IS DISTINCT FROM target_advocate_id
       OR v_existing.expected_advocate_version IS DISTINCT FROM
          expected_advocate_version
       OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint
       OR NOT EXISTS (
         SELECT 1
         FROM public.advocate_invitations invitation
         WHERE invitation.id = v_existing.invitation_id
           AND invitation.advocate_id = v_existing.advocate_id
           AND invitation.invitation_kind = 'initial_owner'
           AND invitation.revoked_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Initial-owner revocation operation was reused with different material'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_existing.operation_id,
      v_existing.advocate_id,
      v_existing.resulting_advocate_version,
      'initial_owner_invitation_revoked'::text,
      false;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_advocate_id::text, 932741)
  );

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_advocate.version IS DISTINCT FROM expected_advocate_version
     OR v_advocate.relationship_status <> 'invited'
     OR v_advocate.publication_status <> 'draft'
     OR v_advocate.owner_membership_id IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.advocate_domains domain
       WHERE domain.advocate_id = v_advocate.id
     )
     OR EXISTS (
       SELECT 1
       FROM public.advocate_domain_integrations integration
       WHERE integration.advocate_id = v_advocate.id
     )
     OR EXISTS (
       SELECT 1
       FROM public.domain_provisioning_jobs job
       WHERE job.advocate_id = v_advocate.id
     ) THEN
    RAISE EXCEPTION 'Advocate is not eligible for initial-owner revocation'
      USING ERRCODE = '55000';
  END IF;

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.advocate_id = v_advocate.id
    AND invitation.invitation_kind = 'initial_owner'
  ORDER BY invitation.created_at DESC, invitation.id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR NOT private.advocate_initial_owner_invitation_is_authorized(
       v_advocate.id,
       v_invitation.id
     ) THEN
    RAISE EXCEPTION 'Initial-owner invitation is not eligible for revocation'
      USING ERRCODE = '55000';
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.advocate_invitation_email_outbox outbox
  WHERE outbox.invitation_id = v_invitation.id
    AND outbox.advocate_id = v_invitation.advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Initial-owner invitation delivery evidence is unavailable'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_invitation.target_auth_user_id,
    context_tool => 'creator-share-admin-advocates',
    context_request_id => request_id,
    context_trace_id => trace_id,
    context_session_id => v_signed_session_id,
    context_client_ip => client_ip,
    context_user_agent => user_agent,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'revoke_initial_owner_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', v_invitation.id::text,
      'outcome', 'revoked'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'revoke',
    true
  );

  UPDATE public.advocate_invitations invitation
  SET
    revoked_at = v_now,
    revoked_by_user_id = v_actor_user_id
  WHERE invitation.id = v_invitation.id;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_invitation.target_auth_user_id,
    context_tool => 'creator-share-admin-advocates',
    context_request_id => request_id,
    context_trace_id => trace_id,
    context_session_id => v_signed_session_id,
    context_client_ip => client_ip,
    context_user_agent => user_agent,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'revoke_initial_owner_invitation',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'outcome', 'revoked'
    )
  );

  UPDATE public.advocates advocate
  SET owner_onboarding_revision = advocate.owner_onboarding_revision + 1
  WHERE advocate.id = v_advocate.id
    AND advocate.version = expected_advocate_version
    AND advocate.relationship_status = 'invited'
    AND advocate.publication_status = 'draft'
    AND advocate.owner_membership_id IS NULL
  RETURNING advocate.version INTO v_resulting_advocate_version;

  IF NOT FOUND
     OR v_resulting_advocate_version <> expected_advocate_version + 1 THEN
    RAISE EXCEPTION 'Advocate changed during initial-owner revocation'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO audit.creator_share_advocate_initial_owner_revocation_receipts (
    operation_id,
    initiating_user_id,
    request_fingerprint,
    advocate_id,
    invitation_id,
    expected_advocate_version,
    resulting_advocate_version
  )
  VALUES (
    revocation_operation_id,
    v_actor_user_id,
    v_fingerprint,
    v_advocate.id,
    v_invitation.id,
    expected_advocate_version,
    v_resulting_advocate_version
  );

  RETURN QUERY SELECT
    revocation_operation_id,
    v_advocate.id,
    v_resulting_advocate_version,
    'initial_owner_invitation_revoked'::text,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_advocate_initial_owner_invitation(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_advocate_initial_owner_invitation(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.revoke_advocate_initial_owner_invitation(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Healthy Creator Share super-administrator exact-replay revocation for the current unaccepted initial-owner capability. It atomically invalidates and redacts even a sent or ambiguous delivery before advancing the tenant recovery version.';

CREATE OR REPLACE FUNCTION public.reissue_advocate_initial_owner_invitation(
  reissue_operation_id uuid,
  target_advocate_id uuid,
  expected_advocate_version bigint,
  owner_email text,
  capability_digest bytea,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  secret_payload_ciphertext bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  change_reason text,
  request_id text,
  trace_id text,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  operation_id uuid,
  advocate_id uuid,
  advocate_version bigint,
  onboarding_status text,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_actor_user_id uuid;
  v_signed_session_id text;
  v_reason text := nullif(btrim(change_reason), '');
  v_owner_email text := lower(btrim(owner_email));
  v_fingerprint bytea;
  v_existing audit.creator_share_advocate_initial_owner_reissue_receipts%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_prior_invitation public.advocate_invitations%ROWTYPE;
  v_prior_outbox public.advocate_invitation_email_outbox%ROWTYPE;
  v_invitation_id uuid := gen_random_uuid();
  v_outbox_id uuid := gen_random_uuid();
  v_target_user_id uuid;
  v_safe_terminal boolean := false;
  v_resulting_advocate_version bigint;
BEGIN
  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'reissue_initial_owner_invitation'
  );
  v_signed_session_id := private.require_signed_auth_session_id();

  IF reissue_operation_id IS NULL
     OR reissue_operation_id::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR target_advocate_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'Initial-owner reissue identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF session_id IS NOT NULL
     AND nullif(btrim(session_id), '') IS DISTINCT FROM v_signed_session_id THEN
    RAISE EXCEPTION 'Reissue session context does not match the signed session'
      USING ERRCODE = '28000';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]'
     OR request_id IS DISTINCT FROM reissue_operation_id::text
     OR trace_id IS NULL
     OR trace_id IS DISTINCT FROM btrim(trace_id)
     OR char_length(trace_id) NOT BETWEEN 1 AND 255
     OR trace_id ~ '[[:cntrl:]]'
     OR (
       client_ip IS NOT NULL
       AND (
         octet_length(client_ip) NOT BETWEEN 1 AND 256
         OR client_ip ~ '[[:cntrl:]]'
       )
     )
     OR (
       user_agent IS NOT NULL
       AND (
         octet_length(user_agent) NOT BETWEEN 1 AND 1024
     OR user_agent ~ '[[:cntrl:]]'
       )
     )
     OR v_owner_email IS NULL
     OR octet_length(v_owner_email) NOT BETWEEN 3 AND 254
     OR octet_length(split_part(v_owner_email, '@', 1)) > 64
     OR v_owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     THEN
    RAISE EXCEPTION 'Initial-owner reissue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_fingerprint := extensions.digest(
    pg_catalog.convert_to(
      concat_ws(
        E'\n',
        'creator-share-initial-owner-reissue-v1',
        v_actor_user_id::text,
        target_advocate_id::text,
        expected_advocate_version::text,
        v_reason
      ),
      'UTF8'
    ),
    'sha256'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(reissue_operation_id::text, 614239)
  );

  SELECT receipt.*
  INTO v_existing
  FROM audit.creator_share_advocate_initial_owner_reissue_receipts receipt
  WHERE receipt.operation_id = reissue_operation_id
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.initiating_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing.advocate_id IS DISTINCT FROM target_advocate_id
       OR v_existing.expected_advocate_version IS DISTINCT FROM
          expected_advocate_version
       OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint
       OR NOT EXISTS (
         SELECT 1
         FROM public.advocate_invitations invitation
         JOIN public.advocate_invitation_email_outbox outbox
           ON outbox.invitation_id = invitation.id
          AND outbox.advocate_id = invitation.advocate_id
         WHERE invitation.id = v_existing.invitation_id
           AND invitation.advocate_id = v_existing.advocate_id
           AND invitation.invitation_kind = 'initial_owner'
           AND invitation.email = v_owner_email
       ) THEN
      RAISE EXCEPTION 'Initial-owner reissue operation was reused with different material'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_existing.operation_id,
      v_existing.advocate_id,
      v_existing.resulting_advocate_version,
      'initial_owner_invitation_requeued'::text,
      false;
    RETURN;
  END IF;

  IF octet_length(capability_digest) <> 32
     OR octet_length(recipient_email_ciphertext) NOT BETWEEN 32 AND 4096
     OR octet_length(recipient_email_hmac) <> 32
     OR octet_length(secret_payload_ciphertext) NOT BETWEEN 32 AND 16384
     OR email_normalization_version NOT BETWEEN 1 AND 32767
     OR email_hmac_key_version NOT BETWEEN 1 AND 32767
     OR email_encryption_key_version NOT BETWEEN 1 AND 32767 THEN
    RAISE EXCEPTION 'Invalid encrypted initial-owner delivery material'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_advocate_id::text, 932741)
  );

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_advocate.version IS DISTINCT FROM expected_advocate_version
     OR v_advocate.relationship_status <> 'invited'
     OR v_advocate.publication_status <> 'draft'
     OR v_advocate.owner_membership_id IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.advocate_domains domain
       WHERE domain.advocate_id = v_advocate.id
     )
     OR EXISTS (
       SELECT 1
       FROM public.advocate_domain_integrations integration
       WHERE integration.advocate_id = v_advocate.id
     )
     OR EXISTS (
       SELECT 1
       FROM public.domain_provisioning_jobs job
       WHERE job.advocate_id = v_advocate.id
     ) THEN
    RAISE EXCEPTION 'Advocate is not eligible for initial-owner reissue'
      USING ERRCODE = '55000';
  END IF;

  SELECT invitation.*
  INTO v_prior_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.advocate_id = v_advocate.id
    AND invitation.invitation_kind = 'initial_owner'
  ORDER BY invitation.created_at DESC, invitation.id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_prior_invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Initial-owner invitation is not eligible for reissue'
      USING ERRCODE = '55000';
  END IF;

  IF v_prior_invitation.email IS DISTINCT FROM v_owner_email THEN
    RAISE EXCEPTION 'Initial-owner reissue email does not match reserved authority'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.advocate_initial_owner_invitation_is_authorized(
    v_advocate.id,
    v_prior_invitation.id
  ) THEN
    RAISE EXCEPTION 'Initial-owner invitation authority chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT outbox.*
  INTO v_prior_outbox
  FROM public.advocate_invitation_email_outbox outbox
  WHERE outbox.invitation_id = v_prior_invitation.id
    AND outbox.advocate_id = v_prior_invitation.advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Initial-owner invitation delivery evidence is unavailable'
      USING ERRCODE = '23514';
  END IF;

  v_safe_terminal :=
    v_prior_invitation.revoked_at IS NOT NULL
    OR v_prior_invitation.expires_at <= v_now
    OR (
      v_prior_outbox.status = 'failed'
      AND v_prior_outbox.delivery_started_at IS NULL
      AND (
        v_prior_outbox.attempt_count >= v_prior_outbox.max_attempts
        OR v_prior_outbox.available_at >= v_prior_invitation.expires_at
        OR v_prior_outbox.last_error_code =
          'invitation_email_material_invalid'
      )
    );

  IF NOT v_safe_terminal
     OR (
       v_prior_outbox.delivery_started_at IS NOT NULL
       AND v_prior_invitation.revoked_at IS NULL
       AND v_prior_invitation.expires_at > v_now
     ) THEN
    RAISE EXCEPTION 'Initial-owner invitation delivery is not safely terminal'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_prior_invitation.target_auth_user_id,
    context_tool => 'creator-share-admin-advocates',
    context_request_id => request_id,
    context_trace_id => trace_id,
    context_session_id => v_signed_session_id,
    context_client_ip => client_ip,
    context_user_agent => user_agent,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'reissue_initial_owner_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', v_prior_invitation.id::text,
      'outcome', 'requeued'
    )
  );

  IF v_prior_invitation.revoked_at IS NULL THEN
    PERFORM pg_catalog.set_config(
      'app.advocate.invitation_operation',
      'revoke',
      true
    );

    UPDATE public.advocate_invitations invitation
    SET
      revoked_at = v_now,
      revoked_by_user_id = v_actor_user_id
    WHERE invitation.id = v_prior_invitation.id;
  END IF;

  SELECT account.id
  INTO v_target_user_id
  FROM auth.users account
  WHERE lower(btrim(account.email)) = v_prior_invitation.email
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  ORDER BY account.created_at, account.id
  LIMIT 1
  FOR KEY SHARE;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'issue',
    true
  );

  INSERT INTO public.advocate_invitations (
    id,
    advocate_id,
    invitation_kind,
    email,
    token_digest,
    expires_at,
    target_auth_user_id,
    created_by_user_id,
    created_at,
    last_sent_at,
    issuance_idempotency_key,
    issuance_fingerprint
  )
  VALUES (
    v_invitation_id,
    v_advocate.id,
    'initial_owner',
    v_prior_invitation.email,
    capability_digest,
    v_now + interval '7 days',
    v_target_user_id,
    v_actor_user_id,
    v_now,
    NULL,
    'initial-owner-reissue:' || reissue_operation_id::text,
    v_fingerprint
  );

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'issue',
    true
  );

  INSERT INTO public.advocate_invitation_email_outbox (
    id,
    advocate_id,
    invitation_id,
    recipient_email_ciphertext,
    recipient_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    email_encryption_key_version,
    secret_payload_ciphertext,
    secret_payload_ciphertext_sha256,
    template_key,
    template_data,
    provider_idempotency_key
  )
  VALUES (
    v_outbox_id,
    v_advocate.id,
    v_invitation_id,
    recipient_email_ciphertext,
    recipient_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    email_encryption_key_version,
    secret_payload_ciphertext,
    extensions.digest(secret_payload_ciphertext, 'sha256'),
    'advocate_initial_owner_invitation_v1',
    jsonb_build_object(
      'advocate_display_name', v_advocate.display_name,
      'invitation_id', v_invitation_id::text
    ),
    'advocate-invitation:' || v_outbox_id::text
  );

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_target_user_id,
    context_tool => 'creator-share-admin-advocates',
    context_request_id => request_id,
    context_trace_id => trace_id,
    context_session_id => v_signed_session_id,
    context_client_ip => client_ip,
    context_user_agent => user_agent,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'reissue_initial_owner_invitation',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'outcome', 'requeued'
    )
  );

  UPDATE public.advocates advocate
  SET owner_onboarding_revision = advocate.owner_onboarding_revision + 1
  WHERE advocate.id = v_advocate.id
    AND advocate.version = expected_advocate_version
    AND advocate.relationship_status = 'invited'
    AND advocate.publication_status = 'draft'
    AND advocate.owner_membership_id IS NULL
  RETURNING advocate.version INTO v_resulting_advocate_version;

  IF NOT FOUND
     OR v_resulting_advocate_version <> expected_advocate_version + 1 THEN
    RAISE EXCEPTION 'Advocate changed during initial-owner reissue'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO audit.creator_share_advocate_initial_owner_reissue_receipts (
    operation_id,
    initiating_user_id,
    request_fingerprint,
    advocate_id,
    prior_invitation_id,
    invitation_id,
    expected_advocate_version,
    resulting_advocate_version
  )
  VALUES (
    reissue_operation_id,
    v_actor_user_id,
    v_fingerprint,
    v_advocate.id,
    v_prior_invitation.id,
    v_invitation_id,
    v_advocate.version,
    v_resulting_advocate_version
  );

  RETURN QUERY SELECT
    reissue_operation_id,
    v_advocate.id,
    v_resulting_advocate_version,
    'initial_owner_invitation_requeued'::text,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.reissue_advocate_initial_owner_invitation(
  uuid,
  uuid,
  bigint,
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reissue_advocate_initial_owner_invitation(
  uuid,
  uuid,
  bigint,
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.reissue_advocate_initial_owner_invitation(
  uuid,
  uuid,
  bigint,
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Healthy Creator Share super-administrator exact-replay boundary for replacing an expired, explicitly revoked, or proven terminal non-delivery initial-owner invitation. Live pending, retryable, sent, and ambiguous provider handoffs cannot be replaced.';

CREATE OR REPLACE FUNCTION audit.capture_initial_owner_onboarding_delegate_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_key text;
  v_actor_kind text;
  v_actor_display_name text;
  v_areas text[];
BEGIN
  IF NEW.advocate_id IS NULL
     OR NEW.schema_name <> 'public'
     OR NEW.occurred_at <= '-infinity'::timestamp with time zone
     OR NEW.occurred_at >= 'infinity'::timestamp with time zone THEN
    RETURN NULL;
  END IF;

  IF NEW.table_name = 'advocates'
     AND NEW.operation = 'INSERT'::audit.audit_operation
     AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
     AND NEW.actor_user_id IS NOT NULL
     AND NEW.tool = 'creator-share-admin-advocates'
     AND NEW.metadata ->> 'operation' = 'onboard_advocate'
     AND NEW.metadata ->> 'resource_kind' = 'advocate'
     AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
     AND NEW.metadata ->> 'outcome' = 'initial_owner_invitation_queued'
     AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
     AND audit.json_object_has_exact_keys(
       NEW.metadata,
       ARRAY[
         'operation',
         'outcome',
         'resource_id',
         'resource_kind'
       ]::text[]
     ) THEN
    v_event_key := 'portal.created';
    v_actor_kind := 'creator_share_staff';
    v_actor_display_name := 'Creator Share staff';
    v_areas := ARRAY[
      'ownership',
      'portal_lifecycle',
      'portal_profile'
    ]::text[];
  ELSIF NEW.table_name = 'advocates'
     AND NEW.operation = 'UPDATE'::audit.audit_operation
     AND NEW.actor_type = 'user'::audit.audit_actor_type
     AND NEW.actor_user_id IS NOT NULL
     AND NEW.tool = 'advocate-initial-owner-acceptance'
     AND NEW.metadata ->> 'operation' = 'start_provisioning'
     AND NEW.metadata ->> 'resource_kind' = 'advocate'
     AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
     AND NEW.metadata ->> 'outcome' = 'queued'
     AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
     AND audit.json_object_has_exact_keys(
       NEW.metadata,
       ARRAY[
         'correlation_id',
         'domain_hostname',
         'operation',
         'outcome',
         'resource_id',
         'resource_kind'
       ]::text[]
     ) THEN
    v_event_key := 'domain.provisioning.requested';
    v_actor_kind := 'portal_member';
    v_actor_display_name :=
      audit.safe_advocate_delegate_actor_display(NEW.actor_user_id);
    v_areas := ARRAY[
      'dns',
      'payment_readiness',
      'provider_readiness',
      'tls'
    ]::text[];
  ELSIF NEW.table_name = 'advocates'
     AND NEW.operation = 'UPDATE'::audit.audit_operation
     AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
     AND NEW.actor_user_id IS NOT NULL
     AND NEW.tool = 'creator-share-admin-advocates'
     AND NEW.metadata ->> 'operation' = 'reissue_initial_owner_invitation'
     AND NEW.metadata ->> 'resource_kind' = 'advocate'
     AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
     AND NEW.metadata ->> 'outcome' = 'requeued'
     AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
     AND audit.json_object_has_exact_keys(
       NEW.metadata,
       ARRAY[
         'operation',
         'outcome',
         'resource_id',
         'resource_kind'
       ]::text[]
     ) THEN
    v_event_key := 'team.invitation.issued';
    v_actor_kind := 'creator_share_staff';
    v_actor_display_name := 'Creator Share staff';
    v_areas := ARRAY['invitation']::text[];
  ELSIF NEW.table_name = 'advocates'
     AND NEW.operation = 'UPDATE'::audit.audit_operation
     AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
     AND NEW.actor_user_id IS NOT NULL
     AND NEW.tool = 'creator-share-admin-advocates'
     AND NEW.metadata ->> 'operation' = 'revoke_initial_owner_invitation'
     AND NEW.metadata ->> 'resource_kind' = 'advocate'
     AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
     AND NEW.metadata ->> 'outcome' = 'revoked'
     AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
     AND audit.json_object_has_exact_keys(
       NEW.metadata,
       ARRAY[
         'operation',
         'outcome',
         'resource_id',
         'resource_kind'
       ]::text[]
     ) THEN
    v_event_key := 'team.invitation.revoked';
    v_actor_kind := 'creator_share_staff';
    v_actor_display_name := 'Creator Share staff';
    v_areas := ARRAY['invitation']::text[];
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO audit.advocate_delegate_events (
    advocate_id,
    occurred_at,
    disclosure_policy_version,
    event_key,
    actor_kind,
    actor_display_name,
    areas,
    source_transaction_id,
    source_audit_sequence
  )
  VALUES (
    NEW.advocate_id,
    date_trunc('second', NEW.occurred_at),
    1,
    v_event_key,
    v_actor_kind,
    v_actor_display_name,
    v_areas,
    NEW.transaction_id,
    NEW.sequence_id
  )
  ON CONFLICT (advocate_id, source_transaction_id, event_key) DO NOTHING;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION audit.capture_initial_owner_onboarding_delegate_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER audit_events_capture_initial_owner_onboarding_delegate_event
AFTER INSERT ON audit.audit_events
FOR EACH ROW
EXECUTE FUNCTION audit.capture_initial_owner_onboarding_delegate_event();

ALTER TABLE private.advocate_lifecycle_mutation_guards
  DROP CONSTRAINT advocate_lifecycle_mutation_guards_operation_check,
  ADD CONSTRAINT advocate_lifecycle_mutation_guards_operation_check CHECK (
    operation IN ('repair', 'archive')
  );

ALTER FUNCTION public.apply_creator_share_advocate_lifecycle_action(
  uuid,
  bigint,
  public.creator_share_advocate_lifecycle_action,
  text,
  uuid,
  text,
  text,
  text
) RENAME TO apply_creator_share_advocate_lifecycle_action_legacy;

REVOKE ALL ON FUNCTION
  public.apply_creator_share_advocate_lifecycle_action_legacy(
    uuid,
    bigint,
    public.creator_share_advocate_lifecycle_action,
    text,
    uuid,
    text,
    text,
    text
  ) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_creator_share_advocate_lifecycle_action(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  target_action public.creator_share_advocate_lifecycle_action,
  change_reason text,
  request_id uuid,
  trace_id text,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  advocate_id uuid,
  advocate_version bigint,
  relationship_status public.advocate_relationship_status,
  publication_status public.advocate_publication_status,
  domain_cleanup_requested boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_archive_guarded boolean :=
    target_action = 'archive' AND target_advocate_id IS NOT NULL;
BEGIN
  IF v_archive_guarded THEN
    INSERT INTO private.advocate_lifecycle_mutation_guards (
      transaction_id,
      advocate_id,
      operation
    )
    VALUES (
      txid_current(),
      target_advocate_id,
      'archive'
    );
  END IF;

  RETURN QUERY
  SELECT
    lifecycle.advocate_id,
    lifecycle.advocate_version,
    lifecycle.relationship_status,
    lifecycle.publication_status,
    lifecycle.domain_cleanup_requested
  FROM public.apply_creator_share_advocate_lifecycle_action_legacy(
    target_advocate_id,
    expected_advocate_version,
    target_action,
    change_reason,
    request_id,
    trace_id,
    client_ip,
    user_agent
  ) lifecycle;

  IF v_archive_guarded THEN
    DELETE FROM private.advocate_lifecycle_mutation_guards mutation_guard
    WHERE mutation_guard.transaction_id = txid_current()
      AND mutation_guard.advocate_id = target_advocate_id
      AND mutation_guard.operation = 'archive';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ownerless advocate archive guard changed during execution'
        USING ERRCODE = '40001';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_creator_share_advocate_lifecycle_action(
  uuid,
  bigint,
  public.creator_share_advocate_lifecycle_action,
  text,
  uuid,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_creator_share_advocate_lifecycle_action(
  uuid,
  bigint,
  public.creator_share_advocate_lifecycle_action,
  text,
  uuid,
  text,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.apply_creator_share_advocate_lifecycle_action(
  uuid,
  bigint,
  public.creator_share_advocate_lifecycle_action,
  text,
  uuid,
  text,
  text,
  text
) IS
  'Creator Share lifecycle wrapper that installs an unforgeable transaction-bound archive guard before delegating to the preserved exact-replay implementation.';

CREATE OR REPLACE FUNCTION private.enforce_ownerless_advocate_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM audit.creator_share_advocate_onboarding_receipts receipt
       WHERE receipt.advocate_id = NEW.id
     )
     AND NEW.owner_membership_id IS NULL
     AND NOT (
       (
         NEW.relationship_status = 'invited'
         AND NEW.publication_status = 'draft'
       )
       OR (
         NEW.relationship_status = 'archived'
         AND NEW.publication_status = 'suspended'
       )
     ) THEN
    RAISE EXCEPTION 'Ownerless advocate lifecycle transition is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM audit.creator_share_advocate_onboarding_receipts receipt
       WHERE receipt.advocate_id = NEW.id
     )
     AND OLD.owner_membership_id IS NULL
     AND NEW.owner_membership_id IS NULL
     AND OLD.relationship_status = 'invited'
     AND OLD.publication_status = 'draft'
     AND NEW.relationship_status = 'archived'
     AND NEW.publication_status = 'suspended'
     AND NOT EXISTS (
       SELECT 1
       FROM private.advocate_lifecycle_mutation_guards mutation_guard
       WHERE mutation_guard.transaction_id = txid_current()
         AND mutation_guard.advocate_id = NEW.id
         AND mutation_guard.operation = 'archive'
     ) THEN
    RAISE EXCEPTION 'Ownerless advocate archive requires the lifecycle boundary'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM audit.creator_share_advocate_onboarding_receipts receipt
       WHERE receipt.advocate_id = NEW.id
     )
     AND OLD.owner_membership_id IS NULL
     AND NEW.owner_membership_id IS NULL
     AND OLD.relationship_status = 'archived'
     AND OLD.publication_status = 'suspended'
     AND (
       NEW.relationship_status <> 'archived'
       OR NEW.publication_status <> 'suspended'
     ) THEN
    RAISE EXCEPTION 'Archived ownerless advocate lifecycle is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_ownerless_advocate_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocates_ownerless_lifecycle_guard
BEFORE UPDATE ON public.advocates
FOR EACH ROW
EXECUTE FUNCTION private.enforce_ownerless_advocate_lifecycle();

CREATE OR REPLACE FUNCTION private.creator_share_advocate_owner_onboarding_state(
  target_advocate_id uuid
)
RETURNS TABLE (
  ownership_status text,
  can_reissue_initial_owner boolean,
  can_revoke_initial_owner boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE
      WHEN advocate.owner_membership_id IS NOT NULL
        THEN 'owner_active'
      WHEN advocate.relationship_status = 'invited'
       AND advocate.publication_status = 'draft'
        THEN 'awaiting_owner_acceptance'
      ELSE 'owner_unassigned'
    END,
    (
      advocate.owner_membership_id IS NULL
      AND advocate.relationship_status = 'invited'
      AND advocate.publication_status = 'draft'
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domains domain
        WHERE domain.advocate_id = advocate.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domain_integrations integration
        WHERE integration.advocate_id = advocate.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.domain_provisioning_jobs job
        WHERE job.advocate_id = advocate.id
      )
      AND latest_invitation.id IS NOT NULL
      AND private.advocate_initial_owner_invitation_is_authorized(
        advocate.id,
        latest_invitation.id
      )
      AND latest_invitation.accepted_at IS NULL
      AND latest_outbox.id IS NOT NULL
      AND (
        latest_invitation.revoked_at IS NOT NULL
        OR latest_invitation.expires_at <= statement_timestamp()
        OR (
          latest_outbox.status = 'failed'
          AND latest_outbox.delivery_started_at IS NULL
          AND (
            latest_outbox.attempt_count >= latest_outbox.max_attempts
            OR latest_outbox.available_at >= latest_invitation.expires_at
            OR latest_outbox.last_error_code =
              'invitation_email_material_invalid'
          )
        )
      )
      AND NOT (
        latest_outbox.delivery_started_at IS NOT NULL
        AND latest_invitation.revoked_at IS NULL
        AND latest_invitation.expires_at > statement_timestamp()
      )
    ),
    (
      advocate.owner_membership_id IS NULL
      AND advocate.relationship_status = 'invited'
      AND advocate.publication_status = 'draft'
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domains domain
        WHERE domain.advocate_id = advocate.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domain_integrations integration
        WHERE integration.advocate_id = advocate.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.domain_provisioning_jobs job
        WHERE job.advocate_id = advocate.id
      )
      AND latest_invitation.id IS NOT NULL
      AND private.advocate_initial_owner_invitation_is_authorized(
        advocate.id,
        latest_invitation.id
      )
      AND latest_invitation.accepted_at IS NULL
      AND latest_invitation.revoked_at IS NULL
      AND latest_outbox.id IS NOT NULL
    )
  FROM public.advocates advocate
  LEFT JOIN LATERAL (
    SELECT invitation.*
    FROM public.advocate_invitations invitation
    WHERE invitation.advocate_id = advocate.id
      AND invitation.invitation_kind = 'initial_owner'
    ORDER BY invitation.created_at DESC, invitation.id DESC
    LIMIT 1
  ) latest_invitation ON true
  LEFT JOIN public.advocate_invitation_email_outbox latest_outbox
    ON latest_outbox.invitation_id = latest_invitation.id
   AND latest_outbox.advocate_id = advocate.id
  WHERE advocate.id = target_advocate_id;
$$;

REVOKE ALL ON FUNCTION private.creator_share_advocate_owner_onboarding_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.list_creator_share_advocate_controls(
  integer,
  timestamp with time zone,
  uuid,
  public.advocate_relationship_status,
  public.advocate_publication_status
) RENAME TO list_creator_share_advocate_controls_legacy;

REVOKE ALL ON FUNCTION public.list_creator_share_advocate_controls_legacy(
  integer,
  timestamp with time zone,
  uuid,
  public.advocate_relationship_status,
  public.advocate_publication_status
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_creator_share_advocate_controls(
  page_size integer DEFAULT 50,
  before_created_at timestamp with time zone DEFAULT NULL,
  before_advocate_id uuid DEFAULT NULL,
  relationship_filter public.advocate_relationship_status DEFAULT NULL,
  publication_filter public.advocate_publication_status DEFAULT NULL
)
RETURNS TABLE (
  advocate_id uuid,
  slug text,
  display_name text,
  relationship_status public.advocate_relationship_status,
  publication_status public.advocate_publication_status,
  advocate_version bigint,
  owner_display_name text,
  ownership_status text,
  can_reissue_initial_owner boolean,
  can_revoke_initial_owner boolean,
  primary_hostname text,
  primary_domain_status public.advocate_domain_status,
  ready_required_integrations integer,
  required_integrations integer,
  open_provider_jobs integer,
  pending_invitations integer,
  suspended_at timestamp with time zone,
  archived_at timestamp with time zone,
  updated_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    legacy.advocate_id,
    legacy.slug,
    legacy.display_name,
    legacy.relationship_status,
    legacy.publication_status,
    legacy.advocate_version,
    CASE
      WHEN owner_state.ownership_status = 'owner_active'
        THEN legacy.owner_display_name
      ELSE NULL
    END,
    owner_state.ownership_status,
    owner_state.can_reissue_initial_owner,
    owner_state.can_revoke_initial_owner,
    legacy.primary_hostname,
    legacy.primary_domain_status,
    legacy.ready_required_integrations,
    legacy.required_integrations,
    legacy.open_provider_jobs,
    legacy.pending_invitations,
    legacy.suspended_at,
    legacy.archived_at,
    legacy.updated_at,
    legacy.created_at
  FROM public.list_creator_share_advocate_controls_legacy(
    page_size,
    before_created_at,
    before_advocate_id,
    relationship_filter,
    publication_filter
  ) legacy
  CROSS JOIN LATERAL private.creator_share_advocate_owner_onboarding_state(
    legacy.advocate_id
  ) owner_state;
$$;

REVOKE ALL ON FUNCTION public.list_creator_share_advocate_controls(
  integer,
  timestamp with time zone,
  uuid,
  public.advocate_relationship_status,
  public.advocate_publication_status
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_creator_share_advocate_controls(
  integer,
  timestamp with time zone,
  uuid,
  public.advocate_relationship_status,
  public.advocate_publication_status
) TO authenticated;

COMMENT ON FUNCTION public.list_creator_share_advocate_controls(
  integer,
  timestamp with time zone,
  uuid,
  public.advocate_relationship_status,
  public.advocate_publication_status
) IS
  'Bounded Creator Share super-administrator tenant list with server-derived owner onboarding, safe-reissue, and explicit-revocation state. Ownerless tenants expose no placeholder identity, contact, invitation identifier, transport state, or provider detail.';

ALTER FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  RENAME TO get_creator_share_advocate_control_snapshot_legacy;

REVOKE ALL ON FUNCTION public.get_creator_share_advocate_control_snapshot_legacy(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_creator_share_advocate_control_snapshot(
  target_advocate_id uuid
)
RETURNS TABLE (
  advocate_id uuid,
  slug text,
  display_name text,
  relationship_status public.advocate_relationship_status,
  publication_status public.advocate_publication_status,
  advocate_version bigint,
  owner_display_name text,
  ownership_status text,
  can_reissue_initial_owner boolean,
  can_revoke_initial_owner boolean,
  primary_domain_id uuid,
  primary_hostname text,
  primary_domain_status public.advocate_domain_status,
  ready_required_integrations integer,
  required_integrations integer,
  open_provider_jobs integer,
  open_deprovision_jobs integer,
  pending_invitations integer,
  cleanup_phase text,
  can_retry_cleanup boolean,
  can_suspend boolean,
  can_resume boolean,
  can_archive boolean,
  can_repair boolean,
  suspended_at timestamp with time zone,
  archived_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    legacy.advocate_id,
    legacy.slug,
    legacy.display_name,
    legacy.relationship_status,
    legacy.publication_status,
    legacy.advocate_version,
    CASE
      WHEN owner_state.ownership_status = 'owner_active'
        THEN legacy.owner_display_name
      ELSE NULL
    END,
    owner_state.ownership_status,
    owner_state.can_reissue_initial_owner,
    owner_state.can_revoke_initial_owner,
    legacy.primary_domain_id,
    legacy.primary_hostname,
    legacy.primary_domain_status,
    legacy.ready_required_integrations,
    legacy.required_integrations,
    legacy.open_provider_jobs,
    legacy.open_deprovision_jobs,
    legacy.pending_invitations,
    legacy.cleanup_phase,
    legacy.can_retry_cleanup,
    legacy.can_suspend
      AND legacy.relationship_status = 'active'
      AND owner_state.ownership_status = 'owner_active',
    legacy.can_resume,
    legacy.can_archive,
    legacy.can_repair,
    legacy.suspended_at,
    legacy.archived_at,
    legacy.updated_at
  FROM public.get_creator_share_advocate_control_snapshot_legacy(
    target_advocate_id
  ) legacy
  CROSS JOIN LATERAL private.creator_share_advocate_owner_onboarding_state(
    legacy.advocate_id
  ) owner_state;
$$;

REVOKE ALL ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid) IS
  'Strict Creator Share control snapshot with privacy-safe owner onboarding state, server-derived initial-owner recovery eligibility, and lifecycle controls that cannot suspend an ownerless invited tenant.';

REVOKE ALL ON FUNCTION public.create_advocate_portal(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

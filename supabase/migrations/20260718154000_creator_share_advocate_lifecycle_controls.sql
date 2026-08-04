BEGIN;

DO $$ BEGIN
  CREATE TYPE public.creator_share_advocate_lifecycle_action AS ENUM (
    'suspend',
    'resume',
    'archive',
    'repair'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE audit.creator_share_advocate_lifecycle_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  request_binding_sha256 bytea NOT NULL,
  actor_user_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  action public.creator_share_advocate_lifecycle_action NOT NULL,
  expected_advocate_version bigint NOT NULL,
  resulting_advocate_version bigint NOT NULL,
  prior_relationship_status public.advocate_relationship_status NOT NULL,
  prior_publication_status public.advocate_publication_status NOT NULL,
  resulting_relationship_status public.advocate_relationship_status NOT NULL,
  resulting_publication_status public.advocate_publication_status NOT NULL,
  reason text NOT NULL,
  trace_id text NOT NULL,
  session_id text NOT NULL,
  domain_cleanup_requested boolean NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT creator_share_advocate_lifecycle_actions_binding_check CHECK (
    octet_length(request_binding_sha256) = 32
  ),
  CONSTRAINT creator_share_advocate_lifecycle_actions_version_check CHECK (
    expected_advocate_version > 0
    AND resulting_advocate_version = expected_advocate_version + 1
  ),
  CONSTRAINT creator_share_advocate_lifecycle_actions_reason_check CHECK (
    reason = btrim(reason)
    AND char_length(reason) BETWEEN 1 AND 2000
    AND replace(reason, E'\n', '') !~ '[[:cntrl:]]'
    AND reason !~ '^[[:space:]]'
    AND reason !~ '[[:space:]]$'
  ),
  CONSTRAINT creator_share_advocate_lifecycle_actions_trace_check CHECK (
    trace_id = btrim(trace_id)
    AND char_length(trace_id) BETWEEN 1 AND 255
    AND trace_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT creator_share_advocate_lifecycle_actions_session_check CHECK (
    session_id = btrim(session_id)
    AND char_length(session_id) BETWEEN 1 AND 255
    AND session_id !~ '[[:cntrl:]]'
    AND session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT creator_share_advocate_lifecycle_actions_result_check CHECK (
    (
      action = 'suspend'
      AND resulting_relationship_status = 'suspended'
      AND resulting_publication_status = 'suspended'
      AND NOT domain_cleanup_requested
    )
    OR (
      action = 'resume'
      AND resulting_relationship_status = 'active'
      AND resulting_publication_status IN ('draft', 'provisioning')
      AND NOT domain_cleanup_requested
    )
    OR (
      action = 'archive'
      AND resulting_relationship_status = 'archived'
      AND resulting_publication_status = 'suspended'
    )
    OR (
      action = 'repair'
      AND resulting_relationship_status = 'active'
      AND resulting_publication_status = 'provisioning'
      AND NOT domain_cleanup_requested
    )
  ),
  UNIQUE (advocate_id, resulting_advocate_version)
);

COMMENT ON TABLE audit.creator_share_advocate_lifecycle_actions IS
  'Append-only exact-replay receipts for Creator Share super-administrator suspend, resume, archive, and repair decisions. The receipt excludes raw transport context, which belongs only in the ninety-day forensic layer.';

ALTER TABLE audit.creator_share_advocate_lifecycle_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_lifecycle_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit.creator_share_advocate_lifecycle_actions
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_creator_share_advocate_lifecycle_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Creator Share advocate lifecycle receipts are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_creator_share_advocate_lifecycle_receipt_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER creator_share_advocate_lifecycle_actions_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.creator_share_advocate_lifecycle_actions
FOR EACH ROW
EXECUTE FUNCTION private.prevent_creator_share_advocate_lifecycle_receipt_mutation();

CREATE TRIGGER creator_share_advocate_lifecycle_actions_no_truncate
BEFORE TRUNCATE ON audit.creator_share_advocate_lifecycle_actions
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_creator_share_advocate_lifecycle_receipt_mutation();

CREATE TABLE audit.creator_share_advocate_ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  request_binding_sha256 bytea NOT NULL,
  actor_user_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  expected_owner_membership_id uuid NOT NULL,
  target_owner_membership_id uuid NOT NULL,
  resulting_owner_membership_id uuid NOT NULL,
  prior_advocate_version bigint NOT NULL,
  resulting_advocate_version bigint NOT NULL,
  reason text NOT NULL,
  trace_id text NOT NULL,
  session_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT creator_share_advocate_ownership_transfers_binding_check CHECK (
    octet_length(request_binding_sha256) = 32
  ),
  CONSTRAINT creator_share_advocate_ownership_transfers_owner_check CHECK (
    expected_owner_membership_id <> target_owner_membership_id
    AND resulting_owner_membership_id = target_owner_membership_id
  ),
  CONSTRAINT creator_share_advocate_ownership_transfers_version_check CHECK (
    prior_advocate_version > 0
    AND resulting_advocate_version = prior_advocate_version + 1
  ),
  CONSTRAINT creator_share_advocate_ownership_transfers_reason_check CHECK (
    reason = btrim(reason)
    AND char_length(reason) BETWEEN 1 AND 2000
    AND replace(reason, E'\n', '') !~ '[[:cntrl:]]'
    AND reason !~ '^[[:space:]]'
    AND reason !~ '[[:space:]]$'
  ),
  CONSTRAINT creator_share_advocate_ownership_transfers_trace_check CHECK (
    trace_id = btrim(trace_id)
    AND char_length(trace_id) BETWEEN 1 AND 255
    AND trace_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT creator_share_advocate_ownership_transfers_session_check CHECK (
    session_id = btrim(session_id)
    AND char_length(session_id) BETWEEN 1 AND 255
    AND session_id !~ '[[:cntrl:]]'
    AND session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  UNIQUE (advocate_id, resulting_advocate_version)
);

COMMENT ON TABLE audit.creator_share_advocate_ownership_transfers IS
  'Append-only exact-replay receipts for Creator Share super-administrator ownership transfers. The receipt retains opaque membership identifiers and excludes raw transport context, which belongs only in the ninety-day forensic layer.';

ALTER TABLE audit.creator_share_advocate_ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_ownership_transfers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit.creator_share_advocate_ownership_transfers
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_creator_share_advocate_ownership_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Creator Share advocate ownership receipts are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_creator_share_advocate_ownership_receipt_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER creator_share_advocate_ownership_transfers_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.creator_share_advocate_ownership_transfers
FOR EACH ROW
EXECUTE FUNCTION private.prevent_creator_share_advocate_ownership_receipt_mutation();

CREATE TRIGGER creator_share_advocate_ownership_transfers_no_truncate
BEFORE TRUNCATE ON audit.creator_share_advocate_ownership_transfers
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_creator_share_advocate_ownership_receipt_mutation();

CREATE TABLE audit.creator_share_advocate_cleanup_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  request_binding_sha256 bytea NOT NULL,
  actor_user_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  expected_advocate_version bigint NOT NULL,
  terminal_job_id uuid NOT NULL UNIQUE,
  replacement_job_id uuid NOT NULL UNIQUE,
  resulting_advocate_version bigint NOT NULL,
  resulting_cleanup_phase text NOT NULL,
  cleanup_retry_requested boolean NOT NULL,
  reason text NOT NULL,
  trace_id text NOT NULL,
  session_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT creator_share_advocate_cleanup_recoveries_binding_check CHECK (
    octet_length(request_binding_sha256) = 32
  ),
  CONSTRAINT creator_share_advocate_cleanup_recoveries_version_check CHECK (
    expected_advocate_version > 0
    AND resulting_advocate_version = expected_advocate_version + 1
  ),
  CONSTRAINT creator_share_advocate_cleanup_recoveries_result_check CHECK (
    cleanup_retry_requested
    AND resulting_cleanup_phase IN (
      'cloudflare_dns_removal',
      'vercel_removal',
      'stripe_us_removal',
      'stripe_uk_removal',
      'paypal_removal'
    )
  ),
  CONSTRAINT creator_share_advocate_cleanup_recoveries_reason_check CHECK (
    reason = btrim(reason)
    AND char_length(reason) BETWEEN 1 AND 2000
    AND replace(reason, E'\n', '') !~ '[[:cntrl:]]'
    AND reason !~ '^[[:space:]]'
    AND reason !~ '[[:space:]]$'
  ),
  CONSTRAINT creator_share_advocate_cleanup_recoveries_trace_check CHECK (
    trace_id = btrim(trace_id)
    AND char_length(trace_id) BETWEEN 1 AND 255
    AND trace_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT creator_share_advocate_cleanup_recoveries_session_check CHECK (
    session_id = btrim(session_id)
    AND char_length(session_id) BETWEEN 1 AND 255
    AND session_id !~ '[[:cntrl:]]'
    AND session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  UNIQUE (advocate_id, resulting_advocate_version)
);

COMMENT ON TABLE audit.creator_share_advocate_cleanup_recoveries IS
  'Append-only exact-replay receipts for Creator Share super-administrator recovery of the latest failed or cancelled strict-order archive cleanup job. Provider facts remain private and raw transport context belongs only in the ninety-day forensic layer.';

ALTER TABLE audit.creator_share_advocate_cleanup_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_advocate_cleanup_recoveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit.creator_share_advocate_cleanup_recoveries
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_cleanup_recovery_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Creator Share advocate cleanup recovery receipts are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_cleanup_recovery_receipt_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER creator_share_advocate_cleanup_recoveries_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.creator_share_advocate_cleanup_recoveries
FOR EACH ROW
EXECUTE FUNCTION private.prevent_cleanup_recovery_receipt_mutation();

CREATE TRIGGER creator_share_advocate_cleanup_recoveries_no_truncate
BEFORE TRUNCATE ON audit.creator_share_advocate_cleanup_recoveries
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_cleanup_recovery_receipt_mutation();

CREATE OR REPLACE FUNCTION private.creator_share_advocate_ownership_request_binding(
  target_actor_user_id uuid,
  target_advocate_id uuid,
  target_expected_owner_membership_id uuid,
  target_owner_membership_id uuid,
  target_reason text,
  target_request_id uuid
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'schema_version', 1,
        'actor_user_id', target_actor_user_id,
        'advocate_id', target_advocate_id,
        'expected_owner_membership_id', target_expected_owner_membership_id,
        'target_owner_membership_id', target_owner_membership_id,
        'reason', target_reason,
        'request_id', target_request_id
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

REVOKE ALL ON FUNCTION private.creator_share_advocate_ownership_request_binding(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.creator_share_advocate_lifecycle_request_binding(
  target_actor_user_id uuid,
  target_advocate_id uuid,
  target_action public.creator_share_advocate_lifecycle_action,
  target_expected_advocate_version bigint,
  target_reason text,
  target_request_id uuid
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'schema_version', 1,
        'actor_user_id', target_actor_user_id,
        'advocate_id', target_advocate_id,
        'action', target_action,
        'expected_advocate_version', target_expected_advocate_version,
        'reason', target_reason,
        'request_id', target_request_id
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

REVOKE ALL ON FUNCTION private.creator_share_advocate_lifecycle_request_binding(
  uuid,
  uuid,
  public.creator_share_advocate_lifecycle_action,
  bigint,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.creator_share_advocate_cleanup_recovery_request_binding(
  target_actor_user_id uuid,
  target_advocate_id uuid,
  target_expected_advocate_version bigint,
  target_reason text,
  target_request_id uuid,
  target_terminal_job_id uuid
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'schema_version', 1,
        'actor_user_id', target_actor_user_id,
        'advocate_id', target_advocate_id,
        'expected_advocate_version', target_expected_advocate_version,
        'reason', target_reason,
        'request_id', target_request_id,
        'terminal_job_id', target_terminal_job_id
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

REVOKE ALL ON FUNCTION private.creator_share_advocate_cleanup_recovery_request_binding(
  uuid,
  uuid,
  bigint,
  text,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_healthy_creator_share_super_admin(
  operation_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_role_assignment_id uuid;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF operation_name IS NULL
     OR operation_name <> btrim(operation_name)
     OR char_length(operation_name) NOT BETWEEN 1 AND 120
     OR operation_name !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Creator Share administrator operation is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during %',
      replace(operation_name, '_', ' ')
      USING ERRCODE = '40001';
  END IF;

  SELECT assignment.id
  INTO v_role_assignment_id
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id
  WHERE assignment.user_id = v_actor_user_id
    AND assignment.organization_id IS NULL
    AND assignment.advocate_id IS NULL
    AND role.name = 'SUPER_ADMIN'
  FOR SHARE OF assignment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during %',
      replace(operation_name, '_', ' ')
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = v_actor_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_actor_user_id;
END;
$$;

REVOKE ALL ON FUNCTION private.require_healthy_creator_share_super_admin(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_signed_auth_session_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_claim text := nullif(
    btrim(COALESCE(auth.jwt(), '{}'::jsonb) ->> 'session_id'),
    ''
  );
  v_session_id uuid;
BEGIN
  IF v_session_claim IS NULL
     OR octet_length(v_session_claim) > 255
     OR v_session_claim ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A signed authentication session is required'
      USING ERRCODE = '28000';
  END IF;

  BEGIN
    v_session_id := v_session_claim::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'A signed authentication session is required'
      USING ERRCODE = '28000';
  END;

  RETURN v_session_id::text;
END;
$$;

REVOKE ALL ON FUNCTION private.require_signed_auth_session_id()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.advocate_lifecycle_mutation_guards (
  transaction_id bigint NOT NULL,
  advocate_id uuid NOT NULL,
  operation public.creator_share_advocate_lifecycle_action NOT NULL,
  PRIMARY KEY (transaction_id, advocate_id),
  CONSTRAINT advocate_lifecycle_mutation_guards_operation_check CHECK (
    operation = 'repair'
  )
);

ALTER TABLE private.advocate_lifecycle_mutation_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_lifecycle_mutation_guards FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_lifecycle_mutation_guards
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.advocate_ownership_transport_contexts (
  transaction_id bigint NOT NULL,
  advocate_id uuid NOT NULL,
  client_ip text,
  user_agent text,
  PRIMARY KEY (transaction_id, advocate_id),
  CONSTRAINT advocate_ownership_transport_contexts_values_check CHECK (
    client_ip IS NOT NULL OR user_agent IS NOT NULL
  ),
  CONSTRAINT advocate_ownership_transport_contexts_client_ip_check CHECK (
    client_ip IS NULL
    OR (
      octet_length(client_ip) BETWEEN 1 AND 256
      AND client_ip !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT advocate_ownership_transport_contexts_user_agent_check CHECK (
    user_agent IS NULL
    OR (
      octet_length(user_agent) BETWEEN 1 AND 1024
      AND user_agent !~ '[[:cntrl:]]'
    )
  )
);

ALTER TABLE private.advocate_ownership_transport_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_ownership_transport_contexts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_ownership_transport_contexts
  FROM PUBLIC, anon, authenticated, service_role;

/*
 * Repair is the only fixed action that may move a published tenant directly
 * back into provisioning. Its security definer writes an uncommitted guard
 * bound to the current transaction and exact tenant only after authorization
 * and descendant locking. Runtime principals cannot forge that private row.
 */
CREATE OR REPLACE FUNCTION private.prepare_advocate_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = NEW.slug
  ) THEN
    RAISE EXCEPTION 'Advocate subdomain label is reserved'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.published_at IS NOT NULL
       OR NEW.suspended_at IS NOT NULL
       OR NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Advocate lifecycle timestamps are server managed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.relationship_status <> 'active'
       AND NEW.publication_status IN ('provisioning', 'active') THEN
      RAISE EXCEPTION 'Only an active advocate relationship can provision or publish a portal'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.relationship_status = 'archived' THEN
      NEW.publication_status := 'suspended';
      NEW.archived_at := v_now;
      NEW.suspended_at := v_now;
    ELSIF NEW.relationship_status = 'suspended'
       OR NEW.publication_status = 'suspended' THEN
      NEW.publication_status := 'suspended';
      NEW.suspended_at := v_now;
    ELSIF NEW.publication_status = 'active' THEN
      NEW.published_at := v_now;
    END IF;

    NEW.version := 1;
    NEW.updated_at := v_now;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Advocate identity fields are immutable'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Advocate lifecycle timestamps are server managed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.relationship_status IS DISTINCT FROM OLD.relationship_status
       AND NOT (
         (OLD.relationship_status = 'invited'
           AND NEW.relationship_status IN ('active', 'suspended', 'archived'))
         OR (OLD.relationship_status = 'active'
           AND NEW.relationship_status IN ('suspended', 'archived'))
         OR (OLD.relationship_status = 'suspended'
           AND NEW.relationship_status IN ('active', 'archived'))
       ) THEN
      RAISE EXCEPTION 'Illegal advocate relationship transition from % to %',
        OLD.relationship_status,
        NEW.relationship_status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.relationship_status IN ('suspended', 'archived') THEN
      NEW.publication_status := 'suspended';
    END IF;

    IF NEW.publication_status IS DISTINCT FROM OLD.publication_status
       AND NOT (
         (OLD.publication_status = 'draft'
           AND NEW.publication_status IN ('provisioning', 'suspended'))
         OR (OLD.publication_status = 'provisioning'
           AND NEW.publication_status IN ('draft', 'active', 'failed', 'suspended'))
         OR (OLD.publication_status = 'active'
           AND NEW.publication_status IN ('failed', 'suspended'))
         OR (
           OLD.publication_status = 'active'
           AND NEW.publication_status = 'provisioning'
           AND EXISTS (
             SELECT 1
             FROM private.advocate_lifecycle_mutation_guards mutation_guard
             WHERE mutation_guard.transaction_id = txid_current()
               AND mutation_guard.advocate_id = OLD.id
               AND mutation_guard.operation = 'repair'
           )
         )
         OR (OLD.publication_status = 'failed'
           AND NEW.publication_status IN ('draft', 'provisioning', 'suspended'))
         OR (OLD.publication_status = 'suspended'
           AND NEW.publication_status IN ('draft', 'provisioning'))
       ) THEN
      RAISE EXCEPTION 'Illegal advocate publication transition from % to %',
        OLD.publication_status,
        NEW.publication_status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.relationship_status <> 'active'
       AND NEW.publication_status IN ('provisioning', 'active') THEN
      RAISE EXCEPTION 'Only an active advocate relationship can provision or publish a portal'
        USING ERRCODE = '23514';
    END IF;

    NEW.published_at := OLD.published_at;
    IF NEW.publication_status = 'active'
       AND OLD.publication_status <> 'active'
       AND NEW.published_at IS NULL THEN
      NEW.published_at := v_now;
    END IF;

    IF NEW.relationship_status = 'archived' THEN
      NEW.archived_at := COALESCE(OLD.archived_at, v_now);
    ELSE
      NEW.archived_at := NULL;
    END IF;

    IF NEW.relationship_status = 'suspended'
       OR NEW.publication_status = 'suspended' THEN
      NEW.suspended_at := CASE
        WHEN OLD.relationship_status = 'suspended'
          OR OLD.publication_status = 'suspended'
          THEN COALESCE(OLD.suspended_at, v_now)
        ELSE v_now
      END;
    ELSE
      NEW.suspended_at := NULL;
    END IF;

    NEW.version := OLD.version + 1;
    NEW.updated_at := v_now;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prepare_advocate_row()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_suppressed_domain_job_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
  v_suppressed_at timestamp with time zone;
BEGIN
  IF OLD.kind = 'deprovision'
     OR NEW.status IN ('failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  SELECT
    advocate.relationship_status,
    advocate.publication_status,
    integration.reconciliation_suppressed_at
  INTO
    v_relationship_status,
    v_publication_status,
    v_suppressed_at
  FROM public.advocate_domain_integrations integration
  JOIN public.advocates advocate ON advocate.id = integration.advocate_id
  WHERE integration.id = OLD.integration_id
    AND integration.domain_id = OLD.domain_id
    AND integration.advocate_id = OLD.advocate_id;

  IF NOT FOUND
     OR v_suppressed_at IS NOT NULL
     OR v_relationship_status <> 'active'
     OR v_publication_status = 'suspended' THEN
    RAISE EXCEPTION 'Domain provider work is fenced by the advocate lifecycle'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_suppressed_domain_job_progress()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER domain_provisioning_jobs_lifecycle_fence
BEFORE UPDATE ON public.domain_provisioning_jobs
FOR EACH ROW
EXECUTE FUNCTION private.prevent_suppressed_domain_job_progress();

CREATE OR REPLACE FUNCTION private.advocate_cleanup_quiescence_interval()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT interval '20 minutes';
$$;

COMMENT ON FUNCTION private.advocate_cleanup_quiescence_interval() IS
  'Central archive cleanup delay. Twenty minutes dominates the configured fifteen-minute maximum worker lease plus sixty-second maximum provider request horizon and retains an operational buffer.';

REVOKE ALL ON FUNCTION private.advocate_cleanup_quiescence_interval()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.enqueue_domain_provisioning_job_internal(
  target_domain_id uuid,
  target_integration_id uuid,
  job_kind public.domain_provisioning_job_kind,
  requested_run_at timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate_id uuid;
  v_provider public.advocate_domain_integration_provider;
  v_domain_status public.advocate_domain_status;
  v_integration_status public.advocate_domain_integration_status;
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
  v_reconciliation_suppressed_at timestamp with time zone;
  v_existing_job_id uuid;
  v_existing_kind public.domain_provisioning_job_kind;
  v_job_id uuid;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF target_domain_id IS NULL
     OR target_integration_id IS NULL
     OR job_kind IS NULL
     OR requested_run_at IS NULL
     OR requested_run_at < v_now - interval '5 seconds'
     OR requested_run_at > v_now + interval '30 days' THEN
    RAISE EXCEPTION 'Domain provisioning enqueue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    integration.advocate_id,
    integration.provider,
    integration.status,
    integration.reconciliation_suppressed_at
  INTO
    v_advocate_id,
    v_provider,
    v_integration_status,
    v_reconciliation_suppressed_at
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
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
  JOIN public.advocates advocate
    ON advocate.id = domain.advocate_id
  WHERE domain.id = target_domain_id
    AND domain.advocate_id = v_advocate_id
  FOR UPDATE OF domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_relationship_status = 'archived' THEN
    RAISE EXCEPTION 'Archived advocate cleanup must use the lifecycle coordinator'
      USING ERRCODE = '55000';
  END IF;

  IF v_reconciliation_suppressed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Domain integration work is administratively suppressed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT private.domain_job_lifecycle_is_eligible(
    job_kind,
    v_domain_status,
    v_integration_status,
    v_relationship_status,
    v_publication_status
  ) THEN
    CASE job_kind
      WHEN 'provision' THEN
        RAISE EXCEPTION 'Domain integration is not eligible for provisioning'
          USING ERRCODE = '55000';
      WHEN 'reconcile' THEN
        RAISE EXCEPTION 'Domain integration is not eligible for reconciliation'
          USING ERRCODE = '55000';
      WHEN 'deprovision' THEN
        RAISE EXCEPTION 'Domain must be quiescing or disabled before deprovisioning'
          USING ERRCODE = '55000';
      ELSE
        RAISE EXCEPTION 'Unsupported domain provisioning job kind'
          USING ERRCODE = '22023';
    END CASE;
  END IF;

  IF job_kind = 'deprovision'
     AND v_provider = 'vercel'
     AND NOT private.cloudflare_dns_removal_is_verified(target_domain_id) THEN
    RAISE EXCEPTION 'Cloudflare DNS removal must be verified before Vercel release'
      USING ERRCODE = '55000';
  END IF;

  SELECT job.id, job.kind
  INTO v_existing_job_id, v_existing_kind
  FROM public.domain_provisioning_jobs job
  WHERE job.integration_id = target_integration_id
    AND job.status IN ('queued', 'running')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_kind = job_kind THEN
      RETURN v_existing_job_id;
    END IF;

    RAISE EXCEPTION 'A conflicting domain integration operation is already open'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.domain_provisioning_jobs (
    advocate_id,
    domain_id,
    integration_id,
    kind,
    provider,
    run_after,
    request_payload
  )
  VALUES (
    v_advocate_id,
    target_domain_id,
    target_integration_id,
    job_kind,
    v_provider,
    requested_run_at,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

COMMENT ON FUNCTION private.enqueue_domain_provisioning_job_internal(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone
) IS
  'Lowest trusted general enqueue boundary. Archived tenant cleanup is rejected here and may enter only through the cooldown and strict-order lifecycle coordinator.';

REVOKE ALL ON FUNCTION private.enqueue_domain_provisioning_job_internal(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.advocate_domain_provider_deprovision_is_verified(
  target_domain_id uuid,
  target_provider public.advocate_domain_integration_provider,
  target_environment text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.advocate_id = integration.advocate_id
     AND job.domain_id = integration.domain_id
     AND job.integration_id = integration.id
     AND job.provider = integration.provider
    WHERE integration.domain_id = target_domain_id
      AND integration.provider = target_provider
      AND integration.environment = target_environment
      AND integration.is_required
      AND integration.status = 'disabled'
      AND integration.disabled_at IS NOT NULL
      AND integration.last_verified_kind = 'deprovision'
      AND integration.last_verified_at IS NOT NULL
      AND job.kind = 'deprovision'
      AND job.status = 'succeeded'
      AND job.result_payload @> jsonb_build_object(
        'verified', true,
        'provider_status', 'absent'
      )
      AND job.settlement_lease_token_digest IS NOT NULL
      AND job.settlement_fingerprint IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION private.advocate_domain_provider_deprovision_is_verified(
  uuid,
  public.advocate_domain_integration_provider,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.archived_advocate_domain_cleanup_state(
  target_advocate_id uuid,
  target_domain_id uuid
)
RETURNS TABLE (
  phase text,
  next_integration_id uuid,
  cleanup_complete boolean,
  current_job_open boolean,
  terminal_job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_domain_count integer;
  v_integration_count integer;
  v_expected_integration_count integer;
  v_next_provider public.advocate_domain_integration_provider;
  v_next_environment text;
  v_latest_job_id uuid;
  v_latest_status public.domain_provisioning_job_status;
BEGIN
  phase := 'needs_attention';
  next_integration_id := NULL;
  cleanup_complete := false;
  current_job_open := false;
  terminal_job_id := NULL;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_advocate.relationship_status <> 'archived' THEN
    phase := 'not_requested';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO v_domain_count
  FROM public.advocate_domains domain
  WHERE domain.advocate_id = v_advocate.id;

  IF v_domain_count = 0 THEN
    phase := 'complete';
    cleanup_complete := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_domain_count <> 1 OR target_domain_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id
    AND domain.advocate_id = v_advocate.id;

  IF NOT FOUND
     OR NOT v_domain.is_primary
     OR v_domain.status NOT IN ('redirecting', 'disabled')
     OR v_domain.redirect_to_domain_id IS NOT NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE integration.is_required
        AND (
          (integration.provider = 'cloudflare'
            AND integration.environment = 'production')
          OR (integration.provider = 'vercel'
            AND integration.environment = 'production')
          OR (integration.provider = 'stripe_us'
            AND integration.environment = 'live')
          OR (integration.provider = 'stripe_uk'
            AND integration.environment = 'live')
          OR (integration.provider = 'paypal'
            AND integration.environment = 'live')
        )
    )::integer
  INTO v_integration_count, v_expected_integration_count
  FROM public.advocate_domain_integrations integration
  WHERE integration.advocate_id = v_advocate.id
    AND integration.domain_id = v_domain.id;

  IF v_integration_count <> 5 OR v_expected_integration_count <> 5 THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_advocate.archived_at IS NULL
     OR v_advocate.archived_at +
       private.advocate_cleanup_quiescence_interval() > clock_timestamp() THEN
    phase := 'quiescing';
    RETURN NEXT;
    RETURN;
  END IF;

  IF private.domain_deprovisioning_is_complete(v_domain.id) THEN
    phase := 'complete';
    cleanup_complete := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT private.advocate_domain_provider_deprovision_is_verified(
    v_domain.id,
    'cloudflare',
    'production'
  ) THEN
    v_next_provider := 'cloudflare';
    v_next_environment := 'production';
    phase := 'cloudflare_dns_removal';
  ELSIF NOT private.advocate_domain_provider_deprovision_is_verified(
    v_domain.id,
    'vercel',
    'production'
  ) THEN
    v_next_provider := 'vercel';
    v_next_environment := 'production';
    phase := 'vercel_removal';
  ELSIF NOT private.advocate_domain_provider_deprovision_is_verified(
    v_domain.id,
    'stripe_us',
    'live'
  ) THEN
    v_next_provider := 'stripe_us';
    v_next_environment := 'live';
    phase := 'stripe_us_removal';
  ELSIF NOT private.advocate_domain_provider_deprovision_is_verified(
    v_domain.id,
    'stripe_uk',
    'live'
  ) THEN
    v_next_provider := 'stripe_uk';
    v_next_environment := 'live';
    phase := 'stripe_uk_removal';
  ELSIF NOT private.advocate_domain_provider_deprovision_is_verified(
    v_domain.id,
    'paypal',
    'live'
  ) THEN
    v_next_provider := 'paypal';
    v_next_environment := 'live';
    phase := 'paypal_removal';
  ELSE
    phase := 'complete';
    cleanup_complete := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT integration.id
  INTO next_integration_id
  FROM public.advocate_domain_integrations integration
  WHERE integration.advocate_id = v_advocate.id
    AND integration.domain_id = v_domain.id
    AND integration.provider = v_next_provider
    AND integration.environment = v_next_environment
    AND integration.is_required;

  IF NOT FOUND THEN
    phase := 'needs_attention';
    next_integration_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
      AND job.domain_id = v_domain.id
      AND job.kind = 'deprovision'
      AND job.status IN ('queued', 'running')
      AND job.integration_id <> next_integration_id
  ) THEN
    phase := 'needs_attention';
    next_integration_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT job.id, job.status
  INTO v_latest_job_id, v_latest_status
  FROM public.domain_provisioning_jobs job
  WHERE job.advocate_id = v_advocate.id
    AND job.domain_id = v_domain.id
    AND job.integration_id = next_integration_id
    AND job.kind = 'deprovision'
    AND job.created_at >= v_advocate.archived_at
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT 1;

  IF v_latest_status IN ('failed', 'cancelled') THEN
    phase := 'needs_attention';
    terminal_job_id := v_latest_job_id;
  ELSIF v_latest_status = 'succeeded' THEN
    phase := 'needs_attention';
    next_integration_id := NULL;
  ELSE
    current_job_open := COALESCE(
      v_latest_status IN ('queued', 'running'),
      false
    );
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION private.archived_advocate_domain_cleanup_state(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.enqueue_archived_advocate_deprovision_job(
  target_advocate_id uuid,
  target_domain_id uuid,
  target_integration_id uuid,
  requested_run_at timestamp with time zone
)
RETURNS TABLE (
  job_id uuid,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_integration public.advocate_domain_integrations%ROWTYPE;
  v_existing_job_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF target_advocate_id IS NULL
     OR target_domain_id IS NULL
     OR target_integration_id IS NULL
     OR requested_run_at IS NULL THEN
    RAISE EXCEPTION 'Archived advocate deprovision enqueue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR SHARE;

  IF NOT FOUND OR v_advocate.relationship_status <> 'archived' THEN
    RAISE EXCEPTION 'Only an archived advocate can enqueue lifecycle deprovisioning'
      USING ERRCODE = '55000';
  END IF;

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id
    AND domain.advocate_id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND OR v_domain.status NOT IN ('redirecting', 'disabled') THEN
    RAISE EXCEPTION 'Archived advocate domain is not quiescing'
      USING ERRCODE = '55000';
  END IF;

  SELECT integration.*
  INTO v_integration
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id
    AND integration.advocate_id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archived advocate domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  v_now := clock_timestamp();

  IF requested_run_at > v_now + interval '1 hour' THEN
    RAISE EXCEPTION 'Archived advocate deprovision enqueue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_advocate.archived_at IS NULL
     OR v_advocate.archived_at +
       private.advocate_cleanup_quiescence_interval() > v_now THEN
    RAISE EXCEPTION 'Archived advocate provider quiescence is still active'
      USING ERRCODE = '55000';
  END IF;

  SELECT job.id
  INTO v_existing_job_id
  FROM public.domain_provisioning_jobs job
  WHERE job.integration_id = v_integration.id
    AND job.domain_id = v_domain.id
    AND job.advocate_id = v_advocate.id
    AND job.status IN ('queued', 'running')
  FOR SHARE;

  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.domain_provisioning_jobs job
      WHERE job.id = v_existing_job_id
        AND job.kind = 'deprovision'
    ) THEN
      RAISE EXCEPTION 'A non-deprovisioning job still owns the integration fence'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT v_existing_job_id, false;
    RETURN;
  END IF;

  INSERT INTO public.domain_provisioning_jobs (
    id,
    advocate_id,
    domain_id,
    integration_id,
    kind,
    provider,
    run_after,
    request_payload
  )
  VALUES (
    v_job_id,
    v_advocate.id,
    v_domain.id,
    v_integration.id,
    'deprovision',
    v_integration.provider,
    GREATEST(
      requested_run_at,
      clock_timestamp(),
      v_advocate.archived_at +
        private.advocate_cleanup_quiescence_interval()
    ),
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  );

  RETURN QUERY SELECT v_job_id, true;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_archived_advocate_deprovision_job(
  uuid,
  uuid,
  uuid,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.coordinate_archived_advocate_domain_deprovisioning(
  batch_size integer DEFAULT 25,
  coordinator_id text DEFAULT 'advocate-domain-lifecycle-coordinator'
)
RETURNS TABLE (
  advocate_id uuid,
  domain_id uuid,
  phase text,
  jobs_enqueued integer,
  cleanup_complete boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
  v_coordinator_id text := btrim($2);
  v_run_id uuid := gen_random_uuid();
  v_candidate record;
  v_state record;
  v_integration public.advocate_domain_integrations%ROWTYPE;
  v_enqueue record;
  v_jobs_enqueued integer;
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Advocate lifecycle coordinator service role is required'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Advocate lifecycle coordinator service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF $1 IS NULL OR $1 NOT BETWEEN 1 AND 50
     OR $2 IS NULL
     OR $2 IS DISTINCT FROM v_coordinator_id
     OR char_length(v_coordinator_id) NOT BETWEEN 1 AND 128
     OR v_coordinator_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' THEN
    RAISE EXCEPTION 'Advocate lifecycle coordinator input is invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR v_candidate IN
    SELECT
      advocate.id AS advocate_id,
      selected_domain.id AS domain_id
    FROM public.advocates advocate
    JOIN LATERAL (
      SELECT domain.id
      FROM public.advocate_domains domain
      WHERE domain.advocate_id = advocate.id
      ORDER BY domain.is_primary DESC, domain.id
      LIMIT 1
    ) selected_domain ON true
    JOIN LATERAL private.archived_advocate_domain_cleanup_state(
      advocate.id,
      selected_domain.id
    ) cleanup_state ON true
    WHERE advocate.relationship_status = 'archived'
      AND cleanup_state.phase <> 'complete'
    ORDER BY
      CASE
        WHEN cleanup_state.phase = 'needs_attention' THEN 3
        WHEN cleanup_state.next_integration_id IS NOT NULL
          AND NOT cleanup_state.current_job_open THEN 0
        WHEN cleanup_state.next_integration_id IS NOT NULL THEN 1
        WHEN cleanup_state.phase = 'quiescing' THEN 2
        ELSE 3
      END,
      advocate.archived_at,
      advocate.id
    FOR UPDATE OF advocate SKIP LOCKED
    LIMIT $1
  LOOP
    BEGIN
      PERFORM domain.id
      FROM public.advocate_domains domain
      WHERE domain.advocate_id = v_candidate.advocate_id
      ORDER BY domain.id
      FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      CONTINUE;
    END;

    BEGIN
      PERFORM integration.id
      FROM public.advocate_domain_integrations integration
      WHERE integration.advocate_id = v_candidate.advocate_id
      ORDER BY integration.domain_id, integration.id
      FOR UPDATE NOWAIT;

      PERFORM job.id
      FROM public.domain_provisioning_jobs job
      WHERE job.advocate_id = v_candidate.advocate_id
      ORDER BY job.domain_id, job.integration_id, job.id
      FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      CONTINUE;
    END;

    v_jobs_enqueued := 0;

    SELECT *
    INTO v_state
    FROM private.archived_advocate_domain_cleanup_state(
      v_candidate.advocate_id,
      v_candidate.domain_id
    );

    IF v_state.phase <> 'needs_attention'
       AND v_state.next_integration_id IS NOT NULL THEN
      SELECT integration.*
      INTO STRICT v_integration
      FROM public.advocate_domain_integrations integration
      WHERE integration.id = v_state.next_integration_id
        AND integration.advocate_id = v_candidate.advocate_id
        AND integration.domain_id = v_candidate.domain_id;

      PERFORM audit.set_actor_context(
        context_actor_type => 'system'::audit.audit_actor_type,
        context_system_actor => v_coordinator_id,
        context_tool => 'domain-deprovisioning-coordinator',
        context_request_id => v_run_id::text,
        context_reason => 'Coordinate bounded archived advocate domain deprovisioning',
        context_metadata => jsonb_build_object(
          'operation', 'coordinate_deprovisioning',
          'resource_kind', 'advocate_domain',
          'resource_id', v_candidate.domain_id::text,
          'batch_id', v_run_id::text,
          'outcome', v_state.phase
        )
      );

      SELECT *
      INTO v_enqueue
      FROM private.enqueue_archived_advocate_deprovision_job(
        v_candidate.advocate_id,
        v_candidate.domain_id,
        v_integration.id,
        clock_timestamp()
      );

      v_jobs_enqueued := CASE
        WHEN v_enqueue.was_created THEN 1 ELSE 0
      END;
    END IF;

    advocate_id := v_candidate.advocate_id;
    domain_id := v_candidate.domain_id;
    phase := v_state.phase;
    jobs_enqueued := v_jobs_enqueued;
    cleanup_complete := v_state.cleanup_complete;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.coordinate_archived_advocate_domain_deprovisioning(integer, text) IS
  'Service-only bounded archive cleanup coordinator. It waits through provider quiescence, creates at most one strictly ordered provider job per tenant, and returns a generic attention state for invalid topology without carrying provider payloads, identifiers, errors, or secrets.';

REVOKE ALL ON FUNCTION public.coordinate_archived_advocate_domain_deprovisioning(integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coordinate_archived_advocate_domain_deprovisioning(integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.retry_creator_share_advocate_cleanup(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  change_reason text,
  request_id uuid,
  trace_id text,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  advocate_id uuid,
  advocate_version bigint,
  cleanup_phase text,
  cleanup_retry_requested boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_reason text := btrim($3);
  v_trace_id text := btrim($5);
  v_session_id text;
  v_request_binding bytea;
  v_existing audit.creator_share_advocate_cleanup_recoveries%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_integration public.advocate_domain_integrations%ROWTYPE;
  v_terminal_job public.domain_provisioning_jobs%ROWTYPE;
  v_state record;
  v_result_state record;
  v_enqueue record;
  v_resulting_advocate_version bigint;
BEGIN
  IF $1 IS NULL
     OR $2 IS NULL
     OR $2 < 1
     OR $3 IS NULL
     OR $3 IS DISTINCT FROM v_reason
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR replace(v_reason, E'\n', '') ~ '[[:cntrl:]]'
     OR v_reason ~ '^[[:space:]]'
     OR v_reason ~ '[[:space:]]$'
     OR $4 IS NULL
     OR $5 IS NULL
     OR $5 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]'
     OR (
       $6 IS NOT NULL
       AND (
         octet_length($6) NOT BETWEEN 1 AND 256
         OR $6 ~ '[[:cntrl:]]'
       )
     )
     OR (
       $7 IS NOT NULL
       AND (
         octet_length($7) NOT BETWEEN 1 AND 1024
         OR $7 ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Creator Share advocate cleanup recovery input is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'retry_advocate_cleanup'
  );
  v_session_id := private.require_signed_auth_session_id();

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($4::text, 184222)
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($1::text, 184219)
  );

  SELECT recovery.*
  INTO v_existing
  FROM audit.creator_share_advocate_cleanup_recoveries recovery
  WHERE recovery.request_id = $4
  FOR SHARE;

  IF FOUND THEN
    v_request_binding :=
      private.creator_share_advocate_cleanup_recovery_request_binding(
        v_actor_user_id,
        $1,
        $2,
        $3,
        $4,
        v_existing.terminal_job_id
      );

    IF v_existing.request_binding_sha256 IS DISTINCT FROM v_request_binding
       OR v_existing.actor_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing.advocate_id IS DISTINCT FROM $1
       OR v_existing.expected_advocate_version IS DISTINCT FROM $2
       OR v_existing.reason IS DISTINCT FROM $3 THEN
      RAISE EXCEPTION 'Advocate cleanup recovery replay does not match the committed request'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_existing.advocate_id,
      v_existing.resulting_advocate_version,
      v_existing.resulting_cleanup_phase,
      v_existing.cleanup_retry_requested;
    RETURN;
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = $1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_advocate.version IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION 'Advocate portal version changed before cleanup recovery'
      USING ERRCODE = '40001';
  END IF;

  BEGIN
    PERFORM domain.id
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
    ORDER BY domain.id
    FOR UPDATE NOWAIT;

    PERFORM integration.id
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_advocate.id
    ORDER BY integration.domain_id, integration.id
    FOR UPDATE NOWAIT;

    PERFORM job.id
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
    ORDER BY job.domain_id, job.integration_id, job.id
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate cleanup evidence changed during recovery'
      USING ERRCODE = '40001';
  END;

  IF private.require_healthy_creator_share_super_admin(
       'retry_advocate_cleanup'
     ) IS DISTINCT FROM v_actor_user_id THEN
    RAISE EXCEPTION 'Creator Share administrator identity changed during cleanup recovery'
      USING ERRCODE = '40001';
  END IF;

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.advocate_id = v_advocate.id
    AND domain.is_primary
  ORDER BY domain.id
  LIMIT 1;

  SELECT *
  INTO v_state
  FROM private.archived_advocate_domain_cleanup_state(
    v_advocate.id,
    v_domain.id
  );

  IF v_advocate.relationship_status <> 'archived'
     OR v_state.phase IS DISTINCT FROM 'needs_attention'
     OR v_state.next_integration_id IS NULL
     OR v_state.terminal_job_id IS NULL THEN
    RAISE EXCEPTION 'Advocate cleanup is not eligible for recovery'
      USING ERRCODE = '55000';
  END IF;

  SELECT integration.*
  INTO STRICT v_integration
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = v_state.next_integration_id
    AND integration.advocate_id = v_advocate.id
    AND integration.domain_id = v_domain.id
    AND integration.is_required;

  SELECT job.*
  INTO v_terminal_job
  FROM public.domain_provisioning_jobs job
  WHERE job.advocate_id = v_advocate.id
    AND job.domain_id = v_domain.id
    AND job.integration_id = v_integration.id
    AND job.kind = 'deprovision'
    AND job.created_at >= v_advocate.archived_at
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT 1;

  IF NOT FOUND
     OR v_terminal_job.id IS DISTINCT FROM v_state.terminal_job_id
     OR v_terminal_job.status NOT IN ('failed', 'cancelled')
     OR v_terminal_job.provider IS DISTINCT FROM v_integration.provider THEN
    RAISE EXCEPTION 'Advocate cleanup terminal evidence changed during recovery'
      USING ERRCODE = '40001';
  END IF;

  v_request_binding :=
    private.creator_share_advocate_cleanup_recovery_request_binding(
      v_actor_user_id,
      v_advocate.id,
      $2,
      $3,
      $4,
      v_terminal_job.id
    );

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-advocate-lifecycle',
    context_request_id => $4::text,
    context_trace_id => $5,
    context_session_id => v_session_id,
    context_client_ip => $6,
    context_user_agent => $7,
    context_reason => $3,
    context_metadata => jsonb_build_object(
      'operation', 'retry_domain_cleanup',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'prior_status', 'needs_attention',
      'outcome', 'cleanup_retry_authorized'
    )
  );

  UPDATE public.advocates advocate
  SET relationship_status = v_advocate.relationship_status
  WHERE advocate.id = v_advocate.id
    AND advocate.version = $2
  RETURNING advocate.version INTO v_resulting_advocate_version;

  IF NOT FOUND OR v_resulting_advocate_version <> $2 + 1 THEN
    RAISE EXCEPTION 'Advocate portal changed during cleanup recovery'
      USING ERRCODE = '40001';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-advocate-lifecycle',
    context_request_id => $4::text,
    context_trace_id => $5,
    context_session_id => v_session_id,
    context_client_ip => $6,
    context_user_agent => $7,
    context_reason => $3,
    context_metadata => jsonb_build_object(
      'operation', 'queue_cleanup_retry',
      'resource_kind', 'advocate_domain',
      'resource_id', v_domain.id::text,
      'prior_status', 'needs_attention',
      'outcome', v_state.phase
    )
  );

  SELECT *
  INTO v_enqueue
  FROM private.enqueue_archived_advocate_deprovision_job(
    v_advocate.id,
    v_domain.id,
    v_integration.id,
    clock_timestamp()
  );

  IF NOT v_enqueue.was_created THEN
    RAISE EXCEPTION 'Advocate cleanup recovery did not create fresh work'
      USING ERRCODE = '40001';
  END IF;

  SELECT *
  INTO v_result_state
  FROM private.archived_advocate_domain_cleanup_state(
    v_advocate.id,
    v_domain.id
  );

  IF v_result_state.phase = 'needs_attention'
     OR v_result_state.next_integration_id IS DISTINCT FROM v_integration.id
     OR NOT v_result_state.current_job_open
     OR v_result_state.terminal_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Advocate cleanup recovery result is inconsistent'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO audit.creator_share_advocate_cleanup_recoveries (
    request_id,
    request_binding_sha256,
    actor_user_id,
    advocate_id,
    expected_advocate_version,
    terminal_job_id,
    replacement_job_id,
    resulting_advocate_version,
    resulting_cleanup_phase,
    cleanup_retry_requested,
    reason,
    trace_id,
    session_id
  )
  VALUES (
    $4,
    v_request_binding,
    v_actor_user_id,
    v_advocate.id,
    $2,
    v_terminal_job.id,
    v_enqueue.job_id,
    v_resulting_advocate_version,
    v_result_state.phase,
    true,
    $3,
    $5,
    v_session_id
  );

  RETURN QUERY SELECT
    v_advocate.id,
    v_resulting_advocate_version,
    v_result_state.phase,
    true;
END;
$$;

COMMENT ON FUNCTION public.retry_creator_share_advocate_cleanup(
  uuid,
  bigint,
  text,
  uuid,
  text,
  text,
  text
) IS
  'Creator Share super-administrator exact-replay recovery boundary for the latest failed or cancelled current strict-order archive cleanup job. The caller cannot select a job or provider, and the bounded result contains no provider facts.';

REVOKE ALL ON FUNCTION public.retry_creator_share_advocate_cleanup(
  uuid,
  bigint,
  text,
  uuid,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_creator_share_advocate_cleanup(
  uuid,
  bigint,
  text,
  uuid,
  text,
  text,
  text
) TO authenticated;

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
  v_actor_user_id uuid;
  v_reason text := btrim($4);
  v_trace_id text := btrim($6);
  v_session_id text;
  v_operation text;
  v_request_binding bytea;
  v_existing audit.creator_share_advocate_lifecycle_actions%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_integration public.advocate_domain_integrations%ROWTYPE;
  v_resulting_version bigint;
  v_resulting_relationship_status public.advocate_relationship_status;
  v_resulting_publication_status public.advocate_publication_status;
  v_domain_count integer;
  v_integration_count integer;
  v_expected_integration_count integer;
  v_cleanup_requested boolean := false;
  v_job_kind public.domain_provisioning_job_kind;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF $1 IS NULL
     OR $2 IS NULL
     OR $2 < 1
     OR $3 IS NULL
     OR $4 IS NULL
     OR $4 IS DISTINCT FROM v_reason
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR replace(v_reason, E'\n', '') ~ '[[:cntrl:]]'
     OR v_reason ~ '^[[:space:]]'
     OR v_reason ~ '[[:space:]]$'
     OR $5 IS NULL
     OR $6 IS NULL
     OR $6 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]'
     OR (
       $7 IS NOT NULL
       AND (
         octet_length($7) NOT BETWEEN 1 AND 256
         OR $7 ~ '[[:cntrl:]]'
       )
     )
     OR (
       $8 IS NOT NULL
       AND (
         octet_length($8) NOT BETWEEN 1 AND 1024
         OR $8 ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Creator Share advocate lifecycle action input is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'advocate_lifecycle_action'
  );
  v_session_id := private.require_signed_auth_session_id();
  v_operation := $3::text || '_advocate';
  v_request_binding := private.creator_share_advocate_lifecycle_request_binding(
    v_actor_user_id,
    $1,
    $3,
    $2,
    $4,
    $5
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($5::text, 184220)
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($1::text, 184219)
  );

  SELECT lifecycle_action.*
  INTO v_existing
  FROM audit.creator_share_advocate_lifecycle_actions lifecycle_action
  WHERE lifecycle_action.request_id = $5
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.request_binding_sha256 IS DISTINCT FROM v_request_binding
       OR v_existing.actor_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing.advocate_id IS DISTINCT FROM $1
       OR v_existing.action IS DISTINCT FROM $3
       OR v_existing.expected_advocate_version IS DISTINCT FROM $2
       OR v_existing.reason IS DISTINCT FROM $4 THEN
      RAISE EXCEPTION 'Advocate lifecycle replay does not match the committed request'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_existing.advocate_id,
      v_existing.resulting_advocate_version,
      v_existing.resulting_relationship_status,
      v_existing.resulting_publication_status,
      v_existing.domain_cleanup_requested;
    RETURN;
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = $1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_advocate.version IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION 'Advocate portal version changed before the lifecycle action'
      USING ERRCODE = '40001';
  END IF;

  /*
   * Provider settlement takes integration, domain, and job locks in the other
   * direction. Every descendant lock is therefore NOWAIT after the root lock.
   * An overlap becomes an optimistic conflict instead of a deadlock.
   */
  BEGIN
    PERFORM domain.id
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
    ORDER BY domain.id
    FOR UPDATE NOWAIT;

    PERFORM integration.id
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_advocate.id
    ORDER BY integration.domain_id, integration.id
    FOR UPDATE NOWAIT;

    PERFORM job.id
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
    ORDER BY job.domain_id, job.integration_id, job.id
    FOR UPDATE NOWAIT;

    PERFORM invitation.id
    FROM public.advocate_invitations invitation
    WHERE invitation.advocate_id = v_advocate.id
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL
    ORDER BY invitation.id
    FOR UPDATE NOWAIT;

    PERFORM outbox.id
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE outbox.advocate_id = v_advocate.id
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL
    ORDER BY outbox.id
    FOR UPDATE OF outbox NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate lifecycle evidence changed during the action'
      USING ERRCODE = '40001';
  END;

  /*
   * Reauthorize after every action target is locked. The global assignment and
   * auth account rows remain share locked until this transaction commits.
   */
  IF private.require_healthy_creator_share_super_admin(
       'advocate_lifecycle_action'
     ) IS DISTINCT FROM v_actor_user_id THEN
    RAISE EXCEPTION 'Creator Share administrator identity changed during the lifecycle action'
      USING ERRCODE = '40001';
  END IF;

  SELECT count(*)::integer
  INTO v_domain_count
  FROM public.advocate_domains domain
  WHERE domain.advocate_id = v_advocate.id;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE integration.is_required
        AND (
          (integration.provider = 'cloudflare' AND integration.environment = 'production')
          OR (integration.provider = 'vercel' AND integration.environment = 'production')
          OR (integration.provider = 'stripe_us' AND integration.environment = 'live')
          OR (integration.provider = 'stripe_uk' AND integration.environment = 'live')
          OR (integration.provider = 'paypal' AND integration.environment = 'live')
        )
    )::integer
  INTO v_integration_count, v_expected_integration_count
  FROM public.advocate_domain_integrations integration
  WHERE integration.advocate_id = v_advocate.id;

  IF v_domain_count > 1 THEN
    RAISE EXCEPTION 'Advocate lifecycle controls require the sole-tenant domain topology'
      USING ERRCODE = '55000';
  END IF;

  IF $3 = 'suspend' THEN
    IF v_advocate.relationship_status NOT IN ('invited', 'active')
       OR EXISTS (
         SELECT 1
         FROM public.advocate_domains domain
         WHERE domain.advocate_id = v_advocate.id
           AND domain.status = 'redirecting'
       ) THEN
      RAISE EXCEPTION 'Advocate portal is not eligible for suspension'
        USING ERRCODE = '55000';
    END IF;

    v_resulting_relationship_status := 'suspended';
    v_resulting_publication_status := 'suspended';
  ELSIF $3 = 'resume' THEN
    IF v_advocate.relationship_status <> 'suspended'
       OR EXISTS (
         SELECT 1
         FROM public.advocate_domains domain
         WHERE domain.advocate_id = v_advocate.id
           AND domain.status = 'redirecting'
       )
       OR EXISTS (
         SELECT 1
         FROM public.domain_provisioning_jobs job
         WHERE job.advocate_id = v_advocate.id
           AND job.kind = 'deprovision'
           AND job.status IN ('queued', 'running')
       ) THEN
      RAISE EXCEPTION 'Advocate portal is not eligible for resume while deprovisioning'
        USING ERRCODE = '55000';
    END IF;

    IF v_domain_count = 1
       AND (v_integration_count <> 5 OR v_expected_integration_count <> 5) THEN
      RAISE EXCEPTION 'Advocate portal provider topology must be repaired before resume'
        USING ERRCODE = '55000';
    END IF;

    v_resulting_relationship_status := 'active';
    v_resulting_publication_status := CASE
      WHEN v_domain_count = 0
        THEN 'draft'::public.advocate_publication_status
      ELSE 'provisioning'::public.advocate_publication_status
    END;
  ELSIF $3 = 'archive' THEN
    IF v_advocate.relationship_status = 'archived' THEN
      RAISE EXCEPTION 'Archived advocate portals cannot be changed'
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.advocate_domains domain
      WHERE domain.advocate_id = v_advocate.id
        AND domain.status = 'redirecting'
        AND domain.redirect_to_domain_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Redirecting advocate domain requires manual target reconciliation before archive'
        USING ERRCODE = '55000';
    END IF;

    v_resulting_relationship_status := 'archived';
    v_resulting_publication_status := 'suspended';
    v_cleanup_requested := v_domain_count > 0;
  ELSE
    IF v_advocate.relationship_status <> 'active'
       OR v_domain_count <> 1
       OR v_integration_count <> 5
       OR v_expected_integration_count <> 5
       OR EXISTS (
         SELECT 1
         FROM public.advocate_domains domain
         WHERE domain.advocate_id = v_advocate.id
           AND domain.status = 'redirecting'
       )
       OR EXISTS (
         SELECT 1
         FROM public.domain_provisioning_jobs job
         WHERE job.advocate_id = v_advocate.id
           AND job.kind = 'deprovision'
           AND job.status IN ('queued', 'running')
       ) THEN
      RAISE EXCEPTION 'Advocate portal is not eligible for provider repair'
        USING ERRCODE = '55000';
    END IF;

    v_resulting_relationship_status := 'active';
    v_resulting_publication_status := 'provisioning';
  END IF;

  v_now := clock_timestamp();

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-advocate-lifecycle',
    context_request_id => $5::text,
    context_trace_id => $6,
    context_session_id => v_session_id,
    context_client_ip => $7,
    context_user_agent => $8,
    context_reason => $4,
    context_metadata => jsonb_build_object(
      'operation', v_operation,
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'prior_status', v_advocate.relationship_status::text || '/' ||
        v_advocate.publication_status::text,
      'outcome', v_resulting_relationship_status::text || '/' ||
        v_resulting_publication_status::text
    )
  );

  IF $3 = 'repair' THEN
    INSERT INTO private.advocate_lifecycle_mutation_guards (
      transaction_id,
      advocate_id,
      operation
    )
    VALUES (
      txid_current(),
      v_advocate.id,
      'repair'
    );
  END IF;

  UPDATE public.advocates advocate
  SET
    relationship_status = v_resulting_relationship_status,
    publication_status = v_resulting_publication_status
  WHERE advocate.id = v_advocate.id
    AND advocate.version = $2
  RETURNING advocate.version INTO v_resulting_version;

  IF $3 = 'repair' THEN
    DELETE FROM private.advocate_lifecycle_mutation_guards mutation_guard
    WHERE mutation_guard.transaction_id = txid_current()
      AND mutation_guard.advocate_id = v_advocate.id
      AND mutation_guard.operation = 'repair';
  END IF;

  IF NOT FOUND OR v_resulting_version <> $2 + 1 THEN
    RAISE EXCEPTION 'Advocate portal changed during the lifecycle action'
      USING ERRCODE = '40001';
  END IF;

  /*
   * Every action first fences prior provider authority. Archive also revokes
   * existing deprovision leases so its cooldown and strict cleanup order begin
   * from a single server-owned boundary. Cancelled rows retain the evidence
   * needed to reject settlement with the withdrawn lease token.
   */
  UPDATE public.domain_provisioning_jobs job
  SET
    status = 'cancelled',
    lease_owner = NULL,
    lease_token = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    finished_at = v_now,
    last_error = CASE $3
      WHEN 'suspend' THEN 'advocate_suspended'
      WHEN 'resume' THEN 'advocate_resume_fresh_work'
      WHEN 'archive' THEN 'advocate_archived'
      ELSE 'advocate_repair_fresh_work'
    END
  WHERE job.advocate_id = v_advocate.id
    AND ($3 = 'archive' OR job.kind <> 'deprovision')
    AND job.status IN ('queued', 'running');

  IF $3 IN ('suspend', 'archive') THEN
    UPDATE public.advocate_domain_integrations integration
    SET
      reconciliation_suppressed_at = v_now,
      reconciliation_suppressed_by_user_id = v_actor_user_id,
      reconciliation_suppression_reason = $4
    WHERE integration.advocate_id = v_advocate.id;
  ELSE
    UPDATE public.advocate_domain_integrations integration
    SET
      reconciliation_suppressed_at = NULL,
      reconciliation_suppressed_by_user_id = NULL,
      reconciliation_suppression_reason = NULL
    WHERE integration.advocate_id = v_advocate.id
      AND integration.reconciliation_suppressed_at IS NOT NULL;
  END IF;

  IF $3 = 'suspend' THEN
    FOR v_domain IN
      SELECT domain.*
      FROM public.advocate_domains domain
      WHERE domain.advocate_id = v_advocate.id
      ORDER BY domain.id
    LOOP
      IF v_domain.status = 'pending' THEN
        UPDATE public.advocate_domains domain
        SET status = 'provisioning'
        WHERE domain.id = v_domain.id;
        v_domain.status := 'provisioning';
      END IF;

      IF v_domain.status IN ('provisioning', 'verifying', 'active') THEN
        UPDATE public.advocate_domains domain
        SET
          status = 'failed',
          failure_code = 'administrator_suspended',
          failure_detail = NULL
        WHERE domain.id = v_domain.id;
      ELSIF v_domain.status = 'failed' THEN
        UPDATE public.advocate_domains domain
        SET
          failure_code = 'administrator_suspended',
          failure_detail = NULL
        WHERE domain.id = v_domain.id;
      END IF;
    END LOOP;
  ELSIF $3 IN ('resume', 'repair') THEN
    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id;

    IF FOUND THEN
      IF v_domain.status IN ('active', 'verifying') THEN
        UPDATE public.advocate_domains domain
        SET
          status = 'failed',
          failure_code = CASE
            WHEN $3 = 'resume' THEN 'administrator_resumed'
            ELSE 'administrator_repair_requested'
          END,
          failure_detail = NULL
        WHERE domain.id = v_domain.id;
        v_domain.status := 'failed';
      END IF;

      IF v_domain.status IN ('pending', 'failed', 'disabled') THEN
        UPDATE public.advocate_domains domain
        SET status = 'provisioning'
        WHERE domain.id = v_domain.id;
      END IF;

      FOR v_integration IN
        SELECT integration.*
        FROM public.advocate_domain_integrations integration
        WHERE integration.advocate_id = v_advocate.id
          AND integration.domain_id = v_domain.id
        ORDER BY integration.provider::text, integration.environment
      LOOP
        v_job_kind := CASE
          WHEN v_integration.status IN ('ready', 'provisioning')
            THEN 'reconcile'::public.domain_provisioning_job_kind
          ELSE 'provision'::public.domain_provisioning_job_kind
        END;

        PERFORM private.enqueue_domain_provisioning_job_internal(
          v_domain.id,
          v_integration.id,
          v_job_kind,
          clock_timestamp()
        );
      END LOOP;
    END IF;
  ELSE
    PERFORM pg_catalog.set_config(
      'app.advocate.invitation_operation',
      'revoke',
      true
    );

    UPDATE public.advocate_invitations invitation
    SET
      revoked_at = v_now,
      revoked_by_user_id = v_actor_user_id
    WHERE invitation.advocate_id = v_advocate.id
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL;

    FOR v_domain IN
      SELECT domain.*
      FROM public.advocate_domains domain
      WHERE domain.advocate_id = v_advocate.id
      ORDER BY domain.id
    LOOP
      IF v_domain.status = 'redirecting'
         AND v_domain.redirect_to_domain_id IS NOT NULL THEN
        RAISE EXCEPTION 'Redirecting advocate domain requires manual target reconciliation before archive'
          USING ERRCODE = '55000';
      END IF;

      IF v_domain.status = 'pending' THEN
        UPDATE public.advocate_domains domain
        SET status = 'provisioning'
        WHERE domain.id = v_domain.id;
        v_domain.status := 'provisioning';
      END IF;

      IF v_domain.status IN ('provisioning', 'verifying', 'active', 'failed') THEN
        PERFORM audit.set_actor_context(
          context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
          context_actor_user_id => v_actor_user_id,
          context_tool => 'creator-share-admin-advocate-lifecycle',
          context_request_id => $5::text,
          context_trace_id => $6,
          context_session_id => v_session_id,
          context_client_ip => $7,
          context_user_agent => $8,
          context_reason => $4,
          context_metadata => jsonb_build_object(
            'operation', 'quiesce_domain',
            'resource_kind', 'advocate_domain',
            'resource_id', v_domain.id::text,
            'prior_status', v_domain.status::text,
            'outcome', 'redirecting'
          )
        );
        PERFORM pg_catalog.set_config(
          'app.advocate_domain.quiescing_domain_id',
          v_domain.id::text,
          true
        );
        UPDATE public.advocate_domains domain
        SET
          status = 'redirecting',
          redirect_to_domain_id = NULL
        WHERE domain.id = v_domain.id;
      END IF;

    END LOOP;
  END IF;

  INSERT INTO audit.creator_share_advocate_lifecycle_actions (
    request_id,
    request_binding_sha256,
    actor_user_id,
    advocate_id,
    action,
    expected_advocate_version,
    resulting_advocate_version,
    prior_relationship_status,
    prior_publication_status,
    resulting_relationship_status,
    resulting_publication_status,
    reason,
    trace_id,
    session_id,
    domain_cleanup_requested
  )
  VALUES (
    $5,
    v_request_binding,
    v_actor_user_id,
    v_advocate.id,
    $3,
    $2,
    v_resulting_version,
    v_advocate.relationship_status,
    v_advocate.publication_status,
    v_resulting_relationship_status,
    v_resulting_publication_status,
    $4,
    $6,
    v_session_id,
    v_cleanup_requested
  );

  RETURN QUERY SELECT
    v_advocate.id,
    v_resulting_version,
    v_resulting_relationship_status,
    v_resulting_publication_status,
    v_cleanup_requested;
END;
$$;

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
  'Creator Share super-administrator-only optimistic lifecycle boundary. Exact request replay is immutable. Suspend closes publication and fences provider work without deprovisioning. Resume and repair create fresh provider work but never publish. Archive is irreversible, revokes pending invitations, quiesces the exact hostname, and starts a server-owned cleanup cooldown.';

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_healthy_creator_share_super_admin(
    'list_advocate_controls'
  );

  IF $1 IS NULL OR $1 NOT BETWEEN 1 AND 100
     OR (($2 IS NULL) <> ($3 IS NULL)) THEN
    RAISE EXCEPTION 'Creator Share advocate control list input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    advocate.id,
    advocate.slug,
    advocate.display_name,
    advocate.relationship_status,
    advocate.publication_status,
    advocate.version,
    audit.safe_advocate_delegate_actor_display(owner_membership.user_id),
    domain.hostname,
    domain.status,
    COALESCE(integration_counts.ready_required, 0)::integer,
    COALESCE(integration_counts.required_count, 0)::integer,
    COALESCE(job_counts.open_count, 0)::integer,
    COALESCE(invitation_counts.pending_count, 0)::integer,
    advocate.suspended_at,
    advocate.archived_at,
    advocate.updated_at,
    advocate.created_at
  FROM public.advocates advocate
  LEFT JOIN public.advocate_memberships owner_membership
    ON owner_membership.id = advocate.owner_membership_id
   AND owner_membership.advocate_id = advocate.id
  LEFT JOIN public.advocate_domains domain
    ON domain.advocate_id = advocate.id
   AND domain.is_primary
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE integration.is_required
          AND integration.status = 'ready'
      ) AS ready_required,
      count(*) FILTER (WHERE integration.is_required) AS required_count
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = advocate.id
  ) integration_counts ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS open_count
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = advocate.id
      AND job.status IN ('queued', 'running')
  ) job_counts ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS pending_count
    FROM public.advocate_invitations invitation
    WHERE invitation.advocate_id = advocate.id
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL
      AND invitation.expires_at > now()
  ) invitation_counts ON true
  WHERE ($4 IS NULL OR advocate.relationship_status = $4)
    AND ($5 IS NULL OR advocate.publication_status = $5)
    AND (
      $2 IS NULL
      OR (advocate.created_at, advocate.id) < ($2, $3)
    )
  ORDER BY advocate.created_at DESC, advocate.id DESC
  LIMIT $1;
END;
$$;

COMMENT ON FUNCTION public.list_creator_share_advocate_controls(
  integer,
  timestamp with time zone,
  uuid,
  public.advocate_relationship_status,
  public.advocate_publication_status
) IS
  'Bounded Creator Share super-administrator tenant list. It exposes lifecycle state, privacy-limited owner display, and aggregate operational counts without provider identifiers, payloads, errors, contact details, or raw audit evidence.';

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_healthy_creator_share_super_admin(
    'get_advocate_control_snapshot'
  );

  IF $1 IS NULL THEN
    RAISE EXCEPTION 'Advocate control snapshot target is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    advocate.id,
    advocate.slug,
    advocate.display_name,
    advocate.relationship_status,
    advocate.publication_status,
    advocate.version,
    audit.safe_advocate_delegate_actor_display(owner_membership.user_id),
    domain.id,
    domain.hostname,
    domain.status,
    COALESCE(integration_counts.ready_required, 0)::integer,
    COALESCE(integration_counts.required_count, 0)::integer,
    COALESCE(job_counts.open_count, 0)::integer,
    COALESCE(job_counts.open_deprovision_count, 0)::integer,
    COALESCE(invitation_counts.pending_count, 0)::integer,
    cleanup_state.phase,
    cleanup_state.terminal_job_id IS NOT NULL,
    advocate.relationship_status IN ('invited', 'active')
      AND COALESCE(domain_counts.domain_count, 0) <= 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domains candidate_domain
        WHERE candidate_domain.advocate_id = advocate.id
          AND candidate_domain.status = 'redirecting'
      ),
    advocate.relationship_status = 'suspended'
      AND COALESCE(domain_counts.domain_count, 0) <= 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domains candidate_domain
        WHERE candidate_domain.advocate_id = advocate.id
          AND candidate_domain.status = 'redirecting'
      )
      AND COALESCE(job_counts.open_deprovision_count, 0) = 0
      AND (
        COALESCE(domain_counts.domain_count, 0) = 0
        OR (
          COALESCE(integration_counts.total_count, 0) = 5
          AND COALESCE(integration_counts.expected_required_count, 0) = 5
        )
      ),
    advocate.relationship_status <> 'archived'
      AND COALESCE(domain_counts.domain_count, 0) <= 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domains candidate_domain
        WHERE candidate_domain.advocate_id = advocate.id
          AND candidate_domain.status = 'redirecting'
          AND candidate_domain.redirect_to_domain_id IS NOT NULL
      ),
    advocate.relationship_status = 'active'
      AND COALESCE(domain_counts.domain_count, 0) = 1
      AND COALESCE(integration_counts.total_count, 0) = 5
      AND COALESCE(integration_counts.expected_required_count, 0) = 5
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_domains candidate_domain
        WHERE candidate_domain.advocate_id = advocate.id
          AND candidate_domain.status = 'redirecting'
      )
      AND COALESCE(job_counts.open_deprovision_count, 0) = 0,
    advocate.suspended_at,
    advocate.archived_at,
    advocate.updated_at
  FROM public.advocates advocate
  LEFT JOIN public.advocate_memberships owner_membership
    ON owner_membership.id = advocate.owner_membership_id
   AND owner_membership.advocate_id = advocate.id
  LEFT JOIN public.advocate_domains domain
    ON domain.advocate_id = advocate.id
   AND domain.is_primary
  LEFT JOIN LATERAL private.archived_advocate_domain_cleanup_state(
    advocate.id,
    domain.id
  ) cleanup_state ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS domain_count
    FROM public.advocate_domains candidate_domain
    WHERE candidate_domain.advocate_id = advocate.id
  ) domain_counts ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS total_count,
      count(*) FILTER (
        WHERE integration.is_required
          AND integration.status = 'ready'
      ) AS ready_required,
      count(*) FILTER (WHERE integration.is_required) AS required_count,
      count(*) FILTER (
        WHERE integration.is_required
          AND (
            (integration.provider = 'cloudflare'
              AND integration.environment = 'production')
            OR (integration.provider = 'vercel'
              AND integration.environment = 'production')
            OR (integration.provider = 'stripe_us'
              AND integration.environment = 'live')
            OR (integration.provider = 'stripe_uk'
              AND integration.environment = 'live')
            OR (integration.provider = 'paypal'
              AND integration.environment = 'live')
          )
      ) AS expected_required_count
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = advocate.id
  ) integration_counts ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE job.status IN ('queued', 'running')
      ) AS open_count,
      count(*) FILTER (
        WHERE job.kind = 'deprovision'
          AND job.status IN ('queued', 'running')
      ) AS open_deprovision_count
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = advocate.id
  ) job_counts ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS pending_count
    FROM public.advocate_invitations invitation
    WHERE invitation.advocate_id = advocate.id
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL
      AND invitation.expires_at > now()
  ) invitation_counts ON true
  WHERE advocate.id = $1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid) IS
  'Strict single-tenant Creator Share control snapshot. It returns only lifecycle fields, safe aggregate counts, and server-derived action eligibility. Provider identifiers, payloads, errors, contacts, invitation addresses, and raw audit data are excluded.';

REVOKE ALL ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_advocate_ownership(
  target_advocate_id uuid,
  expected_owner_user_id uuid,
  target_owner_user_id uuid,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_advocate public.advocates%ROWTYPE;
  v_current_owner public.advocate_memberships%ROWTYPE;
  v_target_owner public.advocate_memberships%ROWTYPE;
  v_reason text := btrim($4);
  v_deleted_owner_roles integer;
  v_client_ip text;
  v_user_agent text;
BEGIN
  IF $1 IS NULL
     OR $2 IS NULL
     OR $3 IS NULL
     OR $4 IS NULL
     OR $4 IS DISTINCT FROM v_reason
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR replace(v_reason, E'\n', '') ~ '[[:cntrl:]]'
     OR v_reason ~ '^[[:space:]]'
     OR v_reason ~ '[[:space:]]$'
     OR char_length(COALESCE($5, '')) > 255
     OR char_length(COALESCE($6, '')) > 255
     OR char_length(COALESCE($7, '')) > 255 THEN
    RAISE EXCEPTION 'Advocate ownership transfer input is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'transfer_advocate_ownership'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($1::text, 184219)
  );

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = $1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF private.require_healthy_creator_share_super_admin(
       'transfer_advocate_ownership'
     ) IS DISTINCT FROM v_actor_user_id THEN
    RAISE EXCEPTION 'Creator Share administrator identity changed during ownership transfer'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.relationship_status = 'archived' THEN
    RAISE EXCEPTION 'Archived advocate portals cannot transfer ownership'
      USING ERRCODE = '55000';
  END IF;

  SELECT membership.*
  INTO v_current_owner
  FROM public.advocate_memberships membership
  WHERE membership.id = v_advocate.owner_membership_id
    AND membership.advocate_id = v_advocate.id
  FOR UPDATE;

  IF NOT FOUND
     OR v_current_owner.status <> 'active'
     OR NOT EXISTS (
       SELECT 1
       FROM public.advocate_membership_roles membership_role
       WHERE membership_role.advocate_id = v_advocate.id
         AND membership_role.membership_id = v_current_owner.id
         AND membership_role.role_id =
           '00000000-0000-4000-8000-000000000001'::uuid
     ) THEN
    RAISE EXCEPTION 'Advocate portal does not have a valid active owner'
      USING ERRCODE = '23514';
  END IF;

  IF v_current_owner.user_id IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION 'Advocate ownership changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF $3 = v_current_owner.user_id THEN
    RAISE EXCEPTION 'The target account already owns this advocate portal'
      USING ERRCODE = '23505';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = $3
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= now())
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The target owner must be an active account with a verified email'
      USING ERRCODE = '23503';
  END IF;

  SELECT membership.*
  INTO v_target_owner
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = v_advocate.id
    AND membership.user_id = $3
  FOR UPDATE;

  IF NOT FOUND OR v_target_owner.status <> 'active' THEN
    RAISE EXCEPTION 'The target owner must have an active membership in this advocate portal'
      USING ERRCODE = '23503';
  END IF;

  SELECT transport.client_ip, transport.user_agent
  INTO v_client_ip, v_user_agent
  FROM private.advocate_ownership_transport_contexts transport
  WHERE transport.transaction_id = txid_current()
    AND transport.advocate_id = v_advocate.id;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => $3,
    context_tool => 'creator-share-admin-advocates',
    context_request_id => NULLIF(btrim($5), ''),
    context_trace_id => NULLIF(btrim($6), ''),
    context_session_id => NULLIF(btrim($7), ''),
    context_client_ip => v_client_ip,
    context_user_agent => v_user_agent,
    context_reason => $4,
    context_metadata => jsonb_build_object(
      'operation', 'transfer_ownership',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'role_key', 'owner'
    )
  );

  DELETE FROM public.advocate_membership_roles membership_role
  WHERE membership_role.advocate_id = v_advocate.id
    AND membership_role.membership_id = v_current_owner.id
    AND membership_role.role_id =
      '00000000-0000-4000-8000-000000000001'::uuid;

  GET DIAGNOSTICS v_deleted_owner_roles = ROW_COUNT;

  IF v_deleted_owner_roles <> 1 THEN
    RAISE EXCEPTION 'Advocate ownership changed during transfer'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  VALUES (
    v_advocate.id,
    v_target_owner.id,
    '00000000-0000-4000-8000-000000000001'::uuid,
    v_actor_user_id
  );

  UPDATE public.advocates advocate
  SET owner_membership_id = v_target_owner.id
  WHERE advocate.id = v_advocate.id
    AND advocate.owner_membership_id = v_current_owner.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate ownership changed during transfer'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_advocate.id;
END;
$$;

COMMENT ON FUNCTION public.transfer_advocate_ownership(uuid, uuid, uuid, text, text, text, text) IS
  'Internal compatibility mutation contract for Creator Share ownership transfer. Runtime callers use transfer_creator_share_advocate_ownership for exact request replay. This function still reauthorizes a healthy verified global administrator under lock and preserves the established transfer_ownership audit shape.';

REVOKE ALL ON FUNCTION public.transfer_advocate_ownership(uuid, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_creator_share_advocate_ownership_candidates(
  target_advocate_id uuid,
  page_size integer DEFAULT 100,
  after_membership_id uuid DEFAULT NULL
)
RETURNS TABLE (
  membership_id uuid,
  display_name text,
  membership_status public.advocate_membership_status,
  is_current_owner boolean,
  is_eligible boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_healthy_creator_share_super_admin(
    'list_advocate_ownership_candidates'
  );

  IF $1 IS NULL OR $2 IS NULL OR $2 NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Advocate ownership candidate list input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = $1
  ) THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  RETURN QUERY
  SELECT
    membership.id,
    audit.safe_advocate_delegate_actor_display(membership.user_id),
    membership.status,
    membership.id = advocate.owner_membership_id,
    advocate.relationship_status <> 'archived'
      AND membership.id <> advocate.owner_membership_id
      AND membership.status = 'active'
      AND account.email IS NOT NULL
      AND account.email_confirmed_at IS NOT NULL
      AND account.deleted_at IS NULL
      AND account.is_anonymous IS NOT TRUE
      AND (account.banned_until IS NULL OR account.banned_until <= now())
  FROM public.advocates advocate
  JOIN public.advocate_memberships membership
    ON membership.advocate_id = advocate.id
  JOIN auth.users account ON account.id = membership.user_id
  WHERE advocate.id = $1
    AND ($3 IS NULL OR membership.id > $3)
  ORDER BY membership.id
  LIMIT $2;
END;
$$;

COMMENT ON FUNCTION public.list_creator_share_advocate_ownership_candidates(uuid, integer, uuid) IS
  'Bounded Creator Share super-administrator ownership candidate reader. It returns opaque membership identifiers, privacy-limited labels, lifecycle status, current-owner marker, and server-derived eligibility without exposing auth user identifiers or contact information.';

REVOKE ALL ON FUNCTION public.list_creator_share_advocate_ownership_candidates(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_creator_share_advocate_ownership_candidates(uuid, integer, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_creator_share_advocate_ownership(
  target_advocate_id uuid,
  expected_owner_membership_id uuid,
  target_owner_membership_id uuid,
  change_reason text,
  request_id uuid,
  trace_id text,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_request_binding bytea;
  v_existing audit.creator_share_advocate_ownership_transfers%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_expected_owner_user_id uuid;
  v_target_owner_user_id uuid;
  v_result uuid;
  v_resulting_advocate_version bigint;
  v_reason text := btrim($4);
  v_trace_id text := btrim($6);
  v_session_id text;
BEGIN
  IF $1 IS NULL
     OR $2 IS NULL
     OR $3 IS NULL
     OR $4 IS NULL
     OR $4 IS DISTINCT FROM v_reason
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR replace(v_reason, E'\n', '') ~ '[[:cntrl:]]'
     OR v_reason ~ '^[[:space:]]'
     OR v_reason ~ '[[:space:]]$'
     OR $5 IS NULL
     OR $6 IS NULL
     OR $6 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]'
     OR (
       $7 IS NOT NULL
       AND (
         octet_length($7) NOT BETWEEN 1 AND 256
         OR $7 ~ '[[:cntrl:]]'
       )
     )
     OR (
       $8 IS NOT NULL
       AND (
         octet_length($8) NOT BETWEEN 1 AND 1024
         OR $8 ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Creator Share ownership transfer input is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'transfer_advocate_ownership'
  );
  v_session_id := private.require_signed_auth_session_id();
  v_request_binding := private.creator_share_advocate_ownership_request_binding(
    v_actor_user_id,
    $1,
    $2,
    $3,
    $4,
    $5
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($5::text, 184221)
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($1::text, 184219)
  );

  SELECT transfer_receipt.*
  INTO v_existing
  FROM audit.creator_share_advocate_ownership_transfers transfer_receipt
  WHERE transfer_receipt.request_id = $5
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.request_binding_sha256 IS DISTINCT FROM v_request_binding
       OR v_existing.actor_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing.advocate_id IS DISTINCT FROM $1
       OR v_existing.expected_owner_membership_id IS DISTINCT FROM $2
       OR v_existing.target_owner_membership_id IS DISTINCT FROM $3
       OR v_existing.reason IS DISTINCT FROM $4 THEN
      RAISE EXCEPTION 'Creator Share ownership replay does not match the committed request'
        USING ERRCODE = '40001';
    END IF;

    RETURN v_existing.advocate_id;
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = $1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_advocate.owner_membership_id IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION 'Advocate ownership changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  SELECT membership.user_id
  INTO v_expected_owner_user_id
  FROM public.advocate_memberships membership
  WHERE membership.id = $2
    AND membership.advocate_id = v_advocate.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current advocate owner membership does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT membership.user_id
  INTO v_target_owner_user_id
  FROM public.advocate_memberships membership
  WHERE membership.id = $3
    AND membership.advocate_id = v_advocate.id
    AND membership.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target advocate owner membership is not eligible'
      USING ERRCODE = '23503';
  END IF;

  IF private.require_healthy_creator_share_super_admin(
       'transfer_advocate_ownership'
     ) IS DISTINCT FROM v_actor_user_id THEN
    RAISE EXCEPTION 'Creator Share administrator identity changed during ownership transfer'
      USING ERRCODE = '40001';
  END IF;

  IF $7 IS NOT NULL OR $8 IS NOT NULL THEN
    INSERT INTO private.advocate_ownership_transport_contexts (
      transaction_id,
      advocate_id,
      client_ip,
      user_agent
    )
    VALUES (
      txid_current(),
      v_advocate.id,
      $7,
      $8
    );
  END IF;

  v_result := public.transfer_advocate_ownership(
    v_advocate.id,
    v_expected_owner_user_id,
    v_target_owner_user_id,
    $4,
    $5::text,
    $6,
    v_session_id
  );

  DELETE FROM private.advocate_ownership_transport_contexts transport
  WHERE transport.transaction_id = txid_current()
    AND transport.advocate_id = v_advocate.id;

  SELECT advocate.version
  INTO v_resulting_advocate_version
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate.id
    AND advocate.owner_membership_id = $3
  FOR SHARE;

  IF NOT FOUND OR v_resulting_advocate_version <> v_advocate.version + 1 THEN
    RAISE EXCEPTION 'Advocate ownership result changed during receipt creation'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO audit.creator_share_advocate_ownership_transfers (
    request_id,
    request_binding_sha256,
    actor_user_id,
    advocate_id,
    expected_owner_membership_id,
    target_owner_membership_id,
    resulting_owner_membership_id,
    prior_advocate_version,
    resulting_advocate_version,
    reason,
    trace_id,
    session_id
  )
  VALUES (
    $5,
    v_request_binding,
    v_actor_user_id,
    v_advocate.id,
    $2,
    $3,
    $3,
    v_advocate.version,
    v_resulting_advocate_version,
    $4,
    $6,
    v_session_id
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.transfer_creator_share_advocate_ownership(uuid, uuid, uuid, text, uuid, text, text, text) IS
  'Creator Share super-administrator browser boundary for exact-replay ownership transfer. It accepts tenant-scoped opaque membership identifiers, resolves auth identities only inside the locked transaction, stores an append-only semantic request receipt, and preserves the established creator_share_admin transfer_ownership audit contract.';

REVOKE ALL ON FUNCTION public.transfer_creator_share_advocate_ownership(uuid, uuid, uuid, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_creator_share_advocate_ownership(uuid, uuid, uuid, text, uuid, text, text, text)
  TO authenticated;

REVOKE UPDATE (relationship_status, publication_status)
  ON public.advocates FROM service_role;

COMMIT;

BEGIN;

/*
 * A browser publication operation is durable authority, not a deployment
 * scoped hint. Existing evidence predates this boundary and remains readable
 * to privileged forensic tooling, but every new runtime start and approval
 * records the signed authentication session that authorized it.
 */
ALTER TABLE audit.advocate_publication_canary_starts
  ADD COLUMN initiating_session_id text;

ALTER TABLE audit.advocate_publication_canary_starts
  ADD CONSTRAINT advocate_publication_canary_starts_session_check CHECK (
    initiating_session_id IS NULL
    OR (
      initiating_session_id = btrim(initiating_session_id)
      AND initiating_session_id ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  );

ALTER TABLE audit.advocate_publication_approvals
  ADD COLUMN approving_session_id text;

ALTER TABLE audit.advocate_publication_approvals
  ADD CONSTRAINT advocate_publication_approvals_session_check CHECK (
    approving_session_id IS NULL
    OR (
      approving_session_id = btrim(approving_session_id)
      AND approving_session_id ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  );

COMMENT ON COLUMN audit.advocate_publication_canary_starts.request_id IS
  'For starts created by the current runtime, the exact browser-generated v4 publication operation UUID. Legacy pre-boundary rows may contain a server-derived request UUID.';
COMMENT ON COLUMN audit.advocate_publication_canary_starts.initiating_session_id IS
  'Opaque signed authentication session that authorized the immutable start. Null is reserved for legacy evidence created before session binding.';
COMMENT ON COLUMN audit.advocate_publication_approvals.approving_session_id IS
  'Opaque signed authentication session that authorized publication. It may differ from the initiating session because any current healthy Creator Share super-administrator may resume an exact operation. Null is reserved for legacy evidence.';

CREATE OR REPLACE FUNCTION private.require_active_signed_auth_session_id(
  target_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id text;
  v_session_uuid uuid;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM target_actor_user_id THEN
    RAISE EXCEPTION 'An authenticated Creator Share administrator session is required'
      USING ERRCODE = '28000';
  END IF;

  v_session_id := private.require_signed_auth_session_id();
  v_session_uuid := v_session_id::uuid;

  PERFORM 1
  FROM auth.sessions auth_session
  WHERE auth_session.id = v_session_uuid
    AND auth_session.user_id = target_actor_user_id
    AND auth_session.aal::text IN ('aal1', 'aal2')
    AND (
      auth_session.not_after IS NULL
      OR auth_session.not_after > v_now
    )
  FOR SHARE OF auth_session;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active signed authentication session is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION private.require_active_signed_auth_session_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

/*
 * The existing publication implementation owns the large, proven atomic
 * state transition. This transaction-private guard lets the v2 wrapper carry
 * sanitized transport context through that implementation without adding raw
 * network data to an indefinite semantic receipt.
 */
CREATE TABLE private.advocate_publication_transport_contexts (
  transaction_id bigint PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  session_id text NOT NULL,
  client_ip text,
  user_agent text,
  CONSTRAINT advocate_publication_transport_contexts_session_check CHECK (
    session_id = btrim(session_id)
    AND session_id ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT advocate_publication_transport_contexts_client_ip_check CHECK (
    client_ip IS NULL
    OR (
      octet_length(client_ip) BETWEEN 1 AND 256
      AND client_ip !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT advocate_publication_transport_contexts_user_agent_check CHECK (
    user_agent IS NULL
    OR (
      octet_length(user_agent) BETWEEN 1 AND 1024
      AND user_agent !~ '[[:cntrl:]]'
    )
  )
);

ALTER TABLE private.advocate_publication_transport_contexts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_publication_transport_contexts
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_publication_transport_contexts
  FROM PUBLIC, anon, authenticated, service_role;

/*
 * Publication requires two independent authorities. The authenticated
 * administrator approves the exact reviewed operation, while a server-only
 * deployment capability proves that the currently executing application is
 * the same deployment and revision that produced the canary evidence.
 */
CREATE TABLE private.advocate_publication_deployment_capabilities (
  capability_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE
    REFERENCES audit.advocate_publication_canary_starts(request_id)
    ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  deployment_id text NOT NULL,
  git_revision text NOT NULL,
  report_sha256 bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT advocate_publication_deployment_capabilities_id_check CHECK (
    capability_id::text ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT advocate_publication_deployment_capabilities_deployment_check CHECK (
    deployment_id = btrim(deployment_id)
    AND char_length(deployment_id) BETWEEN 1 AND 255
    AND deployment_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT advocate_publication_deployment_capabilities_revision_check CHECK (
    git_revision ~ '^[0-9a-f]{40}$'
  ),
  CONSTRAINT advocate_publication_deployment_capabilities_report_check CHECK (
    octet_length(report_sha256) = 32
  ),
  CONSTRAINT advocate_publication_deployment_capabilities_window_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '60 seconds'
  )
);

CREATE INDEX advocate_publication_deployment_capabilities_expiry_idx
  ON private.advocate_publication_deployment_capabilities (expires_at);

ALTER TABLE private.advocate_publication_deployment_capabilities
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_publication_deployment_capabilities
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_publication_deployment_capabilities
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.advocate_publication_deployment_capabilities IS
  'Private short-lived single-use proof that a trusted application server matched one successful publication operation to its exact deployment and revision. Capability identities never enter permanent audit receipts or browser status output.';

/*
 * Preserve the established strict metadata vocabulary. Only the publication
 * tool may inherit context from the transaction-private v2 guard.
 */
CREATE OR REPLACE FUNCTION audit.set_actor_context(
  context_actor_type audit.audit_actor_type,
  context_actor_user_id uuid DEFAULT NULL,
  context_effective_user_id uuid DEFAULT NULL,
  context_system_actor text DEFAULT NULL,
  context_tool text DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_session_id text DEFAULT NULL,
  context_provider_event_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL,
  context_reason text DEFAULT NULL,
  context_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_guard private.advocate_publication_transport_contexts%ROWTYPE;
  v_session_id text := context_session_id;
  v_client_ip text := context_client_ip;
  v_user_agent text := context_user_agent;
BEGIN
  IF context_actor_type = 'creator_share_admin'
     AND context_tool = 'creator-share-admin-publication'
     AND context_actor_user_id IS NOT NULL THEN
    SELECT transport.*
    INTO v_guard
    FROM private.advocate_publication_transport_contexts transport
    WHERE transport.transaction_id = txid_current()
      AND transport.actor_user_id = context_actor_user_id;

    IF FOUND THEN
      v_session_id := COALESCE(NULLIF(v_session_id, ''), v_guard.session_id);
      v_client_ip := COALESCE(NULLIF(v_client_ip, ''), v_guard.client_ip);
      v_user_agent := COALESCE(NULLIF(v_user_agent, ''), v_guard.user_agent);
    END IF;
  END IF;

  IF jsonb_typeof(context_metadata) <> 'object' THEN
    RAISE EXCEPTION 'Audit context metadata must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(context_metadata) > 4096 THEN
    RAISE EXCEPTION 'Audit context metadata exceeds 4096 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(context_metadata) entry
    WHERE entry.key <> ALL (ARRAY[
      'operation',
      'resource_kind',
      'resource_id',
      'outcome',
      'job_id',
      'batch_id',
      'provider',
      'provider_account_scope',
      'event_type',
      'retry_count',
      'correlation_id',
      'deployment_id',
      'domain_hostname',
      'permission_key',
      'role_key',
      'prior_status',
      'manual_review_code',
      'ownership_conflict',
      'observed_provider_product_id',
      'observed_provider_plan_id',
      'evidence_sha256',
      'canary_completed_at',
      'publication_binding_sha256'
    ]::text[])
      OR jsonb_typeof(entry.value) NOT IN ('string', 'number', 'boolean', 'null')
  ) THEN
    RAISE EXCEPTION 'Audit context metadata contains an unsupported key or value type'
      USING ERRCODE = '22023';
  END IF;

  IF context_actor_type = 'system'
     AND nullif(btrim(context_system_actor), '') IS NULL THEN
    RAISE EXCEPTION 'System audit context requires a named system actor'
      USING ERRCODE = '22023';
  END IF;

  IF context_actor_type IN ('user', 'creator_share_admin')
     AND context_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'User audit context requires an actor user id'
      USING ERRCODE = '22023';
  END IF;

  IF length(COALESCE(context_system_actor, '')) > 200
     OR length(COALESCE(context_tool, '')) > 200
     OR length(COALESCE(context_request_id, '')) > 255
     OR length(COALESCE(context_trace_id, '')) > 255
     OR length(COALESCE(v_session_id, '')) > 255
     OR length(COALESCE(context_provider_event_id, '')) > 255
     OR length(COALESCE(context_reason, '')) > 2000 THEN
    RAISE EXCEPTION 'Audit context field exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.audit.actor_type', context_actor_type::text, true);
  PERFORM pg_catalog.set_config('app.audit.actor_user_id', COALESCE(context_actor_user_id::text, ''), true);
  PERFORM pg_catalog.set_config('app.audit.effective_user_id', COALESCE(context_effective_user_id::text, ''), true);
  PERFORM pg_catalog.set_config('app.audit.system_actor', COALESCE(context_system_actor, ''), true);
  PERFORM pg_catalog.set_config('app.audit.tool', COALESCE(context_tool, ''), true);
  PERFORM pg_catalog.set_config('app.audit.request_id', COALESCE(context_request_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.trace_id', COALESCE(context_trace_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.session_id', COALESCE(v_session_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.provider_event_id', COALESCE(context_provider_event_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.client_ip', COALESCE(v_client_ip, ''), true);
  PERFORM pg_catalog.set_config('app.audit.user_agent', COALESCE(v_user_agent, ''), true);
  PERFORM pg_catalog.set_config('app.audit.reason', COALESCE(context_reason, ''), true);
  PERFORM pg_catalog.set_config('app.audit.metadata', context_metadata::text, true);
END;
$$;

/*
 * Bind the approving session only when the transaction-private v2 authority is
 * present. Historical and privileged database evidence may remain null.
 */
CREATE OR REPLACE FUNCTION private.bind_advocate_publication_approval_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_guard private.advocate_publication_transport_contexts%ROWTYPE;
  v_operation_id uuid;
BEGIN
  SELECT start.request_id
  INTO v_operation_id
  FROM audit.advocate_publication_canary_starts start
  WHERE start.run_id = NEW.canary_run_id;

  SELECT transport.*
  INTO v_guard
  FROM private.advocate_publication_transport_contexts transport
  WHERE transport.transaction_id = txid_current()
    AND transport.actor_user_id = NEW.approving_user_id
    AND transport.operation_id = v_operation_id;

  IF FOUND THEN
    NEW.approving_session_id := v_guard.session_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.bind_advocate_publication_approval_session()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_publication_approvals_00_bind_session
BEFORE INSERT ON audit.advocate_publication_approvals
FOR EACH ROW
EXECUTE FUNCTION private.bind_advocate_publication_approval_session();

/*
 * Add one database-derived publication eligibility flag without weakening the
 * existing snapshot authorization or exposing provider identifiers.
 */
ALTER FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  RENAME TO get_creator_share_advocate_control_snapshot_without_publication;

REVOKE ALL ON FUNCTION public.get_creator_share_advocate_control_snapshot_without_publication(uuid)
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
  can_begin_publication_canary boolean,
  suspended_at timestamp with time zone,
  archived_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    snapshot.advocate_id,
    snapshot.slug,
    snapshot.display_name,
    snapshot.relationship_status,
    snapshot.publication_status,
    snapshot.advocate_version,
    snapshot.owner_display_name,
    snapshot.ownership_status,
    snapshot.can_reissue_initial_owner,
    snapshot.can_revoke_initial_owner,
    snapshot.primary_domain_id,
    snapshot.primary_hostname,
    snapshot.primary_domain_status,
    snapshot.ready_required_integrations,
    snapshot.required_integrations,
    snapshot.open_provider_jobs,
    snapshot.open_deprovision_jobs,
    snapshot.pending_invitations,
    snapshot.cleanup_phase,
    snapshot.can_retry_cleanup,
    snapshot.can_suspend,
    snapshot.can_resume,
    snapshot.can_archive,
    snapshot.can_repair,
    snapshot.relationship_status = 'active'
      AND snapshot.publication_status IN (
        'draft',
        'provisioning',
        'failed',
        'active'
      )
      AND snapshot.primary_domain_status = 'verifying'
      AND snapshot.ready_required_integrations = 5
      AND snapshot.required_integrations = 5
      AND snapshot.open_provider_jobs = 0
      AND private.advocate_publication_provider_binding_sha256(
        snapshot.advocate_id,
        snapshot.primary_domain_id,
        clock_timestamp()
      ) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM audit.advocate_publication_canary_starts start
        LEFT JOIN audit.advocate_publication_canary_reports report
          ON report.run_id = start.run_id
        WHERE start.advocate_id = snapshot.advocate_id
          AND start.expected_advocate_version = snapshot.advocate_version
          AND start.started_at + interval '30 minutes' > clock_timestamp()
          AND (
            report.run_id IS NULL
            OR report.outcome = 'succeeded'
          )
      ),
    snapshot.suspended_at,
    snapshot.archived_at,
    snapshot.updated_at
  FROM public.get_creator_share_advocate_control_snapshot_without_publication(
    target_advocate_id
  ) snapshot;
$$;

REVOKE ALL ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_creator_share_advocate_control_snapshot(uuid) IS
  'Strict Creator Share control snapshot with privacy-safe owner state and a server-derived publication-canary eligibility flag based on exact fresh five-provider readiness and absence of unexpired unfinished or successful work.';

CREATE OR REPLACE FUNCTION public.begin_or_resume_advocate_publication_canary(
  target_advocate_id uuid,
  target_expected_advocate_version bigint,
  target_operation_id uuid,
  target_deployment_id text,
  target_git_revision text,
  target_trace_id text,
  target_admin_reason text,
  target_client_ip text DEFAULT NULL,
  target_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  operation_id uuid,
  run_id uuid,
  advocate_id uuid,
  expected_advocate_version bigint,
  deployment_id text,
  revision text,
  started_at timestamp with time zone,
  outcome text,
  failure_code text,
  report_sha256 bytea,
  completed_at timestamp with time zone,
  published_advocate_version bigint,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_session_id text;
  v_reauthorized_user_id uuid;
  v_reauthorized_session_id text;
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_existing audit.advocate_publication_canary_starts%ROWTYPE;
  v_deployment_id text := btrim($4);
  v_trace_id text := btrim($6);
  v_admin_reason text := btrim($7);
  v_now timestamp with time zone := clock_timestamp();
  v_binding_sha256 bytea;
  v_run_id uuid := gen_random_uuid();
  v_stripe_us_attempt_id uuid := gen_random_uuid();
  v_stripe_uk_attempt_id uuid := gen_random_uuid();
  v_paypal_attempt_id uuid := gen_random_uuid();
  v_started_at timestamp with time zone;
BEGIN
  IF $1 IS NULL
     OR $2 IS NULL
     OR $2 < 1
     OR $3 IS NULL
     OR $3::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR $4 IS NULL
     OR $4 IS DISTINCT FROM v_deployment_id
     OR char_length(v_deployment_id) NOT BETWEEN 1 AND 255
     OR v_deployment_id ~ '[[:cntrl:]]'
     OR $5 IS NULL
     OR $5 !~ '^[0-9a-f]{40}$'
     OR $6 IS NULL
     OR $6 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]'
     OR $7 IS NULL
     OR $7 IS DISTINCT FROM v_admin_reason
     OR char_length(v_admin_reason) NOT BETWEEN 1 AND 2000
     OR replace(v_admin_reason, E'\n', '') ~ '[[:cntrl:]]'
     OR v_admin_reason ~ '^[[:space:]]'
     OR v_admin_reason ~ '[[:space:]]$'
     OR (
       $8 IS NOT NULL
       AND (
         octet_length($8) NOT BETWEEN 1 AND 256
         OR $8 ~ '[[:cntrl:]]'
       )
     )
     OR (
       $9 IS NOT NULL
       AND (
         octet_length($9) NOT BETWEEN 1 AND 1024
         OR $9 ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Advocate publication operation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'begin_or_resume_advocate_publication_canary'
  );
  v_session_id := private.require_active_signed_auth_session_id(
    v_actor_user_id
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($3::text, 731929)
  );

  SELECT start.*
  INTO v_existing
  FROM audit.advocate_publication_canary_starts start
  WHERE start.request_id = $3
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.advocate_id IS DISTINCT FROM $1
       OR v_existing.expected_advocate_version IS DISTINCT FROM $2
       OR v_existing.admin_reason IS DISTINCT FROM $7 THEN
      RAISE EXCEPTION 'Advocate publication operation does not match the committed request'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY
    SELECT
      v_existing.request_id,
      v_existing.run_id,
      v_existing.advocate_id,
      v_existing.expected_advocate_version,
      v_existing.deployment_id,
      v_existing.git_revision,
      v_existing.started_at,
      report.outcome,
      report.failure_code,
      report.report_sha256,
      report.completed_at,
      approval.resulting_advocate_version,
      false
    FROM (SELECT 1) singleton
    LEFT JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = v_existing.run_id
    LEFT JOIN audit.advocate_publication_approvals approval
      ON approval.canary_run_id = v_existing.run_id;
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
    RAISE EXCEPTION 'Advocate portal version changed before canary start'
      USING ERRCODE = '40001';
  END IF;

  v_now := clock_timestamp();
  IF EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_starts start
    LEFT JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = start.run_id
    LEFT JOIN audit.advocate_publication_approvals approval
      ON approval.canary_run_id = start.run_id
    WHERE start.request_id <> $3
      AND start.advocate_id = $1
      AND start.expected_advocate_version = $2
      AND start.started_at + interval '30 minutes' > v_now
      AND approval.canary_run_id IS NULL
      AND (
        report.run_id IS NULL
        OR report.outcome = 'succeeded'
      )
  ) THEN
    RAISE EXCEPTION 'An advocate publication operation is already in progress'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'failed',
       'active'
     ) THEN
    RAISE EXCEPTION 'Advocate portal is not eligible for a publication canary'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
      AND domain.is_primary
      AND domain.hostname = v_advocate.slug || '.creatorshare.com'
      AND domain.status = 'verifying'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during canary start'
      USING ERRCODE = '40001';
  END;

  IF NOT FOUND OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
      AND domain.id <> v_domain.id
  ) THEN
    RAISE EXCEPTION 'Exact verifying advocate primary domain does not match'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    PERFORM integration.id
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_advocate.id
      AND integration.domain_id = v_domain.id
    ORDER BY integration.provider::text, integration.environment
    FOR SHARE NOWAIT;

    PERFORM job.id
    FROM public.advocate_domain_integrations integration
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.advocate_id = integration.advocate_id
     AND job.domain_id = integration.domain_id
     AND job.integration_id = integration.id
     AND job.provider = integration.provider
    WHERE integration.advocate_id = v_advocate.id
      AND integration.domain_id = v_domain.id
    ORDER BY integration.provider::text, integration.environment
    FOR SHARE OF job NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during canary start'
      USING ERRCODE = '40001';
  END;

  v_now := clock_timestamp();
  v_binding_sha256 :=
    private.advocate_publication_provider_binding_sha256(
      v_advocate.id,
      v_domain.id,
      v_now
    );

  IF v_binding_sha256 IS NULL THEN
    RAISE EXCEPTION 'Exact five-provider readiness evidence is not publishable'
      USING ERRCODE = '55000';
  END IF;

  v_reauthorized_user_id :=
    private.require_healthy_creator_share_super_admin(
      'begin_or_resume_advocate_publication_canary'
    );
  v_reauthorized_session_id :=
    private.require_active_signed_auth_session_id(v_reauthorized_user_id);

  IF v_reauthorized_user_id IS DISTINCT FROM v_actor_user_id
     OR v_reauthorized_session_id IS DISTINCT FROM v_session_id THEN
    RAISE EXCEPTION 'Creator Share administrator authority changed during canary start'
      USING ERRCODE = '40001';
  END IF;

  v_started_at := clock_timestamp();

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-publication-canary',
    context_request_id => $3::text,
    context_trace_id => $6,
    context_session_id => v_session_id,
    context_client_ip => $8,
    context_user_agent => $9,
    context_reason => $7,
    context_metadata => jsonb_build_object(
      'operation', 'begin_publication_canary',
      'resource_kind', 'advocate_publication_canary',
      'resource_id', v_run_id::text,
      'outcome', 'started',
      'correlation_id', v_run_id::text,
      'deployment_id', $4,
      'domain_hostname', v_domain.hostname,
      'publication_binding_sha256', encode(v_binding_sha256, 'hex')
    )
  );

  INSERT INTO audit.advocate_publication_canary_starts (
    run_id,
    request_id,
    initiating_user_id,
    initiating_session_id,
    advocate_id,
    expected_advocate_version,
    domain_id,
    hostname,
    deployment_id,
    git_revision,
    trace_id,
    admin_reason,
    provider_evidence_binding_sha256,
    stripe_us_attempt_id,
    stripe_uk_attempt_id,
    paypal_attempt_id,
    started_at
  )
  VALUES (
    v_run_id,
    $3,
    v_actor_user_id,
    v_session_id,
    v_advocate.id,
    $2,
    v_domain.id,
    v_domain.hostname,
    $4,
    $5,
    $6,
    $7,
    v_binding_sha256,
    v_stripe_us_attempt_id,
    v_stripe_uk_attempt_id,
    v_paypal_attempt_id,
    v_started_at
  );

  RETURN QUERY SELECT
    $3,
    v_run_id,
    v_advocate.id,
    $2,
    $4,
    $5,
    v_started_at,
    NULL::text,
    NULL::text,
    NULL::bytea,
    NULL::timestamp with time zone,
    NULL::bigint,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_or_resume_advocate_publication_canary(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_or_resume_advocate_publication_canary(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.begin_or_resume_advocate_publication_canary(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Authenticated healthy Creator Share super-administrator begin-or-resume boundary. A browser v4 operation UUID creates at most one immutable run, its first deployment binding survives later deployments, every poll reauthorizes in the database, and raw transport context remains only in the expiring forensic audit layer.';

CREATE OR REPLACE FUNCTION public.mint_advocate_publication_deployment_capability(
  target_operation_id uuid,
  target_canary_run_id uuid,
  target_deployment_id text,
  target_git_revision text
)
RETURNS TABLE (
  deployment_capability_id uuid,
  expires_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start audit.advocate_publication_canary_starts%ROWTYPE;
  v_report audit.advocate_publication_canary_reports%ROWTYPE;
  v_existing private.advocate_publication_deployment_capabilities%ROWTYPE;
  v_deployment_id text := btrim($3);
  v_now timestamp with time zone := clock_timestamp();
  v_capability_id uuid := gen_random_uuid();
  v_expires_at timestamp with time zone;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Publication deployment capability service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF $1 IS NULL
     OR $1::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR $2 IS NULL
     OR $3 IS NULL
     OR $3 IS DISTINCT FROM v_deployment_id
     OR char_length(v_deployment_id) NOT BETWEEN 1 AND 255
     OR v_deployment_id ~ '[[:cntrl:]]'
     OR $4 IS NULL
     OR $4 !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Publication deployment capability input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($1::text, 731929)
  );

  DELETE FROM private.advocate_publication_deployment_capabilities capability
  WHERE capability.expires_at <= v_now;

  SELECT start.*
  INTO v_start
  FROM audit.advocate_publication_canary_starts start
  WHERE start.request_id = $1
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate publication operation does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_start.initiating_session_id IS NULL
     OR v_start.run_id IS DISTINCT FROM $2
     OR v_start.deployment_id IS DISTINCT FROM $3
     OR v_start.git_revision IS DISTINCT FROM $4 THEN
    RAISE EXCEPTION 'Publication deployment capability does not match the committed operation'
      USING ERRCODE = '40001';
  END IF;

  SELECT report.*
  INTO v_report
  FROM audit.advocate_publication_canary_reports report
  WHERE report.run_id = v_start.run_id
  FOR SHARE;

  IF NOT FOUND
     OR v_report.outcome <> 'succeeded'
     OR v_report.failure_code IS NOT NULL THEN
    RAISE EXCEPTION 'Successful advocate publication canary evidence is required'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit.advocate_publication_approvals approval
    WHERE approval.canary_run_id = v_start.run_id
  ) THEN
    RAISE EXCEPTION 'Advocate publication is already committed'
      USING ERRCODE = '55000';
  END IF;

  v_now := clock_timestamp();
  IF v_start.started_at < v_now - interval '30 minutes'
     OR v_start.started_at > v_now + interval '1 minute'
     OR v_report.completed_at < v_start.started_at
     OR v_report.completed_at > v_start.started_at + interval '30 minutes'
     OR v_report.completed_at < v_now - interval '30 minutes'
     OR v_report.completed_at > v_now + interval '1 minute' THEN
    RAISE EXCEPTION 'Advocate publication canary evidence is expired'
      USING ERRCODE = '55000';
  END IF;

  SELECT capability.*
  INTO v_existing
  FROM private.advocate_publication_deployment_capabilities capability
  WHERE capability.operation_id = v_start.request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.run_id IS DISTINCT FROM v_start.run_id
       OR v_existing.deployment_id IS DISTINCT FROM v_start.deployment_id
       OR v_existing.git_revision IS DISTINCT FROM v_start.git_revision
       OR v_existing.report_sha256 IS DISTINCT FROM v_report.report_sha256
       OR v_existing.expires_at <= v_now THEN
      RAISE EXCEPTION 'Existing publication deployment capability binding is invalid'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT v_existing.capability_id, v_existing.expires_at;
    RETURN;
  END IF;

  v_expires_at := LEAST(
    v_now + interval '60 seconds',
    v_start.started_at + interval '30 minutes',
    v_report.completed_at + interval '30 minutes'
  );

  IF v_expires_at <= v_now THEN
    RAISE EXCEPTION 'Advocate publication canary evidence is expired'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO private.advocate_publication_deployment_capabilities (
    capability_id,
    operation_id,
    run_id,
    deployment_id,
    git_revision,
    report_sha256,
    created_at,
    expires_at
  )
  VALUES (
    v_capability_id,
    v_start.request_id,
    v_start.run_id,
    v_start.deployment_id,
    v_start.git_revision,
    v_report.report_sha256,
    v_now,
    v_expires_at
  );

  RETURN QUERY SELECT v_capability_id, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_advocate_publication_deployment_capability(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mint_advocate_publication_deployment_capability(
  uuid,
  uuid,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.mint_advocate_publication_deployment_capability(
  uuid,
  uuid,
  text,
  text
) IS
  'Service-role-only deployment attestation. It returns one database-generated short-lived capability only when a new-runtime operation has fresh successful evidence from the exact requesting deployment and revision. It never grants publication authority by itself.';

CREATE OR REPLACE FUNCTION public.publish_advocate_portal_from_canary_v2(
  target_advocate_id uuid,
  target_expected_advocate_version bigint,
  target_operation_id uuid,
  target_canary_run_id uuid,
  target_deployment_id text,
  target_report_sha256 bytea,
  target_admin_reason text,
  target_request_id uuid,
  target_trace_id text,
  target_deployment_capability_id uuid,
  target_client_ip text DEFAULT NULL,
  target_user_agent text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_session_id text;
  v_deployment_id text := btrim($5);
  v_admin_reason text := btrim($7);
  v_trace_id text := btrim($9);
  v_start audit.advocate_publication_canary_starts%ROWTYPE;
  v_report audit.advocate_publication_canary_reports%ROWTYPE;
  v_approval audit.advocate_publication_approvals%ROWTYPE;
  v_capability private.advocate_publication_deployment_capabilities%ROWTYPE;
  v_now timestamp with time zone;
  v_consumed_capability_id uuid;
  v_result bigint;
BEGIN
  IF $1 IS NULL
     OR $2 IS NULL
     OR $2 < 1
     OR $3 IS NULL
     OR $3::text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR $4 IS NULL
     OR $5 IS NULL
     OR $5 IS DISTINCT FROM v_deployment_id
     OR char_length(v_deployment_id) NOT BETWEEN 1 AND 255
     OR v_deployment_id ~ '[[:cntrl:]]'
     OR $6 IS NULL
     OR octet_length($6) <> 32
     OR $7 IS NULL
     OR $7 IS DISTINCT FROM v_admin_reason
     OR char_length(v_admin_reason) NOT BETWEEN 1 AND 2000
     OR replace(v_admin_reason, E'\n', '') ~ '[[:cntrl:]]'
     OR v_admin_reason ~ '^[[:space:]]'
     OR v_admin_reason ~ '[[:space:]]$'
     OR $8 IS NULL
     OR $9 IS NULL
     OR $9 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]'
     OR (
       $10 IS NOT NULL
       AND $10::text !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR (
       $11 IS NOT NULL
       AND (
         octet_length($11) NOT BETWEEN 1 AND 256
         OR $11 ~ '[[:cntrl:]]'
       )
     )
     OR (
       $12 IS NOT NULL
       AND (
         octet_length($12) NOT BETWEEN 1 AND 1024
         OR $12 ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Advocate publication approval input is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'publish_advocate_portal_from_canary'
  );
  v_session_id := private.require_active_signed_auth_session_id(
    v_actor_user_id
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($3::text, 731929)
  );

  v_now := clock_timestamp();
  DELETE FROM private.advocate_publication_deployment_capabilities capability
  WHERE capability.expires_at <= v_now;

  SELECT start.*
  INTO v_start
  FROM audit.advocate_publication_canary_starts start
  WHERE start.request_id = $3
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate publication operation does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_start.initiating_session_id IS NULL
     OR v_start.advocate_id IS DISTINCT FROM $1
     OR v_start.expected_advocate_version IS DISTINCT FROM $2
     OR v_start.run_id IS DISTINCT FROM $4
     OR v_start.deployment_id IS DISTINCT FROM $5
     OR v_start.admin_reason IS DISTINCT FROM $7 THEN
    RAISE EXCEPTION 'Advocate publication approval does not match the committed operation'
      USING ERRCODE = '40001';
  END IF;

  SELECT approval.*
  INTO v_approval
  FROM audit.advocate_publication_approvals approval
  WHERE approval.canary_run_id = v_start.run_id
  FOR SHARE;

  /*
   * A committed publication response may be lost across navigation or a new
   * deployment. Exact immutable replay therefore wins before any inspection
   * of current portal, domain, or provider state.
   */
  IF FOUND THEN
    IF v_approval.request_id IS DISTINCT FROM $8
       OR v_approval.advocate_id IS DISTINCT FROM $1
       OR v_approval.expected_advocate_version IS DISTINCT FROM $2
       OR v_approval.deployment_id IS DISTINCT FROM $5
       OR v_approval.report_sha256 IS DISTINCT FROM $6
       OR v_approval.admin_reason IS DISTINCT FROM $7 THEN
      RAISE EXCEPTION 'Committed advocate publication does not match the exact replay'
        USING ERRCODE = '40001';
    END IF;

    RETURN v_approval.resulting_advocate_version;
  END IF;

  SELECT report.*
  INTO v_report
  FROM audit.advocate_publication_canary_reports report
  WHERE report.run_id = v_start.run_id
  FOR SHARE;

  IF NOT FOUND
     OR v_report.outcome <> 'succeeded'
     OR v_report.failure_code IS NOT NULL
     OR v_report.report_sha256 IS DISTINCT FROM $6 THEN
    RAISE EXCEPTION 'Successful advocate publication canary evidence does not match'
      USING ERRCODE = '55000';
  END IF;

  IF $10 IS NULL THEN
    RAISE EXCEPTION 'A current server deployment capability is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT capability.*
  INTO v_capability
  FROM private.advocate_publication_deployment_capabilities capability
  WHERE capability.capability_id = $10
  FOR UPDATE;

  IF NOT FOUND
     OR v_capability.operation_id IS DISTINCT FROM v_start.request_id
     OR v_capability.run_id IS DISTINCT FROM v_start.run_id
     OR v_capability.deployment_id IS DISTINCT FROM v_start.deployment_id
     OR v_capability.git_revision IS DISTINCT FROM v_start.git_revision
     OR v_capability.report_sha256 IS DISTINCT FROM v_report.report_sha256
     OR v_capability.expires_at <= v_now THEN
    RAISE EXCEPTION 'Current server deployment capability does not match'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM private.advocate_publication_deployment_capabilities capability
  WHERE capability.capability_id = v_capability.capability_id
    AND capability.operation_id = v_start.request_id
    AND capability.run_id = v_start.run_id
    AND capability.deployment_id = v_start.deployment_id
    AND capability.git_revision = v_start.git_revision
    AND capability.report_sha256 = v_report.report_sha256
    AND capability.expires_at > clock_timestamp()
  RETURNING capability.capability_id INTO v_consumed_capability_id;

  IF v_consumed_capability_id IS DISTINCT FROM v_capability.capability_id THEN
    RAISE EXCEPTION 'Current server deployment capability changed before use'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO private.advocate_publication_transport_contexts (
    transaction_id,
    actor_user_id,
    operation_id,
    session_id,
    client_ip,
    user_agent
  )
  VALUES (
    txid_current(),
    v_actor_user_id,
    $3,
    v_session_id,
    $11,
    $12
  );

  v_result := public.publish_advocate_portal_from_canary(
    $1,
    $2,
    $4,
    v_start.deployment_id,
    $6,
    $7,
    $8,
    $9
  );

  SELECT approval.*
  INTO v_approval
  FROM audit.advocate_publication_approvals approval
  WHERE approval.request_id = $8
    AND approval.canary_run_id = $4
  FOR SHARE;

  IF NOT FOUND
     OR v_approval.approving_user_id IS DISTINCT FROM v_actor_user_id
     OR v_approval.approving_session_id IS DISTINCT FROM v_session_id
     OR v_approval.resulting_advocate_version IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION 'Advocate publication approval session binding failed'
      USING ERRCODE = '40001';
  END IF;

  DELETE FROM private.advocate_publication_transport_contexts transport
  WHERE transport.transaction_id = txid_current()
    AND transport.actor_user_id = v_actor_user_id
    AND transport.operation_id = $3;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_advocate_portal_from_canary_v2(
  uuid,
  bigint,
  uuid,
  uuid,
  text,
  bytea,
  text,
  uuid,
  text,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_advocate_portal_from_canary_v2(
  uuid,
  bigint,
  uuid,
  uuid,
  text,
  bytea,
  text,
  uuid,
  text,
  uuid,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.publish_advocate_portal_from_canary_v2(
  uuid,
  bigint,
  uuid,
  uuid,
  text,
  bytea,
  text,
  uuid,
  text,
  uuid,
  text,
  text
) IS
  'Dual-authority publication boundary for an exact browser operation. First publication requires both a current healthy Creator Share super-administrator with a signed session and one unexpired single-use capability minted by the trusted current deployment. Exact committed replay remains authenticated but needs no new capability.';

/* Retire every previous browser authority after the replacements exist. */
REVOKE EXECUTE ON FUNCTION public.begin_advocate_publication_canary(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.get_advocate_publication_canary_execution(uuid)
  FROM service_role;

REVOKE EXECUTE ON FUNCTION public.publish_advocate_portal_from_canary(
  uuid,
  bigint,
  uuid,
  text,
  bytea,
  text,
  uuid,
  text
) FROM authenticated;

COMMIT;

BEGIN;

-- Logo uploads cross a provider boundary before the branding aggregate can be
-- updated. A durable reservation binds that provider write to one authorized
-- actor, tenant, aggregate version, request, and immutable object path.

DO $$ BEGIN
  CREATE TYPE private.advocate_logo_upload_reservation_status AS ENUM (
    'pending',
    'attached',
    'cancelled',
    'cleanup_required',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE private.advocate_logo_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expected_advocate_version bigint NOT NULL,
  object_path text NOT NULL UNIQUE,
  status private.advocate_logo_upload_reservation_status NOT NULL DEFAULT 'pending',
  request_id text NOT NULL,
  trace_id text,
  failure_code text,
  resulting_advocate_version bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  CONSTRAINT advocate_logo_upload_reservations_version_check CHECK (
    expected_advocate_version > 0
  ),
  CONSTRAINT advocate_logo_upload_reservations_path_check CHECK (
    object_path ~
      '^logos/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    AND split_part(object_path, '/', 3) = id::text || '.webp'
  ),
  CONSTRAINT advocate_logo_upload_reservations_request_check CHECK (
    request_id = btrim(request_id)
    AND char_length(request_id) BETWEEN 1 AND 255
  ),
  CONSTRAINT advocate_logo_upload_reservations_trace_check CHECK (
    trace_id IS NULL
    OR (
      trace_id = btrim(trace_id)
      AND char_length(trace_id) BETWEEN 1 AND 255
    )
  ),
  CONSTRAINT advocate_logo_upload_reservations_failure_check CHECK (
    failure_code IS NULL
    OR (
      char_length(failure_code) BETWEEN 1 AND 120
      AND failure_code ~ '^[a-z0-9][a-z0-9._:-]*$'
    )
  ),
  CONSTRAINT advocate_logo_upload_reservations_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '15 minutes'
  ),
  CONSTRAINT advocate_logo_upload_reservations_lifecycle_check CHECK (
    (
      status = 'pending'
      AND settled_at IS NULL
      AND failure_code IS NULL
      AND resulting_advocate_version IS NULL
    )
    OR (
      status = 'attached'
      AND settled_at IS NOT NULL
      AND failure_code IS NULL
      AND resulting_advocate_version = expected_advocate_version + 1
    )
    OR (
      status IN ('cancelled', 'cleanup_required', 'expired')
      AND settled_at IS NOT NULL
      AND failure_code IS NOT NULL
      AND resulting_advocate_version IS NULL
    )
  )
);

CREATE UNIQUE INDEX advocate_logo_upload_one_pending_version_uidx
  ON private.advocate_logo_upload_reservations (
    advocate_id,
    expected_advocate_version
  )
  WHERE status = 'pending';

CREATE INDEX advocate_logo_upload_actor_rate_idx
  ON private.advocate_logo_upload_reservations (
    actor_user_id,
    created_at DESC
  );

CREATE INDEX advocate_logo_upload_tenant_rate_idx
  ON private.advocate_logo_upload_reservations (
    advocate_id,
    created_at DESC
  );

COMMENT ON TABLE private.advocate_logo_upload_reservations IS
  'Durable authorization, single-flight, and rolling-rate-limit evidence for immutable advocate logo uploads. Provider bytes and source metadata are never stored here.';
COMMENT ON COLUMN private.advocate_logo_upload_reservations.object_path IS
  'Server-issued logos/<locked advocate slug>/<reservation UUID>.webp path. It is immutable and can be attached only by the matching branding transaction.';
COMMENT ON COLUMN private.advocate_logo_upload_reservations.failure_code IS
  'Bounded non-sensitive lifecycle code only. Provider messages, source names, and response bodies are prohibited.';
COMMENT ON COLUMN private.advocate_logo_upload_reservations.resulting_advocate_version IS
  'Exact aggregate version committed by the atomic branding attachment. Null for every state except attached.';

ALTER TABLE private.advocate_logo_upload_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_logo_upload_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_logo_upload_reservations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TYPE private.advocate_logo_upload_reservation_status
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_advocate_logo_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Advocate logo RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Advocate logo RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_advocate_logo_service_role()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_advocate_logo_upload_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT advocate.slug
    INTO v_slug
    FROM public.advocates advocate
    WHERE advocate.id = NEW.advocate_id;

    IF v_slug IS NULL
       OR NEW.object_path IS DISTINCT FROM
         'logos/' || v_slug || '/' || NEW.id::text || '.webp' THEN
      RAISE EXCEPTION 'Logo reservation path violates the tenant boundary'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.expected_advocate_version IS DISTINCT FROM OLD.expected_advocate_version
     OR NEW.object_path IS DISTINCT FROM OLD.object_path
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Logo reservation identity and evidence are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Terminal logo reservations are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status NOT IN ('attached', 'cancelled', 'cleanup_required', 'expired') THEN
    RAISE EXCEPTION 'Logo reservation lifecycle transition is invalid'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_advocate_logo_upload_reservation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_logo_upload_reservations_protect
BEFORE INSERT OR UPDATE ON private.advocate_logo_upload_reservations
FOR EACH ROW EXECUTE FUNCTION private.protect_advocate_logo_upload_reservation();

CREATE TRIGGER advocate_logo_upload_reservations_audit_row_change
AFTER INSERT OR UPDATE OR DELETE
ON private.advocate_logo_upload_reservations
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  '@columns_only'
);

-- Reservations are user-initiated portal changes. Expose their columns-only
-- ledger entries through the same sanitized tenant audit surface.
CREATE OR REPLACE FUNCTION public.get_advocate_audit_events(
  target_advocate_id uuid,
  before_sequence bigint DEFAULT NULL,
  page_size integer DEFAULT 50
)
RETURNS TABLE (
  sequence_id bigint,
  event_id uuid,
  occurred_at timestamp with time zone,
  table_name text,
  operation audit.audit_operation,
  actor_type audit.audit_actor_type,
  actor_user_id uuid,
  actor_display_name text,
  effective_user_id uuid,
  system_actor text,
  tool text,
  changed_columns text[],
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_advocate_permission(
    target_advocate_id,
    'portal.audit.view'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal audit permission'
      USING ERRCODE = '42501';
  END IF;

  IF page_size IS NULL OR page_size < 1 OR page_size > 200 THEN
    RAISE EXCEPTION 'Audit page size must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    event.sequence_id,
    event.id,
    event.occurred_at,
    event.table_name,
    event.operation,
    event.actor_type,
    event.actor_user_id,
    CASE
      WHEN event.actor_type = 'system' THEN event.system_actor
      WHEN event.actor_user_id IS NOT NULL THEN nullif(
        btrim(
          concat_ws(
            ' ',
            nullif(profile.first_name, ''),
            CASE
              WHEN nullif(profile.last_name, '') IS NOT NULL
                THEN left(profile.last_name, 1) || '.'
              ELSE NULL
            END
          )
        ),
        ''
      )
      ELSE event.actor_type::text
    END AS actor_display_name,
    event.effective_user_id,
    event.system_actor,
    event.tool,
    event.changed_columns,
    event.reason
  FROM audit.audit_events event
  LEFT JOIN public.users profile ON profile.id = event.actor_user_id
  WHERE event.advocate_id = target_advocate_id
    AND event.table_name = ANY (ARRAY[
      'advocates',
      'advocate_domains',
      'advocate_domain_integrations',
      'domain_provisioning_jobs',
      'advocate_branding',
      'advocate_public_metric_selections',
      'advocate_beneficiaries',
      'advocate_memberships',
      'advocate_membership_roles',
      'advocate_invitations',
      'advocate_invitation_roles',
      'advocate_logo_upload_reservations'
    ]::text[])
    AND (before_sequence IS NULL OR event.sequence_id < before_sequence)
  ORDER BY event.sequence_id DESC
  LIMIT page_size;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_audit_events(
  uuid,
  bigint,
  integer
) IS
  'Returns only the sanitized, advocate-scoped audit ledger, including columns-only logo reservation lifecycle events, to members with portal.audit.view. Raw 90-day forensic evidence is never exposed.';

CREATE OR REPLACE FUNCTION public.reserve_advocate_logo_upload(
  target_advocate_id uuid,
  target_actor_user_id uuid,
  expected_advocate_version bigint,
  request_id text,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  reservation_id uuid,
  object_path text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_advocate public.advocates%ROWTYPE;
  v_reservation_id uuid := gen_random_uuid();
  v_object_path text;
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_advocate_id IS NULL
     OR target_actor_user_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1
     OR v_request_id IS NULL
     OR char_length(v_request_id) > 255
     OR char_length(COALESCE(v_trace_id, '')) > 255 THEN
    RAISE EXCEPTION 'Logo reservation input is malformed'
      USING ERRCODE = '22023';
  END IF;

  -- This lock makes the actor limit exact even when one delegate submits
  -- concurrent reservations for different advocates.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'advocate-logo-actor:' || target_actor_user_id::text,
      0
    )
  );

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    JOIN public.advocate_membership_roles membership_role
      ON membership_role.membership_id = membership.id
     AND membership_role.advocate_id = membership.advocate_id
    JOIN public.advocate_role_permissions role_permission
      ON role_permission.role_id = membership_role.role_id
    JOIN public.advocate_permissions permission
      ON permission.id = role_permission.permission_id
    WHERE membership.advocate_id = target_advocate_id
      AND membership.user_id = target_actor_user_id
      AND membership.status = 'active'
      AND permission.key = 'portal.branding.update'
  )
  OR v_advocate.relationship_status <> 'active'
  OR v_advocate.publication_status NOT IN (
    'draft',
    'provisioning',
    'active',
    'failed'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate settings changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => target_actor_user_id,
    context_tool => 'advocate-portal-logo',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Reserve an authorized immutable advocate logo upload',
    context_metadata => jsonb_build_object(
      'operation', 'reserve_logo_upload',
      'resource_kind', 'advocate_logo_upload_reservation',
      'resource_id', v_reservation_id::text,
      'permission_key', 'portal.branding.update',
      'outcome', 'pending'
    )
  );

  UPDATE private.advocate_logo_upload_reservations reservation
  SET
    status = 'expired',
    failure_code = 'reservation_expired',
    settled_at = v_now
  WHERE reservation.advocate_id = v_advocate.id
    AND reservation.status = 'pending'
    AND (
      reservation.expires_at <= v_now
      OR reservation.expected_advocate_version <> v_advocate.version
    );

  IF EXISTS (
    SELECT 1
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.advocate_id = v_advocate.id
      AND reservation.expected_advocate_version = v_advocate.version
      AND reservation.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'An advocate logo upload is already pending'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.actor_user_id = target_actor_user_id
      AND reservation.created_at >= v_now - interval '1 hour'
  ) >= 10
  OR (
    SELECT count(*)
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.advocate_id = v_advocate.id
      AND reservation.created_at >= v_now - interval '1 hour'
  ) >= 20 THEN
    RAISE EXCEPTION 'Advocate logo upload rate limit exceeded'
      USING ERRCODE = '54000';
  END IF;

  v_object_path :=
    'logos/' || v_advocate.slug || '/' || v_reservation_id::text || '.webp';

  INSERT INTO private.advocate_logo_upload_reservations (
    id,
    advocate_id,
    actor_user_id,
    expected_advocate_version,
    object_path,
    request_id,
    trace_id,
    created_at,
    expires_at
  )
  VALUES (
    v_reservation_id,
    v_advocate.id,
    target_actor_user_id,
    v_advocate.version,
    v_object_path,
    v_request_id,
    v_trace_id,
    v_now,
    v_now + interval '15 minutes'
  );

  RETURN QUERY
  SELECT
    v_reservation_id,
    v_object_path,
    v_now + interval '15 minutes';
END;
$$;

COMMENT ON FUNCTION public.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
) IS
  'Service-only durable authorization for one immutable logo upload. Actor and tenant rolling limits and one pending upload per advocate version are serialized before a path is issued.';

CREATE OR REPLACE FUNCTION public.settle_advocate_logo_upload_reservation(
  target_reservation_id uuid,
  target_actor_user_id uuid,
  request_id text,
  target_status text,
  failure_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation private.advocate_logo_upload_reservations%ROWTYPE;
  v_request_id text := nullif(btrim(request_id), '');
  v_failure_code text := nullif(btrim(failure_code), '');
  v_target_status private.advocate_logo_upload_reservation_status;
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_reservation_id IS NULL
     OR target_actor_user_id IS NULL
     OR v_request_id IS NULL
     OR char_length(v_request_id) > 255
     OR target_status NOT IN ('cancelled', 'cleanup_required')
     OR v_failure_code IS NULL
     OR char_length(v_failure_code) > 120
     OR v_failure_code !~ '^[a-z0-9][a-z0-9._:-]*$' THEN
    RAISE EXCEPTION 'Logo reservation settlement input is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_target_status := target_status::private.advocate_logo_upload_reservation_status;

  SELECT reservation.*
  INTO v_reservation
  FROM private.advocate_logo_upload_reservations reservation
  WHERE reservation.id = target_reservation_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_reservation.actor_user_id IS DISTINCT FROM target_actor_user_id
     OR v_reservation.request_id IS DISTINCT FROM v_request_id THEN
    RAISE EXCEPTION 'Insufficient logo reservation permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_reservation.status <> 'pending' THEN
    IF v_reservation.status = v_target_status
       AND v_reservation.failure_code = v_failure_code THEN
      RETURN v_reservation.status::text;
    END IF;

    RAISE EXCEPTION 'Logo reservation is already terminal'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => target_actor_user_id,
    context_tool => 'advocate-portal-logo',
    context_request_id => v_request_id,
    context_trace_id => v_reservation.trace_id,
    context_reason => 'Settle an advocate logo upload reservation after provider work',
    context_metadata => jsonb_build_object(
      'operation', 'settle_logo_upload',
      'resource_kind', 'advocate_logo_upload_reservation',
      'resource_id', v_reservation.id::text,
      'prior_status', v_reservation.status::text,
      'outcome', v_target_status::text
    )
  );

  UPDATE private.advocate_logo_upload_reservations reservation
  SET
    status = v_target_status,
    failure_code = v_failure_code,
    settled_at = clock_timestamp()
  WHERE reservation.id = v_reservation.id;

  RETURN v_target_status::text;
END;
$$;

COMMENT ON FUNCTION public.settle_advocate_logo_upload_reservation(
  uuid,
  uuid,
  text,
  text,
  text
) IS
  'Service-only failure settlement. Exact actor and request binding permits only cancelled or cleanup_required terminal outcomes and idempotent replay of the same outcome.';

CREATE OR REPLACE FUNCTION public.get_advocate_logo_upload_reservation_result(
  target_reservation_id uuid,
  target_actor_user_id uuid,
  request_id text
)
RETURNS TABLE (
  status text,
  object_path text,
  expected_version bigint,
  resulting_version bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_reservation private.advocate_logo_upload_reservations%ROWTYPE;
  v_request_id text := nullif(btrim(request_id), '');
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_reservation_id IS NULL
     OR target_actor_user_id IS NULL
     OR v_request_id IS NULL
     OR char_length(v_request_id) > 255 THEN
    RAISE EXCEPTION 'Logo reservation result input is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.*
  INTO v_reservation
  FROM private.advocate_logo_upload_reservations reservation
  WHERE reservation.id = target_reservation_id;

  IF NOT FOUND
     OR v_reservation.actor_user_id IS DISTINCT FROM target_actor_user_id
     OR v_reservation.request_id IS DISTINCT FROM v_request_id THEN
    RAISE EXCEPTION 'Insufficient logo reservation permission'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v_reservation.status::text,
    v_reservation.object_path,
    v_reservation.expected_advocate_version,
    v_reservation.resulting_advocate_version;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_logo_upload_reservation_result(
  uuid,
  uuid,
  text
) IS
  'Service-only ambiguity recovery lookup bound to the reservation, actor, and request. It reveals only lifecycle status, immutable path, expected version, and committed resulting version.';

-- The browser-callable signature is removed. Only trusted application code can
-- present server-sanitized rich text and consume a provider upload reservation.
REVOKE ALL ON FUNCTION public.update_advocate_branding(
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.update_advocate_branding(
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
);

CREATE FUNCTION public.update_advocate_branding(
  target_advocate_id uuid,
  target_actor_user_id uuid,
  expected_advocate_version bigint,
  target_primary_color text,
  target_accent_color text,
  target_logo_storage_path text,
  target_logo_upload_reservation_id uuid,
  target_logo_alt_text text,
  target_opening_header_html text,
  target_about_biography_html text,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate public.advocates%ROWTYPE;
  v_reservation private.advocate_logo_upload_reservations%ROWTYPE;
  v_current_logo_storage_path text;
  v_reason text := nullif(btrim(change_reason), '');
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
  v_session_id text := nullif(btrim(session_id), '');
  v_logo_alt_text text := nullif(btrim(target_logo_alt_text), '');
  v_resulting_version bigint;
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_advocate_id IS NULL
     OR target_actor_user_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'Branding mutation identity is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    JOIN public.advocate_membership_roles membership_role
      ON membership_role.membership_id = membership.id
     AND membership_role.advocate_id = membership.advocate_id
    JOIN public.advocate_role_permissions role_permission
      ON role_permission.role_id = membership_role.role_id
    JOIN public.advocate_permissions permission
      ON permission.id = role_permission.permission_id
    WHERE membership.advocate_id = target_advocate_id
      AND membership.user_id = target_actor_user_id
      AND membership.status = 'active'
      AND permission.key = 'portal.branding.update'
  )
  OR v_advocate.relationship_status <> 'active'
  OR v_advocate.publication_status NOT IN (
    'draft',
    'provisioning',
    'active',
    'failed'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate settings changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF target_primary_color IS NULL
     OR btrim(target_primary_color) !~ '^#[0-9A-Fa-f]{6}$'
     OR target_accent_color IS NULL
     OR btrim(target_accent_color) !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Advocate colors must use six digit hexadecimal notation'
      USING ERRCODE = '22023';
  END IF;

  IF target_opening_header_html IS NULL
     OR octet_length(target_opening_header_html) > 16384
     OR target_about_biography_html IS NULL
     OR octet_length(target_about_biography_html) > 16384 THEN
    RAISE EXCEPTION 'Advocate rich text must not exceed 16384 bytes per field'
      USING ERRCODE = '22023';
  END IF;

  IF v_logo_alt_text IS NOT NULL AND char_length(v_logo_alt_text) > 300 THEN
    RAISE EXCEPTION 'Advocate logo alternative text exceeds 300 characters'
      USING ERRCODE = '22023';
  END IF;

  IF target_logo_storage_path IS NULL THEN
    IF v_logo_alt_text IS NOT NULL THEN
      RAISE EXCEPTION 'Logo alternative text requires an attached logo'
        USING ERRCODE = '22023';
    END IF;
  ELSIF target_logo_storage_path <> btrim(target_logo_storage_path)
     OR array_length(string_to_array(target_logo_storage_path, '/'), 1) <> 3
     OR split_part(target_logo_storage_path, '/', 1) <> 'logos'
     OR split_part(target_logo_storage_path, '/', 2) <> v_advocate.slug
     OR split_part(target_logo_storage_path, '/', 3) !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' THEN
    RAISE EXCEPTION 'Advocate logo storage path violates the tenant asset boundary'
      USING ERRCODE = '23514';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'A branding change reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(v_request_id, '')) > 255
     OR char_length(COALESCE(v_trace_id, '')) > 255
     OR char_length(COALESCE(v_session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Branding audit identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT branding.logo_storage_path
  INTO v_current_logo_storage_path
  FROM public.advocate_branding branding
  WHERE branding.advocate_id = v_advocate.id;

  IF target_logo_storage_path IS NOT NULL
     AND target_logo_storage_path IS DISTINCT FROM v_current_logo_storage_path THEN
    SELECT reservation.*
    INTO v_reservation
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.id = target_logo_upload_reservation_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_reservation.advocate_id IS DISTINCT FROM v_advocate.id
       OR v_reservation.actor_user_id IS DISTINCT FROM target_actor_user_id
       OR v_reservation.expected_advocate_version IS DISTINCT FROM v_advocate.version
       OR v_reservation.object_path IS DISTINCT FROM target_logo_storage_path
       OR v_reservation.request_id IS DISTINCT FROM v_request_id THEN
      RAISE EXCEPTION 'Insufficient logo reservation permission'
        USING ERRCODE = '42501';
    END IF;

    IF v_reservation.status <> 'pending'
       OR v_reservation.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Logo reservation is not attachable'
        USING ERRCODE = '55000';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM storage.objects object
      WHERE object.bucket_id = 'advocate-assets'
        AND object.name = v_reservation.object_path
        AND object.metadata ->> 'mimetype' = 'image/webp'
        AND CASE
          WHEN jsonb_typeof(object.metadata -> 'size') = 'number'
            AND object.metadata ->> 'size' ~ '^[0-9]{1,7}$'
          THEN (object.metadata ->> 'size')::bigint BETWEEN 1 AND 1048576
          ELSE false
        END
    ) THEN
      RAISE EXCEPTION 'Reserved advocate logo object does not exist or is invalid'
        USING ERRCODE = '23503';
    END IF;
  ELSIF target_logo_upload_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'A logo reservation is valid only for a new logo path'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => target_actor_user_id,
    context_tool => 'advocate-portal-branding',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_session_id => v_session_id,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'update_branding',
      'resource_kind', 'advocate_branding',
      'resource_id', v_advocate.id::text,
      'permission_key', 'portal.branding.update'
    )
  );

  INSERT INTO public.advocate_branding (
    advocate_id,
    primary_color,
    accent_color,
    logo_storage_path,
    logo_alt_text,
    opening_header_html,
    about_biography_html
  )
  VALUES (
    v_advocate.id,
    upper(btrim(target_primary_color)),
    upper(btrim(target_accent_color)),
    target_logo_storage_path,
    v_logo_alt_text,
    target_opening_header_html,
    target_about_biography_html
  )
  ON CONFLICT (advocate_id) DO UPDATE
  SET
    primary_color = EXCLUDED.primary_color,
    accent_color = EXCLUDED.accent_color,
    logo_storage_path = EXCLUDED.logo_storage_path,
    logo_alt_text = EXCLUDED.logo_alt_text,
    opening_header_html = EXCLUDED.opening_header_html,
    about_biography_html = EXCLUDED.about_biography_html;

  UPDATE public.advocates advocate
  SET display_name = advocate.display_name
  WHERE advocate.id = v_advocate.id
  RETURNING advocate.version INTO v_resulting_version;

  IF v_reservation.id IS NOT NULL THEN
    UPDATE private.advocate_logo_upload_reservations reservation
    SET
      status = 'attached',
      settled_at = clock_timestamp(),
      failure_code = NULL,
      resulting_advocate_version = v_resulting_version
    WHERE reservation.id = v_reservation.id;
  END IF;

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Service-only tenant-locked branding replacement. Actor authorization is rechecked under the aggregate lock, and every changed nonnull logo path must atomically consume its exact unexpired upload reservation and validated immutable object.';

REVOKE ALL ON FUNCTION public.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_advocate_logo_upload_reservation(
  uuid,
  uuid,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_advocate_logo_upload_reservation_result(
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_advocate_logo_upload_reservation(
  uuid,
  uuid,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_advocate_logo_upload_reservation_result(
  uuid,
  uuid,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;

COMMIT;

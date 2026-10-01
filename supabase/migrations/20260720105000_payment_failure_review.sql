-- Acknowledgment controls paging only. Gateway and financial facts stay untouched.
CREATE TABLE audit.payment_failure_acknowledgments (
  gateway_event_id uuid NOT NULL REFERENCES public.payment_gateway_events(id) ON DELETE RESTRICT,
  failure_version text NOT NULL CHECK (failure_version ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL,
  actor_session_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  reason_code text NOT NULL CHECK (reason_code IN ('investigating', 'awaiting_provider', 'awaiting_repair')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gateway_event_id, failure_version)
);
ALTER TABLE audit.payment_failure_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.payment_failure_acknowledgments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit.payment_failure_acknowledgments FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION private.prevent_payment_failure_acknowledgment_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Payment failure acknowledgments are immutable' USING ERRCODE = '42501'; END;
$$;
REVOKE ALL ON FUNCTION private.prevent_payment_failure_acknowledgment_mutation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER payment_failure_acknowledgments_no_change BEFORE UPDATE OR DELETE
  ON audit.payment_failure_acknowledgments FOR EACH ROW
  EXECUTE FUNCTION private.prevent_payment_failure_acknowledgment_mutation();
CREATE TRIGGER payment_failure_acknowledgments_no_truncate BEFORE TRUNCATE
  ON audit.payment_failure_acknowledgments FOR EACH STATEMENT
  EXECUTE FUNCTION private.prevent_payment_failure_acknowledgment_mutation();

CREATE FUNCTION private.payment_failure_kind(event public.payment_gateway_events)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN event.processing_status = 'ignored' AND event.redacted_payload @>
      '{"quarantine":true,"requires_operational_review":true}'::jsonb THEN 'quarantined'
    WHEN event.processing_attempt_count >= event.max_processing_attempts THEN CASE
      WHEN event.processing_status = 'failed' THEN 'exhausted'
      WHEN event.processing_status = 'processing'
        AND event.processing_locked_at <= statement_timestamp() - interval '10 minutes'
        THEN 'expired_final_lease'
      END
    END;
$$;
REVOKE ALL ON FUNCTION private.payment_failure_kind(public.payment_gateway_events) FROM PUBLIC, anon, authenticated, service_role;

-- Exclude retention and updated_at: erasing a payload does not create a new failure.
-- Include the lease and attempt evidence so an older receipt cannot cover a retry.
CREATE FUNCTION private.payment_failure_version(event public.payment_gateway_events)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(jsonb_build_array(
    event.id, event.provider, event.provider_account_scope, encode(event.payload_sha256, 'hex'),
    event.processing_status, event.processing_attempt_count, event.max_processing_attempts,
    extract(epoch FROM event.processing_locked_at), event.processing_lease_token,
    event.last_error, event.ignored_reason,
    event.redacted_payload -> 'quarantine_error_code'
  )::text, 'sha256'), 'hex');
$$;
REVOKE ALL ON FUNCTION private.payment_failure_version(public.payment_gateway_events) FROM PUBLIC, anon, authenticated, service_role;

-- UUID keyset pages remain bounded and include acknowledged unresolved cases.
CREATE FUNCTION public.list_payment_failures(after_event_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.require_healthy_creator_share_super_admin('read_payment_failures');
  WITH failures AS (
    SELECT event.id, event.provider, event.provider_account_scope,
      private.payment_failure_kind(event) AS kind,
      private.payment_failure_version(event) AS version,
      event.received_at, event.payload_retention_expires_at,
      event.payload_ciphertext IS NOT NULL AS payload_available
    FROM public.payment_gateway_events event
    WHERE (after_event_id IS NULL OR event.id > after_event_id)
      AND private.payment_failure_kind(event) IS NOT NULL
    ORDER BY event.id LIMIT 101
  ), page AS (
    SELECT * FROM failures ORDER BY id LIMIT 100
  )
  SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'event_id', page.id, 'provider', page.provider, 'account_scope', page.provider_account_scope,
      'kind', page.kind, 'failure_version', page.version, 'received_at', page.received_at,
      'payload_expires_at', page.payload_retention_expires_at, 'payload_available', page.payload_available,
      'acknowledged', receipt.gateway_event_id IS NOT NULL
    ) ORDER BY page.id) FROM page LEFT JOIN audit.payment_failure_acknowledgments receipt
      ON receipt.gateway_event_id = page.id AND receipt.failure_version = page.version), '[]'::jsonb),
    'next_cursor', CASE WHEN (SELECT count(*) FROM failures) > 100
      THEN (SELECT id::text FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_payment_failures(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_payment_failures(uuid) TO authenticated;

CREATE FUNCTION public.acknowledge_payment_failure(
  target_event_id uuid, expected_failure_version text, reason_code text, request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE
  v_actor uuid;
  v_session text;
  v_event public.payment_gateway_events%ROWTYPE;
  v_existing audit.payment_failure_acknowledgments%ROWTYPE;
BEGIN
  v_actor := private.require_healthy_creator_share_super_admin('acknowledge_payment_failure');
  v_session := private.require_active_signed_auth_session_id(v_actor);
  IF target_event_id IS NULL OR expected_failure_version IS NULL
    OR expected_failure_version !~ '^[0-9a-f]{64}$' OR request_id IS NULL
    OR reason_code IS NULL OR reason_code NOT IN ('investigating', 'awaiting_provider', 'awaiting_repair') THEN
    RAISE EXCEPTION 'Invalid failure acknowledgment' USING ERRCODE = '22023';
  END IF;
  -- Settlement takes this same row lock. Never acknowledge an active lease.
  SELECT * INTO v_event FROM public.payment_gateway_events WHERE id = target_event_id FOR UPDATE;
  IF NOT FOUND OR private.payment_failure_kind(v_event) IS NULL
    OR private.payment_failure_version(v_event) <> expected_failure_version THEN
    RAISE EXCEPTION 'Payment failure changed; refresh before acknowledging' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_existing FROM audit.payment_failure_acknowledgments receipt
    WHERE receipt.request_id = acknowledge_payment_failure.request_id;
  IF FOUND AND (v_existing.gateway_event_id <> target_event_id
    OR v_existing.failure_version <> expected_failure_version OR v_existing.actor_user_id <> v_actor
    OR v_existing.reason_code <> acknowledge_payment_failure.reason_code) THEN
    RAISE EXCEPTION 'Acknowledgment request identity conflict' USING ERRCODE = '23505';
  END IF;
  INSERT INTO audit.payment_failure_acknowledgments(
    gateway_event_id, failure_version, actor_user_id, actor_session_id, reason_code, request_id
  ) VALUES (target_event_id, expected_failure_version, v_actor, v_session::uuid, reason_code, request_id)
    ON CONFLICT (gateway_event_id, failure_version) DO NOTHING;
  RETURN jsonb_build_object('acknowledged', true, 'resolved', false);
END;
$$;
REVOKE ALL ON FUNCTION public.acknowledge_payment_failure(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_payment_failure(uuid,text,text,uuid) TO authenticated;

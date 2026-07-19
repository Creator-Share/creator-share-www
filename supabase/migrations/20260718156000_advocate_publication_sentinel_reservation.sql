BEGIN;

LOCK TABLE public.advocates IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.advocate_domains IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.advocate_reserved_subdomains IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.advocate_reserved_subdomains'::regclass
      AND trigger_definition.tgname =
        'advocate_reserved_subdomains_immutable'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'private.prevent_advocate_dictionary_mutation()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Reserved subdomain immutability trigger is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = 'publication-sentinel'
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.hostname = 'publication-sentinel.creatorshare.com'
  ) THEN
    RAISE EXCEPTION 'Publication sentinel hostname is already tenant assigned'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

DROP TRIGGER advocate_reserved_subdomains_immutable
  ON public.advocate_reserved_subdomains;

INSERT INTO public.advocate_reserved_subdomains (label, reason)
VALUES (
  'publication-sentinel',
  'Reserved for the persistent shared advocate publication negative-control hostname.'
)
ON CONFLICT (label) DO NOTHING;

CREATE TRIGGER advocate_reserved_subdomains_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_reserved_subdomains
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_dictionary_mutation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = 'publication-sentinel'
      AND reserved.reason =
        'Reserved for the persistent shared advocate publication negative-control hostname.'
  ) THEN
    RAISE EXCEPTION 'Publication sentinel reservation was not installed'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = 'publication-sentinel'
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.hostname = 'publication-sentinel.creatorshare.com'
  ) THEN
    RAISE EXCEPTION 'Publication sentinel hostname became tenant assigned'
      USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.advocate_reserved_subdomains'::regclass
      AND trigger_definition.tgname =
        'advocate_reserved_subdomains_immutable'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'private.prevent_advocate_dictionary_mutation()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Reserved subdomain immutability trigger was not restored'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.advocate_publication_sentinel_event_is_valid(
  target_stage text,
  target_outcome_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE target_stage
    WHEN 'cloudflare_lookup' THEN target_outcome_code IN (
      'ready', 'not_found', 'needs_apply', 'provider_unavailable',
      'ownership_conflict'
    )
    WHEN 'cloudflare_apply' THEN target_outcome_code IN (
      'apply_accepted', 'provider_unavailable'
    )
    WHEN 'cloudflare_verify' THEN target_outcome_code IN (
      'ready', 'not_ready', 'provider_unavailable', 'ownership_conflict',
      'failed'
    )
    WHEN 'vercel_lookup' THEN target_outcome_code IN (
      'ready', 'not_found', 'needs_apply', 'provider_unavailable',
      'ownership_conflict', 'blocked'
    )
    WHEN 'vercel_apply' THEN target_outcome_code IN (
      'apply_accepted', 'provider_unavailable'
    )
    WHEN 'vercel_verify' THEN target_outcome_code IN (
      'ready', 'not_ready', 'provider_unavailable', 'ownership_conflict',
      'failed'
    )
    WHEN 'dns' THEN target_outcome_code IN ('ready', 'not_ready')
    WHEN 'tls' THEN target_outcome_code IN ('ready', 'not_ready')
    WHEN 'https' THEN target_outcome_code IN (
      'ready', 'not_ready', 'unexpected_response'
    )
    WHEN 'complete' THEN target_outcome_code IN (
      'ready', 'converging', 'failed'
    )
    ELSE false
  END;
$$;

CREATE TABLE audit.advocate_publication_sentinel_reconciliation_runs (
  run_id uuid PRIMARY KEY,
  request_reference_sha256 text NOT NULL,
  outcome_code text NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_publication_sentinel_runs_id_check CHECK (
    run_id <> '00000000-0000-0000-0000-000000000000'::uuid
  ),
  CONSTRAINT advocate_publication_sentinel_runs_reference_check CHECK (
    request_reference_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT advocate_publication_sentinel_runs_outcome_check CHECK (
    outcome_code IN ('ready', 'converging', 'failed')
  )
);

CREATE TABLE audit.advocate_publication_sentinel_reconciliation_events (
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  run_id uuid NOT NULL
    REFERENCES audit.advocate_publication_sentinel_reconciliation_runs(run_id)
    ON DELETE RESTRICT,
  sequence smallint NOT NULL,
  stage text NOT NULL,
  outcome_code text NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id, sequence),
  CONSTRAINT advocate_publication_sentinel_events_sequence_check CHECK (
    sequence BETWEEN 0 AND 9
  ),
  CONSTRAINT advocate_publication_sentinel_events_stage_unique
    UNIQUE (run_id, stage),
  CONSTRAINT advocate_publication_sentinel_events_shape_check CHECK (
    private.advocate_publication_sentinel_event_is_valid(stage, outcome_code)
  )
);

CREATE INDEX advocate_publication_sentinel_runs_recorded_idx
  ON audit.advocate_publication_sentinel_reconciliation_runs (
    recorded_at DESC,
    run_id
  );

CREATE INDEX advocate_publication_sentinel_events_recorded_idx
  ON audit.advocate_publication_sentinel_reconciliation_events (
    recorded_at DESC,
    run_id,
    sequence
  );

COMMENT ON TABLE audit.advocate_publication_sentinel_reconciliation_runs IS
  'Append only scheduled sentinel outcomes. Correlation is a one way request digest; hostnames, provider identifiers, payloads, errors, and credentials are prohibited.';
COMMENT ON TABLE audit.advocate_publication_sentinel_reconciliation_events IS
  'Append only ordered sentinel stages using fixed operational vocabulary. No provider responses, identifiers, errors, payloads, or credentials are retained.';

CREATE OR REPLACE FUNCTION private.prevent_advocate_publication_sentinel_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Advocate publication sentinel evidence is append only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER advocate_publication_sentinel_runs_no_update_or_delete
BEFORE UPDATE OR DELETE
ON audit.advocate_publication_sentinel_reconciliation_runs
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_publication_sentinel_evidence_mutation();

CREATE TRIGGER advocate_publication_sentinel_runs_no_truncate
BEFORE TRUNCATE
ON audit.advocate_publication_sentinel_reconciliation_runs
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_publication_sentinel_evidence_mutation();

CREATE TRIGGER advocate_publication_sentinel_events_no_update_or_delete
BEFORE UPDATE OR DELETE
ON audit.advocate_publication_sentinel_reconciliation_events
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_publication_sentinel_evidence_mutation();

CREATE TRIGGER advocate_publication_sentinel_events_no_truncate
BEFORE TRUNCATE
ON audit.advocate_publication_sentinel_reconciliation_events
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_publication_sentinel_evidence_mutation();

ALTER TABLE audit.advocate_publication_sentinel_reconciliation_runs
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.advocate_publication_sentinel_reconciliation_events
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON audit.advocate_publication_sentinel_reconciliation_runs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON audit.advocate_publication_sentinel_reconciliation_events
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_advocate_publication_sentinel_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Publication sentinel evidence requires the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Publication sentinel evidence requires the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_advocate_publication_sentinel_reconciliation(
  target_run_id uuid,
  target_request_reference_sha256 text,
  target_outcome_code text,
  target_events jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event jsonb;
  v_event_keys text[];
  v_sequence integer := 0;
  v_stage text;
  v_outcome_code text;
  v_stage_rank integer;
  v_previous_stage_rank integer := 0;
  v_inserted integer;
  v_existing record;
  v_existing_events jsonb;
BEGIN
  PERFORM private.require_advocate_publication_sentinel_service_role();

  IF target_run_id IS NULL
     OR target_run_id = '00000000-0000-0000-0000-000000000000'::uuid
     OR target_request_reference_sha256 IS NULL
     OR target_request_reference_sha256 !~ '^[0-9a-f]{64}$'
     OR target_outcome_code NOT IN ('ready', 'converging', 'failed')
     OR jsonb_typeof(target_events) IS DISTINCT FROM 'array'
     OR jsonb_array_length(target_events) NOT BETWEEN 3 AND 10 THEN
    RAISE EXCEPTION 'Publication sentinel evidence input is invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR v_event IN
    SELECT event.value
    FROM jsonb_array_elements(target_events) WITH ORDINALITY AS event(value, ordinal)
    ORDER BY event.ordinal
  LOOP
    IF jsonb_typeof(v_event) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Publication sentinel evidence input is invalid'
        USING ERRCODE = '22023';
    END IF;

    SELECT array_agg(event_key ORDER BY event_key)
    INTO v_event_keys
    FROM jsonb_object_keys(v_event) AS event_key;

    IF v_event_keys IS DISTINCT FROM ARRAY[
         'outcome_code', 'sequence', 'stage'
       ]::text[]
       OR jsonb_typeof(v_event -> 'sequence') IS DISTINCT FROM 'number'
       OR (v_event ->> 'sequence') !~ '^(0|[1-9][0-9]*)$'
       OR (v_event ->> 'sequence')::integer <> v_sequence
       OR jsonb_typeof(v_event -> 'stage') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_event -> 'outcome_code') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Publication sentinel evidence input is invalid'
        USING ERRCODE = '22023';
    END IF;

    v_stage := v_event ->> 'stage';
    v_outcome_code := v_event ->> 'outcome_code';
    v_stage_rank := array_position(ARRAY[
      'cloudflare_lookup',
      'cloudflare_apply',
      'cloudflare_verify',
      'vercel_lookup',
      'vercel_apply',
      'vercel_verify',
      'dns',
      'tls',
      'https',
      'complete'
    ]::text[], v_stage);

    IF v_stage_rank IS NULL
       OR v_stage_rank <= v_previous_stage_rank
       OR NOT private.advocate_publication_sentinel_event_is_valid(
         v_stage,
         v_outcome_code
       ) THEN
      RAISE EXCEPTION 'Publication sentinel evidence input is invalid'
        USING ERRCODE = '22023';
    END IF;

    v_previous_stage_rank := v_stage_rank;
    v_sequence := v_sequence + 1;
  END LOOP;

  v_event := target_events -> (jsonb_array_length(target_events) - 1);
  IF v_event ->> 'stage' IS DISTINCT FROM 'complete'
     OR v_event ->> 'outcome_code' IS DISTINCT FROM target_outcome_code THEN
    RAISE EXCEPTION 'Publication sentinel evidence input is invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO audit.advocate_publication_sentinel_reconciliation_runs (
    run_id,
    request_reference_sha256,
    outcome_code
  ) VALUES (
    target_run_id,
    target_request_reference_sha256,
    target_outcome_code
  )
  ON CONFLICT (run_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT
      existing.request_reference_sha256,
      existing.outcome_code
    INTO STRICT v_existing
    FROM audit.advocate_publication_sentinel_reconciliation_runs existing
    WHERE existing.run_id = target_run_id;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'sequence', existing_event.sequence,
          'stage', existing_event.stage,
          'outcome_code', existing_event.outcome_code
        )
        ORDER BY existing_event.sequence
      ),
      '[]'::jsonb
    )
    INTO v_existing_events
    FROM audit.advocate_publication_sentinel_reconciliation_events existing_event
    WHERE existing_event.run_id = target_run_id;

    IF v_existing.request_reference_sha256 IS DISTINCT FROM
         target_request_reference_sha256
       OR v_existing.outcome_code IS DISTINCT FROM target_outcome_code
       OR v_existing_events IS DISTINCT FROM target_events THEN
      RAISE EXCEPTION 'Publication sentinel run id conflicts with prior evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN;
  END IF;

  INSERT INTO audit.advocate_publication_sentinel_reconciliation_events (
    run_id,
    sequence,
    stage,
    outcome_code
  )
  SELECT
    target_run_id,
    (event.value ->> 'sequence')::smallint,
    event.value ->> 'stage',
    event.value ->> 'outcome_code'
  FROM jsonb_array_elements(target_events) WITH ORDINALITY AS event(value, ordinal)
  ORDER BY event.ordinal;
END;
$$;

REVOKE ALL ON FUNCTION private.advocate_publication_sentinel_event_is_valid(
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prevent_advocate_publication_sentinel_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_advocate_publication_sentinel_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_advocate_publication_sentinel_reconciliation(
  uuid,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_advocate_publication_sentinel_reconciliation(
  uuid,
  text,
  text,
  jsonb
) TO service_role;

COMMENT ON FUNCTION public.record_advocate_publication_sentinel_reconciliation(
  uuid,
  text,
  text,
  jsonb
) IS
  'Atomically records one sanitized scheduled publication sentinel result. Exact retries are idempotent and conflicting run reuse is rejected. Service role only.';

COMMIT;

BEGIN;

/*
 * Public metrics are deliberately narrower than the private analytics enum.
 * The cleanup boundary holds an exclusive lock across snapshot, replacement,
 * aggregate version advancement, and constraint validation. Safe survivors
 * retain their timestamps and relative order without leaving parser-breaking
 * display order gaps.
 */
CREATE OR REPLACE FUNCTION
  private.restrict_advocate_public_metric_selections_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_affected_advocates bigint;
BEGIN
  LOCK TABLE public.advocate_public_metric_selections
    IN ACCESS EXCLUSIVE MODE;

  DROP TABLE IF EXISTS pg_temp.advocate_public_metric_cleanup_advocates;
  DROP TABLE IF EXISTS pg_temp.advocate_public_metric_cleanup_survivors;

  CREATE TEMP TABLE pg_temp.advocate_public_metric_cleanup_advocates
  ON COMMIT DROP
  AS
  SELECT DISTINCT selection.advocate_id
  FROM public.advocate_public_metric_selections selection
  WHERE selection.metric_key NOT IN (
    'children_sponsored',
    'gross_raised_usd',
    'direct_sponsorships',
    'post_visit_attributed_sponsorships'
  );

  GET DIAGNOSTICS v_affected_advocates = ROW_COUNT;

  CREATE TEMP TABLE pg_temp.advocate_public_metric_cleanup_survivors
  ON COMMIT DROP
  AS
  SELECT
    selection.advocate_id,
    selection.metric_key,
    (
      row_number() OVER (
        PARTITION BY selection.advocate_id
        ORDER BY selection.display_order, selection.metric_key
      ) - 1
    )::integer AS display_order,
    selection.created_at,
    selection.updated_at
  FROM public.advocate_public_metric_selections selection
  JOIN pg_temp.advocate_public_metric_cleanup_advocates affected
    ON affected.advocate_id = selection.advocate_id
  WHERE selection.metric_key IN (
    'children_sponsored',
    'gross_raised_usd',
    'direct_sponsorships',
    'post_visit_attributed_sponsorships'
  );

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-public-metrics-migration',
    context_tool => 'database-migration',
    context_request_id => '20260718151000-public-metric-allowlist',
    context_reason => 'Remove legacy public selections that are unsafe for privacy protected publication',
    context_metadata => jsonb_build_object(
      'operation', 'restrict_public_metrics',
      'resource_kind', 'advocate_public_metric_selections',
      'resource_id', 'public-v1'
    )
  );

  DELETE FROM public.advocate_public_metric_selections selection
  USING pg_temp.advocate_public_metric_cleanup_advocates affected
  WHERE selection.advocate_id = affected.advocate_id;

  INSERT INTO public.advocate_public_metric_selections (
    advocate_id,
    metric_key,
    display_order,
    created_at,
    updated_at
  )
  SELECT
    survivor.advocate_id,
    survivor.metric_key,
    survivor.display_order,
    survivor.created_at,
    survivor.updated_at
  FROM pg_temp.advocate_public_metric_cleanup_survivors survivor
  ORDER BY survivor.advocate_id, survivor.display_order;

  UPDATE public.advocates advocate
  SET display_name = advocate.display_name
  FROM pg_temp.advocate_public_metric_cleanup_advocates affected
  WHERE advocate.id = affected.advocate_id;

  DROP TABLE pg_temp.advocate_public_metric_cleanup_survivors;
  DROP TABLE pg_temp.advocate_public_metric_cleanup_advocates;

  RETURN v_affected_advocates;
END;
$$;

REVOKE ALL ON FUNCTION
  private.restrict_advocate_public_metric_selections_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION
  private.restrict_advocate_public_metric_selections_v1() IS
  'Database only public-v1 migration and repair boundary. Under an exclusive selection lock it removes private enum values, preserves and compacts safe survivors, advances each affected advocate aggregate version once, and records system audit context.';

SELECT private.restrict_advocate_public_metric_selections_v1();

ALTER TABLE public.advocate_public_metric_selections
  ADD CONSTRAINT advocate_public_metric_selections_public_allowlist_check
  CHECK (
    metric_key IN (
      'children_sponsored',
      'gross_raised_usd',
      'direct_sponsorships',
      'post_visit_attributed_sponsorships'
    )
  ) NOT VALID;

ALTER TABLE public.advocate_public_metric_selections
  VALIDATE CONSTRAINT
    advocate_public_metric_selections_public_allowlist_check;

CREATE TABLE private.advocate_public_metric_releases (
  advocate_id uuid NOT NULL
    REFERENCES public.advocates(id) ON DELETE RESTRICT,
  metric_key public.advocate_public_metric_key NOT NULL,
  policy_version text NOT NULL,
  released_bucket bigint NOT NULL,
  unit text NOT NULL,
  source_cutoff timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (
    advocate_id,
    metric_key,
    policy_version,
    source_cutoff
  ),
  CONSTRAINT advocate_public_metric_releases_policy_check CHECK (
    policy_version = 'public-v1'
  ),
  CONSTRAINT advocate_public_metric_releases_metric_check CHECK (
    metric_key IN (
      'children_sponsored',
      'gross_raised_usd',
      'direct_sponsorships',
      'post_visit_attributed_sponsorships'
    )
  ),
  CONSTRAINT advocate_public_metric_releases_unit_check CHECK (
    (
      metric_key = 'gross_raised_usd'
      AND unit = 'usd_cents'
    )
    OR (
      metric_key IN (
        'children_sponsored',
        'direct_sponsorships',
        'post_visit_attributed_sponsorships'
      )
      AND unit = 'count'
    )
  ),
  CONSTRAINT advocate_public_metric_releases_bucket_check CHECK (
    released_bucket > 0
    AND (
      (
        unit = 'count'
        AND released_bucket % 5 = 0
      )
      OR (
        unit = 'usd_cents'
        AND released_bucket % 10000 = 0
      )
    )
  ),
  CONSTRAINT advocate_public_metric_releases_weekly_cutoff_check CHECK (
    source_cutoff = (
      date_trunc('week', source_cutoff AT TIME ZONE 'UTC')
        AT TIME ZONE 'UTC'
    )
  ),
  CONSTRAINT advocate_public_metric_releases_embargo_check CHECK (
    created_at >= source_cutoff + interval '7 days'
  )
);

CREATE INDEX advocate_public_metric_releases_latest_idx
  ON private.advocate_public_metric_releases (
    advocate_id,
    metric_key,
    policy_version,
    source_cutoff DESC
  );

COMMENT ON TABLE private.advocate_public_metric_releases IS
  'Append only privacy releases for public-v1. Only rounded public buckets and their UTC source cutoffs are retained. Raw totals and support counts are never stored.';
COMMENT ON COLUMN private.advocate_public_metric_releases.released_bucket IS
  'Monotonic lower bound rounded down to 5 counts or 10000 USD cents.';
COMMENT ON COLUMN private.advocate_public_metric_releases.source_cutoff IS
  'Exclusive Monday 00:00:00 UTC data cutoff. A release is forbidden until the cutoff is at least seven days old.';
COMMENT ON COLUMN private.advocate_public_metric_releases.created_at IS
  'Server stamped forensic time at which the immutable public bucket was released.';

ALTER TABLE private.advocate_public_metric_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_public_metric_releases
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_advocate_public_metric_service_role()
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
      RAISE EXCEPTION 'Advocate public metric RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Advocate public metric RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  private.require_advocate_public_metric_service_role()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_advocate_public_metric_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := nullif(
    pg_catalog.current_setting(
      'app.advocate_public_metric_release.operation',
      true
    ),
    ''
  );
  v_latest private.advocate_public_metric_releases%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Advocate public metric releases are append only'
      USING ERRCODE = '42501';
  END IF;

  IF v_operation IS DISTINCT FROM 'refresh-public-v1' THEN
    RAISE EXCEPTION 'Advocate public metric releases require the worker RPC'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.source_cutoff > clock_timestamp() - interval '7 days' THEN
    RAISE EXCEPTION 'Advocate public metric releases require a seven day embargo'
      USING ERRCODE = '23514';
  END IF;

  NEW.created_at := clock_timestamp();

  SELECT release.*
  INTO v_latest
  FROM private.advocate_public_metric_releases release
  WHERE release.advocate_id = NEW.advocate_id
    AND release.metric_key = NEW.metric_key
    AND release.policy_version = NEW.policy_version
  ORDER BY release.source_cutoff DESC
  LIMIT 1
  FOR SHARE;

  IF FOUND AND (
    NEW.source_cutoff <= v_latest.source_cutoff
    OR NEW.released_bucket <= v_latest.released_bucket
    OR NEW.unit IS DISTINCT FROM v_latest.unit
  ) THEN
    RAISE EXCEPTION 'Advocate public metric releases must advance monotonically'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
  private.protect_advocate_public_metric_release()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_public_metric_releases_protect
BEFORE INSERT OR UPDATE OR DELETE
ON private.advocate_public_metric_releases
FOR EACH ROW
EXECUTE FUNCTION private.protect_advocate_public_metric_release();

CREATE TRIGGER advocate_public_metric_releases_no_truncate
BEFORE TRUNCATE ON private.advocate_public_metric_releases
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER advocate_public_metric_releases_audit
AFTER INSERT OR UPDATE OR DELETE
ON private.advocate_public_metric_releases
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change('advocate_id');

/*
 * This helper returns only a publishable candidate. Raw totals and support
 * counts exist only inside the statement and are discarded before returning.
 */
CREATE OR REPLACE FUNCTION private.calculate_advocate_public_metric_candidate(
  target_advocate_id uuid,
  target_metric_key public.advocate_public_metric_key,
  prior_source_cutoff timestamp with time zone,
  prior_released_bucket bigint,
  target_source_cutoff timestamp with time zone
)
RETURNS TABLE (
  candidate_bucket bigint,
  metric_unit text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw_total numeric := 0;
  v_support_contacts bigint := 0;
  v_bucket bigint := 0;
  v_prior_cutoff timestamp with time zone := coalesce(
    prior_source_cutoff,
    '-infinity'::timestamp with time zone
  );
BEGIN
  IF target_advocate_id IS NULL
     OR target_source_cutoff IS NULL
     OR target_metric_key NOT IN (
       'children_sponsored',
       'gross_raised_usd',
       'direct_sponsorships',
       'post_visit_attributed_sponsorships'
     ) THEN
    RAISE EXCEPTION 'Unsupported public metric candidate request'
      USING ERRCODE = '22023';
  END IF;

  IF prior_source_cutoff IS NOT NULL
     AND prior_source_cutoff > target_source_cutoff THEN
    RAISE EXCEPTION 'Public metric candidate cutoffs are out of order'
      USING ERRCODE = '22023';
  END IF;

  IF target_metric_key = 'gross_raised_usd' THEN
    WITH payment_facts AS MATERIALIZED (
      SELECT
        concat_ws(
          ':',
          intent.contact_email_normalization_version::text,
          intent.contact_email_hmac_key_version::text,
          encode(intent.contact_email_hmac, 'hex')
        ) AS sponsor_contact_key,
        movement.base_amount_usd_cents,
        greatest(
          attribution.finalized_at,
          attribution.conversion_occurred_at,
          movement.occurred_at,
          movement.recorded_at
        ) AS effective_at
      FROM public.sponsorship_attributions attribution
      JOIN public.sponsorship_intents intent
        ON intent.id = attribution.sponsorship_intent_id
      JOIN public.sponsorship_financial_movements movement
        ON movement.sponsorship_intent_id = intent.id
       AND movement.entry_kind = 'sponsorship_payment'
      WHERE attribution.advocate_id = target_advocate_id
        AND attribution.analytics_eligible
        AND attribution.finalized_at IS NOT NULL
        AND attribution.finalized_at < target_source_cutoff
        AND attribution.conversion_occurred_at IS NOT NULL
        AND attribution.conversion_occurred_at < target_source_cutoff
        AND movement.occurred_at < target_source_cutoff
        AND movement.recorded_at < target_source_cutoff
        AND (
          attribution.kind = 'direct'
          OR (
            attribution.kind = 'post_visit_attributed'
            AND attribution.exposure_lag >= interval '0 seconds'
            AND attribution.exposure_lag <= interval '30 days'
          )
        )
    )
    SELECT
      coalesce(sum(fact.base_amount_usd_cents), 0),
      count(DISTINCT fact.sponsor_contact_key) FILTER (
        WHERE fact.effective_at >= v_prior_cutoff
      )
    INTO v_raw_total, v_support_contacts
    FROM payment_facts fact;

    metric_unit := 'usd_cents';
    v_bucket := (floor(v_raw_total / 10000) * 10000)::bigint;
  ELSE
    WITH qualified_sponsorships AS MATERIALIZED (
      SELECT
        intent.id AS sponsorship_intent_id,
        intent.subject_kind,
        intent.beneficiary_id,
        attribution.kind,
        concat_ws(
          ':',
          intent.contact_email_normalization_version::text,
          intent.contact_email_hmac_key_version::text,
          encode(intent.contact_email_hmac, 'hex')
        ) AS sponsor_contact_key,
        greatest(
          attribution.finalized_at,
          attribution.conversion_occurred_at,
          first_payment.effective_at
        ) AS effective_at
      FROM public.sponsorship_attributions attribution
      JOIN public.sponsorship_intents intent
        ON intent.id = attribution.sponsorship_intent_id
      JOIN LATERAL (
        SELECT min(
          greatest(movement.occurred_at, movement.recorded_at)
        ) AS effective_at
        FROM public.sponsorship_financial_movements movement
        WHERE movement.sponsorship_intent_id = intent.id
          AND movement.entry_kind = 'sponsorship_payment'
          AND movement.occurred_at < target_source_cutoff
          AND movement.recorded_at < target_source_cutoff
      ) first_payment ON first_payment.effective_at IS NOT NULL
      WHERE attribution.advocate_id = target_advocate_id
        AND attribution.analytics_eligible
        AND attribution.finalized_at IS NOT NULL
        AND attribution.finalized_at < target_source_cutoff
        AND attribution.conversion_occurred_at IS NOT NULL
        AND attribution.conversion_occurred_at < target_source_cutoff
        AND (
          attribution.kind = 'direct'
          OR (
            attribution.kind = 'post_visit_attributed'
            AND attribution.exposure_lag >= interval '0 seconds'
            AND attribution.exposure_lag <= interval '30 days'
          )
        )
    ),
    beneficiary_associations AS MATERIALIZED (
      SELECT
        sponsorship.sponsorship_intent_id,
        sponsorship.beneficiary_id,
        sponsorship.sponsor_contact_key,
        sponsorship.effective_at
      FROM qualified_sponsorships sponsorship
      WHERE sponsorship.subject_kind = 'standard'
        AND sponsorship.beneficiary_id IS NOT NULL

      UNION ALL

      SELECT
        sponsorship.sponsorship_intent_id,
        assignment.beneficiary_id,
        sponsorship.sponsor_contact_key,
        greatest(sponsorship.effective_at, assignment.created_at)
      FROM qualified_sponsorships sponsorship
      JOIN public.subscriptions subscription
        ON subscription.sponsorship_intent_id =
          sponsorship.sponsorship_intent_id
      JOIN public.subscription_beneficiary_assignments assignment
        ON assignment.subscription_id = subscription.id
       AND assignment.beneficiary_id = subscription.beneficiary_id
      WHERE sponsorship.subject_kind = 'blind'
        AND assignment.created_at < target_source_cutoff
    ),
    ranked_beneficiaries AS MATERIALIZED (
      SELECT
        association.*,
        row_number() OVER (
          PARTITION BY association.beneficiary_id
          ORDER BY
            association.effective_at,
            association.sponsorship_intent_id,
            association.sponsor_contact_key
        ) AS beneficiary_ordinal
      FROM beneficiary_associations association
      WHERE association.effective_at < target_source_cutoff
    )
    SELECT
      CASE target_metric_key
        WHEN 'children_sponsored' THEN (
          SELECT count(*)
          FROM ranked_beneficiaries beneficiary
          WHERE beneficiary.beneficiary_ordinal = 1
        )
        WHEN 'direct_sponsorships' THEN (
          SELECT count(*)
          FROM qualified_sponsorships sponsorship
          WHERE sponsorship.kind = 'direct'
        )
        ELSE (
          SELECT count(*)
          FROM qualified_sponsorships sponsorship
          WHERE sponsorship.kind = 'post_visit_attributed'
        )
      END,
      CASE target_metric_key
        WHEN 'children_sponsored' THEN (
          SELECT count(DISTINCT beneficiary.sponsor_contact_key)
          FROM ranked_beneficiaries beneficiary
          WHERE beneficiary.beneficiary_ordinal = 1
            AND beneficiary.effective_at >= v_prior_cutoff
        )
        WHEN 'direct_sponsorships' THEN (
          SELECT count(DISTINCT sponsorship.sponsor_contact_key)
          FROM qualified_sponsorships sponsorship
          WHERE sponsorship.kind = 'direct'
            AND sponsorship.effective_at >= v_prior_cutoff
        )
        ELSE (
          SELECT count(DISTINCT sponsorship.sponsor_contact_key)
          FROM qualified_sponsorships sponsorship
          WHERE sponsorship.kind = 'post_visit_attributed'
            AND sponsorship.effective_at >= v_prior_cutoff
        )
      END
    INTO v_raw_total, v_support_contacts;

    metric_unit := 'count';
    v_bucket := (floor(v_raw_total / 5) * 5)::bigint;
  END IF;

  IF v_support_contacts < 5
     OR v_bucket <= coalesce(prior_released_bucket, 0) THEN
    candidate_bucket := NULL;
  ELSE
    candidate_bucket := v_bucket;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION
  private.calculate_advocate_public_metric_candidate(
    uuid,
    public.advocate_public_metric_key,
    timestamp with time zone,
    bigint,
    timestamp with time zone
  )
  FROM PUBLIC, anon, authenticated, service_role;

/*
 * The browser never calls this function. The application service supplies the
 * already authenticated actor and server generated audit correlation values.
 */
DROP FUNCTION public.replace_advocate_public_metrics(
  uuid,
  bigint,
  public.advocate_public_metric_key[],
  text,
  text,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.replace_advocate_public_metrics(
  target_advocate_id uuid,
  acting_user_id uuid,
  expected_advocate_version bigint,
  target_metric_keys public.advocate_public_metric_key[],
  change_reason text,
  request_id text,
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
  v_membership public.advocate_memberships%ROWTYPE;
  v_reason text := nullif(btrim(change_reason), '');
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
  v_session_id text := nullif(btrim(session_id), '');
  v_current_metric_keys public.advocate_public_metric_key[];
  v_resulting_version bigint;
BEGIN
  PERFORM private.require_advocate_public_metric_service_role();

  IF target_advocate_id IS NULL
     OR acting_user_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'Public metric replacement input is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_metric_keys IS NULL
     OR array_position(target_metric_keys, NULL) IS NOT NULL
     OR (
       SELECT count(DISTINCT requested.metric_key)
       FROM unnest(target_metric_keys) requested(metric_key)
     ) <> cardinality(target_metric_keys)
     OR EXISTS (
       SELECT 1
       FROM unnest(target_metric_keys) requested(metric_key)
       WHERE requested.metric_key NOT IN (
         'children_sponsored',
         'gross_raised_usd',
         'direct_sponsorships',
         'post_visit_attributed_sponsorships'
       )
     ) THEN
    RAISE EXCEPTION 'Public metric keys must be an ordered unique allowlisted array'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) > 500
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A public metric change reason between 1 and 500 characters without control characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_request_id IS NULL
     OR char_length(v_request_id) > 255
     OR v_request_id ~ '[[:cntrl:]]'
     OR char_length(coalesce(v_trace_id, '')) > 255
     OR coalesce(v_trace_id, '') ~ '[[:cntrl:]]'
     OR char_length(coalesce(v_session_id, '')) > 255
     OR coalesce(v_session_id, '') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Public metric audit identifiers are malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND OR v_advocate.relationship_status <> 'active' THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = acting_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (
      account.banned_until IS NULL
      OR account.banned_until <= clock_timestamp()
    )
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.user_id = acting_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_membership.status <> 'active' THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.advocate_membership_roles membership_role
  JOIN public.advocate_role_permissions role_permission
    ON role_permission.role_id = membership_role.role_id
  JOIN public.advocate_permissions permission
    ON permission.id = role_permission.permission_id
  WHERE membership_role.advocate_id = v_membership.advocate_id
    AND membership_role.membership_id = v_membership.id
    AND permission.key = 'portal.public_metrics.update'
  FOR SHARE OF membership_role, role_permission, permission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate settings changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(
    array_agg(selection.metric_key ORDER BY selection.display_order),
    ARRAY[]::public.advocate_public_metric_key[]
  )
  INTO v_current_metric_keys
  FROM public.advocate_public_metric_selections selection
  WHERE selection.advocate_id = v_advocate.id;

  IF v_current_metric_keys = target_metric_keys THEN
    RAISE EXCEPTION 'Public metric selection is unchanged'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => acting_user_id,
    context_tool => 'advocate-portal-public-metrics',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_session_id => v_session_id,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'replace_public_metrics',
      'resource_kind', 'advocate_public_metric_selections',
      'resource_id', v_advocate.id::text,
      'permission_key', 'portal.public_metrics.update'
    )
  );

  DELETE FROM public.advocate_public_metric_selections selection
  WHERE selection.advocate_id = v_advocate.id;

  INSERT INTO public.advocate_public_metric_selections (
    advocate_id,
    metric_key,
    display_order
  )
  SELECT
    v_advocate.id,
    requested.metric_key,
    (requested.ordinality - 1)::integer
  FROM unnest(target_metric_keys) WITH ORDINALITY
    AS requested(metric_key, ordinality)
  ORDER BY requested.ordinality;

  UPDATE public.advocates advocate
  SET display_name = advocate.display_name
  WHERE advocate.id = v_advocate.id
  RETURNING advocate.version INTO v_resulting_version;

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.replace_advocate_public_metrics(
  uuid,
  uuid,
  bigint,
  public.advocate_public_metric_key[],
  text,
  text,
  text,
  text
) IS
  'Service only actor aware replacement of the complete ordered safe public metric selection with locked authorization, optimistic aggregate versioning, server supplied audit identifiers, and no-op rejection.';

REVOKE ALL ON FUNCTION public.replace_advocate_public_metrics(
  uuid,
  uuid,
  bigint,
  public.advocate_public_metric_key[],
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_advocate_public_metrics(
  uuid,
  uuid,
  bigint,
  public.advocate_public_metric_key[],
  text,
  text,
  text,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_advocate_public_metric_releases(
  batch_limit integer,
  request_id text,
  trace_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_policy_version constant text := 'public-v1';
  v_source_cutoff timestamp with time zone := (
    date_trunc(
      'week',
      clock_timestamp() AT TIME ZONE 'UTC'
    ) - interval '7 days'
  ) AT TIME ZONE 'UTC';
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
  v_advocate record;
  v_metric record;
  v_prior_source_cutoff timestamp with time zone;
  v_prior_released_bucket bigint;
  v_candidate_bucket bigint;
  v_metric_unit text;
  v_inserted integer;
  v_processed_advocates integer := 0;
  v_inserted_releases integer := 0;
  v_pending_metrics integer := 0;
  v_active_advocates integer;
BEGIN
  PERFORM private.require_advocate_public_metric_service_role();

  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Public metric refresh batch limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  IF v_request_id IS NULL
     OR char_length(v_request_id) > 255
     OR v_request_id ~ '[[:cntrl:]]'
     OR char_length(coalesce(v_trace_id, '')) > 255
     OR coalesce(v_trace_id, '') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Public metric refresh audit identifiers are malformed'
      USING ERRCODE = '22023';
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'advocate-public-metric-release:public-v1',
      0
    )
  ) THEN
    RETURN jsonb_build_object(
      'processed_advocates', 0,
      'inserted_releases', 0,
      'pending_metrics', 0,
      'source_cutoff', to_char(
        v_source_cutoff AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ),
      'policy_version', v_policy_version
    );
  END IF;

  SELECT count(*)::integer
  INTO v_active_advocates
  FROM public.advocates advocate
  WHERE advocate.relationship_status = 'active'
    AND advocate.publication_status = 'active';

  IF v_active_advocates > batch_limit THEN
    RAISE EXCEPTION 'Active advocate count exceeds public metric refresh batch capacity'
      USING ERRCODE = '54000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-public-metrics-worker',
    context_tool => 'advocate-public-metrics-refresh',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Publish privacy protected weekly advocate metric buckets',
    context_metadata => jsonb_build_object(
      'operation', 'refresh_public_metrics',
      'resource_kind', 'advocate_public_metric_releases',
      'resource_id', to_char(
        v_source_cutoff AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ),
      'outcome', 'evaluated'
    )
  );

  PERFORM pg_catalog.set_config(
    'app.advocate_public_metric_release.operation',
    'refresh-public-v1',
    true
  );

  FOR v_advocate IN
    SELECT advocate.id
    FROM public.advocates advocate
    WHERE advocate.relationship_status = 'active'
      AND advocate.publication_status = 'active'
    ORDER BY advocate.id
    LIMIT batch_limit
  LOOP
    v_processed_advocates := v_processed_advocates + 1;

    FOR v_metric IN
      SELECT metric.metric_key::public.advocate_public_metric_key
      FROM (
        VALUES
          ('children_sponsored', 0),
          ('gross_raised_usd', 1),
          ('direct_sponsorships', 2),
          ('post_visit_attributed_sponsorships', 3)
      ) metric(metric_key, display_order)
      ORDER BY metric.display_order
    LOOP
      v_prior_source_cutoff := NULL;
      v_prior_released_bucket := NULL;

      SELECT
        release.source_cutoff,
        release.released_bucket
      INTO
        v_prior_source_cutoff,
        v_prior_released_bucket
      FROM private.advocate_public_metric_releases release
      WHERE release.advocate_id = v_advocate.id
        AND release.metric_key = v_metric.metric_key
        AND release.policy_version = v_policy_version
      ORDER BY release.source_cutoff DESC
      LIMIT 1;

      SELECT
        candidate.candidate_bucket,
        candidate.metric_unit
      INTO
        v_candidate_bucket,
        v_metric_unit
      FROM private.calculate_advocate_public_metric_candidate(
        v_advocate.id,
        v_metric.metric_key,
        v_prior_source_cutoff,
        v_prior_released_bucket,
        v_source_cutoff
      ) candidate;

      IF v_candidate_bucket IS NULL THEN
        v_pending_metrics := v_pending_metrics + 1;
        CONTINUE;
      END IF;

      INSERT INTO private.advocate_public_metric_releases (
        advocate_id,
        metric_key,
        policy_version,
        released_bucket,
        unit,
        source_cutoff
      )
      VALUES (
        v_advocate.id,
        v_metric.metric_key,
        v_policy_version,
        v_candidate_bucket,
        v_metric_unit,
        v_source_cutoff
      )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted = 1 THEN
        v_inserted_releases := v_inserted_releases + 1;
      ELSE
        v_pending_metrics := v_pending_metrics + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'processed_advocates', v_processed_advocates,
    'inserted_releases', v_inserted_releases,
    'pending_metrics', v_pending_metrics,
    'source_cutoff', to_char(
      v_source_cutoff AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ),
    'policy_version', v_policy_version
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_advocate_public_metric_releases(
  integer,
  text,
  text
) IS
  'Service only bounded weekly refresh. A transaction advisory lock serializes workers, each metric advances independently only after five new normalized contacts support a larger rounded bucket, and no raw total or support count is retained.';

REVOKE ALL ON FUNCTION public.refresh_advocate_public_metric_releases(
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_advocate_public_metric_releases(
  integer,
  text,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION public.read_public_advocate_presentation_snapshot(
  target_hostname text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'domain', jsonb_build_object(
      'advocate_id', domain.advocate_id,
      'hostname', domain.hostname,
      'status', domain.status,
      'dns_verified_at', domain.dns_verified_at,
      'tls_ready_at', domain.tls_ready_at,
      'payments_ready_at', domain.payments_ready_at,
      'activated_at', domain.activated_at
    ),
    'advocate', jsonb_build_object(
      'id', advocate.id,
      'slug', advocate.slug,
      'display_name', advocate.display_name,
      'relationship_status', advocate.relationship_status,
      'publication_status', advocate.publication_status,
      'beneficiary_mode', advocate.beneficiary_mode
    ),
    'branding', jsonb_build_object(
      'advocate_id', branding.advocate_id,
      'primary_color', branding.primary_color,
      'accent_color', branding.accent_color,
      'logo_storage_path', branding.logo_storage_path,
      'logo_alt_text', branding.logo_alt_text,
      'opening_header_html', branding.opening_header_html,
      'about_biography_html', branding.about_biography_html
    ),
    'metricSelections', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', metric.metric_key,
            'display_order', metric.display_order,
            'status', CASE
              WHEN latest_release.released_bucket IS NULL THEN 'pending'
              ELSE 'published'
            END,
            'value', latest_release.released_bucket::text,
            'unit', latest_release.unit,
            'qualifier', CASE
              WHEN latest_release.released_bucket IS NULL THEN NULL
              ELSE 'at_least'
            END,
            'as_of', CASE
              WHEN latest_release.source_cutoff IS NULL THEN NULL
              ELSE to_char(
                latest_release.source_cutoff AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS"Z"'
              )
            END
          )
          ORDER BY metric.display_order, metric.metric_key
        )
        FROM public.advocate_public_metric_selections metric
        LEFT JOIN LATERAL (
          SELECT
            release.released_bucket,
            release.unit,
            release.source_cutoff
          FROM private.advocate_public_metric_releases release
          WHERE release.advocate_id = metric.advocate_id
            AND release.metric_key = metric.metric_key
            AND release.policy_version = 'public-v1'
          ORDER BY release.source_cutoff DESC
          LIMIT 1
        ) latest_release ON true
        WHERE metric.advocate_id = advocate.id
          AND metric.metric_key IN (
            'children_sponsored',
            'gross_raised_usd',
            'direct_sponsorships',
            'post_visit_attributed_sponsorships'
          )
      ),
      '[]'::jsonb
    )
  )
  FROM public.advocate_domains domain
  JOIN public.advocates advocate
    ON advocate.id = domain.advocate_id
  JOIN public.advocate_branding branding
    ON branding.advocate_id = advocate.id
  WHERE target_hostname IS NOT NULL
    AND target_hostname = lower(btrim(target_hostname))
    AND target_hostname = domain.hostname
    AND domain.status = 'active'
    AND domain.dns_verified_at IS NOT NULL
    AND domain.tls_ready_at IS NOT NULL
    AND domain.payments_ready_at IS NOT NULL
    AND domain.activated_at IS NOT NULL
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status = 'active'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.read_public_advocate_presentation_snapshot(text) IS
  'Service role only allowlisted presentation snapshot. Public metrics expose only an ordered pending state or the latest embargoed monotonic lower bound from public-v1. Raw values, support thresholds, sponsor facts, and release identifiers are excluded.';

REVOKE ALL ON FUNCTION public.read_public_advocate_presentation_snapshot(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_advocate_presentation_snapshot(text)
  TO service_role;

COMMIT;

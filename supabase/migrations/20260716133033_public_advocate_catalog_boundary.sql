BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_beneficiary_username_public_shape()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.username IS NOT NULL
     AND (
       NEW.username !~ '^[A-Za-z0-9._~-]{1,160}$'
       OR lower(NEW.username) IN ('.', '..', 'checkout')
     ) THEN
    RAISE EXCEPTION 'Beneficiary username is not URI safe'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_beneficiary_username_public_shape() IS
  'Rejects unsafe usernames on insert or an explicit username update without blocking unrelated updates to legacy rows.';

REVOKE ALL ON FUNCTION private.enforce_beneficiary_username_public_shape()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS beneficiary_username_public_shape_guard
  ON public.beneficiaries;
CREATE TRIGGER beneficiary_username_public_shape_guard
BEFORE INSERT OR UPDATE OF username ON public.beneficiaries
FOR EACH ROW
EXECUTE FUNCTION private.enforce_beneficiary_username_public_shape();

CREATE INDEX IF NOT EXISTS activities_public_beneficiary_timeline_idx
  ON public.activities (beneficiary_id, created_at DESC, id DESC)
  WHERE is_public IS TRUE;

CREATE INDEX IF NOT EXISTS media_public_parent_order_idx
  ON public.media (parent_id, weight, created_at, id);

CREATE OR REPLACE FUNCTION private.public_media_storage_object_exists(
  target_parent_id uuid,
  target_type public.media_type,
  target_id uuid,
  target_extension text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM storage.objects stored_object
    WHERE stored_object.bucket_id = 'media'
      AND stored_object.name =
        target_parent_id::text
        || '/'
        || target_type::text
        || '/'
        || target_id::text
        || '.'
        || target_extension
  );
$$;

COMMENT ON FUNCTION private.public_media_storage_object_exists(
  uuid,
  public.media_type,
  uuid,
  text
) IS
  'Checks one exact media storage key without exposing storage metadata or a callable public oracle.';

REVOKE ALL ON FUNCTION private.public_media_storage_object_exists(
  uuid,
  public.media_type,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.public_media_storage_object_exists(
  uuid,
  public.media_type,
  uuid,
  text
) TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.public_media
WITH (security_barrier = true)
AS
SELECT
  media.id,
  media.created_at,
  media.extension,
  media.parent_id,
  media.type,
  media.weight
FROM public.media media
WHERE private.public_media_storage_object_exists(
    media.parent_id,
    media.type,
    media.id,
    media.extension
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.beneficiaries beneficiary
      WHERE beneficiary.id = media.parent_id
        AND beneficiary.status NOT IN ('Draft', 'Archived')
    )
    OR EXISTS (
      SELECT 1
      FROM public.activities activity
      JOIN public.beneficiaries beneficiary
        ON beneficiary.id = activity.beneficiary_id
      WHERE activity.id = media.parent_id
        AND activity.is_public IS TRUE
        AND beneficiary.status NOT IN ('Draft', 'Archived')
    )
  );

COMMENT ON VIEW public.public_media IS
  'Public media projection limited to stored objects for published beneficiaries and their public activities.';

REVOKE ALL ON public.public_media
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_media TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_beneficiary_canonically_sponsorable(
  target_status public."PersonStatus",
  target_budget_goal integer,
  target_goal_fulfilled_at timestamp with time zone
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(
    target_status IS NOT NULL
    AND target_budget_goal IS NOT NULL
    AND (
      (
        target_budget_goal = -1
        AND target_status NOT IN ('Draft', 'Archived')
      )
      OR
      (
        target_budget_goal >= 500
        AND target_status IN ('New', 'Partially Funded')
        AND target_goal_fulfilled_at IS NULL
      )
    ),
    false
  );
$$;

COMMENT ON FUNCTION private.is_beneficiary_canonically_sponsorable(
  public."PersonStatus",
  integer,
  timestamp with time zone
) IS
  'Canonical fresh-checkout eligibility predicate shared by payment validation and advocate catalog reads.';

REVOKE ALL ON FUNCTION private.is_beneficiary_canonically_sponsorable(
  public."PersonStatus",
  integer,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_beneficiary_canonically_sponsorable(
  public."PersonStatus",
  integer,
  timestamp with time zone
) TO service_role;

CREATE OR REPLACE FUNCTION private.is_public_beneficiary_projection_safe(
  target_name text,
  target_username text,
  target_biography text,
  target_country text,
  target_location_str text,
  target_video_url text,
  target_introduction text,
  target_beneficiary_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(
    target_name IS NOT NULL
    AND octet_length(target_name) BETWEEN 1 AND 300
    AND target_name !~ '[[:cntrl:]]'
    AND target_username IS NOT NULL
    AND target_username ~ '^[A-Za-z0-9._~-]{1,160}$'
    AND lower(target_username) NOT IN ('.', '..', 'checkout')
    AND (
      target_biography IS NULL
      OR (
        octet_length(target_biography) <= 100000
        AND translate(target_biography, E'\t\n\r', '')
          !~ '[[:cntrl:]]'
      )
    )
    AND (
      target_country IS NULL
      OR (
        octet_length(target_country) <= 300
        AND target_country !~ '[[:cntrl:]]'
      )
    )
    AND (
      target_location_str IS NULL
      OR (
        octet_length(target_location_str) <= 1000
        AND target_location_str !~ '[[:cntrl:]]'
      )
    )
    AND (
      target_video_url IS NULL
      OR (
        octet_length(target_video_url) <= 4096
        AND target_video_url !~ '[[:cntrl:]]'
      )
    )
    AND (
      target_introduction IS NULL
      OR (
        octet_length(target_introduction) <= 100000
        AND translate(target_introduction, E'\t\n\r', '')
          !~ '[[:cntrl:]]'
      )
    )
    AND (
      target_beneficiary_type IS NULL
      OR target_beneficiary_type ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
    false
  );
$$;

COMMENT ON FUNCTION private.is_public_beneficiary_projection_safe(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Fail-closed text-shape boundary shared by public beneficiary list and purpose-specific profile reads.';

REVOKE ALL ON FUNCTION private.is_public_beneficiary_projection_safe(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_public_beneficiary_projection_safe(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION private.is_public_media_projection_safe(
  target_extension text,
  target_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(
    target_extension ~ '^[A-Za-z0-9]{1,32}$'
    AND target_type IN ('IMAGE', 'VIDEO', 'DOCUMENT'),
    false
  );
$$;

COMMENT ON FUNCTION private.is_public_media_projection_safe(text, text) IS
  'Fail-closed media row boundary shared by direct and activity media projections.';

REVOKE ALL ON FUNCTION private.is_public_media_projection_safe(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_public_media_projection_safe(text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION private.is_public_activity_projection_safe(
  target_title text,
  target_description text,
  target_activity_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      target_title IS NULL
      OR (
        octet_length(target_title) <= 10000
        AND translate(target_title, E'\t\n\r', '') !~ '[[:cntrl:]]'
      )
    )
    AND (
      target_description IS NULL
      OR (
        octet_length(target_description) <= 100000
        AND translate(target_description, E'\t\n\r', '')
          !~ '[[:cntrl:]]'
      )
    )
    AND (
      target_activity_type IS NULL
      OR target_activity_type IN ('INFO', 'UPDATE', 'SUBSCRIPTION')
    ),
    false
  );
$$;

COMMENT ON FUNCTION private.is_public_activity_projection_safe(
  text,
  text,
  text
) IS
  'Fail-closed activity row boundary shared by bounded public timeline projections.';

REVOKE ALL ON FUNCTION private.is_public_activity_projection_safe(
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_public_activity_projection_safe(
  text,
  text,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION private.validate_public_beneficiary_catalog_request(
  target_beneficiary_types text[],
  target_gender text,
  target_statuses text[],
  target_min_age integer,
  target_max_age integer,
  target_search text,
  target_page_size integer,
  after_feature_bucket integer,
  after_display_order integer,
  after_created_at timestamp with time zone,
  after_id uuid
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF target_beneficiary_types IS NOT NULL
     AND (
       cardinality(target_beneficiary_types) NOT BETWEEN 1 AND 5
       OR EXISTS (
         SELECT 1
         FROM unnest(target_beneficiary_types) AS beneficiary_type(value)
         WHERE value IS NULL
           OR value NOT IN (
             'CHILD',
             'CHILD_LABORER',
             'SPECIAL_NEEDS',
             'IN_OUR_CARE',
             'ANIMAL'
           )
       )
       OR cardinality(target_beneficiary_types) IS DISTINCT FROM (
         SELECT count(DISTINCT value)
         FROM unnest(target_beneficiary_types) AS beneficiary_type(value)
       )
     ) THEN
    RAISE EXCEPTION 'Invalid beneficiary type filter'
      USING ERRCODE = '22023';
  END IF;

  IF target_gender IS NOT NULL
     AND target_gender NOT IN ('Boy', 'Girl') THEN
    RAISE EXCEPTION 'Invalid beneficiary gender filter'
      USING ERRCODE = '22023';
  END IF;

  IF target_statuses IS NOT NULL
     AND (
       cardinality(target_statuses) NOT BETWEEN 1 AND 4
       OR EXISTS (
         SELECT 1
         FROM unnest(target_statuses) AS beneficiary_status(value)
         WHERE value IS NULL
           OR value NOT IN (
             'New',
             'Partially Funded',
             'Budget Fulfilled',
             'Sponsorship Cancelled'
           )
       )
       OR cardinality(target_statuses) IS DISTINCT FROM (
         SELECT count(DISTINCT value)
         FROM unnest(target_statuses) AS beneficiary_status(value)
       )
     ) THEN
    RAISE EXCEPTION 'Invalid beneficiary status filter'
      USING ERRCODE = '22023';
  END IF;

  IF (target_min_age IS NULL) <> (target_max_age IS NULL)
     OR (
       target_min_age IS NOT NULL
       AND (
         target_min_age < 0
         OR target_max_age < target_min_age
         OR target_max_age > 130
       )
     ) THEN
    RAISE EXCEPTION 'Invalid beneficiary age filter'
      USING ERRCODE = '22023';
  END IF;

  IF target_search IS NOT NULL
     AND (
       char_length(target_search) NOT BETWEEN 1 AND 100
       OR target_search <> btrim(target_search)
       OR target_search ~ '[[:cntrl:]]'
     ) THEN
    RAISE EXCEPTION 'Invalid beneficiary search filter'
      USING ERRCODE = '22023';
  END IF;

  IF target_page_size NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Invalid beneficiary catalog page size'
      USING ERRCODE = '22023';
  END IF;

  IF num_nulls(
       after_feature_bucket,
       after_display_order,
       after_created_at,
       after_id
     ) NOT IN (0, 4)
     OR (
       after_id IS NOT NULL
       AND (
         after_feature_bucket NOT IN (0, 1)
         OR after_display_order < 0
       )
     ) THEN
    RAISE EXCEPTION 'Invalid beneficiary catalog cursor'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.validate_public_beneficiary_catalog_request(
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) IS
  'Validates the bounded, typed filter and keyset cursor contract shared by primary and advocate public catalog RPCs.';

REVOKE ALL ON FUNCTION private.validate_public_beneficiary_catalog_request(
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.validate_public_beneficiary_catalog_request(
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION private.validate_sponsorship_checkout_eligibility(
  target_sponsorship_intent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_beneficiary public.beneficiaries%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
BEGIN
  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = target_sponsorship_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsorship intent does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_intent.base_amount_usd_cents < 500
     OR v_intent.base_amount_usd_cents > 2147483647
     OR v_intent.charged_amount_minor < 1
     OR v_intent.charged_amount_minor > 2147483647
     OR v_intent.charged_amount_minor IS DISTINCT FROM
       round(v_intent.base_amount_usd_cents * v_intent.conversion_rate) THEN
    RAISE EXCEPTION 'Sponsorship amount is outside product bounds or fails currency conversion'
      USING ERRCODE = '23514';
  END IF;

  IF (v_intent.payment_mode = 'one_time' AND v_intent.recurrence_interval IS NOT NULL)
     OR (v_intent.payment_mode = 'recurring'
       AND v_intent.recurrence_interval NOT IN ('month', 'year')) THEN
    RAISE EXCEPTION 'Sponsorship recurrence does not match the product rules'
      USING ERRCODE = '23514';
  END IF;

  IF v_intent.subject_kind = 'standard' THEN
    SELECT beneficiary.*
    INTO v_beneficiary
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id = v_intent.beneficiary_id
    FOR SHARE;

    IF NOT FOUND
       OR NOT private.is_beneficiary_canonically_sponsorable(
         v_beneficiary.status,
         v_beneficiary.budget_goal,
         v_beneficiary.goal_fulfilled_at
       ) THEN
      RAISE EXCEPTION 'Beneficiary is not canonically eligible for sponsorship'
        USING ERRCODE = '23514';
    END IF;

    IF v_beneficiary.budget_goal <> -1
       AND v_intent.base_amount_usd_cents IS DISTINCT FROM v_beneficiary.budget_goal::bigint THEN
      RAISE EXCEPTION 'Fixed sponsorship amount must equal the beneficiary budget goal'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_intent.source = 'advocate_domain' THEN
    SELECT advocate.*
    INTO v_advocate
    FROM public.advocates advocate
    WHERE advocate.id = v_intent.source_advocate_id
    FOR SHARE;

    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.id = v_intent.source_advocate_domain_id
      AND domain.advocate_id = v_intent.source_advocate_id
    FOR SHARE;

    IF v_advocate.id IS NULL
       OR v_domain.id IS NULL
       OR v_advocate.relationship_status <> 'active'
       OR v_advocate.publication_status <> 'active'
       OR v_domain.status <> 'active'
       OR v_domain.hostname <> v_intent.source_host THEN
      RAISE EXCEPTION 'Advocate portal is not eligible to begin checkout'
        USING ERRCODE = '23514';
    END IF;

    IF v_intent.subject_kind = 'standard'
       AND v_advocate.beneficiary_mode = 'selected'
       AND NOT EXISTS (
         SELECT 1
         FROM public.advocate_beneficiaries selection
         WHERE selection.advocate_id = v_advocate.id
           AND selection.beneficiary_id = v_intent.beneficiary_id
       ) THEN
      RAISE EXCEPTION 'Beneficiary is not selected for this advocate portal'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION private.validate_sponsorship_checkout_eligibility(uuid) IS
  'Validates amount, recurrence, canonical beneficiary eligibility including fulfillment evidence, and exact advocate catalog eligibility before a payment quote is issued.';

REVOKE ALL ON FUNCTION private.validate_sponsorship_checkout_eligibility(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_primary_public_beneficiary_catalog_page(
  target_beneficiary_types text[] DEFAULT NULL,
  target_gender text DEFAULT NULL,
  target_statuses text[] DEFAULT NULL,
  target_min_age integer DEFAULT NULL,
  target_max_age integer DEFAULT NULL,
  target_search text DEFAULT NULL,
  target_page_size integer DEFAULT 12,
  after_feature_bucket integer DEFAULT NULL,
  after_display_order integer DEFAULT NULL,
  after_created_at timestamp with time zone DEFAULT NULL,
  after_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM private.validate_public_beneficiary_catalog_request(
    target_beneficiary_types,
    target_gender,
    target_statuses,
    target_min_age,
    target_max_age,
    target_search,
    target_page_size,
    after_feature_bucket,
    after_display_order,
    after_created_at,
    after_id
  );

  WITH filtered AS MATERIALIZED (
    SELECT
      beneficiary.id,
      beneficiary.created_at,
      1::integer AS feature_bucket,
      2147483647::integer AS effective_display_order,
      to_jsonb(beneficiary)
        || jsonb_build_object(
          'budget_raised', coalesce(beneficiary.budget_raised, 0),
          'active_subscriptions',
            coalesce(beneficiary.active_subscriptions, 0),
          'is_featured', false,
          'advocate_display_order', NULL
        ) AS item
    FROM public.public_beneficiaries beneficiary
    WHERE private.is_public_beneficiary_projection_safe(
        beneficiary.name,
        beneficiary.username,
        beneficiary.biography,
        beneficiary.country,
        beneficiary.location_str,
        beneficiary.video_url,
        beneficiary.introduction,
        beneficiary.beneficiary_type
      )
      AND beneficiary.status IS NOT NULL
      AND beneficiary.budget_goal IS NOT NULL
      AND (
        target_beneficiary_types IS NULL
        OR beneficiary.beneficiary_type = ANY(target_beneficiary_types)
      )
      AND (
        target_gender IS NULL
        OR beneficiary.gender::text = target_gender
      )
      AND (
        target_statuses IS NULL
        OR beneficiary.status::text = ANY(target_statuses)
        OR (
          beneficiary.budget_goal = -1
          AND EXISTS (
            SELECT 1
            FROM unnest(target_statuses) AS requested_status(value)
            WHERE value <> 'Budget Fulfilled'
          )
        )
      )
      AND (
        target_min_age IS NULL
        OR beneficiary.birth_date IS NULL
        OR (
          beneficiary.birth_date <=
            (current_date - make_interval(years => target_min_age))::date
          AND beneficiary.birth_date >
            (current_date - make_interval(years => target_max_age + 1))::date
        )
      )
      AND (
        target_search IS NULL
        OR strpos(lower(coalesce(beneficiary.name, '')), lower(target_search)) > 0
        OR strpos(lower(coalesce(beneficiary.username, '')), lower(target_search)) > 0
      )
  ),
  candidate_page AS MATERIALIZED (
    SELECT filtered.*
    FROM filtered
    WHERE after_id IS NULL
      OR filtered.feature_bucket > after_feature_bucket
      OR (
        filtered.feature_bucket = after_feature_bucket
        AND filtered.effective_display_order > after_display_order
      )
      OR (
        filtered.feature_bucket = after_feature_bucket
        AND filtered.effective_display_order = after_display_order
        AND filtered.created_at < after_created_at
      )
      OR (
        filtered.feature_bucket = after_feature_bucket
        AND filtered.effective_display_order = after_display_order
        AND filtered.created_at = after_created_at
        AND filtered.id < after_id
      )
    ORDER BY
      filtered.feature_bucket,
      filtered.effective_display_order,
      filtered.created_at DESC,
      filtered.id DESC
    LIMIT target_page_size + 1
  ),
  visible_page AS MATERIALIZED (
    SELECT candidate_page.*
    FROM candidate_page
    ORDER BY
      candidate_page.feature_bucket,
      candidate_page.effective_display_order,
      candidate_page.created_at DESC,
      candidate_page.id DESC
    LIMIT target_page_size
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      (
        SELECT jsonb_agg(
          visible.item
          ORDER BY
            visible.feature_bucket,
            visible.effective_display_order,
            visible.created_at DESC,
            visible.id DESC
        )
        FROM visible_page visible
      ),
      '[]'::jsonb
    ),
    'totalCount', (SELECT count(*) FROM filtered),
    'pageInfo', jsonb_build_object(
      'limit', target_page_size,
      'hasMore', (SELECT count(*) > target_page_size FROM candidate_page),
      'nextCursor', CASE
        WHEN (SELECT count(*) > target_page_size FROM candidate_page) THEN (
          SELECT jsonb_build_object(
            'featureBucket', visible.feature_bucket,
            'displayOrder', visible.effective_display_order,
            'createdAt', visible.created_at,
            'id', visible.id
          )
          FROM visible_page visible
          ORDER BY
            visible.feature_bucket DESC,
            visible.effective_display_order DESC,
            visible.created_at,
            visible.id
          LIMIT 1
        )
        ELSE NULL
      END
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.read_primary_public_beneficiary_catalog_page(
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) IS
  'Service-only, allowlisted primary public beneficiary page with bound filters and deterministic keyset pagination.';

REVOKE ALL ON FUNCTION public.read_primary_public_beneficiary_catalog_page(
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_primary_public_beneficiary_catalog_page(
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.read_public_advocate_beneficiary_catalog_page(
  target_hostname text,
  target_beneficiary_types text[] DEFAULT NULL,
  target_gender text DEFAULT NULL,
  target_statuses text[] DEFAULT NULL,
  target_min_age integer DEFAULT NULL,
  target_max_age integer DEFAULT NULL,
  target_search text DEFAULT NULL,
  target_page_size integer DEFAULT 12,
  after_feature_bucket integer DEFAULT NULL,
  after_display_order integer DEFAULT NULL,
  after_created_at timestamp with time zone DEFAULT NULL,
  after_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_advocate_id uuid;
  v_beneficiary_mode public.advocate_beneficiary_mode;
  v_result jsonb;
BEGIN
  IF target_hostname IS NULL
     OR target_hostname <> lower(btrim(target_hostname))
     OR char_length(target_hostname) NOT BETWEEN 1 AND 253
     OR target_hostname !~
       '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.creatorshare\.com$' THEN
    RAISE EXCEPTION 'Invalid advocate hostname'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.validate_public_beneficiary_catalog_request(
    target_beneficiary_types,
    target_gender,
    target_statuses,
    target_min_age,
    target_max_age,
    target_search,
    target_page_size,
    after_feature_bucket,
    after_display_order,
    after_created_at,
    after_id
  );

  SELECT advocate.id, advocate.beneficiary_mode
  INTO v_advocate_id, v_beneficiary_mode
  FROM public.advocate_domains domain
  JOIN public.advocates advocate
    ON advocate.id = domain.advocate_id
  JOIN public.advocate_branding branding
    ON branding.advocate_id = advocate.id
  WHERE domain.hostname = target_hostname
    AND domain.status = 'active'
    AND domain.dns_verified_at IS NOT NULL
    AND domain.tls_ready_at IS NOT NULL
    AND domain.payments_ready_at IS NOT NULL
    AND domain.activated_at IS NOT NULL
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status = 'active'
  LIMIT 1;

  IF v_advocate_id IS NULL THEN
    RETURN NULL;
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT
      public_beneficiary.id,
      public_beneficiary.created_at,
      CASE
        WHEN v_beneficiary_mode IN ('all_featured', 'selected')
          AND selection.is_featured IS TRUE
          THEN 0
        ELSE 1
      END::integer AS feature_bucket,
      CASE
        WHEN v_beneficiary_mode = 'selected'
          THEN selection.display_order
        WHEN v_beneficiary_mode = 'all_featured'
          AND selection.is_featured IS TRUE
          THEN selection.display_order
        ELSE 2147483647
      END::integer AS effective_display_order,
      to_jsonb(public_beneficiary)
        || jsonb_build_object(
          'budget_raised', coalesce(public_beneficiary.budget_raised, 0),
          'active_subscriptions',
            coalesce(public_beneficiary.active_subscriptions, 0),
          'is_featured',
            v_beneficiary_mode IN ('all_featured', 'selected')
            AND selection.is_featured IS TRUE,
          'advocate_display_order', CASE
            WHEN v_beneficiary_mode = 'selected'
              THEN selection.display_order
            WHEN v_beneficiary_mode = 'all_featured'
              AND selection.is_featured IS TRUE
              THEN selection.display_order
            ELSE NULL
          END
        ) AS item
    FROM public.beneficiaries beneficiary
    JOIN public.public_beneficiaries public_beneficiary
      ON public_beneficiary.id = beneficiary.id
    LEFT JOIN public.advocate_beneficiaries selection
      ON selection.advocate_id = v_advocate_id
      AND selection.beneficiary_id = beneficiary.id
    WHERE private.is_public_beneficiary_projection_safe(
        public_beneficiary.name,
        public_beneficiary.username,
        public_beneficiary.biography,
        public_beneficiary.country,
        public_beneficiary.location_str,
        public_beneficiary.video_url,
        public_beneficiary.introduction,
        public_beneficiary.beneficiary_type
      )
      AND private.is_beneficiary_canonically_sponsorable(
        beneficiary.status,
        beneficiary.budget_goal,
        beneficiary.goal_fulfilled_at
      )
      AND (
        v_beneficiary_mode <> 'selected'
        OR selection.beneficiary_id IS NOT NULL
      )
      AND (
        target_beneficiary_types IS NULL
        OR public_beneficiary.beneficiary_type = ANY(target_beneficiary_types)
      )
      AND (
        target_gender IS NULL
        OR public_beneficiary.gender::text = target_gender
      )
      AND (
        target_statuses IS NULL
        OR public_beneficiary.status::text = ANY(target_statuses)
        OR (
          beneficiary.budget_goal = -1
          AND EXISTS (
            SELECT 1
            FROM unnest(target_statuses) AS requested_status(value)
            WHERE value <> 'Budget Fulfilled'
          )
        )
      )
      AND (
        target_min_age IS NULL
        OR public_beneficiary.birth_date IS NULL
        OR (
          public_beneficiary.birth_date <=
            (current_date - make_interval(years => target_min_age))::date
          AND public_beneficiary.birth_date >
            (current_date - make_interval(years => target_max_age + 1))::date
        )
      )
      AND (
        target_search IS NULL
        OR strpos(
          lower(coalesce(public_beneficiary.name, '')),
          lower(target_search)
        ) > 0
        OR strpos(
          lower(coalesce(public_beneficiary.username, '')),
          lower(target_search)
        ) > 0
      )
  ),
  candidate_page AS MATERIALIZED (
    SELECT filtered.*
    FROM filtered
    WHERE after_id IS NULL
      OR filtered.feature_bucket > after_feature_bucket
      OR (
        filtered.feature_bucket = after_feature_bucket
        AND filtered.effective_display_order > after_display_order
      )
      OR (
        filtered.feature_bucket = after_feature_bucket
        AND filtered.effective_display_order = after_display_order
        AND filtered.created_at < after_created_at
      )
      OR (
        filtered.feature_bucket = after_feature_bucket
        AND filtered.effective_display_order = after_display_order
        AND filtered.created_at = after_created_at
        AND filtered.id < after_id
      )
    ORDER BY
      filtered.feature_bucket,
      filtered.effective_display_order,
      filtered.created_at DESC,
      filtered.id DESC
    LIMIT target_page_size + 1
  ),
  visible_page AS MATERIALIZED (
    SELECT candidate_page.*
    FROM candidate_page
    ORDER BY
      candidate_page.feature_bucket,
      candidate_page.effective_display_order,
      candidate_page.created_at DESC,
      candidate_page.id DESC
    LIMIT target_page_size
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      (
        SELECT jsonb_agg(
          visible.item
          ORDER BY
            visible.feature_bucket,
            visible.effective_display_order,
            visible.created_at DESC,
            visible.id DESC
        )
        FROM visible_page visible
      ),
      '[]'::jsonb
    ),
    'totalCount', (SELECT count(*) FROM filtered),
    'pageInfo', jsonb_build_object(
      'limit', target_page_size,
      'hasMore', (SELECT count(*) > target_page_size FROM candidate_page),
      'nextCursor', CASE
        WHEN (SELECT count(*) > target_page_size FROM candidate_page) THEN (
          SELECT jsonb_build_object(
            'featureBucket', visible.feature_bucket,
            'displayOrder', visible.effective_display_order,
            'createdAt', visible.created_at,
            'id', visible.id
          )
          FROM visible_page visible
          ORDER BY
            visible.feature_bucket DESC,
            visible.effective_display_order DESC,
            visible.created_at,
            visible.id
          LIMIT 1
        )
        ELSE NULL
      END
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.read_public_advocate_beneficiary_catalog_page(
  text,
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) IS
  'Service-only, exact-active-host advocate catalog page. Selected rows always intersect canonical checkout eligibility and no tenant failure falls back to primary data.';

REVOKE ALL ON FUNCTION public.read_public_advocate_beneficiary_catalog_page(
  text,
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_advocate_beneficiary_catalog_page(
  text,
  text[],
  text,
  text[],
  integer,
  integer,
  text,
  integer,
  integer,
  integer,
  timestamp with time zone,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION private.resolve_primary_public_beneficiary_identifier(
  target_username text,
  target_beneficiary_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_beneficiary_id uuid;
BEGIN
  IF (target_username IS NULL) = (target_beneficiary_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one beneficiary identifier is required'
      USING ERRCODE = '22023';
  END IF;

  IF target_username IS NOT NULL
     AND (
       target_username !~ '^[A-Za-z0-9._~-]{1,160}$'
       OR lower(target_username) IN ('.', '..', 'checkout')
     ) THEN
    RAISE EXCEPTION 'Invalid beneficiary username'
      USING ERRCODE = '22023';
  END IF;

  SELECT beneficiary.id
  INTO v_beneficiary_id
  FROM public.public_beneficiaries beneficiary
  WHERE private.is_public_beneficiary_projection_safe(
      beneficiary.name,
      beneficiary.username,
      beneficiary.biography,
      beneficiary.country,
      beneficiary.location_str,
      beneficiary.video_url,
      beneficiary.introduction,
      beneficiary.beneficiary_type
    )
    AND beneficiary.status IS NOT NULL
    AND beneficiary.budget_goal IS NOT NULL
    AND (
      (target_username IS NOT NULL AND beneficiary.username = target_username)
      OR beneficiary.id = target_beneficiary_id
    )
  LIMIT 1;

  RETURN v_beneficiary_id;
END;
$$;

COMMENT ON FUNCTION private.resolve_primary_public_beneficiary_identifier(
  text,
  uuid
) IS
  'Resolves exactly one bounded public beneficiary username or identifier without loading unrelated public projections.';

REVOKE ALL ON FUNCTION private.resolve_primary_public_beneficiary_identifier(
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.resolve_primary_public_beneficiary_identifier(
  text,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION private.resolve_public_advocate_beneficiary_identifier(
  target_hostname text,
  target_username text,
  target_beneficiary_id uuid
)
RETURNS TABLE (
  resolved_beneficiary_id uuid,
  resolved_is_featured boolean,
  resolved_display_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_advocate_id uuid;
  v_beneficiary_mode public.advocate_beneficiary_mode;
BEGIN
  IF target_hostname IS NULL
     OR target_hostname <> lower(btrim(target_hostname))
     OR char_length(target_hostname) NOT BETWEEN 1 AND 253
     OR target_hostname !~
       '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.creatorshare\.com$' THEN
    RAISE EXCEPTION 'Invalid advocate hostname'
      USING ERRCODE = '22023';
  END IF;

  IF (target_username IS NULL) = (target_beneficiary_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one beneficiary identifier is required'
      USING ERRCODE = '22023';
  END IF;

  IF target_username IS NOT NULL
     AND (
       target_username !~ '^[A-Za-z0-9._~-]{1,160}$'
       OR lower(target_username) IN ('.', '..', 'checkout')
     ) THEN
    RAISE EXCEPTION 'Invalid beneficiary username'
      USING ERRCODE = '22023';
  END IF;

  SELECT advocate.id, advocate.beneficiary_mode
  INTO v_advocate_id, v_beneficiary_mode
  FROM public.advocate_domains domain
  JOIN public.advocates advocate
    ON advocate.id = domain.advocate_id
  JOIN public.advocate_branding branding
    ON branding.advocate_id = advocate.id
  WHERE domain.hostname = target_hostname
    AND domain.status = 'active'
    AND domain.dns_verified_at IS NOT NULL
    AND domain.tls_ready_at IS NOT NULL
    AND domain.payments_ready_at IS NOT NULL
    AND domain.activated_at IS NOT NULL
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status = 'active'
  LIMIT 1;

  IF v_advocate_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    beneficiary.id,
    v_beneficiary_mode IN ('all_featured', 'selected')
      AND selection.is_featured IS TRUE,
    CASE
      WHEN v_beneficiary_mode = 'selected'
        THEN selection.display_order
      WHEN v_beneficiary_mode = 'all_featured'
        AND selection.is_featured IS TRUE
        THEN selection.display_order
      ELSE NULL
    END
  FROM public.beneficiaries beneficiary
  JOIN public.public_beneficiaries public_beneficiary
    ON public_beneficiary.id = beneficiary.id
  LEFT JOIN public.advocate_beneficiaries selection
    ON selection.advocate_id = v_advocate_id
    AND selection.beneficiary_id = beneficiary.id
  WHERE private.is_public_beneficiary_projection_safe(
      public_beneficiary.name,
      public_beneficiary.username,
      public_beneficiary.biography,
      public_beneficiary.country,
      public_beneficiary.location_str,
      public_beneficiary.video_url,
      public_beneficiary.introduction,
      public_beneficiary.beneficiary_type
    )
    AND public_beneficiary.status IS NOT NULL
    AND public_beneficiary.budget_goal IS NOT NULL
    AND (
      (
        target_username IS NOT NULL
        AND public_beneficiary.username = target_username
      )
      OR beneficiary.id = target_beneficiary_id
    )
    AND private.is_beneficiary_canonically_sponsorable(
      beneficiary.status,
      beneficiary.budget_goal,
      beneficiary.goal_fulfilled_at
    )
    AND (
      v_beneficiary_mode <> 'selected'
      OR selection.beneficiary_id IS NOT NULL
    )
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION private.resolve_public_advocate_beneficiary_identifier(
  text,
  text,
  uuid
) IS
  'Resolves one beneficiary only when the exact active advocate host and its catalog mode authorize that beneficiary.';

REVOKE ALL ON FUNCTION private.resolve_public_advocate_beneficiary_identifier(
  text,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.resolve_public_advocate_beneficiary_identifier(
  text,
  text,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION private.build_public_beneficiary_projection(
  target_beneficiary_id uuid,
  target_is_featured boolean,
  target_advocate_display_order integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    to_jsonb(beneficiary)
      || jsonb_build_object(
        'budget_raised', coalesce(beneficiary.budget_raised, 0),
        'active_subscriptions', coalesce(beneficiary.active_subscriptions, 0),
        'is_featured', target_is_featured,
        'advocate_display_order', target_advocate_display_order
      )
  FROM public.public_beneficiaries beneficiary
  WHERE beneficiary.id = target_beneficiary_id
    AND private.is_public_beneficiary_projection_safe(
      beneficiary.name,
      beneficiary.username,
      beneficiary.biography,
      beneficiary.country,
      beneficiary.location_str,
      beneficiary.video_url,
      beneficiary.introduction,
      beneficiary.beneficiary_type
    );
$$;

COMMENT ON FUNCTION private.build_public_beneficiary_projection(
  uuid,
  boolean,
  integer
) IS
  'Builds only the allowlisted public beneficiary projection requested by the username route.';

REVOKE ALL ON FUNCTION private.build_public_beneficiary_projection(
  uuid,
  boolean,
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.build_public_beneficiary_projection(
  uuid,
  boolean,
  integer
) TO service_role;

CREATE OR REPLACE FUNCTION private.build_public_beneficiary_media_projection(
  target_beneficiary_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidate_media AS MATERIALIZED (
    SELECT media.*
    FROM public.public_media media
    WHERE media.parent_id = target_beneficiary_id
      AND private.is_public_media_projection_safe(
        media.extension,
        media.type::text
      )
    ORDER BY media.weight NULLS LAST, media.created_at, media.id
    LIMIT 501
  ),
  bounded_media AS MATERIALIZED (
    SELECT media.*
    FROM candidate_media media
    ORDER BY media.weight NULLS LAST, media.created_at, media.id
    LIMIT 500
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      jsonb_agg(
        to_jsonb(media)
        ORDER BY media.weight NULLS LAST, media.created_at, media.id
      ),
      '[]'::jsonb
    ),
    'hasMore', (SELECT count(*) > 500 FROM candidate_media)
  )
  FROM bounded_media media;
$$;

COMMENT ON FUNCTION private.build_public_beneficiary_media_projection(uuid) IS
  'Builds a shape-safe bounded direct public media projection without loading beneficiary activities.';

REVOKE ALL ON FUNCTION private.build_public_beneficiary_media_projection(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.build_public_beneficiary_media_projection(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION private.build_public_beneficiary_activities_projection(
  target_beneficiary_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidate_activities AS MATERIALIZED (
    SELECT activity.*
    FROM public.public_activities activity
    WHERE activity.beneficiary_id = target_beneficiary_id
      AND private.is_public_activity_projection_safe(
        activity.title,
        activity.description,
        activity.activity_type::text
      )
    ORDER BY activity.created_at DESC, activity.id DESC
    LIMIT 101
  ),
  bounded_activities AS MATERIALIZED (
    SELECT activity.*
    FROM candidate_activities activity
    ORDER BY activity.created_at DESC, activity.id DESC
    LIMIT 100
  ),
  candidate_media AS MATERIALIZED (
    SELECT
      media.*,
      activity.created_at AS boundary_activity_created_at
    FROM public.public_media media
    JOIN bounded_activities activity
      ON activity.id = media.parent_id
    WHERE private.is_public_media_projection_safe(
      media.extension,
      media.type::text
    )
    ORDER BY
      activity.created_at DESC,
      activity.id DESC,
      media.weight NULLS LAST,
      media.created_at,
      media.id
    LIMIT 501
  ),
  bounded_media AS MATERIALIZED (
    SELECT media.*
    FROM candidate_media media
    ORDER BY
      media.boundary_activity_created_at DESC,
      media.parent_id DESC,
      media.weight NULLS LAST,
      media.created_at,
      media.id
    LIMIT 500
  )
  SELECT jsonb_build_object(
    'items', coalesce(
      (
        SELECT jsonb_agg(
          to_jsonb(activity)
            || jsonb_build_object(
              'media', coalesce(
                (
                  SELECT jsonb_agg(
                    to_jsonb(media) - 'boundary_activity_created_at'
                    ORDER BY
                      media.weight NULLS LAST,
                      media.created_at,
                      media.id
                  )
                  FROM bounded_media media
                  WHERE media.parent_id = activity.id
                ),
                '[]'::jsonb
              )
            )
          ORDER BY activity.created_at DESC, activity.id DESC
        )
        FROM bounded_activities activity
      ),
      '[]'::jsonb
    ),
    'hasMore',
      (SELECT count(*) > 100 FROM candidate_activities)
      OR (SELECT count(*) > 500 FROM candidate_media)
  );
$$;

COMMENT ON FUNCTION private.build_public_beneficiary_activities_projection(
  uuid
) IS
  'Builds a shape-safe bounded public activity timeline and media projection without loading direct beneficiary media or beneficiary profile fields.';

REVOKE ALL ON FUNCTION private.build_public_beneficiary_activities_projection(
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.build_public_beneficiary_activities_projection(
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.read_primary_public_beneficiary_by_username(
  target_username text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH authorized AS (
    SELECT private.resolve_primary_public_beneficiary_identifier(
      target_username,
      NULL
    ) AS beneficiary_id
  )
  SELECT CASE
    WHEN authorized.beneficiary_id IS NULL THEN NULL
    ELSE private.build_public_beneficiary_projection(
      authorized.beneficiary_id,
      false,
      NULL
    )
  END
  FROM authorized;
$$;

COMMENT ON FUNCTION public.read_primary_public_beneficiary_by_username(text) IS
  'Service-only primary beneficiary profile projection for one bounded exact public username.';

REVOKE ALL ON FUNCTION public.read_primary_public_beneficiary_by_username(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_primary_public_beneficiary_by_username(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.read_public_advocate_beneficiary_by_username(
  target_hostname text,
  target_username text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.build_public_beneficiary_projection(
    authorized.resolved_beneficiary_id,
    authorized.resolved_is_featured,
    authorized.resolved_display_order
  )
  FROM private.resolve_public_advocate_beneficiary_identifier(
    target_hostname,
    target_username,
    NULL
  ) authorized;
$$;

COMMENT ON FUNCTION public.read_public_advocate_beneficiary_by_username(
  text,
  text
) IS
  'Service-only beneficiary profile projection gated by the exact active advocate host and its catalog.';

REVOKE ALL ON FUNCTION public.read_public_advocate_beneficiary_by_username(
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_advocate_beneficiary_by_username(
  text,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION public.read_primary_public_beneficiary_media_by_id(
  target_beneficiary_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH authorized AS (
    SELECT private.resolve_primary_public_beneficiary_identifier(
      NULL,
      target_beneficiary_id
    ) AS beneficiary_id
  )
  SELECT CASE
    WHEN authorized.beneficiary_id IS NULL THEN NULL
    ELSE private.build_public_beneficiary_media_projection(
      authorized.beneficiary_id
    )
  END
  FROM authorized;
$$;

COMMENT ON FUNCTION public.read_primary_public_beneficiary_media_by_id(uuid) IS
  'Service-only complete direct public media projection for one public beneficiary.';

REVOKE ALL ON FUNCTION public.read_primary_public_beneficiary_media_by_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_primary_public_beneficiary_media_by_id(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.read_public_advocate_beneficiary_media_by_id(
  target_hostname text,
  target_beneficiary_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.build_public_beneficiary_media_projection(
    authorized.resolved_beneficiary_id
  )
  FROM private.resolve_public_advocate_beneficiary_identifier(
    target_hostname,
    NULL,
    target_beneficiary_id
  ) authorized;
$$;

COMMENT ON FUNCTION public.read_public_advocate_beneficiary_media_by_id(
  text,
  uuid
) IS
  'Service-only direct public media projection gated by the exact active advocate host and its catalog.';

REVOKE ALL ON FUNCTION public.read_public_advocate_beneficiary_media_by_id(
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_advocate_beneficiary_media_by_id(
  text,
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.read_primary_public_beneficiary_activities_by_id(
  target_beneficiary_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH authorized AS (
    SELECT private.resolve_primary_public_beneficiary_identifier(
      NULL,
      target_beneficiary_id
    ) AS beneficiary_id
  )
  SELECT CASE
    WHEN authorized.beneficiary_id IS NULL THEN NULL
    ELSE private.build_public_beneficiary_activities_projection(
      authorized.beneficiary_id
    )
  END
  FROM authorized;
$$;

COMMENT ON FUNCTION public.read_primary_public_beneficiary_activities_by_id(
  uuid
) IS
  'Service-only complete public activity history projection for one public beneficiary.';

REVOKE ALL ON FUNCTION public.read_primary_public_beneficiary_activities_by_id(
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_primary_public_beneficiary_activities_by_id(
  uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.read_public_advocate_beneficiary_activities_by_id(
  target_hostname text,
  target_beneficiary_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.build_public_beneficiary_activities_projection(
    authorized.resolved_beneficiary_id
  )
  FROM private.resolve_public_advocate_beneficiary_identifier(
    target_hostname,
    NULL,
    target_beneficiary_id
  ) authorized;
$$;

COMMENT ON FUNCTION public.read_public_advocate_beneficiary_activities_by_id(
  text,
  uuid
) IS
  'Service-only public activity history projection gated by the exact active advocate host and its catalog.';

REVOKE ALL ON FUNCTION public.read_public_advocate_beneficiary_activities_by_id(
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_advocate_beneficiary_activities_by_id(
  text,
  uuid
) TO service_role;

COMMIT;

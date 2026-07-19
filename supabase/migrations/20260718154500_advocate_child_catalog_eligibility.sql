/*
 * Forward-only advocate child catalog eligibility boundary.
 *
 * The public catalog migration predates this change in deployed databases, so
 * every helper and replacement below lives in a new migration. Fresh resets
 * and incremental upgrades therefore execute the same transition.
 */

BEGIN;

CREATE OR REPLACE FUNCTION private.is_advocate_child_beneficiary_type(
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
    target_beneficiary_type IN (
      'CHILD',
      'CHILD_LABORER',
      'SPECIAL_NEEDS',
      'IN_OUR_CARE'
    ),
    false
  );
$$;

COMMENT ON FUNCTION private.is_advocate_child_beneficiary_type(text) IS
  'Fail-closed advocate catalog boundary for every supported child sponsorship type. Animals, unknown legacy types, and null types remain outside advocate portals.';

REVOKE ALL ON FUNCTION private.is_advocate_child_beneficiary_type(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_advocate_child_beneficiary_type(text)
  TO service_role;

CREATE OR REPLACE FUNCTION private.is_advocate_child_eligible(
  target_status public."PersonStatus",
  target_budget_goal integer,
  target_goal_fulfilled_at timestamp with time zone,
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
  SELECT
    private.is_advocate_child_beneficiary_type(target_beneficiary_type)
    AND private.is_beneficiary_canonically_sponsorable(
      target_status,
      target_budget_goal,
      target_goal_fulfilled_at
    )
    AND private.is_public_beneficiary_projection_safe(
      target_name,
      target_username,
      target_biography,
      target_country,
      target_location_str,
      target_video_url,
      target_introduction,
      target_beneficiary_type
    );
$$;

COMMENT ON FUNCTION private.is_advocate_child_eligible(
  public."PersonStatus",
  integer,
  timestamp with time zone,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Single fail-closed child eligibility boundary shared by advocate administration, public presentation, direct reads, and final checkout validation.';

REVOKE ALL ON FUNCTION private.is_advocate_child_eligible(
  public."PersonStatus",
  integer,
  timestamp with time zone,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_advocate_child_eligible(
  public."PersonStatus",
  integer,
  timestamp with time zone,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
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
       AND NOT private.is_advocate_child_eligible(
         v_beneficiary.status,
         v_beneficiary.budget_goal,
         v_beneficiary.goal_fulfilled_at,
         v_beneficiary.name,
         v_beneficiary.username,
         v_beneficiary.biography,
         v_beneficiary.country,
         v_beneficiary.location_str,
         v_beneficiary.video_url,
         v_beneficiary.introduction,
         v_beneficiary.beneficiary_type
       ) THEN
      RAISE EXCEPTION 'Beneficiary is not eligible for an advocate child catalog'
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
  'Validates amount, recurrence, canonical beneficiary eligibility including fulfillment evidence, the advocate child-only boundary, and exact advocate catalog eligibility before a payment quote is issued.';

REVOKE ALL ON FUNCTION private.validate_sponsorship_checkout_eligibility(uuid)
  FROM PUBLIC, anon, authenticated, service_role;


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
        WHEN v_beneficiary_mode = 'all_featured'
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
    WHERE private.is_advocate_child_eligible(
        beneficiary.status,
        beneficiary.budget_goal,
        beneficiary.goal_fulfilled_at,
        public_beneficiary.name,
        public_beneficiary.username,
        public_beneficiary.biography,
        public_beneficiary.country,
        public_beneficiary.location_str,
        public_beneficiary.video_url,
        public_beneficiary.introduction,
        public_beneficiary.beneficiary_type
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
  'Service-only, exact-active-host child catalog page. Selected rows preserve exact configured order, always intersect canonical checkout eligibility and safe public projection rules, and no tenant failure falls back to primary data.';

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
  WHERE private.is_advocate_child_eligible(
      beneficiary.status,
      beneficiary.budget_goal,
      beneficiary.goal_fulfilled_at,
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
  'Resolves one child only when the exact active advocate host, safe projection boundary, current sponsorship eligibility, and catalog mode authorize that beneficiary.';

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

COMMIT;

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

COMMENT ON FUNCTION private.validate_sponsorship_checkout_eligibility(uuid) IS
  'Validates amount, recurrence, canonical beneficiary eligibility including fulfillment evidence, the advocate child-only boundary, and exact advocate catalog eligibility before a payment quote is issued.';

REVOKE ALL ON FUNCTION private.validate_sponsorship_checkout_eligibility(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

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

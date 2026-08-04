/*
 * Sponsor account pages must not read the canonical subscription table.
 * These projections expose only the fields required to present and manage
 * the authenticated sponsor's recurring sponsorships. Provider routing,
 * contact, attribution, and internal financial evidence remain private.
 */

BEGIN;

DROP POLICY IF EXISTS subscriptions_select_self_or_super_admin
  ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_select_super_admin
  ON public.subscriptions;

CREATE POLICY subscriptions_select_super_admin
ON public.subscriptions
FOR SELECT
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()));

CREATE OR REPLACE FUNCTION public.list_my_recurring_sponsorships()
RETURNS TABLE (
  subscription_id uuid,
  beneficiary_id uuid,
  subscription_status text,
  amount_usd_cents integer,
  recurrence_interval text,
  current_period_end timestamp without time zone,
  subject_kind public.sponsorship_subject_kind,
  partnership_project public.project_type,
  beneficiary_name text,
  beneficiary_username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Recurring sponsorships require an authenticated account'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    subscription.id,
    subscription.beneficiary_id,
    COALESCE(subscription.status::text, 'incomplete'),
    CASE
      WHEN COALESCE(subscription.amount, 0) < 0 THEN 0
      ELSE COALESCE(subscription.amount, 0)
    END,
    pg_catalog.left(
      COALESCE(
        NULLIF(pg_catalog.btrim(subscription.interval), ''),
        'month'
      ),
      20
    ),
    subscription.current_period_end,
    subscription.subject_kind,
    subscription.partnership_project,
    pg_catalog.left(
      NULLIF(
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            beneficiary.name,
            '[[:cntrl:][:space:]]+',
            ' ',
            'g'
          )
        ),
        ''
      ),
      120
    ),
    pg_catalog.left(
      NULLIF(
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            beneficiary.username,
            '[[:cntrl:][:space:]]+',
            ' ',
            'g'
          )
        ),
        ''
      ),
      80
    )
  FROM public.subscriptions subscription
  LEFT JOIN public.sponsor_identities sponsor_identity
    ON sponsor_identity.id = subscription.sponsor_identity_id
   AND sponsor_identity.status = 'active'
  LEFT JOIN public.beneficiaries beneficiary
    ON beneficiary.id = subscription.beneficiary_id
  WHERE NOT (
      subscription.user_id IS NOT NULL
      AND sponsor_identity.auth_user_id IS NOT NULL
      AND subscription.user_id <> sponsor_identity.auth_user_id
    )
    AND (
      COALESCE(subscription.user_id = v_auth_user_id, false)
      OR COALESCE(
        sponsor_identity.auth_user_id = v_auth_user_id,
        false
      )
    )
  ORDER BY subscription.created_at DESC, subscription.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_recurring_sponsorships()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_recurring_sponsorships()
  TO authenticated;

COMMENT ON FUNCTION public.list_my_recurring_sponsorships() IS
  'Recurring sponsorship presentation for the authenticated owner. Returns no contact, provider, attribution, sponsor identity, or internal financial evidence fields.';

CREATE OR REPLACE FUNCTION public.get_my_legacy_paypal_subscription_presentation(
  target_provider_subscription_id text
)
RETURNS TABLE (
  subscription_status text,
  amount_usd_cents integer,
  recurrence_interval text,
  charged_amount_minor integer,
  charged_currency public.payment_currency,
  beneficiary_name text,
  beneficiary_location text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'PayPal subscription presentation requires an authenticated account'
      USING ERRCODE = '42501';
  END IF;

  IF target_provider_subscription_id IS NULL
     OR target_provider_subscription_id !~ '^I-[A-Z0-9-]{8,62}$' THEN
    RAISE EXCEPTION 'PayPal subscription identifier is malformed'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(subscription.status::text, 'incomplete'),
    CASE
      WHEN COALESCE(subscription.amount, 0) < 0 THEN 0
      ELSE COALESCE(subscription.amount, 0)
    END,
    pg_catalog.left(
      COALESCE(
        NULLIF(pg_catalog.btrim(subscription.interval), ''),
        'month'
      ),
      20
    ),
    CASE
      WHEN subscription.charged_amount IS NULL THEN NULL
      WHEN subscription.charged_amount < 0 THEN 0
      ELSE subscription.charged_amount
    END,
    subscription.charged_currency,
    pg_catalog.left(
      NULLIF(
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            beneficiary.name,
            '[[:cntrl:][:space:]]+',
            ' ',
            'g'
          )
        ),
        ''
      ),
      120
    ),
    pg_catalog.left(
      NULLIF(
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            beneficiary.location_str,
            '[[:cntrl:][:space:]]+',
            ' ',
            'g'
          )
        ),
        ''
      ),
      200
    )
  FROM public.subscriptions subscription
  LEFT JOIN public.sponsor_identities sponsor_identity
    ON sponsor_identity.id = subscription.sponsor_identity_id
   AND sponsor_identity.status = 'active'
  LEFT JOIN public.beneficiaries beneficiary
    ON beneficiary.id = subscription.beneficiary_id
  WHERE NOT (
      subscription.user_id IS NOT NULL
      AND sponsor_identity.auth_user_id IS NOT NULL
      AND subscription.user_id <> sponsor_identity.auth_user_id
    )
    AND (
      COALESCE(subscription.user_id = v_auth_user_id, false)
      OR COALESCE(
        sponsor_identity.auth_user_id = v_auth_user_id,
        false
      )
    )
    AND subscription.sponsorship_method = 'PAYPAL'
    AND (
      (
        subscription.provider_subscription_object_type =
          'billing_subscription'
        AND subscription.provider_subscription_object_id =
          target_provider_subscription_id
      )
      OR (
        subscription.provider_subscription_object_id IS NULL
        AND subscription.stripe_subscription_id =
          target_provider_subscription_id
      )
    )
  ORDER BY subscription.created_at DESC, subscription.id DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_legacy_paypal_subscription_presentation(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_legacy_paypal_subscription_presentation(text)
  TO authenticated;

COMMENT ON FUNCTION public.get_my_legacy_paypal_subscription_presentation(text)
IS
  'Owner checked legacy PayPal return presentation. The provider subscription identifier is accepted only as a lookup secret and is never returned.';

COMMIT;

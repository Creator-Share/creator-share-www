/*
 * Sponsor accounts need a safe history for successful one-time sponsorships.
 * The canonical financial tables remain service-only. This function derives
 * an intentionally small read model from the authenticated account's stable
 * sponsor identity and never returns contact, attribution, or provider object
 * identifiers.
 */

CREATE OR REPLACE FUNCTION public.list_my_one_time_sponsorship_history(
  target_limit integer DEFAULT 50,
  target_before_paid_at timestamptz DEFAULT NULL,
  target_before_sponsorship_intent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  sponsorship_intent_id uuid,
  subject_kind public.sponsorship_subject_kind,
  beneficiary_id uuid,
  beneficiary_name text,
  beneficiary_username text,
  partnership_project public.project_type,
  base_amount_usd_cents bigint,
  charged_amount_minor bigint,
  charged_currency public.payment_currency,
  net_base_amount_usd_cents bigint,
  net_charged_amount_minor bigint,
  provider public.sponsorship_method,
  paid_at timestamptz,
  financial_status text
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
    RAISE EXCEPTION 'Sponsorship history requires an authenticated account'
      USING ERRCODE = '42501';
  END IF;

  IF target_limit IS NULL OR target_limit < 1 OR target_limit > 100 THEN
    RAISE EXCEPTION 'Sponsorship history limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  IF (target_before_paid_at IS NULL)
       IS DISTINCT FROM (target_before_sponsorship_intent_id IS NULL) THEN
    RAISE EXCEPTION 'Sponsorship history cursor is incomplete'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH gross_payments AS MATERIALIZED (
    SELECT
      movement.id,
      movement.sponsorship_intent_id,
      movement.sponsor_identity_id,
      movement.provider,
      movement.base_amount_usd_cents,
      movement.charged_amount_minor,
      movement.charged_currency,
      movement.occurred_at
    FROM public.sponsorship_financial_movements movement
    JOIN public.sponsor_identities identity
      ON identity.id = movement.sponsor_identity_id
    JOIN public.sponsorship_intents intent
      ON intent.id = movement.sponsorship_intent_id
     AND intent.sponsor_identity_id = identity.id
    WHERE identity.auth_user_id = v_auth_user_id
      AND identity.status = 'active'
      AND intent.auth_user_id = v_auth_user_id
      AND intent.status = 'succeeded'
      AND intent.payment_mode = 'one_time'
      AND movement.payment_mode = 'one_time'
      AND movement.entry_kind = 'sponsorship_payment'
  ), financial_totals AS MATERIALIZED (
    SELECT
      gross.id AS gross_payment_id,
      sum(movement.net_base_amount_usd_cents)::bigint
        AS net_base_amount_usd_cents,
      sum(movement.net_charged_amount_minor)::bigint
        AS net_charged_amount_minor,
      sum(CASE
        WHEN movement.entry_kind = 'sponsorship_refund'
          THEN movement.charged_amount_minor
        ELSE 0
      END)::bigint AS refund_charged_amount_minor,
      sum(CASE
        WHEN movement.entry_kind = 'sponsorship_reversal'
          THEN movement.charged_amount_minor
        ELSE 0
      END)::bigint AS reversal_charged_amount_minor,
      sum(
        CASE
          WHEN movement.entry_kind = 'sponsorship_dispute_debit'
            THEN movement.charged_amount_minor
          WHEN movement.entry_kind = 'sponsorship_dispute_credit'
            THEN -movement.charged_amount_minor
          ELSE 0
        END
      )::bigint AS outstanding_dispute_charged_amount_minor
    FROM gross_payments gross
    JOIN public.sponsorship_financial_movements movement
      ON movement.id = gross.id
      OR movement.original_financial_movement_id = gross.id
    GROUP BY gross.id
  )
  SELECT
    intent.id,
    intent.subject_kind,
    intent.beneficiary_id,
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
    ),
    intent.partnership_project,
    gross.base_amount_usd_cents,
    gross.charged_amount_minor,
    gross.charged_currency,
    totals.net_base_amount_usd_cents,
    totals.net_charged_amount_minor,
    gross.provider,
    gross.occurred_at,
    CASE
      WHEN totals.outstanding_dispute_charged_amount_minor > 0
        THEN 'funds_withheld'
      WHEN totals.reversal_charged_amount_minor > 0
        AND totals.net_charged_amount_minor = 0
        THEN 'provider_reversed'
      WHEN totals.reversal_charged_amount_minor > 0
        THEN 'partially_provider_reversed'
      WHEN totals.refund_charged_amount_minor > 0
        AND totals.net_charged_amount_minor = 0
        THEN 'refunded'
      WHEN totals.refund_charged_amount_minor > 0
        THEN 'partially_refunded'
      ELSE 'paid'
    END
  FROM gross_payments gross
  JOIN financial_totals totals
    ON totals.gross_payment_id = gross.id
  JOIN public.sponsorship_intents intent
    ON intent.id = gross.sponsorship_intent_id
  LEFT JOIN public.beneficiaries beneficiary
    ON beneficiary.id = intent.beneficiary_id
  WHERE target_before_paid_at IS NULL
     OR (gross.occurred_at, intent.id) < (
       target_before_paid_at,
       target_before_sponsorship_intent_id
     )
  ORDER BY gross.occurred_at DESC, intent.id DESC
  LIMIT target_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_one_time_sponsorship_history(
  integer,
  timestamptz,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_my_one_time_sponsorship_history(
  integer,
  timestamptz,
  uuid
) TO authenticated;

COMMENT ON FUNCTION public.list_my_one_time_sponsorship_history(
  integer,
  timestamptz,
  uuid
) IS
  'Keyset-paginated one-time sponsorship history for the authenticated account owner. Returns safe product and financial state only, never contact, attribution, or provider object identifiers.';

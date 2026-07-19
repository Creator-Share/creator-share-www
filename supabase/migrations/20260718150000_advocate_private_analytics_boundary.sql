BEGIN;

LOCK TABLE public.sponsorship_attributions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.sponsorship_attributions
  ADD COLUMN analytics_eligible boolean,
  ADD COLUMN analytics_exclusion_reason text;

COMMENT ON COLUMN public.sponsorship_attributions.analytics_eligible IS
  'Immutable attribution-creation decision controlling inclusion in advocate analytics. It does not change the factual attribution kind.';
COMMENT ON COLUMN public.sponsorship_attributions.analytics_exclusion_reason IS
  'Fixed noncontact reason for excluding authenticated Creator Share staff or same-advocate members from advocate analytics.';

CREATE OR REPLACE FUNCTION private.resolve_attribution_analytics_exclusion(
  target_auth_user_id uuid,
  target_advocate_id uuid,
  target_intent_created_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_auth_user_id IS NULL
     OR target_advocate_id IS NULL
     OR target_intent_created_at IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = target_auth_user_id
      AND assignment.organization_id IS NULL
      AND assignment.advocate_id IS NULL
      AND assignment.created_at <= target_intent_created_at
  ) THEN
    RETURN 'creator_share_staff';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.user_id = target_auth_user_id
      AND membership.advocate_id = target_advocate_id
      AND membership.created_at <= target_intent_created_at
  ) THEN
    RETURN 'same_advocate_member';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_attribution_analytics_exclusion(
  uuid,
  uuid,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.resolve_attribution_analytics_exclusion(
  uuid,
  uuid,
  timestamptz
) IS
  'Classifies only identity, global role, and same-tenant membership evidence that existed when the immutable server-owned sponsorship intent was created. Staff precedence is intentional.';

CREATE OR REPLACE FUNCTION private.backfill_attribution_analytics_eligibility()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_affected bigint;
BEGIN
  WITH classifications AS MATERIALIZED (
    SELECT
      attribution.sponsorship_intent_id,
      private.resolve_attribution_analytics_exclusion(
        intent.auth_user_id,
        attribution.advocate_id,
        intent.created_at
      ) AS exclusion_reason
    FROM public.sponsorship_attributions attribution
    JOIN public.sponsorship_intents intent
      ON intent.id = attribution.sponsorship_intent_id
    WHERE attribution.analytics_eligible IS NULL
      AND attribution.analytics_exclusion_reason IS NULL
  )
  UPDATE public.sponsorship_attributions attribution
  SET
    analytics_eligible = classification.exclusion_reason IS NULL,
    analytics_exclusion_reason = classification.exclusion_reason
  FROM classifications classification
  WHERE classification.sponsorship_intent_id =
    attribution.sponsorship_intent_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$$;

REVOKE ALL ON FUNCTION private.backfill_attribution_analytics_eligibility()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.backfill_attribution_analytics_eligibility() IS
  'Null-only migration and repair boundary. Callers must hold an exclusive attribution lock and temporarily disable only the immutable UPDATE trigger. Already classified rows are never recomputed.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_attributions attribution
    LEFT JOIN public.sponsorship_intents intent
      ON intent.id = attribution.sponsorship_intent_id
    WHERE intent.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Attribution analytics backfill found an orphan intent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_attributions attribution
    WHERE attribution.analytics_eligible IS NOT NULL
       OR attribution.analytics_exclusion_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Attribution analytics columns were not introduced empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.sponsorship_attributions'::regclass
      AND trigger_definition.tgname = 'sponsorship_attributions_protect'
      AND trigger_definition.tgenabled = 'O'
      AND NOT trigger_definition.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Attribution immutability trigger is unavailable for backfill';
  END IF;
END;
$$;

ALTER TABLE public.sponsorship_attributions
  DISABLE TRIGGER sponsorship_attributions_protect;

SELECT private.backfill_attribution_analytics_eligibility();

ALTER TABLE public.sponsorship_attributions
  ENABLE TRIGGER sponsorship_attributions_protect;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.sponsorship_attributions'::regclass
      AND trigger_definition.tgname = 'sponsorship_attributions_protect'
      AND trigger_definition.tgenabled = 'O'
      AND NOT trigger_definition.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Attribution immutability trigger was not restored after backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_attributions attribution
    JOIN public.sponsorship_intents intent
      ON intent.id = attribution.sponsorship_intent_id
    CROSS JOIN LATERAL (
      SELECT private.resolve_attribution_analytics_exclusion(
        intent.auth_user_id,
        attribution.advocate_id,
        intent.created_at
      ) AS exclusion_reason
    ) classification
    WHERE attribution.analytics_eligible IS NULL
       OR attribution.analytics_eligible IS DISTINCT FROM
         (classification.exclusion_reason IS NULL)
       OR attribution.analytics_exclusion_reason IS DISTINCT FROM
         classification.exclusion_reason
  ) THEN
    RAISE EXCEPTION 'Attribution analytics backfill is incomplete or inconsistent';
  END IF;
END;
$$;

ALTER TABLE public.sponsorship_attributions
  ALTER COLUMN analytics_eligible SET NOT NULL,
  ADD CONSTRAINT sponsorship_attributions_analytics_eligibility_check CHECK (
    (
      analytics_eligible
      AND analytics_exclusion_reason IS NULL
    )
    OR (
      NOT analytics_eligible
      AND analytics_exclusion_reason IN (
        'creator_share_staff',
        'same_advocate_member'
      )
    )
  ) NOT VALID;

ALTER TABLE public.sponsorship_attributions
  VALIDATE CONSTRAINT sponsorship_attributions_analytics_eligibility_check;

CREATE OR REPLACE FUNCTION private.prevent_sponsorship_attribution_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.finalized_at IS NULL
     AND OLD.conversion_occurred_at IS NULL
     AND NEW.finalized_at IS NOT NULL
     AND NEW.conversion_occurred_at IS NOT NULL
     AND NEW.sponsorship_intent_id IS NOT DISTINCT FROM OLD.sponsorship_intent_id
     AND NEW.policy_version IS NOT DISTINCT FROM OLD.policy_version
     AND NEW.analytics_eligible IS NOT DISTINCT FROM OLD.analytics_eligible
     AND NEW.analytics_exclusion_reason IS NOT DISTINCT FROM
       OLD.analytics_exclusion_reason THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Final sponsorship attribution decisions are immutable'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_sponsorship_attribution_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.set_attribution_analytics_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_user_id uuid;
  v_intent_created_at timestamptz;
  v_exclusion_reason text;
BEGIN
  SELECT
    intent.auth_user_id,
    intent.created_at
  INTO
    v_auth_user_id,
    v_intent_created_at
  FROM public.sponsorship_intents intent
  WHERE intent.id = NEW.sponsorship_intent_id;

  v_exclusion_reason := private.resolve_attribution_analytics_exclusion(
    v_auth_user_id,
    NEW.advocate_id,
    v_intent_created_at
  );

  NEW.analytics_eligible := v_exclusion_reason IS NULL;
  NEW.analytics_exclusion_reason := v_exclusion_reason;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_attribution_analytics_eligibility()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.set_attribution_analytics_eligibility() IS
  'Overrides caller input and freezes whether an attribution may enter advocate analytics, excluding authenticated Creator Share staff and same-advocate members without changing factual source evidence.';

DROP TRIGGER IF EXISTS sponsorship_attributions_zz_analytics_eligibility
  ON public.sponsorship_attributions;
CREATE TRIGGER sponsorship_attributions_zz_analytics_eligibility
BEFORE INSERT ON public.sponsorship_attributions
FOR EACH ROW
EXECUTE FUNCTION private.set_attribution_analytics_eligibility();

COMMENT ON TRIGGER sponsorship_attributions_zz_analytics_eligibility
  ON public.sponsorship_attributions IS
  'Runs after the canonical attribution validator by trigger-name order and fixes analytics eligibility from server-owned intent identity and tenant membership evidence.';

CREATE INDEX payment_gateway_event_applications_subscription_lifecycle_idx
  ON public.payment_gateway_event_applications (
    subscription_id,
    applied_at DESC,
    gateway_event_id
  )
  WHERE effect = 'subscription_lifecycle';

CREATE OR REPLACE FUNCTION public.get_advocate_analytics_snapshot(
  target_advocate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_as_of timestamp with time zone :=
    date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_result jsonb;
BEGIN
  IF target_advocate_id IS NULL OR v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Analytics access is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = v_actor_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= now());

  IF NOT FOUND
     OR NOT private.has_advocate_permission(
       target_advocate_id,
       'portal.analytics.view'
     ) THEN
    RAISE EXCEPTION 'Analytics access is unavailable'
      USING ERRCODE = '42501';
  END IF;

  WITH intent_facts AS (
    SELECT
      intent.id AS sponsorship_intent_id,
      intent.sponsor_identity_id,
      concat_ws(
        ':',
        intent.contact_email_normalization_version::text,
        intent.contact_email_hmac_key_version::text,
        encode(intent.contact_email_hmac, 'hex')
      ) AS sponsor_contact_key,
      intent.payment_mode,
      intent.recurrence_interval,
      attribution.kind,
      CASE
        WHEN attribution.kind = 'direct'
          THEN 'direct'
        WHEN attribution.kind = 'post_visit_attributed'
             AND attribution.exposure_lag <= interval '1 day'
          THEN 'post_visit_0_1_day'
        WHEN attribution.kind = 'post_visit_attributed'
             AND attribution.exposure_lag > interval '1 day'
             AND attribution.exposure_lag <= interval '7 days'
          THEN 'post_visit_1_7_days'
        WHEN attribution.kind = 'post_visit_attributed'
             AND attribution.exposure_lag > interval '7 days'
             AND attribution.exposure_lag <= interval '30 days'
          THEN 'post_visit_7_30_days'
        WHEN attribution.kind = 'post_visit_observed'
             AND attribution.exposure_lag > interval '30 days'
             AND attribution.exposure_lag <= interval '365 days'
          THEN 'observed_30_365_days'
        ELSE NULL
      END AS segment_key,
      (
        identity.status = 'active'
        AND identity.auth_user_id IS NOT NULL
        AND identity.updated_at < v_as_of
        AND EXISTS (
          SELECT 1
          FROM auth.users account
          WHERE account.id = identity.auth_user_id
            AND account.email IS NOT NULL
            AND account.email_confirmed_at IS NOT NULL
            AND account.email_confirmed_at < v_as_of
            AND account.created_at < v_as_of
            AND (
              account.deleted_at IS NULL
              OR account.deleted_at >= v_as_of
            )
            AND account.is_anonymous IS NOT TRUE
        )
      ) AS has_verified_sponsor_account
    FROM public.sponsorship_attributions attribution
    JOIN public.sponsorship_intents intent
      ON intent.id = attribution.sponsorship_intent_id
    JOIN public.sponsor_identities identity
      ON identity.id = intent.sponsor_identity_id
    WHERE attribution.advocate_id = target_advocate_id
      AND attribution.analytics_eligible
      AND attribution.finalized_at IS NOT NULL
      AND attribution.finalized_at < v_as_of
      AND attribution.conversion_occurred_at IS NOT NULL
      AND attribution.conversion_occurred_at < v_as_of
      AND attribution.kind IN (
        'direct',
        'post_visit_attributed',
        'post_visit_observed'
      )
      AND EXISTS (
        SELECT 1
        FROM public.sponsorship_financial_movements payment
        WHERE payment.sponsorship_intent_id = intent.id
          AND payment.entry_kind = 'sponsorship_payment'
          AND payment.occurred_at < v_as_of
          AND payment.recorded_at < v_as_of
      )
  ),
  bounded_intent_facts AS (
    SELECT *
    FROM intent_facts
    WHERE segment_key IS NOT NULL
  ),
  ranked_payments AS (
    SELECT
      movement.sponsorship_intent_id,
      movement.base_amount_usd_cents,
      movement.charged_amount_minor,
      movement.charged_currency::text AS charged_currency,
      row_number() OVER (
        PARTITION BY movement.sponsorship_intent_id
        ORDER BY movement.occurred_at, movement.recorded_at, movement.id
      ) AS payment_ordinal
    FROM public.sponsorship_financial_movements movement
    JOIN bounded_intent_facts fact
      ON fact.sponsorship_intent_id = movement.sponsorship_intent_id
    WHERE movement.entry_kind = 'sponsorship_payment'
      AND movement.occurred_at < v_as_of
      AND movement.recorded_at < v_as_of
  ),
  payment_rollups AS (
    SELECT
      payment.sponsorship_intent_id,
      min(payment.charged_currency) AS charged_currency,
      coalesce(
        sum(payment.base_amount_usd_cents)
          FILTER (WHERE payment.payment_ordinal = 1),
        0
      )::bigint AS initial_collected_usd_cents,
      coalesce(
        sum(payment.base_amount_usd_cents)
          FILTER (WHERE payment.payment_ordinal > 1),
        0
      )::bigint AS renewal_collected_usd_cents,
      sum(payment.base_amount_usd_cents)::bigint
        AS gross_collected_usd_cents,
      coalesce(
        sum(payment.charged_amount_minor)
          FILTER (WHERE payment.payment_ordinal = 1),
        0
      )::bigint AS initial_collected_minor,
      coalesce(
        sum(payment.charged_amount_minor)
          FILTER (WHERE payment.payment_ordinal > 1),
        0
      )::bigint AS renewal_collected_minor,
      sum(payment.charged_amount_minor)::bigint AS gross_collected_minor
    FROM ranked_payments payment
    GROUP BY payment.sponsorship_intent_id
  ),
  movement_rollups AS (
    SELECT
      movement.sponsorship_intent_id,
      coalesce(
        sum(movement.base_amount_usd_cents) FILTER (
          WHERE movement.entry_kind IN (
            'sponsorship_refund',
            'sponsorship_reversal'
          )
        ),
        0
      )::bigint AS refunds_and_reversals_usd_cents,
      coalesce(
        sum(movement.base_amount_usd_cents) FILTER (
          WHERE movement.entry_kind = 'sponsorship_dispute_debit'
        ),
        0
      )::bigint AS dispute_debits_usd_cents,
      coalesce(
        sum(movement.base_amount_usd_cents) FILTER (
          WHERE movement.entry_kind = 'sponsorship_dispute_credit'
        ),
        0
      )::bigint AS dispute_credits_usd_cents,
      sum(movement.net_base_amount_usd_cents)::bigint
        AS net_collected_usd_cents,
      coalesce(
        sum(movement.charged_amount_minor) FILTER (
          WHERE movement.entry_kind IN (
            'sponsorship_refund',
            'sponsorship_reversal'
          )
        ),
        0
      )::bigint AS refunds_and_reversals_minor,
      coalesce(
        sum(movement.charged_amount_minor) FILTER (
          WHERE movement.entry_kind = 'sponsorship_dispute_debit'
        ),
        0
      )::bigint AS dispute_debits_minor,
      coalesce(
        sum(movement.charged_amount_minor) FILTER (
          WHERE movement.entry_kind = 'sponsorship_dispute_credit'
        ),
        0
      )::bigint AS dispute_credits_minor,
      sum(movement.net_charged_amount_minor)::bigint
        AS net_collected_minor
    FROM public.sponsorship_financial_movements movement
    JOIN bounded_intent_facts fact
      ON fact.sponsorship_intent_id = movement.sponsorship_intent_id
    WHERE movement.occurred_at < v_as_of
      AND movement.recorded_at < v_as_of
    GROUP BY movement.sponsorship_intent_id
  ),
  subscription_states AS (
    SELECT
      subscription.sponsorship_intent_id,
      subscription.amount,
      NOT EXISTS (
        SELECT 1
        FROM public.sponsorship_subscription_cancellations cancellation
        WHERE cancellation.subscription_id = subscription.id
          AND cancellation.status = 'cancelled'
          AND cancellation.settled_at IS NOT NULL
          AND cancellation.settled_at < v_as_of
      )
      AND coalesce(
        (
          SELECT event.fact_lifecycle_state = 'active'
          FROM public.payment_gateway_event_applications application
          JOIN public.payment_gateway_events event
            ON event.id = application.gateway_event_id
          WHERE application.subscription_id = subscription.id
            AND application.effect = 'subscription_lifecycle'
            AND application.applied_at < v_as_of
            AND event.occurred_at < v_as_of
          ORDER BY
            event.occurred_at DESC,
            CASE event.fact_lifecycle_state
              WHEN 'cancelled' THEN 300
              WHEN 'incomplete' THEN 200
              ELSE 100
            END DESC,
            event.id DESC
          LIMIT 1
        ),
        true
      )
      AND EXISTS (
        SELECT 1
        FROM public.sponsorship_financial_movements payment
        JOIN public.payment_gateway_events event
          ON event.id = payment.source_gateway_event_id
        WHERE payment.sponsorship_intent_id =
          subscription.sponsorship_intent_id
          AND payment.entry_kind = 'sponsorship_payment'
          AND payment.occurred_at < v_as_of
          AND payment.recorded_at < v_as_of
          AND event.fact_period_start IS NOT NULL
          AND event.fact_period_start <= v_as_of
          AND event.fact_period_end IS NOT NULL
          AND event.fact_period_end > v_as_of
      ) AS is_active_at_cutoff
    FROM public.subscriptions subscription
    WHERE subscription.sponsorship_intent_id IS NOT NULL
      AND subscription.created_at < v_as_of
  ),
  intent_rollups AS (
    SELECT
      fact.sponsorship_intent_id,
      fact.sponsor_identity_id,
      fact.sponsor_contact_key,
      fact.segment_key,
      fact.has_verified_sponsor_account,
      payment.charged_currency,
      payment.initial_collected_usd_cents,
      payment.renewal_collected_usd_cents,
      payment.gross_collected_usd_cents,
      movement.refunds_and_reversals_usd_cents,
      movement.dispute_debits_usd_cents,
      movement.dispute_credits_usd_cents,
      movement.net_collected_usd_cents,
      CASE
        WHEN fact.payment_mode = 'recurring'
             AND subscription_state.is_active_at_cutoff
             AND fact.recurrence_interval = 'month'
          THEN coalesce(subscription_state.amount, 0)::bigint
        ELSE 0::bigint
      END AS active_monthly_commitment_usd_cents,
      CASE
        WHEN fact.payment_mode = 'recurring'
             AND subscription_state.is_active_at_cutoff
             AND fact.recurrence_interval = 'year'
          THEN coalesce(subscription_state.amount, 0)::bigint
        ELSE 0::bigint
      END AS active_annual_commitment_usd_cents,
      CASE
        WHEN fact.payment_mode = 'recurring'
             AND subscription_state.is_active_at_cutoff
             AND fact.recurrence_interval = 'month'
          THEN coalesce(subscription_state.amount, 0)::bigint * 12
        WHEN fact.payment_mode = 'recurring'
             AND subscription_state.is_active_at_cutoff
             AND fact.recurrence_interval = 'year'
          THEN coalesce(subscription_state.amount, 0)::bigint
        ELSE 0::bigint
      END AS annualized_commitment_usd_cents,
      payment.initial_collected_minor,
      payment.renewal_collected_minor,
      payment.gross_collected_minor,
      movement.refunds_and_reversals_minor,
      movement.dispute_debits_minor,
      movement.dispute_credits_minor,
      movement.net_collected_minor
    FROM bounded_intent_facts fact
    JOIN payment_rollups payment
      ON payment.sponsorship_intent_id = fact.sponsorship_intent_id
    JOIN movement_rollups movement
      ON movement.sponsorship_intent_id = fact.sponsorship_intent_id
    LEFT JOIN subscription_states subscription_state
      ON subscription_state.sponsorship_intent_id = fact.sponsorship_intent_id
  ),
  expanded_cells AS (
    SELECT 'official'::text AS cell_key, rollup.*
    FROM intent_rollups rollup
    WHERE rollup.segment_key <> 'observed_30_365_days'

    UNION ALL

    SELECT 'observed'::text AS cell_key, rollup.*
    FROM intent_rollups rollup
    WHERE rollup.segment_key = 'observed_30_365_days'

    UNION ALL

    SELECT rollup.segment_key AS cell_key, rollup.*
    FROM intent_rollups rollup
  ),
  cell_dimensions AS (
    SELECT *
    FROM (VALUES
      ('official'::text, 0, false),
      ('observed'::text, 1, false),
      ('direct'::text, 2, true),
      ('post_visit_0_1_day'::text, 3, true),
      ('post_visit_1_7_days'::text, 4, true),
      ('post_visit_7_30_days'::text, 5, true),
      ('observed_30_365_days'::text, 6, true)
    ) AS dimension(cell_key, display_order, is_segment)
  ),
  cell_stats AS (
    SELECT
      expanded.cell_key,
      count(*)::bigint AS sponsorships,
      count(DISTINCT expanded.sponsor_contact_key)::bigint
        AS unique_sponsor_contacts,
      count(DISTINCT expanded.sponsor_identity_id) FILTER (
        WHERE expanded.has_verified_sponsor_account
      )::bigint AS verified_sponsor_accounts,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.has_verified_sponsor_account
      )::bigint AS verified_account_contacts,
      sum(expanded.initial_collected_usd_cents)::bigint
        AS initial_collected_usd_cents,
      sum(expanded.renewal_collected_usd_cents)::bigint
        AS renewal_collected_usd_cents,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.renewal_collected_usd_cents > 0
      )::bigint AS renewal_contacts,
      sum(expanded.gross_collected_usd_cents)::bigint
        AS gross_collected_usd_cents,
      sum(expanded.refunds_and_reversals_usd_cents)::bigint
        AS refunds_and_reversals_usd_cents,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.refunds_and_reversals_usd_cents > 0
      )::bigint AS refund_and_reversal_contacts,
      sum(expanded.dispute_debits_usd_cents)::bigint
        AS dispute_debits_usd_cents,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.dispute_debits_usd_cents > 0
      )::bigint AS dispute_debit_contacts,
      sum(expanded.dispute_credits_usd_cents)::bigint
        AS dispute_credits_usd_cents,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.dispute_credits_usd_cents > 0
      )::bigint AS dispute_credit_contacts,
      sum(expanded.net_collected_usd_cents)::bigint
        AS net_collected_usd_cents,
      sum(expanded.active_monthly_commitment_usd_cents)::bigint
        AS active_monthly_commitment_usd_cents,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.active_monthly_commitment_usd_cents > 0
      )::bigint AS active_monthly_contacts,
      sum(expanded.active_annual_commitment_usd_cents)::bigint
        AS active_annual_commitment_usd_cents,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.active_annual_commitment_usd_cents > 0
      )::bigint AS active_annual_contacts,
      sum(expanded.annualized_commitment_usd_cents)::bigint
        AS annualized_commitment_usd_cents,
      count(DISTINCT expanded.sponsor_contact_key) FILTER (
        WHERE expanded.annualized_commitment_usd_cents > 0
      )::bigint AS annualized_commitment_contacts
    FROM expanded_cells expanded
    GROUP BY expanded.cell_key
  ),
  segment_measure_suppression AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND (
            stat.verified_account_contacts BETWEEN 1 AND 4
            OR stat.verified_sponsor_accounts BETWEEN 1 AND 4
            OR (
              stat.unique_sponsor_contacts - stat.verified_account_contacts
            ) BETWEEN 1 AND 4
            OR (
              stat.unique_sponsor_contacts - stat.verified_sponsor_accounts
            ) BETWEEN 1 AND 4
          )
      ) AS suppress_verified_accounts,
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND stat.renewal_contacts BETWEEN 1 AND 4
      ) AS suppress_renewal,
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND stat.refund_and_reversal_contacts BETWEEN 1 AND 4
      ) AS suppress_refunds_and_reversals,
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND stat.dispute_debit_contacts BETWEEN 1 AND 4
      ) AS suppress_dispute_debits,
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND stat.dispute_credit_contacts BETWEEN 1 AND 4
      ) AS suppress_dispute_credits,
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND stat.active_monthly_contacts BETWEEN 1 AND 4
      ) AS suppress_active_monthly,
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND stat.active_annual_contacts BETWEEN 1 AND 4
      ) AS suppress_active_annual,
      EXISTS (
        SELECT 1
        FROM cell_stats stat
        JOIN cell_dimensions dimension USING (cell_key)
        WHERE dimension.is_segment
          AND stat.annualized_commitment_contacts BETWEEN 1 AND 4
      ) AS suppress_annualized
  ),
  cell_values AS (
    SELECT
      dimension.cell_key,
      dimension.display_order,
      dimension.is_segment,
      coalesce(stat.sponsorships, 0)::bigint AS sponsorships,
      coalesce(stat.unique_sponsor_contacts, 0)::bigint
        AS unique_sponsor_contacts,
      CASE
        WHEN (
          dimension.is_segment
          AND suppression.suppress_verified_accounts
        )
          OR coalesce(stat.verified_account_contacts, 0) BETWEEN 1 AND 4
          OR coalesce(stat.verified_sponsor_accounts, 0) BETWEEN 1 AND 4
          OR (
            coalesce(stat.unique_sponsor_contacts, 0)
              - coalesce(stat.verified_account_contacts, 0)
          ) BETWEEN 1 AND 4
          OR (
            coalesce(stat.unique_sponsor_contacts, 0)
              - coalesce(stat.verified_sponsor_accounts, 0)
          ) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.verified_sponsor_accounts, 0)::bigint
      END AS verified_sponsor_accounts,
      coalesce(stat.initial_collected_usd_cents, 0)::bigint
        AS initial_collected_usd_cents,
      CASE
        WHEN (dimension.is_segment AND suppression.suppress_renewal)
          OR coalesce(stat.renewal_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.renewal_collected_usd_cents, 0)::bigint
      END AS renewal_collected_usd_cents,
      CASE
        WHEN (dimension.is_segment AND suppression.suppress_renewal)
          OR coalesce(stat.renewal_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.gross_collected_usd_cents, 0)::bigint
      END AS gross_collected_usd_cents,
      CASE
        WHEN (
          dimension.is_segment
          AND suppression.suppress_refunds_and_reversals
        )
          OR coalesce(stat.refund_and_reversal_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.refunds_and_reversals_usd_cents, 0)::bigint
      END AS refunds_and_reversals_usd_cents,
      CASE
        WHEN (dimension.is_segment AND suppression.suppress_dispute_debits)
          OR coalesce(stat.dispute_debit_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.dispute_debits_usd_cents, 0)::bigint
      END AS dispute_debits_usd_cents,
      CASE
        WHEN (dimension.is_segment AND suppression.suppress_dispute_credits)
          OR coalesce(stat.dispute_credit_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.dispute_credits_usd_cents, 0)::bigint
      END AS dispute_credits_usd_cents,
      CASE
        WHEN (
          dimension.is_segment
          AND (
            suppression.suppress_renewal
            OR suppression.suppress_refunds_and_reversals
            OR suppression.suppress_dispute_debits
            OR suppression.suppress_dispute_credits
          )
        )
          OR coalesce(stat.renewal_contacts, 0) BETWEEN 1 AND 4
          OR coalesce(stat.refund_and_reversal_contacts, 0) BETWEEN 1 AND 4
          OR coalesce(stat.dispute_debit_contacts, 0) BETWEEN 1 AND 4
          OR coalesce(stat.dispute_credit_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.net_collected_usd_cents, 0)::bigint
      END AS net_collected_usd_cents,
      CASE
        WHEN (dimension.is_segment AND suppression.suppress_active_monthly)
          OR coalesce(stat.active_monthly_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.active_monthly_commitment_usd_cents, 0)::bigint
      END AS active_monthly_commitment_usd_cents,
      CASE
        WHEN (dimension.is_segment AND suppression.suppress_active_annual)
          OR coalesce(stat.active_annual_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.active_annual_commitment_usd_cents, 0)::bigint
      END AS active_annual_commitment_usd_cents,
      CASE
        WHEN (
          dimension.is_segment
          AND (
            suppression.suppress_active_monthly
            OR suppression.suppress_active_annual
            OR suppression.suppress_annualized
          )
        )
          OR coalesce(stat.active_monthly_contacts, 0) BETWEEN 1 AND 4
          OR coalesce(stat.active_annual_contacts, 0) BETWEEN 1 AND 4
          OR coalesce(stat.annualized_commitment_contacts, 0) BETWEEN 1 AND 4
          THEN NULL::bigint
        ELSE coalesce(stat.annualized_commitment_usd_cents, 0)::bigint
      END AS annualized_commitment_usd_cents
    FROM cell_dimensions dimension
    LEFT JOIN cell_stats stat
      ON stat.cell_key = dimension.cell_key
    CROSS JOIN segment_measure_suppression suppression
  ),
  cell_payloads AS (
    SELECT
      cell.cell_key,
      cell.display_order,
      cell.is_segment,
      cell.unique_sponsor_contacts,
      CASE
        WHEN cell.unique_sponsor_contacts BETWEEN 1 AND 4
          THEN jsonb_build_object('suppressed', true)
        ELSE jsonb_build_object(
          'suppressed', false,
          'sponsorships', cell.sponsorships,
          'unique_sponsor_contacts', cell.unique_sponsor_contacts,
          'verified_sponsor_accounts', cell.verified_sponsor_accounts,
          'initial_collected_usd_cents', cell.initial_collected_usd_cents,
          'renewal_collected_usd_cents', cell.renewal_collected_usd_cents,
          'gross_collected_usd_cents', cell.gross_collected_usd_cents,
          'refunds_and_reversals_usd_cents',
            cell.refunds_and_reversals_usd_cents,
          'dispute_debits_usd_cents', cell.dispute_debits_usd_cents,
          'dispute_credits_usd_cents', cell.dispute_credits_usd_cents,
          'net_collected_usd_cents', cell.net_collected_usd_cents,
          'active_monthly_commitment_usd_cents',
            cell.active_monthly_commitment_usd_cents,
          'active_annual_commitment_usd_cents',
            cell.active_annual_commitment_usd_cents,
          'annualized_commitment_usd_cents',
            cell.annualized_commitment_usd_cents
        )
      END AS payload
    FROM cell_values cell
  ),
  currency_stats AS (
    SELECT
      rollup.charged_currency AS currency,
      count(*)::bigint AS sponsorships,
      count(DISTINCT rollup.sponsor_contact_key)::bigint
        AS unique_sponsor_contacts,
      sum(rollup.initial_collected_minor)::bigint
        AS initial_collected_minor,
      sum(rollup.renewal_collected_minor)::bigint
        AS renewal_collected_minor,
      count(DISTINCT rollup.sponsor_contact_key) FILTER (
        WHERE rollup.renewal_collected_minor > 0
      )::bigint AS renewal_contacts,
      sum(rollup.gross_collected_minor)::bigint AS gross_collected_minor,
      sum(rollup.refunds_and_reversals_minor)::bigint
        AS refunds_and_reversals_minor,
      count(DISTINCT rollup.sponsor_contact_key) FILTER (
        WHERE rollup.refunds_and_reversals_minor > 0
      )::bigint AS refund_and_reversal_contacts,
      sum(rollup.dispute_debits_minor)::bigint AS dispute_debits_minor,
      count(DISTINCT rollup.sponsor_contact_key) FILTER (
        WHERE rollup.dispute_debits_minor > 0
      )::bigint AS dispute_debit_contacts,
      sum(rollup.dispute_credits_minor)::bigint AS dispute_credits_minor,
      count(DISTINCT rollup.sponsor_contact_key) FILTER (
        WHERE rollup.dispute_credits_minor > 0
      )::bigint AS dispute_credit_contacts,
      sum(rollup.net_collected_minor)::bigint AS net_collected_minor
    FROM intent_rollups rollup
    WHERE rollup.segment_key <> 'observed_30_365_days'
    GROUP BY rollup.charged_currency
  ),
  currency_measure_suppression AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM currency_stats currency
        WHERE currency.renewal_contacts BETWEEN 1 AND 4
      ) AS suppress_renewal,
      EXISTS (
        SELECT 1
        FROM currency_stats currency
        WHERE currency.refund_and_reversal_contacts BETWEEN 1 AND 4
      ) AS suppress_refunds_and_reversals,
      EXISTS (
        SELECT 1
        FROM currency_stats currency
        WHERE currency.dispute_debit_contacts BETWEEN 1 AND 4
      ) AS suppress_dispute_debits,
      EXISTS (
        SELECT 1
        FROM currency_stats currency
        WHERE currency.dispute_credit_contacts BETWEEN 1 AND 4
      ) AS suppress_dispute_credits
  ),
  original_currency_payload AS (
    SELECT CASE
      WHEN EXISTS (
        SELECT 1
        FROM currency_stats currency
        WHERE currency.unique_sponsor_contacts BETWEEN 1 AND 4
      ) THEN NULL::jsonb
      ELSE coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'currency', currency.currency,
              'suppressed', false,
              'sponsorships', currency.sponsorships,
              'unique_sponsor_contacts', currency.unique_sponsor_contacts,
              'initial_collected_minor', currency.initial_collected_minor,
              'renewal_collected_minor', CASE
                WHEN suppression.suppress_renewal
                  THEN NULL::bigint
                ELSE currency.renewal_collected_minor
              END,
              'gross_collected_minor', CASE
                WHEN suppression.suppress_renewal
                  THEN NULL::bigint
                ELSE currency.gross_collected_minor
              END,
              'refunds_and_reversals_minor',
                CASE
                  WHEN suppression.suppress_refunds_and_reversals
                    THEN NULL::bigint
                  ELSE currency.refunds_and_reversals_minor
                END,
              'dispute_debits_minor', CASE
                WHEN suppression.suppress_dispute_debits
                  THEN NULL::bigint
                ELSE currency.dispute_debits_minor
              END,
              'dispute_credits_minor', CASE
                WHEN suppression.suppress_dispute_credits
                  THEN NULL::bigint
                ELSE currency.dispute_credits_minor
              END,
              'net_collected_minor', CASE
                WHEN suppression.suppress_renewal
                  OR suppression.suppress_refunds_and_reversals
                  OR suppression.suppress_dispute_debits
                  OR suppression.suppress_dispute_credits
                  THEN NULL::bigint
                ELSE currency.net_collected_minor
              END
            )
            ORDER BY currency.currency
          )
          FROM currency_stats currency
          CROSS JOIN currency_measure_suppression suppression
        ),
        '[]'::jsonb
      )
    END AS payload
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'as_of', to_char(
      v_as_of AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ),
    'methodology', jsonb_build_object(
      'minimum_sponsor_contacts_per_cell', 5,
      'official_window_days', 30,
      'observed_window_days', 365,
      'measure_suppression_enabled', true,
      'renewals_increase_funds_not_counts', true
    ),
    'official', (
      SELECT payload
      FROM cell_payloads
      WHERE cell_key = 'official'
    ),
    'observed', (
      SELECT payload
      FROM cell_payloads
      WHERE cell_key = 'observed'
    ),
    'segments', CASE
      WHEN EXISTS (
        SELECT 1
        FROM cell_payloads
        WHERE is_segment
          AND unique_sponsor_contacts BETWEEN 1 AND 4
      ) THEN NULL::jsonb
      ELSE (
        SELECT jsonb_agg(
          jsonb_build_object('key', cell_key) || payload
          ORDER BY display_order
        )
        FROM cell_payloads
        WHERE is_segment
      )
    END,
    'original_currency', (
      SELECT payload
      FROM original_currency_payload
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_analytics_snapshot(uuid) IS
  'Returns one fixed, complete-day advocate analytics snapshot with whole-cell, whole-family, per-measure, and complementary arithmetic suppression. Official direct and thirty-day attributed outcomes remain separate from one-year observed association. No arbitrary query dimensions or raw identity, visitor, attribution, intent, provider, or event values are exposed.';

REVOKE ALL ON FUNCTION public.get_advocate_analytics_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_advocate_analytics_snapshot(uuid)
  TO authenticated;

COMMIT;

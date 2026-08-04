CREATE TABLE public.subscription_beneficiary_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL UNIQUE
    REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  beneficiary_id uuid NOT NULL
    REFERENCES public.beneficiaries(id) ON DELETE RESTRICT,
  sponsorship_intent_id uuid
    REFERENCES public.sponsorship_intents(id) ON DELETE RESTRICT,
  sponsor_identity_id uuid
    REFERENCES public.sponsor_identities(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  assignment_source text NOT NULL,
  assignment_reason text NOT NULL,
  request_id text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_beneficiary_assignments_source_check CHECK (
    assignment_source IN ('self_service', 'creator_share_admin')
  ),
  CONSTRAINT subscription_beneficiary_assignments_reason_check CHECK (
    assignment_reason = btrim(assignment_reason)
    AND length(assignment_reason) BETWEEN 1 AND 1000
  ),
  CONSTRAINT subscription_beneficiary_assignments_request_check CHECK (
    request_id IS NULL OR length(request_id) BETWEEN 1 AND 255
  ),
  CONSTRAINT subscription_beneficiary_assignments_trace_check CHECK (
    trace_id IS NULL OR length(trace_id) BETWEEN 1 AND 255
  )
);

CREATE INDEX subscription_beneficiary_assignments_beneficiary_idx
  ON public.subscription_beneficiary_assignments (beneficiary_id, created_at);

CREATE INDEX subscription_beneficiary_assignments_actor_idx
  ON public.subscription_beneficiary_assignments (assigned_by_user_id, created_at)
  WHERE assigned_by_user_id IS NOT NULL;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT subscriptions_subject_shape_check,
  ADD CONSTRAINT subscriptions_subject_shape_check CHECK (
    subject_kind IS NULL
    OR (
      subject_kind = 'standard'
      AND beneficiary_id IS NOT NULL
      AND partnership_project IS NULL
    )
    OR (
      subject_kind = 'blind'
      AND partnership_project IS NULL
    )
    OR (
      subject_kind = 'partnership'
      AND beneficiary_id IS NULL
      AND partnership_project IS NOT NULL
    )
  );

COMMENT ON CONSTRAINT subscriptions_subject_shape_check
  ON public.subscriptions IS
  'Blind sponsorships begin without a beneficiary and may gain one only through immutable assignment evidence and the narrow assignment RPCs.';

CREATE OR REPLACE FUNCTION public.update_beneficiary_by_subscriptions(
  target_beneficiary_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_goal integer;
  current_status public."PersonStatus";
  current_fulfilled_at timestamptz;
  total_monthly_amount integer;
  subscription_count integer;
  calculated_status public."PersonStatus";
  new_fulfilled_at timestamptz;
BEGIN
  SELECT
    beneficiary.budget_goal,
    beneficiary.status,
    beneficiary.goal_fulfilled_at
  INTO
    current_goal,
    current_status,
    current_fulfilled_at
  FROM public.beneficiaries beneficiary
  WHERE beneficiary.id = target_beneficiary_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(sum(
      CASE
        WHEN subscription.interval = 'year'
          THEN ceiling(subscription.amount::numeric / 12)::integer
        ELSE subscription.amount
      END
    ), 0)::integer,
    count(*)::integer
  INTO total_monthly_amount, subscription_count
  FROM public.subscriptions subscription
  WHERE subscription.beneficiary_id = target_beneficiary_id
    AND subscription.status = 'complete';

  IF current_status IN ('Draft', 'Archived') THEN
    calculated_status := current_status;
  ELSIF current_goal <> -1
        AND total_monthly_amount::bigint * 100
          >= current_goal::bigint * 90 THEN
    calculated_status := 'Budget Fulfilled';
  ELSIF total_monthly_amount > 0 THEN
    calculated_status := 'Partially Funded';
  ELSE
    calculated_status := 'New';
  END IF;

  IF calculated_status = 'Budget Fulfilled'
     AND current_status <> 'Budget Fulfilled' THEN
    new_fulfilled_at := clock_timestamp();
  ELSE
    new_fulfilled_at := current_fulfilled_at;
  END IF;

  UPDATE public.beneficiaries beneficiary
  SET
    budget_raised = total_monthly_amount,
    status = calculated_status,
    active_subscriptions = subscription_count,
    goal_fulfilled_at = new_fulfilled_at
  WHERE beneficiary.id = target_beneficiary_id
    AND (
      beneficiary.budget_raised IS DISTINCT FROM total_monthly_amount
      OR beneficiary.status IS DISTINCT FROM calculated_status
      OR beneficiary.active_subscriptions IS DISTINCT FROM subscription_count
      OR beneficiary.goal_fulfilled_at IS DISTINCT FROM new_fulfilled_at
    );
END;
$$;

COMMENT ON FUNCTION public.update_beneficiary_by_subscriptions(uuid) IS
  'Recalculates monthly support using ceiling for annual installments, preserves administrative statuses, and never auto-fulfills open sponsorship beneficiaries.';

UPDATE public.beneficiaries beneficiary
SET
  status = CASE
    WHEN beneficiary.active_subscriptions > 0
      THEN 'Partially Funded'::public."PersonStatus"
    ELSE 'New'::public."PersonStatus"
  END,
  goal_fulfilled_at = NULL
WHERE beneficiary.budget_goal = -1
  AND (
    beneficiary.status = 'Budget Fulfilled'
    OR beneficiary.goal_fulfilled_at IS NOT NULL
  );

ALTER TABLE public.subscription_beneficiary_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_beneficiary_assignments
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_subscription_beneficiary_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_operation text := nullif(
    pg_catalog.current_setting(
      'app.subscription_beneficiary_assignment.operation',
      true
    ),
    ''
  );
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Subscription beneficiary assignment evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF v_operation IS DISTINCT FROM NEW.assignment_source
     OR NEW.assignment_source NOT IN ('self_service', 'creator_share_admin') THEN
    RAISE EXCEPTION 'Subscription beneficiary assignments require a narrow assignment RPC'
      USING ERRCODE = '42501';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = NEW.subscription_id
  FOR SHARE;

  IF NOT FOUND
     OR v_subscription.beneficiary_id IS NOT NULL
     OR v_subscription.status <> 'complete'
     OR NEW.sponsorship_intent_id IS DISTINCT FROM v_subscription.sponsorship_intent_id
     OR NEW.sponsor_identity_id IS DISTINCT FROM v_subscription.sponsor_identity_id THEN
    RAISE EXCEPTION 'Assignment evidence does not match an unassigned completed sponsorship'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.assigned_by_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Assignment actor does not match the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_beneficiary_assignments_protect
BEFORE INSERT OR UPDATE OR DELETE
ON public.subscription_beneficiary_assignments
FOR EACH ROW EXECUTE FUNCTION private.protect_subscription_beneficiary_assignment();

CREATE TRIGGER subscription_beneficiary_assignments_no_truncate
BEFORE TRUNCATE ON public.subscription_beneficiary_assignments
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER subscription_beneficiary_assignments_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.subscription_beneficiary_assignments
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE OR REPLACE FUNCTION private.validate_linked_payment_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.sponsorship_intents%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_movement public.sponsorship_financial_movements%ROWTYPE;
  v_beneficiary_matches boolean;
BEGIN
  IF NEW.sponsorship_intent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = NEW.sponsorship_intent_id
  FOR SHARE;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = NEW.payment_attempt_id
    AND attempt.sponsorship_intent_id = NEW.sponsorship_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked payment row does not resolve to one intent and attempt'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.sponsor_identity_id IS DISTINCT FROM v_intent.sponsor_identity_id THEN
    RAISE EXCEPTION 'Linked payment row sponsor identity does not match its intent'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'subscriptions' THEN
    v_beneficiary_matches :=
      NEW.beneficiary_id IS NOT DISTINCT FROM v_intent.beneficiary_id
      OR (
        v_intent.subject_kind = 'blind'
        AND v_intent.beneficiary_id IS NULL
        AND NEW.beneficiary_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.subscription_beneficiary_assignments assignment
          WHERE assignment.subscription_id = NEW.id
            AND assignment.beneficiary_id = NEW.beneficiary_id
            AND assignment.sponsorship_intent_id = NEW.sponsorship_intent_id
            AND assignment.sponsor_identity_id = NEW.sponsor_identity_id
        )
      );

    IF v_intent.payment_mode <> 'recurring'
       OR NEW.sponsorship_method IS DISTINCT FROM v_attempt.provider
       OR NEW.provider_account_scope IS DISTINCT FROM v_attempt.provider_account_scope
       OR NEW.customer_id IS DISTINCT FROM v_attempt.provider_customer_id
       OR NEW.provider_subscription_object_type IS DISTINCT FROM v_attempt.provider_subscription_object_type
       OR NEW.provider_subscription_object_id IS DISTINCT FROM v_attempt.provider_subscription_object_id
       OR NEW.subject_kind IS DISTINCT FROM v_intent.subject_kind
       OR NOT v_beneficiary_matches
       OR NEW.partnership_project IS DISTINCT FROM v_intent.partnership_project
       OR NEW.amount::bigint IS DISTINCT FROM v_intent.base_amount_usd_cents
       OR NEW.charged_amount::bigint IS DISTINCT FROM v_intent.charged_amount_minor
       OR NEW.charged_currency IS DISTINCT FROM v_intent.charged_currency
       OR NEW.conversion_rate IS DISTINCT FROM v_intent.conversion_rate
       OR NEW.interval IS DISTINCT FROM v_intent.recurrence_interval THEN
      RAISE EXCEPTION 'Subscription terms do not match the server owned intent'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT movement.*
    INTO v_movement
    FROM public.sponsorship_financial_movements movement
    WHERE movement.id = NEW.financial_movement_id
    FOR SHARE;

    IF NOT FOUND
       OR NEW.gateway_event_id IS DISTINCT FROM v_movement.source_gateway_event_id
       OR NEW.payment_provider IS DISTINCT FROM v_movement.provider
       OR NEW.provider_account_scope IS DISTINCT FROM v_movement.provider_account_scope
       OR NEW.provider_movement_type IS DISTINCT FROM v_movement.provider_movement_type
       OR NEW.provider_movement_id IS DISTINCT FROM v_movement.provider_movement_id
       OR NEW.financial_entry_kind IS DISTINCT FROM v_movement.entry_kind
       OR NEW.base_amount_usd_cents IS DISTINCT FROM v_movement.base_amount_usd_cents
       OR NEW.charged_amount::bigint IS DISTINCT FROM v_movement.charged_amount_minor
       OR NEW.charged_currency IS DISTINCT FROM v_movement.charged_currency
       OR NEW.conversion_rate IS DISTINCT FROM v_movement.conversion_rate
       OR NEW.provider_occurred_at IS DISTINCT FROM v_movement.occurred_at THEN
      RAISE EXCEPTION 'Ledger entry does not exactly match its financial movement'
        USING ERRCODE = '23514';
    END IF;

    IF v_movement.payment_mode IS DISTINCT FROM v_attempt.payment_mode THEN
      RAISE EXCEPTION 'Financial movement payment mode does not match its attempt'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.assign_blind_sponsorship_beneficiary_core(
  target_subscription_id uuid,
  target_beneficiary_id uuid,
  actor_user_id uuid,
  target_assignment_source text,
  target_assignment_reason text,
  target_require_subscription_owner boolean,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  assignment_id uuid,
  subscription_id uuid,
  beneficiary_id uuid,
  beneficiary_name text,
  beneficiary_username text,
  subscription_amount_usd_cents integer,
  billing_interval text,
  was_already_assigned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_beneficiary public.beneficiaries%ROWTYPE;
  v_assignment public.subscription_beneficiary_assignments%ROWTYPE;
  v_existing_monthly_amount bigint;
  v_assignment_monthly_amount bigint;
BEGIN
  IF target_subscription_id IS NULL
     OR target_beneficiary_id IS NULL
     OR actor_user_id IS NULL
     OR target_assignment_source NOT IN ('self_service', 'creator_share_admin')
     OR target_assignment_reason IS NULL
     OR target_assignment_reason <> btrim(target_assignment_reason)
     OR length(target_assignment_reason) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Blind sponsorship assignment input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions subscription
  WHERE subscription.id = target_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blind sponsorship is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF target_require_subscription_owner AND (
    v_subscription.user_id IS DISTINCT FROM actor_user_id
    OR (
      v_subscription.sponsor_identity_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.sponsor_identities identity
        WHERE identity.id = v_subscription.sponsor_identity_id
          AND identity.auth_user_id = actor_user_id
          AND identity.status = 'active'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Blind sponsorship does not belong to the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  IF v_subscription.beneficiary_id IS NOT NULL THEN
    SELECT assignment.*
    INTO v_assignment
    FROM public.subscription_beneficiary_assignments assignment
    WHERE assignment.subscription_id = v_subscription.id;

    IF v_subscription.beneficiary_id = target_beneficiary_id
       AND v_assignment.id IS NOT NULL
       AND v_assignment.beneficiary_id = target_beneficiary_id THEN
      SELECT beneficiary.*
      INTO v_beneficiary
      FROM public.beneficiaries beneficiary
      WHERE beneficiary.id = target_beneficiary_id;

      RETURN QUERY SELECT
        v_assignment.id,
        v_subscription.id,
        v_beneficiary.id,
        v_beneficiary.name,
        v_beneficiary.username,
        v_subscription.amount,
        v_subscription.interval,
        true;
      RETURN;
    END IF;

    RAISE EXCEPTION 'Blind sponsorship is already assigned to another beneficiary'
      USING ERRCODE = '23505';
  END IF;

  IF v_subscription.status <> 'complete'
     OR v_subscription.amount IS NULL
     OR v_subscription.amount <= 0
     OR v_subscription.interval NOT IN ('month', 'year')
     OR NOT (
       v_subscription.subject_kind = 'blind'
       OR (
         v_subscription.subject_kind IS NULL
         AND v_subscription.sponsorship_intent_id IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Subscription is not an assignable blind sponsorship'
      USING ERRCODE = '23514';
  END IF;

  SELECT beneficiary.*
  INTO v_beneficiary
  FROM public.beneficiaries beneficiary
  WHERE beneficiary.id = target_beneficiary_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beneficiary is unavailable for sponsorship'
      USING ERRCODE = '22023';
  END IF;

  v_assignment_monthly_amount := CASE
    WHEN v_subscription.interval = 'year'
      THEN ceiling(v_subscription.amount::numeric / 12)::bigint
    ELSE v_subscription.amount::bigint
  END;

  IF v_beneficiary.budget_goal = -1 THEN
    IF v_beneficiary.status IN ('Draft', 'Archived') THEN
      RAISE EXCEPTION 'Beneficiary is unavailable for sponsorship'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_beneficiary.budget_goal IS NULL
       OR v_beneficiary.budget_goal <= 0
       OR v_beneficiary.status NOT IN ('New', 'Partially Funded')
       OR v_beneficiary.goal_fulfilled_at IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.sponsorship_checkout_reservations reservation
         WHERE reservation.beneficiary_id = v_beneficiary.id
           AND reservation.status = 'active'
       ) THEN
      RAISE EXCEPTION 'Beneficiary is unavailable for sponsorship'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(sum(
      CASE
        WHEN subscription.interval = 'year'
          THEN ceiling(subscription.amount::numeric / 12)::bigint
        ELSE subscription.amount::bigint
      END
    ), 0)
    INTO v_existing_monthly_amount
    FROM public.subscriptions subscription
    WHERE subscription.beneficiary_id = v_beneficiary.id
      AND subscription.status = 'complete';

    IF v_existing_monthly_amount + v_assignment_monthly_amount
       > v_beneficiary.budget_goal THEN
      RAISE EXCEPTION 'Beneficiary does not have enough remaining sponsorship capacity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => (
      CASE
        WHEN target_assignment_source = 'creator_share_admin'
          THEN 'creator_share_admin'
        ELSE 'user'
      END
    )::audit.audit_actor_type,
    context_actor_user_id => actor_user_id,
    context_effective_user_id => CASE
      WHEN target_assignment_source = 'creator_share_admin'
        THEN v_subscription.user_id
      ELSE actor_user_id
    END,
    context_tool => CASE
      WHEN target_assignment_source = 'self_service'
        THEN 'assign_blind_sponsorship_beneficiary'
      ELSE 'assign_blind_sponsorship_beneficiary_admin'
    END,
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_client_ip => context_client_ip,
    context_user_agent => context_user_agent,
    context_reason => target_assignment_reason,
    context_metadata => jsonb_build_object(
      'operation', 'assign',
      'resource_kind', 'subscription',
      'resource_id', target_subscription_id::text,
      'outcome', 'assigned'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.subscription_beneficiary_assignment.operation',
    target_assignment_source,
    true
  );

  INSERT INTO public.subscription_beneficiary_assignments (
    subscription_id,
    beneficiary_id,
    sponsorship_intent_id,
    sponsor_identity_id,
    assigned_by_user_id,
    assignment_source,
    assignment_reason,
    request_id,
    trace_id
  )
  VALUES (
    v_subscription.id,
    v_beneficiary.id,
    v_subscription.sponsorship_intent_id,
    v_subscription.sponsor_identity_id,
    actor_user_id,
    target_assignment_source,
    target_assignment_reason,
    context_request_id,
    context_trace_id
  )
  RETURNING * INTO v_assignment;

  UPDATE public.subscriptions subscription
  SET beneficiary_id = v_beneficiary.id
  WHERE subscription.id = v_subscription.id
    AND subscription.beneficiary_id IS NULL
  RETURNING subscription.* INTO v_subscription;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blind sponsorship assignment lost a concurrent update'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    v_assignment.id,
    v_subscription.id,
    v_beneficiary.id,
    v_beneficiary.name,
    v_beneficiary.username,
    v_subscription.amount,
    v_subscription.interval,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_blind_sponsorship_beneficiary(
  target_subscription_id uuid,
  target_beneficiary_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  assignment_id uuid,
  subscription_id uuid,
  beneficiary_id uuid,
  beneficiary_name text,
  beneficiary_username text,
  subscription_amount_usd_cents integer,
  billing_interval text,
  was_already_assigned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Blind sponsorship assignment requires an authenticated account'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users account
    JOIN public.users application_user ON application_user.id = account.id
    WHERE account.id = v_actor_user_id
      AND account.email_confirmed_at IS NOT NULL
      AND nullif(btrim(account.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Blind sponsorship assignment requires a verified account'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT *
  FROM private.assign_blind_sponsorship_beneficiary_core(
    target_subscription_id,
    target_beneficiary_id,
    v_actor_user_id,
    'self_service',
    'Sponsor selected a beneficiary for a blind sponsorship',
    true,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_blind_sponsorship_beneficiary_admin(
  target_subscription_id uuid,
  target_beneficiary_id uuid,
  change_reason text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  assignment_id uuid,
  subscription_id uuid,
  beneficiary_id uuid,
  beneficiary_name text,
  beneficiary_username text,
  subscription_amount_usd_cents integer,
  billing_interval text,
  was_already_assigned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_actor_user_id IS NULL
     OR NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Blind sponsorship administration requires a Creator Share super administrator'
      USING ERRCODE = '42501';
  END IF;

  IF change_reason IS NULL
     OR change_reason <> btrim(change_reason)
     OR length(change_reason) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'Administrative assignment requires a reason of 5 to 1000 characters'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT *
  FROM private.assign_blind_sponsorship_beneficiary_core(
    target_subscription_id,
    target_beneficiary_id,
    v_actor_user_id,
    'creator_share_admin',
    change_reason,
    false,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION private.protect_subscription_beneficiary_assignment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assign_blind_sponsorship_beneficiary_core(
  uuid,
  uuid,
  uuid,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.assign_blind_sponsorship_beneficiary(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_blind_sponsorship_beneficiary(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_blind_sponsorship_beneficiary_admin(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_blind_sponsorship_beneficiary_admin(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

COMMENT ON TABLE public.subscription_beneficiary_assignments IS
  'Immutable evidence for the one permitted beneficiary selection on a completed blind sponsorship.';

COMMENT ON FUNCTION public.assign_blind_sponsorship_beneficiary(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) IS
  'Atomically assigns an eligible beneficiary to a blind sponsorship owned by the verified authenticated account.';

BEGIN;

-- Provider cash is evidence, not an allocation of sponsorship principal.
-- Keep it independently of the expiring encrypted webhook body.
CREATE TABLE private.provider_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider public.sponsorship_method NOT NULL CHECK (provider = 'STRIPE'),
  provider_account_scope text NOT NULL CHECK (provider_account_scope IN ('stripe_us','stripe_uk')),
  provider_movement_id text NOT NULL CHECK (provider_movement_id ~ '^txn_[A-Za-z0-9_]+$' AND length(provider_movement_id) <= 255),
  provider_object_id text NOT NULL CHECK (provider_object_id ~ '^(dp|du)_[A-Za-z0-9_]+$' AND length(provider_object_id) <= 255),
  original_financial_movement_id uuid NOT NULL REFERENCES public.sponsorship_financial_movements(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (abs(amount_minor::numeric) <= 9007199254740991),
  fee_minor bigint NOT NULL CHECK (abs(fee_minor::numeric) <= 9007199254740991),
  net_minor bigint NOT NULL CHECK ((amount_minor <> 0 OR net_minor <> 0) AND abs(net_minor::numeric) <= 9007199254740991 AND net_minor::numeric = amount_minor::numeric - fee_minor::numeric),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate numeric CHECK (exchange_rate > 0 AND exchange_rate < 10000000000),
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, provider_account_scope, provider_movement_id)
);
CREATE TABLE private.provider_cash_evidence (
  provider_account_scope text NOT NULL CHECK (provider_account_scope IN ('stripe_us','stripe_uk')),
  source_event_id text NOT NULL CHECK (source_event_id ~ '^evt_[A-Za-z0-9_]+$' AND length(source_event_id) <= 255),
  cash_movement_id uuid NOT NULL REFERENCES private.provider_cash_movements(id) ON DELETE RESTRICT,
  source_event_digest bytea NOT NULL CHECK (octet_length(source_event_digest)=32),
  signature_verified_at timestamptz NOT NULL CHECK (isfinite(signature_verified_at)),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 255),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_account_scope,source_event_id)
);
CREATE INDEX provider_cash_evidence_movement_idx
  ON private.provider_cash_evidence(cash_movement_id,provider_account_scope,source_event_id);
ALTER TABLE private.provider_cash_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.provider_cash_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.provider_cash_evidence FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.provider_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.provider_cash_movements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.provider_cash_movements FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.prevent_provider_cash_movement_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Provider cash evidence is immutable' USING ERRCODE='42501'; END;
$$;
REVOKE ALL ON FUNCTION private.prevent_provider_cash_movement_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER provider_cash_movements_no_change BEFORE UPDATE OR DELETE ON private.provider_cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.prevent_provider_cash_movement_mutation();
CREATE TRIGGER provider_cash_movements_no_truncate BEFORE TRUNCATE ON private.provider_cash_movements
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_provider_cash_movement_mutation();

CREATE TRIGGER provider_cash_evidence_no_change BEFORE UPDATE OR DELETE ON private.provider_cash_evidence
  FOR EACH ROW EXECUTE FUNCTION private.prevent_provider_cash_movement_mutation();
CREATE TRIGGER provider_cash_evidence_no_truncate BEFORE TRUNCATE ON private.provider_cash_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_provider_cash_movement_mutation();

CREATE TRIGGER provider_cash_movements_audit AFTER INSERT ON private.provider_cash_movements
  FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('','@columns_only');
CREATE TRIGGER provider_cash_evidence_audit AFTER INSERT ON private.provider_cash_evidence
  FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('','@columns_only');

CREATE FUNCTION public.record_verified_stripe_cash_movement(
  target_original_movement_id uuid, target_account_scope text, target_movement_id text,
  target_object_id text, target_amount_minor bigint, target_fee_minor bigint, target_net_minor bigint,
  target_currency text, target_exchange_rate numeric, target_occurred_at timestamptz,
  target_event_id text, target_event_digest bytea, target_signature_verified_at timestamptz,
  context_request_id text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout='5s' AS $$
DECLARE
  v_original public.sponsorship_financial_movements%ROWTYPE;
  v_existing private.provider_cash_movements%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM private.require_payment_service_role();
  SELECT * INTO v_original FROM public.sponsorship_financial_movements WHERE id=target_original_movement_id FOR SHARE;
  IF NOT FOUND OR v_original.provider <> 'STRIPE' OR v_original.provider_account_scope IS DISTINCT FROM target_account_scope
    OR v_original.entry_kind <> 'sponsorship_payment' OR v_original.original_financial_movement_id IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public.payment_gateway_event_applications application
      WHERE application.gateway_event_id=v_original.source_gateway_event_id
        AND application.financial_movement_id=v_original.id AND application.effect IN ('payment_succeeded','refund_required')) THEN
    RAISE EXCEPTION 'Provider cash evidence requires a materialized matching original payment' USING ERRCODE='23514';
  END IF;
  IF target_occurred_at < v_original.occurred_at OR target_occurred_at > clock_timestamp()+interval '5 minutes'
    OR target_signature_verified_at < target_occurred_at-interval '5 minutes'
    OR target_signature_verified_at > clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'Provider cash evidence time is invalid' USING ERRCODE='22023';
  END IF;
  PERFORM private.set_payment_audit_context('record_verified_stripe_cash_movement','STRIPE',
    target_account_scope,CASE WHEN target_amount_minor<0 OR (target_amount_minor=0 AND target_net_minor<0) THEN 'charge.dispute.funds_withdrawn'
      ELSE 'charge.dispute.funds_reinstated' END,target_event_id,context_request_id);
  INSERT INTO private.provider_cash_movements(provider,provider_account_scope,provider_movement_id,provider_object_id,
    original_financial_movement_id,amount_minor,fee_minor,net_minor,currency,exchange_rate,occurred_at)
  VALUES ('STRIPE',target_account_scope,target_movement_id,target_object_id,target_original_movement_id,
    target_amount_minor,target_fee_minor,target_net_minor,target_currency,target_exchange_rate,target_occurred_at)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_existing FROM private.provider_cash_movements
      WHERE provider='STRIPE' AND provider_account_scope=target_account_scope AND provider_movement_id=target_movement_id;
    IF NOT FOUND OR v_existing.original_financial_movement_id IS DISTINCT FROM target_original_movement_id
      OR v_existing.provider_object_id IS DISTINCT FROM target_object_id
      OR v_existing.amount_minor IS DISTINCT FROM target_amount_minor OR v_existing.fee_minor IS DISTINCT FROM target_fee_minor
      OR v_existing.net_minor IS DISTINCT FROM target_net_minor OR v_existing.currency IS DISTINCT FROM target_currency
      OR v_existing.exchange_rate IS DISTINCT FROM target_exchange_rate OR v_existing.occurred_at IS DISTINCT FROM target_occurred_at THEN
      RAISE EXCEPTION 'Provider cash evidence conflicts with its immutable identity' USING ERRCODE='23505';
    END IF;
    v_id := v_existing.id;
  END IF;
  INSERT INTO private.provider_cash_evidence(provider_account_scope,source_event_id,cash_movement_id,
    source_event_digest,signature_verified_at,request_id)
  VALUES (target_account_scope,target_event_id,v_id,target_event_digest,target_signature_verified_at,context_request_id)
  ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM private.provider_cash_evidence evidence
    WHERE evidence.provider_account_scope=target_account_scope AND evidence.source_event_id=target_event_id
      AND evidence.cash_movement_id=v_id AND evidence.source_event_digest=target_event_digest) THEN
    RAISE EXCEPTION 'Provider cash event identity conflicts with its immutable evidence' USING ERRCODE='23505';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_verified_stripe_cash_movement(uuid,text,text,text,bigint,bigint,bigint,text,numeric,timestamptz,text,bytea,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_verified_stripe_cash_movement(uuid,text,text,text,bigint,bigint,bigint,text,numeric,timestamptz,text,bytea,timestamptz,text) TO service_role;
COMMENT ON TABLE private.provider_cash_movements IS 'Immutable verified provider balance facts, independent of sponsorship allocation and payload retention. No sponsor contact material.';

-- Health depends on both the review receipts and the provider cash evidence.
CREATE FUNCTION public.get_payment_failure_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.require_payment_service_role();
  SELECT jsonb_build_object(
    'unresolved', count(*),
    'unacknowledged', count(*) FILTER (WHERE receipt.gateway_event_id IS NULL),
    'quarantined', count(*) FILTER (WHERE private.payment_failure_kind(event) = 'quarantined'),
    'exhausted', count(*) FILTER (WHERE private.payment_failure_kind(event) = 'exhausted'),
    'expired_final_leases', count(*) FILTER (WHERE private.payment_failure_kind(event) = 'expired_final_lease'),
    'payloads_expiring_within_seven_days', count(*) FILTER (WHERE event.payload_ciphertext IS NOT NULL
      AND event.payload_retention_expires_at <= statement_timestamp() + interval '7 days'),
    'payloads_unavailable', count(*) FILTER (WHERE event.payload_ciphertext IS NULL)
  ) INTO v_result
  FROM public.payment_gateway_events event
  LEFT JOIN audit.payment_failure_acknowledgments receipt ON receipt.gateway_event_id = event.id
    AND receipt.failure_version = private.payment_failure_version(event)
  WHERE private.payment_failure_kind(event) IS NOT NULL;
  -- A receipt can commit before gateway ingestion. Count cash once even when
  -- several signed events corroborate it; require the same immutable digest.
  SELECT v_result || jsonb_build_object(
    'cash_without_gateway_event',count(*),
    'stale_cash_without_gateway_event',count(*) FILTER (
      WHERE cash.recorded_at <= statement_timestamp()-interval '10 minutes')
  ) INTO v_result
  FROM private.provider_cash_movements cash
  WHERE NOT EXISTS (
    SELECT 1 FROM private.provider_cash_evidence evidence
    JOIN public.payment_gateway_events event
      ON event.provider=cash.provider
      AND event.provider_account_scope=evidence.provider_account_scope
      AND event.provider_event_id=evidence.source_event_id
      AND event.payload_sha256=evidence.source_event_digest
    WHERE evidence.cash_movement_id=cash.id
  );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payment_failure_health() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_failure_health() TO service_role;

COMMIT;

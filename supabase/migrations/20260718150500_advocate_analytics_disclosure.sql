BEGIN;

-- A hidden measure keeps its last disclosed contributor baseline. Releasing
-- another measure, changing membership, or repeating a read cannot reset it.
CREATE TABLE private.advocate_analytics_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE RESTRICT,
  policy_version text NOT NULL DEFAULT 'coordinated-v1' CHECK (policy_version='coordinated-v1'),
  source_cutoff timestamptz NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  contribution_digest text NOT NULL CHECK (contribution_digest ~ '^[0-9a-f]{64}$'),
  contact_key_versions jsonb NOT NULL CHECK (jsonb_typeof(contact_key_versions)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(advocate_id,policy_version,source_cutoff),
  UNIQUE(id,advocate_id,source_cutoff),
  CHECK (isfinite(source_cutoff) AND source_cutoff=(date_trunc('week',source_cutoff AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),
  CHECK (created_at>=source_cutoff+interval '7 days')
);
ALTER TABLE private.advocate_analytics_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_analytics_releases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_analytics_releases FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX advocate_analytics_releases_latest_idx
  ON private.advocate_analytics_releases(advocate_id,source_cutoff DESC);

-- Store a contribution only when its last-disclosed value changes. Unchanged
-- historical donors do not get copied into every future weekly release.
CREATE TABLE private.advocate_analytics_contribution_changes (
  release_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  source_cutoff timestamptz NOT NULL,
  measure text NOT NULL CHECK (measure ~ '^(official|observed):[a-z_]{1,64}$'),
  scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 80),
  contact_key text NOT NULL CHECK (length(contact_key) BETWEEN 1 AND 160),
  fingerprint text CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(advocate_id,measure,scope,contact_key,source_cutoff),
  FOREIGN KEY(release_id,advocate_id,source_cutoff)
    REFERENCES private.advocate_analytics_releases(id,advocate_id,source_cutoff) ON DELETE RESTRICT
);
ALTER TABLE private.advocate_analytics_contribution_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_analytics_contribution_changes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_analytics_contribution_changes FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_analytics_contribution_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Analytics contributions are append only' USING ERRCODE='42501';
  END IF;
  IF current_setting('app.advocate_analytics_release.operation',true) IS DISTINCT FROM 'coordinated-v1' THEN
    RAISE EXCEPTION 'Analytics contributions require the release worker' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_analytics_contribution_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER advocate_analytics_contributions_protect BEFORE INSERT OR UPDATE OR DELETE
  ON private.advocate_analytics_contribution_changes FOR EACH ROW EXECUTE FUNCTION private.protect_analytics_contribution_change();
CREATE TRIGGER advocate_analytics_contributions_no_truncate BEFORE TRUNCATE
  ON private.advocate_analytics_contribution_changes FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE FUNCTION private.analytics_contribution_rows(contributions jsonb)
RETURNS TABLE(measure text,scope text,contact_key text,fingerprint text)
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT measure.key,scope.key,contact.key,contact.value
  FROM jsonb_each(contributions) measure
  CROSS JOIN LATERAL jsonb_each(measure.value) scope
  CROSS JOIN LATERAL jsonb_each_text(scope.value) contact;
$$;
REVOKE ALL ON FUNCTION private.analytics_contribution_rows(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.analytics_disclosure_baseline(target_advocate_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (
    SELECT DISTINCT ON(measure,scope,contact_key) measure,scope,contact_key,fingerprint
    FROM private.advocate_analytics_contribution_changes WHERE advocate_id=target_advocate_id
    ORDER BY measure,scope,contact_key,source_cutoff DESC
  ), scopes AS (
    SELECT measure,scope,json_object_agg(contact_key,fingerprint) AS contacts
    FROM latest WHERE fingerprint IS NOT NULL GROUP BY measure,scope
  ), measures AS (
    SELECT measure,json_object_agg(scope,contacts) AS scopes FROM scopes GROUP BY measure
  ) SELECT coalesce(json_object_agg(measure,scopes)::jsonb,'{}'::jsonb) FROM measures;
$$;
REVOKE ALL ON FUNCTION private.analytics_disclosure_baseline(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Each stored transition changes whether a historical contact differs from
-- today's candidate. A prefix sum checks every historical state in one pass;
-- it does not rebuild every old contact map or compare only adjacent releases.
CREATE FUNCTION private.analytics_historical_unsafe_measures(target_advocate_id uuid,candidate jsonb)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH current_values AS MATERIALIZED (
    SELECT * FROM private.analytics_contribution_rows(candidate)
  ), history AS (
    SELECT change.*,lag(fingerprint) OVER(PARTITION BY measure,scope,contact_key ORDER BY source_cutoff) AS previous_fingerprint
    FROM private.advocate_analytics_contribution_changes change WHERE advocate_id=target_advocate_id
  ), transitions AS (
    SELECT history.measure,history.scope,source_cutoff,
      sum((history.fingerprint IS DISTINCT FROM current_values.fingerprint)::int
        -(previous_fingerprint IS DISTINCT FROM current_values.fingerprint)::int) AS delta
    FROM history LEFT JOIN current_values USING(measure,scope,contact_key)
    GROUP BY history.measure,history.scope,source_cutoff
  ), initial_counts AS (
    SELECT measure,scope,count(*) AS contacts FROM current_values GROUP BY measure,scope
  ), historical_counts AS (
    SELECT transitions.measure,transitions.scope,coalesce(initial_counts.contacts,0)
      +sum(delta) OVER(PARTITION BY transitions.measure,transitions.scope ORDER BY source_cutoff) AS contacts
    FROM transitions LEFT JOIN initial_counts USING(measure,scope)
  ), unsafe AS (
    SELECT measure FROM historical_counts WHERE contacts BETWEEN 1 AND 4
    UNION SELECT measure FROM initial_counts WHERE contacts BETWEEN 1 AND 4
  ) SELECT coalesce(array_agg(DISTINCT measure ORDER BY measure),'{}'::text[]) FROM unsafe;
$$;
REVOKE ALL ON FUNCTION private.analytics_historical_unsafe_measures(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_advocate_analytics_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Analytics releases are append only' USING ERRCODE='42501';
  END IF;
  IF current_setting('app.advocate_analytics_release.operation',true) IS DISTINCT FROM 'coordinated-v1' THEN
    RAISE EXCEPTION 'Analytics releases require the release worker' USING ERRCODE='42501';
  END IF;
  NEW.created_at:=clock_timestamp();
  IF EXISTS(SELECT 1 FROM private.advocate_analytics_releases release
    WHERE release.advocate_id=NEW.advocate_id AND release.source_cutoff>=NEW.source_cutoff) THEN
    RAISE EXCEPTION 'Analytics release cutoff must advance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_advocate_analytics_release() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER advocate_analytics_releases_protect BEFORE INSERT OR UPDATE OR DELETE
  ON private.advocate_analytics_releases FOR EACH ROW EXECUTE FUNCTION private.protect_advocate_analytics_release();
CREATE TRIGGER advocate_analytics_releases_no_truncate BEFORE TRUNCATE
  ON private.advocate_analytics_releases FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();
CREATE TRIGGER advocate_analytics_releases_audit AFTER INSERT
  ON private.advocate_analytics_releases FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id','@columns_only');

-- Inputs are private fixed-query fingerprints: measure -> scope -> contact ->
-- hash of exact contribution. Zero contributions are absent, not new support.
CREATE FUNCTION private.analytics_unsafe_measures(previous jsonb,candidate jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Expand each map once. Looking up each contact through its parent scope
  -- repeatedly copies large JSON objects before comparing their fingerprints.
  WITH previous_values AS (
    SELECT measure.key AS measure,scope.key AS scope,contact.key AS contact,contact.value AS fingerprint
    FROM jsonb_each(previous) measure
    CROSS JOIN LATERAL jsonb_each(measure.value) scope
    CROSS JOIN LATERAL jsonb_each(scope.value) contact
  ), candidate_values AS (
    SELECT measure.key AS measure,scope.key AS scope,contact.key AS contact,contact.value AS fingerprint
    FROM jsonb_each(candidate) measure
    CROSS JOIN LATERAL jsonb_each(measure.value) scope
    CROSS JOIN LATERAL jsonb_each(scope.value) contact
  ), changed AS (
    SELECT measure,scope,count(*) AS contacts
    FROM previous_values previous FULL JOIN candidate_values candidate USING(measure,scope,contact)
    WHERE previous.fingerprint IS DISTINCT FROM candidate.fingerprint
    GROUP BY measure,scope
  )
  SELECT coalesce(array_agg(DISTINCT measure ORDER BY measure),'{}'::text[])
  FROM changed WHERE contacts BETWEEN 1 AND 4;
$$;
REVOKE ALL ON FUNCTION private.analytics_unsafe_measures(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.analytics_measure_key(field text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT regexp_replace(field,'(_usd_cents|_minor)$','');
$$;
REVOKE ALL ON FUNCTION private.analytics_measure_key(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mask_analytics_cell(cell jsonb,family text,withheld text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_object_agg(field.key,CASE
    WHEN family||':'||private.analytics_measure_key(field.key)=ANY(withheld) THEN 'null'::jsonb
    ELSE field.value END)
  FROM jsonb_each(cell) field;
$$;
REVOKE ALL ON FUNCTION private.mask_analytics_cell(jsonb,text,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.coordinate_analytics_disclosure(candidate jsonb,previous_contributors jsonb,history_withheld text[] DEFAULT ARRAY[]::text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_snapshot jsonb:=candidate->'snapshot';
  v_current jsonb:=candidate->'contributors';
  v_baseline jsonb:=previous_contributors;
  v_intrinsic text[]:=private.analytics_unsafe_measures(previous_contributors,candidate->'contributors')||history_withheld;
  v_withheld text[]:=v_intrinsic;
  v_family text; v_measure text; v_visible boolean; v_operand text; v_required text[];
BEGIN
  FOREACH v_family IN ARRAY ARRAY['official','observed'] LOOP
    -- Protect arithmetic that can be reconstructed from separately visible
    -- operands, including restoration that leaves one outstanding dispute.
    FOREACH v_measure IN ARRAY ARRAY['gross_collected','net_collected','open_dispute_balance',
      'annualized_commitment','repeat_sponsorships','unverified_sponsor_contacts'] LOOP
      IF NOT (v_family||':'||v_measure=ANY(v_intrinsic)) THEN CONTINUE; END IF;
      FOREACH v_operand IN ARRAY CASE v_measure
        WHEN 'gross_collected' THEN ARRAY['initial_collected','renewal_collected']
        WHEN 'net_collected' THEN ARRAY['initial_collected','renewal_collected','refunds_and_reversals','dispute_debits','dispute_credits']
        WHEN 'open_dispute_balance' THEN ARRAY['dispute_debits','dispute_credits']
        WHEN 'annualized_commitment' THEN ARRAY['active_monthly_commitment','active_annual_commitment']
        WHEN 'repeat_sponsorships' THEN ARRAY['sponsorships','unique_sponsor_contacts']
        ELSE ARRAY['unique_sponsor_contacts','verified_sponsor_accounts'] END LOOP
        IF v_current->(v_family||':'||v_operand) IS DISTINCT FROM previous_contributors->(v_family||':'||v_operand) THEN
          v_withheld:=array_append(v_withheld,v_family||':'||v_operand);
        END IF;
      END LOOP;
    END LOOP;
    IF v_family||':verified_account_identities'=ANY(v_intrinsic) THEN
      v_withheld:=array_append(v_withheld,v_family||':verified_sponsor_accounts');
    END IF;
    IF v_family||':sponsorships'=ANY(v_withheld) OR v_family||':unique_sponsor_contacts'=ANY(v_withheld) THEN
      v_withheld:=array_append(v_withheld,v_family||':verified_sponsor_accounts');
    END IF;
    IF v_family||':initial_collected'=ANY(v_withheld) OR v_family||':renewal_collected'=ANY(v_withheld) THEN
      v_withheld:=array_append(v_withheld,v_family||':gross_collected');
    END IF;
    IF v_withheld && ARRAY[v_family||':gross_collected',v_family||':refunds_and_reversals',
        v_family||':dispute_debits',v_family||':dispute_credits'] THEN
      v_withheld:=array_append(v_withheld,v_family||':net_collected');
    END IF;
    IF v_family||':active_monthly_commitment'=ANY(v_withheld) OR v_family||':active_annual_commitment'=ANY(v_withheld) THEN
      v_withheld:=array_append(v_withheld,v_family||':annualized_commitment');
    END IF;
    v_snapshot:=jsonb_set(v_snapshot,ARRAY[v_family],private.mask_analytics_cell(v_snapshot->v_family,v_family,v_withheld));
  END LOOP;
  IF jsonb_typeof(v_snapshot->'segments')='array' THEN
    v_snapshot:=jsonb_set(v_snapshot,'{segments}',coalesce((SELECT jsonb_agg(private.mask_analytics_cell(cell,
      CASE WHEN cell->>'key'='observed_30_365_days' THEN 'observed' ELSE 'official' END,v_withheld) ORDER BY ordinal)
      FROM jsonb_array_elements(v_snapshot->'segments') WITH ORDINALITY cells(cell,ordinal)),'[]'::jsonb));
  END IF;
  IF jsonb_typeof(v_snapshot->'original_currency')='array' THEN
    v_snapshot:=jsonb_set(v_snapshot,'{original_currency}',coalesce((SELECT jsonb_agg(private.mask_analytics_cell(cell,'official',v_withheld) ORDER BY ordinal)
      FROM jsonb_array_elements(v_snapshot->'original_currency') WITH ORDINALITY cells(cell,ordinal)),'[]'::jsonb));
  END IF;
  -- Advance only a measure actually visible in this release. In particular,
  -- an intervening null must not erase a previously disclosed value's history.
  FOR v_measure IN SELECT key FROM jsonb_object_keys(v_current||previous_contributors) keys(key) LOOP
    v_family:=split_part(v_measure,':',1);
    IF v_measure=ANY(v_withheld) THEN CONTINUE; END IF;
    v_required:=CASE split_part(v_measure,':',2)
      WHEN 'open_dispute_balance' THEN ARRAY['dispute_debits','dispute_credits']
      WHEN 'repeat_sponsorships' THEN ARRAY['sponsorships','unique_sponsor_contacts']
      WHEN 'unverified_sponsor_contacts' THEN ARRAY['unique_sponsor_contacts','verified_sponsor_accounts']
      WHEN 'verified_account_identities' THEN ARRAY['verified_sponsor_accounts']
      ELSE ARRAY[split_part(v_measure,':',2)] END;
    WITH disclosed_cells AS (
      SELECT v_snapshot->v_family AS cell
      UNION ALL
      SELECT cell FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_snapshot->'segments')='array'
        THEN v_snapshot->'segments' ELSE '[]'::jsonb END) cells(cell)
      WHERE (cell->>'key'='observed_30_365_days')=(v_family='observed')
      UNION ALL
      SELECT cell FROM jsonb_array_elements(CASE WHEN v_family='official' AND jsonb_typeof(v_snapshot->'original_currency')='array'
        THEN v_snapshot->'original_currency' ELSE '[]'::jsonb END) cells(cell)
    ) SELECT EXISTS(
      SELECT 1 FROM disclosed_cells WHERE cell->'suppressed'='false'::jsonb AND NOT EXISTS(
        SELECT 1 FROM unnest(v_required) required(measure) WHERE NOT EXISTS(
          SELECT 1 FROM jsonb_each(cell) field WHERE field.value<>'null'::jsonb
            AND private.analytics_measure_key(field.key)=required.measure
        )
      )
    ) INTO v_visible;
    IF v_visible THEN
      IF v_current ? v_measure THEN
        v_baseline:=jsonb_set(v_baseline,ARRAY[v_measure],v_current->v_measure);
      ELSE
        v_baseline:=v_baseline-v_measure;
      END IF;
    END IF;
  END LOOP;
  v_snapshot:=v_snapshot||jsonb_build_object('schema_version',2,'disclosure',jsonb_build_object(
    'state','released','policy_version','coordinated-v1','cadence','weekly','minimum_changed_contacts',5));
  RETURN jsonb_build_object('snapshot',v_snapshot,'contributors',v_baseline);
END;
$$;
REVOKE ALL ON FUNCTION private.coordinate_analytics_disclosure(jsonb,jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.release_advocate_analytics(target_advocate_id uuid,target_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prior private.advocate_analytics_releases%ROWTYPE;
  v_candidate jsonb; v_release jsonb; v_versions jsonb; v_history_withheld text[];
  v_baseline jsonb; v_release_id uuid;
BEGIN
  PERFORM private.require_advocate_public_metric_service_role();
  IF target_cutoff IS NULL OR NOT isfinite(target_cutoff)
    OR target_cutoff IS DISTINCT FROM (date_trunc('week',target_cutoff AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    OR target_cutoff>clock_timestamp()-interval '7 days' THEN
    RAISE EXCEPTION 'Analytics release cutoff is invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('advocate-analytics-release:'||target_advocate_id::text,0));
  SELECT * INTO v_prior FROM private.advocate_analytics_releases
    WHERE advocate_id=target_advocate_id ORDER BY source_cutoff DESC LIMIT 1;
  IF FOUND AND v_prior.source_cutoff>=target_cutoff THEN
    SELECT snapshot INTO v_release FROM private.advocate_analytics_releases
      WHERE advocate_id=target_advocate_id AND source_cutoff=target_cutoff;
    IF FOUND THEN RETURN v_release; END IF;
    RAISE EXCEPTION 'Analytics release cutoff must advance' USING ERRCODE='23514';
  END IF;
  v_candidate:=private.build_advocate_analytics_candidate(target_advocate_id,target_cutoff);
  v_versions:=v_candidate->'contact_key_versions';
  -- Rotation cannot manufacture five apparently new contacts. Keep the prior
  -- release until an explicitly reviewed identity-continuity migration exists.
  IF jsonb_array_length(v_versions)>1 OR
    (coalesce(v_prior.contact_key_versions,'[]'::jsonb)<>'[]'::jsonb
      AND v_prior.contact_key_versions IS DISTINCT FROM v_versions) THEN
    RETURN v_prior.snapshot;
  END IF;
  v_baseline:=private.analytics_disclosure_baseline(target_advocate_id);
  v_history_withheld:=private.analytics_historical_unsafe_measures(target_advocate_id,v_candidate->'contributors');
  v_release:=private.coordinate_analytics_disclosure(v_candidate,v_baseline,v_history_withheld);
  PERFORM set_config('app.advocate_analytics_release.operation','coordinated-v1',true);
  INSERT INTO private.advocate_analytics_releases(advocate_id,source_cutoff,snapshot,contribution_digest,contact_key_versions)
    VALUES(target_advocate_id,target_cutoff,v_release->'snapshot',
      encode(extensions.digest((v_release->'contributors')::text,'sha256'),'hex'),v_versions)
    RETURNING id INTO v_release_id;
  INSERT INTO private.advocate_analytics_contribution_changes(release_id,advocate_id,source_cutoff,measure,scope,contact_key,fingerprint)
    SELECT v_release_id,target_advocate_id,target_cutoff,coalesce(current.measure,prior.measure),
      coalesce(current.scope,prior.scope),coalesce(current.contact_key,prior.contact_key),current.fingerprint
    FROM private.analytics_contribution_rows(v_release->'contributors') current
    FULL JOIN private.analytics_contribution_rows(v_baseline) prior USING(measure,scope,contact_key)
    WHERE current.fingerprint IS DISTINCT FROM prior.fingerprint;
  RETURN v_release->'snapshot';
END;
$$;
REVOKE ALL ON FUNCTION private.release_advocate_analytics(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_advocate_analytics_snapshot(target_advocate_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_snapshot jsonb;
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

  SELECT release.snapshot INTO v_snapshot
  FROM private.advocate_analytics_releases release
  WHERE release.advocate_id=target_advocate_id
  ORDER BY release.source_cutoff DESC LIMIT 1;

  RETURN coalesce(v_snapshot,jsonb_build_object(
    'schema_version',2,'as_of',NULL,
    'disclosure',jsonb_build_object('state','pending','policy_version','coordinated-v1',
      'cadence','weekly','minimum_changed_contacts',5),
    'methodology',jsonb_build_object('minimum_sponsor_contacts_per_cell',5,
      'official_window_days',30,'observed_window_days',365,
      'renewals_increase_funds_not_counts',true,'measure_suppression_enabled',true),
    'official',jsonb_build_object('suppressed',true),
    'observed',jsonb_build_object('suppressed',true),'segments',NULL,'original_currency',NULL
  ));
END;
$$;

COMMENT ON FUNCTION public.get_advocate_analytics_snapshot(uuid) IS
  'Returns the latest immutable coordinated analytics release after current account and tenant permission checks. Reads cannot recalculate financial values or advance disclosure history. Before the first release only a fixed pending response is returned';

REVOKE ALL ON FUNCTION public.get_advocate_analytics_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_advocate_analytics_snapshot(uuid)
  TO authenticated;

COMMIT;

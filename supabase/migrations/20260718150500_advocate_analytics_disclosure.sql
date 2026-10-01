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

-- Retain independent original numerical columns, not a copy of every contact
-- in every report. Their span includes all prior disclosures, including public
-- metrics. An omitted dependent column never discards a historical direction.
CREATE TABLE private.advocate_analytics_basis_columns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  source_cutoff timestamptz NOT NULL,
  subject text NOT NULL CHECK (subject IN ('contact','account')),
  contributions jsonb NOT NULL CHECK (jsonb_typeof(contributions)='object' AND contributions<>'{}'::jsonb),
  FOREIGN KEY(release_id,advocate_id,source_cutoff)
    REFERENCES private.advocate_analytics_releases(id,advocate_id,source_cutoff) ON DELETE RESTRICT
);
CREATE INDEX advocate_analytics_basis_tenant_idx ON private.advocate_analytics_basis_columns(advocate_id,subject,id);
ALTER TABLE private.advocate_analytics_basis_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_analytics_basis_columns FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_analytics_basis_columns FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.advocate_analytics_basis_columns_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_analytics_basis_column()
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
REVOKE ALL ON FUNCTION private.protect_analytics_basis_column() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER advocate_analytics_basis_protect BEFORE INSERT OR UPDATE OR DELETE
  ON private.advocate_analytics_basis_columns FOR EACH ROW EXECUTE FUNCTION private.protect_analytics_basis_column();
CREATE TRIGGER advocate_analytics_basis_no_truncate BEFORE TRUNCATE
  ON private.advocate_analytics_basis_columns FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER advocate_analytics_basis_audit AFTER INSERT
  ON private.advocate_analytics_basis_columns FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id','@columns_only');

CREATE FUNCTION private.analytics_disclosure_basis(target_advocate_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'contact',coalesce(jsonb_agg(contributions ORDER BY id) FILTER(WHERE subject='contact'),'[]'::jsonb),
    'account',coalesce(jsonb_agg(contributions ORDER BY id) FILTER(WHERE subject='account'),'[]'::jsonb))
  FROM private.advocate_analytics_basis_columns WHERE advocate_id=target_advocate_id;
$$;
REVOKE ALL ON FUNCTION private.analytics_disclosure_basis(uuid) FROM PUBLIC,anon,authenticated,service_role;

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

-- Build one integer row from sparse (column, numerator, denominator) entries.
-- The matrix decoder validates these entries before this internal helper runs.
CREATE FUNCTION private.analytics_integer_contribution_row(entries numeric[],width integer)
RETURNS numeric[] LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
DECLARE v_row numeric[]:=array_fill(0::numeric,ARRAY[width]); v_scale numeric:=1; v_common numeric:=0;
  v_index integer; v_value numeric;
BEGIN
  FOR v_index IN 1..array_length(entries,1) LOOP
    v_scale:=div(v_scale,gcd(v_scale,entries[v_index][3]))*entries[v_index][3];
  END LOOP;
  FOR v_index IN 1..array_length(entries,1) LOOP
    v_row[entries[v_index][1]::integer]:=entries[v_index][2]*div(v_scale,entries[v_index][3]);
  END LOOP;
  FOREACH v_value IN ARRAY v_row LOOP v_common:=gcd(v_common,abs(v_value)); END LOOP;
  IF v_common>1 THEN
    FOR v_index IN 1..width LOOP v_row[v_index]:=div(v_row[v_index],v_common); END LOOP;
  END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION private.analytics_integer_contribution_row(numeric[],integer) FROM PUBLIC,anon,authenticated,service_role;

-- Input columns map stable subject keys to exact integer fractions. Expand
-- each map once, then aggregate complete rows; repeated nested lookups and
-- repeated whole-matrix concatenation would copy large histories quadratically.
CREATE FUNCTION private.analytics_integer_contribution_matrix(columns jsonb)
RETURNS numeric[] LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
DECLARE v_matrix numeric[];
BEGIN
  IF jsonb_typeof(columns) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Disclosure columns must be an array' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(columns) entry(value) WHERE jsonb_typeof(value)<>'object') THEN
    RAISE EXCEPTION 'Disclosure columns require subject maps' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(columns) entry(value) CROSS JOIN LATERAL jsonb_each(entry.value) fraction
    WHERE fraction.key='' OR NOT CASE WHEN jsonb_typeof(fraction.value)='array' THEN
      jsonb_array_length(fraction.value)=2 AND jsonb_typeof(fraction.value->0)='number'
        AND jsonb_typeof(fraction.value->1)='number' ELSE false END) THEN
    RAISE EXCEPTION 'Disclosure contributions require numeric fractions' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(columns) entry(value) CROSS JOIN LATERAL jsonb_each(entry.value) fraction
    WHERE (fraction.value->>0)::numeric<>trunc((fraction.value->>0)::numeric)
      OR (fraction.value->>1)::numeric<>trunc((fraction.value->>1)::numeric) OR (fraction.value->>1)::numeric<=0) THEN
    RAISE EXCEPTION 'Disclosure fractions require integer amounts and positive denominators' USING ERRCODE='22023';
  END IF;
  WITH rows AS (
    SELECT fraction.key AS subject_key,
      array_agg(ARRAY[entry.ordinal::numeric,(fraction.value->>0)::numeric,(fraction.value->>1)::numeric]
        ORDER BY entry.ordinal) AS entries
    FROM jsonb_array_elements(columns) WITH ORDINALITY entry(value,ordinal)
    CROSS JOIN LATERAL jsonb_each(entry.value) fraction
    WHERE (fraction.value->>0)::numeric<>0 GROUP BY fraction.key
  ) SELECT coalesce(array_agg(private.analytics_integer_contribution_row(entries,jsonb_array_length(columns))
      ORDER BY subject_key COLLATE "C"),ARRAY[]::numeric[]) INTO v_matrix FROM rows;
  RETURN v_matrix;
END;
$$;
REVOKE ALL ON FUNCTION private.analytics_integer_contribution_matrix(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Fast sufficient proof for independent columns. A nonzero minor modulo the
-- prime 2^31-1 is nonzero over the integers, so five disjoint full-rank row
-- sets also span over the rationals. Failure is inconclusive: the caller keeps
-- the exact arithmetic fallback, including columns divisible by this prime.
-- The caller validates finite integer entries and canonical dimensions first.
-- All residues are below 2^31-1; their products fit signed bigint exactly.
CREATE FUNCTION private.analytics_modular_full_rank_certified(matrix numeric[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path='' AS $$
DECLARE
  prime constant bigint:=2147483647;
  width integer:=array_length(matrix,2); contacts integer:=array_length(matrix,1);
  used boolean[]:=array_fill(false,ARRAY[array_length(matrix,1)]);
  basis bigint[]; pivots integer[]; row_values bigint[];
  pass integer; contact integer; rank integer; basis_row integer; col integer; pivot integer;
  factor bigint; inverse bigint; power_value bigint; exponent bigint;
BEGIN
  IF contacts<5*width THEN RETURN false; END IF;
  FOR pass IN 1..5 LOOP
    basis:=ARRAY[]::bigint[]; pivots:=ARRAY[]::integer[]; rank:=0;
    FOR contact IN 1..contacts LOOP
      IF used[contact] THEN CONTINUE; END IF;
      row_values:=ARRAY[]::bigint[];
      FOR col IN 1..width LOOP
        row_values[col]:=(mod(matrix[contact][col],prime)::bigint+prime)%prime;
      END LOOP;
      FOR basis_row IN 1..rank LOOP
        factor:=row_values[pivots[basis_row]];
        IF factor=0 THEN CONTINUE; END IF;
        FOR col IN 1..width LOOP
          row_values[col]:=((row_values[col]-factor*basis[basis_row][col])%prime+prime)%prime;
        END LOOP;
      END LOOP;
      pivot:=0;
      FOR col IN 1..width LOOP
        IF row_values[col]<>0 THEN pivot:=col; EXIT; END IF;
      END LOOP;
      IF pivot=0 THEN CONTINUE; END IF;
      inverse:=1; power_value:=row_values[pivot]; exponent:=prime-2;
      WHILE exponent>0 LOOP
        IF exponent%2=1 THEN inverse:=(inverse*power_value)%prime; END IF;
        power_value:=(power_value*power_value)%prime; exponent:=exponent/2;
      END LOOP;
      FOR col IN 1..width LOOP row_values[col]:=(row_values[col]*inverse)%prime; END LOOP;
      rank:=rank+1; basis:=basis||ARRAY[row_values]; pivots:=pivots||pivot; used[contact]:=true;
      IF rank=width THEN EXIT; END IF;
    END LOOP;
    IF rank<>width THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.analytics_modular_full_rank_certified(numeric[]) FROM PUBLIC,anon,authenticated,service_role;

-- A sufficient arithmetic certificate, not a complete privacy policy. The
-- caller must supply one row per distinct contact and every disclosed column,
-- including relevant historical columns. Scale each row's exact fractions to
-- integers without rounding. Five disjoint spanning sets ensure any nonzero
-- linear combination of columns has at least five nonzero contact terms.
-- Greedy failure is conservative: it does not prove a disclosure is unsafe.
CREATE FUNCTION private.analytics_linear_disclosure_evidence(matrix numeric[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
DECLARE
  v_columns integer[]:=ARRAY[]::integer[];
  v_contacts integer:=coalesce(array_length(matrix,1),0);
  v_width integer:=coalesce(array_length(matrix,2),0);
  v_used boolean[]; v_basis numeric[]; v_pivots integer[]; v_row numeric[];
  v_set integer; v_contact integer; v_basis_row integer; v_column integer;
  v_pivot integer; v_rank integer; v_full_rank integer; v_common numeric; v_factor numeric;
BEGIN
  IF cardinality(matrix)=0 THEN RETURN jsonb_build_object('certified',true,'columns',v_columns); END IF;
  IF array_ndims(matrix)<>2 OR array_lower(matrix,1)<>1 OR array_lower(matrix,2)<>1
    OR EXISTS(SELECT 1 FROM unnest(matrix) entry(value) WHERE value IS NULL
      OR value<>trunc(value) OR value IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) THEN
    RAISE EXCEPTION 'Disclosure matrix requires finite integers and canonical dimensions' USING ERRCODE='22023';
  END IF;
  IF v_width>=16 AND private.analytics_modular_full_rank_certified(matrix) THEN
    SELECT array_agg(i ORDER BY i) INTO v_columns FROM generate_series(1,v_width) i;
    RETURN jsonb_build_object('certified',true,'columns',v_columns);
  END IF;
  v_used:=array_fill(false,ARRAY[v_contacts]);
  FOR v_set IN 1..5 LOOP
    v_basis:=ARRAY[]::numeric[]; v_pivots:=ARRAY[]::integer[]; v_rank:=0;
    FOR v_contact IN 1..v_contacts LOOP
      IF v_used[v_contact] THEN CONTINUE; END IF;
      v_row:=ARRAY[]::numeric[];
      FOR v_column IN 1..v_width LOOP v_row[v_column]:=matrix[v_contact][v_column]; END LOOP;
      -- Integer elimination preserves exact dependence. Reduce by the row GCD
      -- after each pivot to limit growth without approximate numeric division.
      FOR v_basis_row IN 1..v_rank LOOP
        v_pivot:=v_pivots[v_basis_row]; v_factor:=v_row[v_pivot];
        IF v_factor=0 THEN CONTINUE; END IF;
        FOR v_column IN 1..v_width LOOP
          v_row[v_column]:=v_row[v_column]*v_basis[v_basis_row][v_pivot]
            -v_factor*v_basis[v_basis_row][v_column];
        END LOOP;
        v_common:=0;
        FOREACH v_factor IN ARRAY v_row LOOP v_common:=gcd(v_common,abs(v_factor)); END LOOP;
        IF v_common>1 THEN
          FOR v_column IN 1..v_width LOOP v_row[v_column]:=div(v_row[v_column],v_common); END LOOP;
        END IF;
      END LOOP;
      v_pivot:=0;
      FOR v_column IN 1..v_width LOOP
        IF v_row[v_column]<>0 THEN v_pivot:=v_column; EXIT; END IF;
      END LOOP;
      IF v_pivot=0 THEN CONTINUE; END IF;
      v_rank:=v_rank+1; v_basis:=v_basis||ARRAY[v_row]; v_pivots:=v_pivots||v_pivot;
      v_used[v_contact]:=true;
      IF v_rank=v_width OR (v_set>1 AND v_rank=v_full_rank) THEN EXIT; END IF;
    END LOOP;
    IF v_set=1 THEN
      v_full_rank:=v_rank;
      SELECT coalesce(array_agg(value ORDER BY value),ARRAY[]::integer[]) INTO v_columns FROM unnest(v_pivots) entry(value);
      IF v_full_rank=0 THEN RETURN jsonb_build_object('certified',true,'columns',v_columns); END IF;
      IF v_full_rank>v_contacts/5 THEN RETURN jsonb_build_object('certified',false,'columns',v_columns); END IF;
    ELSIF v_rank<>v_full_rank THEN RETURN jsonb_build_object('certified',false,'columns',v_columns);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('certified',true,'columns',v_columns);
END;
$$;
REVOKE ALL ON FUNCTION private.analytics_linear_disclosure_evidence(numeric[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.analytics_linear_disclosure_certified(matrix numeric[])
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
  SELECT (private.analytics_linear_disclosure_evidence(matrix)->>'certified')::boolean;
$$;
REVOKE ALL ON FUNCTION private.analytics_linear_disclosure_certified(numeric[]) FROM PUBLIC,anon,authenticated,service_role;

-- Return original columns only. Row normalization and elimination are internal
-- dependence calculations and must never become stored contribution vectors.
CREATE FUNCTION private.certify_analytics_columns(columns jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE evidence jsonb;
BEGIN
  evidence:=private.analytics_linear_disclosure_evidence(private.analytics_integer_contribution_matrix(columns));
  IF evidence->'certified' IS DISTINCT FROM 'true'::jsonb THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT jsonb_agg(value ORDER BY ordinal)
    FROM jsonb_array_elements(columns) WITH ORDINALITY entry(value,ordinal)
    WHERE ordinal IN (SELECT value::integer FROM jsonb_array_elements_text(evidence->'columns') indices(value))),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION private.certify_analytics_columns(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.append_analytics_basis(target_release_id uuid,basis jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt private.advocate_analytics_releases%ROWTYPE; prior jsonb; kind text; old_count integer;
BEGIN
  PERFORM private.require_advocate_public_metric_service_role();
  SELECT * INTO STRICT receipt FROM private.advocate_analytics_releases WHERE id=target_release_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('advocate-analytics-release:'||receipt.advocate_id::text,0));
  IF EXISTS(SELECT 1 FROM private.advocate_analytics_releases
    WHERE advocate_id=receipt.advocate_id AND source_cutoff>receipt.source_cutoff) THEN
    RAISE EXCEPTION 'Analytics history requires the current release' USING ERRCODE='23514';
  END IF;
  prior:=private.analytics_disclosure_basis(receipt.advocate_id);
  FOREACH kind IN ARRAY ARRAY['contact','account'] LOOP
    old_count:=jsonb_array_length(prior->kind);
    IF jsonb_typeof(basis->kind) IS DISTINCT FROM 'array' OR jsonb_array_length(basis->kind)<old_count
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(prior->kind) WITH ORDINALITY entry(value,ordinal)
        WHERE value IS DISTINCT FROM basis->kind->(ordinal::integer-1)) THEN
      RAISE EXCEPTION 'Analytics history cannot discard prior columns' USING ERRCODE='23514';
    END IF;
    -- Immutable prior columns were certified when appended. An exact replay
    -- adds no disclosure direction and needs no new elimination pass.
    IF basis->kind=prior->kind THEN CONTINUE; END IF;
    IF private.certify_analytics_columns(basis->kind) IS DISTINCT FROM basis->kind THEN
      RAISE EXCEPTION 'Analytics history requires an independent certified basis' USING ERRCODE='23514';
    END IF;
    PERFORM set_config('app.advocate_analytics_release.operation','coordinated-v1',true);
    INSERT INTO private.advocate_analytics_basis_columns(release_id,advocate_id,source_cutoff,subject,contributions)
      SELECT receipt.id,receipt.advocate_id,receipt.source_cutoff,kind,value
      FROM jsonb_array_elements(basis->kind) WITH ORDINALITY entry(value,ordinal)
      WHERE ordinal>old_count ORDER BY ordinal;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.append_analytics_basis(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- A rounded public value is checked using its stronger, unrounded numerical
-- column. It joins the same history before the public receipt is inserted.
CREATE FUNCTION private.certify_advocate_public_metric(target_advocate_id uuid,target_cutoff timestamptz,contributions jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt_id uuid; basis jsonb; certified jsonb;
BEGIN
  PERFORM private.require_advocate_public_metric_service_role();
  PERFORM pg_advisory_xact_lock(hashtextextended('advocate-analytics-release:'||target_advocate_id::text,0));
  SELECT id INTO STRICT receipt_id FROM private.advocate_analytics_releases
    WHERE advocate_id=target_advocate_id AND source_cutoff=target_cutoff;
  basis:=private.analytics_disclosure_basis(target_advocate_id);
  certified:=private.certify_analytics_columns(basis->'contact'||jsonb_build_array(contributions));
  IF certified IS NULL THEN RETURN false; END IF;
  PERFORM private.append_analytics_basis(receipt_id,jsonb_set(basis,'{contact}',certified));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.certify_advocate_public_metric(uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.analytics_disclosed_fields(snapshot jsonb)
RETURNS TABLE(family text,scope text,field text,amount numeric)
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH cells AS (
    SELECT 'official'::text AS family,'total'::text AS scope,snapshot->'official' AS cell
    UNION ALL SELECT 'observed','total',snapshot->'observed'
    UNION ALL SELECT CASE WHEN cell->>'key'='observed_30_365_days' THEN 'observed' ELSE 'official' END,
      'segment:'||(cell->>'key'),cell
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(snapshot->'segments')='array' THEN snapshot->'segments' ELSE '[]'::jsonb END) entry(cell)
    UNION ALL SELECT 'official','currency:'||(cell->>'currency'),cell
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(snapshot->'original_currency')='array' THEN snapshot->'original_currency' ELSE '[]'::jsonb END) entry(cell)
  ) SELECT family,scope,entry.key,(entry.value#>>'{}')::numeric
    FROM cells CROSS JOIN LATERAL jsonb_each(cell) entry
    WHERE cell->'suppressed'='false'::jsonb AND jsonb_typeof(entry.value)='number';
$$;
REVOKE ALL ON FUNCTION private.analytics_disclosed_fields(jsonb) FROM PUBLIC,anon,authenticated,service_role;

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

CREATE FUNCTION private.coordinate_analytics_disclosure(candidate jsonb,previous_basis jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_snapshot jsonb:=candidate->'snapshot';
  v_basis jsonb:=jsonb_build_object('contact',coalesce(previous_basis->'contact','[]'::jsonb),
    'account',coalesce(previous_basis->'account','[]'::jsonb));
  v_trial jsonb; v_columns jsonb; v_certified jsonb; v_column jsonb;
  v_withheld text[]:=ARRAY[]::text[]; v_family text; v_measure text; v_subject text;
  v_field record; v_safe boolean; v_sum numeric;
  v_measures constant text[]:=ARRAY['gross_collected','net_collected','refunds_and_reversals',
    'initial_collected','renewal_collected','sponsorships','unique_sponsor_contacts','verified_sponsor_accounts',
    'dispute_debits','dispute_credits','active_monthly_commitment','active_annual_commitment','annualized_commitment'];
BEGIN
  IF jsonb_typeof(candidate->'linear_contributors') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Analytics numerical contributions are required' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM private.analytics_disclosed_fields(v_snapshot)
    WHERE NOT (private.analytics_measure_key(field)=ANY(v_measures))) THEN
    RAISE EXCEPTION 'Analytics disclosure contains an unclassified measure' USING ERRCODE='23514';
  END IF;
  -- Fixed product priority, independent of current values or a browser query.
  -- Every scope and currency of a measure advances together. Counts participate
  -- in the same contact matrix as money, with a separate stable-account matrix.
  FOREACH v_family IN ARRAY ARRAY['official','observed'] LOOP
    FOREACH v_measure IN ARRAY v_measures LOOP
      v_trial:=v_basis; v_safe:=true;
      FOREACH v_subject IN ARRAY ARRAY['contact','account'] LOOP
        IF v_subject='account' AND v_measure<>'verified_sponsor_accounts' THEN CONTINUE; END IF;
        v_columns:='[]'::jsonb;
        FOR v_field IN SELECT * FROM private.analytics_disclosed_fields(v_snapshot)
          WHERE family=v_family AND private.analytics_measure_key(field)=v_measure ORDER BY scope,field LOOP
          v_column:=coalesce(candidate#>ARRAY['linear_contributors',v_subject,v_family||':'||v_field.field,v_field.scope],'{}'::jsonb);
          SELECT private.sum_usd_fractions(ARRAY[(value->>0)::numeric,(value->>1)::numeric])
            INTO v_sum FROM jsonb_each(v_column);
          IF v_sum IS DISTINCT FROM v_field.amount THEN
            RAISE EXCEPTION 'Analytics contributions do not reconcile' USING ERRCODE='23514';
          END IF;
          v_columns:=v_columns||jsonb_build_array(v_column);
        END LOOP;
        IF v_columns='[]'::jsonb THEN CONTINUE; END IF;
        v_certified:=private.certify_analytics_columns(v_trial->v_subject||v_columns);
        IF v_certified IS NULL THEN v_safe:=false; EXIT; END IF;
        v_trial:=jsonb_set(v_trial,ARRAY[v_subject],v_certified);
      END LOOP;
      IF v_safe THEN v_basis:=v_trial;
      ELSE v_withheld:=array_append(v_withheld,v_family||':'||v_measure); END IF;
    END LOOP;
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
  v_snapshot:=v_snapshot||jsonb_build_object('schema_version',2,'disclosure',jsonb_build_object(
    'state','released','policy_version','coordinated-v1','cadence','weekly','minimum_changed_contacts',5));
  RETURN jsonb_build_object('snapshot',v_snapshot,'basis',v_basis);
END;
$$;
REVOKE ALL ON FUNCTION private.coordinate_analytics_disclosure(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.release_advocate_analytics(target_advocate_id uuid,target_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prior private.advocate_analytics_releases%ROWTYPE;
  v_candidate jsonb; v_release jsonb; v_versions jsonb;
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
  v_baseline:=private.analytics_disclosure_basis(target_advocate_id);
  v_release:=private.coordinate_analytics_disclosure(v_candidate,v_baseline);
  PERFORM set_config('app.advocate_analytics_release.operation','coordinated-v1',true);
  INSERT INTO private.advocate_analytics_releases(advocate_id,source_cutoff,snapshot,contribution_digest,contact_key_versions)
    VALUES(target_advocate_id,target_cutoff,v_release->'snapshot',
      encode(extensions.digest((v_release->'basis')::text,'sha256'),'hex'),v_versions)
    RETURNING id INTO v_release_id;
  PERFORM private.append_analytics_basis(v_release_id,v_release->'basis');
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

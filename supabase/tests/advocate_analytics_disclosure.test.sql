BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

-- Policy examples use exact USD contributions. Separate integration assertions
-- exercise the production query's contributor fingerprints and authority.
CREATE FUNCTION pg_temp.disclosure_candidate(amounts integer[], refunds integer[] DEFAULT NULL, renewals integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE cells jsonb; contributors jsonb; total_initial bigint; total_refunds bigint; total_renewals bigint;
BEGIN
  SELECT sum(amount),sum(coalesce(refunds[position],0)),sum(coalesce(renewals[position],0))
    INTO total_initial,total_refunds,total_renewals FROM unnest(amounts) WITH ORDINALITY entry(amount,position);
  cells:=jsonb_build_object('suppressed',false,'sponsorships',cardinality(amounts),
    'unique_sponsor_contacts',cardinality(amounts),'verified_sponsor_accounts',0,
    'initial_collected_usd_cents',total_initial,'renewal_collected_usd_cents',total_renewals,
    'gross_collected_usd_cents',total_initial+total_renewals,'refunds_and_reversals_usd_cents',total_refunds,
    'dispute_debits_usd_cents',0,'dispute_credits_usd_cents',0,
    'net_collected_usd_cents',total_initial+total_renewals-total_refunds,
    'active_monthly_commitment_usd_cents',0,'active_annual_commitment_usd_cents',0,'annualized_commitment_usd_cents',0);
  WITH contacts AS (
    SELECT 'contact-'||position AS contact,metric.key AS measure,
      encode(extensions.digest(metric.value::text,'sha256'),'hex') AS fingerprint
    FROM unnest(amounts) WITH ORDINALITY entry(amount,position)
    CROSS JOIN LATERAL jsonb_each(jsonb_build_object(
      'sponsorships',1,'unique_sponsor_contacts',1,'initial_collected',amount,
      'renewal_collected',coalesce(renewals[position],0),'gross_collected',amount+coalesce(renewals[position],0),
      'refunds_and_reversals',coalesce(refunds[position],0),
      'net_collected',amount+coalesce(renewals[position],0)-coalesce(refunds[position],0))) metric
    WHERE metric.value<>'0'::jsonb
  ), measures AS (
    SELECT measure,jsonb_build_object('direct:USD',jsonb_object_agg(contact,fingerprint)) AS value
    FROM contacts GROUP BY measure
  ) SELECT jsonb_object_agg('official:'||measure,value) INTO contributors FROM measures;
  RETURN jsonb_build_object('snapshot',jsonb_build_object('schema_version',1,'as_of','2026-07-06T00:00:00Z',
    'official',cells,'observed',jsonb_build_object('suppressed',true),
    'segments',jsonb_build_array(cells||'{"key":"direct"}'::jsonb),
    'original_currency',jsonb_build_array(jsonb_build_object('currency','USD','suppressed',false,
      'sponsorships',cardinality(amounts),'unique_sponsor_contacts',cardinality(amounts),
      'initial_collected_minor',total_initial,'renewal_collected_minor',total_renewals,
      'gross_collected_minor',total_initial+total_renewals,'refunds_and_reversals_minor',total_refunds,
      'dispute_debits_minor',0,'dispute_credits_minor',0,'net_collected_minor',total_initial+total_renewals-total_refunds))),
    'contributors',contributors,'contact_key_versions','["1:1"]'::jsonb);
END;
$$;
CREATE TEMP TABLE disclosure_cases(name text PRIMARY KEY,result jsonb NOT NULL);
INSERT INTO disclosure_cases VALUES('initial',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100]),'{}'));
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"sponsorships":5,"unique_sponsor_contacts":5,"initial_collected_usd_cents":500,"net_collected_usd_cents":500}'::jsonb
  FROM disclosure_cases WHERE name='initial'),'five contributing contacts can establish the first exact disclosure');
INSERT INTO disclosure_cases SELECT 'single_new',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100,733]),result->'contributors')
  FROM disclosure_cases WHERE name='initial';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"sponsorships":null,"unique_sponsor_contacts":null,"initial_collected_usd_cents":null,"gross_collected_usd_cents":null,"net_collected_usd_cents":null}'::jsonb
  FROM disclosure_cases WHERE name='single_new'),'a sixth contact cannot disclose the isolated 733-cent contribution or count delta');
SELECT extensions.ok((SELECT result->'snapshot'->'segments'->0->'initial_collected_usd_cents'='null'::jsonb
  AND result->'snapshot'->'original_currency'->0->'initial_collected_minor'='null'::jsonb
  FROM disclosure_cases WHERE name='single_new'),'segment and currency surfaces cannot supply the withheld new-contact amount');
SELECT extensions.ok((SELECT result->'contributors' FROM disclosure_cases WHERE name='single_new')=
  (SELECT result->'contributors' FROM disclosure_cases WHERE name='initial'),
  'withholding does not advance or erase the last actual disclosure baseline');
INSERT INTO disclosure_cases SELECT 'five_new',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100,733,111,222,333,444]),result->'contributors')
  FROM disclosure_cases WHERE name='single_new';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"sponsorships":10,"unique_sponsor_contacts":10,"initial_collected_usd_cents":2343,"net_collected_usd_cents":2343}'::jsonb
  FROM disclosure_cases WHERE name='five_new'),'five changed contacts can advance after an intervening withheld snapshot');
INSERT INTO disclosure_cases VALUES('refund_base',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100],ARRAY[10,10,10,10,10]),'{}'));
INSERT INTO disclosure_cases SELECT 'single_refund',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100],ARRAY[17,10,10,10,10]),result->'contributors')
  FROM disclosure_cases WHERE name='refund_base';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"refunds_and_reversals_usd_cents":null,"net_collected_usd_cents":null,"gross_collected_usd_cents":500}'::jsonb
  FROM disclosure_cases WHERE name='single_refund'),'one existing contact refund withholds its amount and net complement without hiding unchanged gross');
INSERT INTO disclosure_cases SELECT 'repeat_refund',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100],ARRAY[80,10,10,10,10]),result->'contributors')
  FROM disclosure_cases WHERE name='single_refund';
SELECT extensions.ok((SELECT result->'snapshot'->'official'->'refunds_and_reversals_usd_cents'='null'::jsonb
  FROM disclosure_cases WHERE name='repeat_refund'),'repeated refunds by one contact do not satisfy the advancement floor');
INSERT INTO disclosure_cases SELECT 'five_refunds',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100],ARRAY[17,17,17,17,17]),result->'contributors')
  FROM disclosure_cases WHERE name='repeat_refund';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"refunds_and_reversals_usd_cents":85,"net_collected_usd_cents":415}'::jsonb
  FROM disclosure_cases WHERE name='five_refunds'),'five existing contacts can advance refunds and net from their last disclosed baseline');
INSERT INTO disclosure_cases SELECT 'single_renewal',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100],NULL,ARRAY[7,0,0,0,0]),result->'contributors')
  FROM disclosure_cases WHERE name='initial';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"initial_collected_usd_cents":500,"renewal_collected_usd_cents":null,"gross_collected_usd_cents":null,"net_collected_usd_cents":null}'::jsonb
  FROM disclosure_cases WHERE name='single_renewal'),'one renewal cannot leak through gross or net while unchanged initial funds remain available');
SELECT extensions.ok(private.analytics_unsafe_measures('{}','{"official:refunds_and_reversals":{"direct:USD":{"one-contact":"many-payments"}}}')=
  ARRAY['official:refunds_and_reversals'],'advancement counts contact keys rather than event or amount volume');
SELECT extensions.ok(private.analytics_unsafe_measures('{}','{"official:gross_collected":{"direct:USD":{"a":"1","b":"1","c":"1","d":"1","e":"1"},"post_visit_0_1_day:GBP":{"f":"1"}}}')=
  ARRAY['official:gross_collected'],'a safe large scope cannot conceal a one-contact changed complement');
SELECT extensions.ok(private.analytics_unsafe_measures('{"official:net_collected":{"direct:USD":{"a":"1"}}}','{}')=
  ARRAY['official:net_collected'],'removing a contributor is a change and cannot reset history silently');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role(name)
  WHERE has_table_privilege(role.name,'private.advocate_analytics_releases','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_function_privilege(role.name,'private.release_advocate_analytics(uuid,timestamptz)','EXECUTE')),
  'API roles cannot read disclosure identities or invoke an arbitrary release cutoff');
SELECT extensions.ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
  WHERE oid='private.advocate_analytics_releases'::regclass),'the disclosure ledger forces row security');
-- Historical comparison uses stored transitions, not a copy of every donor
-- in every release. This fixture models five losses followed by four complete
-- restorations and one partial restoration.
SET LOCAL session_replication_role = replica;
INSERT INTO public.advocates(id,slug,display_name) VALUES
  ('97000000-0000-4000-8000-000000000001','disclosure-history-fixture','Disclosure history fixture');
SET LOCAL session_replication_role = origin;
SELECT set_config('app.advocate_analytics_release.operation','coordinated-v1',true);
INSERT INTO private.advocate_analytics_releases(id,advocate_id,source_cutoff,snapshot,contribution_digest,contact_key_versions)
SELECT ('97000000-0000-4000-8000-00000000000'||stage)::uuid,'97000000-0000-4000-8000-000000000001',
  (date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-(5-stage)*interval '7 days',
  '{}',repeat('0',64),'["1:1"]' FROM generate_series(1,2) stage ORDER BY stage;
INSERT INTO private.advocate_analytics_contribution_changes(release_id,advocate_id,source_cutoff,measure,scope,contact_key,fingerprint)
SELECT release.id,release.advocate_id,release.source_cutoff,'official:net_collected','direct:USD','contact-'||contact,
  encode(extensions.digest(CASE WHEN release.id='97000000-0000-4000-8000-000000000001' THEN '100' ELSE '90' END,'sha256'),'hex')
FROM private.advocate_analytics_releases release CROSS JOIN generate_series(1,5) contact
WHERE release.advocate_id='97000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE restoration_candidate AS SELECT pg_temp.disclosure_candidate(
  ARRAY[100,100,100,100,100],ARRAY[0,0,0,0,7]) AS value;
SELECT extensions.ok((SELECT NOT ('official:net_collected'=ANY(private.analytics_unsafe_measures(
  private.analytics_disclosure_baseline('97000000-0000-4000-8000-000000000001'),value->'contributors')))
  FROM restoration_candidate),'the restoration example changes five contacts relative to the latest release');
SELECT extensions.ok((SELECT 'official:net_collected'=ANY(private.analytics_historical_unsafe_measures(
  '97000000-0000-4000-8000-000000000001',value->'contributors')) FROM restoration_candidate),
  'the same restoration is unsafe against the older disclosure because it isolates one remaining seven-cent loss');
SELECT extensions.ok((SELECT private.coordinate_analytics_disclosure(value,
  private.analytics_disclosure_baseline('97000000-0000-4000-8000-000000000001'),
  private.analytics_historical_unsafe_measures('97000000-0000-4000-8000-000000000001',value->'contributors'))
  ->'snapshot'->'official'->'net_collected_usd_cents'='null'::jsonb FROM restoration_candidate),
  'nonconsecutive disclosure evidence withholds the reconstructible net result');
SELECT extensions.throws_ok($$UPDATE private.advocate_analytics_contribution_changes SET fingerprint=NULL$$,
  '42501','Analytics contributions are append only','historical contribution states cannot be overwritten');
SELECT extensions.throws_ok($$DELETE FROM private.advocate_analytics_contribution_changes$$,
  '42501','Analytics contributions are append only','historical contribution states cannot be deleted');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role(name)
  WHERE has_table_privilege(role.name,'private.advocate_analytics_contribution_changes','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  'API roles cannot access private contributor transitions');


-- Compare the compact transition algorithm with full historical snapshots.
-- The reference intentionally rebuilds each state and compares contact values
-- directly. It exercises removals, reappearances, unchanged weeks, multiple
-- scopes, and candidates that match an older state instead of the latest one.
CREATE FUNCTION pg_temp.verify_disclosure_history() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  tenant constant uuid:='97000000-0000-4000-8000-000000000099';
  v_stage integer; candidate_index integer; v_release_id uuid; cutoff timestamptz;
  current_state jsonb; previous_state jsonb:='{}'; candidate jsonb;
  expected text[]; actual text[];
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.advocates(id,slug,display_name)
    VALUES(tenant,'disclosure-history-reference','Disclosure history reference');
  SET LOCAL session_replication_role = origin;
  CREATE TEMP TABLE disclosure_reference_states(stage integer PRIMARY KEY,contributions jsonb NOT NULL);
  INSERT INTO disclosure_reference_states VALUES(0,'{}');
  FOR v_stage IN 1..16 LOOP
    -- Consecutive pairs have identical states, so half the releases have no
    -- contribution rows. Zero omits a contact and later states can restore it.
    WITH values AS (
      SELECT measure,scope,'contact-'||contact AS contact,
        mod(contact*7+((v_stage+1)/2)*3+scope_index*5+measure_index,11) AS amount
      FROM (VALUES ('official:net_collected',1),('official:refunds_and_reversals',2),
        ('observed:sponsorships',3)) measures(measure,measure_index)
      CROSS JOIN (VALUES ('total',1),('direct:USD',2),('currency:GBP',3)) scopes(scope,scope_index)
      CROSS JOIN generate_series(1,8) contact
    ), scopes AS (
      SELECT measure,scope,jsonb_object_agg(contact,encode(extensions.digest(amount::text,'sha256'),'hex')) AS contacts
      FROM values WHERE amount>2 GROUP BY measure,scope
    ), measures AS (
      SELECT measure,jsonb_object_agg(scope,contacts) AS scopes FROM scopes GROUP BY measure
    ) SELECT coalesce(jsonb_object_agg(measure,scopes),'{}') INTO current_state FROM measures;
    cutoff:=(date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-(18-v_stage)*interval '7 days';
    INSERT INTO private.advocate_analytics_releases(advocate_id,source_cutoff,snapshot,contribution_digest,contact_key_versions)
      VALUES(tenant,cutoff,'{}',encode(extensions.digest(current_state::text,'sha256'),'hex'),'["1:1"]')
      RETURNING id INTO v_release_id;
    INSERT INTO private.advocate_analytics_contribution_changes(release_id,advocate_id,source_cutoff,measure,scope,contact_key,fingerprint)
      SELECT v_release_id,tenant,cutoff,coalesce(current.measure,prior.measure),coalesce(current.scope,prior.scope),
        coalesce(current.contact_key,prior.contact_key),current.fingerprint
      FROM private.analytics_contribution_rows(current_state) current
      FULL JOIN private.analytics_contribution_rows(previous_state) prior USING(measure,scope,contact_key)
      WHERE current.fingerprint IS DISTINCT FROM prior.fingerprint;
    IF private.analytics_disclosure_baseline(tenant) IS DISTINCT FROM current_state THEN
      RAISE EXCEPTION 'Historical baseline differs at stage %',v_stage;
    END IF;
    IF v_stage%2=0 AND EXISTS(SELECT 1 FROM private.advocate_analytics_contribution_changes change WHERE change.release_id=v_release_id) THEN
      RAISE EXCEPTION 'Unchanged history was copied at stage %',v_stage;
    END IF;
    INSERT INTO disclosure_reference_states VALUES(v_stage,current_state);
    previous_state:=current_state;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM private.advocate_analytics_contribution_changes WHERE advocate_id=tenant AND fingerprint IS NULL) THEN
    RAISE EXCEPTION 'History fixture did not exercise removals';
  END IF;
  FOR candidate_index IN 0..24 LOOP
    SELECT contributions INTO candidate FROM disclosure_reference_states WHERE stage=candidate_index%17;
    IF candidate_index>16 THEN
      -- One changed contact relative to an old state must remain unsafe even
      -- if several contacts differ from the latest state.
      candidate:=jsonb_set(candidate,'{official:net_collected,total,contact-1}',to_jsonb(repeat('f',64)),true);
    END IF;
    WITH states AS (
      SELECT stage,measure.key AS measure,scope.key AS scope,contact.key AS contact,contact.value AS fingerprint
      FROM disclosure_reference_states
      CROSS JOIN LATERAL jsonb_each(contributions) measure
      CROSS JOIN LATERAL jsonb_each(measure.value) scope
      CROSS JOIN LATERAL jsonb_each_text(scope.value) contact
    ), candidates AS (
      SELECT stage,measure.key AS measure,scope.key AS scope,contact.key AS contact,contact.value AS fingerprint
      FROM disclosure_reference_states
      CROSS JOIN LATERAL jsonb_each(candidate) measure
      CROSS JOIN LATERAL jsonb_each(measure.value) scope
      CROSS JOIN LATERAL jsonb_each_text(scope.value) contact
    ), changed AS (
      SELECT coalesce(states.stage,candidates.stage) AS stage,coalesce(states.measure,candidates.measure) AS measure,
        coalesce(states.scope,candidates.scope) AS scope,count(*) AS contacts
      FROM states FULL JOIN candidates USING(stage,measure,scope,contact)
      WHERE states.fingerprint IS DISTINCT FROM candidates.fingerprint
      GROUP BY 1,2,3
    ) SELECT coalesce(array_agg(DISTINCT measure ORDER BY measure),'{}'::text[]) INTO expected
      FROM changed WHERE contacts BETWEEN 1 AND 4;
    actual:=private.analytics_historical_unsafe_measures(tenant,candidate);
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Historical policy differs for candidate %: actual %, expected %',candidate_index,actual,expected;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
SELECT extensions.ok(pg_temp.verify_disclosure_history(),
  'sparse history matches complete-state comparison across 16 releases and 25 candidates, including removals and restorations');

SELECT * FROM extensions.finish();
ROLLBACK;

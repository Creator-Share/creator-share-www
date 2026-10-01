BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.is(private.analytics_integer_contribution_matrix(
  '[{"b":[1,7],"a":[1,3]},{"a":[1,7],"b":[1,3]}]'::jsonb),
  ARRAY[[7,3],[3,7]]::numeric[], 'fractional columns become exact canonical subject rows without rounding');
SELECT extensions.is(private.analytics_integer_contribution_matrix(
  '[{"b":[0,1],"a":[2,3]},{"c":[-2,7],"a":[4,6]},{}]'::jsonb),
  ARRAY[[1,1,0],[0,-1,0]]::numeric[], 'zero terms do not add support and missing columns remain exact zero');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(private.analytics_integer_contribution_matrix(
  '[{"a":[1,3],"b":[1,3],"c":[1,3],"d":[1,3],"e":[1,3]},
    {"a":[1,7],"b":[1,7],"c":[1,7],"d":[1,7],"e":[1,7]}]'::jsonb)),
  'the decoder and certificate preserve an exactly proportional five-contact fractional cohort');
SELECT extensions.ok(NOT private.analytics_linear_disclosure_certified(private.analytics_integer_contribution_matrix(
  '[{"a":[90071992547409920,1],"b":[90071992547409920,1],"c":[90071992547409920,1],"d":[90071992547409920,1],"e":[90071992547409920,1],"f":[90071992547409920,1]},
    {"a":[90071992547409921,1],"b":[90071992547409921,1],"c":[90071992547409921,1],"d":[90071992547409921,1],"e":[90071992547409921,1],"f":[90071992547409922,1]}]'::jsonb)),
  'adjacent integers beyond floating-point precision cannot erase a lone arithmetic direction');
SELECT extensions.throws_ok($$SELECT private.analytics_integer_contribution_matrix('{}')$$,
  '22023','Disclosure columns must be an array','non-array column input is rejected');
SELECT extensions.throws_ok($$SELECT private.analytics_integer_contribution_matrix('[[]]')$$,
  '22023','Disclosure columns require subject maps','non-map column input is rejected');
SELECT extensions.throws_ok($$SELECT private.analytics_integer_contribution_matrix('[{"a":[1,"7"]}]')$$,
  '22023','Disclosure contributions require numeric fractions','string coefficients are rejected');
SELECT extensions.throws_ok($$SELECT private.analytics_integer_contribution_matrix('[{"a":[1,0]}]')$$,
  '22023','Disclosure fractions require integer amounts and positive denominators','zero denominators are rejected');
SELECT extensions.throws_ok($$SELECT private.analytics_integer_contribution_matrix('[{"a":[0.5,1]}]')$$,
  '22023','Disclosure fractions require integer amounts and positive denominators','approximate decimal coefficients are rejected');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role(name)
  WHERE has_function_privilege(role.name,'private.analytics_integer_contribution_matrix(jsonb)','EXECUTE')
    OR has_function_privilege(role.name,'private.analytics_integer_contribution_row(numeric[],integer)','EXECUTE')),
  'API roles cannot execute numerical history decoders');

-- Exact arithmetic contracts shared by private and public release decisions.
SELECT extensions.ok(private.analytics_linear_disclosure_certified(ARRAY[]::numeric[])
  AND private.analytics_linear_disclosure_certified(ARRAY[[0,0],[0,0]]::numeric[]),
  'empty and zero contribution matrices have no nonzero arithmetic disclosure');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(ARRAY[[1],[2],[3],[4],[5]]::numeric[])
  AND NOT private.analytics_linear_disclosure_certified(ARRAY[[1],[2],[3],[4]]::numeric[]),
  'nonzero single-measure support needs five distinct input rows');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(
  ARRAY[[100,200],[100,200],[100,200],[100,200],[100,200]]::numeric[])
  AND NOT private.analytics_linear_disclosure_certified(
  ARRAY[[100,200,300],[100,200,300],[100,200,300],[100,200,300],[100,200,307]]::numeric[]),
  'dependent history is safe but the three-release seven-cent residual has no certificate');
SELECT extensions.ok(NOT private.analytics_linear_disclosure_certified(
  ARRAY[[733,0,733,733],[1000,500,500,500],[1000,500,500,500],[1000,500,500,500],
    [1000,500,500,500],[1000,500,500,500],[1000,1000,1000,1000],[1000,1000,1000,1000],
    [1000,1000,1000,1000],[1000,1000,1000,1000],[1000,1000,1000,1000]]::numeric[]),
  'all financial measures fail the certificate for the dispute-minus-refund residual');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(
  ARRAY[[733,0,733],[1000,500,500],[1000,500,500],[1000,500,500],[1000,500,500],
    [1000,500,500],[1000,1000,0],[1000,1000,0],[1000,1000,0],[1000,1000,0],[1000,1000,0]]::numeric[]),
  'gross refunds and net alone retain five disjoint spanning sets in the same fixture');
SELECT extensions.ok(NOT private.analytics_linear_disclosure_certified(
  ARRAY[[733,0,733,1],[1000,500,500,1],[1000,500,500,1],[1000,500,500,1],[1000,500,500,1],
    [1000,500,500,1],[1000,1000,0,1],[1000,1000,0,1],[1000,1000,0,1],[1000,1000,0,1],[1000,1000,0,1]]::numeric[]),
  'a contact count must be considered together with otherwise certified financial columns');
SELECT extensions.ok(private.analytics_linear_disclosure_certified((
  SELECT array_agg(ARRAY[gross,refund,gross-refund,1]::numeric[] ORDER BY ordinal,gross,refund)
  FROM (VALUES(733,0),(1000,500),(1000,1000)) shape(gross,refund) CROSS JOIN generate_series(1,5) ordinal
)), 'five contacts in each financial shape permit the same amounts and counts together');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(
  ARRAY[[7,3],[7,3],[7,3],[7,3],[7,3]]::numeric[])
  AND NOT private.analytics_linear_disclosure_certified(ARRAY[[7,3],[7,3],[7,3],[7,3],[7,4]]::numeric[]),
  'exactly scaled fractional directions preserve cancellation and a lone residual');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(NULL::numeric[]) IS NULL,
  'missing matrix input never produces a positive certificate');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(
  ARRAY[[0,1],[1,0],[0,2],[2,0],[0,3],[3,0],[0,4],[4,0],[0,5],[5,0]]::numeric[]),
  'pivot columns need not arrive in ascending order');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(
  ARRAY[[10000000000000000000000001,-1],[0,1],[20000000000000000000000002,-2],[0,2],
    [30000000000000000000000003,-3],[0,3],[40000000000000000000000004,-4],[0,4],
    [50000000000000000000000005,-5],[0,5]]::numeric[]),
  'large integer elimination retains exact independent directions without floating point');
SELECT extensions.throws_ok($$SELECT private.analytics_linear_disclosure_certified(ARRAY[1,2]::numeric[])$$,
  '22023','Disclosure matrix requires finite integers and canonical dimensions','one-dimensional matrices are rejected');
SELECT extensions.throws_ok($$SELECT private.analytics_linear_disclosure_certified('[0:1][1:1]={{1},{2}}'::numeric[])$$,
  '22023','Disclosure matrix requires finite integers and canonical dimensions','noncanonical array bounds are rejected');
SELECT extensions.throws_ok($$SELECT private.analytics_linear_disclosure_certified(ARRAY[[0.5]]::numeric[])$$,
  '22023','Disclosure matrix requires finite integers and canonical dimensions','fractional inputs must be scaled exactly before certification');
SELECT extensions.throws_ok($$SELECT private.analytics_linear_disclosure_certified(ARRAY[[NULL]]::numeric[])$$,
  '22023','Disclosure matrix requires finite integers and canonical dimensions','missing contributions are not silently treated as zero');
SELECT extensions.throws_ok($$SELECT private.analytics_linear_disclosure_certified(ARRAY[['NaN'::numeric]])$$,
  '22023','Disclosure matrix requires finite integers and canonical dimensions','nonfinite contributions are rejected');
SELECT extensions.throws_ok($$SELECT private.analytics_linear_disclosure_certified(ARRAY[['Infinity'::numeric],['-Infinity'::numeric]])$$,
  '22023','Disclosure matrix requires finite integers and canonical dimensions','infinite contributions are rejected');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role(name)
  WHERE has_function_privilege(role.name,'private.analytics_linear_disclosure_certified(numeric[])','EXECUTE')),
  'API roles cannot call the internal certificate helper');

-- The policy fixture uses exact per-contact values and real report scopes.
CREATE FUNCTION pg_temp.disclosure_candidate(amounts integer[], refunds integer[] DEFAULT NULL, renewals integer[] DEFAULT NULL,
  debits integer[] DEFAULT NULL, credits integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE cells jsonb; contributors jsonb;
BEGIN
  WITH values AS (
    SELECT position,'contact-'||position AS contact,amount,coalesce(refunds[position],0) AS refund,
      coalesce(renewals[position],0) AS renewal,coalesce(debits[position],0) AS debit,coalesce(credits[position],0) AS credit
    FROM unnest(amounts) WITH ORDINALITY entry(amount,position)
  ), columns AS (
    SELECT contact,metric.key AS field,metric.value AS amount FROM values
    CROSS JOIN LATERAL jsonb_each(jsonb_build_object('sponsorships',1,'unique_sponsor_contacts',1,
      'initial_collected_usd_cents',amount,'renewal_collected_usd_cents',renewal,
      'gross_collected_usd_cents',amount+renewal,'refunds_and_reversals_usd_cents',refund,
      'dispute_debits_usd_cents',debit,'dispute_credits_usd_cents',credit,
      'net_collected_usd_cents',amount+renewal-refund-debit+credit)) metric
  ), maps AS (
    SELECT field,sum((amount#>>'{}')::numeric) AS total,
      coalesce(jsonb_object_agg(contact,jsonb_build_array(amount,1)) FILTER(WHERE amount<>'0'::jsonb),'{}'::jsonb) AS contacts
    FROM columns GROUP BY field
  ), scopes AS (
    SELECT 'official:'||field AS measure,jsonb_build_object('total',contacts,'segment:direct',contacts) AS scopes FROM maps
    UNION ALL SELECT 'official:'||replace(field,'_usd_cents','_minor'),jsonb_build_object('currency:USD',contacts) FROM maps
      WHERE field LIKE '%_usd_cents'
    UNION ALL SELECT 'official:'||field,jsonb_build_object('currency:USD',contacts) FROM maps WHERE field NOT LIKE '%_usd_cents'
  ), merged AS (
    SELECT measure,jsonb_object_agg(scope.key,scope.value) AS value FROM scopes
      CROSS JOIN LATERAL jsonb_each(scopes.scopes) scope GROUP BY measure
  ) SELECT (SELECT jsonb_object_agg(field,to_jsonb(total)) FROM maps),
      jsonb_build_object('contact',jsonb_object_agg(measure,value)) INTO cells,contributors FROM merged;
  cells:=cells||'{"suppressed":false,"verified_sponsor_accounts":0,"active_monthly_commitment_usd_cents":0,"active_annual_commitment_usd_cents":0,"annualized_commitment_usd_cents":0}'::jsonb;
  RETURN jsonb_build_object('snapshot',jsonb_build_object('schema_version',1,'as_of','2026-07-06T00:00:00Z',
    'official',cells,'observed',jsonb_build_object('suppressed',true),
    'segments',jsonb_build_array(cells||'{"key":"direct"}'::jsonb),
    'original_currency',jsonb_build_array((SELECT jsonb_object_agg(replace(key,'_usd_cents','_minor'),value)
      FROM jsonb_each(cells) WHERE key NOT IN ('verified_sponsor_accounts','active_monthly_commitment_usd_cents',
        'active_annual_commitment_usd_cents','annualized_commitment_usd_cents'))||'{"currency":"USD"}'::jsonb)),
    'linear_contributors',contributors,'contact_key_versions','["1:1"]'::jsonb);
END;
$$;
CREATE TEMP TABLE disclosure_cases(name text PRIMARY KEY,result jsonb NOT NULL);
INSERT INTO disclosure_cases VALUES('initial',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100]),'{}'));
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"sponsorships":5,"unique_sponsor_contacts":5,"initial_collected_usd_cents":500,"net_collected_usd_cents":500}'::jsonb
  FROM disclosure_cases WHERE name='initial'),'five contributing contacts can establish the first exact disclosure');
SELECT extensions.ok((SELECT jsonb_array_length(result#>'{basis,contact}')=1 FROM disclosure_cases WHERE name='initial'),
  'proportional measures and repeated scopes retain one original history direction');
INSERT INTO disclosure_cases SELECT 'single_new',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100,733]),result->'basis') FROM disclosure_cases WHERE name='initial';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"sponsorships":null,"unique_sponsor_contacts":null,"initial_collected_usd_cents":null,"gross_collected_usd_cents":null,"net_collected_usd_cents":null}'::jsonb
  FROM disclosure_cases WHERE name='single_new'),'one new contact cannot disclose its payment or count delta');
SELECT extensions.ok((SELECT result#>'{snapshot,segments,0,initial_collected_usd_cents}'='null'::jsonb
  AND result#>'{snapshot,original_currency,0,initial_collected_minor}'='null'::jsonb FROM disclosure_cases WHERE name='single_new'),
  'segments and original currencies cannot supply the withheld amount');
SELECT extensions.ok((SELECT result->'basis' FROM disclosure_cases WHERE name='single_new')=
  (SELECT result->'basis' FROM disclosure_cases WHERE name='initial'),'withholding cannot discard or advance historical directions');
INSERT INTO disclosure_cases SELECT 'five_new',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5])||array_fill(733,ARRAY[5])),result->'basis')
  FROM disclosure_cases WHERE name='single_new';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"sponsorships":10,"unique_sponsor_contacts":10,"gross_collected_usd_cents":4165,"net_collected_usd_cents":4165}'::jsonb
  FROM disclosure_cases WHERE name='five_new'),'a safe five-contact cohort advances after an intervening withheld report');
INSERT INTO disclosure_cases VALUES('refund_base',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5]),array_fill(10,ARRAY[5])),'{}'));
INSERT INTO disclosure_cases SELECT 'single_refund',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5]),ARRAY[17,10,10,10,10]),result->'basis')
  FROM disclosure_cases WHERE name='refund_base';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"refunds_and_reversals_usd_cents":null,"net_collected_usd_cents":null,"gross_collected_usd_cents":500}'::jsonb
  FROM disclosure_cases WHERE name='single_refund'),'an individual refund is withheld while unchanged gross stays visible');
INSERT INTO disclosure_cases SELECT 'repeat_refund',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5]),ARRAY[80,10,10,10,10]),result->'basis')
  FROM disclosure_cases WHERE name='single_refund';
SELECT extensions.ok((SELECT result#>'{snapshot,official,refunds_and_reversals_usd_cents}'='null'::jsonb
  FROM disclosure_cases WHERE name='repeat_refund'),'repeated adjustments by one contact never manufacture support');
INSERT INTO disclosure_cases SELECT 'five_refunds',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5]),array_fill(17,ARRAY[5])),result->'basis')
  FROM disclosure_cases WHERE name='repeat_refund';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"refunds_and_reversals_usd_cents":85,"net_collected_usd_cents":415}'::jsonb FROM disclosure_cases WHERE name='five_refunds'),
  'five proportional refund updates remain releasable against all historical directions');
INSERT INTO disclosure_cases SELECT 'single_renewal',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5]),NULL,ARRAY[7,0,0,0,0]),result->'basis')
  FROM disclosure_cases WHERE name='initial';
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"initial_collected_usd_cents":500,"renewal_collected_usd_cents":null,"gross_collected_usd_cents":null,"net_collected_usd_cents":null}'::jsonb
  FROM disclosure_cases WHERE name='single_renewal'),'one renewal cannot leak through gross or net');
INSERT INTO disclosure_cases SELECT 'second',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5]),NULL,array_fill(100,ARRAY[5])),result->'basis')
  FROM disclosure_cases WHERE name='initial';
INSERT INTO disclosure_cases SELECT 'third',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(100,ARRAY[5]),NULL,ARRAY[200,200,200,200,207]),result->'basis')
  FROM disclosure_cases WHERE name='second';
SELECT extensions.ok((SELECT result#>'{snapshot,official,gross_collected_usd_cents}'='1000'::jsonb FROM disclosure_cases WHERE name='second')
  AND (SELECT result->'snapshot'->'official' @> '{"gross_collected_usd_cents":null,"net_collected_usd_cents":null,"renewal_collected_usd_cents":null}'::jsonb
    FROM disclosure_cases WHERE name='third'),'three-release reconstruction is withheld despite five changes in every pair');
INSERT INTO disclosure_cases VALUES('adjustment_difference',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[733]||array_fill(1000,ARRAY[10]),
    ARRAY[0]||array_fill(500,ARRAY[5])||array_fill(1000,ARRAY[5]),NULL,
    ARRAY[733]||array_fill(500,ARRAY[5])||array_fill(1000,ARRAY[5]),
    ARRAY[733]||array_fill(500,ARRAY[5])||array_fill(1000,ARRAY[5])),'{}'));
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"gross_collected_usd_cents":10733,"net_collected_usd_cents":3233,"refunds_and_reversals_usd_cents":7500,"dispute_debits_usd_cents":null,"dispute_credits_usd_cents":null,"sponsorships":null,"unique_sponsor_contacts":null}'::jsonb
  FROM disclosure_cases WHERE name='adjustment_difference'),
  'core funds remain visible while conflicting adjustments and counts cannot reconstruct the lone 733-cent residual');
INSERT INTO disclosure_cases VALUES('safe_adjustments',private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(array_fill(733,ARRAY[5])||array_fill(1000,ARRAY[10]),
    array_fill(0,ARRAY[5])||array_fill(500,ARRAY[5])||array_fill(1000,ARRAY[5]),NULL,
    array_fill(733,ARRAY[5])||array_fill(500,ARRAY[5])||array_fill(1000,ARRAY[5]),
    array_fill(733,ARRAY[5])||array_fill(500,ARRAY[5])||array_fill(1000,ARRAY[5])),'{}'));
SELECT extensions.ok((SELECT result->'snapshot'->'official' @>
  '{"gross_collected_usd_cents":13665,"net_collected_usd_cents":6165,"refunds_and_reversals_usd_cents":7500,"dispute_debits_usd_cents":11165,"dispute_credits_usd_cents":11165,"sponsorships":15,"unique_sponsor_contacts":15}'::jsonb
  FROM disclosure_cases WHERE name='safe_adjustments'),'all financial details and counts remain available for five contacts in each independent shape');
-- Ten stable accounts share five contact keys; both subject matrices must
-- certify the count, without treating those accounts as ten distinct contacts.
WITH candidate AS (SELECT pg_temp.disclosure_candidate(array_fill(100,ARRAY[5])) AS value), maps AS (
  SELECT (SELECT jsonb_object_agg('contact-'||i,'[2,1]'::jsonb) FROM generate_series(1,5) i) AS contacts,
    (SELECT jsonb_object_agg('account-'||i,'[1,1]'::jsonb) FROM generate_series(1,10) i) AS accounts
), prepared AS (
  SELECT jsonb_set(jsonb_set(value,'{snapshot,official,verified_sponsor_accounts}','10'),
    '{snapshot,segments,0,verified_sponsor_accounts}','10')||jsonb_build_object('linear_contributors',
      (value->'linear_contributors')||jsonb_build_object('contact',value#>'{linear_contributors,contact}'||
        jsonb_build_object('official:verified_sponsor_accounts',jsonb_build_object('total',contacts,'segment:direct',contacts)),
        'account',jsonb_build_object('official:verified_sponsor_accounts',jsonb_build_object('total',accounts,'segment:direct',accounts)))) AS value
  FROM candidate,maps
)
INSERT INTO disclosure_cases SELECT 'shared_accounts',private.coordinate_analytics_disclosure(value,'{}') FROM prepared;
SELECT extensions.ok((SELECT result#>'{snapshot,official}' @>
  '{"unique_sponsor_contacts":5,"verified_sponsor_accounts":10,"gross_collected_usd_cents":500}'::jsonb
  AND jsonb_array_length(result#>'{basis,account}')=1 FROM disclosure_cases WHERE name='shared_accounts'),
  'ten accounts sharing five contacts can be disclosed with compatible financial values');
SELECT extensions.throws_ok($$SELECT private.coordinate_analytics_disclosure(
  jsonb_set(pg_temp.disclosure_candidate(array_fill(100,ARRAY[5])),'{snapshot,official,new_measure}','5'),'{}')$$,
  '23514','Analytics disclosure contains an unclassified measure','new numerical fields cannot bypass disclosure classification');
SELECT extensions.throws_ok($$SELECT private.coordinate_analytics_disclosure(
  jsonb_set(pg_temp.disclosure_candidate(array_fill(100,ARRAY[5])),'{linear_contributors}','{}'),'{}')$$,
  '23514','Analytics contributions do not reconcile','missing contribution evidence fails closed');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role(name)
  WHERE has_table_privilege(role.name,'private.advocate_analytics_releases','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(role.name,'private.advocate_analytics_basis_columns','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_function_privilege(role.name,'private.release_advocate_analytics(uuid,timestamptz)','EXECUTE')
    OR has_function_privilege(role.name,'private.append_analytics_basis(uuid,jsonb)','EXECUTE')
    OR has_function_privilege(role.name,'private.analytics_modular_full_rank_certified(numeric[])','EXECUTE')
    OR has_function_privilege(role.name,'private.certify_advocate_public_metric(uuid,timestamptz,jsonb)','EXECUTE')),
  'API roles cannot access numerical history or choose release cutoffs');
SELECT extensions.ok((SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
  WHERE oid IN ('private.advocate_analytics_releases'::regclass,'private.advocate_analytics_basis_columns'::regclass)),
  'release and numerical history ledgers force row security');

SELECT extensions.is(private.certify_analytics_columns(
  '[{"a":[1.0,1],"b":[1,1],"c":[1,1],"d":[1,1],"e":[1,1]},
    {"f":[2,1],"g":[2,1],"h":[2,1],"i":[2,1],"j":[2,1]},
    {"e":[1,1],"d":[1,1],"c":[1,1],"b":[1,1],"a":[1,1]}]'::jsonb)::text,
  '[{"a":[1.0,1],"b":[1,1],"c":[1,1],"d":[1,1],"e":[1,1]},
    {"f":[2,1],"g":[2,1],"h":[2,1],"i":[2,1],"j":[2,1]}]'::jsonb::text,
  'duplicate directions retain the first original representation and column order');
SELECT extensions.is(private.certify_analytics_columns('[{},{}]'::jsonb),'[]'::jsonb,
  'duplicate zero columns do not manufacture a historical direction');
SELECT extensions.throws_ok($$SELECT private.certify_analytics_columns('[{"a":[1,0]},{"a":[1,0]}]')$$,
  '22023','Disclosure fractions require integer amounts and positive denominators',
  'duplicate removal never bypasses contribution validation');

-- Five copies of an invertible triangular matrix have five disjoint bases.
-- Losing one copy of one row leaves a rational direction with four subjects.
CREATE FUNCTION pg_temp.dense_disclosure_matrix(copies integer, multiplier numeric DEFAULT 1, shorten boolean DEFAULT false)
RETURNS numeric[] LANGUAGE sql AS $$
  SELECT array_agg(values ORDER BY subject) FROM (
    SELECT subject,array_agg((CASE WHEN col<(subject-1)%16+1 THEN 0
      WHEN col=(subject-1)%16+1 THEN 7 ELSE (subject-1)%16-col*31 END)::numeric*multiplier ORDER BY col) AS values
    FROM generate_series(1,copies*16-CASE WHEN shorten THEN 1 ELSE 0 END) subject
    CROSS JOIN generate_series(1,16) col GROUP BY subject
  ) rows;
$$;
SELECT extensions.ok(private.analytics_modular_full_rank_certified(pg_temp.dense_disclosure_matrix(5)),
  'five modular full-rank sets certify independent integer columns');
SELECT extensions.ok(NOT private.analytics_linear_disclosure_certified(pg_temp.dense_disclosure_matrix(5,1,true)),
  'a direction supported by only four subjects cannot pass the accelerated certificate');
SELECT extensions.ok(NOT private.analytics_modular_full_rank_certified(pg_temp.dense_disclosure_matrix(5,2147483647)),
  'prime-divisible columns make the modular proof inconclusive');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(pg_temp.dense_disclosure_matrix(5,2147483647)),
  'the exact fallback still certifies prime-divisible columns');
SELECT extensions.ok(private.analytics_linear_disclosure_certified(pg_temp.dense_disclosure_matrix(5,-1e80::numeric)),
  'negative coefficients and integer values beyond bigint remain exact');
SELECT extensions.is(private.analytics_linear_disclosure_evidence(pg_temp.dense_disclosure_matrix(5))->'columns',
  '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]'::jsonb,
  'the fast proof retains every original independent column in order');

-- Persist a real certified basis and prove replay, immutable history and public
-- coordination. Managed-schema fixture writes finish before release operations.
SET LOCAL session_replication_role = replica;
INSERT INTO public.advocates(id,slug,display_name) VALUES
  ('97000000-0000-4000-8000-000000000001','disclosure-history-fixture','Disclosure history fixture');
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('app.advocate_analytics_release.operation','coordinated-v1',true);
INSERT INTO private.advocate_analytics_releases(id,advocate_id,source_cutoff,snapshot,contribution_digest,contact_key_versions)
SELECT '97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001',
  (date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '7 days',
  result->'snapshot',encode(extensions.digest((result->'basis')::text,'sha256'),'hex'),'["1:1"]'
FROM disclosure_cases WHERE name='initial';
SELECT private.append_analytics_basis('97000000-0000-4000-8000-000000000001',result->'basis')
FROM disclosure_cases WHERE name='initial';
SELECT private.append_analytics_basis('97000000-0000-4000-8000-000000000001',result->'basis')
FROM disclosure_cases WHERE name='initial';
SELECT extensions.is((SELECT count(*) FROM private.advocate_analytics_basis_columns),1::bigint,
  'replaying an existing numerical basis inserts no duplicate history');
SELECT extensions.ok((SELECT private.analytics_disclosure_basis('97000000-0000-4000-8000-000000000001')=result->'basis'
  FROM disclosure_cases WHERE name='initial'),'stored columns reconstruct the certified history exactly');
SELECT extensions.ok((SELECT NOT private.certify_advocate_public_metric(advocate_id,source_cutoff,
  '{"contact-1":[1,1]}'::jsonb) FROM private.advocate_analytics_releases),
  'a public count cannot add a one-contact direction to private history');
SELECT extensions.ok((SELECT private.certify_advocate_public_metric(advocate_id,source_cutoff,
  '{"contact-1":[1,1],"contact-2":[1,1],"contact-3":[1,1],"contact-4":[1,1],"contact-5":[1,1]}'::jsonb)
  FROM private.advocate_analytics_releases),'a dependent public column shares the same retained basis');
SELECT extensions.is((SELECT count(*) FROM private.advocate_analytics_basis_columns),1::bigint,
  'public checks neither copy dependent history nor persist rejected evidence');
SELECT extensions.ok((SELECT private.certify_advocate_public_metric(advocate_id,source_cutoff,
  '{"contact-6":[1,1],"contact-7":[1,1],"contact-8":[1,1],"contact-9":[1,1],"contact-10":[1,1]}'::jsonb)
  FROM private.advocate_analytics_releases), 'five new public contributors add an independently certified historical direction');
SELECT extensions.is((SELECT count(*) FROM private.advocate_analytics_basis_columns),2::bigint,
  'an independent public direction persists for later private reports');
SELECT extensions.ok(private.coordinate_analytics_disclosure(
  pg_temp.disclosure_candidate(ARRAY[100,100,100,100,100,100,101,100,100,100]),
  private.analytics_disclosure_basis('97000000-0000-4000-8000-000000000001'))#>'{snapshot,official,gross_collected_usd_cents}'='null'::jsonb,
  'a later private report cannot reconstruct an individual residual against public history');
SELECT extensions.throws_ok($$SELECT private.append_analytics_basis('97000000-0000-4000-8000-000000000001','{"contact":[],"account":[]}')$$,
  '23514','Analytics history cannot discard prior columns','history cannot reset its disclosure budget');
SELECT extensions.throws_ok($$SELECT private.append_analytics_basis('97000000-0000-4000-8000-000000000001',
  jsonb_set(private.analytics_disclosure_basis('97000000-0000-4000-8000-000000000001'),
    '{contact,0,contact-1}','[101,1]'::jsonb))$$,
  '23514','Analytics history cannot discard prior columns','same-width history cannot replace an existing contribution');
SELECT extensions.throws_ok($$SELECT private.append_analytics_basis('97000000-0000-4000-8000-000000000001',
  jsonb_set(private.analytics_disclosure_basis('97000000-0000-4000-8000-000000000001'),'{contact}',
    (private.analytics_disclosure_basis('97000000-0000-4000-8000-000000000001')->'contact')
      || '[{"contact-1":[1,1]}]'::jsonb))$$,
  '23514','Analytics history requires an independent certified basis','a history extension still requires full certification');
SELECT extensions.throws_ok($$UPDATE private.advocate_analytics_basis_columns SET contributions='{}'$$,
  '42501','Analytics contributions are append only','historical contributions cannot be overwritten');
SELECT extensions.throws_ok($$DELETE FROM private.advocate_analytics_basis_columns$$,
  '42501','Analytics contributions are append only','historical contributions cannot be deleted');
-- Independent full-column reference: keep every original vector, then prove
-- each remains in the compact basis. No release is forgotten after a duplicate,
-- a dependent update, or a later new direction.
CREATE FUNCTION pg_temp.verify_numerical_history() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE history jsonb:='[]'; complete jsonb:='[]'; column_value jsonb; next_history jsonb; prior_column jsonb; stage integer;
BEGIN
  FOR stage IN 1..16 LOOP
    SELECT jsonb_object_agg('contact-'||i,jsonb_build_array(CASE (i-1)/5
      WHEN 0 THEN 100+stage*7 WHEN 1 THEN 200+stage*stage ELSE 300+mod(stage,4) END,1))
      INTO column_value FROM generate_series(1,15) i;
    complete:=complete||jsonb_build_array(column_value);
    next_history:=private.certify_analytics_columns(history||jsonb_build_array(column_value));
    IF next_history IS NULL OR jsonb_array_length(next_history)>3 THEN RETURN false; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(history) WITH ORDINALITY entry(value,ordinal)
      WHERE value IS DISTINCT FROM next_history->(ordinal::integer-1)) THEN RETURN false; END IF;
    FOR prior_column IN SELECT value FROM jsonb_array_elements(complete) entry(value) LOOP
      IF private.certify_analytics_columns(next_history||jsonb_build_array(prior_column)) IS DISTINCT FROM next_history THEN RETURN false; END IF;
    END LOOP;
    IF private.analytics_linear_disclosure_certified(private.analytics_integer_contribution_matrix(complete)) IS NOT TRUE THEN RETURN false; END IF;
    history:=next_history;
  END LOOP;
  RETURN jsonb_array_length(history)=3;
END;
$$;
SELECT extensions.ok(pg_temp.verify_numerical_history(),
  'sixteen full historical vectors retain exactly their original span in three append-only columns');
SELECT * FROM extensions.finish();
ROLLBACK;

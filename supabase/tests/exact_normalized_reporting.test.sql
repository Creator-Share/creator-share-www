BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(2500,3500,x)=2499 FROM (VALUES (3500::bigint),(-1),(-1),(1)) v(x)),
  'interleaved refund and restored dispute round only the final net');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(2500,3500,x)=0 FROM (VALUES (-1::bigint),(1)) v(x)),
  'a fully restored dispute has no normalization residual');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(b,a,x)=1 FROM (VALUES (1::bigint,3::bigint,1::bigint),(1,6,1)) v(b,a,x)),
  'different payment denominators reach an exact positive half-cent');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(b,a,x)=-1 FROM (VALUES (1::bigint,3::bigint,-1::bigint),(1,6,-1)) v(b,a,x)),
  'negative half cents round away from zero consistently');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(2500,3500,-1)=-2500 FROM generate_series(1,3500)),
  '3500 single-minor-unit refunds exactly reverse the original 2500 USD cents');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(9007199254740991,9007199254740991,x)=1 FROM (VALUES (9007199254740991::bigint),(-9007199254740990)) v(x)),
  'large opposing amounts preserve their one-cent difference without floating point');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(b,a,x)=0 FROM (VALUES
  (1::bigint,3::bigint,1::bigint),(1,6,1),(1,9007199254740991,1),(1,9007199254740990,-1)
) v(b,a,x)), 'a cross-payment total just below half a cent is not rounded up by quotient precision loss');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(2500,3500,0)=0 FROM generate_series(1,3)),
  'zero deltas do not fabricate value');
SELECT extensions.ok((SELECT private.sum_normalized_usd_cents(2500,3500,1)=0 FROM generate_series(1,0)),
  'an empty measure returns zero');
CREATE FUNCTION pg_temp.try_normalization(b bigint,a bigint,x bigint) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM private.sum_normalized_usd_cents(b,a,x); RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END;
$$;
SELECT extensions.ok(pg_temp.try_normalization(0,1,1)='22023','zero original normalized amount is invalid');
SELECT extensions.ok(pg_temp.try_normalization(1,0,1)='22023','zero original provider amount is invalid');
SELECT extensions.ok(pg_temp.try_normalization(1,1,NULL)='22023','missing movement value cannot silently disappear from totals');
SELECT extensions.ok(NOT has_function_privilege('authenticated','private.sum_normalized_usd_cents(bigint,bigint,bigint)','EXECUTE'),
  'private exact aggregation is not an arbitrary authenticated reporting surface');
-- Compare every ordering against the sum before division, across many slices.
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM generate_series(1,100) debit CROSS JOIN generate_series(1,100) refund
  CROSS JOIN LATERAL (VALUES
    (ARRAY[-debit::bigint,-refund::bigint,debit::bigint]),
    (ARRAY[-debit::bigint,debit::bigint,-refund::bigint]),
    (ARRAY[-refund::bigint,-debit::bigint,debit::bigint]),
    (ARRAY[-refund::bigint,debit::bigint,-debit::bigint]),
    (ARRAY[debit::bigint,-debit::bigint,-refund::bigint]),
    (ARRAY[debit::bigint,-refund::bigint,-debit::bigint])
  ) permutations(deltas)
  CROSS JOIN LATERAL (
    SELECT private.sum_normalized_usd_cents(2500,3500,delta ORDER BY position) AS result
    FROM unnest(permutations.deltas) WITH ORDINALITY movement(delta,position)
  ) actual
  WHERE actual.result <> -div(2*refund::numeric*2500+3500,2*3500)
), '60000 amount and arrival-order combinations match exact final rounding');
SELECT extensions.ok((SELECT private.sum_usd_fractions(fraction)=4 FROM (
  SELECT private.normalized_usd_fraction(100,140,1) AS fraction FROM generate_series(1,5) payment(id) GROUP BY payment.id
) movement), 'cross-sponsorship fractions are combined before final rounding');
SELECT extensions.ok((SELECT private.sum_usd_fractions(fraction)=0 FROM (
  SELECT private.normalized_usd_fraction(2500,3500,delta) AS fraction
  FROM (VALUES (-1::bigint),(1)) movement(delta) GROUP BY delta
) fractions), 'two-stage aggregation preserves exact dispute restoration');
SELECT * FROM extensions.finish();
ROLLBACK;

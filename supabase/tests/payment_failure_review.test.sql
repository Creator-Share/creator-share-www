BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
-- Fixture state includes a crashed last attempt and a currently active lease.
SET session_replication_role = replica;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
VALUES ('0e000000-0000-4000-8000-000000000001','payment-review@example.test',now(),'{}','{}',false);
INSERT INTO auth.sessions(id,user_id,aal,not_after,created_at,updated_at)
VALUES ('0e100000-0000-4000-8000-000000000001','0e000000-0000-4000-8000-000000000001','aal1',now()+interval '1 hour',now(),now());
INSERT INTO public.roles(id,name) SELECT '0e200000-0000-4000-8000-000000000001','SUPER_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name='SUPER_ADMIN');
INSERT INTO public.role_assignments(user_id,role_id)
SELECT '0e000000-0000-4000-8000-000000000001',id FROM public.roles WHERE name='SUPER_ADMIN';
INSERT INTO public.payment_gateway_events(
 id,provider,provider_account_scope,provider_event_id,event_type,redacted_payload,payload_sha256,
 signature_verified_at,occurred_at,processing_status,processing_attempt_count,max_processing_attempts,
 processed_at,ignored_reason,last_error,processing_locked_at,processing_locked_by,processing_lease_token,verification_method
)
SELECT ('0e300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'STRIPE','stripe_us','evt_review_'||i,'invoice.paid',
 CASE WHEN i=1 THEN '{"quarantine":true,"requires_operational_review":true,"quarantine_error_code":"provider-fact-mismatch"}'::jsonb ELSE '{}'::jsonb END,
 decode(repeat('ab',32),'hex'),now(),now(),
 CASE WHEN i=1 THEN 'quarantined' WHEN i=2 THEN 'failed' ELSE 'processing' END::public.gateway_event_processing_status,
 CASE WHEN i=1 THEN 0 ELSE 12 END,12,
 NULL,NULL,CASE WHEN i=1 THEN 'quarantine' WHEN i=2 THEN 'provider-unavailable' END,
 CASE WHEN i=3 THEN now()-interval '11 minutes' WHEN i=4 THEN now() END,
 CASE WHEN i>=3 THEN 'fixture-worker' END,CASE WHEN i>=3 THEN gen_random_uuid() END,'legacy_verified_event'
FROM generate_series(1,4) i;
SET session_replication_role = origin;
-- End shared payment failure fixture.
CREATE TEMP TABLE before_events AS SELECT id,to_jsonb(e) AS value FROM public.payment_gateway_events e WHERE id::text LIKE '0e300000-%';
CREATE TEMP TABLE before_ledger AS SELECT count(*) AS count FROM public.transaction_ledger;
CREATE TEMP TABLE versions AS SELECT id,private.payment_failure_version(e) AS version FROM public.payment_gateway_events e WHERE id::text LIKE '0e300000-%';
GRANT SELECT ON versions TO authenticated;
CREATE FUNCTION pg_temp.try_ack(id uuid, version text, request uuid DEFAULT gen_random_uuid()) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.acknowledge_payment_failure(id,version,'investigating',request); RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END;
$$;
CREATE FUNCTION pg_temp.try_review_change(command text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END;
$$;
SELECT extensions.ok(NOT has_function_privilege('anon','public.get_payment_failure_health()','EXECUTE'),'anonymous health inventory denied');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.get_payment_failure_health()','EXECUTE'),'ordinary authenticated aggregate inventory denied');
SELECT extensions.ok(NOT has_function_privilege('service_role','public.acknowledge_payment_failure(uuid,text,text,uuid)','EXECUTE'),'service role cannot acknowledge failures');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT extensions.ok(public.get_payment_failure_health() @> '{"unresolved":3,"unacknowledged":3,"quarantined":1,"exhausted":1,"expired_final_leases":1}'::jsonb,'inventory includes old failures and final crashes but excludes active leases');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"0e000000-0000-4000-8000-000000000001","session_id":"0e100000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(jsonb_array_length(public.list_payment_failures()->'items')=3,'administrator sees all unresolved failures');
SELECT extensions.ok(pg_temp.try_ack(id,repeat('00',32))='40001','stale failure version rejected') FROM versions WHERE id::text LIKE '%000001';
SELECT extensions.ok(pg_temp.try_ack(id,version)='40001','active final lease cannot be acknowledged') FROM versions WHERE id::text LIKE '%000004';
SELECT extensions.ok(pg_temp.try_ack(id,version,'0e400000-0000-4000-8000-000000000001')='ok','quarantine can be acknowledged') FROM versions WHERE id::text LIKE '%000001';
SELECT extensions.ok(pg_temp.try_ack(id,version,'0e400000-0000-4000-8000-000000000001')='ok','exact acknowledgment replay succeeds') FROM versions WHERE id::text LIKE '%000001';
SELECT extensions.ok(pg_temp.try_ack(id,version,'0e400000-0000-4000-8000-000000000001')='23505','operation identity cannot acknowledge another failure') FROM versions WHERE id::text LIKE '%000002';
SELECT extensions.ok(pg_temp.try_ack(id,version)='ok','duplicate acknowledgment preserves the original receipt') FROM versions WHERE id::text LIKE '%000001';
RESET ROLE;
SELECT extensions.ok((SELECT count(*)=1 FROM audit.payment_failure_acknowledgments),'one immutable receipt per failure');
SELECT extensions.ok(pg_temp.try_review_change('UPDATE audit.payment_failure_acknowledgments SET reason_code=''awaiting_repair''')='42501','review receipts reject updates');
SELECT extensions.ok(pg_temp.try_review_change('DELETE FROM audit.payment_failure_acknowledgments')='42501','review receipts reject deletion');
SELECT extensions.ok(pg_temp.try_review_change('TRUNCATE audit.payment_failure_acknowledgments')='42501','review receipts reject truncation');

SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.payment_gateway_events e JOIN before_events b USING(id) WHERE to_jsonb(e)<>b.value),'acknowledgment changes no event fields including leases, amounts, and retention');
SELECT extensions.ok((SELECT count(*) FROM public.transaction_ledger)=(SELECT count FROM before_ledger),'acknowledgment creates no financial movement');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT extensions.ok(public.get_payment_failure_health() @> '{"unresolved":3,"unacknowledged":2}'::jsonb,'acknowledgment suppresses paging without resolving the event');
RESET ROLE;
-- A changed failure must not inherit the old acknowledgment. This fixture edit
-- models a later verified disposition; the acknowledgment RPC cannot do it.
SET session_replication_role = replica;
UPDATE public.payment_gateway_events SET last_error='different-verified-failure' WHERE id='0e300000-0000-4000-8000-000000000001';
SET session_replication_role = origin;
SET LOCAL ROLE service_role;
SELECT extensions.ok(public.get_payment_failure_health() @> '{"unresolved":3,"unacknowledged":3}'::jsonb,'changed failure evidence pages again');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='0e000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"0e000000-0000-4000-8000-000000000001","session_id":"0e100000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(pg_temp.try_ack(id,version)='42501','revoked administrator cannot acknowledge a failure') FROM versions WHERE id::text LIKE '%000002';
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;

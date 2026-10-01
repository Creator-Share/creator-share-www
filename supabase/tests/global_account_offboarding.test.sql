BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SET session_replication_role = replica;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
SELECT ('0f000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  'offboarding-'||i||'@example.test', now(), '{}', '{}', false FROM generate_series(1,4) i;
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users WHERE id::text LIKE '0f000000-%';
INSERT INTO auth.sessions(id,user_id,aal,not_after,created_at,updated_at)
SELECT ('0f100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  ('0f000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'aal1',now()+interval '1 hour',now(),now()
FROM generate_series(1,4) i;
INSERT INTO public.roles(id,name) SELECT '0f200000-0000-4000-8000-000000000001','SUPER_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name='SUPER_ADMIN');
INSERT INTO public.role_assignments(user_id,role_id)
SELECT '0f000000-0000-4000-8000-000000000001',id FROM public.roles WHERE name='SUPER_ADMIN';
INSERT INTO public.advocates(id,slug,display_name,relationship_status)
VALUES ('0f300000-0000-4000-8000-000000000001','offboarding-fixture','Offboarding fixture','active');
INSERT INTO public.advocate_memberships(id,advocate_id,user_id)
SELECT ('0f400000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  '0f300000-0000-4000-8000-000000000001',('0f000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
FROM generate_series(2,3) i;
UPDATE public.advocates SET owner_membership_id='0f400000-0000-4000-8000-000000000003'
WHERE id='0f300000-0000-4000-8000-000000000001';
INSERT INTO public.advocate_membership_roles(advocate_id,membership_id,role_id)
SELECT '0f300000-0000-4000-8000-000000000001','0f400000-0000-4000-8000-000000000002',id
FROM public.advocate_roles WHERE key='analytics_viewer';
INSERT INTO public.advocate_membership_roles(advocate_id,membership_id,role_id)
SELECT '0f300000-0000-4000-8000-000000000001','0f400000-0000-4000-8000-000000000003',id
FROM public.advocate_roles WHERE key='owner';
INSERT INTO public.sponsor_identities(id,auth_user_id,status)
VALUES ('0f500000-0000-4000-8000-000000000002','0f000000-0000-4000-8000-000000000002','active');
INSERT INTO public.beneficiaries(id,name,budget_goal)
VALUES ('0f600000-0000-4000-8000-000000000001','Retained sponsorship',1000);
INSERT INTO public.subscriptions(id,user_id,sponsor_identity_id,beneficiary_id,status,amount,interval,current_period_end,sponsorship_method,subject_kind)
VALUES ('0f700000-0000-4000-8000-000000000002','0f000000-0000-4000-8000-000000000002','0f500000-0000-4000-8000-000000000002','0f600000-0000-4000-8000-000000000001','complete',2500,'month',now()+interval '30 days','PAYPAL','standard');
SET session_replication_role = origin;
-- End shared offboarding fixture. The hosted concurrency harness reuses these rows.
CREATE TEMP TABLE retained_subscription AS SELECT to_jsonb(s) value FROM public.subscriptions s WHERE id='0f700000-0000-4000-8000-000000000002';

CREATE FUNCTION pg_temp.try_offboard(ids uuid[]) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.offboard_creator_share_accounts(ids,gen_random_uuid()); RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END;
$$;
CREATE FUNCTION pg_temp.try_history() RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.list_my_recurring_sponsorships(); RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END;
$$;
CREATE FUNCTION pg_temp.try_receipt_change(command text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE command; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END;
$$;
CREATE FUNCTION pg_temp.force_offboarding_rollback() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.offboard_creator_share_accounts(ARRAY['0f000000-0000-4000-8000-000000000004']::uuid[],gen_random_uuid());
  RAISE EXCEPTION 'Rollback probe' USING ERRCODE='P9001';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$$;
SELECT extensions.ok(NOT has_function_privilege('anon','public.offboard_creator_share_accounts(uuid[],uuid)','EXECUTE'),'anonymous offboarding denied');
SELECT extensions.ok(NOT has_function_privilege('service_role','public.offboard_creator_share_accounts(uuid[],uuid)','EXECUTE'),'service role cannot bypass authenticated offboarding');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"0f000000-0000-4000-8000-000000000002","session_id":"0f100000-0000-4000-8000-000000000002"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(pg_temp.try_history()='ok','sponsor access exists before offboarding');
SELECT extensions.ok(private.has_advocate_permission('0f300000-0000-4000-8000-000000000001','portal.analytics.view'),'delegate access exists before offboarding');
SELECT extensions.ok(pg_temp.try_offboard(ARRAY['0f000000-0000-4000-8000-000000000004']::uuid[])='42501','ordinary users cannot offboard accounts');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"0f000000-0000-4000-8000-000000000001","session_id":"0f100000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(pg_temp.force_offboarding_rollback()='P9001','a later failure rolls back a successful offboarding command');
RESET ROLE;
SELECT extensions.ok((SELECT banned_until IS NULL FROM auth.users WHERE id='0f000000-0000-4000-8000-000000000004'),'rollback restores account health');
SELECT extensions.ok(EXISTS(SELECT 1 FROM auth.sessions WHERE user_id='0f000000-0000-4000-8000-000000000004'),'rollback restores removed sessions');
SET LOCAL ROLE authenticated;
SELECT extensions.ok(pg_temp.try_offboard(ARRAY['0f000000-0000-4000-8000-000000000001']::uuid[])='23514','self offboarding denied');
SELECT extensions.ok(pg_temp.try_offboard(ARRAY['0f000000-0000-4000-8000-000000000002','0f000000-0000-4000-8000-000000000003']::uuid[])='55000','mixed batch containing an active owner is rejected');
RESET ROLE;
SELECT extensions.ok((SELECT banned_until IS NULL FROM auth.users WHERE id='0f000000-0000-4000-8000-000000000002'),'rejected batch leaves other account active');
SELECT extensions.ok((SELECT count(*)=0 FROM audit.creator_share_account_offboardings),'rejected batch leaves no receipt');
UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id='0f100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(pg_temp.try_offboard(ARRAY['0f000000-0000-4000-8000-000000000002']::uuid[])='42501','expired administrator session denied');
RESET ROLE;
UPDATE auth.sessions SET not_after=now()+interval '1 hour' WHERE id='0f100000-0000-4000-8000-000000000001';
INSERT INTO public.role_assignments(user_id,role_id) SELECT '0f000000-0000-4000-8000-000000000002',id FROM public.roles WHERE name='SUPER_ADMIN';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(pg_temp.try_offboard(ARRAY['0f000000-0000-4000-8000-000000000002','0f000000-0000-4000-8000-000000000002']::uuid[])='ok','delegate and sponsor account can be disabled atomically');
SELECT extensions.ok(pg_temp.try_offboard(ARRAY['0f000000-0000-4000-8000-000000000002']::uuid[])='ok','repeat offboarding is harmless');
SELECT extensions.ok(public.get_creator_share_disabled_accounts(ARRAY['0f000000-0000-4000-8000-000000000002']::uuid[])='["0f000000-0000-4000-8000-000000000002"]'::jsonb,'administrator receives exact disabled state');
RESET ROLE;
SELECT extensions.ok((SELECT count(*)=1 FROM audit.creator_share_account_offboardings),'replay does not duplicate immutable receipt');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.role_assignments WHERE user_id='0f000000-0000-4000-8000-000000000002'),'global role assignments removed');
SELECT extensions.ok((SELECT banned_until>now()+interval '100 years' FROM auth.users WHERE id='0f000000-0000-4000-8000-000000000002'),'provider account remains banned');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM auth.sessions WHERE user_id='0f000000-0000-4000-8000-000000000002'),'target sessions removed');
SELECT extensions.ok(EXISTS(SELECT 1 FROM public.users WHERE id='0f000000-0000-4000-8000-000000000002'),'profile retained');
SELECT extensions.ok((SELECT to_jsonb(s)=(SELECT value FROM retained_subscription) FROM public.subscriptions s WHERE id='0f700000-0000-4000-8000-000000000002'),'subscription and financial linkage unchanged');
SELECT extensions.ok(pg_temp.try_receipt_change('UPDATE audit.creator_share_account_offboardings SET request_id=gen_random_uuid()')='42501','offboarding evidence rejects updates');
SELECT extensions.ok(pg_temp.try_receipt_change('DELETE FROM audit.creator_share_account_offboardings')='42501','offboarding evidence rejects deletion');
SELECT extensions.ok(pg_temp.try_receipt_change('TRUNCATE audit.creator_share_account_offboardings')='42501','offboarding evidence rejects truncation');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"0f000000-0000-4000-8000-000000000002","session_id":"0f100000-0000-4000-8000-000000000002"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(NOT private.is_current_account_active(),'retained JWT is not a healthy account');
SELECT extensions.ok(NOT private.has_advocate_permission('0f300000-0000-4000-8000-000000000001','portal.analytics.view'),'retained JWT loses delegate access');
SELECT extensions.ok(pg_temp.try_history()='42501','retained JWT loses sponsor history access');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.users WHERE id='0f000000-0000-4000-8000-000000000002'),'retained JWT loses profile access');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;

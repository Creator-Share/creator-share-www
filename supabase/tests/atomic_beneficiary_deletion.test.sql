BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
-- Inline fixture: the Supabase test runner transports SQL files independently.
-- Synthetic setup only. Every tested deletion runs with normal triggers enabled.
SET session_replication_role = replica;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
VALUES ('bd000000-0000-4000-8000-000000000001','deletion-admin@example.test',now(),'{}','{}',false),
       ('bd000000-0000-4000-8000-000000000004','deletion-member@example.test',now(),'{}','{}',false);
INSERT INTO public.users(id,email) VALUES
  ('bd000000-0000-4000-8000-000000000001','deletion-admin@example.test'),
  ('bd000000-0000-4000-8000-000000000004','deletion-member@example.test');
INSERT INTO auth.sessions(id,user_id,aal,not_after,created_at,updated_at) VALUES
  ('bd000000-0000-4000-8000-000000000002','bd000000-0000-4000-8000-000000000001','aal1',now()+interval '1 hour',now(),now()),
  ('bd000000-0000-4000-8000-000000000005','bd000000-0000-4000-8000-000000000004','aal1',now()+interval '1 hour',now(),now());
INSERT INTO public.roles(id,name)
SELECT 'bd000000-0000-4000-8000-000000000003','SUPER_ADMIN'
WHERE NOT EXISTS(SELECT 1 FROM public.roles WHERE name='SUPER_ADMIN');
INSERT INTO public.role_assignments(user_id,role_id,organization_id,advocate_id)
SELECT 'bd000000-0000-4000-8000-000000000001',id,NULL,NULL
FROM public.roles WHERE name='SUPER_ADMIN';
INSERT INTO public.beneficiaries(id,name,budget_goal)
SELECT ('bd100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Deletion fixture '||i,1000
FROM generate_series(1,4) i;
INSERT INTO public.activities(id,beneficiary_id,title)
SELECT ('bd200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       ('bd100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Retained activity'
FROM generate_series(1,4) i;
INSERT INTO public.media(id,parent_id,type,extension)
SELECT ('bd300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       ('bd100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'IMAGE','jpg'
FROM generate_series(1,4) i;
-- Disposable concurrency databases copy schema without migration seed rows.
INSERT INTO public.payment_provider_accounts(provider,scope,environment)
VALUES ('PAYPAL','paypal','sandbox') ON CONFLICT (provider,scope) DO NOTHING;
INSERT INTO public.paypal_billing_catalog_entries(id,catalog_key,subject_kind,beneficiary_id,product_name,recurrence_interval,base_amount_usd_cents,charged_amount_minor,charged_currency,conversion_rate,currency_rate_source,product_request_id,plan_request_id,provisioning_lease_token,provisioning_lease_expires_at)
VALUES ('bd400000-0000-4000-8000-000000000001',decode(repeat('bd',32),'hex'),'standard','bd100000-0000-4000-8000-000000000001','Deletion fixture','month',1000,1000,'USD',1,'fixture','bd400000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-000000000002','bd400000-0000-4000-8000-000000000003',now()+interval '5 minutes');
SET session_replication_role = origin;


SELECT extensions.ok(NOT has_function_privilege('anon','public.delete_creator_share_beneficiaries(uuid[],uuid)','EXECUTE'),'anonymous callers cannot delete beneficiaries');
SELECT extensions.ok(NOT has_function_privilege('service_role','public.delete_creator_share_beneficiaries(uuid[],uuid)','EXECUTE'),'service workers cannot bypass administrator deletion authority');
SELECT extensions.ok(has_function_privilege('authenticated','public.delete_creator_share_beneficiaries(uuid[],uuid)','EXECUTE'),'authenticated callers can reach the checked command');

CREATE FUNCTION pg_temp.try_delete(ids uuid[]) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.delete_creator_share_beneficiaries(ids,'bd500000-0000-4000-8000-000000000001');
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$$;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bd000000-0000-4000-8000-000000000001","session_id":"bd000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(pg_temp.try_delete(ARRAY['bd100000-0000-4000-8000-000000000001']::uuid[]) IN ('23503','23001'),'financial references reject deletion');
SELECT extensions.ok(pg_temp.try_delete(ARRAY['bd100000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000002']::uuid[]) IN ('23503','23001'),'one protected child rejects the whole bulk operation');
SELECT extensions.is(pg_temp.try_delete(ARRAY[]::uuid[]),'22023','empty batches are rejected');
SELECT extensions.is(pg_temp.try_delete(ARRAY[NULL]::uuid[]),'22023','null identifiers are rejected');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.beneficiaries WHERE id IN ('bd100000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000002')),2::bigint,'failed bulk deletion preserves both children');
SELECT extensions.is((SELECT count(*) FROM public.activities WHERE beneficiary_id IN ('bd100000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000002')),2::bigint,'failed bulk deletion preserves all activities');
SELECT extensions.is((SELECT count(*) FROM public.media WHERE parent_id IN ('bd100000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000002')),2::bigint,'failed bulk deletion preserves all media metadata');
SELECT extensions.is((SELECT count(*) FROM audit.audit_events WHERE request_id='bd500000-0000-4000-8000-000000000001'),0::bigint,'failed deletion leaves no committed success audit');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bd000000-0000-4000-8000-000000000004","session_id":"bd000000-0000-4000-8000-000000000005"}',true);
SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT extensions.is(pg_temp.try_delete(ARRAY['bd100000-0000-4000-8000-000000000002']::uuid[]),'42501','ordinary users cannot delete a child');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bd000000-0000-4000-8000-000000000001","session_id":"bd000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);
UPDATE auth.sessions SET not_after=now()-interval '1 hour' WHERE id='bd000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT extensions.is(pg_temp.try_delete(ARRAY['bd100000-0000-4000-8000-000000000002']::uuid[]),'42501','expired sessions cannot delete a child');
RESET ROLE;
UPDATE auth.sessions SET not_after=now()+interval '1 hour' WHERE id='bd000000-0000-4000-8000-000000000002';
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='bd000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT extensions.is(pg_temp.try_delete(ARRAY['bd100000-0000-4000-8000-000000000002']::uuid[]),'42501','banned administrators cannot delete a child');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='bd000000-0000-4000-8000-000000000001';

CREATE TEMP TABLE deletion_result(value jsonb);
GRANT INSERT, SELECT ON deletion_result TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO deletion_result SELECT public.delete_creator_share_beneficiaries(ARRAY['bd100000-0000-4000-8000-000000000002']::uuid[],'bd500000-0000-4000-8000-000000000002');
RESET ROLE;
SELECT extensions.is((SELECT value->>'deleted_count' FROM deletion_result),'1','an eligible child is deleted');
SELECT extensions.is((SELECT jsonb_array_length(value->'media') FROM deletion_result),1,'committed deletion returns the exact storage candidate');
SELECT extensions.is((SELECT value#>>'{media,0,parent_id}' FROM deletion_result),'bd100000-0000-4000-8000-000000000002','cleanup remains scoped to the deleted child');
SELECT extensions.is((SELECT count(*) FROM public.beneficiaries WHERE id='bd100000-0000-4000-8000-000000000002'),0::bigint,'eligible beneficiary is absent');
SELECT extensions.is((SELECT count(*) FROM public.activities WHERE beneficiary_id='bd100000-0000-4000-8000-000000000002'),0::bigint,'eligible child activities are removed atomically');
SELECT extensions.is((SELECT count(*) FROM public.media WHERE parent_id='bd100000-0000-4000-8000-000000000002'),0::bigint,'eligible child media metadata is removed atomically');
SELECT extensions.ok(EXISTS(SELECT 1 FROM audit.audit_events WHERE request_id='bd500000-0000-4000-8000-000000000002' AND actor_user_id='bd000000-0000-4000-8000-000000000001'),'successful deletion retains actor-bound audit evidence');
SET LOCAL ROLE authenticated;
SELECT extensions.is(public.delete_creator_share_beneficiaries(ARRAY['bd100000-0000-4000-8000-000000000002']::uuid[],'bd500000-0000-4000-8000-000000000003')->>'deleted_count','0','a repeated absent-child deletion is a no-op');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;

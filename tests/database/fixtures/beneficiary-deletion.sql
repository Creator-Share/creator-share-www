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

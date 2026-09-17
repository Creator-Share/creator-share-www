BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous)
VALUES ('bc000000-0000-4000-8000-000000000001','admin-state@example.test',now(),false),
       ('bc000000-0000-4000-8000-000000000002','other-sponsor@example.test',now(),false);
INSERT INTO public.users(id,email)
VALUES ('bc000000-0000-4000-8000-000000000001','admin-state@example.test'),
       ('bc000000-0000-4000-8000-000000000002','other-sponsor@example.test');
INSERT INTO public.role_assignments(id,user_id,role_id)
SELECT 'bc000000-0000-4000-8000-000000000003','bc000000-0000-4000-8000-000000000001',id
FROM public.roles WHERE name='SUPER_ADMIN';
INSERT INTO public.subscriptions(id,user_id,amount,status,interval,sponsorship_method,email)
VALUES ('bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000002',2500,'complete','month','STRIPE','other-sponsor@example.test');
INSERT INTO public.expenses(id,name,organization_id)
VALUES ('bc000000-0000-4000-8000-000000000005','Account-state fixture',NULL);
INSERT INTO public.advocates(id,slug,display_name,relationship_status)
VALUES ('bc100000-0000-4000-8000-000000000001','account-state-fixture','Account-state fixture','active');
INSERT INTO public.advocate_memberships(id,advocate_id,user_id)
VALUES ('bc200000-0000-4000-8000-000000000001','bc100000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002');
INSERT INTO public.advocate_membership_roles(advocate_id,membership_id,role_id)
SELECT 'bc100000-0000-4000-8000-000000000001','bc200000-0000-4000-8000-000000000001',id
FROM public.advocate_roles WHERE key='owner';
UPDATE public.advocates SET owner_membership_id='bc200000-0000-4000-8000-000000000001'
WHERE id='bc100000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bc000000-0000-4000-8000-000000000001"}',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(private.is_creator_share_super_admin(),'active global administrator retains authority');
SELECT extensions.is((SELECT count(*) FROM public.role_assignments WHERE id='bc000000-0000-4000-8000-000000000003'),1::bigint,'active administrator can read the assignment used by route authorization');
SELECT extensions.is((SELECT count(*) FROM public.subscriptions WHERE id='bc000000-0000-4000-8000-000000000004'),1::bigint,'active administrator can read another sponsor subscription');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='bc000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(NOT private.is_creator_share_super_admin(),'retained claims cannot authorize a banned administrator');
SELECT extensions.is((SELECT count(*) FROM public.role_assignments WHERE id='bc000000-0000-4000-8000-000000000003'),0::bigint,'a banned account cannot satisfy the application role lookup');
SELECT extensions.is((SELECT count(*) FROM public.subscriptions WHERE id='bc000000-0000-4000-8000-000000000004'),0::bigint,'a banned administrator cannot read another sponsor subscription');
WITH removed AS (DELETE FROM public.expenses WHERE id='bc000000-0000-4000-8000-000000000005' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM removed),0::bigint,'a banned administrator cannot delete expenses');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.expenses WHERE id='bc000000-0000-4000-8000-000000000005'),1::bigint,'denied expense deletion preserves the row');
UPDATE auth.users SET banned_until=now()-interval '1 second' WHERE id='bc000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(private.is_creator_share_super_admin(),'an expired ban restores existing role authority');
RESET ROLE;
UPDATE auth.users SET deleted_at=now() WHERE id='bc000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(NOT private.is_creator_share_super_admin(),'a soft-deleted account cannot retain administrator authority');
SELECT extensions.is((SELECT count(*) FROM public.role_assignments WHERE id='bc000000-0000-4000-8000-000000000003'),0::bigint,'a soft-deleted account cannot satisfy the route role lookup');
RESET ROLE;
UPDATE auth.users SET deleted_at=NULL,is_anonymous=true WHERE id='bc000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(NOT private.is_creator_share_super_admin(),'an anonymous account cannot hold effective administrator authority');
RESET ROLE;
UPDATE auth.users SET is_anonymous=false WHERE id='bc000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
WITH removed AS (DELETE FROM public.expenses WHERE id='bc000000-0000-4000-8000-000000000005' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM removed),1::bigint,'the active administrator can still delete expenses');
RESET ROLE;
SELECT extensions.ok(NOT has_function_privilege('anon','private.is_current_account_active()','EXECUTE'),'anonymous database callers cannot invoke the account-state helper');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bc000000-0000-4000-8000-000000000002"}',true);
SELECT set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok(private.has_advocate_permission('bc100000-0000-4000-8000-000000000001','portal.view'),'active delegate retains portal view permission');
SELECT extensions.is((SELECT count(*) FROM public.advocates WHERE id='bc100000-0000-4000-8000-000000000001'),1::bigint,'active delegate can read its tenant');
SELECT extensions.is((SELECT count(*) FROM public.get_my_advocate_portal_access()),1::bigint,'active delegate can list its portal');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='bc000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(NOT private.has_advocate_permission('bc100000-0000-4000-8000-000000000001','portal.view'),'banned delegate loses portal view permission');
SELECT extensions.is((SELECT count(*) FROM public.advocates WHERE id='bc100000-0000-4000-8000-000000000001'),0::bigint,'banned delegate cannot read its tenant through the Data API');
SELECT extensions.is((SELECT count(*) FROM public.get_my_advocate_portal_access()),0::bigint,'banned delegate cannot list portals through the definer RPC');
RESET ROLE;
UPDATE auth.users SET banned_until=now()-interval '1 second' WHERE id='bc000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT extensions.is((SELECT count(*) FROM public.get_my_advocate_portal_access()),1::bigint,'expired delegate ban restores portal access');
RESET ROLE;
UPDATE auth.users SET deleted_at=now() WHERE id='bc000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT extensions.is((SELECT count(*) FROM public.get_my_advocate_portal_access()),0::bigint,'soft-deleted delegate cannot list portals');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;

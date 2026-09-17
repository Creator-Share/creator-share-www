BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(7);

SELECT extensions.is(
  (
    SELECT reserved.reason
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = 'advocate-staging'
  ),
  'Reserved for the isolated Creator Share advocate staging tenant root.',
  'the fixed advocate staging label is migration owned'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = 'advocate-staging'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.hostname = 'advocate-staging.creatorshare.com'
  ),
  'the advocate staging root is never assigned to an advocate tenant'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.advocate_reserved_subdomains'::regclass
      AND trigger_definition.tgname =
        'advocate_reserved_subdomains_immutable'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'private.prevent_advocate_dictionary_mutation()'::regprocedure
  ),
  'the exact reserved registry immutability trigger is enabled'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'public.advocate_reserved_subdomains',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_reserved_subdomains',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_reserved_subdomains',
    'DELETE'
  ),
  'the application service role cannot mutate the staging reservation'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocate_reserved_subdomains (label, reason)
    VALUES ('another-staging-root', 'runtime mutation must fail')
  $$,
  '42501',
  'Predefined advocate dictionaries are migration owned',
  'the restored trigger rejects reserved registry inserts'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_reserved_subdomains
    SET reason = 'mutation must fail'
    WHERE label = 'advocate-staging'
  $$,
  '42501',
  'Predefined advocate dictionaries are migration owned',
  'the restored trigger rejects staging reservation mutation'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocates (slug, display_name)
    VALUES ('advocate-staging', 'Forbidden Staging Tenant')
  $$,
  '23514',
  'Advocate subdomain label is reserved',
  'tenant creation cannot claim the advocate staging label'
);

SELECT * FROM extensions.finish();

ROLLBACK;

BEGIN;

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_anonymous
)
VALUES
  (
    'ba100000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'branding-authority-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Boundary","last_name":"Owner"}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    'ba100000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'branding-authority-editor@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Boundary","last_name":"Editor"}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  );

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status
)
VALUES (
  'ba000000-0000-4000-8000-000000000001',
  'branding-authority',
  'Branding Authority',
  'active',
  'draft'
);

INSERT INTO public.advocate_branding (advocate_id)
VALUES ('ba000000-0000-4000-8000-000000000001');

INSERT INTO public.advocate_memberships (
  id,
  advocate_id,
  user_id,
  status
)
VALUES
  (
    'ba200000-0000-4000-8000-000000000001',
    'ba000000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    'ba200000-0000-4000-8000-000000000002',
    'ba000000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000002',
    'active'
  );

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
VALUES
  (
    'ba000000-0000-4000-8000-000000000001',
    'ba200000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001'
  ),
  (
    'ba000000-0000-4000-8000-000000000001',
    'ba200000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    'ba100000-0000-4000-8000-000000000001'
  );

UPDATE public.advocates advocate
SET owner_membership_id = 'ba200000-0000-4000-8000-000000000001'
WHERE advocate.id = 'ba000000-0000-4000-8000-000000000001';

SET CONSTRAINTS ALL IMMEDIATE;

COMMIT;

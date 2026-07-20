BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
SET LOCAL session_replication_role = 'replica';

INSERT INTO private.advocate_invitation_legacy_email_proof_quarantine (
  quarantine_identity
) VALUES (
  'advocate_invitation_legacy_email_proof_v1'
);

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
    'f0420000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'ff042-admin@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    'f0420000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'ff042-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  );

INSERT INTO auth.sessions (
  id,
  user_id,
  created_at,
  updated_at,
  aal,
  not_after
)
VALUES
  (
    'f0421000-0000-4000-8000-000000000001'::uuid,
    'f0420000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    'f0421000-0000-4000-8000-000000000002'::uuid,
    'f0420000-0000-4000-8000-000000000002'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  );

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT
  'f0420000-0000-4000-8000-000000000001'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

SET LOCAL session_replication_role = 'origin';

COMMIT;

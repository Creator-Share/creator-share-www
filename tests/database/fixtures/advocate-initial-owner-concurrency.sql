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
    'f0390000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'ff039-admin-one@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    'f0390000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'ff039-admin-two@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    'f0390000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'ff039-owner@example.test',
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
    'f0391000-0000-4000-8000-000000000001'::uuid,
    'f0390000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    'f0391000-0000-4000-8000-000000000002'::uuid,
    'f0390000-0000-4000-8000-000000000002'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    'f0391000-0000-4000-8000-000000000003'::uuid,
    'f0390000-0000-4000-8000-000000000003'::uuid,
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
SELECT actor.user_id, role.id, NULL, NULL
FROM (
  VALUES
    ('f0390000-0000-4000-8000-000000000001'::uuid),
    ('f0390000-0000-4000-8000-000000000002'::uuid)
) AS actor(user_id)
CROSS JOIN public.roles role
WHERE role.name = 'SUPER_ADMIN';

SET LOCAL session_replication_role = 'origin';

COMMIT;

BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT public.arm_advocate_invitation_legacy_email_proof_quarantine(
  'f0390000-0000-4000-8000-000000000801'::uuid,
  'ff039-test-cutover-arm'
);

COMMIT;

BEGIN;

SET LOCAL session_replication_role = 'replica';

UPDATE private.advocate_invitation_legacy_email_proof_quarantine
SET legacy_claim_fenced_at = clock_timestamp() - interval '71 seconds'
WHERE quarantine_identity = 'advocate_invitation_legacy_email_proof_v1';

SET LOCAL session_replication_role = 'origin';

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT *
FROM public.quarantine_legacy_advocate_invitation_proofs(
  3600::smallint,
  'f0390000-0000-4000-8000-000000000802'::uuid,
  'ff039-test-cutover-quarantine'
);

COMMIT;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '60s';

SELECT extensions.no_plan();

CREATE TEMP TABLE onboarding_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  bigint_value bigint,
  text_value text
) ON COMMIT DROP;

CREATE TEMP TABLE onboarding_result (
  operation_id uuid,
  advocate_id uuid,
  advocate_version bigint,
  onboarding_status text,
  created boolean
) ON COMMIT DROP;

CREATE TEMP TABLE onboarding_revocation_result (
  operation_id uuid,
  advocate_id uuid,
  advocate_version bigint,
  revocation_status text,
  created boolean
) ON COMMIT DROP;

CREATE TEMP TABLE onboarding_claim (
  outbox_id uuid,
  invitation_id uuid,
  advocate_id uuid,
  lease_token text,
  lease_expires_at timestamp with time zone,
  target_auth_user_id uuid,
  template_key text,
  template_data jsonb,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  secret_payload_ciphertext bytea,
  capability_digest bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  provider_idempotency_key text,
  attempt_count smallint
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.set_onboarding_claims(
  target_user_id uuid,
  include_fresh_email_otp boolean DEFAULT false,
  authentication_method text DEFAULT 'otp'
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_now_epoch bigint := extract(epoch FROM clock_timestamp())::bigint;
  v_claims jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', target_user_id::text, true);

  v_claims := jsonb_build_object(
    'role', 'authenticated',
    'sub', target_user_id::text,
    'session_id', target_user_id::text,
    'iat', v_now_epoch,
    'aal', 'aal1'
  );

  IF include_fresh_email_otp THEN
    v_claims := v_claims || jsonb_build_object(
      'amr', jsonb_build_array(
        jsonb_build_object(
          'method', authentication_method,
          'timestamp', v_now_epoch
        )
      )
    );
  END IF;

  PERFORM set_config('request.jwt.claims', v_claims::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.set_onboarding_service_role()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'service_role')::text,
    true
  );
END;
$$;

SELECT extensions.ok(
  (
    SELECT bool_and(
      routine.prosecdef
      AND coalesce(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    )
    FROM pg_proc routine
    WHERE routine.oid = ANY (ARRAY[
      'public.onboard_creator_share_advocate(uuid,text,text,text,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)'::regprocedure,
      'public.reissue_advocate_initial_owner_invitation(uuid,uuid,bigint,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)'::regprocedure,
      'public.revoke_advocate_initial_owner_invitation(uuid,uuid,bigint,text,text,text,text,text,text)'::regprocedure,
      'public.redeem_advocate_invitation(text,text,text,text,text,text,text,uuid)'::regprocedure,
      'public.redeem_advocate_delegate_invitation_legacy(text,text,text,text,text,text,text)'::regprocedure,
      'private.redeem_advocate_invitation_once_legacy(text,text,text,text,text,text,text)'::regprocedure,
      'public.recover_advocate_invitation_redemption(uuid)'::regprocedure,
      'public.start_advocate_portal_provisioning(uuid,bigint,uuid,text)'::regprocedure,
      'public.apply_creator_share_advocate_lifecycle_action_legacy(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)'::regprocedure,
      'public.apply_creator_share_advocate_lifecycle_action(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)'::regprocedure,
      'public.list_creator_share_advocate_controls(integer,timestamptz,uuid,public.advocate_relationship_status,public.advocate_publication_status)'::regprocedure,
      'public.get_creator_share_advocate_control_snapshot(uuid)'::regprocedure
    ])
  ),
  'onboarding, recovery, and lifecycle boundaries are fixed-search-path security definers'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.onboard_creator_share_advocate(uuid,text,text,text,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.reissue_advocate_initial_owner_invitation(uuid,uuid,bigint,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.revoke_advocate_initial_owner_invitation(uuid,uuid,bigint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.onboard_creator_share_advocate(uuid,text,text,text,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.onboard_creator_share_advocate(uuid,text,text,text,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reissue_advocate_initial_owner_invitation(uuid,uuid,bigint,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.reissue_advocate_initial_owner_invitation(uuid,uuid,bigint,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.revoke_advocate_initial_owner_invitation(uuid,uuid,bigint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.revoke_advocate_initial_owner_invitation(uuid,uuid,bigint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.redeem_advocate_invitation(text,text,text,text,text,text,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.recover_advocate_invitation_redemption(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.redeem_advocate_invitation(text,text,text,text,text,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.recover_advocate_invitation_redemption(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.redeem_advocate_delegate_invitation_legacy(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.redeem_advocate_delegate_invitation_legacy(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.redeem_advocate_invitation_once_legacy(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.redeem_advocate_invitation_once_legacy(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.create_advocate_portal(uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.apply_creator_share_advocate_lifecycle_action_legacy(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.apply_creator_share_advocate_lifecycle_action_legacy(uuid,bigint,public.creator_share_advocate_lifecycle_action,text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'onboarding and redemption expose only authenticated narrow entrypoints while both legacy mutation boundaries are revoked'
);

SELECT extensions.ok(
  (
    SELECT bool_and(relation.relrowsecurity)
      AND bool_and(relation.relforcerowsecurity)
      AND count(*) = 4
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'audit'
      AND relation.relname IN (
        'creator_share_advocate_onboarding_receipts',
        'creator_share_advocate_initial_owner_reissue_receipts',
        'creator_share_advocate_initial_owner_revocation_receipts',
        'creator_share_advocate_invitation_redemption_receipts'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'audit'
      AND policy.tablename IN (
        'creator_share_advocate_onboarding_receipts',
        'creator_share_advocate_initial_owner_reissue_receipts',
        'creator_share_advocate_initial_owner_revocation_receipts',
        'creator_share_advocate_invitation_redemption_receipts'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('audit.creator_share_advocate_onboarding_receipts'),
        ('audit.creator_share_advocate_initial_owner_reissue_receipts'),
        ('audit.creator_share_advocate_initial_owner_revocation_receipts'),
        ('audit.creator_share_advocate_invitation_redemption_receipts')
    ) receipt(relation_name)
    WHERE has_table_privilege(
        'authenticated',
        receipt.relation_name,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
      )
      OR has_table_privilege(
        'service_role',
        receipt.relation_name,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
      )
  ),
  'onboarding receipts are forced-RLS default deny evidence with no API table surface'
);

SELECT extensions.is(
  (
    SELECT array_agg(
      column_definition.column_name::text
      ORDER BY column_definition.ordinal_position
    )
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'audit'
      AND column_definition.table_name =
        'creator_share_advocate_invitation_redemption_receipts'
  ),
  ARRAY[
    'operation_id',
    'invitation_kind',
    'initiating_user_id',
    'request_fingerprint',
    'advocate_id',
    'invitation_id',
    'membership_id',
    'membership_version',
    'provisioning_request_id',
    'resulting_advocate_version',
    'created_at'
  ]::text[],
  'invitation redemption receipts retain only the exact pseudonymous committed outcome'
);

SELECT extensions.ok(
  (
    SELECT array_agg(argument.argument_name ORDER BY argument.ordinality) = ARRAY[
      'onboarding_operation_id',
      'portal_slug',
      'portal_display_name',
      'portal_advocate_type',
      'owner_email',
      'capability_digest',
      'recipient_email_ciphertext',
      'recipient_email_hmac',
      'secret_payload_ciphertext',
      'email_normalization_version',
      'email_hmac_key_version',
      'email_encryption_key_version',
      'change_reason',
      'request_id',
      'trace_id',
      'session_id',
      'client_ip',
      'user_agent'
    ]::text[]
    FROM pg_proc routine
    CROSS JOIN LATERAL unnest(routine.proargnames)
      WITH ORDINALITY AS argument(argument_name, ordinality)
    WHERE routine.oid =
      'public.onboard_creator_share_advocate(uuid,text,text,text,text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)'::regprocedure
      AND argument.ordinality <= routine.pronargs
  ),
  'the onboarding named-argument contract distinguishes input operation identity from its returned operation_id'
);

SELECT extensions.ok(
  (
    SELECT array_agg(argument.argument_name ORDER BY argument.ordinality)
      FILTER (
        WHERE argument.argument_name IN (
          'ownership_status',
          'can_reissue_initial_owner',
          'can_revoke_initial_owner'
        )
      ) = ARRAY[
        'ownership_status',
        'can_reissue_initial_owner',
        'can_revoke_initial_owner'
      ]::text[]
    FROM pg_proc routine
    CROSS JOIN LATERAL unnest(routine.proargnames)
      WITH ORDINALITY AS argument(argument_name, ordinality)
    WHERE routine.oid =
      'public.list_creator_share_advocate_controls(integer,timestamptz,uuid,public.advocate_relationship_status,public.advocate_publication_status)'::regprocedure
  )
  AND (
    SELECT array_agg(argument.argument_name ORDER BY argument.ordinality)
      FILTER (
        WHERE argument.argument_name IN (
          'ownership_status',
          'can_reissue_initial_owner',
          'can_revoke_initial_owner'
        )
      ) = ARRAY[
        'ownership_status',
        'can_reissue_initial_owner',
        'can_revoke_initial_owner'
      ]::text[]
    FROM pg_proc routine
    CROSS JOIN LATERAL unnest(routine.proargnames)
      WITH ORDINALITY AS argument(argument_name, ordinality)
    WHERE routine.oid =
      'public.get_creator_share_advocate_control_snapshot(uuid)'::regprocedure
  ),
  'list and detail projections expose stable ordered owner recovery flags'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
VALUES
  (
    'a7300000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'onboarding-admin@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Ada","last_name":"Admin"}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'a7300000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'initial.owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Olive","last_name":"Owner"}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'a7300000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'not-admin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    now(),
    now()
  );

INSERT INTO auth.sessions (
  id,
  user_id,
  created_at,
  updated_at,
  aal,
  not_after
)
SELECT
  account.id,
  account.id,
  clock_timestamp(),
  clock_timestamp(),
  'aal1',
  clock_timestamp() + interval '1 hour'
FROM auth.users account
WHERE account.id IN (
  'a7300000-0000-4000-8000-000000000001'::uuid,
  'a7300000-0000-4000-8000-000000000002'::uuid,
  'a7300000-0000-4000-8000-000000000003'::uuid
);

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT
  'a7300000-0000-4000-8000-000000000001'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000003'::uuid
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Accept ownership and atomically begin provisioning',
      request_id => 'a7300000-0000-4000-8000-000000000105',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000105'::uuid
    )
  $$,
  '42501',
  'Invitation is invalid or unavailable',
  'an exact operation and capability disclose no receipt to a different user'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.onboard_creator_share_advocate(
      'a7300000-0000-4000-8000-000000000110'::uuid,
      'unauthorized-onboarding',
      'Unauthorized Onboarding',
      'creator',
      'initial.owner@example.test',
      extensions.digest(repeat('0', 64), 'sha256'),
      decode(repeat('10', 64), 'hex'),
      extensions.digest('initial.owner@example.test', 'sha256'),
      decode(repeat('20', 96), 'hex'),
      1::smallint,
      1::smallint,
      1::smallint,
      'Reject a nonadministrator onboarding attempt',
      'a7300000-0000-4000-8000-000000000110',
      'onboarding-unauthorized-trace'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'a verified nonadministrator cannot create an ownerless tenant'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000001'::uuid
);

INSERT INTO onboarding_result
SELECT *
FROM public.onboard_creator_share_advocate(
  'a7300000-0000-4000-8000-000000000101'::uuid,
  'owner-onboarding',
  'Owner Onboarding',
  'creator',
  ' Initial.Owner@Example.Test ',
  extensions.digest(repeat('a', 64), 'sha256'),
  decode(repeat('11', 64), 'hex'),
  extensions.digest('initial.owner@example.test', 'sha256'),
  decode(repeat('22', 96), 'hex'),
  1::smallint,
  1::smallint,
  1::smallint,
  'Invite the first verified owner',
  'a7300000-0000-4000-8000-000000000101',
  'onboarding-create-trace'
);

INSERT INTO onboarding_test_context (key, uuid_value, bigint_value)
SELECT 'advocate', advocate_id, advocate_version
FROM onboarding_result;

INSERT INTO onboarding_test_context (key, uuid_value)
SELECT 'initial_invitation', receipt.invitation_id
FROM audit.creator_share_advocate_onboarding_receipts receipt
WHERE receipt.operation_id =
  'a7300000-0000-4000-8000-000000000101'::uuid;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_result result
    WHERE result.operation_id =
        'a7300000-0000-4000-8000-000000000101'::uuid
      AND result.advocate_version = 1
      AND result.onboarding_status = 'initial_owner_invitation_queued'
      AND result.created
  )
  AND EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND advocate.relationship_status = 'invited'
      AND advocate.publication_status = 'draft'
      AND advocate.owner_membership_id IS NULL
      AND advocate.owner_onboarding_revision = 0
      AND advocate.version = 1
  )
  AND EXISTS (
    SELECT 1
    FROM public.advocate_branding branding
    WHERE branding.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
  ),
  'onboarding atomically creates an inert ownerless tenant, default branding, and immutable queued outcome'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    JOIN public.advocate_invitation_email_outbox outbox
      ON outbox.invitation_id = invitation.id
     AND outbox.advocate_id = invitation.advocate_id
    WHERE invitation.id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'initial_invitation'
      )
      AND invitation.invitation_kind = 'initial_owner'
      AND invitation.email = 'initial.owner@example.test'
      AND invitation.target_auth_user_id =
        'a7300000-0000-4000-8000-000000000002'::uuid
      AND outbox.template_key = 'advocate_initial_owner_invitation_v1'
      AND private.jsonb_object_has_exact_keys(
        outbox.template_data,
        ARRAY['advocate_display_name', 'invitation_id']::text[]
      )
      AND NOT outbox.template_data ? 'role_keys'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_invitation_roles invitation_role
    WHERE invitation_role.invitation_id = (
      SELECT uuid_value
      FROM onboarding_test_context
      WHERE key = 'initial_invitation'
    )
  ),
  'initial-owner authority is typed, email bound, roleless, and paired with the strict owner template'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
  ),
  'provider topology does not exist before verified initial-owner acceptance'
);

TRUNCATE onboarding_result;

INSERT INTO onboarding_result
SELECT *
FROM public.onboard_creator_share_advocate(
  'a7300000-0000-4000-8000-000000000101'::uuid,
  'owner-onboarding',
  'Owner Onboarding',
  'creator',
  'initial.owner@example.test',
  decode(repeat('33', 32), 'hex'),
  decode(repeat('44', 64), 'hex'),
  decode(repeat('55', 32), 'hex'),
  decode(repeat('66', 96), 'hex'),
  2::smallint,
  2::smallint,
  2::smallint,
  'Invite the first verified owner',
  'a7300000-0000-4000-8000-000000000101',
  'onboarding-replay-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_result replay
    WHERE replay.advocate_id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND replay.advocate_version = 1
      AND replay.onboarding_status = 'initial_owner_invitation_queued'
      AND NOT replay.created
  )
  AND (
    SELECT count(*)
    FROM public.advocates advocate
    WHERE advocate.slug = 'owner-onboarding'
  ) = 1,
  'semantic replay ignores fresh randomized envelopes and key rotation while returning the immutable result'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.onboard_creator_share_advocate(
      'a7300000-0000-4000-8000-000000000101'::uuid,
      'owner-onboarding',
      'Owner Onboarding',
      'creator',
      'different.owner@example.test',
      decode(repeat('77', 32), 'hex'),
      decode(repeat('88', 64), 'hex'),
      decode(repeat('99', 32), 'hex'),
      decode(repeat('aa', 96), 'hex'),
      1::smallint,
      1::smallint,
      1::smallint,
      'Invite the first verified owner',
      'a7300000-0000-4000-8000-000000000101',
      'onboarding-mismatch-trace'
    )
  $$,
  '23505',
  'Advocate onboarding operation was reused with different material',
  'operation replay rejects a changed owner email without retaining it in the unsalted receipt fingerprint'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.creator_share_advocate_onboarding_receipts
    SET onboarding_status = 'initial_owner_invitation_queued'
    WHERE operation_id = 'a7300000-0000-4000-8000-000000000101'::uuid
  $$,
  '42501',
  'Advocate onboarding receipts are append-only',
  'onboarding receipt updates are blocked'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.creator_share_advocate_onboarding_receipts
    WHERE operation_id = 'a7300000-0000-4000-8000-000000000101'::uuid
  $$,
  '42501',
  'Advocate onboarding receipts are append-only',
  'onboarding receipt deletion is blocked'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE audit.creator_share_advocate_onboarding_receipts
  $$,
  '42501',
  'Advocate onboarding receipts are append-only',
  'onboarding receipt truncation is blocked'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate')
    ) snapshot
    WHERE snapshot.ownership_status = 'awaiting_owner_acceptance'
      AND snapshot.owner_display_name IS NULL
      AND NOT snapshot.can_reissue_initial_owner
      AND snapshot.can_revoke_initial_owner
      AND NOT snapshot.can_suspend
  )
  AND EXISTS (
    SELECT 1
    FROM public.list_creator_share_advocate_controls() tenant
    WHERE tenant.advocate_id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND tenant.ownership_status = 'awaiting_owner_acceptance'
      AND tenant.owner_display_name IS NULL
      AND NOT tenant.can_reissue_initial_owner
      AND tenant.can_revoke_initial_owner
  ),
  'ownerless list and detail projections expose no placeholder identity and only safe recovery actions'
);

TRUNCATE onboarding_result;

INSERT INTO onboarding_result
SELECT *
FROM public.onboard_creator_share_advocate(
  'a7300000-0000-4000-8000-000000000301'::uuid,
  'archived-ownerless',
  'Archived Ownerless',
  'creator',
  'initial.owner@example.test',
  extensions.digest(repeat('d', 64), 'sha256'),
  decode(repeat('d1', 64), 'hex'),
  extensions.digest('initial.owner@example.test', 'sha256'),
  decode(repeat('d2', 96), 'hex'),
  1::smallint,
  1::smallint,
  1::smallint,
  'Create an ownerless tenant for archive lifecycle coverage',
  'a7300000-0000-4000-8000-000000000301',
  'ownerless-archive-onboarding-trace'
);

INSERT INTO onboarding_test_context (key, uuid_value)
SELECT 'archived_advocate', result.advocate_id
FROM onboarding_result result;

SELECT set_config(
  'app.audit.tool',
  'creator-share-admin-advocate-lifecycle',
  true
);
SELECT set_config(
  'app.audit.metadata',
  jsonb_build_object(
    'operation', 'archive_advocate',
    'resource_kind', 'advocate',
    'resource_id', (
      SELECT uuid_value::text
      FROM onboarding_test_context
      WHERE key = 'archived_advocate'
    ),
    'outcome', 'archived/suspended'
  )::text,
  true
);

SELECT extensions.throws_ok(
  format(
    $sql$
      UPDATE public.advocates advocate
      SET
        relationship_status = 'archived',
        publication_status = 'suspended'
      WHERE advocate.id = %L::uuid
    $sql$,
    (
      SELECT uuid_value
      FROM onboarding_test_context
      WHERE key = 'archived_advocate'
    )
  ),
  '42501',
  'Ownerless advocate archive requires the lifecycle boundary',
  'forged audit settings cannot authorize an ownerless archive transition'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.apply_creator_share_advocate_lifecycle_action(
        %L::uuid,
        1,
        'suspend',
        'Reject suspension before initial owner acceptance',
        %L::uuid,
        'ownerless-direct-suspend-trace'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM onboarding_test_context
      WHERE key = 'archived_advocate'
    ),
    'a7300000-0000-4000-8000-000000000302'
  ),
  '23514',
  'Ownerless advocate lifecycle transition is invalid',
  'the mutation boundary rejects direct suspension of an ownerless onboarding tenant'
);

SELECT *
FROM public.apply_creator_share_advocate_lifecycle_action(
  (
    SELECT uuid_value
    FROM onboarding_test_context
    WHERE key = 'archived_advocate'
  ),
  1,
  'archive',
  'Archive an ownerless onboarding tenant without accepting ownership',
  'a7300000-0000-4000-8000-000000000303'::uuid,
  'ownerless-archive-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'archived_advocate'
      )
      AND advocate.owner_membership_id IS NULL
      AND advocate.relationship_status = 'archived'
      AND advocate.publication_status = 'suspended'
      AND advocate.version = 2
  ),
  'archive commits the terminal ownerless lifecycle state exactly once'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.get_creator_share_advocate_control_snapshot(
      (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'archived_advocate'
      )
    ) snapshot
    WHERE snapshot.ownership_status = 'owner_unassigned'
      AND snapshot.owner_display_name IS NULL
      AND NOT snapshot.can_reissue_initial_owner
      AND NOT snapshot.can_revoke_initial_owner
      AND NOT snapshot.can_suspend
      AND NOT snapshot.can_resume
      AND NOT snapshot.can_archive
  ),
  'archived ownerless detail remains visible with unassigned ownership and no recovery actions'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.list_creator_share_advocate_controls() tenant
    WHERE tenant.advocate_id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'archived_advocate'
      )
      AND tenant.relationship_status = 'archived'
      AND tenant.publication_status = 'suspended'
      AND tenant.ownership_status = 'owner_unassigned'
      AND tenant.owner_display_name IS NULL
      AND NOT tenant.can_reissue_initial_owner
      AND NOT tenant.can_revoke_initial_owner
  ),
  'archived ownerless list rows remain visible with privacy-safe unassigned ownership'
);

SELECT pg_temp.set_onboarding_service_role();

DO $test_cutover$
BEGIN
  PERFORM public.arm_advocate_invitation_legacy_email_proof_quarantine(
    'a7300000-0000-4000-8000-000000000801'::uuid,
    'initial-owner-test-arm'
  );
END;
$test_cutover$;

SET LOCAL session_replication_role = replica;
UPDATE private.advocate_invitation_legacy_email_proof_quarantine
SET
  legacy_claim_fenced_at = clock_timestamp() - interval '71 seconds',
  legacy_claim_fence_transaction_id = '1'::xid8
WHERE quarantine_identity = 'advocate_invitation_legacy_email_proof_v1';
SET LOCAL session_replication_role = origin;

DO $test_cutover$
BEGIN
  PERFORM *
  FROM public.quarantine_legacy_advocate_invitation_proofs(
    3600::smallint,
    'a7300000-0000-4000-8000-000000000802'::uuid,
    'initial-owner-test-quarantine'
  );
END;
$test_cutover$;

INSERT INTO onboarding_claim
SELECT *
FROM public.claim_advocate_invitation_email_jobs(
  'initial-owner-worker',
  1::smallint,
  10,
  'initial-owner-claim',
  'initial-owner-claim-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_claim claim
    WHERE claim.invitation_id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'initial_invitation'
      )
      AND claim.template_key = 'advocate_initial_owner_invitation_v1'
      AND claim.target_auth_user_id =
        'a7300000-0000-4000-8000-000000000002'::uuid
  ),
  'the email worker can claim the original ownerless initial-owner envelope'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000001'::uuid
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.reissue_advocate_initial_owner_invitation(
        %L::uuid,
        %L::uuid,
        1,
        'initial.owner@example.test',
        decode(repeat('bb', 32), 'hex'),
        decode(repeat('bc', 64), 'hex'),
        decode(repeat('bd', 32), 'hex'),
        decode(repeat('be', 96), 'hex'),
        1::smallint,
        1::smallint,
        1::smallint,
        'Reject replacement of live authority',
        %L,
        'initial-owner-live-reissue-trace'
      )
    $sql$,
    'a7300000-0000-4000-8000-000000000201',
    (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
    'a7300000-0000-4000-8000-000000000201'
  ),
  '55000',
  'Initial-owner invitation delivery is not safely terminal',
  'reissue rejects a live reclaimable pre-handoff delivery lease'
);

SELECT pg_temp.set_onboarding_service_role();

SELECT extensions.is(
  public.fail_advocate_invitation_email_delivery(
    (SELECT outbox_id FROM onboarding_claim LIMIT 1),
    (SELECT lease_token FROM onboarding_claim LIMIT 1),
    'invitation_email_material_invalid',
    300,
    'initial-owner-terminal-failure',
    'initial-owner-terminal-failure-trace'
  ),
  false,
  'a proven terminal pre-provider failure is not retryable'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000001'::uuid
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate')
    ) snapshot
    WHERE snapshot.can_reissue_initial_owner
      AND snapshot.can_revoke_initial_owner
  )
  AND EXISTS (
    SELECT 1
    FROM public.list_creator_share_advocate_controls() tenant
    WHERE tenant.advocate_id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND tenant.can_reissue_initial_owner
      AND tenant.can_revoke_initial_owner
  ),
  'list and detail projections expose safe reissue and explicit revocation after terminal non-delivery'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.reissue_advocate_initial_owner_invitation(
        %L::uuid,
        %L::uuid,
        1,
        'wrong.owner@example.test',
        decode(repeat('cb', 32), 'hex'),
        decode(repeat('cc', 64), 'hex'),
        decode(repeat('cd', 32), 'hex'),
        decode(repeat('ce', 96), 'hex'),
        1::smallint,
        1::smallint,
        1::smallint,
        'Reject a mismatched reserved owner email',
        %L,
        'initial-owner-email-mismatch-trace'
      )
    $sql$,
    'a7300000-0000-4000-8000-000000000211',
    (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
    'a7300000-0000-4000-8000-000000000211'
  ),
  '22023',
  'Initial-owner reissue email does not match reserved authority',
  'reissue rejects encrypted material composed for a different owner email before mutation'
);

TRUNCATE onboarding_result;

INSERT INTO onboarding_result
SELECT *
FROM public.reissue_advocate_initial_owner_invitation(
  'a7300000-0000-4000-8000-000000000202'::uuid,
  (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
  1,
  'initial.owner@example.test',
  extensions.digest(repeat('b', 64), 'sha256'),
  decode(repeat('31', 64), 'hex'),
  extensions.digest('initial.owner@example.test:first', 'sha256'),
  decode(repeat('32', 96), 'hex'),
  1::smallint,
  1::smallint,
  1::smallint,
  'Replace terminal initial owner non-delivery',
  'a7300000-0000-4000-8000-000000000202',
  'initial-owner-first-reissue-trace'
);

INSERT INTO onboarding_test_context (key, uuid_value, bigint_value)
SELECT 'first_reissue', receipt.invitation_id, receipt.resulting_advocate_version
FROM audit.creator_share_advocate_initial_owner_reissue_receipts receipt
WHERE receipt.operation_id =
  'a7300000-0000-4000-8000-000000000202'::uuid;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_result result
    WHERE result.advocate_version = 2
      AND result.onboarding_status = 'initial_owner_invitation_requeued'
      AND result.created
  )
  AND private.advocate_initial_owner_invitation_is_authorized(
    (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
    (SELECT uuid_value FROM onboarding_test_context WHERE key = 'first_reissue')
  ),
  'terminal non-delivery reissue advances the tenant version and appends one authorized authority-chain link'
);

TRUNCATE onboarding_result;

INSERT INTO onboarding_result
SELECT *
FROM public.reissue_advocate_initial_owner_invitation(
  'a7300000-0000-4000-8000-000000000202'::uuid,
  (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
  1,
  'initial.owner@example.test',
  decode(repeat('41', 32), 'hex'),
  decode(repeat('42', 64), 'hex'),
  decode(repeat('43', 32), 'hex'),
  decode(repeat('44', 96), 'hex'),
  4::smallint,
  4::smallint,
  4::smallint,
  'Replace terminal initial owner non-delivery',
  'a7300000-0000-4000-8000-000000000202',
  'initial-owner-first-replay-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_result replay
    WHERE replay.advocate_version = 2
      AND replay.onboarding_status = 'initial_owner_invitation_requeued'
      AND NOT replay.created
  ),
  'safe reissue exact replay returns the immutable resulting version despite fresh envelopes'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.reissue_advocate_initial_owner_invitation(
        %L::uuid,
        %L::uuid,
        1,
        'wrong.owner@example.test',
        decode(repeat('45', 32), 'hex'),
        decode(repeat('46', 64), 'hex'),
        decode(repeat('47', 32), 'hex'),
        decode(repeat('48', 96), 'hex'),
        1::smallint,
        1::smallint,
        1::smallint,
        'Replace terminal initial owner non-delivery',
        %L,
        'initial-owner-replay-email-mismatch-trace'
      )
    $sql$,
    'a7300000-0000-4000-8000-000000000202',
    (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
    'a7300000-0000-4000-8000-000000000202'
  ),
  '23505',
  'Initial-owner reissue operation was reused with different material',
  'reissue exact replay rejects an owner email different from the committed replacement'
);

TRUNCATE onboarding_claim;
SELECT pg_temp.set_onboarding_service_role();

INSERT INTO onboarding_claim
SELECT *
FROM public.claim_advocate_invitation_email_jobs(
  'initial-owner-reissue-worker',
  1::smallint,
  10,
  'initial-owner-reissue-claim',
  'initial-owner-reissue-claim-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_claim claim
    WHERE claim.invitation_id = (
      SELECT uuid_value
      FROM onboarding_test_context
      WHERE key = 'first_reissue'
    )
  ),
  'the worker can claim a reissued envelope through the append-only authority chain'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000001'::uuid
);

INSERT INTO onboarding_revocation_result
SELECT *
FROM public.revoke_advocate_initial_owner_invitation(
  'a7300000-0000-4000-8000-000000000204'::uuid,
  (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
  2,
  'Explicitly supersede the current initial owner invitation',
  'a7300000-0000-4000-8000-000000000204',
  'initial-owner-revocation-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_revocation_result result
    WHERE result.advocate_version = 3
      AND result.revocation_status = 'initial_owner_invitation_revoked'
      AND result.created
  )
  AND EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.invitation_id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'first_reissue'
      )
      AND outbox.status = 'cancelled'
      AND outbox.contact_redacted_at IS NOT NULL
      AND outbox.recipient_email_ciphertext IS NULL
      AND outbox.secret_payload_ciphertext IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate')
    ) snapshot
    WHERE snapshot.advocate_version = 3
      AND snapshot.can_reissue_initial_owner
      AND NOT snapshot.can_revoke_initial_owner
  )
  AND EXISTS (
    SELECT 1
    FROM public.list_creator_share_advocate_controls() tenant
    WHERE tenant.advocate_id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND tenant.advocate_version = 3
      AND tenant.can_reissue_initial_owner
      AND NOT tenant.can_revoke_initial_owner
  ),
  'explicit administrator revocation advances version, invalidates authority, redacts delivery, and enables recovery'
);

TRUNCATE onboarding_revocation_result;

INSERT INTO onboarding_revocation_result
SELECT *
FROM public.revoke_advocate_initial_owner_invitation(
  'a7300000-0000-4000-8000-000000000204'::uuid,
  (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
  2,
  'Explicitly supersede the current initial owner invitation',
  'a7300000-0000-4000-8000-000000000204',
  'initial-owner-revocation-replay-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_revocation_result replay
    WHERE replay.advocate_version = 3
      AND replay.revocation_status = 'initial_owner_invitation_revoked'
      AND NOT replay.created
  ),
  'explicit initial-owner revocation has immutable semantic exact replay'
);

TRUNCATE onboarding_result;

INSERT INTO onboarding_result
SELECT *
FROM public.reissue_advocate_initial_owner_invitation(
  'a7300000-0000-4000-8000-000000000203'::uuid,
  (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
  3,
  'initial.owner@example.test',
  extensions.digest(repeat('c', 64), 'sha256'),
  decode(repeat('51', 64), 'hex'),
  extensions.digest('initial.owner@example.test:second', 'sha256'),
  decode(repeat('52', 96), 'hex'),
  1::smallint,
  1::smallint,
  1::smallint,
  'Replace the second explicitly revoked owner authority',
  'a7300000-0000-4000-8000-000000000203',
  'initial-owner-second-reissue-trace'
);

INSERT INTO onboarding_test_context (key, uuid_value, bigint_value)
SELECT 'second_reissue', receipt.invitation_id, receipt.resulting_advocate_version
FROM audit.creator_share_advocate_initial_owner_reissue_receipts receipt
WHERE receipt.operation_id =
  'a7300000-0000-4000-8000-000000000203'::uuid;

SELECT extensions.ok(
  private.advocate_initial_owner_invitation_is_authorized(
    (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'),
    (SELECT uuid_value FROM onboarding_test_context WHERE key = 'second_reissue')
  )
  AND (
    SELECT count(*)
    FROM audit.creator_share_advocate_initial_owner_reissue_receipts receipt
    WHERE receipt.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
  ) = 2
  AND EXISTS (
    SELECT 1
    FROM onboarding_result result
    WHERE result.advocate_version = 4
      AND result.created
  ),
  'a second safe replacement extends rather than forks the authority chain and advances version again'
);

TRUNCATE onboarding_claim;
SELECT pg_temp.set_onboarding_service_role();

INSERT INTO onboarding_claim
SELECT *
FROM public.claim_advocate_invitation_email_jobs(
  'initial-owner-final-worker',
  1::smallint,
  10,
  'initial-owner-final-claim',
  'initial-owner-final-claim-trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM onboarding_claim claim
    WHERE claim.invitation_id = (
      SELECT uuid_value
      FROM onboarding_test_context
      WHERE key = 'second_reissue'
    )
  ),
  'the worker claims the second reissue without granting authority to a fork'
);

SELECT public.begin_advocate_invitation_email_delivery(
  claim.outbox_id,
  claim.lease_token,
  claim.recipient_email_hmac,
  claim.capability_digest,
  'initial-owner-begin-delivery',
  'initial-owner-begin-delivery-trace'
)
FROM onboarding_claim claim
WHERE claim.invitation_id = (
  SELECT uuid_value FROM onboarding_test_context WHERE key = 'second_reissue'
);

SELECT status
FROM public.settle_advocate_invitation_email_delivery(
  (SELECT outbox_id FROM onboarding_claim LIMIT 1),
  (SELECT lease_token FROM onboarding_claim LIMIT 1),
  'sent',
  'provider-initial-owner-accepted',
  NULL,
  300,
  'initial-owner-settle-delivery',
  'initial-owner-settle-delivery-trace'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000003'::uuid,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Reject a different verified account',
      request_id => 'a7300000-0000-4000-8000-000000000101',
      trace_id => 'initial-owner-wrong-user-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000101'::uuid
    )
  $$,
  '42501',
  'Invitation is invalid or unavailable',
  'a fresh verified but differently bound account cannot accept initial ownership'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000002'::uuid,
  true,
  'magiclink'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Reject a non-provider AMR label',
      request_id => 'a7300000-0000-4000-8000-000000000107',
      trace_id => 'initial-owner-wrong-amr-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000107'::uuid
    )
  $$,
  '42501',
  'Fresh email authentication is required to accept an invitation',
  'initial-owner redemption rejects a fresh magiclink label because Supabase emits otp in the verified session AMR'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000002'::uuid
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Reject stale authentication proof',
      request_id => 'a7300000-0000-4000-8000-000000000102',
      trace_id => 'initial-owner-stale-auth-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000102'::uuid
    )
  $$,
  '42501',
  'Fresh email authentication is required to accept an invitation',
  'initial-owner redemption requires a fresh email otp authentication proof'
);

UPDATE auth.users
SET email = 'changed.owner@example.test'
WHERE id = 'a7300000-0000-4000-8000-000000000002'::uuid;

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000002'::uuid,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Reject a changed account email',
      request_id => 'a7300000-0000-4000-8000-000000000103',
      trace_id => 'initial-owner-email-change-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000103'::uuid
    )
  $$,
  '42501',
  'Invitation is invalid or unavailable',
  'the bound account cannot accept after its verified email stops matching the invitation'
);

UPDATE auth.users
SET email = 'initial.owner@example.test'
WHERE id = 'a7300000-0000-4000-8000-000000000002'::uuid;

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000001'::uuid
);

INSERT INTO onboarding_test_context (key, uuid_value)
SELECT
  'collision_advocate',
  public.create_advocate_portal(
    'a7300000-0000-4000-8000-000000000001'::uuid,
    'rollback-collision',
    'Rollback Collision Fixture',
    'Create a foreign-hostname collision for atomic rollback testing',
    'creator',
    'rollback-collision-advocate',
    'rollback-collision-advocate-trace'
  );

SELECT audit.set_actor_context(
  context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
  context_actor_user_id =>
    'a7300000-0000-4000-8000-000000000001'::uuid,
  context_effective_user_id =>
    'a7300000-0000-4000-8000-000000000001'::uuid,
  context_tool => 'creator-share-admin-domains',
  context_request_id => 'rollback-collision-domain',
  context_trace_id => 'rollback-collision-domain-trace',
  context_reason => 'Create a foreign-hostname collision for atomic rollback testing',
  context_metadata => jsonb_build_object(
    'operation', 'create_domain_fault_fixture',
    'resource_kind', 'advocate_domain',
    'resource_id', (
      SELECT uuid_value::text
      FROM onboarding_test_context
      WHERE key = 'collision_advocate'
    ),
    'outcome', 'created'
  )
);

ALTER TABLE public.advocate_domains
  DISABLE TRIGGER advocate_domains_validate_and_prepare;
INSERT INTO public.advocate_domains (
  advocate_id,
  hostname,
  is_primary
)
VALUES (
  (
    SELECT uuid_value
    FROM onboarding_test_context
    WHERE key = 'collision_advocate'
  ),
  'owner-onboarding.creatorshare.com',
  true
);
ALTER TABLE public.advocate_domains
  ENABLE TRIGGER advocate_domains_validate_and_prepare;

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000002'::uuid,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Prove complete rollback after owner creation',
      request_id => 'a7300000-0000-4000-8000-000000000104',
      trace_id => 'initial-owner-rollback-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000104'::uuid
    )
  $$,
  '55000',
  'Advocate provisioning requires an empty domain topology',
  'a foreign-hostname fault after owner activation rolls the entire redemption statement back'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND advocate.relationship_status = 'invited'
      AND advocate.publication_status = 'draft'
      AND advocate.owner_membership_id IS NULL
      AND advocate.version = 4
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
    WHERE receipt.operation_id =
      'a7300000-0000-4000-8000-000000000104'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    WHERE invitation.id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'second_reissue'
      )
      AND invitation.accepted_at IS NULL
  ),
  'failed provisioning leaves no membership, owner pointer, activation, topology, receipt, or consumed invitation behind'
);

DELETE FROM public.advocate_domains
WHERE advocate_id = (
  SELECT uuid_value
  FROM onboarding_test_context
  WHERE key = 'collision_advocate'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000002'::uuid,
  true
);

SELECT extensions.lives_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Accept ownership and atomically begin provisioning',
      request_id => 'a7300000-0000-4000-8000-000000000105',
      trace_id => 'initial-owner-redemption-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000105'::uuid
    )
  $$,
  'the verified reissued owner capability redeems through the original onboarding provisioning receipt'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000002'::uuid
);

SELECT extensions.is(
  (
    SELECT to_jsonb(replayed)
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Accept ownership and atomically begin provisioning',
      request_id => 'a7300000-0000-4000-8000-000000000105',
      trace_id => 'initial-owner-redemption-replay-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000105'::uuid
    ) replayed
  ),
  (
    SELECT jsonb_build_object(
      'advocate_id', receipt.advocate_id,
      'membership_id', receipt.membership_id,
      'membership_version', receipt.membership_version
    )
    FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
    WHERE receipt.operation_id =
      'a7300000-0000-4000-8000-000000000105'::uuid
  ),
  'exact operation replay returns the immutable result without a newly fresh email otp event'
);

SELECT extensions.is(
  (
    SELECT to_jsonb(recovered)
    FROM public.recover_advocate_invitation_redemption(
      'a7300000-0000-4000-8000-000000000105'::uuid
    ) recovered
  ),
  (
    SELECT jsonb_build_object(
      'advocate_id', receipt.advocate_id,
      'membership_id', receipt.membership_id,
      'membership_version', receipt.membership_version
    )
    FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
    WHERE receipt.operation_id =
      'a7300000-0000-4000-8000-000000000105'::uuid
  ),
  'capability-free recovery returns the exact committed outcome to its authenticated user'
);

DELETE FROM auth.sessions
WHERE id = 'a7300000-0000-4000-8000-000000000002'::uuid;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.recover_advocate_invitation_redemption(
      'a7300000-0000-4000-8000-000000000105'::uuid
    )
  $$,
  '28000',
  'An active invitation authentication session is required',
  'a signed but revoked authentication session cannot recover a receipt'
);

INSERT INTO auth.sessions (
  id,
  user_id,
  created_at,
  updated_at,
  aal,
  not_after
)
VALUES (
  'a7300000-0000-4000-8000-000000000002'::uuid,
  'a7300000-0000-4000-8000-000000000002'::uuid,
  clock_timestamp(),
  clock_timestamp(),
  'aal1',
  clock_timestamp() + interval '1 hour'
);

UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 hour'
WHERE id = 'a7300000-0000-4000-8000-000000000002'::uuid;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.recover_advocate_invitation_redemption(
      'a7300000-0000-4000-8000-000000000105'::uuid
    )
  $$,
  '28000',
  'An active invitation authentication session is required',
  'a banned account cannot recover a committed invitation receipt'
);

UPDATE auth.users
SET banned_until = NULL
WHERE id = 'a7300000-0000-4000-8000-000000000002'::uuid;

SELECT extensions.ok(
  (
    SELECT count(*) = 1
      AND bool_and(octet_length(receipt.request_fingerprint) = 32)
    FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
    WHERE receipt.operation_id =
      'a7300000-0000-4000-8000-000000000105'::uuid
      AND receipt.initiating_user_id =
        'a7300000-0000-4000-8000-000000000002'::uuid
      AND receipt.invitation_kind = 'initial_owner'
      AND receipt.invitation_id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'second_reissue'
      )
      AND receipt.resulting_advocate_version = 6
      AND EXISTS (
        SELECT 1
        FROM audit.advocate_portal_provisioning_starts provisioning_start
        WHERE provisioning_start.request_id = receipt.provisioning_request_id
          AND provisioning_start.advocate_id = receipt.advocate_id
          AND provisioning_start.initial_owner_invitation_id =
            receipt.invitation_id
      )
  ),
  'one sanitized receipt binds the owner, invitation, membership, final version, and provisioning start'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'A conflicting semantic reason',
      request_id => 'a7300000-0000-4000-8000-000000000105',
      trace_id => 'initial-owner-redemption-conflict-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000105'::uuid
    )
  $$,
  '40001',
  'Invitation redemption operation conflicts with its receipt',
  'an operation UUID cannot be reused with a different semantic reason'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000003'::uuid
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.recover_advocate_invitation_redemption(
      'a7300000-0000-4000-8000-000000000105'::uuid
    )
  $$,
  '42501',
  'Invitation redemption recovery is unavailable',
  'the operation UUID discloses no receipt to a different authenticated user'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000002'::uuid
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('c', 64),
      change_reason => 'Reject duplicate initial owner redemption',
      request_id => 'a7300000-0000-4000-8000-000000000106',
      trace_id => 'initial-owner-duplicate-trace',
      redemption_operation_id =>
        'a7300000-0000-4000-8000-000000000106'::uuid
    )
  $$,
  '40001',
  'Invitation was redeemed by another operation',
  'successful initial-owner authority rejects a competing operation identity'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.creator_share_advocate_invitation_redemption_receipts
    SET resulting_advocate_version = resulting_advocate_version + 1
    WHERE operation_id =
      'a7300000-0000-4000-8000-000000000105'::uuid
  $$,
  '42501',
  'Advocate onboarding receipts are append-only',
  'initial-owner redemption receipts cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.creator_share_advocate_invitation_redemption_receipts
    WHERE operation_id =
      'a7300000-0000-4000-8000-000000000105'::uuid
  $$,
  '42501',
  'Advocate onboarding receipts are append-only',
  'initial-owner redemption receipts cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE audit.creator_share_advocate_invitation_redemption_receipts
  $$,
  '42501',
  'Advocate onboarding receipts are append-only',
  'initial-owner redemption receipts cannot be truncated'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocates advocate
    JOIN public.advocate_memberships owner_membership
      ON owner_membership.id = advocate.owner_membership_id
     AND owner_membership.advocate_id = advocate.id
    JOIN public.advocate_membership_roles owner_role
      ON owner_role.membership_id = owner_membership.id
     AND owner_role.advocate_id = advocate.id
    WHERE advocate.id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status = 'provisioning'
      AND advocate.version = 6
      AND owner_membership.user_id =
        'a7300000-0000-4000-8000-000000000002'::uuid
      AND owner_membership.status = 'active'
      AND owner_role.role_id =
        '00000000-0000-4000-8000-000000000001'::uuid
  )
  AND (
    SELECT count(*)
    FROM public.advocate_membership_roles owner_role
    WHERE owner_role.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND owner_role.role_id =
        '00000000-0000-4000-8000-000000000001'::uuid
  ) = 1,
  'redemption creates exactly one active owner and advances owner activation plus provisioning exactly once'
);

SELECT extensions.ok(
  (
    SELECT count(*)
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND domain.is_primary
      AND domain.hostname = 'owner-onboarding.creatorshare.com'
      AND domain.status = 'provisioning'
  ) = 1
  AND (
    SELECT count(*)
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND integration.is_required
  ) = 5
  AND (
    SELECT count(*)
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND job.kind = 'provision'
      AND job.status = 'queued'
  ) = 5,
  'initial-owner redemption installs one hostname, five required integrations, and five ordered initial jobs'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_portal_provisioning_starts start
    WHERE start.advocate_id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND start.initiator_kind = 'initial_owner_acceptance'
      AND start.initiating_user_id =
        'a7300000-0000-4000-8000-000000000002'::uuid
      AND start.initial_owner_invitation_id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'second_reissue'
      )
      AND start.expected_advocate_version = 5
      AND start.resulting_advocate_version = 6
  )
  AND EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    JOIN public.advocate_invitation_email_outbox outbox
      ON outbox.invitation_id = invitation.id
    WHERE invitation.id = (
        SELECT uuid_value
        FROM onboarding_test_context
        WHERE key = 'second_reissue'
      )
      AND invitation.accepted_by_user_id =
        'a7300000-0000-4000-8000-000000000002'::uuid
      AND outbox.contact_redacted_at IS NOT NULL
      AND outbox.recipient_email_ciphertext IS NULL
      AND outbox.secret_payload_ciphertext IS NULL
  ),
  'provisioning evidence binds the accepted reissue and terminal redemption redacts all delivery material'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND event.event_key = 'portal.created'
  ),
  1,
  'email-first onboarding produces one privacy-safe portal creation event without duplication'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND event.event_key = 'domain.provisioning.requested'
  ),
  1,
  'initial-owner activation produces one privacy-safe provisioning event without provider detail'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND event.event_key = 'team.invitation.accepted'
  ),
  1,
  'redemption restores invitation acceptance audit context after shared topology creation'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND event.event_key = 'team.invitation.issued'
  ),
  1,
  'initial-owner replacement emits one privacy-safe invitation-issued event per transaction without contact data'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = (
      SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
    )
      AND event.event_key = 'team.invitation.revoked'
  ),
  1,
  'explicit initial-owner revocation emits one privacy-safe revocation event without delivery detail'
);

SELECT pg_temp.set_onboarding_claims(
  'a7300000-0000-4000-8000-000000000001'::uuid
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.get_creator_share_advocate_control_snapshot(
      (SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate')
    ) snapshot
    WHERE snapshot.ownership_status = 'owner_active'
      AND snapshot.owner_display_name = 'Olive O.'
      AND NOT snapshot.can_reissue_initial_owner
      AND NOT snapshot.can_revoke_initial_owner
  )
  AND EXISTS (
    SELECT 1
    FROM public.list_creator_share_advocate_controls() tenant
    WHERE tenant.advocate_id = (
        SELECT uuid_value FROM onboarding_test_context WHERE key = 'advocate'
      )
      AND tenant.ownership_status = 'owner_active'
      AND tenant.owner_display_name = 'Olive O.'
      AND NOT tenant.can_reissue_initial_owner
      AND NOT tenant.can_revoke_initial_owner
  ),
  'activated list and detail projections expose only the privacy-safe owner name and no recovery action'
);

SELECT extensions.finish();

ROLLBACK;

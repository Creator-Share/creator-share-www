BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'advocate_invitation_email_outbox'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'advocate_invitation_email_outbox'
  )
  AND NOT has_table_privilege(
    'anon',
    'public.advocate_invitation_email_outbox',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_invitation_email_outbox',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_invitation_email_outbox',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'the dedicated invitation outbox is forced-RLS default deny for every API role'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'public.advocate_invitations',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_invitations',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_invitation_roles',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_invitation_roles',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'invitation facts and role sets have no direct API table surface'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.create_advocate_invitation(uuid,text,text[],interval)'
  ) IS NULL
  AND to_regprocedure('public.redeem_advocate_invitation(text)') IS NULL
  AND to_regprocedure(
    'public.claim_advocate_invitation_email_jobs(text,integer,text,text)'
  ) IS NULL,
  'plaintext-returning issuance, weak redemption, and the legacy claim signature are removed'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    )
    FROM pg_proc function_definition
    WHERE function_definition.oid = ANY (ARRAY[
      'public.issue_advocate_invitation_email(uuid,uuid,text,text[],text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)'::regprocedure,
      'public.claim_advocate_invitation_email_jobs(text,smallint,integer,text,text)'::regprocedure,
      'public.bind_advocate_invitation_email_target(uuid,text,uuid,bytea,bytea,text,text)'::regprocedure,
      'public.begin_advocate_invitation_email_delivery(uuid,text,bytea,bytea,text,text)'::regprocedure,
      'public.fail_advocate_invitation_email_delivery(uuid,text,text,integer,text,text)'::regprocedure,
      'public.settle_advocate_invitation_email_delivery(uuid,text,text,text,text,integer,text,text)'::regprocedure,
      'public.revoke_advocate_invitation(uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure,
      'public.redeem_advocate_invitation(text,text,text,text,text,text,text,uuid)'::regprocedure,
      'public.recover_advocate_invitation_redemption(uuid)'::regprocedure,
      'public.get_advocate_pending_invitations(uuid)'::regprocedure
    ])
  ),
  'every invitation RPC is a fixed-search-path security definer boundary'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.issue_advocate_invitation_email(uuid,uuid,text,text[],text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.claim_advocate_invitation_email_jobs(text,smallint,integer,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.revoke_advocate_invitation(uuid,uuid,uuid,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.issue_advocate_invitation_email(uuid,uuid,text,text[],text,bytea,bytea,bytea,bytea,smallint,smallint,smallint,text,text,text,text,text,text)',
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
  AND has_function_privilege(
    'authenticated',
    'public.get_advocate_pending_invitations(uuid)',
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
  ),
  'service and authenticated invitation capabilities are separated exactly by purpose'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name IN (
        'advocate_invitations',
        'advocate_invitation_email_outbox'
      )
      AND column_definition.column_name = ANY (ARRAY[
        'plaintext_token',
        'plaintext_capability',
        'capability',
        'lease_token'
      ]::text[])
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'advocate_invitations'
      AND column_definition.column_name = 'token_digest'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'advocate_invitation_email_outbox'
      AND column_definition.column_name = 'secret_payload_ciphertext'
  ),
  'relational storage keeps only capability digests and versioned ciphertext, never plaintext secrets'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.claim_advocate_invitation_email_jobs(text,smallint,integer,text,text)'::regprocedure
  ) LIKE '%FOR UPDATE OF outbox SKIP LOCKED%'
  AND pg_get_functiondef(
    'public.claim_advocate_invitation_email_jobs(text,smallint,integer,text,text)'::regprocedure
  ) LIKE '%gen_random_bytes(32)%'
  AND pg_get_functiondef(
    'public.claim_advocate_invitation_email_jobs(text,smallint,integer,text,text)'::regprocedure
  ) LIKE '%delivery_started_at IS NULL%'
  AND EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'public'
      AND index_definition.indexname =
        'advocate_invitation_email_outbox_ambiguous_idx'
      AND index_definition.indexdef LIKE '%delivery_started_at IS NOT NULL%'
  ),
  'claims use skip-locked 256-bit leases and never reclaim ambiguous provider handoffs'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_advocate_pending_invitations(uuid)'::regprocedure
  ),
  ARRAY[
    'target_advocate_id',
    'invitation_id',
    'invited_email',
    'role_keys',
    'invitation_status',
    'expires_at',
    'created_at',
    'created_by_current_user'
  ]::text[],
  'the pending invitation projection contains only the approved operational fields'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.get_advocate_audit_history_page(uuid,uuid,integer)'::regprocedure
  ) NOT LIKE '%advocate_invitation_email_outbox%'
  AND to_regprocedure(
    'public.get_advocate_audit_events(uuid,bigint,integer)'
  ) IS NULL,
  'portal audit history excludes invitation delivery internals'
);

CREATE TEMP TABLE invitation_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE invitation_claim (
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
    '95000000-0000-4000-8000-000000000101'::uuid,
    'authenticated',
    'authenticated',
    'invitation-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Iris","last_name":"Owner"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '95000000-0000-4000-8000-000000000102'::uuid,
    'authenticated',
    'authenticated',
    'invitation-target@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Tess","last_name":"Target"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '95000000-0000-4000-8000-000000000103'::uuid,
    'authenticated',
    'authenticated',
    'invitation-second@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Sid","last_name":"Second"}'::jsonb,
    now(),
    now(),
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
    '95000000-0000-4000-8000-000000000902'::uuid,
    '95000000-0000-4000-8000-000000000102'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '95000000-0000-4000-8000-000000000903'::uuid,
    '95000000-0000-4000-8000-000000000103'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '95000000-0000-4000-8000-000000000904'::uuid,
    '95000000-0000-4000-8000-000000000102'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal2',
    clock_timestamp() + interval '1 hour'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

WITH created AS (
  SELECT public.create_advocate_portal(
    '95000000-0000-4000-8000-000000000101'::uuid,
    'invitation-tests',
    'Invitation Tests',
    'Create the secure invitation fixture',
    'creator',
    'request-invitation-fixture'
  ) AS id
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'advocate', id FROM created;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test_cutover$
BEGIN
  PERFORM public.arm_advocate_invitation_legacy_email_proof_quarantine(
    '95000000-0000-4000-8000-000000000801'::uuid,
    'invitation-delivery-test-arm'
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
    '95000000-0000-4000-8000-000000000802'::uuid,
    'invitation-delivery-test-quarantine'
  );
END;
$test_cutover$;

WITH issued AS (
  SELECT *
  FROM public.issue_advocate_invitation_email(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000101'::uuid,
    ' Invitation-Target@Example.Test ',
    ARRAY['brand_editor', 'analytics_viewer'],
    'invitation-request-0001',
    extensions.digest(repeat('a', 64), 'sha256'),
    decode(repeat('11', 64), 'hex'),
    extensions.digest('invitation-target@example.test', 'sha256'),
    decode(repeat('22', 96), 'hex'),
    1::smallint,
    1::smallint,
    1::smallint,
    'Invite the first delegate',
    'request-invitation-issue',
    'trace-invitation-issue',
    'session-invitation-issue',
    '192.0.2.10',
    'invitation-test-agent'
  )
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'invitation_a', invitation_id FROM issued
UNION ALL
SELECT 'outbox_a', outbox_id FROM issued;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    WHERE invitation.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
      )
      AND invitation.email = 'invitation-target@example.test'
      AND invitation.target_auth_user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND invitation.token_digest =
        extensions.digest(repeat('a', 64), 'sha256')
      AND invitation.expires_at = invitation.created_at + interval '7 days'
      AND invitation.last_sent_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'outbox_a'
      )
      AND outbox.invitation_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
      )
      AND outbox.status = 'pending'
      AND outbox.max_attempts = 8
      AND outbox.provider_idempotency_key =
        'advocate-invitation:' || outbox.id::text
  ),
  'issuance atomically stores a normalized bound invitation and its dedicated encrypted delivery job'
);

SELECT extensions.is(
  (
    SELECT array_agg(role_definition.key ORDER BY role_definition.key)
    FROM public.advocate_invitation_roles invitation_role
    JOIN public.advocate_roles role_definition
      ON role_definition.id = invitation_role.role_id
    WHERE invitation_role.invitation_id = (
      SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
    )
  ),
  ARRAY['analytics_viewer', 'brand_editor']::text[],
  'issuance persists exactly the sorted predefined nonowner role set'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'advocate'
      )
      AND event.request_id = 'request-invitation-issue'
      AND event.trace_id = 'trace-invitation-issue'
      AND event.session_id = 'session-invitation-issue'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        '95000000-0000-4000-8000-000000000101'::uuid
      AND event.effective_user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND event.tool = 'advocate-portal-team'
      AND event.reason = 'Invite the first delegate'
      AND event.metadata ->> 'operation' = 'issue_invitation'
  ),
  'invitation issuance records complete user, request, forensic, and tenant audit context'
);

SELECT extensions.is(
  (
    SELECT invitation_id
    FROM public.issue_advocate_invitation_email(
      (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
      '95000000-0000-4000-8000-000000000101'::uuid,
      'invitation-target@example.test',
      ARRAY['analytics_viewer', 'brand_editor'],
      'invitation-request-0001',
      extensions.digest(repeat('b', 64), 'sha256'),
      decode(repeat('33', 64), 'hex'),
      extensions.digest('invitation-target@example.test', 'sha256'),
      decode(repeat('44', 96), 'hex'),
      1::smallint,
      1::smallint,
      1::smallint,
      'Invite the first delegate'
    )
  ),
  (SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'),
  'an idempotent retry with regenerated capability and ciphertext returns the original invitation'
);

SELECT extensions.is(
  (
    SELECT created
    FROM public.issue_advocate_invitation_email(
      (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
      '95000000-0000-4000-8000-000000000101'::uuid,
      'invitation-target@example.test',
      ARRAY['analytics_viewer', 'brand_editor'],
      'invitation-request-0001',
      extensions.digest(repeat('c', 64), 'sha256'),
      decode(repeat('55', 64), 'hex'),
      extensions.digest('invitation-target@example.test', 'sha256'),
      decode(repeat('66', 96), 'hex'),
      1::smallint,
      1::smallint,
      1::smallint,
      'Invite the first delegate'
    )
  ),
  false,
  'an idempotent retry reports that no duplicate row was created'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM public.advocate_invitations invitation
    WHERE invitation.advocate_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'advocate'
      )
      AND invitation.issuance_idempotency_key = 'invitation-request-0001'
  )
  AND (
    SELECT count(*) = 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.invitation_id = (
      SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
    )
  ),
  'regenerated retry material cannot create a second invitation or outbox row'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.issue_advocate_invitation_email(%L::uuid,%L::uuid,%L,ARRAY[''audit_viewer''],%L,decode(%L,''hex''),decode(%L,''hex''),decode(%L,''hex''),decode(%L,''hex''),1::smallint,1::smallint,1::smallint,%L)',
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000101',
    'invitation-target@example.test',
    'invitation-request-0001',
    repeat('aa', 32),
    repeat('11', 64),
    repeat('bb', 32),
    repeat('22', 96),
    'Change an idempotent invitation request'
  ),
  '23505',
  'Invitation idempotency key was reused with different material',
  'an idempotency key cannot authorize different recipient, role, or cryptographic material'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.issue_advocate_invitation_email(%L::uuid,%L::uuid,%L,ARRAY[''owner''],%L,decode(%L,''hex''),decode(%L,''hex''),decode(%L,''hex''),decode(%L,''hex''),1::smallint,1::smallint,1::smallint,%L)',
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000101',
    'owner-smuggle@example.test',
    'invitation-request-owner',
    repeat('cc', 32),
    repeat('11', 64),
    repeat('dd', 32),
    repeat('22', 96),
    'Attempt to invite an owner'
  ),
  '22023',
  'Invitation contains an invalid or non-invitable role',
  'owner can never be granted through invitation issuance'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.is(
  (
    SELECT invited_email
    FROM public.get_advocate_pending_invitations(
      (SELECT value FROM invitation_test_ids WHERE key = 'advocate')
    )
    WHERE invitation_id = (
      SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
    )
  ),
  'invitation-target@example.test',
  'authorized team managers can identify a pending normalized delegate recipient after reload'
);

SELECT extensions.is(
  (
    SELECT role_keys
    FROM public.get_advocate_pending_invitations(
      (SELECT value FROM invitation_test_ids WHERE key = 'advocate')
    )
    WHERE invitation_id = (
      SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
    )
  ),
  ARRAY['analytics_viewer', 'brand_editor']::text[],
  'the pending projection exposes only the exact predefined role set needed for team operations'
);

UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 day'
WHERE id = '95000000-0000-4000-8000-000000000101'::uuid;

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.get_advocate_pending_invitations(%L::uuid)',
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate')
  ),
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned administrator cannot enumerate pending delegate contact details with a retained token'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.get_advocate_audit_history_page(%L::uuid)',
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate')
  ),
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned administrator cannot enumerate tenant audit records with a retained token'
);

UPDATE auth.users
SET banned_until = NULL
WHERE id = '95000000-0000-4000-8000-000000000101'::uuid;

SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000102',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.get_advocate_pending_invitations(%L::uuid)',
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate')
  ),
  '42501',
  'Insufficient portal member permission',
  'an invited nonmember cannot enumerate pending team contacts'
);

SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO invitation_claim
SELECT *
FROM public.claim_advocate_invitation_email_jobs(
  'invitation-email-test-worker',
  1::smallint,
  10,
  'request-invitation-claim',
  'trace-invitation-claim'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM invitation_claim claim
    WHERE claim.outbox_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'outbox_a'
      )
      AND claim.invitation_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
      )
      AND claim.lease_token ~ '^[0-9a-f]{64}$'
      AND claim.lease_expires_at = (
        SELECT outbox.locked_at + interval '5 minutes'
        FROM public.advocate_invitation_email_outbox outbox
        WHERE outbox.id = claim.outbox_id
      )
      AND claim.target_auth_user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND claim.capability_digest =
        extensions.digest(repeat('a', 64), 'sha256')
      AND claim.attempt_count = 1
  ),
  'claim returns one exact encrypted job, proof digests, bound user, and a one-time 256-bit lease'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.claim_advocate_invitation_email_jobs(
      'invitation-email-second-worker',
      1::smallint,
      10
    )
  ),
  0,
  'an active invitation lease cannot be claimed concurrently'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.bind_advocate_invitation_email_target(%L::uuid,%L,%L::uuid,decode(%L,''hex''),decode(%L,''hex''))',
    (SELECT outbox_id FROM invitation_claim LIMIT 1),
    (SELECT lease_token FROM invitation_claim LIMIT 1),
    '95000000-0000-4000-8000-000000000102',
    encode(
      extensions.digest('invitation-target@example.test', 'sha256'),
      'hex'
    ),
    repeat('ff', 32)
  ),
  '42501',
  'Invitation target-binding proof does not match the active lease',
  'target binding rejects a decrypted capability that does not match the invitation digest'
);

SELECT extensions.is(
  public.bind_advocate_invitation_email_target(
    (SELECT outbox_id FROM invitation_claim LIMIT 1),
    (SELECT lease_token FROM invitation_claim LIMIT 1),
    '95000000-0000-4000-8000-000000000102'::uuid,
    extensions.digest('invitation-target@example.test', 'sha256'),
    extensions.digest(repeat('a', 64), 'sha256'),
    'request-invitation-bind',
    'trace-invitation-bind'
  ),
  true,
  'verified material can confirm an already exact target binding without changing it'
);

SELECT extensions.is(
  public.begin_advocate_invitation_email_delivery(
    (SELECT outbox_id FROM invitation_claim LIMIT 1),
    (SELECT lease_token FROM invitation_claim LIMIT 1),
    extensions.digest('invitation-target@example.test', 'sha256'),
    extensions.digest(repeat('a', 64), 'sha256'),
    'request-invitation-begin',
    'trace-invitation-begin'
  ),
  'advocate-invitation:' ||
    (SELECT outbox_id::text FROM invitation_claim LIMIT 1),
  'the final delivery fence returns the durable provider idempotency key only after exact proof checks'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.settle_advocate_invitation_email_delivery(
      (SELECT outbox_id FROM invitation_claim LIMIT 1),
      (SELECT lease_token FROM invitation_claim LIMIT 1),
      'sent',
      'provider-invitation-message-1',
      NULL,
      300,
      'request-invitation-settle',
      'trace-invitation-settle'
    )
  ),
  'sent'::public.email_outbox_status,
  'a verified provider handoff settles exactly once as sent'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
    WHERE outbox.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'outbox_a'
      )
      AND outbox.status = 'sent'
      AND outbox.provider_message_id = 'provider-invitation-message-1'
      AND invitation.last_sent_at = outbox.sent_at
  ),
  'delivery settlement records provider evidence and the invitation send timestamp atomically'
);

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000102',
  true
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '95000000-0000-4000-8000-000000000102',
    'role', 'authenticated',
    'iat', extract(epoch FROM clock_timestamp())::bigint,
    'aal', 'aal1',
    'session_id', '95000000-0000-4000-8000-000000000902',
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'otp',
        'timestamp', extract(epoch FROM clock_timestamp())::bigint
      )
    )
  )::text,
  true
);
SELECT set_config(
  'request.headers',
  jsonb_build_object(
    'x-forwarded-for', '198.51.100.44',
    'user-agent', 'trusted-invitation-gateway-test-agent'
  )::text,
  true
);

WITH redeemed AS (
  SELECT *
  FROM public.redeem_advocate_invitation(
    plaintext_capability => repeat('a', 64),
    change_reason => 'Accept the first delegate invitation',
    request_id => '95100000-0000-4000-8000-000000000801',
    trace_id => 'trace-invitation-redeem',
    session_id => 'session-invitation-redeem',
    client_ip => '192.0.2.11',
    user_agent => 'invitation-redemption-test-agent',
    redemption_operation_id =>
      '95100000-0000-4000-8000-000000000801'::uuid
  )
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'membership_a', membership_id FROM redeemed;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'membership_a'
      )
      AND membership.advocate_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'advocate'
      )
      AND membership.user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND membership.status = 'active'
      AND membership.version = 2
  )
  AND EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    WHERE invitation.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
      )
      AND invitation.accepted_by_user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND invitation.accepted_at IS NOT NULL
      AND invitation.revoked_at IS NULL
  ),
  'fresh exact-email redemption atomically creates an active membership and consumes the invitation once'
);

SELECT extensions.is(
  (
    SELECT membership_id
    FROM public.redeem_advocate_invitation(
      plaintext_capability => repeat('a', 64),
      change_reason => 'Accept the first delegate invitation',
      request_id => '95100000-0000-4000-8000-000000000801',
      trace_id => 'trace-invitation-redeem-replay',
      redemption_operation_id =>
        '95100000-0000-4000-8000-000000000801'::uuid
    )
  ),
  (SELECT value FROM invitation_test_ids WHERE key = 'membership_a'),
  'an exact delegate operation replay returns the immutable committed membership'
);

SELECT extensions.is(
  (
    SELECT membership_id
    FROM public.recover_advocate_invitation_redemption(
      '95100000-0000-4000-8000-000000000801'::uuid
    )
  ),
  (SELECT value FROM invitation_test_ids WHERE key = 'membership_a'),
  'delegate recovery needs no capability after the exact authenticated commit'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
    WHERE receipt.operation_id =
        '95100000-0000-4000-8000-000000000801'::uuid
      AND receipt.invitation_kind = 'delegate'
      AND receipt.initiating_user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND receipt.invitation_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'invitation_a'
      )
      AND receipt.membership_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'membership_a'
      )
      AND receipt.provisioning_request_id IS NULL
      AND receipt.resulting_advocate_version IS NULL
  ),
  'delegate receipts retain only the contact-free committed operation anchors'
);

SELECT extensions.is(
  (
    SELECT array_agg(role_definition.key ORDER BY role_definition.key)
    FROM public.advocate_membership_roles membership_role
    JOIN public.advocate_roles role_definition
      ON role_definition.id = membership_role.role_id
    WHERE membership_role.membership_id = (
      SELECT value FROM invitation_test_ids WHERE key = 'membership_a'
    )
  ),
  ARRAY['analytics_viewer', 'brand_editor']::text[],
  'redemption grants the complete immutable invitation role set and no owner role'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'outbox_a'
      )
      AND outbox.status = 'sent'
      AND outbox.contact_redacted_at IS NOT NULL
      AND outbox.recipient_email_ciphertext IS NULL
      AND outbox.recipient_email_hmac IS NULL
      AND outbox.secret_payload_ciphertext IS NULL
  ),
  'redemption redacts retryable contact and capability ciphertext while retaining sent delivery evidence'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  (
    SELECT created
    FROM public.issue_advocate_invitation_email(
      (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
      '95000000-0000-4000-8000-000000000101'::uuid,
      'invitation-target@example.test',
      ARRAY['analytics_viewer', 'brand_editor'],
      'invitation-request-0001',
      extensions.digest(repeat('2', 64), 'sha256'),
      decode(repeat('67', 64), 'hex'),
      extensions.digest('invitation-target@example.test', 'sha256'),
      decode(repeat('68', 96), 'hex'),
      1::smallint,
      1::smallint,
      1::smallint,
      'Invite the first delegate'
    )
  ),
  false,
  'an exact lost-response retry remains idempotent after the original invitation has been accepted'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      repeat('a', 64),
      'Attempt to reuse a consumed invitation'
    )
  $$,
  '42501',
  'Invitation is invalid or unavailable',
  'a consumed invitation capability can never be redeemed twice'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensic
      ON forensic.audit_event_id = event.id
    WHERE event.advocate_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'advocate'
      )
      AND event.request_id = '95100000-0000-4000-8000-000000000801'
      AND event.trace_id = 'trace-invitation-redeem'
      AND event.session_id = '95000000-0000-4000-8000-000000000902'
      AND forensic.client_ip = '198.51.100.44'
      AND forensic.user_agent = 'trusted-invitation-gateway-test-agent'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND event.effective_user_id =
        '95000000-0000-4000-8000-000000000102'::uuid
      AND event.tool = 'advocate-invitation-acceptance'
      AND event.reason = 'Accept the first delegate invitation'
      AND event.metadata ->> 'operation' = 'redeem_invitation'
  ),
  'redemption ignores caller supplied forensics and records the signed session plus request gateway evidence'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.headers', '{}', true);

WITH issued AS (
  SELECT *
  FROM public.issue_advocate_invitation_email(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000101'::uuid,
    'invitation-second@example.test',
    ARRAY['audit_viewer'],
    'invitation-request-0002',
    extensions.digest(repeat('d', 64), 'sha256'),
    decode(repeat('71', 64), 'hex'),
    extensions.digest('invitation-second@example.test', 'sha256'),
    decode(repeat('72', 96), 'hex'),
    1::smallint,
    1::smallint,
    1::smallint,
    'Invite a second delegate for revocation coverage'
  )
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'invitation_b', invitation_id FROM issued
UNION ALL
SELECT 'outbox_b', outbox_id FROM issued;

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000103',
  true
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '95000000-0000-4000-8000-000000000103',
    'role', 'authenticated',
    'iat', extract(epoch FROM clock_timestamp())::bigint,
    'aal', 'aal1',
    'session_id', '95000000-0000-4000-8000-000000000903',
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'magiclink',
        'timestamp', extract(epoch FROM clock_timestamp())::bigint
      )
    )
  )::text,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_delegate_invitation_legacy(
      repeat('d', 64),
      'Attempt direct delegate redemption with a non-provider AMR label'
    )
  $$,
  '42501',
  'Fresh email authentication is required to accept an invitation',
  'the internal delegate implementation rejects a fresh magiclink label because Supabase emits otp in the verified session AMR'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      repeat('d', 64),
      'Attempt redemption with a non-provider AMR label'
    )
  $$,
  '42501',
  'Fresh email authentication is required to accept an invitation',
  'delegate redemption rejects a fresh magiclink label because Supabase emits otp in the verified session AMR'
);

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000103',
  true
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '95000000-0000-4000-8000-000000000103',
    'role', 'authenticated',
    'iat', extract(epoch FROM clock_timestamp())::bigint,
    'aal', 'aal1',
    'session_id', '95000000-0000-4000-8000-000000000903',
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'token_refresh',
        'timestamp', extract(epoch FROM clock_timestamp())::bigint
      )
    )
  )::text,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      repeat('d', 64),
      'Attempt redemption after a token refresh'
    )
  $$,
  '42501',
  'Fresh email authentication is required to accept an invitation',
  'a new JWT minted by token refresh is not fresh email authentication'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '95000000-0000-4000-8000-000000000103',
    'role', 'authenticated',
    'iat', extract(epoch FROM clock_timestamp())::bigint,
    'aal', 'aal1',
    'session_id', '95000000-0000-4000-8000-000000000903',
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'otp',
        'timestamp', extract(epoch FROM clock_timestamp())::bigint - 901
      )
    )
  )::text,
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.redeem_advocate_invitation(
      repeat('d', 64),
      'Attempt redemption with stale authentication'
    )
  $$,
  '42501',
  'Fresh email authentication is required to accept an invitation',
  'a verified account still requires a freshly issued authenticated session for redemption'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);

SELECT extensions.is(
  public.revoke_advocate_invitation(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    (SELECT value FROM invitation_test_ids WHERE key = 'invitation_b'),
    '95000000-0000-4000-8000-000000000101'::uuid,
    'Withdraw the second delegate invitation',
    'request-invitation-revoke',
    'trace-invitation-revoke',
    'session-invitation-revoke',
    '192.0.2.12',
    'invitation-revocation-test-agent'
  ),
  true,
  'an authorized team manager can revoke one pending invitation through the service boundary'
);

SELECT extensions.is(
  public.revoke_advocate_invitation(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    (SELECT value FROM invitation_test_ids WHERE key = 'invitation_b'),
    '95000000-0000-4000-8000-000000000101'::uuid,
    'Retry withdrawal of the second delegate invitation'
  ),
  false,
  'invitation revocation is idempotent after the first successful transition'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    JOIN public.advocate_invitation_email_outbox outbox
      ON outbox.invitation_id = invitation.id
    WHERE invitation.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'invitation_b'
      )
      AND invitation.revoked_by_user_id =
        '95000000-0000-4000-8000-000000000101'::uuid
      AND invitation.revoked_at IS NOT NULL
      AND invitation.accepted_at IS NULL
      AND outbox.status = 'cancelled'
      AND outbox.contact_redacted_at IS NOT NULL
      AND outbox.recipient_email_ciphertext IS NULL
      AND outbox.secret_payload_ciphertext IS NULL
  ),
  'revocation consumes the invitation and redacts its encrypted recipient and capability material'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.get_advocate_pending_invitations(
      (SELECT value FROM invitation_test_ids WHERE key = 'advocate')
    )
  ),
  0,
  'accepted and revoked invitations disappear from the pending team projection'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'advocate'
      )
      AND event.request_id = 'request-invitation-revoke'
      AND event.actor_user_id =
        '95000000-0000-4000-8000-000000000101'::uuid
      AND event.effective_user_id =
        '95000000-0000-4000-8000-000000000103'::uuid
      AND event.reason = 'Withdraw the second delegate invitation'
      AND event.metadata ->> 'operation' = 'revoke_invitation'
  ),
  'revocation preserves complete manager and target audit provenance without exposing contact material'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = 'request-invitation-issue'
      AND disclosed.event_key = 'team.invitation.issued'
      AND disclosed.areas = ARRAY['invitation']::text[]
      AND disclosed.actor_kind = 'portal_member'
      AND disclosed.actor_display_name = 'Iris O.'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  )
  AND EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = '95100000-0000-4000-8000-000000000801'
      AND disclosed.event_key = 'team.invitation.accepted'
      AND disclosed.areas = ARRAY['invitation']::text[]
      AND disclosed.actor_kind = 'portal_member'
      AND disclosed.actor_display_name = 'Tess T.'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  )
  AND EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = 'request-invitation-revoke'
      AND disclosed.event_key = 'team.invitation.revoked'
      AND disclosed.areas = ARRAY['invitation']::text[]
      AND disclosed.actor_kind = 'portal_member'
      AND disclosed.actor_display_name = 'Iris O.'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  ),
  'real invitation issue, redemption, and revocation commands emit exact privacy-safe team events'
);

WITH issued AS (
  SELECT *
  FROM public.issue_advocate_invitation_email(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000101'::uuid,
    'delivery-retry@example.test',
    ARRAY['analytics_viewer'],
    'invitation-request-0003',
    extensions.digest(repeat('e', 64), 'sha256'),
    decode(repeat('81', 64), 'hex'),
    extensions.digest('delivery-retry@example.test', 'sha256'),
    decode(repeat('82', 96), 'hex'),
    1::smallint,
    1::smallint,
    1::smallint,
    'Exercise invitation delivery retry behavior'
  )
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'invitation_c', invitation_id FROM issued
UNION ALL
SELECT 'outbox_c', outbox_id FROM issued;

DELETE FROM invitation_claim;
INSERT INTO invitation_claim
SELECT *
FROM public.claim_advocate_invitation_email_jobs(
  'invitation-email-failure-worker',
  1::smallint,
  10
);

SELECT extensions.is(
  public.fail_advocate_invitation_email_delivery(
    (SELECT value FROM invitation_test_ids WHERE key = 'outbox_c'),
    (
      SELECT lease_token
      FROM invitation_claim
      WHERE outbox_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'outbox_c'
      )
    ),
    'email_provider_unavailable',
    60,
    'request-invitation-fail',
    'trace-invitation-fail'
  ),
  true,
  'a sanitized failure before provider handoff schedules a bounded retry'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'outbox_c'
      )
      AND outbox.status = 'failed'
      AND outbox.attempt_count = 1
      AND outbox.last_error_code = 'email_provider_unavailable'
      AND outbox.available_at > clock_timestamp()
      AND outbox.locked_at IS NULL
      AND outbox.locked_lease_token_digest IS NULL
  ),
  'retryable failures release their lease and persist only an allowlisted error code'
);

WITH issued AS (
  SELECT *
  FROM public.issue_advocate_invitation_email(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000101'::uuid,
    'delivery-terminal@example.test',
    ARRAY['analytics_viewer'],
    'invitation-request-0004',
    extensions.digest(repeat('f', 64), 'sha256'),
    decode(repeat('91', 64), 'hex'),
    extensions.digest('delivery-terminal@example.test', 'sha256'),
    decode(repeat('92', 96), 'hex'),
    1::smallint,
    1::smallint,
    1::smallint,
    'Exercise invalid invitation envelope handling'
  )
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'invitation_d', invitation_id FROM issued
UNION ALL
SELECT 'outbox_d', outbox_id FROM issued;

DELETE FROM invitation_claim;
INSERT INTO invitation_claim
SELECT *
FROM public.claim_advocate_invitation_email_jobs(
  'invitation-email-terminal-worker',
  1::smallint,
  10
);

SELECT extensions.is(
  public.fail_advocate_invitation_email_delivery(
    (SELECT value FROM invitation_test_ids WHERE key = 'outbox_d'),
    (
      SELECT lease_token
      FROM invitation_claim
      WHERE outbox_id = (
        SELECT value FROM invitation_test_ids WHERE key = 'outbox_d'
      )
    ),
    'invitation_email_material_invalid',
    60
  ),
  false,
  'invalid sealed invitation material is terminal rather than retried'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.claim_advocate_invitation_email_jobs(
      'invitation-email-after-failure-worker',
      1::smallint,
      10
    )
  ),
  0,
  'backoff and terminal deadlines prevent immediate hot-loop claims'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.is(
  public.change_advocate_member_status(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    (SELECT value FROM invitation_test_ids WHERE key = 'membership_a'),
    (
      SELECT membership.version
      FROM public.advocate_memberships membership
      WHERE membership.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'membership_a'
      )
    ),
    'revoked',
    'Revoke the first delegate before fresh reinvitation'
  ),
  3::bigint,
  'delegate administration revokes the existing membership before reinvitation'
);

SELECT set_config('request.jwt.claim.sub', '', true);

WITH issued AS (
  SELECT *
  FROM public.issue_advocate_invitation_email(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000101'::uuid,
    'invitation-target@example.test',
    ARRAY['catalog_curator'],
    'invitation-request-0005',
    extensions.digest(repeat('1', 64), 'sha256'),
    decode(repeat('a1', 64), 'hex'),
    extensions.digest('invitation-target@example.test', 'sha256'),
    decode(repeat('a2', 96), 'hex'),
    1::smallint,
    1::smallint,
    1::smallint,
    'Reinvite a previously revoked delegate'
  )
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'invitation_e', invitation_id FROM issued
UNION ALL
SELECT 'outbox_e', outbox_id FROM issued;

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000102',
  true
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '95000000-0000-4000-8000-000000000102',
    'role', 'authenticated',
    'iat', extract(epoch FROM clock_timestamp())::bigint,
    'aal', 'aal2',
    'session_id', '95000000-0000-4000-8000-000000000904',
    'amr', jsonb_build_array(
      jsonb_build_object(
        'method', 'otp',
        'timestamp', extract(epoch FROM clock_timestamp())::bigint
      )
    )
  )::text,
  true
);

SELECT extensions.is(
  (
    SELECT membership_id
    FROM public.redeem_advocate_invitation(
      repeat('1', 64),
      'Accept a fresh invitation after revocation'
    )
  ),
  (SELECT value FROM invitation_test_ids WHERE key = 'membership_a'),
  'fresh invitation redemption reactivates the original revoked membership instead of violating uniqueness'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'membership_a'
      )
      AND membership.status = 'active'
      AND membership.version = 6
  )
  AND (
    SELECT array_agg(role_definition.key ORDER BY role_definition.key)
    FROM public.advocate_membership_roles membership_role
    JOIN public.advocate_roles role_definition
      ON role_definition.id = membership_role.role_id
    WHERE membership_role.membership_id = (
      SELECT value FROM invitation_test_ids WHERE key = 'membership_a'
    )
  ) = ARRAY['catalog_curator']::text[],
  'revoked-member redemption clears obsolete roles, installs the fresh exact role set, and advances lifecycle versions'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.is(
  public.replace_advocate_member_roles(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    (SELECT value FROM invitation_test_ids WHERE key = 'membership_a'),
    6,
    ARRAY['administrator'],
    'Permit the delegate to issue an invitation for cancellation coverage'
  ),
  8::bigint,
  'the reactivated delegate can receive the predefined administrator role through ordinary versioned management'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

WITH issued AS (
  SELECT *
  FROM public.issue_advocate_invitation_email(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    '95000000-0000-4000-8000-000000000102'::uuid,
    'issuer-cancelled@example.test',
    ARRAY['analytics_viewer'],
    'invitation-request-0006',
    extensions.digest(repeat('3', 64), 'sha256'),
    decode(repeat('b1', 64), 'hex'),
    extensions.digest('issuer-cancelled@example.test', 'sha256'),
    decode(repeat('b2', 96), 'hex'),
    1::smallint,
    1::smallint,
    1::smallint,
    'Issue an invitation before administrator suspension'
  )
)
INSERT INTO invitation_test_ids (key, value)
SELECT 'invitation_f', invitation_id FROM issued
UNION ALL
SELECT 'outbox_f', outbox_id FROM issued;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.is(
  public.change_advocate_member_status(
    (SELECT value FROM invitation_test_ids WHERE key = 'advocate'),
    (SELECT value FROM invitation_test_ids WHERE key = 'membership_a'),
    8,
    'suspended',
    'Suspend an invitation issuer and cancel their outstanding capabilities'
  ),
  9::bigint,
  'suspending an administrator revokes every outstanding invitation they issued'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    JOIN public.advocate_invitation_email_outbox outbox
      ON outbox.invitation_id = invitation.id
    WHERE invitation.id = (
        SELECT value FROM invitation_test_ids WHERE key = 'invitation_f'
      )
      AND invitation.revoked_at IS NOT NULL
      AND invitation.revoked_by_user_id =
        '95000000-0000-4000-8000-000000000101'::uuid
      AND outbox.status = 'cancelled'
      AND outbox.contact_redacted_at IS NOT NULL
      AND outbox.recipient_email_ciphertext IS NULL
      AND outbox.secret_payload_ciphertext IS NULL
  ),
  'issuer suspension atomically cancels and redacts its dedicated invitation email capability'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('app.advocate.invitation_operation', '', true);
SELECT set_config('app.advocate.invitation_email_operation', '', true);

SELECT extensions.throws_ok(
  format(
    'UPDATE public.advocate_invitations SET last_sent_at=clock_timestamp() WHERE id=%L::uuid',
    (SELECT value FROM invitation_test_ids WHERE key = 'invitation_e')
  ),
  '42501',
  'Advocate invitation lifecycle changes require a narrow operation',
  'even the database owner cannot mutate invitation lifecycle fields outside a named boundary'
);

SELECT extensions.throws_ok(
  format(
    'UPDATE public.advocate_invitation_email_outbox SET available_at=clock_timestamp() WHERE id=%L::uuid',
    (SELECT value FROM invitation_test_ids WHERE key = 'outbox_e')
  ),
  '42501',
  'Invitation email changes require a narrow worker operation',
  'delivery queue lifecycle fields cannot be edited directly'
);

SELECT * FROM extensions.finish();

ROLLBACK;

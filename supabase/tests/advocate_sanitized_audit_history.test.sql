BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.is(
  (SELECT count(*)::integer FROM audit.advocate_delegate_events),
  0,
  'the disclosure ledger has no historical audit backfill'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'audit'
      AND relation.relname = 'advocate_delegate_events'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'audit'
      AND policy.tablename = 'advocate_delegate_events'
  ),
  'the disclosure ledger is forced RLS with no direct policies'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'audit.advocate_delegate_events',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.advocate_delegate_events',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_delegate_events',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_sequence_privilege(
    'service_role',
    'audit.advocate_delegate_events_identity_sequence_seq',
    'USAGE'
  ),
  'no runtime role can read, write, truncate, or enumerate the disclosure ledger'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'audit.capture_advocate_delegate_event()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'audit.capture_advocate_delegate_event()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'audit.capture_advocate_delegate_event()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'audit.safe_advocate_delegate_actor_display(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'audit.json_object_has_exact_keys(jsonb,text[])',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'audit.prevent_advocate_delegate_event_mutation()',
    'EXECUTE'
  ),
  'runtime roles cannot invoke private disclosure helpers'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.get_advocate_audit_events(uuid,bigint,integer)'
  ) IS NULL
  AND (
    SELECT function_definition.prosecdef
      AND function_definition.provolatile = 's'
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
      AND pg_get_function_result(function_definition.oid) = 'jsonb'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_advocate_audit_history_page(uuid,uuid,integer)'::regprocedure
  ),
  'the unsafe reader is removed and the replacement is one stable fixed-path JSON boundary'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_advocate_audit_history_page(uuid,uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_advocate_audit_history_page(uuid,uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.get_advocate_audit_history_page(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'only authenticated portal sessions can invoke audit history'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_advocate_audit_history_page(uuid,uuid,integer)'::regprocedure
  ),
  ARRAY['target_advocate_id', 'before_cursor', 'page_size']::text[],
  'the history RPC has the exact tenant, opaque cursor, and fixed page inputs'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'audit'
      AND column_definition.table_name = 'advocate_delegate_events'
      AND column_definition.column_name = ANY (ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'request_id',
        'trace_id',
        'session_id',
        'provider_event_id',
        'record_pk',
        'client_ip',
        'user_agent'
      ]::text[])
  ),
  'the disclosure ledger has no free-form, actor identity, row-image, or provider-internal columns'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'audit'
      AND column_definition.table_name = 'advocate_delegate_events'
      AND column_definition.column_name = ANY (ARRAY[
        'source_transaction_id',
        'source_audit_sequence'
      ]::text[])
  ),
  2,
  'private source links are retained only inside the inaccessible disclosure ledger'
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
  updated_at
)
VALUES
  (
    'b5100000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'audit-owner-a@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Avery","last_name":"Stone"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'audit-owner-b@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Blair","last_name":"North"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'audit-malicious@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"secret@example.test<script>","last_name":"Injected"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'audit-staff@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Internal","last_name":"Operator"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'audit-nonmember@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Casey","last_name":"Outside"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'audit-reserved-staff@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Creator Share staff","last_name":"Person"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000007',
    'authenticated',
    'authenticated',
    'audit-reserved-automation@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Creator Share automation","last_name":"Person"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000008',
    'authenticated',
    'authenticated',
    'audit-twenty-three@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"abcdefghijklmnopqrstuvw","last_name":"Zulu"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    'b5100000-0000-4000-8000-000000000009',
    'authenticated',
    'authenticated',
    'audit-twenty-two@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"abcdefghijklmnopqrstuv","last_name":"Zulu"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status
)
VALUES
  (
    'a5100000-0000-4000-8000-000000000001',
    'audit-history-a',
    'Audit History A',
    'active',
    'draft'
  ),
  (
    'a5100000-0000-4000-8000-000000000002',
    'audit-history-b',
    'Audit History B',
    'active',
    'draft'
  );

INSERT INTO public.advocate_memberships (
  id,
  advocate_id,
  user_id,
  status
)
VALUES
  (
    'c5100000-0000-4000-8000-000000000001',
    'a5100000-0000-4000-8000-000000000001',
    'b5100000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    'c5100000-0000-4000-8000-000000000002',
    'a5100000-0000-4000-8000-000000000002',
    'b5100000-0000-4000-8000-000000000002',
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
    'a5100000-0000-4000-8000-000000000001',
    'c5100000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'b5100000-0000-4000-8000-000000000001'
  ),
  (
    'a5100000-0000-4000-8000-000000000002',
    'c5100000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'b5100000-0000-4000-8000-000000000002'
  );

UPDATE public.advocates advocate
SET owner_membership_id = CASE advocate.id
  WHEN 'a5100000-0000-4000-8000-000000000001'::uuid
    THEN 'c5100000-0000-4000-8000-000000000001'::uuid
  ELSE 'c5100000-0000-4000-8000-000000000002'::uuid
END
WHERE advocate.id IN (
  'a5100000-0000-4000-8000-000000000001',
  'a5100000-0000-4000-8000-000000000002'
);

/* Exact business command sources, including one duplicate row-audit fanout. */
INSERT INTO audit.audit_events (
  transaction_id,
  schema_name,
  table_name,
  operation,
  record_pk,
  advocate_id,
  actor_type,
  actor_user_id,
  system_actor,
  tool,
  database_role,
  session_user_name,
  reason,
  metadata
)
SELECT
  source.transaction_id,
  'public',
  source.table_name,
  source.operation,
  source.record_pk,
  source.advocate_id,
  source.actor_type,
  source.actor_user_id,
  source.system_actor,
  source.tool,
  'postgres',
  'postgres',
  source.reason,
  source.metadata
FROM (
  VALUES
    (
      510001::bigint,
      'advocates'::text,
      'INSERT'::audit.audit_operation,
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001'::uuid,
      'creator_share_admin'::audit.audit_actor_type,
      'b5100000-0000-4000-8000-000000000004'::uuid,
      NULL::text,
      'creator-share-admin-advocates'::text,
      'include:portal-created'::text,
      jsonb_build_object(
        'operation', 'create_portal',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001',
        'role_key', 'owner'
      )
    ),
    (
      510001,
      'advocates',
      'INSERT',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-advocates',
      'include:portal-created-fanout',
      jsonb_build_object(
        'operation', 'create_portal',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001',
        'role_key', 'owner'
      )
    ),
    (
      510002,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-advocate-lifecycle',
      'include:lifecycle',
      jsonb_build_object(
        'operation', 'suspend_advocate',
        'outcome', 'suspended/suspended',
        'prior_status', 'active/draft',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510003,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-advocates',
      'include:ownership',
      jsonb_build_object(
        'operation', 'transfer_ownership',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001',
        'role_key', 'owner'
      )
    ),
    (
      510004,
      'advocate_branding',
      'UPDATE',
      jsonb_build_object(
        'advocate_id', 'a5100000-0000-4000-8000-000000000001'
      ),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000003',
      NULL,
      'advocate-portal-branding',
      'include:secret@example.test<script>',
      jsonb_build_object(
        'operation', 'update_branding',
        'permission_key', 'portal.branding.update',
        'resource_kind', 'advocate_branding',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510005,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-beneficiaries',
      'include:catalog',
      jsonb_build_object(
        'operation', 'replace_beneficiaries',
        'permission_key', 'portal.beneficiaries.manage',
        'resource_kind', 'advocate_beneficiaries',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510006,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-public-metrics',
      'include:public-metrics',
      jsonb_build_object(
        'operation', 'replace_public_metrics',
        'permission_key', 'portal.public_metrics.update',
        'resource_kind', 'advocate_public_metric_selections',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510007,
      'advocate_invitations',
      'INSERT',
      jsonb_build_object('id', 'e5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-team',
      'include:invitation-issued',
      jsonb_build_object(
        'operation', 'issue_invitation',
        'outcome', 'queued',
        'resource_kind', 'advocate_invitation',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510008,
      'advocate_invitations',
      'UPDATE',
      jsonb_build_object('id', 'e5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-team',
      'include:invitation-revoked',
      jsonb_build_object(
        'operation', 'revoke_invitation',
        'outcome', 'revoked',
        'resource_kind', 'advocate_invitation',
        'resource_id', 'e5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510009,
      'advocate_invitations',
      'UPDATE',
      jsonb_build_object('id', 'e5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-invitation-acceptance',
      'include:invitation-accepted',
      jsonb_build_object(
        'operation', 'redeem_invitation',
        'outcome', 'accepted',
        'resource_kind', 'advocate_invitation',
        'resource_id', 'e5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510010,
      'advocate_memberships',
      'UPDATE',
      jsonb_build_object('id', 'c5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-team',
      'include:member-roles',
      jsonb_build_object(
        'operation', 'replace_member_roles',
        'permission_key', 'portal.members.manage',
        'resource_kind', 'advocate_membership',
        'resource_id', 'c5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510011,
      'advocate_memberships',
      'UPDATE',
      jsonb_build_object('id', 'c5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-team',
      'include:member-access',
      jsonb_build_object(
        'operation', 'change_member_status',
        'permission_key', 'portal.members.manage',
        'prior_status', 'active',
        'resource_kind', 'advocate_membership',
        'resource_id', 'c5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510012,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-domains',
      'include:provisioning',
      jsonb_build_object(
        'operation', 'start_provisioning',
        'correlation_id', 'audit-test-provisioning',
        'domain_hostname', 'audit-history-a.creatorshare.com',
        'outcome', 'queued',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510013,
      'advocate_domains',
      'UPDATE',
      jsonb_build_object('id', 'd5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-publication',
      'include:publication',
      jsonb_build_object(
        'operation', 'publish_portal_from_canary',
        'canary_completed_at', '2026-07-19T00:00:00.000000Z',
        'correlation_id', 'a5100000-0000-4000-8000-000000000099',
        'deployment_id', 'audit-deployment',
        'domain_hostname', 'audit-history-a.creatorshare.com',
        'evidence_sha256', repeat('a', 64),
        'publication_binding_sha256', repeat('b', 64),
        'resource_kind', 'advocate_domain',
        'resource_id', 'd5100000-0000-4000-8000-000000000001',
        'outcome', 'active'
      )
    ),
    (
      510014,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'system',
      NULL,
      'advocate-domain-worker-1',
      'domain-provisioning-reconcile',
      'include:needs-attention',
      jsonb_build_object(
        'operation', 'reconcile',
        'domain_hostname', 'audit-history-a.creatorshare.com',
        'job_id', 'f5100000-0000-4000-8000-000000000001',
        'resource_kind', 'domain_provisioning_job',
        'resource_id', 'f5100000-0000-4000-8000-000000000001',
        'outcome', 'public_eligibility_withdrawn',
        'provider', 'cloudflare',
        'provider_account_scope', 'production'
      )
    ),
    (
      510015,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'system',
      NULL,
      'advocate-domain-reconciler',
      'advocate-domain-topology-quarantine',
      'include:topology-quarantine',
      jsonb_build_object(
        'operation', 'quarantine_invalid_topology',
        'batch_id', 'audit-topology-batch',
        'domain_hostname', 'audit-history-a.creatorshare.com',
        'manual_review_code', 'invalid_required_provider_topology',
        'resource_kind', 'advocate_domain',
        'resource_id', 'd5100000-0000-4000-8000-000000000001',
        'outcome', 'failed_closed'
      )
    ),
    (
      510016,
      'advocate_domains',
      'UPDATE',
      jsonb_build_object('id', 'd5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-advocate-lifecycle',
      'include:domain-deactivated',
      jsonb_build_object(
        'operation', 'quiesce_domain',
        'outcome', 'redirecting',
        'prior_status', 'active',
        'resource_kind', 'advocate_domain',
        'resource_id', 'd5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      510017,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'a5100000-0000-4000-8000-000000000001',
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-advocate-lifecycle',
      'include:repair',
      jsonb_build_object(
        'operation', 'repair_advocate',
        'outcome', 'active/provisioning',
        'prior_status', 'active/failed',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    )
) AS source(
  transaction_id,
  table_name,
  operation,
  record_pk,
  advocate_id,
  actor_type,
  actor_user_id,
  system_actor,
  tool,
  reason,
  metadata
);

/* Near misses and explicitly excluded internal event classes. */
INSERT INTO audit.audit_events (
  transaction_id,
  schema_name,
  table_name,
  operation,
  record_pk,
  advocate_id,
  actor_type,
  actor_user_id,
  system_actor,
  tool,
  database_role,
  session_user_name,
  reason,
  metadata
)
SELECT
  511000 + source.ordinal,
  'public',
  source.table_name,
  source.operation,
  source.record_pk,
  'a5100000-0000-4000-8000-000000000001',
  source.actor_type,
  source.actor_user_id,
  source.system_actor,
  source.tool,
  'postgres',
  'postgres',
  'exclude:' || source.exclusion_key,
  source.metadata
FROM (
  VALUES
    (
      1,
      'advocates'::text,
      'UPDATE'::audit.audit_operation,
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'user'::audit.audit_actor_type,
      'b5100000-0000-4000-8000-000000000001'::uuid,
      NULL::text,
      'advocate-portal-ownership'::text,
      'direct-owner-transfer'::text,
      jsonb_build_object(
        'operation', 'transfer_ownership',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001',
        'role_key', 'owner'
      )
    ),
    (
      2,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-branding',
      'branding-wrong-table',
      jsonb_build_object(
        'operation', 'update_branding',
        'permission_key', 'portal.branding.update',
        'resource_kind', 'advocate_branding',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      3,
      'advocate_beneficiaries',
      'INSERT',
      jsonb_build_object(
        'advocate_id', 'a5100000-0000-4000-8000-000000000001'
      ),
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-beneficiaries',
      'catalog-wrong-table',
      jsonb_build_object(
        'operation', 'replace_beneficiaries',
        'permission_key', 'portal.beneficiaries.manage',
        'resource_kind', 'advocate_beneficiaries',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      4,
      'advocate_domains',
      'UPDATE',
      jsonb_build_object('id', 'd5100000-0000-4000-8000-000000000001'),
      'creator_share_admin',
      'b5100000-0000-4000-8000-000000000004',
      NULL,
      'creator-share-admin-publication',
      'old-publication-operation',
      jsonb_build_object(
        'operation', 'publish_portal',
        'canary_completed_at', '2026-07-19T00:00:00.000000Z',
        'correlation_id', 'a5100000-0000-4000-8000-000000000099',
        'deployment_id', 'audit-deployment',
        'domain_hostname', 'audit-history-a.creatorshare.com',
        'evidence_sha256', repeat('a', 64),
        'publication_binding_sha256', repeat('b', 64),
        'resource_kind', 'advocate_domain',
        'resource_id', 'd5100000-0000-4000-8000-000000000001',
        'outcome', 'active'
      )
    ),
    (
      5,
      'domain_provisioning_jobs',
      'UPDATE',
      jsonb_build_object('id', 'f5100000-0000-4000-8000-000000000001'),
      'system',
      NULL,
      'advocate-domain-worker-1',
      'domain-provisioning-retry',
      'worker-retry',
      jsonb_build_object(
        'operation', 'retry',
        'resource_kind', 'domain_provisioning_job',
        'resource_id', 'f5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      6,
      'advocate_invitation_email_outbox',
      'UPDATE',
      jsonb_build_object('id', 'f5100000-0000-4000-8000-000000000002'),
      'system',
      NULL,
      'email-delivery-operator',
      'advocate-invitation-email-worker',
      'invitation-delivery',
      jsonb_build_object(
        'operation', 'settle_delivery',
        'resource_kind', 'advocate_invitation_email'
      )
    ),
    (
      7,
      'advocate_logo_upload_reservations',
      'UPDATE',
      jsonb_build_object('id', 'f5100000-0000-4000-8000-000000000003'),
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-branding',
      'logo-reservation',
      jsonb_build_object(
        'operation', 'update_branding',
        'permission_key', 'portal.branding.update',
        'resource_kind', 'advocate_branding',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      8,
      'sponsorship_attributions',
      'INSERT',
      jsonb_build_object('id', 'f5100000-0000-4000-8000-000000000004'),
      'system',
      NULL,
      'sponsorship-payment-service',
      'sponsorship-payment-service',
      'sponsor-payment',
      jsonb_build_object(
        'operation', 'attribute_sponsorship',
        'resource_kind', 'sponsorship'
      )
    ),
    (
      9,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-settings',
      'reserved-settings-key',
      jsonb_build_object(
        'operation', 'update_settings',
        'permission_key', 'portal.settings.update',
        'resource_kind', 'advocate',
        'resource_id', 'a5100000-0000-4000-8000-000000000001'
      )
    ),
    (
      10,
      'advocates',
      'UPDATE',
      jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
      'system',
      NULL,
      'advocate-domain-worker-1',
      'domain-provisioning-reconcile',
      'nonterminal-reconcile',
      jsonb_build_object(
        'operation', 'reconcile',
        'domain_hostname', 'audit-history-a.creatorshare.com',
        'job_id', 'f5100000-0000-4000-8000-000000000005',
        'resource_kind', 'domain_provisioning_job',
        'resource_id', 'f5100000-0000-4000-8000-000000000005',
        'outcome', 'matches_intent',
        'provider', 'cloudflare',
        'provider_account_scope', 'production'
      )
    ),
    (
      11,
      'advocate_branding',
      'UPDATE',
      jsonb_build_object(
        'advocate_id', 'a5100000-0000-4000-8000-000000000001'
      ),
      'user',
      'b5100000-0000-4000-8000-000000000001',
      NULL,
      'advocate-portal-branding',
      'unexpected-metadata-key',
      jsonb_build_object(
        'operation', 'update_branding',
        'permission_key', 'portal.branding.update',
        'resource_kind', 'advocate_branding',
        'resource_id', 'a5100000-0000-4000-8000-000000000001',
        'unexpected_key', 'must-fail-closed'
      )
    )
) AS source(
  ordinal,
  table_name,
  operation,
  record_pk,
  actor_type,
  actor_user_id,
  system_actor,
  tool,
  exclusion_key,
  metadata
);

INSERT INTO audit.audit_events (
  transaction_id,
  schema_name,
  table_name,
  operation,
  record_pk,
  advocate_id,
  actor_type,
  actor_user_id,
  tool,
  database_role,
  session_user_name,
  reason,
  metadata
)
SELECT
  source.transaction_id,
  'public',
  'advocate_branding',
  'UPDATE',
  jsonb_build_object(
    'advocate_id', 'a5100000-0000-4000-8000-000000000001'
  ),
  'a5100000-0000-4000-8000-000000000001',
  'user',
  source.actor_user_id,
  'advocate-portal-branding',
  'postgres',
  'postgres',
  source.reason,
  jsonb_build_object(
    'operation', 'update_branding',
    'permission_key', 'portal.branding.update',
    'resource_kind', 'advocate_branding',
    'resource_id', 'a5100000-0000-4000-8000-000000000001'
  )
FROM (
  VALUES
    (
      510018::bigint,
      'b5100000-0000-4000-8000-000000000006'::uuid,
      'include:reserved-staff-core'::text
    ),
    (
      510019,
      'b5100000-0000-4000-8000-000000000007',
      'include:reserved-automation-core'
    ),
    (
      510020,
      'b5100000-0000-4000-8000-000000000008',
      'include:twenty-three-character-core'
    ),
    (
      510021,
      'b5100000-0000-4000-8000-000000000009',
      'include:twenty-two-character-core'
    )
) AS source(transaction_id, actor_user_id, reason);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id =
      'a5100000-0000-4000-8000-000000000001'
  ),
  21,
  'exact source shapes disclose one event each while duplicate row fanout collapses'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id =
      'a5100000-0000-4000-8000-000000000001'
      AND event.event_key = 'portal.created'
      AND event.source_transaction_id = 510001
  ),
  1,
  'one advocate transaction and event key has exactly one disclosure row'
);

SELECT extensions.is(
  (
    SELECT array_agg(DISTINCT event.event_key ORDER BY event.event_key)
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id =
      'a5100000-0000-4000-8000-000000000001'
  ),
  ARRAY[
    'branding.updated',
    'catalog.updated',
    'domain.deactivated',
    'domain.provisioning.requested',
    'domain.publication.completed',
    'domain.publication.needs_attention',
    'portal.created',
    'portal.lifecycle.updated',
    'portal.ownership.transferred',
    'public_metrics.updated',
    'team.invitation.accepted',
    'team.invitation.issued',
    'team.invitation.revoked',
    'team.member.access_updated',
    'team.member.roles_updated'
  ]::text[],
  'only the fifteen currently recognized fixed business taxonomy keys are emitted'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosure
    JOIN audit.audit_events source
      ON source.sequence_id = disclosure.source_audit_sequence
    WHERE source.reason LIKE 'exclude:%'
  ),
  'near misses and sponsor, delivery, upload, retry, and provider internals default deny'
);

SELECT extensions.is(
  (
    SELECT event.actor_display_name
    FROM audit.advocate_delegate_events event
    WHERE event.event_key = 'branding.updated'
      AND event.source_transaction_id = 510004
  ),
  'Portal team member',
  'malicious or nonconforming profile names collapse to the generic portal label'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.advocate_delegate_events event
    WHERE event.source_transaction_id IN (510018, 510019, 510020)
      AND event.actor_display_name = 'Portal team member'
  ),
  3,
  'reserved actor cores and a diverse twenty-three-character core use the generic label'
);

SELECT extensions.is(
  (
    SELECT event.actor_display_name
    FROM audit.advocate_delegate_events event
    WHERE event.source_transaction_id = 510021
  ),
  'abcdefghijklmnopqrstuv Z.',
  'a valid twenty-two-character core plus last initial remains within the safe grammar'
);

SELECT extensions.is(
  (
    SELECT event.actor_display_name
    FROM audit.advocate_delegate_events event
    WHERE event.event_key = 'team.invitation.accepted'
      AND event.source_transaction_id = 510009
  ),
  'Avery S.',
  'a safe portal actor snapshot exposes only first name and last initial'
);

UPDATE public.users
SET first_name = 'Changed', last_name = 'Later'
WHERE id = 'b5100000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (
    SELECT event.actor_display_name
    FROM audit.advocate_delegate_events event
    WHERE event.event_key = 'team.invitation.accepted'
      AND event.source_transaction_id = 510009
  ),
  'Avery S.',
  'actor display names are immutable event-time snapshots'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events event
    WHERE event.actor_kind = 'creator_share_staff'
      AND event.actor_display_name = 'Creator Share staff'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events event
    WHERE event.actor_kind = 'automation'
      AND event.actor_display_name = 'Creator Share automation'
  ),
  'staff and automation always use fixed nonidentifying labels'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events event
    WHERE event.occurred_at <> date_trunc('second', event.occurred_at)
  ),
  'disclosed event times are stored at second precision'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.advocate_delegate_events
    SET actor_display_name = 'Tampered'
    WHERE identity_sequence = (
      SELECT min(event.identity_sequence)
      FROM audit.advocate_delegate_events event
    )
  $$,
  '42501',
  'audit.advocate_delegate_events is append-only',
  'disclosure events cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.advocate_delegate_events
    WHERE identity_sequence = (
      SELECT min(event.identity_sequence)
      FROM audit.advocate_delegate_events event
    )
  $$,
  '42501',
  'audit.advocate_delegate_events is append-only',
  'disclosure events cannot be deleted'
);

SELECT extensions.throws_ok(
  'TRUNCATE audit.advocate_delegate_events',
  '42501',
  'audit.advocate_delegate_events is append-only',
  'the disclosure ledger cannot be truncated'
);

/* A second tenant supplies a real cross-tenant opaque cursor denial case. */
INSERT INTO audit.audit_events (
  transaction_id,
  schema_name,
  table_name,
  operation,
  record_pk,
  advocate_id,
  actor_type,
  actor_user_id,
  tool,
  database_role,
  session_user_name,
  reason,
  metadata
)
VALUES (
  520001,
  'public',
  'advocates',
  'INSERT',
  jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000002'),
  'a5100000-0000-4000-8000-000000000002',
  'creator_share_admin',
  'b5100000-0000-4000-8000-000000000004',
  'creator-share-admin-advocates',
  'postgres',
  'postgres',
  'include:tenant-b',
  jsonb_build_object(
    'operation', 'create_portal',
    'resource_kind', 'advocate',
    'resource_id', 'a5100000-0000-4000-8000-000000000002',
    'role_key', 'owner'
  )
);

SELECT set_config(
  'test.advocate_audit_cross_cursor',
  (
    SELECT event.public_cursor::text
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id =
      'a5100000-0000-4000-8000-000000000002'
    ORDER BY event.identity_sequence DESC
    LIMIT 1
  ),
  true
);

/* Fifty-two later exact events exercise the fixed fifty-row continuation. */
INSERT INTO audit.audit_events (
  transaction_id,
  schema_name,
  table_name,
  operation,
  record_pk,
  advocate_id,
  actor_type,
  actor_user_id,
  tool,
  database_role,
  session_user_name,
  reason,
  metadata
)
SELECT
  530000 + generated.ordinal,
  'public',
  'advocates',
  'UPDATE',
  jsonb_build_object('id', 'a5100000-0000-4000-8000-000000000001'),
  'a5100000-0000-4000-8000-000000000001',
  'user',
  'b5100000-0000-4000-8000-000000000001',
  'advocate-portal-beneficiaries',
  'postgres',
  'postgres',
  'pagination:' || generated.ordinal,
  jsonb_build_object(
    'operation', 'replace_beneficiaries',
    'permission_key', 'portal.beneficiaries.manage',
    'resource_kind', 'advocate_beneficiaries',
    'resource_id', 'a5100000-0000-4000-8000-000000000001'
  )
FROM generate_series(1, 52) generated(ordinal);

SELECT set_config(
  'test.advocate_audit_count',
  (
    SELECT count(*)::text
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id =
      'a5100000-0000-4000-8000-000000000001'
  ),
  true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b5100000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.is(
  jsonb_array_length(
    public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001'
    ) -> 'entries'
  ),
  50,
  'the first history page always contains at most the fixed fifty entries'
);

SELECT extensions.is(
  public.get_advocate_audit_history_page(
    'a5100000-0000-4000-8000-000000000001'
  ) ->> 'next_cursor',
  public.get_advocate_audit_history_page(
    'a5100000-0000-4000-8000-000000000001'
  ) -> 'entries' -> 49 ->> 'cursor',
  'a nonnull continuation cursor is exactly the fiftieth returned entry cursor'
);

SELECT extensions.is(
  (
    SELECT array_agg(top_level.key ORDER BY top_level.key)
    FROM jsonb_object_keys(
      public.get_advocate_audit_history_page(
        'a5100000-0000-4000-8000-000000000001'
      )
    ) top_level(key)
  ),
  ARRAY['entries', 'next_cursor', 'schema_version']::text[],
  'the history page exposes exactly its version, continuation, and entries'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_advocate_audit_history_page(
        'a5100000-0000-4000-8000-000000000001'
      ) -> 'entries'
    ) entry(value)
    WHERE (
      SELECT array_agg(entry_key.key ORDER BY entry_key.key)
      FROM jsonb_object_keys(entry.value) entry_key(key)
    ) <> ARRAY[
      'actor_display_name',
      'actor_kind',
      'areas',
      'cursor',
      'event_key',
      'occurred_at'
    ]::text[]
  ),
  'every history entry has exactly the six approved public keys'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_advocate_audit_history_page(
        'a5100000-0000-4000-8000-000000000001'
      ) -> 'entries'
    ) entry(value)
    WHERE entry.value ->> 'occurred_at' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
  ),
  'every public timestamp is canonical second-precision UTC ending in Z'
);

SELECT extensions.ok(
  public.get_advocate_audit_history_page(
    'a5100000-0000-4000-8000-000000000001'
  )::text NOT LIKE '%secret@example.test%'
  AND public.get_advocate_audit_history_page(
    'a5100000-0000-4000-8000-000000000001'
  )::text NOT LIKE '%<script>%',
  'malicious profile, reason, and metadata content never reaches public JSON'
);

SELECT extensions.is(
  jsonb_array_length(
    public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001',
      (
        public.get_advocate_audit_history_page(
          'a5100000-0000-4000-8000-000000000001'
        ) ->> 'next_cursor'
      )::uuid
    ) -> 'entries'
  ),
  current_setting('test.advocate_audit_count')::integer - 50,
  'the continuation page returns every remaining older event'
);

SELECT extensions.is(
  public.get_advocate_audit_history_page(
    'a5100000-0000-4000-8000-000000000001',
    (
      public.get_advocate_audit_history_page(
        'a5100000-0000-4000-8000-000000000001'
      ) ->> 'next_cursor'
    )::uuid
  ) -> 'next_cursor',
  'null'::jsonb,
  'the final partial page has no continuation cursor'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_advocate_audit_history_page(
        'a5100000-0000-4000-8000-000000000001'
      ) -> 'entries'
    ) first_page(entry)
    JOIN jsonb_array_elements(
      public.get_advocate_audit_history_page(
        'a5100000-0000-4000-8000-000000000001',
        (
          public.get_advocate_audit_history_page(
            'a5100000-0000-4000-8000-000000000001'
          ) ->> 'next_cursor'
        )::uuid
      ) -> 'entries'
    ) second_page(entry)
      ON first_page.entry ->> 'cursor' = second_page.entry ->> 'cursor'
  ),
  'opaque cursor pages never overlap'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )
  $$,
  '22023',
  'Invalid audit history cursor',
  'an unknown opaque cursor fails generically'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.get_advocate_audit_history_page(%L::uuid, %L::uuid)',
    'a5100000-0000-4000-8000-000000000001',
    current_setting('test.advocate_audit_cross_cursor')
  ),
  '22023',
  'Invalid audit history cursor',
  'a cross-tenant opaque cursor fails with the same generic error'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001',
      NULL,
      49
    )
  $$,
  '22023',
  'Audit history page size must be exactly 50',
  'callers cannot vary the fixed privacy and cursor page size'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'b5100000-0000-4000-8000-000000000005',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Insufficient portal audit permission',
  'a healthy nonmember cannot read tenant audit history'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'b5100000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Insufficient portal audit permission',
  'another portal owner cannot read cross-tenant audit history'
);

RESET ROLE;

UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 day'
WHERE id = 'b5100000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b5100000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned member cannot use a retained session to read audit history'
);

RESET ROLE;

UPDATE auth.users
SET banned_until = NULL, email_confirmed_at = NULL
WHERE id = 'b5100000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b5100000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'an unverified account cannot read audit history'
);

RESET ROLE;

UPDATE auth.users
SET email_confirmed_at = clock_timestamp()
WHERE id = 'b5100000-0000-4000-8000-000000000001';

UPDATE public.advocates
SET relationship_status = 'suspended'
WHERE id = 'a5100000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b5100000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.is(
  (
    public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001'
    ) ->> 'schema_version'
  )::integer,
  1,
  'a suspended portal remains readable to its healthy audit member'
);

RESET ROLE;

UPDATE public.advocates
SET relationship_status = 'archived'
WHERE id = 'a5100000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b5100000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_audit_history_page(
      'a5100000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Insufficient portal audit permission',
  'an archived portal cannot be read by its former member'
);

RESET ROLE;

SELECT extensions.finish();

ROLLBACK;

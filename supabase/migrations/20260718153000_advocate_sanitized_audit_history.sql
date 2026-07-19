BEGIN;

/*
 * The indefinite row audit is a forensic source, not a portal presentation
 * model. This separate disclosure ledger records only fixed business events at
 * write time. Existing audit rows are intentionally not copied into it.
 */
CREATE TABLE audit.advocate_delegate_events (
  identity_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_cursor uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid() UNIQUE,
  advocate_id uuid NOT NULL
    REFERENCES public.advocates(id) ON DELETE RESTRICT,
  occurred_at timestamp(0) with time zone NOT NULL,
  disclosure_policy_version smallint NOT NULL DEFAULT 1,
  event_key text NOT NULL,
  actor_kind text NOT NULL,
  actor_display_name text NOT NULL,
  areas text[] NOT NULL,
  source_transaction_id bigint NOT NULL,
  source_audit_sequence bigint NOT NULL
    REFERENCES audit.audit_events(sequence_id) ON DELETE RESTRICT,
  CONSTRAINT advocate_delegate_events_policy_version_check CHECK (
    disclosure_policy_version = 1
  ),
  CONSTRAINT advocate_delegate_events_occurred_at_check CHECK (
    occurred_at > '-infinity'::timestamp with time zone
    AND occurred_at < 'infinity'::timestamp with time zone
    AND occurred_at = date_trunc('second', occurred_at)
  ),
  CONSTRAINT advocate_delegate_events_event_key_check CHECK (
    event_key = ANY (ARRAY[
      'portal.created',
      'portal.settings.updated',
      'portal.lifecycle.updated',
      'portal.ownership.transferred',
      'branding.updated',
      'catalog.updated',
      'public_metrics.updated',
      'team.invitation.issued',
      'team.invitation.revoked',
      'team.invitation.accepted',
      'team.member.roles_updated',
      'team.member.access_updated',
      'domain.provisioning.requested',
      'domain.publication.completed',
      'domain.publication.needs_attention',
      'domain.deactivated'
    ]::text[])
  ),
  CONSTRAINT advocate_delegate_events_actor_kind_check CHECK (
    actor_kind = ANY (ARRAY[
      'portal_member',
      'creator_share_staff',
      'automation'
    ]::text[])
  ),
  CONSTRAINT advocate_delegate_events_actor_display_check CHECK (
    char_length(actor_display_name) BETWEEN 1 AND 64
    AND actor_display_name !~ '[@[:cntrl:]]'
    AND (
      (
        actor_kind = 'portal_member'
        AND (
          actor_display_name = 'Portal team member'
          OR (
            (
              char_length(actor_display_name) <= 22
              AND actor_display_name ~
                '^[A-Za-z]+([ ''-][A-Za-z]+)*$'
            )
            OR (
              char_length(actor_display_name) <= 25
              AND actor_display_name ~
                '^[A-Za-z]+([ ''-][A-Za-z]+)* [A-Z][.]$'
            )
          )
          AND char_length(
            regexp_replace(actor_display_name, ' [A-Z][.]$', '')
          ) <= 22
          AND lower(
            regexp_replace(actor_display_name, ' [A-Z][.]$', '')
          ) <> ALL (ARRAY[
            'creator share staff',
            'creator share automation'
          ]::text[])
        )
      )
      OR (
        actor_kind = 'creator_share_staff'
        AND actor_display_name = 'Creator Share staff'
      )
      OR (
        actor_kind = 'automation'
        AND actor_display_name = 'Creator Share automation'
      )
    )
  ),
  CONSTRAINT advocate_delegate_events_areas_check CHECK (
    CASE event_key
      WHEN 'portal.created' THEN
        areas = ARRAY['ownership', 'portal_lifecycle', 'portal_profile']::text[]
      WHEN 'portal.settings.updated' THEN
        areas = ARRAY['portal_profile']::text[]
      WHEN 'portal.lifecycle.updated' THEN
        areas = ARRAY['portal_lifecycle']::text[]
      WHEN 'portal.ownership.transferred' THEN
        areas = ARRAY['ownership']::text[]
      WHEN 'branding.updated' THEN
        areas = ARRAY['about', 'colors', 'logo', 'opening_header']::text[]
      WHEN 'catalog.updated' THEN
        areas = ARRAY[
          'catalog_mode',
          'catalog_order',
          'catalog_selection'
        ]::text[]
      WHEN 'public_metrics.updated' THEN
        areas = ARRAY['public_metric_selection']::text[]
      WHEN 'team.invitation.issued' THEN
        areas = ARRAY['invitation']::text[]
      WHEN 'team.invitation.revoked' THEN
        areas = ARRAY['invitation']::text[]
      WHEN 'team.invitation.accepted' THEN
        areas = ARRAY['invitation']::text[]
      WHEN 'team.member.roles_updated' THEN
        areas = ARRAY['member_roles']::text[]
      WHEN 'team.member.access_updated' THEN
        areas = ARRAY['member_access']::text[]
      WHEN 'domain.provisioning.requested' THEN
        areas = ARRAY[
          'dns',
          'payment_readiness',
          'provider_readiness',
          'tls'
        ]::text[]
      WHEN 'domain.publication.completed' THEN
        areas = ARRAY[
          'dns',
          'payment_readiness',
          'provider_readiness',
          'publication',
          'tls'
        ]::text[]
      WHEN 'domain.publication.needs_attention' THEN
        areas = ARRAY[
          'dns',
          'payment_readiness',
          'provider_readiness',
          'publication',
          'tls'
        ]::text[]
      WHEN 'domain.deactivated' THEN
        areas = ARRAY[
          'dns',
          'payment_readiness',
          'provider_readiness',
          'publication',
          'tls'
        ]::text[]
      ELSE false
    END
  ),
  CONSTRAINT advocate_delegate_events_source_audit_unique
    UNIQUE (source_audit_sequence),
  CONSTRAINT advocate_delegate_events_business_event_unique
    UNIQUE (advocate_id, source_transaction_id, event_key)
);

CREATE INDEX advocate_delegate_events_tenant_page_idx
  ON audit.advocate_delegate_events (advocate_id, identity_sequence DESC);

COMMENT ON TABLE audit.advocate_delegate_events IS
  'Append-only, policy-versioned portal audit presentation facts. It is populated only from fixed business command shapes at source audit write time and contains no historical backfill, sponsor data, contact data, free-form reasons, row images, or provider internals.';
COMMENT ON COLUMN audit.advocate_delegate_events.public_cursor IS
  'Opaque tenant-scoped pagination cursor. The private identity sequence is never returned to portal callers.';
COMMENT ON COLUMN audit.advocate_delegate_events.actor_display_name IS
  'Event-time privacy-limited actor snapshot. Portal members use a validated first name and optional last initial; staff and automation use fixed labels.';
COMMENT ON COLUMN audit.advocate_delegate_events.source_transaction_id IS
  'Private forensic link used only to collapse row-audit fanout into one disclosed business event per tenant, transaction, and event key.';

ALTER TABLE audit.advocate_delegate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.advocate_delegate_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON audit.advocate_delegate_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE audit.advocate_delegate_events_identity_sequence_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION audit.safe_advocate_delegate_actor_display(
  target_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_first_name text;
  v_last_name text;
  v_display_name text;
BEGIN
  SELECT
    nullif(btrim(profile.first_name), ''),
    nullif(btrim(profile.last_name), '')
  INTO v_first_name, v_last_name
  FROM public.users profile
  WHERE profile.id = target_actor_user_id;

  IF v_first_name IS NULL
     OR char_length(v_first_name) > 22
     OR v_first_name !~ '^[A-Za-z]+([ ''-][A-Za-z]+)*$'
     OR lower(v_first_name) = ANY (ARRAY[
       'creator share staff',
       'creator share automation'
     ]::text[]) THEN
    RETURN 'Portal team member';
  END IF;

  IF v_last_name IS NOT NULL
     AND char_length(v_last_name) <= 80
     AND v_last_name ~ '^[A-Za-z]+([ ''-][A-Za-z]+)*$' THEN
    v_display_name := v_first_name || ' ' || upper(left(v_last_name, 1)) || '.';
  ELSE
    v_display_name := v_first_name;
  END IF;

  IF char_length(v_display_name) > 25
     OR v_display_name ~ '[@[:cntrl:]]' THEN
    RETURN 'Portal team member';
  END IF;

  RETURN v_display_name;
END;
$$;

REVOKE ALL ON FUNCTION audit.safe_advocate_delegate_actor_display(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION audit.json_object_has_exact_keys(
  source_data jsonb,
  expected_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    jsonb_typeof(source_data) = 'object'
    AND ARRAY(
      SELECT source_key.key
      FROM jsonb_object_keys(source_data) source_key(key)
      ORDER BY source_key.key
    ) = ARRAY(
      SELECT DISTINCT expected_key.key
      FROM unnest(expected_keys) expected_key(key)
      WHERE expected_key.key IS NOT NULL
      ORDER BY expected_key.key
    )
    AND cardinality(expected_keys) = (
      SELECT count(DISTINCT expected_key.key)
      FROM unnest(expected_keys) expected_key(key)
      WHERE expected_key.key IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION audit.json_object_has_exact_keys(jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION audit.capture_advocate_delegate_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_key text;
  v_actor_kind text;
  v_actor_display_name text;
  v_areas text[];
BEGIN
  IF NEW.advocate_id IS NULL
     OR NEW.schema_name <> 'public'
     OR NEW.occurred_at <= '-infinity'::timestamp with time zone
     OR NEW.occurred_at >= 'infinity'::timestamp with time zone THEN
    RETURN NULL;
  END IF;

  v_event_key := CASE
    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'INSERT'::audit.audit_operation
      AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'creator-share-admin-advocates'
      AND NEW.metadata ->> 'operation' = 'create_portal'
      AND NEW.metadata ->> 'resource_kind' = 'advocate'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'role_key' = 'owner'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY['operation', 'resource_id', 'resource_kind', 'role_key']::text[]
      )
      THEN 'portal.created'

    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'creator-share-admin-advocate-lifecycle'
      AND NEW.metadata ->> 'operation' = ANY (ARRAY[
        'suspend_advocate',
        'resume_advocate',
        'archive_advocate'
      ]::text[])
      AND NEW.metadata ->> 'resource_kind' = 'advocate'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'operation',
          'outcome',
          'prior_status',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'portal.lifecycle.updated'

    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'creator-share-admin-advocates'
      AND NEW.metadata ->> 'operation' = 'transfer_ownership'
      AND NEW.metadata ->> 'resource_kind' = 'advocate'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'role_key' = 'owner'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY['operation', 'resource_id', 'resource_kind', 'role_key']::text[]
      )
      THEN 'portal.ownership.transferred'

    WHEN NEW.table_name = 'advocate_branding'
      AND NEW.operation = ANY (ARRAY[
        'INSERT'::audit.audit_operation,
        'UPDATE'::audit.audit_operation
      ])
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-portal-branding'
      AND NEW.metadata ->> 'operation' = 'update_branding'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_branding'
      AND NEW.record_pk ->> 'advocate_id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'permission_key' = 'portal.branding.update'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'operation',
          'permission_key',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'branding.updated'

    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-portal-beneficiaries'
      AND NEW.metadata ->> 'operation' = 'replace_beneficiaries'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_beneficiaries'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'permission_key' = 'portal.beneficiaries.manage'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'operation',
          'permission_key',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'catalog.updated'

    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-portal-public-metrics'
      AND NEW.metadata ->> 'operation' = 'replace_public_metrics'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_public_metric_selections'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'permission_key' = 'portal.public_metrics.update'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'operation',
          'permission_key',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'public_metrics.updated'

    WHEN NEW.table_name = 'advocate_invitations'
      AND NEW.operation = 'INSERT'::audit.audit_operation
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-portal-team'
      AND NEW.metadata ->> 'operation' = 'issue_invitation'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_invitation'
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'outcome' = 'queued'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY['operation', 'outcome', 'resource_id', 'resource_kind']::text[]
      )
      THEN 'team.invitation.issued'

    WHEN NEW.table_name = 'advocate_invitations'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-portal-team'
      AND NEW.metadata ->> 'operation' = 'revoke_invitation'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_invitation'
      AND (NEW.record_pk ->> 'id') = (NEW.metadata ->> 'resource_id')
      AND NEW.metadata ->> 'outcome' = 'revoked'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY['operation', 'outcome', 'resource_id', 'resource_kind']::text[]
      )
      THEN 'team.invitation.revoked'

    WHEN NEW.table_name = 'advocate_invitations'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-invitation-acceptance'
      AND NEW.metadata ->> 'operation' = 'redeem_invitation'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_invitation'
      AND (NEW.record_pk ->> 'id') = (NEW.metadata ->> 'resource_id')
      AND NEW.metadata ->> 'outcome' = 'accepted'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY['operation', 'outcome', 'resource_id', 'resource_kind']::text[]
      )
      THEN 'team.invitation.accepted'

    WHEN NEW.table_name = 'advocate_memberships'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-portal-team'
      AND NEW.metadata ->> 'operation' = 'replace_member_roles'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_membership'
      AND (NEW.record_pk ->> 'id') = (NEW.metadata ->> 'resource_id')
      AND NEW.metadata ->> 'permission_key' = 'portal.members.manage'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'operation',
          'permission_key',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'team.member.roles_updated'

    WHEN NEW.table_name = 'advocate_memberships'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'user'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'advocate-portal-team'
      AND NEW.metadata ->> 'operation' = 'change_member_status'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_membership'
      AND (NEW.record_pk ->> 'id') = (NEW.metadata ->> 'resource_id')
      AND NEW.metadata ->> 'permission_key' = 'portal.members.manage'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'operation',
          'permission_key',
          'prior_status',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'team.member.access_updated'

    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND (
        (
          NEW.tool = 'creator-share-admin-domains'
          AND NEW.metadata ->> 'operation' = 'start_provisioning'
          AND NEW.metadata ->> 'outcome' = 'queued'
          AND audit.json_object_has_exact_keys(
            NEW.metadata,
            ARRAY[
              'correlation_id',
              'domain_hostname',
              'operation',
              'outcome',
              'resource_id',
              'resource_kind'
            ]::text[]
          )
        )
        OR (
          NEW.tool = 'creator-share-admin-advocate-lifecycle'
          AND NEW.metadata ->> 'operation' = 'repair_advocate'
          AND audit.json_object_has_exact_keys(
            NEW.metadata,
            ARRAY[
              'operation',
              'outcome',
              'prior_status',
              'resource_id',
              'resource_kind'
            ]::text[]
          )
        )
      )
      AND NEW.metadata ->> 'resource_kind' = 'advocate'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'resource_id' = NEW.advocate_id::text
      THEN 'domain.provisioning.requested'

    WHEN NEW.table_name = 'advocate_domains'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'creator-share-admin-publication'
      AND NEW.metadata ->> 'operation' = 'publish_portal_from_canary'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_domain'
      AND NEW.metadata ->> 'outcome' = 'active'
      AND (NEW.record_pk ->> 'id') = (NEW.metadata ->> 'resource_id')
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'canary_completed_at',
          'correlation_id',
          'deployment_id',
          'domain_hostname',
          'evidence_sha256',
          'operation',
          'outcome',
          'publication_binding_sha256',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'domain.publication.completed'

    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'system'::audit.audit_actor_type
      AND NEW.system_actor IS NOT NULL
      AND NEW.tool = 'domain-provisioning-reconcile'
      AND NEW.metadata ->> 'operation' = 'reconcile'
      AND NEW.metadata ->> 'resource_kind' = 'domain_provisioning_job'
      AND NEW.metadata ->> 'outcome' = 'public_eligibility_withdrawn'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'domain_hostname',
          'job_id',
          'operation',
          'outcome',
          'provider',
          'provider_account_scope',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'domain.publication.needs_attention'

    WHEN NEW.table_name = 'advocates'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'system'::audit.audit_actor_type
      AND NEW.system_actor = 'advocate-domain-reconciler'
      AND NEW.tool = 'advocate-domain-topology-quarantine'
      AND NEW.metadata ->> 'operation' = 'quarantine_invalid_topology'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_domain'
      AND NEW.metadata ->> 'outcome' = 'failed_closed'
      AND NEW.record_pk ->> 'id' = NEW.advocate_id::text
      AND NEW.metadata ->> 'manual_review_code' =
        'invalid_required_provider_topology'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'batch_id',
          'domain_hostname',
          'manual_review_code',
          'operation',
          'outcome',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'domain.publication.needs_attention'

    WHEN NEW.table_name = 'advocate_domains'
      AND NEW.operation = 'UPDATE'::audit.audit_operation
      AND NEW.actor_type = 'creator_share_admin'::audit.audit_actor_type
      AND NEW.actor_user_id IS NOT NULL
      AND NEW.tool = 'creator-share-admin-advocate-lifecycle'
      AND NEW.metadata ->> 'operation' = 'quiesce_domain'
      AND NEW.metadata ->> 'resource_kind' = 'advocate_domain'
      AND (NEW.record_pk ->> 'id') = (NEW.metadata ->> 'resource_id')
      AND NEW.metadata ->> 'outcome' = 'redirecting'
      AND audit.json_object_has_exact_keys(
        NEW.metadata,
        ARRAY[
          'operation',
          'outcome',
          'prior_status',
          'resource_id',
          'resource_kind'
        ]::text[]
      )
      THEN 'domain.deactivated'

    ELSE NULL
  END;

  IF v_event_key IS NULL THEN
    RETURN NULL;
  END IF;

  v_actor_kind := CASE NEW.actor_type
    WHEN 'user'::audit.audit_actor_type THEN 'portal_member'
    WHEN 'creator_share_admin'::audit.audit_actor_type THEN 'creator_share_staff'
    WHEN 'system'::audit.audit_actor_type THEN 'automation'
    ELSE NULL
  END;

  IF v_actor_kind IS NULL THEN
    RETURN NULL;
  END IF;

  v_actor_display_name := CASE v_actor_kind
    WHEN 'portal_member' THEN
      audit.safe_advocate_delegate_actor_display(NEW.actor_user_id)
    WHEN 'creator_share_staff' THEN 'Creator Share staff'
    WHEN 'automation' THEN 'Creator Share automation'
  END;

  v_areas := CASE v_event_key
    WHEN 'portal.created' THEN
      ARRAY['ownership', 'portal_lifecycle', 'portal_profile']::text[]
    WHEN 'portal.settings.updated' THEN
      ARRAY['portal_profile']::text[]
    WHEN 'portal.lifecycle.updated' THEN
      ARRAY['portal_lifecycle']::text[]
    WHEN 'portal.ownership.transferred' THEN
      ARRAY['ownership']::text[]
    WHEN 'branding.updated' THEN
      ARRAY['about', 'colors', 'logo', 'opening_header']::text[]
    WHEN 'catalog.updated' THEN
      ARRAY['catalog_mode', 'catalog_order', 'catalog_selection']::text[]
    WHEN 'public_metrics.updated' THEN
      ARRAY['public_metric_selection']::text[]
    WHEN 'team.invitation.issued' THEN ARRAY['invitation']::text[]
    WHEN 'team.invitation.revoked' THEN ARRAY['invitation']::text[]
    WHEN 'team.invitation.accepted' THEN ARRAY['invitation']::text[]
    WHEN 'team.member.roles_updated' THEN ARRAY['member_roles']::text[]
    WHEN 'team.member.access_updated' THEN ARRAY['member_access']::text[]
    WHEN 'domain.provisioning.requested' THEN
      ARRAY['dns', 'payment_readiness', 'provider_readiness', 'tls']::text[]
    WHEN 'domain.publication.completed' THEN
      ARRAY[
        'dns',
        'payment_readiness',
        'provider_readiness',
        'publication',
        'tls'
      ]::text[]
    WHEN 'domain.publication.needs_attention' THEN
      ARRAY[
        'dns',
        'payment_readiness',
        'provider_readiness',
        'publication',
        'tls'
      ]::text[]
    WHEN 'domain.deactivated' THEN
      ARRAY[
        'dns',
        'payment_readiness',
        'provider_readiness',
        'publication',
        'tls'
      ]::text[]
  END;

  INSERT INTO audit.advocate_delegate_events (
    advocate_id,
    occurred_at,
    disclosure_policy_version,
    event_key,
    actor_kind,
    actor_display_name,
    areas,
    source_transaction_id,
    source_audit_sequence
  )
  VALUES (
    NEW.advocate_id,
    date_trunc('second', NEW.occurred_at),
    1,
    v_event_key,
    v_actor_kind,
    v_actor_display_name,
    v_areas,
    NEW.transaction_id,
    NEW.sequence_id
  )
  ON CONFLICT (advocate_id, source_transaction_id, event_key) DO NOTHING;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION audit.capture_advocate_delegate_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER audit_events_capture_advocate_delegate_event
AFTER INSERT ON audit.audit_events
FOR EACH ROW EXECUTE FUNCTION audit.capture_advocate_delegate_event();

CREATE OR REPLACE FUNCTION audit.prevent_advocate_delegate_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit.advocate_delegate_events is append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION audit.prevent_advocate_delegate_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_delegate_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.advocate_delegate_events
FOR EACH ROW EXECUTE FUNCTION audit.prevent_advocate_delegate_event_mutation();

CREATE TRIGGER advocate_delegate_events_no_truncate
BEFORE TRUNCATE ON audit.advocate_delegate_events
FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_advocate_delegate_event_mutation();

DROP FUNCTION IF EXISTS public.get_advocate_audit_events(uuid, bigint, integer);

CREATE OR REPLACE FUNCTION public.get_advocate_audit_history_page(
  target_advocate_id uuid,
  before_cursor uuid DEFAULT NULL,
  page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_before_sequence bigint;
  v_entries jsonb;
  v_next_cursor uuid;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users actor
    WHERE actor.id = v_actor_user_id
      AND actor.email IS NOT NULL
      AND actor.email_confirmed_at IS NOT NULL
      AND actor.deleted_at IS NULL
      AND actor.is_anonymous IS NOT TRUE
      AND (
        actor.banned_until IS NULL
        OR actor.banned_until <= clock_timestamp()
      )
  ) THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.has_advocate_permission(
    target_advocate_id,
    'portal.audit.view'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal audit permission'
      USING ERRCODE = '42501';
  END IF;

  IF page_size IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'Audit history page size must be exactly 50'
      USING ERRCODE = '22023';
  END IF;

  IF before_cursor IS NOT NULL THEN
    SELECT event.identity_sequence
    INTO v_before_sequence
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = target_advocate_id
      AND event.public_cursor = before_cursor;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid audit history cursor'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  WITH candidates AS (
    SELECT
      event.identity_sequence,
      event.public_cursor,
      event.occurred_at,
      event.event_key,
      event.actor_kind,
      event.actor_display_name,
      event.areas
    FROM audit.advocate_delegate_events event
    WHERE event.advocate_id = target_advocate_id
      AND (
        v_before_sequence IS NULL
        OR event.identity_sequence < v_before_sequence
      )
    ORDER BY event.identity_sequence DESC
    LIMIT page_size + 1
  ), numbered AS (
    SELECT
      candidate.*,
      row_number() OVER (ORDER BY candidate.identity_sequence DESC) AS position
    FROM candidates candidate
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'cursor', numbered.public_cursor,
          'occurred_at', to_char(
            numbered.occurred_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ),
          'event_key', numbered.event_key,
          'actor_kind', numbered.actor_kind,
          'actor_display_name', numbered.actor_display_name,
          'areas', to_jsonb(numbered.areas)
        )
        ORDER BY numbered.identity_sequence DESC
      ) FILTER (WHERE numbered.position <= page_size),
      '[]'::jsonb
    ),
    CASE
      WHEN count(*) > page_size THEN
        (array_agg(
          numbered.public_cursor
          ORDER BY numbered.identity_sequence DESC
        ))[page_size]
      ELSE NULL
    END
  INTO v_entries, v_next_cursor
  FROM numbered;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'next_cursor', v_next_cursor,
    'entries', v_entries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_advocate_audit_history_page(
  uuid,
  uuid,
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_advocate_audit_history_page(
  uuid,
  uuid,
  integer
) TO authenticated;

COMMENT ON FUNCTION public.get_advocate_audit_history_page(
  uuid,
  uuid,
  integer
) IS
  'Returns one tenant-scoped page of write-time, policy-versioned portal business events. The exact JSON contract exposes no global sequence, source identity, sponsor fact, contact fact, free-form text, row image, or provider internal.';

COMMIT;

BEGIN;

-- Advocate portals are single-tenant: every domain, configuration row,
-- membership, and invitation belongs to exactly one advocate.

CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS audit;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA audit FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT USAGE ON SCHEMA audit TO service_role;

DO $$ BEGIN
  CREATE TYPE public.advocate_relationship_status AS ENUM (
    'invited',
    'active',
    'suspended',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.advocate_publication_status AS ENUM (
    'draft',
    'provisioning',
    'active',
    'failed',
    'suspended'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.advocate_beneficiary_mode AS ENUM (
    'all',
    'all_featured',
    'selected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.advocate_domain_status AS ENUM (
    'pending',
    'provisioning',
    'verifying',
    'active',
    'failed',
    'redirecting',
    'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.advocate_domain_integration_provider AS ENUM (
    'cloudflare',
    'vercel',
    'stripe_us',
    'stripe_uk',
    'paypal'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.advocate_domain_integration_status AS ENUM (
    'pending',
    'provisioning',
    'ready',
    'failed',
    'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.domain_provisioning_job_kind AS ENUM (
    'provision',
    'reconcile',
    'deprovision'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.domain_provisioning_job_status AS ENUM (
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.advocate_membership_status AS ENUM (
    'active',
    'suspended',
    'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.advocate_public_metric_key AS ENUM (
    'children_sponsored',
    'active_sponsorships',
    'verified_sponsor_accounts',
    'unique_sponsor_contacts',
    'gross_raised_usd',
    'net_raised_usd',
    'direct_sponsorships',
    'post_visit_attributed_sponsorships',
    'post_visit_observed_sponsorships'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit.audit_operation AS ENUM ('INSERT', 'UPDATE', 'DELETE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit.audit_actor_type AS ENUM (
    'user',
    'creator_share_admin',
    'system',
    'database',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The repository already had a placeholder singular table with only id and
-- created_at. Rename it so existing foreign keys and any placeholder rows are
-- preserved rather than creating a second advocate identity table.
ALTER TABLE public.advocate RENAME TO advocates;

ALTER TABLE public.advocates
  ADD COLUMN slug text,
  ADD COLUMN display_name text,
  ADD COLUMN advocate_type text NOT NULL DEFAULT 'creator',
  ADD COLUMN relationship_status public.advocate_relationship_status NOT NULL DEFAULT 'invited',
  ADD COLUMN publication_status public.advocate_publication_status NOT NULL DEFAULT 'draft',
  ADD COLUMN beneficiary_mode public.advocate_beneficiary_mode NOT NULL DEFAULT 'all',
  ADD COLUMN created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN version bigint NOT NULL DEFAULT 1,
  ADD COLUMN published_at timestamp with time zone,
  ADD COLUMN suspended_at timestamp with time zone,
  ADD COLUMN archived_at timestamp with time zone;

UPDATE public.advocates
SET
  slug = COALESCE(
    slug,
    'advocate-' || substring(replace(id::text, '-', '') from 1 for 12)
  ),
  display_name = COALESCE(
    display_name,
    'Legacy Advocate ' || substring(replace(id::text, '-', '') from 1 for 8)
  );

ALTER TABLE public.advocates
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL,
  ADD CONSTRAINT advocates_slug_format_check CHECK (
    slug = lower(slug)
    AND char_length(slug) BETWEEN 1 AND 63
    AND slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  ADD CONSTRAINT advocates_display_name_length_check CHECK (
    char_length(btrim(display_name)) BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT advocates_type_check CHECK (
    advocate_type = lower(btrim(advocate_type))
    AND advocate_type ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  ADD CONSTRAINT advocates_version_check CHECK (version > 0),
  ADD CONSTRAINT advocates_publication_state_check CHECK (
    publication_status <> 'active' OR published_at IS NOT NULL
  ),
  ADD CONSTRAINT advocates_suspension_state_check CHECK (
    suspended_at IS NULL
    OR relationship_status = 'suspended'
    OR publication_status = 'suspended'
  ),
  ADD CONSTRAINT advocates_archive_state_check CHECK (
    archived_at IS NULL OR relationship_status = 'archived'
  );

CREATE UNIQUE INDEX advocates_slug_uidx ON public.advocates (slug);
CREATE INDEX advocates_lifecycle_idx
  ON public.advocates (relationship_status, publication_status);

COMMENT ON TABLE public.advocates IS
  'Single-tenant branded advocate portal. Each row owns its domains, branding, delegates, beneficiary curation, and attribution data.';
COMMENT ON COLUMN public.advocates.slug IS
  'Lowercase Creator Share subdomain label. Reserved-name validation is also required in the provisioning service.';
COMMENT ON COLUMN public.advocates.beneficiary_mode IS
  'all shows all canonically eligible children, all_featured promotes selected rows, and selected shows only selected rows.';

CREATE TABLE public.advocate_reserved_subdomains (
  label text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_reserved_subdomains_label_check CHECK (
    label = lower(btrim(label))
    AND char_length(label) BETWEEN 1 AND 63
    AND label ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  CONSTRAINT advocate_reserved_subdomains_reason_check CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 500
  )
);

INSERT INTO public.advocate_reserved_subdomains (label, reason)
SELECT label, 'Reserved for Creator Share product, infrastructure, safety, or future platform use.'
FROM unnest(ARRAY[
  'abuse', 'account', 'accounts', 'acme', 'admin', 'advocate', 'advocates',
  'alpha', 'analytics', 'api', 'app', 'assets', 'auth', 'autodiscover', 'beta',
  'billing', 'blog', 'campaign', 'campaigns', 'careers', 'cdn', 'checkout',
  'cloudflare', 'creator', 'creator-share', 'creators', 'creatorshare',
  'dashboard', 'demo', 'dev', 'development', 'dns', 'docs', 'donate',
  'donations', 'email', 'events', 'files', 'ftp', 'git', 'github', 'help',
  'hooks', 'images', 'imap', 'internal', 'jobs', 'legal', 'local', 'localhost',
  'login', 'logs', 'mail', 'media', 'metrics', 'monitor', 'monitoring',
  'mta-sts', 'news', 'ns1', 'ns2', 'partner', 'partners', 'pay', 'payments',
  'paypal', 'pop', 'portal', 'portals', 'postmaster', 'press', 'preview',
  'privacy', 'qa', 'register', 'sandbox', 'security', 'share-tanzania',
  'sharetanzania', 'sftp', 'signup', 'smtp', 'ssh', 'stage', 'staging',
  'static', 'status', 'storage', 'stripe', 'subscriptions', 'supabase',
  'support', 'tanzania', 'terms', 'test', 'testing', 'vercel', 'vpn',
  'webhooks', 'www'
]::text[]) AS reserved(label)
ON CONFLICT (label) DO NOTHING;

COMMENT ON TABLE public.advocate_reserved_subdomains IS
  'Database-backed registry of labels that automated advocate provisioning must never assign.';

CREATE TABLE public.advocate_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  status public.advocate_domain_status NOT NULL DEFAULT 'pending',
  dns_verified_at timestamp with time zone,
  tls_ready_at timestamp with time zone,
  payments_ready_at timestamp with time zone,
  activated_at timestamp with time zone,
  deactivated_at timestamp with time zone,
  redirect_to_domain_id uuid REFERENCES public.advocate_domains(id) ON DELETE SET NULL,
  failure_code text,
  failure_detail text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_domains_hostname_format_check CHECK (
    hostname = lower(hostname)
    AND char_length(hostname) BETWEEN 1 AND 253
    AND hostname ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.creatorshare\.com$'
  ),
  CONSTRAINT advocate_domains_active_readiness_check CHECK (
    status <> 'active'
    OR (
      dns_verified_at IS NOT NULL
      AND tls_ready_at IS NOT NULL
      AND payments_ready_at IS NOT NULL
      AND activated_at IS NOT NULL
    )
  ),
  CONSTRAINT advocate_domains_redirect_check CHECK (
    redirect_to_domain_id IS NULL OR redirect_to_domain_id <> id
  ),
  CONSTRAINT advocate_domains_deactivation_check CHECK (
    deactivated_at IS NULL OR status IN ('redirecting', 'disabled')
  ),
  CONSTRAINT advocate_domains_id_advocate_unique UNIQUE (id, advocate_id),
  CONSTRAINT advocate_domains_redirect_same_advocate_fkey
    FOREIGN KEY (redirect_to_domain_id, advocate_id)
    REFERENCES public.advocate_domains(id, advocate_id)
    ON DELETE SET NULL (redirect_to_domain_id)
);

CREATE UNIQUE INDEX advocate_domains_hostname_uidx
  ON public.advocate_domains (hostname);
CREATE UNIQUE INDEX advocate_domains_one_primary_uidx
  ON public.advocate_domains (advocate_id)
  WHERE is_primary;
CREATE INDEX advocate_domains_advocate_status_idx
  ON public.advocate_domains (advocate_id, status);

COMMENT ON TABLE public.advocate_domains IS
  'Exact Creator Share hostnames assigned to one advocate. Exact records are provisioned by API for the MVP; custom parent domains are a later extension.';
COMMENT ON COLUMN public.advocate_domains.payments_ready_at IS
  'Set after the configured payment path and provider canaries succeed for this exact hostname.';

CREATE TABLE public.advocate_domain_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL,
  provider public.advocate_domain_integration_provider NOT NULL,
  environment text NOT NULL,
  status public.advocate_domain_integration_status NOT NULL DEFAULT 'pending',
  is_required boolean NOT NULL DEFAULT true,
  external_identifier text,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamp with time zone,
  ready_at timestamp with time zone,
  disabled_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_domain_integrations_environment_check CHECK (
    (provider IN ('cloudflare', 'vercel') AND environment = 'production')
    OR (provider IN ('stripe_us', 'stripe_uk') AND environment IN ('test', 'live'))
    OR (provider = 'paypal' AND environment IN ('sandbox', 'live'))
  ),
  CONSTRAINT advocate_domain_integrations_metadata_object_check CHECK (
    jsonb_typeof(provider_metadata) = 'object'
  ),
  CONSTRAINT advocate_domain_integrations_ready_state_check CHECK (
    status <> 'ready' OR ready_at IS NOT NULL
  ),
  CONSTRAINT advocate_domain_integrations_disabled_state_check CHECK (
    disabled_at IS NULL OR status = 'disabled'
  ),
  CONSTRAINT advocate_domain_integrations_domain_fkey
    FOREIGN KEY (domain_id, advocate_id)
    REFERENCES public.advocate_domains(id, advocate_id)
    ON DELETE CASCADE,
  CONSTRAINT advocate_domain_integrations_domain_provider_unique
    UNIQUE (domain_id, provider, environment),
  CONSTRAINT advocate_domain_integrations_id_domain_advocate_unique
    UNIQUE (id, domain_id, advocate_id)
);

CREATE INDEX advocate_domain_integrations_readiness_idx
  ON public.advocate_domain_integrations (domain_id, is_required, status);

COMMENT ON TABLE public.advocate_domain_integrations IS
  'Per-host external provisioning state for Cloudflare, Vercel, Stripe accounts and environments, and PayPal canaries.';
COMMENT ON COLUMN public.advocate_domain_integrations.provider_metadata IS
  'Non-secret provider state only. Credentials and API tokens must remain in the deployment secret store.';

CREATE TABLE public.domain_provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  kind public.domain_provisioning_job_kind NOT NULL,
  provider public.advocate_domain_integration_provider NOT NULL,
  status public.domain_provisioning_job_status NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL DEFAULT (
    'domain-job:' || gen_random_uuid()::text
  ),
  provider_idempotency_key text NOT NULL DEFAULT encode(
    extensions.gen_random_bytes(32),
    'hex'
  ),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  run_after timestamp with time zone NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  leased_at timestamp with time zone,
  lease_expires_at timestamp with time zone,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  reconciliation_required boolean NOT NULL DEFAULT true,
  reconciliation_outcome text,
  reconciled_at timestamp with time zone,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT domain_provisioning_jobs_idempotency_key_check CHECK (
    idempotency_key ~ '^domain-job:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT domain_provisioning_jobs_provider_idempotency_key_check CHECK (
    provider_idempotency_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT domain_provisioning_jobs_attempts_check CHECK (
    attempt_count >= 0 AND max_attempts BETWEEN 1 AND 20 AND attempt_count <= max_attempts
  ),
  CONSTRAINT domain_provisioning_jobs_payload_objects_check CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND jsonb_typeof(result_payload) = 'object'
    AND pg_column_size(request_payload) <= 2048
    AND pg_column_size(result_payload) <= 4096
  ),
  CONSTRAINT domain_provisioning_jobs_lease_check CHECK (
    num_nulls(lease_owner, lease_token, leased_at, lease_expires_at) IN (0, 4)
    AND (
      lease_owner IS NULL
      OR (
        char_length(lease_owner) BETWEEN 1 AND 128
        AND lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
        AND lease_expires_at > leased_at
        AND lease_expires_at <= leased_at + interval '15 minutes'
      )
    )
  ),
  CONSTRAINT domain_provisioning_jobs_lifecycle_shape_check CHECK (
    (
      status = 'queued'
      AND lease_token IS NULL
      AND finished_at IS NULL
    )
    OR (
      status = 'running'
      AND lease_token IS NOT NULL
      AND started_at IS NOT NULL
      AND finished_at IS NULL
    )
    OR (
      status IN ('succeeded', 'failed', 'cancelled')
      AND lease_token IS NULL
      AND finished_at IS NOT NULL
    )
  ),
  CONSTRAINT domain_provisioning_jobs_reconciliation_check CHECK (
    (reconciliation_outcome IS NULL) = (reconciled_at IS NULL)
    AND (
      reconciliation_outcome IS NULL
      OR reconciliation_outcome IN (
        'not_found',
        'matches_intent',
        'needs_apply',
        'conflict',
        'inconclusive'
      )
    )
  ),
  CONSTRAINT domain_provisioning_jobs_terminal_error_check CHECK (
    (status = 'succeeded' AND last_error IS NULL AND NOT reconciliation_required)
    OR (status IN ('failed', 'cancelled') AND last_error IS NOT NULL)
    OR status IN ('queued', 'running')
  ),
  CONSTRAINT domain_provisioning_jobs_success_verification_check CHECK (
    status <> 'succeeded'
    OR result_payload @> '{"verified":true}'::jsonb
  ),
  CONSTRAINT domain_provisioning_jobs_error_code_check CHECK (
    last_error IS NULL
    OR (
      char_length(last_error) BETWEEN 1 AND 120
      AND last_error ~ '^[a-z0-9][a-z0-9._:-]*$'
    )
  ),
  CONSTRAINT domain_provisioning_jobs_domain_fkey
    FOREIGN KEY (domain_id, advocate_id)
    REFERENCES public.advocate_domains(id, advocate_id)
    ON DELETE CASCADE,
  CONSTRAINT domain_provisioning_jobs_integration_fkey
    FOREIGN KEY (integration_id, domain_id, advocate_id)
    REFERENCES public.advocate_domain_integrations(id, domain_id, advocate_id)
    ON DELETE CASCADE,
  UNIQUE (idempotency_key),
  UNIQUE (provider_idempotency_key)
);

CREATE INDEX domain_provisioning_jobs_queue_idx
  ON public.domain_provisioning_jobs (run_after, created_at)
  WHERE status = 'queued';
CREATE INDEX domain_provisioning_jobs_domain_idx
  ON public.domain_provisioning_jobs (domain_id, created_at DESC);
CREATE UNIQUE INDEX domain_provisioning_jobs_one_open_integration_uidx
  ON public.domain_provisioning_jobs (integration_id)
  WHERE status IN ('queued', 'running');

COMMENT ON TABLE public.domain_provisioning_jobs IS
  'Durable provider work queue. Callers enqueue and workers claim or settle jobs only through narrow audited RPCs; direct mutation is forbidden.';
COMMENT ON COLUMN public.domain_provisioning_jobs.request_payload IS
  'Versioned, allowlisted non-secret work input. Provider credentials, response bodies, headers, cookies, contact data, and signed URLs must never be persisted here.';
COMMENT ON COLUMN public.domain_provisioning_jobs.provider_idempotency_key IS
  'Stable key reused for every provider attempt. Workers must reconcile provider state before mutation and must never generate a replacement key during retries.';
COMMENT ON COLUMN public.domain_provisioning_jobs.lease_token IS
  'Opaque, short-lived fencing token. Every worker reconciliation, completion, retry, and cancellation must present the current unexpired token.';
COMMENT ON COLUMN public.domain_provisioning_jobs.result_payload IS
  'Allowlisted non-secret provider identifiers and status evidence only. Raw provider responses are prohibited.';

CREATE TABLE public.advocate_branding (
  advocate_id uuid PRIMARY KEY REFERENCES public.advocates(id) ON DELETE CASCADE,
  primary_color text NOT NULL DEFAULT '#1C3C8C',
  accent_color text NOT NULL DEFAULT '#F4B942',
  logo_storage_path text,
  logo_alt_text text,
  opening_header_html text NOT NULL DEFAULT '',
  about_biography_html text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_branding_primary_color_check CHECK (
    primary_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  CONSTRAINT advocate_branding_accent_color_check CHECK (
    accent_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  CONSTRAINT advocate_branding_logo_path_check CHECK (
    logo_storage_path IS NULL
    OR (
      char_length(logo_storage_path) BETWEEN 1 AND 1024
      AND logo_storage_path !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
      AND logo_storage_path !~ '(^|/)\.\.(/|$)'
    )
  ),
  CONSTRAINT advocate_branding_logo_alt_text_check CHECK (
    logo_alt_text IS NULL OR char_length(logo_alt_text) <= 300
  ),
  CONSTRAINT advocate_branding_opening_header_size_check CHECK (
    octet_length(opening_header_html) <= 50000
  ),
  CONSTRAINT advocate_branding_about_size_check CHECK (
    octet_length(about_biography_html) <= 200000
  )
);

COMMENT ON TABLE public.advocate_branding IS
  'MVP branding fields: primary and accent colors, one logo, an opening header, and an About biography.';
COMMENT ON COLUMN public.advocate_branding.opening_header_html IS
  'Sanitized rich-text HTML. The application must sanitize against the approved allowlist on write and render.';
COMMENT ON COLUMN public.advocate_branding.about_biography_html IS
  'Sanitized rich-text HTML. The application must sanitize against the approved allowlist on write and render.';

CREATE TABLE public.advocate_public_metric_selections (
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  metric_key public.advocate_public_metric_key NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (advocate_id, metric_key),
  CONSTRAINT advocate_public_metric_display_order_check CHECK (display_order >= 0),
  UNIQUE (advocate_id, display_order)
);

COMMENT ON TABLE public.advocate_public_metric_selections IS
  'Allowlisted aggregate metrics an advocate elects to show publicly. Metric calculation and privacy thresholds are enforced by the analytics layer.';

CREATE TABLE public.advocate_beneficiaries (
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES public.beneficiaries(id) ON DELETE CASCADE,
  is_featured boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (advocate_id, beneficiary_id),
  CONSTRAINT advocate_beneficiaries_display_order_check CHECK (display_order >= 0)
);

CREATE INDEX advocate_beneficiaries_featured_order_idx
  ON public.advocate_beneficiaries (advocate_id, is_featured DESC, display_order, beneficiary_id);

COMMENT ON TABLE public.advocate_beneficiaries IS
  'Explicit beneficiary selections and featured ordering. Runtime queries must always intersect these rows with canonical Creator Share eligibility.';

CREATE TABLE public.advocate_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.advocate_membership_status NOT NULL DEFAULT 'active',
  suspended_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_memberships_suspension_check CHECK (
    suspended_at IS NULL OR status = 'suspended'
  ),
  CONSTRAINT advocate_memberships_revocation_check CHECK (
    revoked_at IS NULL OR status = 'revoked'
  ),
  CONSTRAINT advocate_memberships_advocate_user_unique UNIQUE (advocate_id, user_id),
  CONSTRAINT advocate_memberships_id_advocate_unique UNIQUE (id, advocate_id)
);

CREATE INDEX advocate_memberships_user_advocate_status_idx
  ON public.advocate_memberships (user_id, advocate_id, status);
CREATE INDEX advocate_memberships_advocate_status_idx
  ON public.advocate_memberships (advocate_id, status);

COMMENT ON TABLE public.advocate_memberships IS
  'Portal-scoped user membership. Permissions are the union of assigned predefined roles and are never sourced from user_metadata.';

CREATE TABLE public.advocate_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  can_be_invited boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_roles_key_check CHECK (
    key = lower(key) AND key ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  CONSTRAINT advocate_roles_display_name_check CHECK (
    char_length(btrim(display_name)) BETWEEN 1 AND 100
  )
);

CREATE TABLE public.advocate_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  description text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_permissions_key_check CHECK (
    key = lower(key) AND key ~ '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$'
  )
);

CREATE TABLE public.advocate_role_permissions (
  role_id uuid NOT NULL REFERENCES public.advocate_roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.advocate_permissions(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX advocate_role_permissions_permission_idx
  ON public.advocate_role_permissions (permission_id, role_id);

CREATE TABLE public.advocate_membership_roles (
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES public.advocate_roles(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, role_id),
  CONSTRAINT advocate_membership_roles_membership_fkey
    FOREIGN KEY (membership_id, advocate_id)
    REFERENCES public.advocate_memberships(id, advocate_id)
    ON DELETE CASCADE
);

CREATE INDEX advocate_membership_roles_advocate_idx
  ON public.advocate_membership_roles (advocate_id, membership_id);
CREATE INDEX advocate_membership_roles_role_idx
  ON public.advocate_membership_roles (role_id, membership_id);

COMMENT ON TABLE public.advocate_roles IS
  'Predefined portal role templates. Custom role construction is intentionally outside the MVP.';
COMMENT ON TABLE public.advocate_permissions IS
  'Stable permission keys used by both application authorization and database RLS.';
COMMENT ON TABLE public.advocate_membership_roles IS
  'Many-to-many role assignment for portal delegates. Permissions are unioned across roles.';

CREATE TABLE public.advocate_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_digest bytea NOT NULL UNIQUE,
  expires_at timestamp with time zone NOT NULL,
  accepted_at timestamp with time zone,
  accepted_by_user_id uuid,
  revoked_at timestamp with time zone,
  revoked_by_user_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_sent_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT advocate_invitations_email_normalized_check CHECK (
    email = lower(btrim(email))
    AND char_length(email) BETWEEN 3 AND 320
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  CONSTRAINT advocate_invitations_token_digest_check CHECK (
    octet_length(token_digest) = 32
  ),
  CONSTRAINT advocate_invitations_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '7 days'
  ),
  CONSTRAINT advocate_invitations_acceptance_check CHECK (
    (accepted_at IS NULL) = (accepted_by_user_id IS NULL)
  ),
  CONSTRAINT advocate_invitations_revocation_check CHECK (
    (revoked_at IS NULL) = (revoked_by_user_id IS NULL)
  ),
  CONSTRAINT advocate_invitations_terminal_state_check CHECK (
    accepted_at IS NULL OR revoked_at IS NULL
  ),
  CONSTRAINT advocate_invitations_id_advocate_unique UNIQUE (id, advocate_id)
);

CREATE UNIQUE INDEX advocate_invitations_one_pending_email_uidx
  ON public.advocate_invitations (advocate_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX advocate_invitations_expiry_idx
  ON public.advocate_invitations (expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE public.advocate_invitation_roles (
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES public.advocate_roles(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, role_id),
  CONSTRAINT advocate_invitation_roles_invitation_fkey
    FOREIGN KEY (invitation_id, advocate_id)
    REFERENCES public.advocate_invitations(id, advocate_id)
    ON DELETE CASCADE,
  CONSTRAINT advocate_invitation_roles_owner_check CHECK (
    role_id <> '00000000-0000-4000-8000-000000000001'::uuid
  )
);

CREATE INDEX advocate_invitation_roles_advocate_idx
  ON public.advocate_invitation_roles (advocate_id, invitation_id);

COMMENT ON TABLE public.advocate_invitations IS
  'Server-issued, email-bound, expiring, single-use portal invitation. Only a SHA-256 token digest is stored.';
COMMENT ON COLUMN public.advocate_invitations.token_digest IS
  'SHA-256 digest of a 256-bit random plaintext token. The plaintext is returned once by the invitation creation function.';
COMMENT ON TABLE public.advocate_invitation_roles IS
  'Role set granted atomically at invitation redemption. Owner cannot be granted through invitation.';

-- Stable identifiers make the owner uniqueness constraint deterministic and
-- keep seeded role references identical across environments.
INSERT INTO public.advocate_roles (
  id,
  key,
  display_name,
  description,
  is_system,
  can_be_invited
)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner', 'Owner', 'Full portal control, ownership transfer, and lifecycle actions.', true, false),
  ('00000000-0000-4000-8000-000000000002', 'administrator', 'Administrator', 'All operational portal controls except ownership transfer and archival.', true, true),
  ('00000000-0000-4000-8000-000000000003', 'brand_editor', 'Brand Editor', 'Branding and public metric configuration.', true, true),
  ('00000000-0000-4000-8000-000000000004', 'catalog_curator', 'Catalog Curator', 'Beneficiary selection, featuring, and ordering.', true, true),
  ('00000000-0000-4000-8000-000000000005', 'analytics_viewer', 'Analytics Viewer', 'Private aggregate advocate analytics.', true, true),
  ('00000000-0000-4000-8000-000000000006', 'audit_viewer', 'Audit Viewer', 'Sanitized advocate-scoped audit history.', true, true)
ON CONFLICT (key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  can_be_invited = EXCLUDED.can_be_invited,
  updated_at = now();

INSERT INTO public.advocate_permissions (id, key, description)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'portal.view', 'View private portal administration surfaces.'),
  ('10000000-0000-4000-8000-000000000002', 'portal.settings.update', 'Update non-destructive portal settings.'),
  ('10000000-0000-4000-8000-000000000003', 'portal.branding.update', 'Update branding fields and logo selection.'),
  ('10000000-0000-4000-8000-000000000004', 'portal.public_metrics.update', 'Choose allowlisted metrics shown publicly.'),
  ('10000000-0000-4000-8000-000000000005', 'portal.beneficiaries.manage', 'Select, feature, and order eligible beneficiaries.'),
  ('10000000-0000-4000-8000-000000000006', 'portal.analytics.view', 'View private aggregate analytics.'),
  ('10000000-0000-4000-8000-000000000007', 'portal.members.view', 'View portal delegates and role assignments.'),
  ('10000000-0000-4000-8000-000000000008', 'portal.members.invite', 'Create and revoke non-owner portal invitations.'),
  ('10000000-0000-4000-8000-000000000009', 'portal.members.manage', 'Suspend delegates and manage non-owner role assignments.'),
  ('10000000-0000-4000-8000-000000000010', 'portal.audit.view', 'View sanitized advocate-scoped audit history.'),
  ('10000000-0000-4000-8000-000000000011', 'portal.domains.view', 'View domain publication readiness.'),
  ('10000000-0000-4000-8000-000000000012', 'portal.domains.manage', 'Request domain publication and reconciliation.'),
  ('10000000-0000-4000-8000-000000000013', 'portal.archive', 'Archive the advocate portal.'),
  ('10000000-0000-4000-8000-000000000014', 'portal.ownership.transfer', 'Transfer sole portal ownership atomically.')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

INSERT INTO public.advocate_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.advocate_roles r
CROSS JOIN public.advocate_permissions p
WHERE r.key = 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO public.advocate_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.advocate_roles r
CROSS JOIN public.advocate_permissions p
WHERE r.key = 'administrator'
  AND p.key NOT IN ('portal.archive', 'portal.ownership.transfer')
ON CONFLICT DO NOTHING;

INSERT INTO public.advocate_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.advocate_roles r
JOIN public.advocate_permissions p
  ON p.key IN ('portal.view', 'portal.branding.update', 'portal.public_metrics.update')
WHERE r.key = 'brand_editor'
ON CONFLICT DO NOTHING;

INSERT INTO public.advocate_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.advocate_roles r
JOIN public.advocate_permissions p
  ON p.key IN ('portal.view', 'portal.beneficiaries.manage')
WHERE r.key = 'catalog_curator'
ON CONFLICT DO NOTHING;

INSERT INTO public.advocate_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.advocate_roles r
JOIN public.advocate_permissions p
  ON p.key IN ('portal.view', 'portal.analytics.view')
WHERE r.key = 'analytics_viewer'
ON CONFLICT DO NOTHING;

INSERT INTO public.advocate_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.advocate_roles r
JOIN public.advocate_permissions p
  ON p.key IN ('portal.view', 'portal.audit.view')
WHERE r.key = 'audit_viewer'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION private.prevent_advocate_dictionary_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Predefined advocate dictionaries are migration owned'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_advocate_dictionary_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_roles_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_roles
FOR EACH ROW EXECUTE FUNCTION private.prevent_advocate_dictionary_mutation();

CREATE TRIGGER advocate_permissions_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_permissions
FOR EACH ROW EXECUTE FUNCTION private.prevent_advocate_dictionary_mutation();

CREATE TRIGGER advocate_role_permissions_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_role_permissions
FOR EACH ROW EXECUTE FUNCTION private.prevent_advocate_dictionary_mutation();

CREATE TRIGGER advocate_reserved_subdomains_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_reserved_subdomains
FOR EACH ROW EXECUTE FUNCTION private.prevent_advocate_dictionary_mutation();

CREATE UNIQUE INDEX advocate_membership_roles_one_owner_uidx
  ON public.advocate_membership_roles (advocate_id)
  WHERE role_id = '00000000-0000-4000-8000-000000000001'::uuid;

ALTER TABLE public.advocates
  ADD COLUMN owner_membership_id uuid,
  ADD CONSTRAINT advocates_owner_membership_fkey
    FOREIGN KEY (owner_membership_id, id)
    REFERENCES public.advocate_memberships(id, advocate_id)
    ON DELETE SET NULL (owner_membership_id);

COMMENT ON COLUMN public.advocates.owner_membership_id IS
  'Sole active owner membership. Active and suspended advocate relationships must retain exactly one active owner. Invited and archived records may be ownerless.';

CREATE OR REPLACE FUNCTION private.assert_advocate_owner_invariant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate_id uuid;
  v_advocate_ids uuid[];
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
  v_owner_membership_id uuid;
  v_owner_count integer;
  v_pointer_is_active_owner boolean;
BEGIN
  IF TG_TABLE_NAME = 'advocates' THEN
    IF TG_OP = 'INSERT' THEN
      v_advocate_ids := ARRAY[NEW.id];
    ELSIF TG_OP = 'DELETE' THEN
      v_advocate_ids := ARRAY[OLD.id];
    ELSE
      v_advocate_ids := ARRAY[OLD.id, NEW.id];
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      v_advocate_ids := ARRAY[NEW.advocate_id];
    ELSIF TG_OP = 'DELETE' THEN
      v_advocate_ids := ARRAY[OLD.advocate_id];
    ELSE
      v_advocate_ids := ARRAY[OLD.advocate_id, NEW.advocate_id];
    END IF;
  END IF;

  FOR v_advocate_id IN
    SELECT DISTINCT candidate.advocate_id
    FROM unnest(v_advocate_ids) AS candidate(advocate_id)
    WHERE candidate.advocate_id IS NOT NULL
  LOOP
    SELECT
      advocate.relationship_status,
      advocate.publication_status,
      advocate.owner_membership_id
    INTO
      v_relationship_status,
      v_publication_status,
      v_owner_membership_id
    FROM public.advocates advocate
    WHERE advocate.id = v_advocate_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT
      count(*)::integer,
      COALESCE(bool_or(
        membership.id = v_owner_membership_id
        AND membership.status = 'active'
      ), false)
    INTO v_owner_count, v_pointer_is_active_owner
    FROM public.advocate_membership_roles membership_role
    JOIN public.advocate_memberships membership
      ON membership.id = membership_role.membership_id
     AND membership.advocate_id = membership_role.advocate_id
    WHERE membership_role.advocate_id = v_advocate_id
      AND membership_role.role_id = '00000000-0000-4000-8000-000000000001'::uuid;

    IF v_owner_membership_id IS NULL AND v_owner_count <> 0 THEN
      RAISE EXCEPTION 'Advocate owner role exists without the owner membership pointer'
        USING ERRCODE = '23514';
    END IF;

    IF v_owner_membership_id IS NOT NULL
       AND (v_owner_count <> 1 OR NOT v_pointer_is_active_owner) THEN
      RAISE EXCEPTION 'Advocate owner pointer must name its sole active owner role membership'
        USING ERRCODE = '23514';
    END IF;

    IF (
         v_relationship_status IN ('active', 'suspended')
         OR v_publication_status = 'active'
       )
       AND v_owner_membership_id IS NULL THEN
      RAISE EXCEPTION 'An active advocate portal requires one active owner'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_advocate_owner_invariant()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER advocates_owner_invariant
AFTER INSERT OR UPDATE OR DELETE ON public.advocates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_advocate_owner_invariant();

CREATE CONSTRAINT TRIGGER advocate_memberships_owner_invariant
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_advocate_owner_invariant();

CREATE CONSTRAINT TRIGGER advocate_membership_roles_owner_invariant
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_membership_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_advocate_owner_invariant();

CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.touch_updated_at() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.prepare_advocate_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = NEW.slug
  ) THEN
    RAISE EXCEPTION 'Advocate subdomain label is reserved'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.published_at IS NOT NULL
       OR NEW.suspended_at IS NOT NULL
       OR NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Advocate lifecycle timestamps are server managed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.relationship_status <> 'active'
       AND NEW.publication_status IN ('provisioning', 'active') THEN
      RAISE EXCEPTION 'Only an active advocate relationship can provision or publish a portal'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.relationship_status = 'archived' THEN
      NEW.publication_status := 'suspended';
      NEW.archived_at := v_now;
      NEW.suspended_at := v_now;
    ELSIF NEW.relationship_status = 'suspended'
       OR NEW.publication_status = 'suspended' THEN
      NEW.publication_status := 'suspended';
      NEW.suspended_at := v_now;
    ELSIF NEW.publication_status = 'active' THEN
      NEW.published_at := v_now;
    END IF;

    NEW.version := 1;
    NEW.updated_at := v_now;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Advocate identity fields are immutable'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Advocate lifecycle timestamps are server managed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.relationship_status IS DISTINCT FROM OLD.relationship_status
       AND NOT (
         (OLD.relationship_status = 'invited'
           AND NEW.relationship_status IN ('active', 'suspended', 'archived'))
         OR (OLD.relationship_status = 'active'
           AND NEW.relationship_status IN ('suspended', 'archived'))
         OR (OLD.relationship_status = 'suspended'
           AND NEW.relationship_status IN ('active', 'archived'))
       ) THEN
      RAISE EXCEPTION 'Illegal advocate relationship transition from % to %',
        OLD.relationship_status,
        NEW.relationship_status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.relationship_status IN ('suspended', 'archived') THEN
      NEW.publication_status := 'suspended';
    END IF;

    IF NEW.publication_status IS DISTINCT FROM OLD.publication_status
       AND NOT (
         (OLD.publication_status = 'draft'
           AND NEW.publication_status IN ('provisioning', 'suspended'))
         OR (OLD.publication_status = 'provisioning'
           AND NEW.publication_status IN ('draft', 'active', 'failed', 'suspended'))
         OR (OLD.publication_status = 'active'
           AND NEW.publication_status IN ('failed', 'suspended'))
         OR (OLD.publication_status = 'failed'
           AND NEW.publication_status IN ('draft', 'provisioning', 'suspended'))
         OR (OLD.publication_status = 'suspended'
           AND NEW.publication_status IN ('draft', 'provisioning'))
       ) THEN
      RAISE EXCEPTION 'Illegal advocate publication transition from % to %',
        OLD.publication_status,
        NEW.publication_status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.relationship_status <> 'active'
       AND NEW.publication_status IN ('provisioning', 'active') THEN
      RAISE EXCEPTION 'Only an active advocate relationship can provision or publish a portal'
        USING ERRCODE = '23514';
    END IF;

    NEW.published_at := OLD.published_at;
    IF NEW.publication_status = 'active'
       AND OLD.publication_status <> 'active'
       AND NEW.published_at IS NULL THEN
      NEW.published_at := v_now;
    END IF;

    IF NEW.relationship_status = 'archived' THEN
      NEW.archived_at := COALESCE(OLD.archived_at, v_now);
    ELSE
      NEW.archived_at := NULL;
    END IF;

    IF NEW.relationship_status = 'suspended'
       OR NEW.publication_status = 'suspended' THEN
      NEW.suspended_at := CASE
        WHEN OLD.relationship_status = 'suspended'
          OR OLD.publication_status = 'suspended'
          THEN COALESCE(OLD.suspended_at, v_now)
        ELSE v_now
      END;
    ELSE
      NEW.suspended_at := NULL;
    END IF;

    NEW.version := OLD.version + 1;
    NEW.updated_at := v_now;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prepare_advocate_row()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.validate_and_prepare_advocate_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
  v_now timestamp with time zone := clock_timestamp();
  v_ready_count integer;
  v_required_not_ready integer;
  v_dns_ready_at timestamp with time zone;
  v_tls_ready_at timestamp with time zone;
  v_payments_ready_at timestamp with time zone;
BEGIN
  SELECT advocate.slug
  INTO v_slug
  FROM public.advocates advocate
  WHERE advocate.id = NEW.advocate_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate domain references an unknown advocate'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.hostname <> v_slug || '.creatorshare.com' THEN
    RAISE EXCEPTION 'Advocate domain hostname must match the immutable advocate slug'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = split_part(NEW.hostname, '.', 1)
  ) THEN
    RAISE EXCEPTION 'Advocate domain hostname uses a reserved label'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.dns_verified_at IS NOT NULL
       OR NEW.tls_ready_at IS NOT NULL
       OR NEW.payments_ready_at IS NOT NULL
       OR NEW.activated_at IS NOT NULL
       OR NEW.deactivated_at IS NOT NULL
       OR NEW.redirect_to_domain_id IS NOT NULL
       OR NEW.failure_code IS NOT NULL
       OR NEW.failure_detail IS NOT NULL THEN
      RAISE EXCEPTION 'Advocate domains must begin pending without caller supplied lifecycle evidence'
        USING ERRCODE = '23514';
    END IF;

    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.hostname IS DISTINCT FROM OLD.hostname
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Advocate domain identity fields are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.dns_verified_at IS DISTINCT FROM OLD.dns_verified_at
       OR NEW.tls_ready_at IS DISTINCT FROM OLD.tls_ready_at
       OR NEW.payments_ready_at IS DISTINCT FROM OLD.payments_ready_at
       OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
       OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
       OR NEW.redirect_to_domain_id IS DISTINCT FROM OLD.redirect_to_domain_id THEN
      RAISE EXCEPTION 'Advocate domain lifecycle evidence requires a legal status transition'
        USING ERRCODE = '42501';
    END IF;

    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('provisioning', 'disabled'))
    OR (OLD.status = 'provisioning' AND NEW.status IN ('verifying', 'failed', 'disabled'))
    OR (OLD.status = 'verifying' AND NEW.status IN ('active', 'failed', 'disabled'))
    OR (OLD.status = 'failed' AND NEW.status IN ('provisioning', 'disabled'))
    OR (OLD.status = 'active' AND NEW.status IN ('redirecting', 'disabled'))
    OR (OLD.status = 'redirecting' AND NEW.status IN ('active', 'disabled'))
    OR (OLD.status = 'disabled' AND NEW.status = 'provisioning')
  ) THEN
    RAISE EXCEPTION 'Illegal advocate domain status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    WITH expected(provider, environment) AS (
      VALUES
        ('cloudflare', 'production'),
        ('vercel', 'production'),
        ('stripe_us', 'live'),
        ('stripe_uk', 'live'),
        ('paypal', 'live')
    )
    SELECT count(*)::integer
    INTO v_ready_count
    FROM expected
    JOIN public.advocate_domain_integrations integration
      ON integration.domain_id = NEW.id
     AND integration.advocate_id = NEW.advocate_id
     AND integration.provider::text = expected.provider
     AND integration.environment = expected.environment
     AND integration.is_required
     AND integration.status = 'ready'
     AND integration.ready_at IS NOT NULL;

    SELECT count(*)::integer
    INTO v_required_not_ready
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = NEW.id
      AND integration.is_required
      AND (
        integration.status <> 'ready'
        OR integration.ready_at IS NULL
      );

    IF v_ready_count <> 5 OR v_required_not_ready <> 0 THEN
      RAISE EXCEPTION 'Advocate domain cannot activate until every required integration is ready'
        USING ERRCODE = '55000';
    END IF;

    SELECT
      max(integration.ready_at) FILTER (WHERE integration.provider = 'cloudflare'),
      max(integration.ready_at) FILTER (WHERE integration.provider = 'vercel'),
      max(integration.ready_at) FILTER (
        WHERE integration.provider IN ('stripe_us', 'stripe_uk', 'paypal')
      )
    INTO v_dns_ready_at, v_tls_ready_at, v_payments_ready_at
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = NEW.id
      AND integration.is_required
      AND integration.status = 'ready';

    NEW.dns_verified_at := v_dns_ready_at;
    NEW.tls_ready_at := v_tls_ready_at;
    NEW.payments_ready_at := v_payments_ready_at;
    NEW.activated_at := v_now;
    NEW.deactivated_at := NULL;
    NEW.redirect_to_domain_id := NULL;
    NEW.failure_code := NULL;
    NEW.failure_detail := NULL;
  ELSIF NEW.status = 'failed' THEN
    IF nullif(btrim(NEW.failure_code), '') IS NULL THEN
      RAISE EXCEPTION 'Failed advocate domains require a failure code'
        USING ERRCODE = '23514';
    END IF;
    NEW.redirect_to_domain_id := NULL;
  ELSIF NEW.status = 'redirecting' THEN
    IF NEW.redirect_to_domain_id IS NULL THEN
      RAISE EXCEPTION 'Redirecting advocate domains require a target domain'
        USING ERRCODE = '23514';
    END IF;
    NEW.deactivated_at := v_now;
  ELSIF NEW.status = 'disabled' THEN
    NEW.deactivated_at := v_now;
    NEW.redirect_to_domain_id := NULL;
  ELSE
    NEW.redirect_to_domain_id := NULL;
    NEW.failure_code := NULL;
    NEW.failure_detail := NULL;
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_and_prepare_advocate_domain()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_and_prepare_domain_integration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_domain_id uuid;
  v_advocate_id uuid;
  v_domain_status public.advocate_domain_status;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_domain_id := OLD.domain_id;
    v_advocate_id := OLD.advocate_id;
  ELSE
    v_domain_id := NEW.domain_id;
    v_advocate_id := NEW.advocate_id;
  END IF;

  SELECT domain.status
  INTO v_domain_status
  FROM public.advocate_domains domain
  WHERE domain.id = v_domain_id
    AND domain.advocate_id = v_advocate_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration references an unknown advocate domain'
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_domain_status = 'active' AND OLD.is_required THEN
      RAISE EXCEPTION 'Required integrations cannot be removed from an active advocate domain'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.ready_at IS NOT NULL
       OR NEW.disabled_at IS NOT NULL
       OR NEW.last_error IS NOT NULL THEN
      RAISE EXCEPTION 'Domain integrations must begin pending without caller supplied lifecycle evidence'
        USING ERRCODE = '23514';
    END IF;

    IF v_domain_status = 'active' AND NEW.is_required THEN
      RAISE EXCEPTION 'Required integrations cannot be added to an active advocate domain'
        USING ERRCODE = '55000';
    END IF;

    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.domain_id IS DISTINCT FROM OLD.domain_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.is_required IS DISTINCT FROM OLD.is_required
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Domain integration identity and requirement fields are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF v_domain_status = 'active'
     AND OLD.is_required
     AND NEW.status <> 'ready' THEN
    RAISE EXCEPTION 'Deactivate the advocate domain before changing a required integration'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.ready_at IS DISTINCT FROM OLD.ready_at
       OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
       OR NEW.last_error IS DISTINCT FROM OLD.last_error THEN
      RAISE EXCEPTION 'Domain integration lifecycle evidence requires a legal status transition'
        USING ERRCODE = '42501';
    END IF;

    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('provisioning', 'disabled'))
    OR (OLD.status = 'provisioning' AND NEW.status IN ('ready', 'failed', 'disabled'))
    OR (OLD.status = 'failed' AND NEW.status IN ('provisioning', 'disabled'))
    OR (OLD.status = 'ready' AND NEW.status IN ('failed', 'disabled'))
    OR (OLD.status = 'disabled' AND NEW.status = 'provisioning')
  ) THEN
    RAISE EXCEPTION 'Illegal domain integration status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'ready' THEN
    NEW.ready_at := v_now;
    NEW.disabled_at := NULL;
    NEW.last_error := NULL;
  ELSIF NEW.status = 'failed' THEN
    IF nullif(btrim(NEW.last_error), '') IS NULL THEN
      RAISE EXCEPTION 'Failed domain integrations require an error summary'
        USING ERRCODE = '23514';
    END IF;
    NEW.ready_at := NULL;
    NEW.disabled_at := NULL;
  ELSIF NEW.status = 'disabled' THEN
    NEW.ready_at := NULL;
    NEW.disabled_at := v_now;
  ELSE
    NEW.ready_at := NULL;
    NEW.disabled_at := NULL;
    NEW.last_error := NULL;
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_and_prepare_domain_integration()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_safe_domain_provisioning_payload(
  payload jsonb,
  payload_kind text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'Domain provisioning payload must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF payload_kind = 'request' THEN
    IF pg_column_size(payload) > 2048
       OR payload <> jsonb_build_object(
         'schema_version', 1,
         'reconciliation_policy', 'lookup_before_mutation'
       ) THEN
      RAISE EXCEPTION 'Domain provisioning request payload is not allowlisted'
        USING ERRCODE = '22023';
    END IF;
    RETURN;
  END IF;

  IF payload_kind <> 'result' THEN
    RAISE EXCEPTION 'Unknown domain provisioning payload kind'
      USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(payload) > 4096 THEN
    RAISE EXCEPTION 'Domain provisioning result payload exceeds 4096 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(payload) entry
    WHERE entry.key <> ALL (ARRAY[
      'provider_operation_id',
      'provider_resource_id',
      'provider_request_id',
      'provider_status',
      'dns_record_id',
      'deployment_id',
      'http_status',
      'verified',
      'already_applied',
      'message_code'
    ]::text[])
      OR jsonb_typeof(entry.value) NOT IN ('string', 'number', 'boolean', 'null')
      OR (
        jsonb_typeof(entry.value) = 'string'
        AND (
          char_length(entry.value #>> '{}') > 500
          OR (entry.value #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Domain provisioning result payload contains unsupported data'
      USING ERRCODE = '22023';
  END IF;

  IF payload ? 'http_status'
     AND (
       jsonb_typeof(payload -> 'http_status') <> 'number'
       OR (payload ->> 'http_status') !~ '^[1-5][0-9]{2}$'
     ) THEN
    RAISE EXCEPTION 'Domain provisioning HTTP status is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (payload ? 'verified' AND jsonb_typeof(payload -> 'verified') <> 'boolean')
     OR (
       payload ? 'already_applied'
       AND jsonb_typeof(payload -> 'already_applied') <> 'boolean'
     ) THEN
    RAISE EXCEPTION 'Domain provisioning boolean result is invalid'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_safe_domain_provisioning_payload(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_and_prepare_domain_provisioning_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider public.advocate_domain_integration_provider;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Domain provisioning job history is immutable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    NEW.request_payload,
    'request'
  );
  PERFORM private.assert_safe_domain_provisioning_payload(
    NEW.result_payload,
    'result'
  );

  SELECT integration.provider
  INTO v_provider
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = NEW.integration_id
    AND integration.domain_id = NEW.domain_id
    AND integration.advocate_id = NEW.advocate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain provisioning job references an unknown integration'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.provider IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION 'Domain provisioning provider must match its integration'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued'
       OR NEW.attempt_count <> 0
       OR NEW.lease_owner IS NOT NULL
       OR NEW.lease_token IS NOT NULL
       OR NEW.leased_at IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.started_at IS NOT NULL
       OR NEW.finished_at IS NOT NULL
       OR NOT NEW.reconciliation_required
       OR NEW.reconciliation_outcome IS NOT NULL
       OR NEW.reconciled_at IS NOT NULL
       OR NEW.result_payload <> '{}'::jsonb
       OR NEW.last_error IS NOT NULL THEN
      RAISE EXCEPTION 'Domain provisioning jobs must begin in the canonical queued state'
        USING ERRCODE = '23514';
    END IF;

    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.domain_id IS DISTINCT FROM OLD.domain_id
     OR NEW.integration_id IS DISTINCT FROM OLD.integration_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Domain provisioning job tenant and input identity are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'running' THEN
      RAISE EXCEPTION 'Only a running domain job may change without a status transition'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
      IF OLD.lease_expires_at > v_now
         OR NEW.attempt_count <> OLD.attempt_count + 1
         OR NEW.lease_owner IS NULL
         OR NEW.lease_token IS NULL
         OR NEW.leased_at < v_now - interval '5 seconds'
         OR NEW.lease_expires_at <= v_now
         OR NEW.run_after IS DISTINCT FROM OLD.run_after
         OR NEW.started_at IS DISTINCT FROM OLD.started_at
         OR NEW.finished_at IS NOT NULL
         OR NOT NEW.reconciliation_required
         OR NEW.reconciliation_outcome IS NOT NULL
         OR NEW.reconciled_at IS NOT NULL
         OR NEW.result_payload <> '{}'::jsonb
         OR NEW.last_error IS NOT NULL THEN
        RAISE EXCEPTION 'A stale domain job lease may only be atomically reclaimed'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
       OR NEW.leased_at IS DISTINCT FROM OLD.leased_at THEN
      IF OLD.lease_expires_at <= v_now
         OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
         OR NEW.run_after IS DISTINCT FROM OLD.run_after
         OR NEW.lease_owner IS DISTINCT FROM OLD.lease_owner
         OR NEW.lease_token IS DISTINCT FROM OLD.lease_token
         OR NEW.leased_at < v_now - interval '5 seconds'
         OR NEW.lease_expires_at <= OLD.lease_expires_at
         OR NEW.started_at IS DISTINCT FROM OLD.started_at
         OR NEW.finished_at IS DISTINCT FROM OLD.finished_at
         OR NEW.reconciliation_required IS DISTINCT FROM OLD.reconciliation_required
         OR NEW.reconciliation_outcome IS DISTINCT FROM OLD.reconciliation_outcome
         OR NEW.reconciled_at IS DISTINCT FROM OLD.reconciled_at
         OR NEW.result_payload IS DISTINCT FROM OLD.result_payload
         OR NEW.last_error IS DISTINCT FROM OLD.last_error THEN
        RAISE EXCEPTION 'An active domain job lease may only be extended under its current token'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
         OR NEW.run_after IS DISTINCT FROM OLD.run_after
         OR NEW.lease_owner IS DISTINCT FROM OLD.lease_owner
         OR NEW.leased_at IS DISTINCT FROM OLD.leased_at
         OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
         OR NEW.started_at IS DISTINCT FROM OLD.started_at
         OR NEW.finished_at IS DISTINCT FROM OLD.finished_at
         OR NEW.last_error IS DISTINCT FROM OLD.last_error
         OR NOT OLD.reconciliation_required
         OR OLD.reconciliation_outcome IS NOT NULL
         OR OLD.reconciled_at IS NOT NULL
         OR NEW.reconciliation_outcome IS NULL
         OR NEW.reconciled_at IS NULL
         OR NEW.reconciliation_required IS DISTINCT FROM (
           NEW.reconciliation_outcome IN ('conflict', 'inconclusive')
         ) THEN
        RAISE EXCEPTION 'Running domain jobs may only record reconciliation evidence under the active lease'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF OLD.status = 'queued' AND NEW.status = 'running' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1
       OR NEW.run_after IS DISTINCT FROM OLD.run_after
       OR NEW.lease_owner IS NULL
       OR NEW.lease_token IS NULL
       OR NEW.leased_at < v_now - interval '5 seconds'
       OR NEW.lease_expires_at <= v_now
       OR NEW.started_at IS NULL
       OR (
         OLD.started_at IS NOT NULL
         AND NEW.started_at IS DISTINCT FROM OLD.started_at
       )
       OR (
         OLD.started_at IS NULL
         AND NEW.started_at < v_now - interval '5 seconds'
       )
       OR NEW.finished_at IS NOT NULL
       OR NOT NEW.reconciliation_required
       OR NEW.reconciliation_outcome IS NOT NULL
       OR NEW.reconciled_at IS NOT NULL
       OR NEW.result_payload <> '{}'::jsonb
       OR NEW.last_error IS NOT NULL THEN
      RAISE EXCEPTION 'Queued domain jobs may only transition through an atomic lease claim'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'running' AND NEW.status = 'queued' THEN
    IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.run_after < v_now
       OR NEW.run_after > v_now + interval '24 hours'
       OR NEW.lease_token IS NOT NULL
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.finished_at IS NOT NULL
       OR NOT NEW.reconciliation_required
       OR NEW.reconciliation_outcome IS NOT NULL
       OR NEW.reconciled_at IS NOT NULL
       OR NEW.last_error IS NULL THEN
      RAISE EXCEPTION 'Running domain jobs may only return to the queue through a bounded retry'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'running'
        AND NEW.status IN ('succeeded', 'failed', 'cancelled') THEN
    IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.run_after IS DISTINCT FROM OLD.run_after
       OR NEW.lease_token IS NOT NULL
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.finished_at IS NULL
       OR NEW.finished_at < v_now - interval '5 seconds'
       OR NEW.finished_at > v_now + interval '5 seconds'
       OR NEW.reconciliation_required IS DISTINCT FROM OLD.reconciliation_required
       OR NEW.reconciliation_outcome IS DISTINCT FROM OLD.reconciliation_outcome
       OR NEW.reconciled_at IS DISTINCT FROM OLD.reconciled_at
       OR (NEW.status = 'succeeded' AND NEW.reconciliation_required)
       OR (NEW.status = 'succeeded' AND NEW.last_error IS NOT NULL)
       OR (NEW.status IN ('failed', 'cancelled') AND NEW.last_error IS NULL) THEN
      RAISE EXCEPTION 'Running domain job terminal transition is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'queued' AND NEW.status = 'cancelled' THEN
    IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.run_after IS DISTINCT FROM OLD.run_after
       OR NEW.lease_token IS NOT NULL
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.finished_at IS NULL
       OR NEW.finished_at < v_now - interval '5 seconds'
       OR NEW.finished_at > v_now + interval '5 seconds'
       OR NEW.reconciliation_required IS DISTINCT FROM OLD.reconciliation_required
       OR NEW.reconciliation_outcome IS DISTINCT FROM OLD.reconciliation_outcome
       OR NEW.reconciled_at IS DISTINCT FROM OLD.reconciled_at
       OR NEW.result_payload IS DISTINCT FROM OLD.result_payload
       OR NEW.last_error IS NULL THEN
      RAISE EXCEPTION 'Queued domain job cancellation is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Illegal domain provisioning job status transition from % to %',
      OLD.status,
      NEW.status
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_and_prepare_domain_provisioning_job()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocates_touch_updated_at
BEFORE INSERT OR UPDATE ON public.advocates
FOR EACH ROW EXECUTE FUNCTION private.prepare_advocate_row();

CREATE TRIGGER advocate_domains_validate_and_prepare
BEFORE INSERT OR UPDATE ON public.advocate_domains
FOR EACH ROW EXECUTE FUNCTION private.validate_and_prepare_advocate_domain();

CREATE TRIGGER advocate_domain_integrations_validate_and_prepare
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_domain_integrations
FOR EACH ROW EXECUTE FUNCTION private.validate_and_prepare_domain_integration();

CREATE TRIGGER domain_provisioning_jobs_validate_and_prepare
BEFORE INSERT OR UPDATE OR DELETE ON public.domain_provisioning_jobs
FOR EACH ROW EXECUTE FUNCTION private.validate_and_prepare_domain_provisioning_job();

CREATE TRIGGER advocate_branding_touch_updated_at
BEFORE UPDATE ON public.advocate_branding
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER advocate_public_metric_selections_touch_updated_at
BEFORE UPDATE ON public.advocate_public_metric_selections
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER advocate_beneficiaries_touch_updated_at
BEFORE UPDATE ON public.advocate_beneficiaries
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER advocate_memberships_touch_updated_at
BEFORE UPDATE ON public.advocate_memberships
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER advocate_roles_touch_updated_at
BEFORE UPDATE ON public.advocate_roles
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE OR REPLACE FUNCTION private.is_creator_share_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    JOIN public.roles r ON r.id = ra.role_id
    WHERE ra.user_id = (SELECT auth.uid())
      AND r.name = 'SUPER_ADMIN'
      AND ra.organization_id IS NULL
      AND ra.advocate_id IS NULL
  );
$$;

REVOKE ALL ON FUNCTION private.is_creator_share_super_admin()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_creator_share_super_admin()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_global_super_admin_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role_name text;
BEGIN
  SELECT role.name
  INTO v_role_name
  FROM public.roles role
  WHERE role.id = NEW.role_id;

  IF v_role_name = 'SUPER_ADMIN'
     AND (NEW.organization_id IS NOT NULL OR NEW.advocate_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SUPER_ADMIN assignments must be global and unscoped'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_global_super_admin_assignment()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER role_assignments_validate_global_super_admin
BEFORE INSERT OR UPDATE ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION private.validate_global_super_admin_assignment();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE role.name = 'SUPER_ADMIN'
      AND (
        assignment.organization_id IS NOT NULL
        OR assignment.advocate_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Existing scoped SUPER_ADMIN assignment must be reconciled before migration';
  END IF;
END;
$$;

-- The legacy role model predates advocate tenancy. Remove the random advocate
-- default, prove every assignment has a role and at most one scope, and collapse
-- exact duplicates before enforcing durable uniqueness. A random tenant key is
-- never a safe authorization default.
ALTER TABLE public.role_assignments
  ALTER COLUMN advocate_id DROP DEFAULT,
  ALTER COLUMN role_id SET NOT NULL;

ALTER TABLE public.role_assignments
  ADD CONSTRAINT role_assignments_single_scope_chk
  CHECK (num_nonnulls(organization_id, advocate_id) <= 1);

WITH ranked_assignments AS (
  SELECT
    assignment.id,
    row_number() OVER (
      PARTITION BY
        assignment.user_id,
        assignment.role_id,
        assignment.organization_id,
        assignment.advocate_id
      ORDER BY assignment.created_at, assignment.id
    ) AS duplicate_rank
  FROM public.role_assignments assignment
)
DELETE FROM public.role_assignments assignment
USING ranked_assignments ranked
WHERE assignment.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX role_assignments_identity_uidx
  ON public.role_assignments (
    user_id,
    role_id,
    organization_id,
    advocate_id
  ) NULLS NOT DISTINCT;

ALTER TABLE public.roles
  ADD CONSTRAINT roles_name_canonical_chk
  CHECK (name = btrim(name) AND name <> '');

CREATE UNIQUE INDEX roles_name_case_insensitive_uidx
  ON public.roles (lower(name));

CREATE OR REPLACE FUNCTION private.protect_legacy_role_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'Role identity fields are immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_legacy_role_identity()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER roles_protect_identity
BEFORE UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION private.protect_legacy_role_identity();

-- The auth trigger executes as its owner. It must not inherit a caller-controlled
-- search path or remain directly callable through the Data API.
CREATE OR REPLACE FUNCTION public.handle_user_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, first_name, last_name, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name',
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_user_registration()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_advocate_permission(
  target_advocate_id uuid,
  required_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.advocate_memberships m
    JOIN public.advocates advocate ON advocate.id = m.advocate_id
    JOIN public.advocate_membership_roles mr
      ON mr.membership_id = m.id
     AND mr.advocate_id = m.advocate_id
    JOIN public.advocate_role_permissions rp ON rp.role_id = mr.role_id
    JOIN public.advocate_permissions p ON p.id = rp.permission_id
    WHERE m.advocate_id = target_advocate_id
      AND m.user_id = (SELECT auth.uid())
      AND m.status = 'active'
      AND advocate.relationship_status <> 'archived'
      AND p.key = required_permission
  );
$$;

REVOKE ALL ON FUNCTION private.has_advocate_permission(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_advocate_permission(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION private.has_advocate_permission(uuid, text) IS
  'View authorization for active delegates. Suspended portals remain inspectable for support and audit, while archived relationships are closed.';

CREATE OR REPLACE FUNCTION private.has_advocate_mutation_permission(
  target_advocate_id uuid,
  required_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    JOIN public.advocates advocate ON advocate.id = membership.advocate_id
    JOIN public.advocate_membership_roles membership_role
      ON membership_role.membership_id = membership.id
     AND membership_role.advocate_id = membership.advocate_id
    JOIN public.advocate_role_permissions role_permission
      ON role_permission.role_id = membership_role.role_id
    JOIN public.advocate_permissions permission
      ON permission.id = role_permission.permission_id
    WHERE membership.advocate_id = target_advocate_id
      AND membership.user_id = (SELECT auth.uid())
      AND membership.status = 'active'
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status IN ('draft', 'provisioning', 'active', 'failed')
      AND permission.key = required_permission
  );
$$;

REVOKE ALL ON FUNCTION private.has_advocate_mutation_permission(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_advocate_mutation_permission(uuid, text)
  TO authenticated, service_role;

-- Repair the migration-defined exposure of global role assignments. Ordinary
-- users can read only their own assignments. Mutations are reserved for trusted
-- server transactions and later narrowed management RPCs.
DROP POLICY IF EXISTS "Enable select for authenticated users only"
  ON public.role_assignments;
ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.role_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.role_assignments TO authenticated;
GRANT SELECT ON public.role_assignments TO service_role;

CREATE POLICY role_assignments_select_self_or_super_admin
ON public.role_assignments
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT private.is_creator_share_super_admin())
);

-- All advocate tables are deny-by-default at the Data API. Public portal reads
-- are served through sanitized application endpoints, never these base tables.
ALTER TABLE public.advocates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_reserved_subdomains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_domain_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_provisioning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_public_metric_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_invitation_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.advocates;

REVOKE ALL ON public.advocates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_reserved_subdomains FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_domains FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_domain_integrations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.domain_provisioning_jobs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_branding FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_public_metric_selections FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_beneficiaries FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_memberships FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_roles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_permissions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_role_permissions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_membership_roles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_invitations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_invitation_roles FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.advocates TO service_role;
GRANT UPDATE (
  display_name,
  advocate_type,
  relationship_status,
  publication_status,
  beneficiary_mode
) ON public.advocates TO service_role;
GRANT SELECT ON public.advocate_reserved_subdomains TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advocate_domains TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advocate_domain_integrations TO service_role;
GRANT SELECT ON public.domain_provisioning_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advocate_branding TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advocate_public_metric_selections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advocate_beneficiaries TO service_role;
GRANT SELECT ON public.advocate_memberships TO service_role;
GRANT SELECT ON public.advocate_roles TO service_role;
GRANT SELECT ON public.advocate_permissions TO service_role;
GRANT SELECT ON public.advocate_role_permissions TO service_role;
GRANT SELECT ON public.advocate_membership_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advocate_invitations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advocate_invitation_roles TO service_role;

GRANT SELECT ON public.advocates TO authenticated;
GRANT SELECT ON public.advocate_domains TO authenticated;
GRANT SELECT ON public.advocate_branding TO authenticated;
GRANT SELECT ON public.advocate_public_metric_selections TO authenticated;
GRANT SELECT ON public.advocate_beneficiaries TO authenticated;
GRANT SELECT ON public.advocate_memberships TO authenticated;
GRANT SELECT ON public.advocate_roles TO authenticated;
GRANT SELECT ON public.advocate_permissions TO authenticated;
GRANT SELECT ON public.advocate_role_permissions TO authenticated;
GRANT SELECT ON public.advocate_membership_roles TO authenticated;

CREATE POLICY advocates_select_member
ON public.advocates
FOR SELECT TO authenticated
USING ((SELECT private.has_advocate_permission(id, 'portal.view')));

CREATE POLICY advocate_domains_select_member
ON public.advocate_domains
FOR SELECT TO authenticated
USING ((SELECT private.has_advocate_permission(advocate_id, 'portal.domains.view')));

CREATE POLICY advocate_branding_select_member
ON public.advocate_branding
FOR SELECT TO authenticated
USING ((SELECT private.has_advocate_permission(advocate_id, 'portal.view')));

CREATE POLICY advocate_public_metrics_select_member
ON public.advocate_public_metric_selections
FOR SELECT TO authenticated
USING ((SELECT private.has_advocate_permission(advocate_id, 'portal.view')));

CREATE POLICY advocate_beneficiaries_select_member
ON public.advocate_beneficiaries
FOR SELECT TO authenticated
USING ((SELECT private.has_advocate_permission(advocate_id, 'portal.view')));

CREATE POLICY advocate_memberships_select_manager
ON public.advocate_memberships
FOR SELECT TO authenticated
USING ((SELECT private.has_advocate_permission(advocate_id, 'portal.members.view')));

CREATE POLICY advocate_membership_roles_select_manager
ON public.advocate_membership_roles
FOR SELECT TO authenticated
USING ((SELECT private.has_advocate_permission(advocate_id, 'portal.members.view')));

CREATE POLICY advocate_roles_select_authenticated
ON public.advocate_roles
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY advocate_permissions_select_authenticated
ON public.advocate_permissions
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY advocate_role_permissions_select_authenticated
ON public.advocate_role_permissions
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.create_advocate_invitation(
  target_advocate_id uuid,
  invited_email text,
  role_keys text[],
  validity interval DEFAULT interval '7 days'
)
RETURNS TABLE (
  invitation_id uuid,
  plaintext_token text,
  expires_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(invited_email));
  v_token text;
  v_invitation_id uuid;
  v_expires_at timestamp with time zone;
  v_requested_count integer;
  v_valid_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT private.has_advocate_mutation_permission(
    target_advocate_id,
    'portal.members.invite'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal permission' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = target_advocate_id
      AND advocate.relationship_status IN ('invited', 'active')
      AND advocate.publication_status <> 'suspended'
  ) THEN
    RAISE EXCEPTION 'Advocate portal is not accepting membership changes'
      USING ERRCODE = '55000';
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR char_length(v_email) > 320 THEN
    RAISE EXCEPTION 'Invalid invitation email' USING ERRCODE = '22023';
  END IF;

  IF validity <= interval '0 seconds' OR validity > interval '7 days' THEN
    RAISE EXCEPTION 'Invitation validity must be greater than zero and at most 7 days'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
  INTO v_requested_count
  FROM (
    SELECT DISTINCT lower(btrim(value)) AS key
    FROM unnest(role_keys) AS requested(value)
    WHERE value IS NOT NULL AND btrim(value) <> ''
  ) requested_roles;

  SELECT count(*)
  INTO v_valid_count
  FROM public.advocate_roles r
  WHERE r.key IN (
    SELECT DISTINCT lower(btrim(value))
    FROM unnest(role_keys) AS requested(value)
    WHERE value IS NOT NULL AND btrim(value) <> ''
  )
    AND r.can_be_invited;

  IF v_requested_count = 0 OR v_requested_count <> v_valid_count THEN
    RAISE EXCEPTION 'Invitation contains an invalid or non-invitable role'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_memberships m
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.advocate_id = target_advocate_id
      AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'User already has a portal membership and must be managed separately'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.advocate_invitations
  SET
    revoked_at = now(),
    revoked_by_user_id = v_actor
  WHERE advocate_id = target_advocate_id
    AND email = v_email
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + validity;

  INSERT INTO public.advocate_invitations (
    advocate_id,
    email,
    token_digest,
    expires_at,
    created_by_user_id
  )
  VALUES (
    target_advocate_id,
    v_email,
    extensions.digest(v_token, 'sha256'),
    v_expires_at,
    v_actor
  )
  RETURNING id INTO v_invitation_id;

  INSERT INTO public.advocate_invitation_roles (
    advocate_id,
    invitation_id,
    role_id
  )
  SELECT
    target_advocate_id,
    v_invitation_id,
    r.id
  FROM public.advocate_roles r
  WHERE r.key IN (
    SELECT DISTINCT lower(btrim(value))
    FROM unnest(role_keys) AS requested(value)
    WHERE value IS NOT NULL AND btrim(value) <> ''
  )
    AND r.can_be_invited;

  RETURN QUERY SELECT v_invitation_id, v_token, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_advocate_invitation(
  plaintext_token text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_email_confirmed_at timestamp with time zone;
  v_invitation public.advocate_invitations%ROWTYPE;
  v_membership_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF plaintext_token IS NULL
     OR plaintext_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT lower(email), email_confirmed_at
  INTO v_user_email, v_email_confirmed_at
  FROM auth.users
  WHERE id = v_user_id;

  IF v_user_email IS NULL OR v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'A verified email account is required' USING ERRCODE = '42501';
  END IF;

  SELECT i.*
  INTO v_invitation
  FROM public.advocate_invitations i
  WHERE i.token_digest = extensions.digest(plaintext_token, 'sha256')
  FOR UPDATE;

  IF NOT FOUND
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= now()
     OR v_invitation.email <> v_user_email THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = v_invitation.advocate_id
      AND advocate.relationship_status IN ('invited', 'active')
      AND advocate.publication_status <> 'suspended'
  ) THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.advocate_invitation_roles ir
    JOIN public.advocate_roles r ON r.id = ir.role_id
    WHERE ir.invitation_id = v_invitation.id
      AND ir.advocate_id = v_invitation.advocate_id
      AND r.can_be_invited
  ) THEN
    RAISE EXCEPTION 'Invitation has no valid roles' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.advocate_id = v_invitation.advocate_id
      AND membership.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Existing portal memberships cannot be replaced through invitation redemption'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  VALUES (
    v_invitation.advocate_id,
    v_user_id,
    'active'
  )
  RETURNING id INTO v_membership_id;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  SELECT
    v_invitation.advocate_id,
    v_membership_id,
    ir.role_id,
    v_invitation.created_by_user_id
  FROM public.advocate_invitation_roles ir
  JOIN public.advocate_roles r ON r.id = ir.role_id
  WHERE ir.invitation_id = v_invitation.id
    AND ir.advocate_id = v_invitation.advocate_id
    AND r.can_be_invited;

  UPDATE public.advocate_invitations
  SET
    accepted_at = now(),
    accepted_by_user_id = v_user_id
  WHERE id = v_invitation.id;

  RETURN v_invitation.advocate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_advocate_invitation(uuid, text, text[], interval)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_advocate_invitation(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_advocate_invitation(uuid, text, text[], interval)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_advocate_invitation(text)
  TO authenticated;

COMMENT ON FUNCTION public.create_advocate_invitation(uuid, text, text[], interval) IS
  'Atomically issues an email-bound portal invitation and returns the 256-bit plaintext token exactly once. Authorization is read from database memberships, never user metadata.';
COMMENT ON FUNCTION public.redeem_advocate_invitation(text) IS
  'Atomically redeems one unexpired invitation for the authenticated user whose verified email matches the invitation.';

-- Private, layered row audit. This database table captures application-owned
-- row changes. Privileged SQL and DDL still require PGAudit and externally
-- retained provider logs because a database administrator can disable triggers.
CREATE TABLE audit.audit_events (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  occurred_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  schema_name text NOT NULL,
  table_name text NOT NULL,
  operation audit.audit_operation NOT NULL,
  record_pk jsonb NOT NULL DEFAULT '{}'::jsonb,
  advocate_id uuid,
  actor_type audit.audit_actor_type NOT NULL,
  actor_user_id uuid,
  effective_user_id uuid,
  system_actor text,
  tool text,
  request_id text,
  trace_id text,
  session_id text,
  provider_event_id text,
  database_role text NOT NULL,
  session_user_name text NOT NULL,
  application_name text,
  forensics_expires_at timestamp with time zone,
  before_data jsonb,
  after_data jsonb,
  changed_columns text[] NOT NULL DEFAULT ARRAY[]::text[],
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_events_record_pk_object_check CHECK (jsonb_typeof(record_pk) = 'object'),
  CONSTRAINT audit_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_events_row_images_check CHECK (
    (before_data IS NULL OR jsonb_typeof(before_data) = 'object')
    AND (after_data IS NULL OR jsonb_typeof(after_data) = 'object')
  )
);

CREATE INDEX audit_events_occurred_at_idx
  ON audit.audit_events (occurred_at DESC);
CREATE INDEX audit_events_table_record_idx
  ON audit.audit_events (schema_name, table_name, record_pk, occurred_at DESC);
CREATE INDEX audit_events_advocate_idx
  ON audit.audit_events (advocate_id, occurred_at DESC)
  WHERE advocate_id IS NOT NULL;
CREATE INDEX audit_events_actor_idx
  ON audit.audit_events (actor_user_id, occurred_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_events_request_idx
  ON audit.audit_events (request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX audit_events_provider_event_idx
  ON audit.audit_events (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON TABLE audit.audit_events IS
  'Append-only application row audit. Sanitized portal audit views and external privileged-operation logs are separate layers.';
COMMENT ON COLUMN audit.audit_events.before_data IS
  'Pre-change row image after trigger-configured sensitive columns are redacted.';
COMMENT ON COLUMN audit.audit_events.after_data IS
  'Post-change row image after trigger-configured sensitive columns are redacted.';
COMMENT ON COLUMN audit.audit_events.effective_user_id IS
  'User whose portal context was affected when a Creator Share administrator or system actor acted on their behalf.';
COMMENT ON COLUMN audit.audit_events.forensics_expires_at IS
  'Expiry of separately stored raw IP and user-agent evidence. Raw forensic values are never retained in this indefinite audit row.';

CREATE TABLE audit.audit_event_forensics (
  audit_event_id uuid PRIMARY KEY
    REFERENCES audit.audit_events(id) ON DELETE RESTRICT,
  captured_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamp with time zone NOT NULL,
  client_ip text,
  user_agent text,
  CONSTRAINT audit_event_forensics_values_check CHECK (
    client_ip IS NOT NULL OR user_agent IS NOT NULL
  ),
  CONSTRAINT audit_event_forensics_expiry_check CHECK (
    expires_at = captured_at + interval '90 days'
  ),
  CONSTRAINT audit_event_forensics_client_ip_size_check CHECK (
    client_ip IS NULL OR octet_length(client_ip) <= 1024
  ),
  CONSTRAINT audit_event_forensics_user_agent_size_check CHECK (
    user_agent IS NULL OR octet_length(user_agent) <= 4096
  )
);

CREATE INDEX audit_event_forensics_expiry_idx
  ON audit.audit_event_forensics (expires_at);

COMMENT ON TABLE audit.audit_event_forensics IS
  'Raw request IP and user-agent evidence retained for exactly 90 days, isolated from the indefinite sanitized audit ledger.';

ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_event_forensics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit.audit_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON audit.audit_event_forensics FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE audit.audit_events_sequence_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION audit.redact_json(
  source_data jsonb,
  redacted_columns text[]
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb := source_data;
  v_column text;
BEGIN
  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_column IN ARRAY COALESCE(redacted_columns, ARRAY[]::text[])
  LOOP
    IF v_result ? v_column THEN
      v_result := jsonb_set(
        v_result,
        ARRAY[v_column],
        to_jsonb('[REDACTED]'::text),
        false
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION audit.primary_key_json(
  target_schema text,
  target_table text,
  source_data jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_object_agg(a.attname, source_data -> a.attname),
    '{}'::jsonb
  )
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = i.indrelid
   AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', target_schema, target_table)
    )
    AND i.indisprimary;
$$;

CREATE OR REPLACE FUNCTION audit.set_actor_context(
  context_actor_type audit.audit_actor_type,
  context_actor_user_id uuid DEFAULT NULL,
  context_effective_user_id uuid DEFAULT NULL,
  context_system_actor text DEFAULT NULL,
  context_tool text DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_session_id text DEFAULT NULL,
  context_provider_event_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL,
  context_reason text DEFAULT NULL,
  context_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF jsonb_typeof(context_metadata) <> 'object' THEN
    RAISE EXCEPTION 'Audit context metadata must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(context_metadata) > 4096 THEN
    RAISE EXCEPTION 'Audit context metadata exceeds 4096 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(context_metadata) entry
    WHERE entry.key <> ALL (ARRAY[
      'operation',
      'resource_kind',
      'resource_id',
      'outcome',
      'job_id',
      'batch_id',
      'provider',
      'provider_account_scope',
      'event_type',
      'retry_count',
      'correlation_id',
      'deployment_id',
      'domain_hostname',
      'permission_key',
      'role_key'
    ]::text[])
      OR jsonb_typeof(entry.value) NOT IN ('string', 'number', 'boolean', 'null')
  ) THEN
    RAISE EXCEPTION 'Audit context metadata contains an unsupported key or value type'
      USING ERRCODE = '22023';
  END IF;

  IF context_actor_type = 'system'
     AND nullif(btrim(context_system_actor), '') IS NULL THEN
    RAISE EXCEPTION 'System audit context requires a named system actor'
      USING ERRCODE = '22023';
  END IF;

  IF context_actor_type IN ('user', 'creator_share_admin')
     AND context_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'User audit context requires an actor user id'
      USING ERRCODE = '22023';
  END IF;

  IF length(COALESCE(context_system_actor, '')) > 200
     OR length(COALESCE(context_tool, '')) > 200
     OR length(COALESCE(context_request_id, '')) > 255
     OR length(COALESCE(context_trace_id, '')) > 255
     OR length(COALESCE(context_session_id, '')) > 255
     OR length(COALESCE(context_provider_event_id, '')) > 255
     OR length(COALESCE(context_reason, '')) > 2000 THEN
    RAISE EXCEPTION 'Audit context field exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.audit.actor_type', context_actor_type::text, true);
  PERFORM pg_catalog.set_config('app.audit.actor_user_id', COALESCE(context_actor_user_id::text, ''), true);
  PERFORM pg_catalog.set_config('app.audit.effective_user_id', COALESCE(context_effective_user_id::text, ''), true);
  PERFORM pg_catalog.set_config('app.audit.system_actor', COALESCE(context_system_actor, ''), true);
  PERFORM pg_catalog.set_config('app.audit.tool', COALESCE(context_tool, ''), true);
  PERFORM pg_catalog.set_config('app.audit.request_id', COALESCE(context_request_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.trace_id', COALESCE(context_trace_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.session_id', COALESCE(context_session_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.provider_event_id', COALESCE(context_provider_event_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.client_ip', COALESCE(context_client_ip, ''), true);
  PERFORM pg_catalog.set_config('app.audit.user_agent', COALESCE(context_user_agent, ''), true);
  PERFORM pg_catalog.set_config('app.audit.reason', COALESCE(context_reason, ''), true);
  PERFORM pg_catalog.set_config('app.audit.metadata', context_metadata::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION audit.capture_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_source jsonb;
  v_tenant_column text;
  v_redacted_columns text[] := ARRAY[]::text[];
  v_advocate_id uuid;
  v_actor_user_id uuid;
  v_effective_user_id uuid;
  v_actor_type audit.audit_actor_type;
  v_actor_type_text text;
  v_changed_columns text[] := ARRAY[]::text[];
  v_headers jsonb := '{}'::jsonb;
  v_metadata jsonb := '{}'::jsonb;
  v_client_ip text;
  v_user_agent text;
  v_reason text;
  v_event_id uuid;
  v_forensics_captured_at timestamp with time zone;
  v_columns_only boolean := false;
  v_database_role text;
  v_system_actor text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
    v_source := v_after;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_source := v_after;
  ELSE
    v_before := to_jsonb(OLD);
    v_source := v_before;
  END IF;

  IF TG_NARGS > 0 THEN
    v_tenant_column := NULLIF(TG_ARGV[0], '');
  END IF;

  IF TG_NARGS > 1 AND TG_ARGV[1] = '@columns_only' THEN
    v_columns_only := true;
    IF TG_NARGS > 2 THEN
      v_redacted_columns := TG_ARGV[2:TG_NARGS - 1];
    END IF;
  ELSIF TG_NARGS > 1 THEN
    v_redacted_columns := TG_ARGV[1:TG_NARGS - 1];
  END IF;

  IF v_tenant_column IS NOT NULL AND v_source ? v_tenant_column THEN
    BEGIN
      v_advocate_id := NULLIF(v_source ->> v_tenant_column, '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_advocate_id := NULL;
    END;
  END IF;

  SELECT COALESCE(array_agg(keys.key ORDER BY keys.key), ARRAY[]::text[])
  INTO v_changed_columns
  FROM (
    SELECT jsonb_object_keys(COALESCE(v_before, '{}'::jsonb)) AS key
    UNION
    SELECT jsonb_object_keys(COALESCE(v_after, '{}'::jsonb)) AS key
  ) keys
  WHERE (v_before -> keys.key) IS DISTINCT FROM (v_after -> keys.key);

  v_actor_user_id := auth.uid();

  IF v_actor_user_id IS NULL THEN
    BEGIN
      v_actor_user_id := NULLIF(
        current_setting('app.audit.actor_user_id', true),
        ''
      )::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_actor_user_id := NULL;
    END;
  END IF;

  BEGIN
    v_effective_user_id := NULLIF(
      current_setting('app.audit.effective_user_id', true),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_effective_user_id := NULL;
  END;

  v_actor_type_text := NULLIF(
    current_setting('app.audit.actor_type', true),
    ''
  );

  v_database_role := COALESCE(
    NULLIF(current_setting('role', true), 'none'),
    session_user
  );
  v_system_actor := NULLIF(
    btrim(current_setting('app.audit.system_actor', true)),
    ''
  );

  IF v_actor_type_text IS NOT NULL THEN
    BEGIN
      v_actor_type := v_actor_type_text::audit.audit_actor_type;
    EXCEPTION WHEN invalid_text_representation THEN
      v_actor_type := 'unknown';
    END;
  ELSIF v_actor_user_id IS NOT NULL THEN
    v_actor_type := 'user';
  ELSIF v_database_role = 'postgres' THEN
    v_actor_type := 'database';
  ELSE
    v_actor_type := 'unknown';
  END IF;

  IF v_actor_type = 'system' AND v_system_actor IS NULL THEN
    RAISE EXCEPTION 'System audit events require a named system actor'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_headers := COALESCE(
      NULLIF(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  EXCEPTION WHEN others THEN
    v_headers := '{}'::jsonb;
  END;

  BEGIN
    v_metadata := COALESCE(
      NULLIF(current_setting('app.audit.metadata', true), '')::jsonb,
      '{}'::jsonb
    );
    IF jsonb_typeof(v_metadata) <> 'object' THEN
      v_metadata := '{}'::jsonb;
    END IF;
  EXCEPTION WHEN others THEN
    v_metadata := '{}'::jsonb;
  END;

  v_client_ip := COALESCE(
    NULLIF(current_setting('app.audit.client_ip', true), ''),
    NULLIF(v_headers ->> 'x-forwarded-for', '')
  );
  v_user_agent := COALESCE(
    NULLIF(current_setting('app.audit.user_agent', true), ''),
    NULLIF(v_headers ->> 'user-agent', '')
  );
  v_reason := NULLIF(btrim(current_setting('app.audit.reason', true)), '');

  IF v_client_ip IS NOT NULL OR v_user_agent IS NOT NULL THEN
    v_forensics_captured_at := clock_timestamp();
  END IF;

  IF v_actor_type = 'creator_share_admin'
     AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Creator Share administrator mutations require an audit reason'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO audit.audit_events (
    schema_name,
    table_name,
    operation,
    record_pk,
    advocate_id,
    actor_type,
    actor_user_id,
    effective_user_id,
    system_actor,
    tool,
    request_id,
    trace_id,
    session_id,
    provider_event_id,
    database_role,
    session_user_name,
    application_name,
    forensics_expires_at,
    before_data,
    after_data,
    changed_columns,
    reason,
    metadata
  )
  VALUES (
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME,
    TG_OP::audit.audit_operation,
    audit.primary_key_json(TG_TABLE_SCHEMA, TG_TABLE_NAME, v_source),
    v_advocate_id,
    v_actor_type,
    v_actor_user_id,
    v_effective_user_id,
    v_system_actor,
    NULLIF(current_setting('app.audit.tool', true), ''),
    COALESCE(
      NULLIF(current_setting('app.audit.request_id', true), ''),
      NULLIF(v_headers ->> 'x-request-id', '')
    ),
    NULLIF(current_setting('app.audit.trace_id', true), ''),
    NULLIF(current_setting('app.audit.session_id', true), ''),
    NULLIF(current_setting('app.audit.provider_event_id', true), ''),
    v_database_role,
    session_user,
    NULLIF(current_setting('application_name', true), ''),
    CASE
      WHEN v_forensics_captured_at IS NOT NULL
        THEN v_forensics_captured_at + interval '90 days'
      ELSE NULL
    END,
    CASE
      WHEN v_columns_only THEN NULL
      ELSE audit.redact_json(v_before, v_redacted_columns)
    END,
    CASE
      WHEN v_columns_only THEN NULL
      ELSE audit.redact_json(v_after, v_redacted_columns)
    END,
    v_changed_columns,
    v_reason,
    v_metadata
  )
  RETURNING id INTO v_event_id;

  IF v_client_ip IS NOT NULL OR v_user_agent IS NOT NULL THEN
    INSERT INTO audit.audit_event_forensics (
      audit_event_id,
      captured_at,
      expires_at,
      client_ip,
      user_agent
    )
    VALUES (
      v_event_id,
      v_forensics_captured_at,
      v_forensics_captured_at + interval '90 days',
      left(v_client_ip, 256),
      left(v_user_agent, 1024)
    );
  END IF;

  -- The return value of an AFTER trigger is ignored.
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION audit.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_events is append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION audit.protect_audit_event_forensics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.expires_at <= clock_timestamp() THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Audit forensics are immutable until retention expiry'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION audit.purge_expired_forensics(
  batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 10000 THEN
    RAISE EXCEPTION 'Forensics purge batch size must be between 1 and 10000'
      USING ERRCODE = '22023';
  END IF;

  WITH expired AS (
    SELECT forensic.audit_event_id
    FROM audit.audit_event_forensics forensic
    WHERE forensic.expires_at <= clock_timestamp()
    ORDER BY forensic.expires_at, forensic.audit_event_id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM audit.audit_event_forensics forensic
  USING expired
  WHERE forensic.audit_event_id = expired.audit_event_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION audit.redact_json(jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION audit.primary_key_json(text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION audit.capture_row_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION audit.prevent_audit_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION audit.protect_audit_event_forensics()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION audit.purge_expired_forensics(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION audit.purge_expired_forensics(integer)
  TO service_role;
REVOKE ALL ON FUNCTION audit.set_actor_context(
  audit.audit_actor_type,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION audit.set_actor_context(
  audit.audit_actor_type,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_audit_forensics(
  batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT audit.purge_expired_forensics(batch_size);
$$;

REVOKE ALL ON FUNCTION public.purge_expired_audit_forensics(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_forensics(integer)
  TO service_role;

COMMENT ON FUNCTION public.purge_expired_audit_forensics(integer) IS
  'Service-only retention hook for scheduled deletion of raw audit IP and user-agent evidence after 90 days.';

CREATE OR REPLACE FUNCTION public.get_advocate_audit_events(
  target_advocate_id uuid,
  before_sequence bigint DEFAULT NULL,
  page_size integer DEFAULT 50
)
RETURNS TABLE (
  sequence_id bigint,
  event_id uuid,
  occurred_at timestamp with time zone,
  table_name text,
  operation audit.audit_operation,
  actor_type audit.audit_actor_type,
  actor_user_id uuid,
  actor_display_name text,
  effective_user_id uuid,
  system_actor text,
  tool text,
  changed_columns text[],
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_advocate_permission(target_advocate_id, 'portal.audit.view') THEN
    RAISE EXCEPTION 'Insufficient portal audit permission'
      USING ERRCODE = '42501';
  END IF;

  IF page_size IS NULL OR page_size < 1 OR page_size > 200 THEN
    RAISE EXCEPTION 'Audit page size must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    event.sequence_id,
    event.id,
    event.occurred_at,
    event.table_name,
    event.operation,
    event.actor_type,
    event.actor_user_id,
    CASE
      WHEN event.actor_type = 'system' THEN event.system_actor
      WHEN event.actor_user_id IS NOT NULL THEN nullif(
        btrim(
          concat_ws(
            ' ',
            nullif(profile.first_name, ''),
            CASE
              WHEN nullif(profile.last_name, '') IS NOT NULL
                THEN left(profile.last_name, 1) || '.'
              ELSE NULL
            END
          )
        ),
        ''
      )
      ELSE event.actor_type::text
    END AS actor_display_name,
    event.effective_user_id,
    event.system_actor,
    event.tool,
    event.changed_columns,
    event.reason
  FROM audit.audit_events event
  LEFT JOIN public.users profile ON profile.id = event.actor_user_id
  WHERE event.advocate_id = target_advocate_id
    AND event.table_name = ANY (ARRAY[
      'advocates',
      'advocate_domains',
      'advocate_domain_integrations',
      'domain_provisioning_jobs',
      'advocate_branding',
      'advocate_public_metric_selections',
      'advocate_beneficiaries',
      'advocate_memberships',
      'advocate_membership_roles',
      'advocate_invitations',
      'advocate_invitation_roles'
    ]::text[])
    AND (before_sequence IS NULL OR event.sequence_id < before_sequence)
  ORDER BY event.sequence_id DESC
  LIMIT page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.get_advocate_audit_events(uuid, bigint, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_advocate_audit_events(uuid, bigint, integer)
  TO authenticated;

COMMENT ON FUNCTION public.get_advocate_audit_events(uuid, bigint, integer) IS
  'Returns only the sanitized, advocate-scoped audit ledger to members with portal.audit.view. Raw 90-day forensic evidence is never exposed.';

CREATE TRIGGER audit_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.audit_events
FOR EACH ROW EXECUTE FUNCTION audit.prevent_audit_event_mutation();

CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON audit.audit_events
FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_audit_event_mutation();

CREATE TRIGGER audit_event_forensics_no_update_or_early_delete
BEFORE UPDATE OR DELETE ON audit.audit_event_forensics
FOR EACH ROW EXECUTE FUNCTION audit.protect_audit_event_forensics();

CREATE TRIGGER audit_event_forensics_no_truncate
BEFORE TRUNCATE ON audit.audit_event_forensics
FOR EACH STATEMENT EXECUTE FUNCTION audit.protect_audit_event_forensics();

CREATE TRIGGER advocates_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocates
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('id');

CREATE TRIGGER advocate_reserved_subdomains_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_reserved_subdomains
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('');

CREATE TRIGGER advocate_domains_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_domains
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id', 'failure_detail');

CREATE TRIGGER advocate_domain_integrations_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_domain_integrations
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  'provider_metadata',
  'last_error'
);

CREATE TRIGGER domain_provisioning_jobs_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.domain_provisioning_jobs
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  'provider_idempotency_key',
  'lease_token',
  'request_payload',
  'result_payload',
  'last_error'
);

CREATE TRIGGER advocate_branding_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_branding
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id');

CREATE TRIGGER advocate_public_metric_selections_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_public_metric_selections
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id');

CREATE TRIGGER advocate_beneficiaries_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_beneficiaries
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id');

CREATE TRIGGER advocate_memberships_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_memberships
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id');

CREATE TRIGGER advocate_roles_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_roles
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('');

CREATE TRIGGER advocate_permissions_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_permissions
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('');

CREATE TRIGGER advocate_role_permissions_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_role_permissions
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('');

CREATE TRIGGER advocate_membership_roles_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_membership_roles
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id');

CREATE TRIGGER advocate_invitations_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_invitations
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  'email',
  'token_digest'
);

CREATE TRIGGER advocate_invitation_roles_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_invitation_roles
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id');

CREATE TRIGGER role_assignments_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('advocate_id');

CREATE TRIGGER roles_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('');

CREATE TRIGGER permissions_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.permissions
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('');

CREATE TRIGGER permission_assignments_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.permission_assignments
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('');

CREATE TRIGGER activities_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.activities
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER activity_subscriptions_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.activity_subscriptions
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only', 'email');

CREATE TRIGGER beneficiaries_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.beneficiaries
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER beneficiary_reservations_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.beneficiary_reservations
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'reservation_token',
  'created_ip',
  'user_agent'
);

CREATE TRIGGER email_logs_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.email_logs
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'email',
  'subject',
  'error',
  'message_id'
);

CREATE TRIGGER expense_assignments_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.expense_assignments
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER expenses_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER initiative_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.initiative
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER media_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.media
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER organization_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.organization
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER partnerships_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.partnerships
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'email',
  'customer_id',
  'card_number',
  'card_type',
  'payment_intent',
  'stripe_subscription_id',
  'provider_event_id'
);

CREATE TRIGGER project_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.project
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

CREATE TRIGGER subscriptions_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'email',
  'customer_id',
  'stripe_subscription_id',
  'provider_event_id'
);

CREATE TRIGGER transaction_ledger_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.transaction_ledger
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'customer_email',
  'customer_name',
  'customer_id',
  'reference',
  'description',
  'payment_intent',
  'payment_method_id',
  'provider_event_id'
);

CREATE TRIGGER users_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'first_name',
  'last_name',
  'email'
);

CREATE OR REPLACE FUNCTION public.create_advocate_portal(
  target_owner_user_id uuid,
  portal_slug text,
  portal_display_name text,
  change_reason text,
  portal_advocate_type text DEFAULT 'creator',
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_advocate_id uuid := gen_random_uuid();
  v_owner_membership_id uuid;
  v_slug text := lower(btrim(portal_slug));
  v_display_name text := btrim(portal_display_name);
  v_advocate_type text := lower(btrim(portal_advocate_type));
  v_reason text := btrim(change_reason);
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
        OR actor.banned_until <= now()
      )
  ) THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during advocate creation'
      USING ERRCODE = '40001';
  END IF;

  IF v_slug IS NULL
     OR char_length(v_slug) NOT BETWEEN 1 AND 63
     OR v_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'A valid Creator Share subdomain label is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_display_name IS NULL
     OR char_length(v_display_name) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'An advocate display name between 1 and 160 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_advocate_type IS NULL
     OR v_advocate_type !~ '^[a-z][a-z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'A valid advocate type is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A creation reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Advocate creation request identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = target_owner_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (
      account.banned_until IS NULL
      OR account.banned_until <= now()
    )
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The initial owner must be an active account with a verified email'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = v_slug
  ) THEN
    RAISE EXCEPTION 'Advocate subdomain label is reserved'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => target_owner_user_id,
    context_tool => 'creator-share-admin-advocates',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => NULLIF(btrim(session_id), ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'create_portal',
      'resource_kind', 'advocate',
      'resource_id', v_advocate_id::text,
      'role_key', 'owner'
    )
  );

  INSERT INTO public.advocates (
    id,
    slug,
    display_name,
    advocate_type,
    relationship_status,
    publication_status,
    beneficiary_mode,
    created_by_user_id
  )
  VALUES (
    v_advocate_id,
    v_slug,
    v_display_name,
    v_advocate_type,
    'active',
    'draft',
    'all',
    v_actor_user_id
  );

  INSERT INTO public.advocate_branding (advocate_id)
  VALUES (v_advocate_id);

  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  VALUES (
    v_advocate_id,
    target_owner_user_id,
    'active'
  )
  RETURNING id INTO v_owner_membership_id;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  VALUES (
    v_advocate_id,
    v_owner_membership_id,
    '00000000-0000-4000-8000-000000000001'::uuid,
    v_actor_user_id
  );

  UPDATE public.advocates
  SET owner_membership_id = v_owner_membership_id
  WHERE id = v_advocate_id;

  RETURN v_advocate_id;
END;
$$;

COMMENT ON FUNCTION public.create_advocate_portal(uuid, text, text, text, text, text, text, text) IS
  'Creator Share administrator boundary that atomically creates one active advocate tenant, its default branding, and its sole verified owner membership with complete audit context.';

REVOKE ALL ON FUNCTION public.create_advocate_portal(uuid, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_advocate_portal(uuid, text, text, text, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_advocate_ownership(
  target_advocate_id uuid,
  expected_owner_user_id uuid,
  target_owner_user_id uuid,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_is_creator_share_admin boolean;
  v_advocate public.advocates%ROWTYPE;
  v_current_owner public.advocate_memberships%ROWTYPE;
  v_target_owner public.advocate_memberships%ROWTYPE;
  v_reason text := btrim(change_reason);
  v_deleted_owner_roles integer;
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
        OR actor.banned_until <= now()
      )
  ) THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'An ownership transfer reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Ownership transfer request identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  v_is_creator_share_admin := private.is_creator_share_super_admin();

  IF v_is_creator_share_admin THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);
    v_is_creator_share_admin := private.is_creator_share_super_admin();
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_advocate.relationship_status = 'archived' THEN
    RAISE EXCEPTION 'Archived advocate portals cannot transfer ownership'
      USING ERRCODE = '55000';
  END IF;

  SELECT membership.*
  INTO v_current_owner
  FROM public.advocate_memberships membership
  WHERE membership.id = v_advocate.owner_membership_id
    AND membership.advocate_id = v_advocate.id
  FOR UPDATE;

  IF NOT FOUND
     OR v_current_owner.status <> 'active'
     OR NOT EXISTS (
       SELECT 1
       FROM public.advocate_membership_roles membership_role
       WHERE membership_role.advocate_id = v_advocate.id
         AND membership_role.membership_id = v_current_owner.id
         AND membership_role.role_id =
           '00000000-0000-4000-8000-000000000001'::uuid
     ) THEN
    RAISE EXCEPTION 'Advocate portal does not have a valid active owner'
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_is_creator_share_admin
     AND (
       v_current_owner.user_id <> v_actor_user_id
       OR v_advocate.relationship_status <> 'active'
       OR v_advocate.publication_status = 'suspended'
     ) THEN
    RAISE EXCEPTION 'Only the current active owner or a Creator Share super administrator can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF expected_owner_user_id IS NULL
     OR v_current_owner.user_id IS DISTINCT FROM expected_owner_user_id THEN
    RAISE EXCEPTION 'Advocate ownership changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF target_owner_user_id = v_current_owner.user_id THEN
    RAISE EXCEPTION 'The target account already owns this advocate portal'
      USING ERRCODE = '23505';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = target_owner_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (
      account.banned_until IS NULL
      OR account.banned_until <= now()
    )
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The target owner must be an active account with a verified email'
      USING ERRCODE = '23503';
  END IF;

  SELECT membership.*
  INTO v_target_owner
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = v_advocate.id
    AND membership.user_id = target_owner_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_target_owner.status <> 'active' THEN
    RAISE EXCEPTION 'The target owner must have an active membership in this advocate portal'
      USING ERRCODE = '23503';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => CASE
      WHEN v_is_creator_share_admin
        THEN 'creator_share_admin'::audit.audit_actor_type
      ELSE 'user'::audit.audit_actor_type
    END,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => target_owner_user_id,
    context_tool => CASE
      WHEN v_is_creator_share_admin THEN 'creator-share-admin-advocates'
      ELSE 'advocate-portal-ownership'
    END,
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => NULLIF(btrim(session_id), ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'transfer_ownership',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'role_key', 'owner'
    )
  );

  DELETE FROM public.advocate_membership_roles membership_role
  WHERE membership_role.advocate_id = v_advocate.id
    AND membership_role.membership_id = v_current_owner.id
    AND membership_role.role_id =
      '00000000-0000-4000-8000-000000000001'::uuid;

  GET DIAGNOSTICS v_deleted_owner_roles = ROW_COUNT;

  IF v_deleted_owner_roles <> 1 THEN
    RAISE EXCEPTION 'Advocate ownership changed during transfer'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  VALUES (
    v_advocate.id,
    v_target_owner.id,
    '00000000-0000-4000-8000-000000000001'::uuid,
    v_actor_user_id
  );

  UPDATE public.advocates
  SET owner_membership_id = v_target_owner.id
  WHERE id = v_advocate.id
    AND owner_membership_id = v_current_owner.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate ownership changed during transfer'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_advocate.id;
END;
$$;

COMMENT ON FUNCTION public.transfer_advocate_ownership(uuid, uuid, uuid, text, text, text, text) IS
  'Serializes ownership transfer on the advocate row, rejects stale expected owners, permits the current healthy portal owner or a Creator Share administrator, requires a verified active same tenant member, and audits the complete request context.';

REVOKE ALL ON FUNCTION public.transfer_advocate_ownership(uuid, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_advocate_ownership(uuid, uuid, uuid, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.prevent_last_global_super_admin_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_is_global_super_admin boolean;
  v_new_is_global_super_admin boolean := false;
  v_remaining_count integer;
BEGIN
  SELECT role.name = 'SUPER_ADMIN'
    AND OLD.organization_id IS NULL
    AND OLD.advocate_id IS NULL
  INTO v_old_is_global_super_admin
  FROM public.roles role
  WHERE role.id = OLD.role_id;

  IF NOT COALESCE(v_old_is_global_super_admin, false) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT role.name = 'SUPER_ADMIN'
      AND NEW.organization_id IS NULL
      AND NEW.advocate_id IS NULL
    INTO v_new_is_global_super_admin
    FROM public.roles role
    WHERE role.id = NEW.role_id;
  END IF;

  IF COALESCE(v_new_is_global_super_admin, false) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  SELECT count(*)::integer
  INTO v_remaining_count
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id
  WHERE assignment.id <> OLD.id
    AND assignment.organization_id IS NULL
    AND assignment.advocate_id IS NULL
    AND role.name = 'SUPER_ADMIN';

  IF v_remaining_count = 0 THEN
    RAISE EXCEPTION 'The final Creator Share super administrator cannot be removed'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_last_global_super_admin_removal()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER role_assignments_preserve_last_global_super_admin
BEFORE UPDATE OR DELETE ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION private.prevent_last_global_super_admin_removal();

CREATE OR REPLACE FUNCTION public.replace_creator_share_user_roles(
  target_user_id uuid,
  target_role_ids uuid[],
  change_reason text,
  request_id text DEFAULT NULL
)
RETURNS TABLE (
  role_id uuid,
  role_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_target_role_count integer;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  IF target_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM auth.users account WHERE account.id = target_user_id
     ) THEN
    RAISE EXCEPTION 'Target account does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF target_role_ids IS NULL
     OR cardinality(target_role_ids) > 32
     OR array_position(target_role_ids, NULL) IS NOT NULL
     OR cardinality(target_role_ids) <> (
       SELECT count(DISTINCT requested_role_id)::integer
       FROM unnest(target_role_ids) requested_role(requested_role_id)
     ) THEN
    RAISE EXCEPTION 'Role identifiers must be a unique array of at most 32 values'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer
  INTO v_target_role_count
  FROM public.roles role
  WHERE role.id = ANY(target_role_ids);

  IF v_target_role_count <> cardinality(target_role_ids) THEN
    RAISE EXCEPTION 'One or more requested roles do not exist'
      USING ERRCODE = '23503';
  END IF;

  IF nullif(btrim(change_reason), '') IS NULL
     OR length(change_reason) > 2000 THEN
    RAISE EXCEPTION 'A role change reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(COALESCE(request_id, '')) > 255 THEN
    RAISE EXCEPTION 'Role change request id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => target_user_id,
    context_tool => 'creator-share-admin-users',
    context_request_id => request_id,
    context_reason => btrim(change_reason),
    context_metadata => jsonb_build_object(
      'operation', 'replace_roles',
      'resource_kind', 'auth_user',
      'resource_id', target_user_id::text
    )
  );

  DELETE FROM public.role_assignments assignment
  WHERE assignment.user_id = target_user_id
    AND assignment.organization_id IS NULL
    AND assignment.advocate_id IS NULL
    AND NOT (assignment.role_id = ANY(target_role_ids));

  INSERT INTO public.role_assignments (
    user_id,
    role_id,
    organization_id,
    advocate_id
  )
  SELECT
    target_user_id,
    requested_role.requested_role_id,
    NULL,
    NULL
  FROM unnest(target_role_ids) requested_role(requested_role_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id = target_user_id
      AND assignment.role_id = requested_role.requested_role_id
      AND assignment.organization_id IS NULL
      AND assignment.advocate_id IS NULL
  );

  RETURN QUERY
  SELECT role.id, role.name
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id
  WHERE assignment.user_id = target_user_id
    AND assignment.organization_id IS NULL
    AND assignment.advocate_id IS NULL
  ORDER BY role.name, role.id;
END;
$$;

COMMENT ON FUNCTION public.replace_creator_share_user_roles(uuid, uuid[], text, text) IS
  'Atomically replaces global Creator Share roles, preserves the final super administrator, and records actor, tool, target, request, reason, and row changes in the audit ledger.';

REVOKE ALL ON FUNCTION public.replace_creator_share_user_roles(uuid, uuid[], text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_creator_share_user_roles(uuid, uuid[], text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.subscribe_to_beneficiary_updates(
  target_beneficiary_id uuid,
  target_email text,
  request_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted_count integer;
BEGIN
  IF target_beneficiary_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.beneficiaries beneficiary
       WHERE beneficiary.id = target_beneficiary_id
         AND beneficiary.status NOT IN ('Draft', 'Archived')
     ) THEN
    RAISE EXCEPTION 'Published beneficiary does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF target_email IS NULL
     OR target_email <> lower(btrim(target_email))
     OR length(target_email) > 254
     OR target_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A normalized email address is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(COALESCE(request_id, '')) > 255 THEN
    RAISE EXCEPTION 'Subscription request id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'public-subscription-api',
    context_tool => 'beneficiary-update-subscription',
    context_request_id => request_id,
    context_reason => 'Public beneficiary update subscription request',
    context_metadata => jsonb_build_object(
      'operation', 'subscribe',
      'resource_kind', 'beneficiary',
      'resource_id', target_beneficiary_id::text
    )
  );

  INSERT INTO public.activity_subscriptions (beneficiary_id, email)
  VALUES (target_beneficiary_id, target_email)
  ON CONFLICT (beneficiary_id, email) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count = 1;
END;
$$;

COMMENT ON FUNCTION public.subscribe_to_beneficiary_updates(uuid, text, text) IS
  'Server-only audited enrollment for published beneficiary updates. Edge rate limiting and double opt in remain application responsibilities.';

REVOKE ALL ON FUNCTION public.subscribe_to_beneficiary_updates(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.subscribe_to_beneficiary_updates(uuid, text, text)
  TO service_role;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT, DELETE ON public.users TO service_role;
DROP POLICY IF EXISTS users_select_self_or_super_admin ON public.users;
CREATE POLICY users_select_self_or_super_admin
ON public.users
FOR SELECT
TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (SELECT private.is_creator_share_super_admin())
);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.roles TO authenticated, service_role;
DROP POLICY IF EXISTS "Enable select for authenticated users only" ON public.roles;
CREATE POLICY roles_select_authenticated
ON public.roles
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permissions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.permission_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.permissions TO service_role;
GRANT SELECT ON public.permission_assignments TO service_role;
DROP POLICY IF EXISTS "Enable select for authenticated users only" ON public.permissions;
DROP POLICY IF EXISTS "Enable select for authenticated users only" ON public.permission_assignments;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO service_role;
DROP POLICY IF EXISTS subscriptions_select_self_or_super_admin ON public.subscriptions;
CREATE POLICY subscriptions_select_self_or_super_admin
ON public.subscriptions
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT private.is_creator_share_super_admin())
);

CREATE OR REPLACE VIEW public.public_beneficiary_sponsorship_milestones
WITH (security_barrier = true)
AS
SELECT
  subscription.beneficiary_id,
  (floor(count(*)::numeric / 5) * 5)::bigint AS sponsorship_count_floor
FROM public.subscriptions subscription
WHERE subscription.status = 'complete'
  AND subscription.beneficiary_id IS NOT NULL
GROUP BY subscription.beneficiary_id
HAVING count(*) >= 5;

COMMENT ON VIEW public.public_beneficiary_sponsorship_milestones IS
  'Coarse public sponsorship milestones rounded down to groups of five. Individual IDs, timestamps, intervals, exact counts, and amounts are never published.';

REVOKE ALL ON public.public_beneficiary_sponsorship_milestones
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_beneficiary_sponsorship_milestones TO anon, authenticated;
GRANT SELECT ON public.public_beneficiary_sponsorship_milestones TO service_role;

ALTER TABLE public.transaction_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.transaction_ledger TO authenticated;
GRANT SELECT, INSERT ON public.transaction_ledger TO service_role;
DROP POLICY IF EXISTS insert_user ON public.transaction_ledger;
DROP POLICY IF EXISTS transaction_ledger_select_super_admin ON public.transaction_ledger;
CREATE POLICY transaction_ledger_select_super_admin
ON public.transaction_ledger
FOR SELECT
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()));

ALTER TABLE public.partnerships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partnerships FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.partnerships TO service_role;
DROP POLICY IF EXISTS "Allow public insert" ON public.partnerships;
DROP POLICY IF EXISTS "Allow users to view own partnerships" ON public.partnerships;

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON public.email_logs TO service_role;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activities FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.activities TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO service_role;
DROP POLICY IF EXISTS activities_select_public ON public.activities;
DROP POLICY IF EXISTS activities_manage_super_admin ON public.activities;
CREATE POLICY activities_manage_super_admin
ON public.activities
FOR ALL
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()))
WITH CHECK ((SELECT private.is_creator_share_super_admin()));

CREATE OR REPLACE VIEW public.public_activities
WITH (security_barrier = true)
AS
SELECT
  activity.id,
  activity.created_at,
  activity.description,
  activity.beneficiary_id,
  activity.title,
  activity.activity_type
FROM public.activities activity
JOIN public.beneficiaries beneficiary
  ON beneficiary.id = activity.beneficiary_id
WHERE activity.is_public IS TRUE
  AND beneficiary.status NOT IN ('Draft', 'Archived');

COMMENT ON VIEW public.public_activities IS
  'Explicit public activity projection. Internal actor IDs, authorship, metadata, stored URLs, private activities, and activities for unpublished beneficiaries are excluded.';

REVOKE ALL ON public.public_activities
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_activities TO anon, authenticated, service_role;

ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.media TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.media TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media TO service_role;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.media;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.media;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.media;
DROP POLICY IF EXISTS media_select_public ON public.media;
DROP POLICY IF EXISTS media_manage_super_admin ON public.media;
CREATE POLICY media_manage_super_admin
ON public.media
FOR ALL
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()))
WITH CHECK ((SELECT private.is_creator_share_super_admin()));

CREATE OR REPLACE VIEW public.public_media
WITH (security_barrier = true)
AS
SELECT
  media.id,
  media.created_at,
  media.extension,
  media.parent_id,
  media.type,
  media.weight
FROM public.media media
WHERE EXISTS (
  SELECT 1
  FROM public.beneficiaries beneficiary
  WHERE beneficiary.id = media.parent_id
    AND beneficiary.status NOT IN ('Draft', 'Archived')
)
OR EXISTS (
  SELECT 1
  FROM public.activities activity
  JOIN public.beneficiaries beneficiary
    ON beneficiary.id = activity.beneficiary_id
  WHERE activity.id = media.parent_id
    AND activity.is_public IS TRUE
    AND beneficiary.status NOT IN ('Draft', 'Archived')
);

COMMENT ON VIEW public.public_media IS
  'Public media projection limited to published beneficiaries and their public activities.';

REVOKE ALL ON public.public_media
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_media TO anon, authenticated, service_role;

REVOKE ALL ON public.beneficiaries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.beneficiaries TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.beneficiaries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beneficiaries TO service_role;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.beneficiaries;
DROP POLICY IF EXISTS "Enable insert for SUPER_ADMIN users only" ON public.beneficiaries;
DROP POLICY IF EXISTS "Enable update for SUPER_ADMIN users only" ON public.beneficiaries;
DROP POLICY IF EXISTS "Enable delete for SUPER_ADMIN users only" ON public.beneficiaries;
DROP POLICY IF EXISTS beneficiaries_select_public ON public.beneficiaries;
CREATE POLICY beneficiaries_manage_super_admin
ON public.beneficiaries
FOR ALL
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()))
WITH CHECK ((SELECT private.is_creator_share_super_admin()));

CREATE OR REPLACE VIEW public.public_beneficiaries
WITH (security_barrier = true)
AS
SELECT
  beneficiary.id,
  beneficiary.created_at,
  beneficiary.name,
  date_trunc('month', beneficiary.birth_date)::date AS birth_date,
  beneficiary.biography,
  beneficiary.budget_goal,
  beneficiary.budget_raised,
  beneficiary.status,
  beneficiary.country,
  beneficiary.location_str,
  public.ST_SnapToGrid(beneficiary.location_geo, 0.05) AS location_geo,
  beneficiary.gender,
  beneficiary.video_url,
  beneficiary.introduction,
  beneficiary.active_subscriptions,
  beneficiary.username,
  jsonb_build_object(
    'birth_date_is_estimate',
      COALESCE(beneficiary.metadata ->> 'birth_date_is_estimate', 'false') = 'true',
    'birth_date_precision', 'month'
  ) AS metadata,
  beneficiary.beneficiary_type,
  beneficiary.goal_fulfilled_at,
  beneficiary.sort_weight
FROM public.beneficiaries beneficiary
WHERE beneficiary.status NOT IN ('Draft', 'Archived');

COMMENT ON VIEW public.public_beneficiaries IS
  'Explicit public beneficiary projection. Draft records, exact birth dates, exact coordinates, arbitrary metadata, and future base-table columns are not exposed.';

REVOKE ALL ON public.public_beneficiaries
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_beneficiaries TO anon, authenticated, service_role;

ALTER TABLE public.activity_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.activity_subscriptions TO authenticated;
GRANT SELECT ON public.activity_subscriptions TO service_role;
DROP POLICY IF EXISTS activity_subscriptions_insert_public ON public.activity_subscriptions;
DROP POLICY IF EXISTS activity_subscriptions_select_super_admin ON public.activity_subscriptions;
CREATE POLICY activity_subscriptions_select_super_admin
ON public.activity_subscriptions
FOR SELECT
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()));

ALTER TABLE public.beneficiary_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beneficiary_reservations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beneficiary_reservations TO service_role;
DROP POLICY IF EXISTS allow_delete_own ON public.beneficiary_reservations;
DROP POLICY IF EXISTS allow_insert_own ON public.beneficiary_reservations;
DROP POLICY IF EXISTS allow_select_active ON public.beneficiary_reservations;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expenses FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.expense_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_assignments TO authenticated, service_role;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.expenses;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.expense_assignments;
CREATE POLICY expenses_manage_super_admin
ON public.expenses
FOR ALL
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()))
WITH CHECK ((SELECT private.is_creator_share_super_admin()));
CREATE POLICY expense_assignments_manage_super_admin
ON public.expense_assignments
FOR ALL
TO authenticated
USING ((SELECT private.is_creator_share_super_admin()))
WITH CHECK ((SELECT private.is_creator_share_super_admin()));

ALTER TABLE public.initiative ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.initiative FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.organization FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.project FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.initiative TO anon, authenticated, service_role;
GRANT SELECT ON public.organization TO anon, authenticated, service_role;
GRANT SELECT ON public.project TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.initiative TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.organization TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.project TO service_role;

CREATE OR REPLACE FUNCTION private.enqueue_domain_provisioning_job_internal(
  target_domain_id uuid,
  target_integration_id uuid,
  job_kind public.domain_provisioning_job_kind,
  requested_run_at timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate_id uuid;
  v_provider public.advocate_domain_integration_provider;
  v_domain_status public.advocate_domain_status;
  v_integration_status public.advocate_domain_integration_status;
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
  v_existing_job_id uuid;
  v_existing_kind public.domain_provisioning_job_kind;
  v_job_id uuid;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF target_domain_id IS NULL
     OR target_integration_id IS NULL
     OR job_kind IS NULL
     OR requested_run_at IS NULL
     OR requested_run_at < v_now - interval '5 seconds'
     OR requested_run_at > v_now + interval '30 days' THEN
    RAISE EXCEPTION 'Domain provisioning enqueue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    integration.advocate_id,
    integration.provider,
    domain.status,
    integration.status,
    advocate.relationship_status,
    advocate.publication_status
  INTO
    v_advocate_id,
    v_provider,
    v_domain_status,
    v_integration_status,
    v_relationship_status,
    v_publication_status
  FROM public.advocate_domain_integrations integration
  JOIN public.advocate_domains domain
    ON domain.id = integration.domain_id
   AND domain.advocate_id = integration.advocate_id
  JOIN public.advocates advocate
    ON advocate.id = integration.advocate_id
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id
  FOR UPDATE OF integration;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF job_kind = 'provision' THEN
    IF v_relationship_status <> 'active'
       OR v_publication_status = 'suspended'
       OR v_domain_status NOT IN ('pending', 'provisioning', 'failed', 'disabled')
       OR v_integration_status NOT IN ('pending', 'provisioning', 'failed', 'disabled') THEN
      RAISE EXCEPTION 'Domain integration is not eligible for provisioning'
        USING ERRCODE = '55000';
    END IF;
  ELSIF job_kind = 'reconcile' THEN
    IF v_relationship_status <> 'active'
       OR v_publication_status = 'suspended'
       OR v_domain_status NOT IN ('provisioning', 'verifying', 'active', 'failed')
       OR v_integration_status = 'disabled' THEN
      RAISE EXCEPTION 'Domain integration is not eligible for reconciliation'
        USING ERRCODE = '55000';
    END IF;
  ELSIF job_kind = 'deprovision' THEN
    IF v_domain_status NOT IN ('redirecting', 'disabled') THEN
      RAISE EXCEPTION 'Domain must be redirecting or disabled before deprovisioning'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported domain provisioning job kind'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.id, job.kind
  INTO v_existing_job_id, v_existing_kind
  FROM public.domain_provisioning_jobs job
  WHERE job.integration_id = target_integration_id
    AND job.status IN ('queued', 'running')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_kind = job_kind THEN
      RETURN v_existing_job_id;
    END IF;

    RAISE EXCEPTION 'A conflicting domain integration operation is already open'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.domain_provisioning_jobs (
    advocate_id,
    domain_id,
    integration_id,
    kind,
    provider,
    run_after,
    request_payload
  )
  VALUES (
    v_advocate_id,
    target_domain_id,
    target_integration_id,
    job_kind,
    v_provider,
    requested_run_at,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_domain_provisioning_job_internal(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_domain_provisioning_job(
  target_domain_id uuid,
  target_integration_id uuid,
  job_kind public.domain_provisioning_job_kind,
  change_reason text,
  requested_run_at timestamp with time zone DEFAULT now(),
  request_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_hostname text;
  v_provider public.advocate_domain_integration_provider;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(change_reason), '') IS NULL
     OR char_length(change_reason) > 2000 THEN
    RAISE EXCEPTION 'A provisioning reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255 THEN
    RAISE EXCEPTION 'Provisioning request id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT domain.hostname, integration.provider
  INTO v_hostname, v_provider
  FROM public.advocate_domain_integrations integration
  JOIN public.advocate_domains domain
    ON domain.id = integration.domain_id
   AND domain.advocate_id = integration.advocate_id
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-domains',
    context_request_id => request_id,
    context_reason => btrim(change_reason),
    context_metadata => jsonb_build_object(
      'operation', 'enqueue',
      'resource_kind', 'domain_integration',
      'resource_id', target_integration_id::text,
      'provider', v_provider::text,
      'domain_hostname', v_hostname
    )
  );

  RETURN private.enqueue_domain_provisioning_job_internal(
    target_domain_id,
    target_integration_id,
    job_kind,
    requested_run_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_domain_provisioning_job_system(
  target_domain_id uuid,
  target_integration_id uuid,
  job_kind public.domain_provisioning_job_kind,
  requested_run_at timestamp with time zone DEFAULT now(),
  correlation_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hostname text;
  v_provider public.advocate_domain_integration_provider;
BEGIN
  IF char_length(COALESCE(correlation_id, '')) > 255 THEN
    RAISE EXCEPTION 'Provisioning correlation id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT domain.hostname, integration.provider
  INTO v_hostname, v_provider
  FROM public.advocate_domain_integrations integration
  JOIN public.advocate_domains domain
    ON domain.id = integration.domain_id
   AND domain.advocate_id = integration.advocate_id
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-orchestrator',
    context_tool => 'domain-provisioning-enqueue',
    context_trace_id => correlation_id,
    context_reason => 'Automated advocate domain integration enqueue',
    context_metadata => jsonb_build_object(
      'operation', 'enqueue',
      'resource_kind', 'domain_integration',
      'resource_id', target_integration_id::text,
      'provider', v_provider::text,
      'domain_hostname', v_hostname
    )
  );

  RETURN private.enqueue_domain_provisioning_job_internal(
    target_domain_id,
    target_integration_id,
    job_kind,
    requested_run_at
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  text,
  timestamp with time zone,
  text
) IS
  'Creator Share administrator enqueue. Tenant and provider identity are derived from the integration, one open action is allowed, and the audit reason is mandatory.';
COMMENT ON FUNCTION public.enqueue_domain_provisioning_job_system(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone,
  text
) IS
  'Service-only idempotent enqueue for the domain orchestrator. Repeated calls return the existing open job of the same kind.';

REVOKE ALL ON FUNCTION public.enqueue_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  text,
  timestamp with time zone,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_domain_provisioning_job_system(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  text,
  timestamp with time zone,
  text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_domain_provisioning_job_system(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_domain_provisioning_jobs(
  worker_id text,
  batch_size integer DEFAULT 10,
  lease_duration interval DEFAULT interval '5 minutes'
)
RETURNS TABLE (
  job_id uuid,
  advocate_id uuid,
  domain_id uuid,
  integration_id uuid,
  kind public.domain_provisioning_job_kind,
  provider public.advocate_domain_integration_provider,
  attempt_count integer,
  max_attempts integer,
  provider_idempotency_key text,
  request_payload jsonb,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  reconciliation_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_batch_id uuid := gen_random_uuid();
BEGIN
  IF worker_id IS NULL
     OR char_length(worker_id) NOT BETWEEN 1 AND 128
     OR worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' THEN
    RAISE EXCEPTION 'Domain provisioning worker id is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 100 THEN
    RAISE EXCEPTION 'Domain provisioning claim batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  IF lease_duration IS NULL
     OR lease_duration < interval '5 seconds'
     OR lease_duration > interval '15 minutes' THEN
    RAISE EXCEPTION 'Domain provisioning lease must be between 5 seconds and 15 minutes'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-worker',
    context_tool => 'domain-provisioning-claim',
    context_reason => 'Atomic domain provisioning lease claim and stale lease recovery',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'domain_provisioning_job',
      'batch_id', v_batch_id::text
    )
  );

  RETURN QUERY
  WITH exhausted AS (
    UPDATE public.domain_provisioning_jobs job
    SET
      status = 'failed',
      lease_owner = NULL,
      lease_token = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      finished_at = v_now,
      last_error = 'lease_expired_max_attempts'
    WHERE job.status = 'running'
      AND job.lease_expires_at <= v_now
      AND job.attempt_count >= job.max_attempts
    RETURNING job.id
  ), candidates AS (
    SELECT job.id
    FROM public.domain_provisioning_jobs job
    WHERE (
        (
          job.status = 'queued'
          AND job.run_after <= v_now
          AND job.attempt_count < job.max_attempts
        )
        OR (
          job.status = 'running'
          AND job.lease_expires_at <= v_now
          AND job.attempt_count < job.max_attempts
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM exhausted WHERE exhausted.id = job.id
      )
    ORDER BY
      CASE WHEN job.status = 'running' THEN 0 ELSE 1 END,
      job.run_after,
      job.created_at,
      job.id
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  ), claimed AS (
    UPDATE public.domain_provisioning_jobs job
    SET
      status = 'running',
      attempt_count = job.attempt_count + 1,
      lease_owner = worker_id,
      lease_token = gen_random_uuid(),
      leased_at = v_now,
      lease_expires_at = v_now + lease_duration,
      started_at = COALESCE(job.started_at, v_now),
      finished_at = NULL,
      reconciliation_required = true,
      reconciliation_outcome = NULL,
      reconciled_at = NULL,
      result_payload = '{}'::jsonb,
      last_error = NULL
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  )
  SELECT
    claimed.id,
    claimed.advocate_id,
    claimed.domain_id,
    claimed.integration_id,
    claimed.kind,
    claimed.provider,
    claimed.attempt_count,
    claimed.max_attempts,
    claimed.provider_idempotency_key,
    claimed.request_payload,
    claimed.lease_token,
    claimed.lease_expires_at,
    claimed.reconciliation_required
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_domain_provisioning_job_lease(
  target_job_id uuid,
  target_lease_token uuid,
  lease_duration interval DEFAULT interval '5 minutes'
)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_lease_expires_at timestamp with time zone;
BEGIN
  IF lease_duration IS NULL
     OR lease_duration < interval '5 seconds'
     OR lease_duration > interval '15 minutes' THEN
    RAISE EXCEPTION 'Domain provisioning lease must be between 5 seconds and 15 minutes'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_lease_expires_at := v_now + lease_duration;

  IF v_lease_expires_at <= v_job.lease_expires_at THEN
    RAISE EXCEPTION 'Domain provisioning lease renewal must extend the current lease'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-worker',
    context_tool => 'domain-provisioning-renew',
    context_reason => 'Active domain provisioning worker renewed its fenced lease',
    context_metadata => jsonb_build_object(
      'operation', 'renew_lease',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    leased_at = v_now,
    lease_expires_at = v_lease_expires_at
  WHERE job.id = v_job.id;

  RETURN v_lease_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_domain_provisioning_reconciliation(
  target_job_id uuid,
  target_lease_token uuid,
  reconciliation_result text,
  evidence_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF reconciliation_result IS NULL
     OR reconciliation_result NOT IN (
       'not_found',
       'matches_intent',
       'needs_apply',
       'conflict',
       'inconclusive'
     ) THEN
    RAISE EXCEPTION 'Domain provisioning reconciliation outcome is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    COALESCE(evidence_payload, '{}'::jsonb),
    'result'
  );

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now
     OR NOT v_job.reconciliation_required
     OR v_job.reconciliation_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-worker',
    context_tool => 'domain-provisioning-reconcile',
    context_reason => 'Provider state reconciled before external mutation or completion',
    context_metadata => jsonb_build_object(
      'operation', 'reconcile',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'outcome', reconciliation_result
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    reconciliation_required = reconciliation_result IN ('conflict', 'inconclusive'),
    reconciliation_outcome = reconciliation_result,
    reconciled_at = v_now,
    result_payload = job.result_payload || COALESCE(evidence_payload, '{}'::jsonb)
  WHERE job.id = v_job.id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval) IS
  'Atomically claims due work with SKIP LOCKED, rotates stale fencing tokens, increments attempts, and permanently fails exhausted stale leases.';
COMMENT ON FUNCTION public.renew_domain_provisioning_job_lease(uuid, uuid, interval) IS
  'Extends an unexpired lease under its current fencing token. Long provider calls must heartbeat rather than permit an in-flight operation to be reclaimed.';
COMMENT ON FUNCTION public.record_domain_provisioning_reconciliation(uuid, uuid, text, jsonb) IS
  'Records the mandatory provider lookup under the current unexpired lease. Conflict and inconclusive outcomes keep provider mutation fenced.';

REVOKE ALL ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.renew_domain_provisioning_job_lease(uuid, uuid, interval)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_domain_provisioning_reconciliation(
  uuid,
  uuid,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_domain_provisioning_job_lease(uuid, uuid, interval)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_domain_provisioning_reconciliation(
  uuid,
  uuid,
  text,
  jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_domain_provisioning_job(
  target_job_id uuid,
  target_lease_token uuid,
  completion_status public.domain_provisioning_job_status,
  completion_code text DEFAULT NULL,
  provider_result jsonb DEFAULT '{}'::jsonb
)
RETURNS public.domain_provisioning_job_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_final_result jsonb;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF completion_status IS NULL
     OR completion_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'Completion status must be succeeded or failed'
      USING ERRCODE = '22023';
  END IF;

  IF (completion_status = 'succeeded' AND completion_code IS NOT NULL)
     OR (
       completion_status = 'failed'
       AND (
         completion_code IS NULL
         OR completion_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
       )
     ) THEN
    RAISE EXCEPTION 'Domain provisioning completion code is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    COALESCE(provider_result, '{}'::jsonb),
    'result'
  );

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF completion_status = 'succeeded' AND v_job.reconciliation_required THEN
    RAISE EXCEPTION 'Provider reconciliation is required before successful completion'
      USING ERRCODE = '55000';
  END IF;

  v_final_result := v_job.result_payload || COALESCE(provider_result, '{}'::jsonb);

  IF completion_status = 'succeeded'
     AND NOT v_final_result @> '{"verified":true}'::jsonb THEN
    RAISE EXCEPTION 'Verified provider state is required before successful completion'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-worker',
    context_tool => 'domain-provisioning-complete',
    context_reason => 'Domain provisioning worker recorded a terminal provider outcome',
    context_metadata => jsonb_build_object(
      'operation', 'complete',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'outcome', completion_status::text,
      'retry_count', GREATEST(v_job.attempt_count - 1, 0)
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    status = completion_status,
    lease_owner = NULL,
    lease_token = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    finished_at = v_now,
    result_payload = v_final_result,
    last_error = completion_code
  WHERE job.id = v_job.id;

  RETURN completion_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_domain_provisioning_job(
  target_job_id uuid,
  target_lease_token uuid,
  retry_delay interval,
  retry_code text,
  provider_result jsonb DEFAULT '{}'::jsonb
)
RETURNS public.domain_provisioning_job_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_next_status public.domain_provisioning_job_status;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF retry_delay IS NULL
     OR retry_delay < interval '1 second'
     OR retry_delay > interval '24 hours' THEN
    RAISE EXCEPTION 'Domain provisioning retry delay must be between 1 second and 24 hours'
      USING ERRCODE = '22023';
  END IF;

  IF retry_code IS NULL
     OR retry_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'Domain provisioning retry code is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    COALESCE(provider_result, '{}'::jsonb),
    'result'
  );

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_next_status := CASE
    WHEN v_job.attempt_count >= v_job.max_attempts
      THEN 'failed'::public.domain_provisioning_job_status
    ELSE 'queued'::public.domain_provisioning_job_status
  END;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-worker',
    context_tool => 'domain-provisioning-retry',
    context_reason => 'Domain provisioning worker scheduled a bounded retry',
    context_metadata => jsonb_build_object(
      'operation', 'retry',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'outcome', v_next_status::text,
      'retry_count', v_job.attempt_count
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    status = v_next_status,
    run_after = CASE
      WHEN v_next_status = 'queued' THEN v_now + retry_delay
      ELSE job.run_after
    END,
    lease_owner = NULL,
    lease_token = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    finished_at = CASE WHEN v_next_status = 'failed' THEN v_now ELSE NULL END,
    reconciliation_required = true,
    reconciliation_outcome = NULL,
    reconciled_at = NULL,
    result_payload = job.result_payload || COALESCE(provider_result, '{}'::jsonb),
    last_error = retry_code
  WHERE job.id = v_job.id;

  RETURN v_next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_domain_provisioning_job(
  target_job_id uuid,
  target_lease_token uuid,
  cancellation_code text DEFAULT 'worker_cancelled',
  provider_result jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF cancellation_code IS NULL
     OR cancellation_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'Domain provisioning cancellation code is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    COALESCE(provider_result, '{}'::jsonb),
    'result'
  );

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-worker',
    context_tool => 'domain-provisioning-cancel',
    context_reason => 'Domain provisioning worker cancelled its active leased operation',
    context_metadata => jsonb_build_object(
      'operation', 'cancel',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'outcome', 'cancelled'
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    status = 'cancelled',
    lease_owner = NULL,
    lease_token = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    finished_at = v_now,
    result_payload = job.result_payload || COALESCE(provider_result, '{}'::jsonb),
    last_error = cancellation_code
  WHERE job.id = v_job.id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_queued_domain_provisioning_job(
  target_job_id uuid,
  change_reason text,
  request_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(change_reason), '') IS NULL
     OR char_length(change_reason) > 2000 THEN
    RAISE EXCEPTION 'A cancellation reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255 THEN
    RAISE EXCEPTION 'Cancellation request id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status <> 'queued' THEN
    RAISE EXCEPTION 'Only queued domain provisioning work can be administratively cancelled'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-domains',
    context_request_id => request_id,
    context_reason => btrim(change_reason),
    context_metadata => jsonb_build_object(
      'operation', 'cancel',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'outcome', 'cancelled'
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    status = 'cancelled',
    finished_at = v_now,
    last_error = 'administrator_cancelled'
  WHERE job.id = v_job.id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.complete_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_status,
  text,
  jsonb
) IS
  'Token-fenced worker completion. Success is impossible until provider reconciliation has produced a safe outcome.';
COMMENT ON FUNCTION public.retry_domain_provisioning_job(uuid, uuid, interval, text, jsonb) IS
  'Token-fenced bounded retry. The stable provider idempotency key survives, reconciliation becomes mandatory again, and the final attempt fails closed.';
COMMENT ON FUNCTION public.cancel_domain_provisioning_job(uuid, uuid, text, jsonb) IS
  'Token-fenced worker cancellation. An administrator cannot cancel running work because the external provider call may already be in flight.';
COMMENT ON FUNCTION public.cancel_queued_domain_provisioning_job(uuid, text, text) IS
  'Creator Share administrator cancellation for work that has not been leased. Running work remains fenced to the current worker token.';

REVOKE ALL ON FUNCTION public.complete_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_status,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retry_domain_provisioning_job(uuid, uuid, interval, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_domain_provisioning_job(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_queued_domain_provisioning_job(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_status,
  text,
  jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_domain_provisioning_job(uuid, uuid, interval, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_domain_provisioning_job(uuid, uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_queued_domain_provisioning_job(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION audit.prevent_audited_table_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Audited application tables cannot be truncated'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION audit.prevent_audited_table_truncate()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'advocates',
    'advocate_reserved_subdomains',
    'advocate_domains',
    'advocate_domain_integrations',
    'domain_provisioning_jobs',
    'advocate_branding',
    'advocate_public_metric_selections',
    'advocate_beneficiaries',
    'advocate_memberships',
    'advocate_roles',
    'advocate_permissions',
    'advocate_role_permissions',
    'advocate_membership_roles',
    'advocate_invitations',
    'advocate_invitation_roles',
    'role_assignments',
    'roles',
    'permissions',
    'permission_assignments',
    'activities',
    'activity_subscriptions',
    'beneficiaries',
    'beneficiary_reservations',
    'email_logs',
    'expense_assignments',
    'expenses',
    'initiative',
    'media',
    'organization',
    'partnerships',
    'project',
    'subscriptions',
    'transaction_ledger',
    'users'
  ]::text[]
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      v_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_audited_table_truncate()',
      v_table_name
    );
  END LOOP;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit
  REVOKE USAGE, SELECT ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;

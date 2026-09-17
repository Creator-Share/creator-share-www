BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE claim_link_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
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
  updated_at
)
VALUES (
  '99000000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'persistent-claim@example.test',
  clock_timestamp(),
  '{}'::jsonb,
  '{"first_name":"Persistent","last_name":"Claim"}'::jsonb,
  clock_timestamp(),
  clock_timestamp()
);

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO claim_link_context
SELECT 'pending_identity', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsor_identities (auth_user_id)
  VALUES ('99000000-0000-4000-8000-000000000001'::uuid)
  RETURNING id
)
INSERT INTO claim_link_context
SELECT 'consumed_identity', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO claim_link_context
SELECT 'expired_identity', id FROM inserted;

INSERT INTO public.sponsor_identifiers (
  sponsor_identity_id,
  kind,
  issuer_scope,
  identifier_digest,
  confidence,
  verified_at
)
SELECT
  value,
  'email',
  'creator_share',
  decode(repeat('b2', 32), 'hex'),
  'verified',
  clock_timestamp()
FROM claim_link_context
WHERE key = 'consumed_identity';

INSERT INTO public.sponsor_identifiers (
  sponsor_identity_id,
  kind,
  issuer_scope,
  identifier_digest,
  confidence
)
SELECT
  value,
  'email',
  'creator_share',
  decode(repeat('a1', 32), 'hex'),
  'provider_asserted'
FROM claim_link_context
WHERE key = 'pending_identity';

INSERT INTO public.sponsor_identifiers (
  sponsor_identity_id,
  kind,
  issuer_scope,
  identifier_digest,
  confidence
)
SELECT
  value,
  'email',
  'creator_share',
  decode(repeat('e5', 32), 'hex'),
  'provider_asserted'
FROM claim_link_context
WHERE key = 'expired_identity';

WITH inserted AS (
  INSERT INTO public.sponsorship_intents (
    idempotency_key,
    source,
    source_host,
    sponsor_identity_id,
    contact_email_hmac,
    contact_email_normalization_version,
    contact_email_hmac_key_version,
    subject_kind,
    payment_mode,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'persistent-claim-link-pending',
    'primary_site',
    'creatorshare.com',
    value,
    decode(repeat('a1', 32), 'hex'),
    1,
    1,
    'blind',
    'one_time',
    2500,
    2500,
    'USD',
    1,
    clock_timestamp(),
    'claim-link-test'
  FROM claim_link_context
  WHERE key = 'pending_identity'
  RETURNING id
)
INSERT INTO claim_link_context
SELECT 'pending_intent', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsorship_intents (
    idempotency_key,
    source,
    source_host,
    auth_user_id,
    sponsor_identity_id,
    contact_email_hmac,
    contact_email_normalization_version,
    contact_email_hmac_key_version,
    subject_kind,
    payment_mode,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'persistent-claim-link-consumed',
    'primary_site',
    'creatorshare.com',
    '99000000-0000-4000-8000-000000000001'::uuid,
    value,
    decode(repeat('b2', 32), 'hex'),
    1,
    1,
    'blind',
    'one_time',
    2500,
    2500,
    'USD',
    1,
    clock_timestamp(),
    'claim-link-test'
  FROM claim_link_context
  WHERE key = 'consumed_identity'
  RETURNING id
)
INSERT INTO claim_link_context
SELECT 'consumed_intent', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsorship_intents (
    idempotency_key,
    source,
    source_host,
    sponsor_identity_id,
    contact_email_hmac,
    contact_email_normalization_version,
    contact_email_hmac_key_version,
    subject_kind,
    payment_mode,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'persistent-claim-link-expired',
    'primary_site',
    'creatorshare.com',
    value,
    decode(repeat('e5', 32), 'hex'),
    1,
    1,
    'blind',
    'one_time',
    2500,
    2500,
    'USD',
    1,
    clock_timestamp(),
    'claim-link-test'
  FROM claim_link_context
  WHERE key = 'expired_identity'
  RETURNING id
)
INSERT INTO claim_link_context
SELECT 'expired_intent', id FROM inserted;

UPDATE public.sponsorship_intents
SET status = 'committed'
WHERE idempotency_key LIKE 'persistent-claim-link-%';

UPDATE public.sponsorship_intents
SET status = 'succeeded'
WHERE idempotency_key LIKE 'persistent-claim-link-%';

INSERT INTO public.sponsorship_account_claims (
  sponsorship_intent_id,
  email_hmac,
  token_digest,
  status,
  sponsor_identity_id,
  expires_at
)
SELECT
  value,
  decode(repeat('a1', 32), 'hex'),
  decode(repeat('c3', 32), 'hex'),
  'pending',
  (SELECT value FROM claim_link_context WHERE key = 'pending_identity'),
  clock_timestamp() + interval '6 days'
FROM claim_link_context
WHERE key = 'pending_intent';

INSERT INTO public.sponsorship_account_claims (
  sponsorship_intent_id,
  email_hmac,
  token_digest,
  sponsor_identity_id,
  expires_at
)
SELECT
  value,
  decode(repeat('b2', 32), 'hex'),
  decode(repeat('d4', 32), 'hex'),
  (SELECT value FROM claim_link_context WHERE key = 'consumed_identity'),
  clock_timestamp() + interval '6 days'
FROM claim_link_context
WHERE key = 'consumed_intent';

SELECT count(*)
FROM public.issue_sponsor_account_email_verification(
  target_auth_user_id =>
    '99000000-0000-4000-8000-000000000001'::uuid,
  target_email_hmac => decode(repeat('b2', 32), 'hex')
);

UPDATE public.sponsor_account_email_verifications
SET status = 'consumed'
WHERE auth_user_id = '99000000-0000-4000-8000-000000000001'::uuid
  AND status = 'issued';

UPDATE public.sponsorship_account_claims
SET
  status = 'consumed',
  target_auth_user_id = '99000000-0000-4000-8000-000000000001'::uuid
WHERE token_digest = decode(repeat('d4', 32), 'hex');

INSERT INTO public.sponsorship_account_claims (
  sponsorship_intent_id,
  email_hmac,
  token_digest,
  sponsor_identity_id,
  expires_at
)
SELECT
  value,
  decode(repeat('e5', 32), 'hex'),
  decode(repeat('f6', 32), 'hex'),
  (SELECT value FROM claim_link_context WHERE key = 'expired_identity'),
  clock_timestamp() + interval '100 milliseconds'
FROM claim_link_context
WHERE key = 'expired_intent';

/* Build historical expiry evidence without waiting 400 days. */
SET LOCAL session_replication_role = replica;
UPDATE public.sponsorship_account_claims
SET
  requested_at = statement_timestamp() - interval '401 days',
  expires_at = statement_timestamp() - interval '1 day'
WHERE token_digest = decode(repeat('f6', 32), 'hex');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  (
    SELECT claim_start_mode
    FROM public.resolve_sponsor_account_claim_start(
      decode(repeat('c3', 32), 'hex'),
      decode(repeat('a1', 32), 'hex')
    )
  ),
  'initial-claim',
  'a live pending claim may create the sponsor account'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_account_claims claim
    WHERE claim.token_digest = decode(repeat('c3', 32), 'hex')
      AND claim.expires_at = claim.requested_at + interval '400 days'
  ),
  'new pending claims receive the canonical 400 day expiry'
);

SELECT extensions.is(
  (
    SELECT claim_start_mode
    FROM public.resolve_sponsor_account_claim_start(
      decode(repeat('d4', 32), 'hex'),
      decode(repeat('b2', 32), 'hex')
    )
  ),
  'account-reauth',
  'a consumed claim remains a same-account passwordless entry point'
);

SELECT extensions.is_empty(
  $$
    SELECT claim_start_mode
    FROM public.resolve_sponsor_account_claim_start(
      decode(repeat('c3', 32), 'hex'),
      decode(repeat('ff', 32), 'hex')
    )
  $$,
  'the token alone cannot resolve an account entry mode'
);

SELECT extensions.is_empty(
  $$
    SELECT claim_start_mode
    FROM public.resolve_sponsor_account_claim_start(
      decode(repeat('f6', 32), 'hex'),
      decode(repeat('e5', 32), 'hex')
    )
  $$,
  'an expired never-consumed claim cannot regain account creation authority'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resolve_sponsor_account_claim_start(
      decode('01', 'hex'),
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  '22023',
  'Sponsor account claim start proof is malformed or unsupported',
  'malformed claim proof is rejected'
);

RESET ROLE;

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.resolve_sponsor_account_claim_start(bytea,bytea,smallint,smallint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.resolve_sponsor_account_claim_start(bytea,bytea,smallint,smallint,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.resolve_sponsor_account_claim_start(bytea,bytea,smallint,smallint,text,text)',
    'EXECUTE'
  ),
  'only the service role can resolve sponsor account entry mode'
);

SELECT * FROM extensions.finish();

ROLLBACK;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE welcome_hardening_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  text_value text
) ON COMMIT DROP;

GRANT ALL ON welcome_hardening_context TO service_role;

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO welcome_hardening_context (key, uuid_value)
SELECT 'identity', id FROM inserted;

INSERT INTO public.sponsor_identifiers (
  sponsor_identity_id,
  kind,
  issuer_scope,
  identifier_digest,
  confidence
)
SELECT
  uuid_value,
  'email',
  'creator_share',
  decode(repeat('a1', 32), 'hex'),
  'provider_asserted'
FROM welcome_hardening_context
WHERE key = 'identity';

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
    'welcome-hardening-intent',
    'primary_site',
    'creatorshare.com',
    uuid_value,
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
    'welcome-hardening-test'
  FROM welcome_hardening_context
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO welcome_hardening_context (key, uuid_value)
SELECT 'intent', id FROM inserted;

UPDATE public.sponsorship_intents
SET status = 'committed'
WHERE idempotency_key = 'welcome-hardening-intent';

UPDATE public.sponsorship_intents
SET status = 'succeeded'
WHERE idempotency_key = 'welcome-hardening-intent';

WITH inserted AS (
  INSERT INTO public.sponsorship_account_claims (
    sponsorship_intent_id,
    email_hmac,
    token_digest,
    sponsor_identity_id,
    expires_at
  )
  SELECT
    (SELECT uuid_value FROM welcome_hardening_context WHERE key = 'intent'),
    decode(repeat('a1', 32), 'hex'),
    decode(repeat('b2', 32), 'hex'),
    uuid_value,
    clock_timestamp() + interval '1 day'
  FROM welcome_hardening_context
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO welcome_hardening_context (key, uuid_value)
SELECT 'claim', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.email_outbox (
    kind,
    account_claim_id,
    sponsor_identity_id,
    dedupe_key,
    recipient_email_ciphertext,
    recipient_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    email_encryption_key_version,
    template_key,
    template_data,
    secret_payload_ciphertext
  )
  SELECT
    'sponsor_welcome',
    (SELECT uuid_value FROM welcome_hardening_context WHERE key = 'claim'),
    uuid_value,
    'sponsor_welcome:' || uuid_value::text,
    decode('010203', 'hex'),
    decode(repeat('a1', 32), 'hex'),
    1,
    1,
    1,
    'sponsor-welcome-v1',
    jsonb_build_object(
      'subject_kind', 'blind',
      'payment_mode', 'one_time',
      'locale', 'en-US'
    ),
    decode('040506', 'hex')
  FROM welcome_hardening_context
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO welcome_hardening_context (key, uuid_value)
SELECT 'outbox', id FROM inserted;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_account_claims claim
    WHERE claim.id = (
      SELECT uuid_value FROM welcome_hardening_context WHERE key = 'claim'
    )
      AND claim.expires_at = claim.requested_at + interval '400 days'
  ),
  'claim creation canonically persists the account entry link for 400 days'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.email_outbox outbox
    WHERE outbox.id = (
      SELECT uuid_value FROM welcome_hardening_context WHERE key = 'outbox'
    )
      AND outbox.contact_retention_expires_at =
        outbox.created_at + interval '90 days'
  ),
  'claim durability does not extend the 90 day encrypted contact envelope'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

WITH claimed AS (
  SELECT *
  FROM public.claim_email_outbox_jobs('welcome-hardening-worker', 1)
)
INSERT INTO welcome_hardening_context (key, uuid_value, text_value)
SELECT 'attempt_one', outbox_id, lease_token
FROM claimed;

SELECT extensions.is(
  (SELECT count(*)::integer FROM welcome_hardening_context WHERE key = 'attempt_one'),
  1,
  'the first welcome delivery attempt is claimed'
);

SELECT count(*)
FROM public.verify_email_outbox_delivery_material(
  target_outbox_id => (
    SELECT uuid_value FROM welcome_hardening_context WHERE key = 'attempt_one'
  ),
  target_lease_token => (
    SELECT text_value FROM welcome_hardening_context WHERE key = 'attempt_one'
  ),
  verified_recipient_email_hmac => decode(repeat('a1', 32), 'hex'),
  verified_claim_token_digest => decode(repeat('b2', 32), 'hex'),
  context_request_id => 'welcome-hardening-request-one'
);

SELECT public.begin_email_outbox_delivery_handoff(
  target_outbox_id => (
    SELECT uuid_value FROM welcome_hardening_context WHERE key = 'attempt_one'
  ),
  target_lease_token => (
    SELECT text_value FROM welcome_hardening_context WHERE key = 'attempt_one'
  ),
  verified_recipient_email_hmac => decode(repeat('a1', 32), 'hex'),
  target_provider_message_id =>
    '<sponsor-welcome.' ||
    (SELECT uuid_value::text FROM welcome_hardening_context WHERE key = 'attempt_one') ||
    '@creatorshare.com>',
  context_request_id => 'welcome-hardening-request-one'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.list_email_outbox_delivery_ambiguities(10)
    WHERE email_outbox_id = (
      SELECT uuid_value FROM welcome_hardening_context WHERE key = 'outbox'
    )
  ),
  1,
  'SMTP is already quarantined before the network handoff begins'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.fail_email_outbox_delivery(
        %L::uuid,
        %L,
        'welcome_email_delivery_failed',
        300
      )
    $sql$,
    (SELECT uuid_value FROM welcome_hardening_context WHERE key = 'attempt_one'),
    (SELECT text_value FROM welcome_hardening_context WHERE key = 'attempt_one')
  ),
  '55P03',
  'An uncertain SMTP handoff requires manual review',
  'an uncertain SMTP handoff cannot be converted into an automatic retry'
);

RESET ROLE;

SET LOCAL session_replication_role = replica;
UPDATE public.email_outbox
SET locked_at = clock_timestamp() - interval '11 minutes'
WHERE id = (
  SELECT uuid_value FROM welcome_hardening_context WHERE key = 'outbox'
);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is_empty(
  $$
    SELECT *
    FROM public.claim_email_outbox_jobs('welcome-hardening-stale-worker', 1)
  $$,
  'an unresolved handoff prevents stale lease redelivery'
);

SELECT count(*)
FROM public.resolve_email_outbox_delivery_ambiguity(
  target_handoff_id => (
    SELECT handoff_id
    FROM public.list_email_outbox_delivery_ambiguities(10)
    WHERE email_outbox_id = (
      SELECT uuid_value FROM welcome_hardening_context WHERE key = 'outbox'
    )
  ),
  target_resolution => 'confirmed_not_accepted',
  target_reason => 'Provider trace proves the SMTP server rejected before acceptance',
  context_operator_reference => 'INC_12345'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.email_outbox outbox
    WHERE outbox.id = (
      SELECT uuid_value FROM welcome_hardening_context WHERE key = 'outbox'
    )
      AND outbox.status = 'failed'
      AND outbox.last_error =
        'welcome_email_operator_confirmed_not_accepted'
      AND outbox.locked_at IS NULL
      AND outbox.locked_lease_token_digest IS NULL
  ),
  'only a confirmed nonacceptance resolution releases a retry'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

WITH claimed AS (
  SELECT *
  FROM public.claim_email_outbox_jobs('welcome-hardening-worker-two', 1)
)
INSERT INTO welcome_hardening_context (key, uuid_value, text_value)
SELECT 'attempt_two', outbox_id, lease_token
FROM claimed;

SELECT count(*)
FROM public.verify_email_outbox_delivery_material(
  target_outbox_id => (
    SELECT uuid_value FROM welcome_hardening_context WHERE key = 'attempt_two'
  ),
  target_lease_token => (
    SELECT text_value FROM welcome_hardening_context WHERE key = 'attempt_two'
  ),
  verified_recipient_email_hmac => decode(repeat('a1', 32), 'hex'),
  verified_claim_token_digest => decode(repeat('b2', 32), 'hex'),
  context_request_id => 'welcome-hardening-request-two'
);

SELECT public.begin_email_outbox_delivery_handoff(
  target_outbox_id => (
    SELECT uuid_value FROM welcome_hardening_context WHERE key = 'attempt_two'
  ),
  target_lease_token => (
    SELECT text_value FROM welcome_hardening_context WHERE key = 'attempt_two'
  ),
  verified_recipient_email_hmac => decode(repeat('a1', 32), 'hex'),
  target_provider_message_id =>
    '<sponsor-welcome.' ||
    (SELECT uuid_value::text FROM welcome_hardening_context WHERE key = 'attempt_two') ||
    '@creatorshare.com>',
  context_request_id => 'welcome-hardening-request-two'
);

SELECT public.complete_email_outbox_delivery(
  outbox_id => (
    SELECT uuid_value FROM welcome_hardening_context WHERE key = 'attempt_two'
  ),
  lease_token => (
    SELECT text_value FROM welcome_hardening_context WHERE key = 'attempt_two'
  ),
  verified_recipient_email_hmac => decode(repeat('a1', 32), 'hex'),
  provider_message_id =>
    '<sponsor-welcome.' ||
    (SELECT uuid_value::text FROM welcome_hardening_context WHERE key = 'attempt_two') ||
    '@creatorshare.com>'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.email_outbox outbox
    JOIN public.email_outbox_delivery_handoffs handoff
      ON handoff.email_outbox_id = outbox.id
      AND handoff.attempt_count = outbox.attempt_count
    WHERE outbox.id = (
      SELECT uuid_value FROM welcome_hardening_context WHERE key = 'outbox'
    )
      AND outbox.status = 'sent'
      AND handoff.status = 'confirmed_delivered'
      AND handoff.resolution_source = 'worker'
  ),
  'worker acceptance atomically settles the outbox and its handoff evidence'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'public.email_outbox_delivery_handoffs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.email_outbox_delivery_handoffs',
    'SELECT'
  ),
  'handoff evidence is unavailable through direct service or browser table access'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.begin_email_outbox_delivery_handoff(uuid,text,bytea,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.resolve_email_outbox_delivery_ambiguity(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.resolve_email_outbox_delivery_ambiguity(uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'only the payment service can begin or resolve SMTP ambiguity'
);

SELECT * FROM extensions.finish();

ROLLBACK;

BEGIN;

/*
 * PostgreSQL does not permit a newly added enum value to be consumed in the
 * same transaction. Keep this migration deliberately limited to the enum
 * addition so the durable legacy event boundary can use it in the next
 * migration.
 */
ALTER TYPE public.gateway_event_application_effect
  ADD VALUE IF NOT EXISTS 'legacy_applied';

COMMIT;

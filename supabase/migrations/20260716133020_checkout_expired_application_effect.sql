/*
 * PostgreSQL requires a newly added enum value to commit before a later
 * migration can reference it in constraints, functions, or stored rows.
 * Keep this migration deliberately limited to the enum extension.
 */
ALTER TYPE public.gateway_event_application_effect
  ADD VALUE IF NOT EXISTS 'checkout_expired' AFTER 'payment_failed';

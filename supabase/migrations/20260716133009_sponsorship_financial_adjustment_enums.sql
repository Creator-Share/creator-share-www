ALTER TYPE public.sponsorship_financial_entry_kind
  ADD VALUE IF NOT EXISTS 'sponsorship_refund';

ALTER TYPE public.sponsorship_financial_entry_kind
  ADD VALUE IF NOT EXISTS 'sponsorship_reversal';

ALTER TYPE public.sponsorship_financial_entry_kind
  ADD VALUE IF NOT EXISTS 'sponsorship_dispute_debit';

ALTER TYPE public.sponsorship_financial_entry_kind
  ADD VALUE IF NOT EXISTS 'sponsorship_dispute_credit';

ALTER TYPE public.gateway_event_application_effect
  ADD VALUE IF NOT EXISTS 'refund_applied';

ALTER TYPE public.gateway_event_application_effect
  ADD VALUE IF NOT EXISTS 'reversal_applied';

ALTER TYPE public.gateway_event_application_effect
  ADD VALUE IF NOT EXISTS 'dispute_debit_applied';

ALTER TYPE public.gateway_event_application_effect
  ADD VALUE IF NOT EXISTS 'dispute_credit_applied';

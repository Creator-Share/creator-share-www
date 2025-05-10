-- Add missing columns to transaction_ledger
ALTER TABLE "public"."transaction_ledger"
ADD COLUMN "sponsorship_type" text,
ADD COLUMN "stripe_payment_intent_id" text,
ADD COLUMN "stripe_payment_method_id" text,
ADD COLUMN "payment_method_type" text;

-- Add missing columns to subscriptions
ALTER TABLE "public"."subscriptions"
ADD COLUMN "stripe_price_id" text,
ADD COLUMN "sponsorship_type" text;

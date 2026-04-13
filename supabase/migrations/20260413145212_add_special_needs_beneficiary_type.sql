-- Add SPECIAL_NEEDS to the beneficiary_types enum.
--
-- SPECIAL_NEEDS has existed in the UI and admin code since at least late 2025
-- but was never added to the tracked DB enum. Any query filtering by
-- beneficiary_type = 'SPECIAL_NEEDS' was failing locally with:
--   "invalid input value for enum beneficiary_types: SPECIAL_NEEDS"
-- Production had the value added directly without a migration.
-- This migration closes that gap.

ALTER TYPE "public"."beneficiary_types" ADD VALUE IF NOT EXISTS 'SPECIAL_NEEDS';

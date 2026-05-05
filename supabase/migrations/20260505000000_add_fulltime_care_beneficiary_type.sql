-- Add FULLTIME_CARE to the beneficiary_types enum.
--
-- FULLTIME_CARE is an open sponsorship type like SPECIAL_NEEDS:
-- multiple sponsors, user-chosen amount, budget_goal = -1.

ALTER TYPE "public"."beneficiary_types" ADD VALUE IF NOT EXISTS 'FULLTIME_CARE';

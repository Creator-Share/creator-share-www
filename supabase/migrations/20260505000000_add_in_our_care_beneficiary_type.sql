-- Add IN_OUR_CARE to the beneficiary_types enum.
--
-- IN_OUR_CARE ("Fulltime Care" in the UI) is an open sponsorship type
-- like SPECIAL_NEEDS: multiple sponsors, user-chosen amount, budget_goal = -1.

ALTER TYPE "public"."beneficiary_types" ADD VALUE IF NOT EXISTS 'IN_OUR_CARE';

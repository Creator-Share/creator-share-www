-- ============================================================================
-- Migration: Backfill budget_goal = -1 for existing open sponsorship records
-- Date: 2026-04-14
-- Purpose:
--   The open sponsorship model (introduced in 20260414001000) uses budget_goal
--   = -1 as the sentinel for "infinite / no fixed goal." New beneficiaries of
--   open types (e.g. SPECIAL_NEEDS) are written with budget_goal = -1 at
--   create time, but existing records may still carry their old values (0 or a
--   dollar amount from the former per-type env-var default).
--
--   This migration brings those records in line so that isOpenSponsorshipType()
--   on the frontend and all API .or() filter conditions that key on
--   budget_goal = -1 behave consistently for pre-existing beneficiaries.
--
--   Safe to run multiple times — the WHERE clause is idempotent.
-- ============================================================================

UPDATE beneficiaries
SET budget_goal = -1
WHERE beneficiary_type = 'SPECIAL_NEEDS'
  AND budget_goal IS DISTINCT FROM -1;

-- Add "Sponsorship Cancelled" status to PersonStatus enum
ALTER TYPE "public"."PersonStatus" ADD VALUE IF NOT EXISTS 'Sponsorship Cancelled';


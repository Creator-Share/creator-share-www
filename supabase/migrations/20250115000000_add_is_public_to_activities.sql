-- Add is_public column to activities table
-- This determines whether an activity is visible on the public beneficiary profile page
ALTER TABLE "public"."activities" 
ADD COLUMN IF NOT EXISTS "is_public" boolean DEFAULT false;

-- Add comment to explain the column
COMMENT ON COLUMN "public"."activities"."is_public" IS 'Determines if the activity is visible on the public beneficiary profile page. When false, the activity is only visible to admins.';

-- Create index for filtering public activities
CREATE INDEX IF NOT EXISTS idx_activities_is_public ON public.activities(is_public) WHERE is_public = true;


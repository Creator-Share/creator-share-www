-- Add is_public column to activities table
ALTER TABLE activities
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- Add comment to document the column purpose
COMMENT ON COLUMN activities.is_public IS 'Whether this activity should be publicly visible on the beneficiary profile page';

-- Create index for filtering public activities
CREATE INDEX IF NOT EXISTS idx_activities_is_public ON activities(is_public);

-- Update existing activities to be private by default
UPDATE activities
SET is_public = false
WHERE is_public IS NULL;

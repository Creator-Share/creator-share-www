-- Create admin_notifications table for in-app alerts
CREATE TABLE IF NOT EXISTS admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying unread notifications efficiently
CREATE INDEX IF NOT EXISTS idx_admin_notifications_read_created
  ON admin_notifications (read, created_at DESC);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_admin_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_notifications_updated_at
  BEFORE UPDATE ON admin_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_admin_notifications_updated_at();

-- Enable RLS and allow service role / SUPER_ADMIN access
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for backend inserts)
CREATE POLICY service_role_all ON admin_notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated SUPER_ADMIN users to read and update notifications
CREATE POLICY super_admin_select ON admin_notifications
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM role_assignments ra
      JOIN roles ON roles.id = ra.role_id
      WHERE ra.user_id = auth.uid()
        AND roles.name = 'SUPER_ADMIN'
    )
  );

CREATE POLICY super_admin_update ON admin_notifications
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM role_assignments ra
      JOIN roles ON roles.id = ra.role_id
      WHERE ra.user_id = auth.uid()
        AND roles.name = 'SUPER_ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM role_assignments ra
      JOIN roles ON roles.id = ra.role_id
      WHERE ra.user_id = auth.uid()
        AND roles.name = 'SUPER_ADMIN'
    )
  );

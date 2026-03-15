-- ============================================================================
-- Restore: Make email column required (NOT NULL) in users table
-- ============================================================================
-- Run this in Supabase SQL Editor if you previously made email nullable
-- This ensures email is required for all users
-- ============================================================================

-- Make email NOT NULL
ALTER TABLE users ALTER COLUMN email SET NOT NULL;

-- Ensure unique constraint on email exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'users' 
    AND constraint_name = 'users_email_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;

-- Remove partial unique index if it exists (we use the constraint instead)
DROP INDEX IF EXISTS idx_users_email_unique;

-- Verify the change
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name = 'email';


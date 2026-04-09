-- Add soft-delete flag to settings (company records)
-- Deleted companies are blocked from login and hidden from Command Central company list.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS deleted boolean DEFAULT false;

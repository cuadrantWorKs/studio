-- =============================================
-- raw_locations Table Migration for TransistorSoft
-- =============================================
-- Run this in your Supabase SQL Editor

-- Step 1: Add new columns for TransistorSoft metadata
ALTER TABLE raw_locations
  ADD COLUMN IF NOT EXISTS event VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_moving BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS odometer DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS activity_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS battery_is_charging BOOLEAN DEFAULT false;

-- Step 2: Fix the timestamp column type
-- The current column is likely `bigint` or incorrect type
-- We need to change it to `timestamptz` to accept ISO strings

-- First, create a temporary column
ALTER TABLE raw_locations ADD COLUMN timestamp_new TIMESTAMPTZ;

-- Migrate existing data (if any numeric timestamps exist)
-- This converts epoch ms to proper timestamp
UPDATE raw_locations 
SET timestamp_new = to_timestamp(timestamp::bigint / 1000)
WHERE timestamp IS NOT NULL;

-- Drop old column and rename new one
ALTER TABLE raw_locations DROP COLUMN timestamp;
ALTER TABLE raw_locations RENAME COLUMN timestamp_new TO timestamp;

-- Make timestamp NOT NULL after migration
ALTER TABLE raw_locations ALTER COLUMN timestamp SET NOT NULL;

-- Step 3: Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_raw_locations_device_timestamp 
  ON raw_locations(device_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_raw_locations_event 
  ON raw_locations(event);

-- =============================================
-- Alternative: If starting fresh (drop and recreate)
-- =============================================
/*
DROP TABLE IF EXISTS raw_locations;

CREATE TABLE raw_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  accuracy DOUBLE PRECISION,
  altitude DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  bearing DOUBLE PRECISION,
  battery DOUBLE PRECISION,
  battery_is_charging BOOLEAN DEFAULT false,
  event VARCHAR(50),
  is_moving BOOLEAN DEFAULT false,
  odometer DOUBLE PRECISION,
  activity_type VARCHAR(50),
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_raw_locations_device_timestamp ON raw_locations(device_id, timestamp DESC);
CREATE INDEX idx_raw_locations_event ON raw_locations(event);
*/

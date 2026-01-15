-- =============================================
-- raw_locations Table - CREATE FROM SCRATCH
-- =============================================
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS raw_locations (
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

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_raw_locations_device_timestamp 
  ON raw_locations(device_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_raw_locations_event 
  ON raw_locations(event);

CREATE INDEX IF NOT EXISTS idx_raw_locations_processed 
  ON raw_locations(processed) WHERE processed = false;

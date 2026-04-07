-- =============================================
-- venuu Events Table — Database Migration
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  city text NOT NULL,
  title text NOT NULL,
  description text,
  event_type text NOT NULL CHECK (event_type IN ('party', 'brand', 'greek', 'launch', 'special')),
  host_name text NOT NULL,
  start_time timestamptz NOT NULL,
  latitude float8 NOT NULL,
  longitude float8 NOT NULL,
  image_url text,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  expires_at timestamptz NOT NULL,
  CONSTRAINT expires_after_start CHECK (expires_at > start_time)
);

CREATE INDEX idx_events_city ON events (city);
CREATE INDEX idx_events_venue ON events (venue_id);
CREATE INDEX idx_events_active ON events (is_active, expires_at);
CREATE INDEX idx_events_start_time ON events (start_time);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Anyone can read active, non-expired events
CREATE POLICY "Anyone can read active events"
  ON events FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND expires_at > now());

-- Authenticated users and service_role can insert
CREATE POLICY "Authenticated users can create events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can create events"
  ON events FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Creator or service_role can update
CREATE POLICY "Creator can update own events"
  ON events FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid()::text)
  WITH CHECK (created_by = auth.uid()::text);

CREATE POLICY "Service role can update events"
  ON events FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Only service_role can delete
CREATE POLICY "Service role can delete events"
  ON events FOR DELETE
  TO service_role
  USING (true);

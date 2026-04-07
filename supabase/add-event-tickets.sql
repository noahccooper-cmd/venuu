-- =============================================
-- Event Tickets — Database Migration
-- Run this in Supabase SQL Editor
-- =============================================

-- Add ticket + end_time columns to events table
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS has_tickets boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_price integer,        -- cents
  ADD COLUMN IF NOT EXISTS total_tickets integer,
  ADD COLUMN IF NOT EXISTS tickets_sold integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz;

-- Event tickets table
CREATE TABLE IF NOT EXISTS event_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  price_paid integer NOT NULL,          -- cents
  platform_fee integer NOT NULL DEFAULT 0,
  stripe_payment_intent_id text,
  qr_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'used', 'refunded')),
  purchased_at timestamptz DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_event_tickets_event  ON event_tickets (event_id);
CREATE INDEX IF NOT EXISTS idx_event_tickets_user   ON event_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_event_tickets_qr     ON event_tickets (qr_code);
CREATE INDEX IF NOT EXISTS idx_event_tickets_venue  ON event_tickets (venue_id);

ALTER TABLE event_tickets ENABLE ROW LEVEL SECURITY;

-- Users read their own tickets
CREATE POLICY "Users can read own event tickets"
  ON event_tickets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users insert their own tickets (finalize function uses service role, but guard anyway)
CREATE POLICY "Users can insert own event tickets"
  ON event_tickets FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Service role full access (edge functions run as service role)
CREATE POLICY "Service role full access on event_tickets"
  ON event_tickets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anon read for scanner (bouncer portal uses anon key via edge function)
-- Scanner validation goes through edge function which uses service role key

-- Allow events.tickets_sold to be updated by service role (already covered by
-- "Service role can update events" policy from create-events-table.sql migration)

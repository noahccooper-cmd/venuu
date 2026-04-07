-- =============================================
-- venuu Loyalty Launch Readiness — Run in Supabase SQL Editor
-- Adds missing columns, fixes RLS for all loyalty tables
-- =============================================

-- 1. venues: add nfc_required column (GPS fallback when false)
ALTER TABLE venues ADD COLUMN IF NOT EXISTS nfc_required boolean DEFAULT false;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS loyalty_active boolean DEFAULT false;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS nfc_tag_id text;

-- 2. venue_rewards: add reward_description if missing
ALTER TABLE venue_rewards ADD COLUMN IF NOT EXISTS reward_description text;

-- 3. loyalty_redemptions: create if not exists
CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  redeemed_at timestamptz DEFAULT now(),
  verified_by_staff boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_user ON loyalty_redemptions (user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_venue ON loyalty_redemptions (venue_id);

-- 4. Enable RLS on all loyalty tables
ALTER TABLE loyalty_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_redemptions ENABLE ROW LEVEL SECURITY;

-- 5. loyalty_visits RLS
DROP POLICY IF EXISTS "Users can read own visits" ON loyalty_visits;
CREATE POLICY "Users can read own visits" ON loyalty_visits FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Anon can read visits for counting" ON loyalty_visits;
CREATE POLICY "Anon can read visits for counting" ON loyalty_visits FOR SELECT
  TO anon USING (true);

DROP POLICY IF EXISTS "Users can insert own visits" ON loyalty_visits;
CREATE POLICY "Users can insert own visits" ON loyalty_visits FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

-- 6. venue_rewards RLS (anyone can read, anon can upsert for portal)
DROP POLICY IF EXISTS "Anyone can read rewards" ON venue_rewards;
CREATE POLICY "Anyone can read rewards" ON venue_rewards FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert rewards" ON venue_rewards;
CREATE POLICY "Anyone can insert rewards" ON venue_rewards FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update rewards" ON venue_rewards;
CREATE POLICY "Anyone can update rewards" ON venue_rewards FOR UPDATE USING (true) WITH CHECK (true);

-- 7. loyalty_redemptions RLS
DROP POLICY IF EXISTS "Users can read own redemptions" ON loyalty_redemptions;
CREATE POLICY "Users can read own redemptions" ON loyalty_redemptions FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Anon can read redemptions" ON loyalty_redemptions;
CREATE POLICY "Anon can read redemptions" ON loyalty_redemptions FOR SELECT
  TO anon USING (true);

DROP POLICY IF EXISTS "Users can insert own redemptions" ON loyalty_redemptions;
CREATE POLICY "Users can insert own redemptions" ON loyalty_redemptions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own redemptions" ON loyalty_redemptions;
CREATE POLICY "Users can update own redemptions" ON loyalty_redemptions FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_venues_loyalty ON venues (loyalty_active) WHERE loyalty_active = true;
CREATE INDEX IF NOT EXISTS idx_venues_nfc_tag ON venues (nfc_tag_id) WHERE nfc_tag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_visits_user_venue ON loyalty_visits (user_id, venue_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_visits_night ON loyalty_visits (venue_id, night_of);

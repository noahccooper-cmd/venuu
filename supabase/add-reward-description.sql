-- Add reward_description column to venue_rewards
-- Allows bouncers to add restrictions/details like "Valid Sun-Thu only"
ALTER TABLE venue_rewards ADD COLUMN IF NOT EXISTS reward_description text;

-- Fix RLS for portal access (PIN-based auth uses anon key)
DROP POLICY IF EXISTS "Anyone can read rewards" ON venue_rewards;
CREATE POLICY "Anyone can read rewards" ON venue_rewards FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can insert rewards" ON venue_rewards;
CREATE POLICY "Anyone can insert rewards" ON venue_rewards FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update rewards" ON venue_rewards;
CREATE POLICY "Anyone can update rewards" ON venue_rewards FOR UPDATE USING (true) WITH CHECK (true);

-- =============================================
-- venuu Loyalty Punch Card — Database Schema
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. nightly_codes — deterministic codes stored for audit/verification
CREATE TABLE IF NOT EXISTS nightly_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code varchar(4) NOT NULL,
  night_of date NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(venue_id, night_of)
);

CREATE INDEX idx_nightly_codes_venue_night ON nightly_codes (venue_id, night_of);

-- 2. loyalty_visits — one check-in per user per venue per night
CREATE TABLE IF NOT EXISTS loyalty_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code_entered varchar(4) NOT NULL,
  verified_at timestamptz DEFAULT now(),
  night_of date NOT NULL,
  UNIQUE(user_id, venue_id, night_of)
);

CREATE INDEX idx_loyalty_visits_user_venue ON loyalty_visits (user_id, venue_id);

-- 3. venue_rewards — what each venue offers for loyalty
CREATE TABLE IF NOT EXISTS venue_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  reward_text text NOT NULL,
  visits_required integer DEFAULT 5,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(venue_id)
);

-- 4. loyalty_redemptions — when a user cashes in a reward
CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  redeemed_at timestamptz DEFAULT now(),
  verified_by_staff boolean DEFAULT false
);

-- =============================================
-- Row Level Security (RLS)
-- =============================================

-- nightly_codes: authenticated can SELECT (for code verification), only service_role can INSERT/UPDATE
ALTER TABLE nightly_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read nightly codes"
  ON nightly_codes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert nightly codes"
  ON nightly_codes FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update nightly codes"
  ON nightly_codes FOR UPDATE
  TO service_role
  USING (true);

-- loyalty_visits: users can SELECT/INSERT their own visits
ALTER TABLE loyalty_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own visits"
  ON loyalty_visits FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own visits"
  ON loyalty_visits FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- venue_rewards: public read
ALTER TABLE venue_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read venue rewards"
  ON venue_rewards FOR SELECT
  TO authenticated
  USING (true);

-- loyalty_redemptions: users can SELECT/INSERT their own
ALTER TABLE loyalty_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own redemptions"
  ON loyalty_redemptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own redemptions"
  ON loyalty_redemptions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

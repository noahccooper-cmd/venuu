-- =============================================
-- venuu Dynamic Cover Pricing System — Database Schema
-- Run this in Supabase SQL Editor
-- =============================================

-- TABLE 1: cover_configs — Bar's pricing settings (one per venue per night)
CREATE TABLE IF NOT EXISTS cover_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  night_of date NOT NULL,
  base_price integer NOT NULL,
  cap_price integer NOT NULL,
  capacity integer NOT NULL,
  open_time timestamptz NOT NULL,
  close_time timestamptz NOT NULL,
  current_price integer NOT NULL,
  covers_sold integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(venue_id, night_of),
  CHECK (cap_price > base_price),
  CHECK (capacity > 0),
  CHECK (close_time > open_time)
);

CREATE INDEX IF NOT EXISTS idx_cover_configs_venue_night ON cover_configs (venue_id, night_of);
CREATE INDEX IF NOT EXISTS idx_cover_configs_active ON cover_configs (is_active, night_of);

-- TABLE 2: cover_purchases — Every individual purchase
CREATE TABLE IF NOT EXISTS cover_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cover_config_id uuid NOT NULL REFERENCES cover_configs(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_paid integer NOT NULL,
  platform_fee integer NOT NULL,
  venue_payout integer NOT NULL,
  stripe_payment_intent_id text NOT NULL,
  stripe_transfer_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'used')),
  qr_code text NOT NULL,
  purchased_at timestamptz DEFAULT now(),
  used_at timestamptz,
  UNIQUE(user_id, cover_config_id)
);

CREATE INDEX IF NOT EXISTS idx_cover_purchases_user ON cover_purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_cover_purchases_config ON cover_purchases (cover_config_id);
CREATE INDEX IF NOT EXISTS idx_cover_purchases_venue ON cover_purchases (venue_id);
CREATE INDEX IF NOT EXISTS idx_cover_purchases_qr ON cover_purchases (qr_code);
CREATE INDEX IF NOT EXISTS idx_cover_purchases_status ON cover_purchases (status);

-- TABLE 3: cover_price_history — Price tick log for charts
CREATE TABLE IF NOT EXISTS cover_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cover_config_id uuid NOT NULL REFERENCES cover_configs(id) ON DELETE CASCADE,
  price integer NOT NULL,
  covers_sold_at_tick integer NOT NULL,
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cover_price_history_config_time ON cover_price_history (cover_config_id, recorded_at);

-- TABLE 4: venue_stripe_accounts — Connected Stripe accounts for bars
CREATE TABLE IF NOT EXISTS venue_stripe_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE UNIQUE,
  stripe_account_id text NOT NULL,
  is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_stripe_venue ON venue_stripe_accounts (venue_id);

-- ── RLS Policies ──

ALTER TABLE cover_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cover_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cover_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_stripe_accounts ENABLE ROW LEVEL SECURITY;

-- cover_configs: anyone can read active configs. Anon can insert/update (portal).
CREATE POLICY "Anyone can read cover configs" ON cover_configs FOR SELECT USING (true);
CREATE POLICY "Anyone can insert cover configs" ON cover_configs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update cover configs" ON cover_configs FOR UPDATE USING (true) WITH CHECK (true);

-- cover_purchases: authenticated can insert. Users read own. Anon can update status (portal scan).
CREATE POLICY "Authenticated users can buy covers" ON cover_purchases FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can read own purchases" ON cover_purchases FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Anon can read purchases for scanning" ON cover_purchases FOR SELECT
  TO anon USING (true);
CREATE POLICY "Anon can update purchase status" ON cover_purchases FOR UPDATE
  TO anon USING (true) WITH CHECK (true);

-- cover_price_history: anyone can read
CREATE POLICY "Anyone can read price history" ON cover_price_history FOR SELECT USING (true);
CREATE POLICY "Anyone can insert price history" ON cover_price_history FOR INSERT WITH CHECK (true);

-- venue_stripe_accounts: anon can read/insert/update (portal setup)
CREATE POLICY "Anyone can read stripe accounts" ON venue_stripe_accounts FOR SELECT USING (true);
CREATE POLICY "Anyone can insert stripe accounts" ON venue_stripe_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update stripe accounts" ON venue_stripe_accounts FOR UPDATE USING (true) WITH CHECK (true);

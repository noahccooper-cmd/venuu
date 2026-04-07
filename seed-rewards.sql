-- Seed venue_rewards for Knoxville venues
-- Run in Supabase SQL Editor

INSERT INTO venue_rewards (venue_id, reward_text, visits_required)
SELECT id, 'Free beer', 5 FROM venues WHERE name ILIKE '%Cool Beans%' AND city ILIKE '%Knoxville%'
ON CONFLICT (venue_id) DO NOTHING;

INSERT INTO venue_rewards (venue_id, reward_text, visits_required)
SELECT id, 'Free beer', 5 FROM venues WHERE name ILIKE '%Half Barrel%' AND city ILIKE '%Knoxville%'
ON CONFLICT (venue_id) DO NOTHING;

INSERT INTO venue_rewards (venue_id, reward_text, visits_required)
SELECT id, 'Free beer', 5 FROM venues WHERE name ILIKE '%Yacht Club%' AND city ILIKE '%Knoxville%'
ON CONFLICT (venue_id) DO NOTHING;

INSERT INTO venue_rewards (venue_id, reward_text, visits_required)
SELECT id, 'Free beer', 5 FROM venues WHERE name ILIKE '%Mares%' AND city ILIKE '%Knoxville%'
ON CONFLICT (venue_id) DO NOTHING;

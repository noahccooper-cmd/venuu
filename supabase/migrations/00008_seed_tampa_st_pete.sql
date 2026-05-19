-- ═══════════════════════════════════════════════════════════════
-- 00008_seed_tampa_st_pete.sql
-- Seed Tampa + St. Pete venues. M. Bird featured.
-- Idempotent on slug. Capacity NULL — backfill manually.
-- ═══════════════════════════════════════════════════════════════

-- Tampa venues (city slug: 'tampa')
INSERT INTO public.venues (
  name, slug, city, category, address, lat, lng,
  is_active, sort_order, featured, loyalty_active, nfc_required
) VALUES
  ('Lower Deck',       'lower-deck-tampa',       'tampa', 'bar',     '900 Channelside Dr, Tampa, FL 33602',         27.9425, -82.4493, true,  10, false, false, false),
  ('American Social',  'american-social-tampa',  'tampa', 'bar',     '601 S Harbour Island Blvd, Tampa, FL 33602',  27.9395, -82.4527, true,  20, false, false, false),
  ('M. Bird',          'm-bird-tampa',           'tampa', 'cocktail','1320 E 9th Ave, Tampa, FL 33605',             27.9614, -82.4376, true,  1,  true,  false, false),
  ('Echo',             'echo-tampa',             'tampa', 'club',    '1701 E 7th Ave, Tampa, FL 33605',             27.9606, -82.4360, true,  30, false, false, false),
  ('Delta',            'delta-tampa',            'tampa', 'club',    '1701 E 7th Ave, Tampa, FL 33605',             27.9605, -82.4359, true,  31, false, false, false),
  ('511',              '511-tampa',              'tampa', 'lounge',  '511 W Kennedy Blvd, Tampa, FL 33606',         27.9461, -82.4641, true,  40, false, false, false),
  ('Boulon',           'boulon-tampa',           'tampa', 'bar',     '535 N Tampa St, Tampa, FL 33602',             27.9485, -82.4583, true,  50, false, false, false),
  ('Waterstreet',      'waterstreet-tampa',      'tampa', 'bar',     '1001 Water St, Tampa, FL 33602',              27.9418, -82.4502, true,  60, false, false, false),
  ('MacDinton''s',     'macdintons-tampa',       'tampa', 'bar',     '405 S Howard Ave, Tampa, FL 33606',           27.9402, -82.4775, true,  70, false, false, false),
  ('The Saloon',       'the-saloon-tampa',       'tampa', 'bar',     '321 S Howard Ave, Tampa, FL 33606',           27.9407, -82.4773, true,  80, false, false, false),
  ('The Grove',        'the-grove-tampa',        'tampa', 'bar',     '720 S Howard Ave, Tampa, FL 33606',           27.9354, -82.4779, true,  90, false, false, false),
  ('Sunset Rodeo',     'sunset-rodeo-tampa',     'tampa', 'bar',     '901 W Cleveland St, Tampa, FL 33606',         27.9456, -82.4729, true,  100, false, false, false),
  ('Corner Bar',       'corner-bar-tampa',       'tampa', 'bar',     '821 S Howard Ave, Tampa, FL 33606',           27.9344, -82.4782, true,  110, false, false, false),
  ('Meat Market',      'meat-market-tampa',      'tampa', 'lounge',  '1601 W Snow Ave, Tampa, FL 33606',            27.9265, -82.4823, true,  120, false, false, false),
  ('Red Dog',          'red-dog-tampa',          'tampa', 'dive',    '111 S Macdill Ave, Tampa, FL 33609',          27.9423, -82.5044, true,  130, false, false, false),
  ('The Blind Goat',   'the-blind-goat-tampa',   'tampa', 'dive',    '4307 N Florida Ave, Tampa, FL 33603',         27.9806, -82.4607, true,  140, false, false, false),
  ('The Patio',        'the-patio-tampa',        'tampa', 'bar',     '1601 W Snow Ave, Tampa, FL 33606',            27.9264, -82.4824, true,  150, false, false, false)
ON CONFLICT (slug) DO NOTHING;

-- St. Pete venues (city slug: 'st_petersburg')
INSERT INTO public.venues (
  name, slug, city, category, address, lat, lng,
  is_active, sort_order, featured, loyalty_active, nfc_required
) VALUES
  ('Copper Shaker',         'copper-shaker-stpete',         'st_petersburg', 'cocktail','255 Central Ave, St. Petersburg, FL 33701',          27.7707, -82.6388, true,  10, false, false, false),
  ('Birchwood Canopy',      'birchwood-canopy-stpete',      'st_petersburg', 'cocktail','340 Beach Dr NE, St. Petersburg, FL 33701',          27.7726, -82.6328, true,  20, false, false, false),
  ('Saigon Blonde',         'saigon-blonde-stpete',         'st_petersburg', 'lounge',  '243 Central Ave, St. Petersburg, FL 33701',          27.7708, -82.6391, true,  30, false, false, false),
  ('5 Bucks',               '5-bucks-stpete',               'st_petersburg', 'dive',    '170 Central Ave, St. Petersburg, FL 33701',          27.7711, -82.6402, true,  40, false, false, false),
  ('Mandarin Hide',         'mandarin-hide-stpete',         'st_petersburg', 'cocktail','231 Central Ave, St. Petersburg, FL 33701',          27.7708, -82.6394, true,  50, false, false, false),
  ('Welcome to the Farm',   'welcome-to-the-farm-stpete',   'st_petersburg', 'bar',     '900 Central Ave, St. Petersburg, FL 33705',          27.7714, -82.6486, true,  60, false, false, false),
  ('Pier Teaki',            'pier-teaki-stpete',            'st_petersburg', 'bar',     '600 2nd Ave NE, St. Petersburg, FL 33701',           27.7740, -82.6307, true,  70, false, false, false),
  ('Pour Judgement',        'pour-judgement-stpete',        'st_petersburg', 'bar',     '224 Central Ave, St. Petersburg, FL 33701',          27.7712, -82.6395, true,  80, false, false, false),
  ('Crafty Squirrel',       'crafty-squirrel-stpete',       'st_petersburg', 'bar',     '548 Central Ave, St. Petersburg, FL 33701',          27.7711, -82.6440, true,  90, false, false, false),
  ('Jannus Live',           'jannus-live-stpete',           'st_petersburg', 'venue',   '200 1st Ave N, St. Petersburg, FL 33701',            27.7727, -82.6398, true,  100, false, false, false),
  ('One Night Stand',       'one-night-stand-stpete',       'st_petersburg', 'bar',     '672 Central Ave, St. Petersburg, FL 33701',          27.7712, -82.6457, true,  110, false, false, false),
  ('My Rich Uncle',         'my-rich-uncle-stpete',         'st_petersburg', 'cocktail','653 Central Ave, St. Petersburg, FL 33701',          27.7712, -82.6453, true,  120, false, false, false),
  ('Mary Margaret''s Pub',  'mary-margarets-pub-stpete',    'st_petersburg', 'bar',     '655 Central Ave, St. Petersburg, FL 33701',          27.7712, -82.6454, true,  130, false, false, false),
  ('Tryst',                 'tryst-stpete',                 'st_petersburg', 'lounge',  '240 Beach Dr NE, St. Petersburg, FL 33701',          27.7715, -82.6334, true,  140, false, false, false),
  ('Oak and Stone',         'oak-and-stone-stpete',         'st_petersburg', 'bar',     '7253 4th St N, St. Petersburg, FL 33702',            27.8410, -82.6378, true,  150, false, false, false),
  ('Dead Bob''s',           'dead-bobs-stpete',             'st_petersburg', 'bar',     '4040 4th St N, St. Petersburg, FL 33703',            27.8067, -82.6399, true,  160, false, false, false)
ON CONFLICT (slug) DO NOTHING;

-- Seed venue_baselines for newly inserted venues
INSERT INTO public.venue_baselines (venue_id)
SELECT v.id FROM public.venues v
WHERE v.city IN ('tampa', 'st_petersburg')
ON CONFLICT (venue_id) DO NOTHING;

-- Verify
DO $$
DECLARE
  tampa_count int;
  stpete_count int;
  baseline_count int;
BEGIN
  SELECT COUNT(*) INTO tampa_count FROM public.venues WHERE city = 'tampa';
  SELECT COUNT(*) INTO stpete_count FROM public.venues WHERE city = 'st_petersburg';
  SELECT COUNT(*) INTO baseline_count FROM public.venue_baselines vb
    JOIN public.venues v ON v.id = vb.venue_id
    WHERE v.city IN ('tampa', 'st_petersburg');

  RAISE NOTICE '═══ Migration 00008 complete ═══';
  RAISE NOTICE '  Tampa venues: %', tampa_count;
  RAISE NOTICE '  St. Pete venues: %', stpete_count;
  RAISE NOTICE '  New venue_baselines: %', baseline_count;
END $$;

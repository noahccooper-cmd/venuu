-- ============================================================================
-- venues_apply.sql  —  branch venue-data-reconcile   (generated 2026-06-02)
-- Source of truth: venuu_venues_master.json (44). Live slugs: REST dump of
-- venues WHERE city IN ('tampa','st_petersburg') (65 rows).
-- Crosswalk: 43 UPDATE, 1 INSERT (Predalina), 0 SKIP. Dead Bob's relocated to Tampa.
--
-- RUN ORDER:
--   1) SECTION 0 + 0.5  (read-only): run, export SECTION 0(a) to JSON, eyeball P1-P4.
--   2) SECTION 1-4      (mutations, one BEGIN/COMMIT): run after you're satisfied.
--   3) SECTION 6        (verify): run, confirm the read-backs.
-- Every statement targets an explicit slug. No blanket UPDATE/DELETE.
-- ============================================================================

-- ===== SECTION 0: BACKUP (run first; export results to JSON) =====
SELECT * FROM venues ORDER BY slug;

-- ===== SECTION 0.5: PRE-FLIGHT SELECT-FIRST PREVIEWS (read-only) =====
-- (P1) Removals — confirm exactly these two rows before DELETE.
SELECT slug, name, city, address, is_active FROM venues
WHERE slug IN ('waterstreet-tampa','the-saloon-tampa');

-- (P2) Corner Bar — KEEP/UPDATE corner-bar-soho-tampa (402 S Howard); DELETE corner-bar-tampa (821).
SELECT slug, name, city, address, lat, lng FROM venues
WHERE slug IN ('corner-bar-soho-tampa','corner-bar-tampa') ORDER BY slug;

-- (P3) Grove — TWO rows exist: grove-soho-tampa (406 S Howard = JSON, KEEP/UPDATE) vs
--      the-grove-tampa (720 S Howard, dedupe candidate). Confirm before uncommenting its DELETE.
SELECT slug, name, city, address, lat, lng FROM venues
WHERE city='tampa' AND (name ILIKE '%grove%' OR slug ILIKE '%grove%') ORDER BY slug;

-- (P4) Five Bucks — touch ONLY the canonical; leave the inactive one alone.
SELECT slug, name, city, is_active FROM venues
WHERE slug IN ('5-bucks-stpete','five-bucks-drinkery-st-pete') ORDER BY slug;

-- ============================================================================
-- MUTATIONS  (SECTIONS 1-4)  —  one transaction
-- ============================================================================
BEGIN;

-- ===== SECTION 1: UPSERT (43 UPDATEs keyed on real live slug + 1 INSERT) =====
UPDATE venues SET lat=27.93795, lng=-82.4552, description='Laid-back dockside waterfront bar at the marina level of Harbour Island with panoramic Tampa skyline views, raw oysters, craft cocktails, and live music; the casual coastal escape just below American Social.', address='601 S Harbour Island Blvd Ste 110, Tampa, FL 33602'
  WHERE slug='lower-deck-tampa';
UPDATE venues SET lat=27.9384058, lng=-82.454863, description='Spacious waterfront bar-and-kitchen on Harbour Island with Tampa skyline views, indoor/outdoor bars, Taco Tuesday, and weekend nightlife energy; lively, stylish, busy, loud, and fun.', address='601 S Harbour Island Blvd #107, Tampa, FL 33602'
  WHERE slug='american-social-tampa';
UPDATE venues SET lat=27.9437675, lng=-82.4500198, description='Bright all-day French brasserie and bakery in Water Street serving beef tartare, lobster bisque, and burlesque martinis; lively, attentive, and stylish, a special-occasion spot.', address='1001 Water St, Tampa, FL 33602'
  WHERE slug='boulon-tampa';
UPDATE venues SET lat=27.9490216, lng=-82.4582075, description='Upscale-casual downtown craft cocktail bar with a strong bourbon selection, well-made old fashioneds, happy-hour specials, and DJ nights; classy yet welcoming, drawing a 23+ after-dark professional crowd.', address='513 N Franklin St, Tampa, FL 33602'
  WHERE slug='511-tampa';
UPDATE venues SET lat=27.9518696, lng=-82.460074, description='Downtown Franklin St late-night dance club spinning R&B and Latin on weekends only with cover charges; energetic crowd and music.', address='914 N Franklin St, Tampa, FL 33602'
  WHERE slug='echo-tampa';
UPDATE venues SET lat=27.9517715, lng=-82.4600305, description='Multi-floor downtown nightclub running three zones of music, EDM/house outdoors, hip-hop on the first floor, Spanish upstairs, open Friday and Saturday nights with cover charges; vibrant and danceable.', address='912 N Franklin St, Tampa, FL 33602'
  WHERE slug='delta-tampa';
UPDATE venues SET lat=27.96099, lng=-82.4642862, description='Rooftop American restaurant and bar atop Armature Works with sweeping Tampa Bay views, friendly attentive staff, a DJ-driven night scene, and solid food; a lively special-occasion and celebration spot, busy on weekends.', address='1903 Market St, Tampa, FL 33602'
  WHERE slug='m-bird-tampa';
UPDATE venues SET lat=27.9609343, lng=-82.4642724, description='Historic 1910 streetcar warehouse turned Tampa Heights food hall and riverside entertainment destination, family-friendly by day and a nightlife hub by night, with M.Bird on the roof.', address='1910 N Ola Ave, Tampa, FL 33602'
  WHERE slug='armature-works-tampa';
UPDATE venues SET lat=27.9416843, lng=-82.4827188, description='Nashville-inspired SoHo live-music bar with weekly country and Southern-rock acts, standout decor, an outdoor patio, brunch, VIP tables, and a 23+ policy; high-energy with Nashville hot chicken and smash burgers.', address='302 S Howard Ave, Tampa, FL 33606'
  WHERE slug='sunset-rodeo-tampa';
UPDATE venues SET lat=27.9405769, lng=-82.4827815, description='SoHo bar with DJs, live reggae, well-made bar drinks, and excellent outdoor service; clean, entertaining, and friendly.', address='406 S Howard Ave, Tampa, FL 33606'
  WHERE slug='grove-soho-tampa';
UPDATE venues SET lat=27.9405322, lng=-82.4831814, description='SoHo''s biggest Irish pub and nightlife institution with multiple bars, DJs, karaoke, trivia, daily specials, and a sports patio; high-energy college-adjacent crowd.', address='405 S Howard Ave, Tampa, FL 33606'
  WHERE slug='macdintons-tampa';
UPDATE venues SET lat=27.9409084, lng=-82.4828092, description='Chill, dog-friendly SoHo corner bar with weekend DJs, Tuesday karaoke and trivia, cigar-friendly outdoor seating, and Sunday $5 drink specials; great service and reasonable prices in a relaxed neighborhood vibe.', address='402 S Howard Ave, Tampa, FL 33606'
  WHERE slug='corner-bar-soho-tampa';
UPDATE venues SET lat=27.9400902, lng=-82.4935891, description='Easygoing multi-level SoHo patio bar and Bills Backers spot with three bars, a food truck, darts, plenty of TVs, and reasonable prices; chill, electric on game days, with limited parking.', address='421 S MacDill Ave, Tampa, FL 33609'
  WHERE slug='the-patio-tampa';
UPDATE venues SET lat=27.935898, lng=-82.4760815, description='Upscale Hyde Park steakhouse with prime cuts, sushi, lobster mac, and craft cocktails in a trendy, elegant indoor-outdoor setting; a popular special-occasion destination.', address='1606 W Snow Ave, Tampa, FL 33606'
  WHERE slug='meat-market-tampa';
UPDATE venues SET lat=27.9278699, lng=-82.5122459, description='Lively, dog-friendly South Tampa bar-and-grill with elevated bar food, pizzas, wings, the Goat Drip cocktail, dart boards, pool, and weekly trivia and bingo; loud, younger FSU-leaning crowd, owner-run feel.', address='4106 Henderson Blvd, Tampa, FL 33629'
  WHERE slug='the-blind-goat-tampa';
UPDATE venues SET lat=27.919958, lng=-82.4981003, description='Casual neighborhood bar with billiards, darts, cold beer, strong drinks, and good burgers; friendly local vibe and a unique atmosphere.', address='3311 W Bay to Bay Blvd, Tampa, FL 33629'
  WHERE slug='red-dog-tampa';
UPDATE venues SET lat=27.7713413, lng=-82.6363935, description='Busy Central Ave sports bar and grill open 11am-3am daily with sidewalk seating, value-priced food and drinks, famous fries, and fast friendly bartenders; reliable lunch and late-night downtown staple.', address='247 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='five-bucks-drinkery-st-pete';
UPDATE venues SET lat=27.771571, lng=-82.6364159, description='Laid-back outdoor bar tucked behind Five Bucks with cheap $5 cans, a smoky ''illegal margarita,'' wings, fries, and French dips; relaxed street-side seating and music away from the noise.', address='247 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='banana-hammock-st-pete';
UPDATE venues SET lat=27.7760139, lng=-82.6320345, description='Rooftop bar atop the Birchwood with panoramic Old Tampa Bay and downtown views, excellent espresso martinis, and prime sunset timing; elegant and festive.', address='340 Beach Dr NE, St. Petersburg, FL 33701'
  WHERE slug='birchwood-canopy-stpete';
UPDATE venues SET lat=27.7726847, lng=-82.6357233, description='Relaxed rooftop bar atop the AC Marriott with two full bars, Latin-Caribbean tapas, empanadas, yuca fries, peekaboo bay views, and DJ or steel-drum nights; calm hidden-gem ambiance.', address='110 2nd St N, St. Petersburg, FL 33701'
  WHERE slug='cane-barrel-st-pete';
UPDATE venues SET lat=27.7723137, lng=-82.6349515, description='Speakeasy-style craft cocktail bar with a premium whiskey selection, hand-crafted old fashioneds, truffle fries, and Taco Tuesday; bartenders who remember your name, classy and chill, open till 3am nightly.', address='169 1st Ave N, St. Petersburg, FL 33701'
  WHERE slug='copper-shaker-stpete';
UPDATE venues SET lat=27.7713527, lng=-82.6365966, description='Versatile Central Ave spot that''s a cozy sports pub by day and a late-night dance bar by night, with two-for-one happy hours, bottomless mimosas, bottle service, and a flavor-forward new menu.', address='259 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='crafty-squirrel-stpete';
UPDATE venues SET lat=27.7708789, lng=-82.65219, description='Sprawling, nationally top-rated sports bar near Tropicana Field with hundreds of TVs, $5 game-day beers, famous wings, live music, two dog parks, and a tunnel toward the Trop.', address='1320 Central Ave, St. Petersburg, FL 33705'
  WHERE slug='fergs-sports-bar-st-pete';
UPDATE venues SET lat=27.7743792, lng=-82.6326767, description='Polished Beach Drive whiskey-and-champagne lounge with cigars, caviar, an in-house humidor, 25%-off-whiskey Thursdays, live music, and prime waterfront people-watching; one of the best-located bars on the strip.', address='234 Beach Dr NE, St. Petersburg, FL 33701'
  WHERE slug='flute-and-dram-st-pete';
UPDATE venues SET lat=27.7716018, lng=-82.6357291, description='High-energy 1970s disco-themed dance bar with a checkerboard dance floor, retro decor, and a mix of 70s hits and newer beats; reasonably priced, all-ages-of-adult fun, extremely packed after 9pm.', address='16 2nd St N, St. Petersburg, FL 33701'
  WHERE slug='good-night-john-boy-st-pete';
UPDATE venues SET lat=27.7719257, lng=-82.636271, description='Intimate historic open-air courtyard concert venue hosting surprisingly big touring acts with great acoustics, no bad sightlines, a balcony, and multiple bars; minimal seating, standing-room shows.', address='200 1st Ave N Ste 206, St. Petersburg, FL 33701'
  WHERE slug='jannus-live-stpete';
UPDATE venues SET lat=27.7713667, lng=-82.6362014, description='Rustic, dimly lit craft cocktail lounge known for expertly built old fashioneds and the best spicy margarita around, with vintage decor, live music, and $9 weeknight specials; conversational until late, open till 3am.', address='231 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='mandarin-hide-stpete';
UPDATE venues SET lat=27.7718144, lng=-82.6368227, description='Authentic downtown Irish pub with flawless Guinness pours, full Irish breakfast, banger-and-mash, and mustard-slaw sandwiches; lively daily with a sharp bar staff, open till 2-2:30am.', address='29 3rd St N, St. Petersburg, FL 33701'
  WHERE slug='mary-margarets-pub-stpete';
UPDATE venues SET lat=27.7719542, lng=-82.636581, description='Weekend-only high-energy nightclub-style bar open Friday-Saturday 8pm-2:30am with thumping DJ sets, bottle service, and dedicated VIP hosts; cinematic party atmosphere with a dressed-up crowd.', address='260 1st Ave N, St. Petersburg, FL 33701'
  WHERE slug='my-rich-uncle-stpete';
UPDATE venues SET lat=27.7714566, lng=-82.6352435, description='Casual craft-pizza restaurant with a signature self-pour beer wall, tons of taps, gluten-free options, and sports on TV; affordable, relaxed, and walkable to the St. Pete Pier.', address='199 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='oak-and-stone-stpete';
UPDATE venues SET lat=27.7722795, lng=-82.6348431, description='Comfortably worn-in country dive bar centered on a mechanical bull, with country music, a 25% military discount, and a welcoming community spirit; open till 3am.', address='149 1st Ave N, St. Petersburg, FL 33701'
  WHERE slug='one-night-stand-stpete';
UPDATE venues SET lat=27.7700162, lng=-82.6382071, description='Big playful gastro-bar and adult arcade with pool, games, cornhole, a wall of TVs, self-poured bottomless mimosas, $25 all-you-can-eat snacks, free trivia, and a dog-friendly, game-day-friendly vibe.', address='100 4th St S, St. Petersburg, FL 33701'
  WHERE slug='park-and-rec-st-pete';
UPDATE venues SET lat=27.7735968, lng=-82.6224926, description='Open-air rooftop tiki bar atop the St. Pete Pier with sweeping water, city, and dolphin views, creative tiki cocktails, and shareable plates like lobster-chorizo empanadas; chill tropical mood.', address='800 2nd Ave NE 5th Floor, St. Petersburg, FL 33701'
  WHERE slug='pier-teaki-stpete';
UPDATE venues SET lat=27.7714168, lng=-82.6367583, description='Central Ave bar built around an extensive menu-book of shots and themed drink specials, with engaging bartenders and fun start-the-night energy, open till 3am.', address='269 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='pour-judgement-stpete';
UPDATE venues SET lat=27.7713936, lng=-82.6367072, description='Funky Vietnam/New Orleans-themed lounge on the Central Ave drag with eclectic war-era decor, house and techno DJs, rum old fashioneds, hemp cocktails, and THC seltzers; chill early, lively and danceable late.', address='265 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='saigon-blonde-stpete';
UPDATE venues SET lat=27.7709681, lng=-82.6510648, description='Rooftop Asian-leaning restaurant and cocktail bar atop the Moxy with views toward Tropicana Field, pork bao buns, sushi, lobster mac, and tequila-espresso martinis; stylish weekend energy.', address='1234 Central Ave, St. Petersburg, FL 33705'
  WHERE slug='sparrow-st-pete';
UPDATE venues SET lat=27.7719355, lng=-82.6345176, description='Compact downtown tequila bar boasting one of the world''s largest tequila collections, custom-built cocktails, hibiscus palomas, and guided tastings; friendly fast-paced bartenders and a great meet-up size, open till 3am.', address='120 1st Ave N, St. Petersburg, FL 33701'
  WHERE slug='tequila-daisy-st-pete';
UPDATE venues SET lat=27.7719201, lng=-82.6357797, description='Loft bar above Jannus Live with great city views, local DJ events, a full bar, and Sunday-Funday shot specials; cool hideaway vibe.', address='200 1st Ave N, St. Petersburg, FL 33701'
  WHERE slug='the-landing-st-pete';
UPDATE venues SET lat=27.7713218, lng=-82.6360721, description='Tongue-in-cheek trailer-park-themed bar with creative cocktails, playful shots like the American Pie and PB&J, and cheesesteaks; great music, genuine staff, and a fresh, lively concept, open weekends till 2am.', address='217 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='trailer-daddy-st-pete';
UPDATE venues SET lat=27.774514, lng=-82.6326825, description='Eclectic Beach Drive gastro-lounge with a Mediterranean-French menu, fish tacos, bottomless mimosas, hookah, Tito''s on tap, and live music; prime patio people-watching and fast service, open till 3am.', address='240 Beach Dr NE, St. Petersburg, FL 33701'
  WHERE slug='tryst-stpete';
UPDATE venues SET lat=27.7713654, lng=-82.6357291, description='Tiny Central Ave corner cocktail bar with nightly live music, a string-lit patio, an abundant drink list, $5 old fashioneds, and barrel-aged ales; intimate, vibey, with a lovely on-site owner.', address='201 Central Ave, St. Petersburg, FL 33701'
  WHERE slug='detroit-201-st-pete';
UPDATE venues SET lat=27.7718136, lng=-82.6363795, description='Popular downtown country bar with live country music, weekend outdoor DJs, multiple bars, Thursday karaoke, free military entry, and a late-night sports-bar connection; a local home base.', address='242 1st Ave N, St. Petersburg, FL 33701'
  WHERE slug='welcome-to-the-farm-stpete';

-- Dead Bob's: RELOCATE the existing st_pete row to South Tampa (the ONLY UPDATE that
-- also changes city). Slug left as-is (cosmetic) per your call.
UPDATE venues SET lat=27.909007, lng=-82.5269904, city='tampa', address='3681 S Westshore Blvd, Tampa, FL 33629', description='Unpretentious, budget-friendly South Tampa fisherman''s sports bar, open 11am-3am daily, packed with TVs and serving standout burgers, wings, French dips, and mahi bites; lively, friendly, and beloved by locals.'
  WHERE slug='dead-bobs-stpete';

-- Predalina: no live row -> INSERT (slug follows live -tampa convention; category=lounge).
INSERT INTO venues (slug, name, city, category, lat, lng, address, description, is_active, sort_order)
VALUES ('predalina-tampa', 'Predalina', 'tampa', 'lounge', 27.944868, -82.4500045, '1001 E Cumberland Ave, Tampa, FL 33602', 'Glamorous Mediterranean coastal restaurant and after-dark cocktail lounge on Water Street, all hand-laid mosaics, olive trees, and a gold disco ball over a painted dance floor.', true, 200)
ON CONFLICT (slug) DO NOTHING;

-- ===== SECTION 2: PARTNER (Lower Deck only — leaves all other featured flags intact) =====
UPDATE venues SET featured=true, featured_label='TAMPA PARTNER' WHERE slug='lower-deck-tampa';

-- ===== SECTION 3: REMOVALS (explicit slugs; after P1) =====
DELETE FROM venues WHERE slug='waterstreet-tampa';
DELETE FROM venues WHERE slug='the-saloon-tampa';

-- ===== SECTION 4: DEDUPE =====
-- Corner Bar: redundant 821 S Howard row (you explicitly approved this DELETE).
DELETE FROM venues WHERE slug='corner-bar-tampa';

-- Grove: canonical grove-soho-tampa (406 S Howard = JSON) was updated in SECTION 1.
-- Redundant the-grove-tampa (720 S Howard) deleted — CONFIRMED, same pattern as Corner Bar.
DELETE FROM venues WHERE slug='the-grove-tampa';

COMMIT;

-- ============================================================================
-- SECTION 6: VERIFY (read-only; run after COMMIT)
-- ============================================================================
SELECT slug, name, city, lat, lng, address FROM venues WHERE slug='the-patio-tampa';        -- MacDill 421 S MacDill
SELECT slug, name, city, lat, lng, address FROM venues WHERE slug='511-tampa';               -- downtown 513 N Franklin
SELECT slug, name, city, lat, lng, address FROM venues WHERE slug='oak-and-stone-stpete';    -- st_petersburg
SELECT slug, name, city, lat, lng, featured, featured_label FROM venues WHERE slug='lower-deck-tampa'; -- partner
SELECT count(*) AS total_venues FROM venues;
-- Removed/redundant gone (expect 0 rows):
SELECT slug, name FROM venues WHERE slug IN ('waterstreet-tampa','the-saloon-tampa','corner-bar-tampa');

-- ============================================================================
-- RESOLVED (nothing skipped):
--  • Dead Bob's: relocated dead-bobs-stpete -> South Tampa (city='tampa',
--    3681 S Westshore Blvd) in SECTION 1. Slug unchanged (cosmetic).
--  • Grove: the-grove-tampa (720 S Howard) DELETE is now ACTIVE in SECTION 4;
--    grove-soho-tampa (406 S Howard) kept + updated.
-- ============================================================================

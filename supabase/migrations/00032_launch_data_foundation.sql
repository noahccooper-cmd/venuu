-- ═══════════════════════════════════════════════════════════════
-- 00032_launch_data_foundation.sql
--
-- LAUNCH MARKET DATA FOUNDATION — Knoxville, Tampa, St. Petersburg
--
-- Populates the substrate Venny needs to answer user questions:
--   • venues.description    — rich Venny-training paragraphs (PDF B)
--   • venues.effective_capacity — wall-to-wall headcount (PDF A)
--   • venues.fire_capacity  — posted legal occupancy (PDF A)
--   • venues.cover_policy   — typical door cover (PDF A)
--   • venues.venue_notes    — entry rules, peak nights, etc. (PDF A)
--
-- Sources:
--   PDF A — venuu_team_data_collection.pdf (Mike → Knoxville,
--           Karston → Tampa + St. Pete; cap/cover/notes)
--   PDF B — venuu-full-market-bar-intel.pdf (Venny training, full
--           bar-by-bar descriptions)
--
-- Soft-delete:
--   • '5 Bucks' (st_petersburg) — confirmed duplicate of
--     'Five Bucks Drinkery'. is_active = false.
--
-- DOES NOT TOUCH:
--   • Knoxville fraternity rows, BYX, FIJI, or the 'venuu' test row
--   • Tampa non-SoHo apparent duplicates (The Grove, Corner Bar,
--     MacDinton's Irish Pub) — see follow-up at bottom
--   • Edge functions, doctrine, system prompts, client code
--
-- Idempotent. Wrapped in BEGIN/COMMIT. Re-running is safe.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- A) Schema additions
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS description        TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS effective_capacity INTEGER;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS fire_capacity      INTEGER;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS cover_policy       TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS venue_notes        TEXT;


-- ───────────────────────────────────────────────────────────────
-- B) Soft-delete the confirmed duplicate row
-- ───────────────────────────────────────────────────────────────
UPDATE public.venues
   SET is_active = false
 WHERE name = '5 Bucks'
   AND city = 'st_petersburg';


-- ═══════════════════════════════════════════════════════════════
-- C) KNOXVILLE — 18 venues, capacity + cover + descriptions
-- ═══════════════════════════════════════════════════════════════

-- 1. The Bookstore
UPDATE public.venues SET
  description = $desc$The Bookstore sits at 821 Melrose Place in Fort Sanders — a neighborhood bar a short walk from The Strip proper, in the quieter block between Cumberland and campus. It operates as a restaurant and bar without the high-volume college-bar energy of the main strip, which gives it a slightly different crowd — more mixed-age, more neighborhood. The venuu connection here runs through ownership relationships established via content partners, making it a natural venue for Portal activation and a good early-night option for people who want food and drinks before heading toward the denser strip area. Worth knowing as both a venuu partner target and a useful recommendation when someone asks what's off the main drag.$desc$,
  fire_capacity      = 350,
  effective_capacity = 400,
  cover_policy       = 'Varies by Night',
  venue_notes        = $note$Underclassman (majority)$note$
WHERE name = 'The Bookstore' AND city = 'knoxville';

-- 2. Yacht Club
UPDATE public.venues SET
  description = $desc$Fort Sanders Yacht Club sits just far enough off Cumberland to feel like a neighborhood bar rather than a Strip bar, which is exactly the appeal for people who know it. Craft beers, coin-op arcade games, live music, and a casual patio where students and older Fort Sanders regulars coexist without it being weird. Reviewers consistently call it a good pregame before heading down Cumberland, which undersells it — it's also a perfectly good destination in its own right when you want a cold beer and a quieter room. The staff is friendly and the prices are fair. Good for a group that's just settling in for the evening before figuring out the rest of the night.$desc$,
  effective_capacity = 90,
  cover_policy       = 'Free',
  venue_notes        = $note$Under/Upper - Open to all.$note$
WHERE name = 'Yacht Club' AND city = 'knoxville';

-- 3. Half Barrel
UPDATE public.venues SET
  description = $desc$Half Barrel is The Strip's craft beer anchor — 30+ taps with a genuine focus on regional Southeast breweries out of Tennessee, North Carolina, Georgia, and Virginia, which makes the tap list consistently more interesting than anything else on Cumberland. The layout is a long bar down one side, booths down the other, and a back room with pool tables and Golden Tee. The patio added in later years gives it a neighborhood pub feel that keeps older locals coming back alongside the UT students. The food is made from scratch in a kitchen that takes bar food seriously — the wings and burgers are reliable and the portions are right. If someone in your group cares what's in the glass, this is the Strip bar to bring them to.$desc$,
  effective_capacity = 400,
  cover_policy       = 'Free',
  venue_notes        = $note$Upper - Open to all.$note$
WHERE name = 'Half Barrel' AND city = 'knoxville';

-- 4. Sunspot
UPDATE public.venues SET
  description = $desc$Sunspot is one of the few places on The Strip where you can have a genuinely great meal and a gourmet drink in the same seat. The menu skews vegetarian-forward — the Black Bean Burger, the BGLT (fried green tomato, bacon, arugula, goat cheese), and the Rattlesnake Pasta are all regulars worth ordering — and the bar runs 40+ taps alongside 46 bourbon selections, which puts it above almost everything else on Cumberland. The rooftop patio is exactly what you want when the weather cooperates, and the dim, moody interior with reclaimed wood and padded booths is comfortable enough to stay in for hours. The crowd trends toward grad students and professors more than undergrads — it stays low-key even when it's busy — and the staff is knowledgeable about what's on tap. The venuu April 8 launch was here for a reason. It earns it.$desc$,
  effective_capacity = 300,
  cover_policy       = 'Free',
  venue_notes        = $note$Upstairs 150 / 300 total. "Wine" Wednesday Peak Night - Upperclassman. More strict now.$note$
WHERE name = 'Sunspot' AND city = 'knoxville';

-- 5. Cool Beans
UPDATE public.venues SET
  description = $desc$Cool Beans is the default answer when someone on The Strip wants cheap drinks and a room full of people who are committed to having a good time. The outdoor patio and indoor setup with beer pong and pool tables keep it social, the drink prices are hard to argue with, and the strict 21+ door means the crowd is actually old enough to be there without someone's fake ID anxiety killing the vibe. Thursday through Saturday, the Greek life crowd packs it reliably — it's one of the busiest bars on the strip by volume on a game weekend, and it earns that by being straightforward about what it is. Not trying to be a cocktail bar. Just a well-executed, high-energy college bar that knows its audience.$desc$,
  effective_capacity = 350,
  cover_policy       = '$10 to skip, varies by Night',
  venue_notes        = $note$Upperclassman gem!$note$
WHERE name = 'Cool Beans' AND city = 'knoxville';

-- 6. Taqueria Mares
UPDATE public.venues SET
  description = $desc$Taqueria Mares pulls off something rare on The Strip: genuinely good Mexican food at prices that make sense, open late enough to matter. The self-service toppings bar is the highlight — sour cream, cheese, pico, and everything else without extra charges, which is a relief after years of getting nickel-and-dimed for guacamole. The tacos al pastor are the move; the steak quesadilla is loaded. It's not a bar in the traditional sense, but it's a critical part of any Strip night that involves eating — the late-night kitchen open to 2:25am makes it the right answer when the group gets hungry and the options narrow. Go here before the loud bars or after them when you need something real.$desc$,
  effective_capacity = 175,
  cover_policy       = 'Free',
  venue_notes        = $note$Under/Upper - Open to all.$note$
WHERE name = 'Taqueria Mares' AND city = 'knoxville';

-- 7. Yee-Haw Brewing
UPDATE public.venues SET
  description = $desc$Yee-Haw is an entertainment complex that happens to brew excellent beer, and the scale of the operation makes it feel like nothing else in Knoxville. Sixty-two taps poured from an in-house brewery — the World Beer Cup-winning Dunkel is the standard-bearer, but the rotating seasonals and high-gravity offerings are worth exploring — alongside a full kitchen running wings and Nashville hot chicken from a Prince's Chicken collaboration. The outdoor setup includes a 75-foot jumbotron, an amphitheater with firepits, and enough space for large-scale watch parties and concerts. Bar games, bocce, and a late-night kitchen keep it useful past the dinner hour. The crowd is mixed and multi-generational — the beer garden has a genuinely community feel that separates it from the college bars on The Strip. Best for groups who want options, or anyone who just wants to sit outside with a good beer and watch something on a screen the size of a small building.$desc$,
  effective_capacity = 500,
  cover_policy       = 'Free',
  venue_notes        = $note$Under/Upper - Open to all.$note$
WHERE name = 'Yee-Haw Brewing' AND city = 'knoxville';

-- 8. Southbound's Bar (DB row: 'Southbound')
UPDATE public.venues SET
  description = $desc$Southbound's is definitively Knoxville's largest and highest-volume nightclub — three floors, six full-service bars including the 90 Proof club on the third floor, and an outdoor courtyard with a stage for live concerts. The resident DJ is Eric B from Hot 104.5, who has over 20 years of experience and a reputation for reading a room: Top 40 to Hip-Hop to House to Country to Old School, whatever keeps the floor moving. VIP tables are available if you want to claim your corner. This is where the night ends in Knoxville, not where it starts — it peaks well after midnight on Fridays and Saturdays. The Old City is buzzing around it, which gives you the option to start elsewhere and end here. If you want the most concentrated nightlife energy in the city in one building, this is the answer.$desc$,
  cover_policy       = 'Varies by Night',
  venue_notes        = $note$Upperclassman$note$
WHERE name = 'Southbound' AND city = 'knoxville';

-- 9. Preservation Pub
UPDATE public.venues SET
  description = $desc$If someone asks where to go in Knoxville for one night, Preservation Pub is the answer. It has been running live music 365 days a year until 3am on Market Square for years — every level functions as a different bar, with a colorful rooftop deck for open-air drinks, a stage floor for the full live music experience, and cozy booths tucked into corners where you can actually have a conversation. USA Today named it one of the best bars in America, and the local consensus agrees. The crowd is deliberately eclectic — students, locals, tourists, everyone — and the vibe is genuinely welcoming rather than performed. Owned by Scott and Bernadette West, who also run LunaVerse and the broader Scruffy City entertainment operation. It doesn't matter what night of the week it is: Preservation Pub is open, something is playing, and people are having a real time.$desc$,
  effective_capacity = 385,
  cover_policy       = 'Varies by Night',
  venue_notes        = $note$Market Square. Upperclassmen. Closest thing to a Nashville broadway bar we have.$note$
WHERE name = 'Preservation Pub' AND city = 'knoxville';

-- 10. Radius Rooftop
UPDATE public.venues SET
  description = $desc$Radius is 14 floors above Gay Street at the Embassy Suites — the tallest rooftop bar in downtown Knoxville — and the view earns that claim. The 360° circular bar is one of the better-designed bar spaces in the city, and the outdoor pool deck with fire pits gives it a resort feel that's unusual for downtown Tennessee. The signature Smoked Old Fashioned and the espresso martini get consistent praise; the overall cocktail program is solid rather than groundbreaking. The crowd skews younger and louder on weekends — reviewers note it gets "LITTY" by Friday night, which is a 180 from the quieter Five Thirty Lounge a few blocks away. The best time is right at sunset when the city lights up below and the Smoky Mountains are visible on the horizon. Dress accordingly and consider arriving around golden hour if the views are the reason you're going.$desc$,
  effective_capacity = 300,
  venue_notes        = $note$Upperclassman$note$
WHERE name = 'Radius Rooftop' AND city = 'knoxville';

-- 11. Southside Garage
UPDATE public.venues SET
  description = $desc$Southside Garage is South Knoxville's outdoor living room — a craft beer bar and food truck park where the goal is to sit outside with something good in your hand without the pressure of a structured bar environment. Bocce ball courts, picnic tables in sun and shade, a dog-friendly patio, and rotating food trucks (Ryhno's and Oakwood are regulars) make it a destination in its own right. The crowd is 25–40, outdoorsy, and local — people who live in South Knox and know the neighborhood well enough to walk here. It sits near Hi-Wire Brewing and Alliance Brewing, which makes the whole stretch of South Landing into a viable afternoon crawl. More afternoon and early-evening energy than late night. Go here when the weather is right and you want a Knoxville experience that has nothing to do with The Strip or the Old City.$desc$,
  venue_notes        = $note$Upperclassman$note$
WHERE name = 'Southside Garage' AND city = 'knoxville';

-- 12. Kern's Food Hall
UPDATE public.venues SET
  description = $desc$Kern's is what happened when someone looked at the original 1931 Kerns Bakery building in South Knoxville and decided to save it instead of replace it. The result is a food hall with rotating local chef vendors, a full craft cocktail bar, live music on weekends, and night markets that draw a crowd that's genuinely invested in local food culture. The vendors change quarterly, which means there's almost always something new — global street food, Southern staples, and chef residencies from around the region cycle through the stalls. The cocktail bar is a full operation, not an afterthought. The crowd is creative, community-minded, and South Knoxville through and through — the kind of people who will tell you that Kern's is the real Knoxville if you give them the opportunity. Worth visiting for the atmosphere alone, and usually worth staying for longer than you planned.$desc$,
  effective_capacity = 625,
  cover_policy       = 'Free',
  venue_notes        = $note$Under/Upper - Open to all.$note$
WHERE name = 'Kern''s Food Hall' AND city = 'knoxville';

-- 13. Hannas Cumberland (DB row: 'Hannas')
UPDATE public.venues SET
  description = $desc$Hanna's is housed in what used to be the Booth Theater — one of the oldest movie houses in Knoxville — which gives it a scale and layout that most Strip bars can't match. Two dance floors, three bars, and a large outdoor patio spread across multiple levels, with an 80s, 90s, and early 2000s retro dance party as the format Thursday through Saturday. The crowd is college-forward and the door is strict 21+, and by 11pm on a weekend it's one of the highest-energy rooms on the entire strip. Not a place for a conversation — the music is loud and the floors fill up. Best for a group that wants to dance and doesn't need to be able to hear each other. Historically reliable, high-volume, and easy to find when everyone just wants to go somewhere that's clearly alive.$desc$,
  effective_capacity = 500,
  cover_policy       = 'Free',
  venue_notes        = $note$Upperclassman.$note$
WHERE name = 'Hannas' AND city = 'knoxville';

-- 14. The Hill (DB row: 'The Hill Bar & Grill')
UPDATE public.venues SET
  description = $desc$The Hill has been in Fort Sanders since 2007 and the formula hasn't changed: award-winning wings (genuinely the best in Knoxville by multiple competition wins), daily specials that include $1 taco Tuesdays and 50¢ wings on Wednesdays, and a patio with direct sight lines to the Sunsphere and World's Fair Park. It's open from 11am to 3am every day, which makes it useful at every hour. The music schedule runs live and DJ formats — Tommy Jarvis, who does drone and ground content for venuu, plays here regularly — and the big screens cover all major sporting events. The crowd mixes UT students, Fort Sanders locals, and sports fans, and the atmosphere stays casual even when it's packed. A local favorite for a reason: the food is legitimate, the drinks are priced right, and there's almost always something going on.$desc$,
  effective_capacity = 485,
  cover_policy       = 'Varies by Night',
  venue_notes        = $note$Under/Upper - Open to all. "Wing" Wednesday Peak Night / Gameday(s).$note$
WHERE name = 'The Hill Bar & Grill' AND city = 'knoxville';

-- 15. Old City Sports Bar
UPDATE public.venues SET
  description = $desc$The Old City Sports Bar is exactly what it says — Knoxville's only dedicated sports bar in the historic Old City, with 23 big screens and a balcony that puts you eye-level with the district's distinctive brick architecture while watching the game. The crowd is sports-fan focused rather than nightlife focused: beers and wings, big games on every screen, and a room that gets loud when Knoxville's teams are doing something worth yelling about. It's more of a game-day destination than a late-night stop, but it fills a specific gap in the Old City's otherwise nightclub-leaning bar lineup. Good for a group that needs something more low-key than Southbound's while still being in the middle of the action.$desc$,
  effective_capacity = 470,
  cover_policy       = 'Free',
  venue_notes        = $note$Upperclassman.$note$
WHERE name = 'Old City Sports Bar' AND city = 'knoxville';

-- 16. LunaVerse
UPDATE public.venues SET
  description = $desc$LunaVerse opened in April 2024 at 940 Blackstock Avenue and immediately became one of Knoxville's most talked-about nightlife venues. The concept is immersive — the design is theatrical rather than generic club, with a VIP lounge upstairs and DJ programming that leans into the experience rather than just filling the room with sound. It's owned by Scott and Bernadette West, who built Preservation Pub into a national landmark and run the broader Scruffy City entertainment operation, which means LunaVerse benefits from real operator expertise rather than first-time nightclub ambition. The crowd is heavily UT students and young Knoxville professionals, and Thursday through Saturday 7pm to 3am is the operating window. Asylum 801 — a separate nightclub concept — shares the building. The location sits between Fort Sanders, World's Fair Park, Market Square, and the Old City, which makes it geographically central to every major nightlife district in the city. If you want the most produced nightlife experience currently on offer in Knoxville, this is the destination.$desc$,
  effective_capacity = 600,
  cover_policy       = '$10, Varies by Night. Discount with TN student ID',
  venue_notes        = $note$Under/Upper - Open to all.$note$
WHERE name = 'LunaVerse' AND city = 'knoxville';

-- 17. Undeclared (PDF B has no description for this venue — caps + notes only)
UPDATE public.venues SET
  effective_capacity = 360,
  cover_policy       = '$10, Varies by Night',
  venue_notes        = $note$Underclassman (Majority)$note$
WHERE name = 'Undeclared' AND city = 'knoxville';

-- 18. Literboard (DB row: 'LiterBoard') — PDF B has no description, caps + notes only
UPDATE public.venues SET
  effective_capacity = 425,
  venue_notes        = $note$Underclassman (Majority)$note$
WHERE name = 'LiterBoard' AND city = 'knoxville';


-- ═══════════════════════════════════════════════════════════════
-- D) ST. PETERSBURG — capacity (PDF A) + descriptions (PDF B)
--    The soft-deleted '5 Bucks' row is intentionally skipped.
-- ═══════════════════════════════════════════════════════════════

-- 1. Copper Shaker
UPDATE public.venues SET
  description = $desc$Copper Shaker is St. Pete's best bar by nearly every available metric — 821 five-star reviews, awards for the Old Fashioned, and a bartending team that will honestly build you the best cocktail you've ever had if you tell them what you like and let them work. The signature drinks are worth ordering on their own: the Grind, the Smoked Old Fashioned, the espresso martini, the Bee Sneeze. The food program is chef-driven and serious — the truffle fries, bang bang cauliflower, and filet dishes get as much praise as the drinks, which is unusual for a cocktail bar. The interior is dark, warm, and moody with copper distilling equipment visible in the front window. It fills up on weekend evenings, and the line can form before 9pm on Fridays and Saturdays. Open every day from 4:30pm to 3am. If someone asks for one bar recommendation in St. Pete, this is it.$desc$,
  fire_capacity      = 200,
  effective_capacity = 150
WHERE name = 'Copper Shaker' AND city = 'st_petersburg';

-- 2. Birchwood Canopy
UPDATE public.venues SET
  description = $desc$The Canopy sits atop the Birchwood Inn on Beach Drive with some of the cleanest bay views in downtown St. Pete — the new St. Pete Pier is visible from the outdoor seating, and the direction you're facing on a clear evening makes the whole thing feel like a reward for showing up. The Frosé is the signature and it's earned that status; 50% off on Wednesdays makes it an easy mid-week decision. The food menu — flatbreads, poutine, shrimp cocktail — is comfortable and well-priced for the setting. The crowd skews toward couples and 30+ professionals who are there specifically for the atmosphere rather than a party, which gives it a quieter energy than most of the Jannus Block options. Best for a pre-dinner drink, a birthday celebration that doesn't need volume, or any evening when the goal is the view. Dress nicely — the setting calls for it.$desc$,
  fire_capacity      = 135,
  effective_capacity = 100
WHERE name = 'Birchwood Canopy' AND city = 'st_petersburg';

-- 3. Saigon Blonde
UPDATE public.venues SET
  description = $desc$Saigon Blonde is one of the most genuinely original bars in downtown St. Pete — a 60s Vietnam War-inspired tiki bar with bamboo ceilings, tiki totems, vintage propaganda posters, and a cocktail menu that includes CBD-infused options if that's your move. The downstairs bar is a destination in its own right for cocktails and the full visual experience and house music with EDM vibes; the upstairs transforms into a nightclub on weekend nights when the crowd wants to keep going. The Depart at Dawn is the cocktail to order. The bar pulls a curious 21–35 crowd that wants something more interesting than a standard bar crawl stop, and it consistently delivers on that expectation. Reviewers compare it favorably to bars they've loved in much larger cities. Lines form on Friday nights — go early if you want a seat, or plan to stand at the bar and make the most of it.$desc$,
  fire_capacity      = 200,
  effective_capacity = 151
WHERE name = 'Saigon Blonde' AND city = 'st_petersburg';

-- 4. Mandarin Hide
UPDATE public.venues SET
  description = $desc$Mandarin Hide has the largest spirits collection in downtown St. Pete — over 450 bottles including rare bourbons and Scotches you won't find at most bars — and bartenders who genuinely know how to use them. The custom cocktail build is the signature move: tell them what you like, what you're in the mood for, and they'll make something specifically for you. The espresso martini is routinely called the best in the city. The room has a speakeasy feel that's earned rather than designed — intimate, dark, and genuinely focused on the drink. Birthday policy includes a free bottle of champagne with a sparkler for your group, which makes it a natural celebration destination. The crowd is 25–45, knows their way around a drinks menu, and is there for a focused evening rather than a big night out. One of Tampa Bay's best bars for people who take their drinking seriously.$desc$,
  fire_capacity      = 125,
  effective_capacity = 100
WHERE name = 'Mandarin Hide' AND city = 'st_petersburg';

-- 5. Five Bucks Drinkery
UPDATE public.venues SET
  description = $desc$Five Bucks Drinkery has been a Central Ave fixture for over a decade, and the formula has barely changed: enormous drinks at prices that are genuinely hard to argue with. The 32oz drink sizes were novel when they opened and remain one of the best value propositions in DTSP. Three separate bars inside handle the volume that consistently packs the place. The kitchen running until 2am is the detail that makes it useful at every hour of the night. Perfect for groups that want to keep going without watching the bill.$desc$,
  fire_capacity      = 250,
  effective_capacity = 200
WHERE name = 'Five Bucks Drinkery' AND city = 'st_petersburg';

-- 6. Welcome to the Farm
UPDATE public.venues SET
  description = $desc$Welcome to the Farm — WTF — is the country bar that Chase Rice built, literally: the décor is inspired by his Tennessee farm, the cups feature his dog's face, and the whiskey menu reflects his actual tastes across Ohio, Kentucky, and Tennessee distilleries. Live music runs every open night (Thursday through Sunday), the space holds 400 people across 4,000 square feet, and the outdoor patio backs directly onto Jannus Live — one of the top outdoor music venues in the country — which makes the whole block feel connected on a busy night. The crowd is loud, the music is live, and the vibe is honky-tonk done with real investment rather than theme-bar cosplay. The Big A$$ Mule in a massive copper mug and the Mimosa Tower are the group drink moves. Dog-friendly. The Jannus Block version of Nashville's Lower Broadway. Best Thursday through Sunday when the full live music program is running.$desc$,
  fire_capacity      = 400,
  effective_capacity = 350
WHERE name = 'Welcome to the Farm' AND city = 'st_petersburg';

-- 7. Park & Rec
UPDATE public.venues SET
  description = $desc$Park & Rec is the answer when someone in the group wants more than standing at a bar. Pinball, air hockey, pool, classic arcade consoles including Mortal Kombat and Galaga, cornhole, Jenga, and multiple outdoor areas keep it genuinely entertaining rather than just atmospheric. The cocktail program is full-service — signature drinks, retro-themed shots, and party pouches made with Bacardi and fruit juice for the group-drink crowd. Reviewers consistently note giant beer pong as a highlight. The staff is specifically praised across multiple reviews, with named bartenders and managers getting shoutouts. The crowd is 21–35 and there because they want to play, which gives it a social energy that's different from the Jannus Block options. Good for a first date, a group that's been arguing about where to go, or anyone who needs a reason to stay in one place for the whole night.$desc$,
  fire_capacity      = 500,
  effective_capacity = 400
WHERE name = 'Park & Rec' AND city = 'st_petersburg';

-- 8. Pour Judgement
UPDATE public.venues SET
  description = $desc$Pour Judgement solved a simple problem: if you have 269 shots on the menu named for your address, nobody can ever say they don't know what to order. The craft shot concept is genuine — five major spirits plus sake, limoncello, and more, executed as thoughtful recipes rather than sugar-bomb afterthoughts. The Why's The Rum Gone is a flaming pirate-inspired pour; the El Vocho is jalapeño-spiked; the Left Twix and Right Twix are built for the indecisive. The crowd is Jannus Block 21–35 and comes specifically to try things they've never had before, which creates an unusually curious and good-humored room. Same ownership as One Night Stand and Welcome to the Farm. Consistently packed Thursday through Saturday. Great as a group pit stop mid-crawl or a starting point when the group needs a theme to organize around.$desc$,
  fire_capacity      = 150,
  effective_capacity = 100
WHERE name = 'Pour Judgement' AND city = 'st_petersburg';

-- 9. Goodnight John Boy (DB row: 'Good Night John Boy')
UPDATE public.venues SET
  description = $desc$Goodnight John Boy is one of the most fully committed themed bars in St. Pete — disco balls, a light-up dance floor, Farrah Fawcett poster on the wall, vintage box TVs running era clips, and phone receivers mounted for effect. The DJ plays remixed 70s and 80s hits, the crowd actually dances, and the age range is genuinely broad — 25 to 55 — which creates a room that's more fun than a standard nightclub precisely because not everyone is performing. The Disco Ball Run cocktail comes in a container you get to keep. Reviewers describe it as the kind of place where you plan to stay for one drink and end up staying for the whole evening. Consistently popular for bachelorette parties and birthdays; if you walk in and see a sash, accept that this is going to be a group activity. Open Wednesday through Sunday.$desc$,
  fire_capacity      = 300,
  effective_capacity = 250
WHERE name = 'Good Night John Boy' AND city = 'st_petersburg';

-- 10. Pier Teaki
UPDATE public.venues SET
  description = $desc$Pier Teaki sits at the far end of the St. Pete Pier with west-facing views across the water — sunsets here are a legitimate reason to plan your evening around it. Owned by the same team as the Birchwood Canopy, it shares the same quality baseline: good drinks, attentive staff, and a setting that does most of the atmospheric work. The tiki aesthetic is well-executed without being kitschy, the outdoor space is genuinely large and comfortable, and the whole vibe is relaxed in a way that the downtown bars can't quite replicate. It's a 10-minute walk from the core Central Ave scene, which filters for people who came specifically for this experience rather than bar-hoppers passing through. One practical note: there's a standard 20% service fee added to every check, which reviewers mention enough to be worth knowing in advance. Worth the walk every time the weather cooperates.$desc$,
  fire_capacity      = 120,
  effective_capacity = 100
WHERE name = 'Pier Teaki' AND city = 'st_petersburg';

-- 11. Tryst
UPDATE public.venues SET
  description = $desc$Tryst is one of the quieter upscale options on Beach Drive — an eclectic cocktail bar and kitchen with genuinely original signature cocktails and a food menu that skews upscale without becoming precious. The room is intimate rather than expansive, which makes it better for a focused conversation than a group night out, and the spirits program goes deeper than most bars in this price range. The crowd is 28–45 and deliberately choosing it over the Jannus Block options, which means they came for the drinks and the setting rather than the energy. Reviewers describe the bartenders as knowledgeable and the cocktails as precisely executed. A good recommendation when someone asks for something a step above the standard Central Ave crawl without going full hotel bar.$desc$,
  fire_capacity      = 75,
  effective_capacity = 50,
  venue_notes        = $note$Downtown city hookah lounge and bar$note$
WHERE name = 'Tryst' AND city = 'st_petersburg';

-- 12. Crafty Squirrel
UPDATE public.venues SET
  description = $desc$Crafty Squirrel is one of those bars that earns its regulars through consistency rather than spectacle: solid craft beer and cocktail selection, one of the better happy hours in DTSP (featured on multiple best-of lists), and an atmosphere that's comfortable enough to stay in without any particular reason to leave. The crowd is local 25–40 who have found their bar and return to it. No gimmicks, no dress code, no line. If someone asks for a low-key option in downtown St. Pete that doesn't involve the Jannus Block energy, this is the recommendation.$desc$,
  fire_capacity      = 150,
  effective_capacity = 125
WHERE name = 'Crafty Squirrel' AND city = 'st_petersburg';

-- 13. Mary Margaret's Pub
UPDATE public.venues SET
  description = $desc$Mary Margaret's is a genuine neighborhood pub — intimate, no food, dog-friendly courtyard with water bowls, no cover, and a crowd that represents an actual cross-section of the St. Pete community rather than a specific demographic. The style of the bar is described consistently as an intimate pub that makes new people feel like regulars immediately. It works best as a quiet pint spot for a conversation you actually want to have, or a wind-down after the louder bars on Central Ave. The dogs appreciate the courtyard. If someone asks for something low-key and authentic in DTSP, this is the honest answer.$desc$,
  fire_capacity      = 100,
  effective_capacity = 75,
  venue_notes        = $note$Downtown St Pete's Irish Pub$note$
WHERE name = 'Mary Margaret''s Pub' AND city = 'st_petersburg';

-- 14. Flute & Dram (KEEP active — PDF A "Remove" appears to be the typo Noah flagged)
UPDATE public.venues SET
  description = $desc$Flûte & Dram is built on a specific premise: the best champagnes and the best whiskeys, in the same room, served correctly. Over 60 champagnes and sparkling wines alongside 75 to 100 rare brown spirits — Pappy Van Winkle is on the list — poured in Glencairn glasses with precision droppers so the spirit hits the palate the way it's meant to. The 1930s-inspired décor makes the room feel like you've walked into a bar from before anyone was born. The Thursday happy hour (25% off cocktails, BOGO sparkling wine 4–7pm, live music 5:30–8pm) is the highest-value window to visit. Best for a special occasion, a rare pour you've been meaning to try, or anyone who wants to have a serious drink in a serious room. Not a nightlife destination — a drinking destination, which is a different and more specific thing.$desc$
WHERE name = 'Flute & Dram' AND city = 'st_petersburg';

-- 15. Trailer Daddy
UPDATE public.venues SET
  description = $desc$Trailer Daddy opened in March 2026 at 217 Central Ave — taking over the former Glamper space — and immediately became one of the most talked-about new bars in DTSP. The concept is a retro trailer park, fully committed: vintage campers inside the 5,000-square-foot space, wall-to-wall neon signs, lawn flamingos, red Solo cups as aesthetic, and a Mullet Hall of Fame behind the bar from the grand opening contest. Signature drinks arrive in flamingo glasses and the Porch Pounder, M'urica, and Pickleback are the approachable entry points. Classic rock and country fill the room. Built by Forward Hospitality Group — the same team behind Good Night John Boy, Welcome to the Farm, and My Rich Uncle — which means the concept is executed rather than half-finished. Appeals to a 21–40 crowd who want a photo moment, a drink with a name, and a room that commits to the bit completely.$desc$,
  fire_capacity      = 300,
  effective_capacity = 200,
  venue_notes        = $note$American trailer themed nightlife bar. Games, themed bars and rooms, creative drinks.$note$
WHERE name = 'Trailer Daddy' AND city = 'st_petersburg';

-- 16. One Night Stand
UPDATE public.venues SET
  description = $desc$One Night Stand is the casual country anchor at the west end of the Jannus Block — the same ownership group runs Pour Judgement at 269 Central and Welcome to the Farm at 242 1st Ave N, which makes this whole stretch a contiguous country and party bar ecosystem. Daily happy hour until 8pm with aggressive nightly specials ($2 PBR Tall Boys, 2-for-1 Mason Jar drinks on Tuesdays, $3 pitchers on Wednesdays) keeps it accessible for the early-evening crowd. The vibe is lower-key than its neighbors and intentionally so — it's the entry point to the Jannus Block cluster, good for a first drink before the group decides where the night is going. 21–35, casual, no agenda.$desc$,
  fire_capacity      = 250,
  effective_capacity = 175,
  venue_notes        = $note$Greasy, country, southern bar.$note$
WHERE name = 'One Night Stand' AND city = 'st_petersburg';

-- 17. My Rich Uncle
UPDATE public.venues SET
  description = $desc$My Rich Uncle is the most dressed-up option on the Jannus Block — a retro martini bar and lounge with bottle service, dancing, and a crowd that treated this as the intentional stop of the night rather than a bar-hopping casualty. No food, no sports TVs, no arcade games: just cocktails, a dance floor, a VIP section, and a room that leans upscale without locking out people who showed up well but not in formal wear. Reviewers describe an upscale feel that still welcomes a good time. Part of Forward Hospitality Group's cluster at this address, so it sits alongside Welcome to the Farm and shares the same high-execution operator DNA. Best Friday and Saturday after 10pm when it's fully alive — earlier in the week, the energy doesn't fully materialize.$desc$,
  fire_capacity      = 400,
  effective_capacity = 300,
  venue_notes        = $note$Upstairs soundroom club/bar, dark, moody, thrilling.$note$
WHERE name = 'My Rich Uncle' AND city = 'st_petersburg';

-- 18. Sparrow
UPDATE public.venues SET
  description = $desc$Sparrow is the rooftop concept atop the Moxy Hotel in the EDGE District — a 1960s-inspired upscale bar that splits the difference between a hotel bar and a neighborhood destination. The Asian-inspired food menu is legitimately good: Bang Bang Shrimp Tacos, a 12oz Prime NY Strip, and a Dragon sushi roll stand out in reviews. The cocktail program runs craft alongside bottle service for groups who want it. Happy hour 5–7pm runs $10 classic cocktails, $9 wines, and snack bites, which is the best value window. The crowd is professionals and hotel guests 25–45; the operator describes it specifically as upscale but not velvet-rope, which is accurate — it's elevated without being exclusive. Thursday through Saturday only (5:30pm to midnight or 2am), which keeps it curated. The Fort Lauderdale original at The Dalmar Hotel established the reputation; the St. Pete version was built to match it.$desc$,
  fire_capacity      = 100,
  effective_capacity = 75,
  venue_notes        = $note$Dinner lounge, rooftop, luxury cocktails, DJ nights.$note$
WHERE name = 'Sparrow' AND city = 'st_petersburg';

-- 19. No Vacancy (KEEP active — PDF B has full description)
UPDATE public.venues SET
  description = $desc$No Vacancy leans into the Florida trailer park theme with full commitment — colorful décor, fun details throughout, and an atmosphere that reads as genuinely playful rather than trying too hard. Hunger + Thirst Restaurant Group (which also runs Park & Rec) built it as a concept with real character. The margaritas are consistently praised; the wings are a reliable food order. Large indoor space and a spacious outdoor patio give it flexibility for groups of different sizes. The crowd is 21–40 and casual — no dress code, no attitude, and the bartenders (Jay and Max get regular shoutouts in reviews) are friendly and attentive. A good mid-crawl stop on Central Ave or a standalone destination when you want something social without the Jannus Block intensity.$desc$
WHERE name = 'No Vacancy' AND city = 'st_petersburg';

-- 20. Ferg's Sports Bar
UPDATE public.venues SET
  description = $desc$Ferg's is not a bar. Ferg's is an institution. Founded in 1992 as a gas station across from the dome, it expanded over 30 years into the largest sports bar in Florida — nearly two city blocks, 90+ TVs, a Clubhouse with a DJ booth and disco bingo, an outdoor concert venue that books national acts, a dog park, axe throwing, and 11 distinct event venues. USA Today named it the #1 local sports bar in the country. The connection to Tropicana Field runs literally underground through a tunnel that leads directly to the stadium property. On Rays game days, Ferg's fills hours before first pitch and empties slowly after the last out. The regular crowd covers every demo from serious sports fans to families to dog owners to people who just want $5 wings and a cold beer. No bar in St. Pete offers more options in a single address.$desc$,
  fire_capacity      = 2000,
  effective_capacity = 1500,
  venue_notes        = $note$America's number 1 sports bar.$note$
WHERE name = 'Ferg''s Sports Bar' AND city = 'st_petersburg';


-- ═══════════════════════════════════════════════════════════════
-- E) TAMPA — descriptions only (PDF B). No PDF A capacity data.
--    SoHo-named rows get the SoHo descriptions per user direction.
--    Non-SoHo duplicates (The Grove, Corner Bar, MacDinton's Irish
--    Pub) are intentionally left untouched.
-- ═══════════════════════════════════════════════════════════════

-- 1. Meat Market
UPDATE public.venues SET
  description = $desc$Meat Market is Tampa's closest equivalent to a South Beach dining room — an upscale Hyde Park steakhouse that goes full nightlife on Friday and Saturday when The Lounge takes over with resident DJs, bottle service, and a crowd that came dressed for it. The food program runs prime steaks, fresh seafood, a crudo bar, and handcrafted cocktails from an award-winning wine list, and the kitchen is serious enough to pull in reviewers who come for the food and stay for the atmosphere. The patio and lounge draw equally well; the 6,000-square-foot space can absorb large groups without losing intimacy. Best for a celebration, a date night that earns its price tag, or a Friday when you want to start at dinner and end somewhere loud. Book in advance for a proper table; show up after 9pm if you just want the lounge experience.$desc$
WHERE name = 'Meat Market' AND city = 'tampa';

-- 2. Lower Deck
UPDATE public.venues SET
  description = $desc$Lower Deck sits at pier level on Harbour Island with unobstructed views of downtown Tampa across the water — the kind of spot where the setting is doing most of the work and succeeding at it. From Three Oaks Hospitality (same group as Armature Works' Stones Throw), it runs a casual, quality food menu alongside classic drinks in a patio bar format that's genuinely comfortable. The crowd is local professionals and groups looking for the waterfront experience without the upscale price tag of the hotel bars across the channel. It opens at 11:30am Thursday through Saturday and runs until the early hours, which makes it flexible. This is a first-drink-of-the-night not where the night ends — but it's one of Tampa's better starts.$desc$
WHERE name = 'Lower Deck' AND city = 'tampa';

-- 3. American Social
UPDATE public.venues SET
  description = $desc$American Social does two things extremely well: brunch and game days. The bottomless mimosa brunch on Saturdays and Sundays draws a 21–35 professional crowd that packs the outdoor patio early, and the waterfront views give it a setting that outclasses the sports bar category it technically occupies. On big game nights, the TVs cover every angle and the crowd brings real energy. The cocktail towers and shareable programs make it built for groups. Reviewers consistently single out the Goat Cheese Croquettes and the Steak Frites as standouts — the food is better than you expect from a place known for its brunch scene. The indoor bar area and covered outdoor patio can handle large groups. Arrive early on Saturday mornings if you want an outdoor table; by 11am, it's standing room for walk-ins.$desc$
WHERE name = 'American Social' AND city = 'tampa';

-- 4. M. Bird
UPDATE public.venues SET
  description = $desc$M. Bird sits atop Armature Works with one of Tampa's best views — the Hillsborough River and city skyline at golden hour is a legitimate experience, and the deco-inspired design makes the room worth photographing before it gets too dark to tell. The cocktail program is craft-serious and the tapas hold up as a meal if you order enough of them. The transition from early-evening lounge to DJ-driven club energy happens naturally around 10pm on Fridays and Saturdays, which means the experience is genuinely different depending on when you arrive. The crowd is stylish, 25–40, and tends to dress up — this isn't a flip-flops-and-bucket-hat kind of rooftop. Reviewers consistently recommend reservations, particularly around golden hour; the outdoor couch and high-top seating fills quickly on weekends. One of the more complete rooftop experiences in the city. Can order bottle service and luxurious services during its nightlife / club shit in the evening after 10 PM.$desc$
WHERE name = 'M. Bird' AND city = 'tampa';

-- 5. MacDinton's SoHo (DB row: 'Soho Saloon' per user direction)
UPDATE public.venues SET
  description = $desc$MacDinton's has been a SoHo anchor since 2002 and has built a specific identity that most bars don't manage: it's Tampa Bay's official US Soccer Supporters Bar and the home of The American Outlaws Tampa chapter, which means when there's a big soccer match, this is where serious fans go. The EPL, La Liga, FA Cup, Champions League, and World Cup all play here. Off soccer season, it runs as a reliable Irish pub with an outdoor patio that gets lively on weekends, live entertainment, and drink specials that keep the 21–30 crowd coming back. The Thursday all-you-can-drink special is a local institution, which is a heavy hitter for USF and University of Tampa students. If you're a soccer fan, this is a mandatory stop. If you're not, it's still a good bar — just know the room gets very loud when something important is on.$desc$
WHERE name = 'Soho Saloon' AND city = 'tampa';

-- 6. The Grove SoHo (DB row: 'Grove Soho')
UPDATE public.venues SET
  description = $desc$The Grove runs two distinct modes that are genuinely different experiences. Daytime and early evening, it's a tiki-inspired tropical bar with an Eagles and Seminoles viewing focus, Mexican food, and a casual patio crowd. After the DJ starts and the drink theater kicks in — smoke effects, light presentations, the full aesthetic — it becomes something closer to a nightclub for the younger crowd. The dance floor fills on Friday and Saturday nights, and the outdoor patio stays accessible for groups who want the energy without being fully inside it. Good for a group with mixed energy levels; someone can be on the patio while someone else is on the dance floor.$desc$
WHERE name = 'Grove Soho' AND city = 'tampa';

-- 7. Sunset Rodeo
UPDATE public.venues SET
  description = $desc$Sunset Rodeo opened in August 2025 and has quickly established itself as the most committed country bar on South Howard — live music every single night from 5pm to 3am, with acoustic sets giving way to full bands and then DJs carrying it to last call. The food program is built around Nashville hot chicken, smash burgers, loaded hot dogs, and what might be the city's most talked-about novelty menu item: the glizzy tower. There is a mechanical bull. The outdoor patio is legitimately well-designed for a Florida evening, and the 23+ policy (loosened to 21+ on Thursdays for Neon Stampede nights) keeps the room intentional. Reviewed as "rowdy-meets-refined" and that's accurate — it takes the Nashville honky-tonk format seriously without taking itself too seriously. Best Thursday through Saturday when the full band and DJ programming is running.$desc$
WHERE name = 'Sunset Rodeo' AND city = 'tampa';

-- 8. Corner Bar SoHo
UPDATE public.venues SET
  description = $desc$Corner Bar is the South Howard bar that locals go to when they've had enough of South Howard's usual volume. Dog-friendly patio, cigar section outside, rotating DJs on Fridays and Saturdays that keep enough energy going without demanding participation, and a staff that reviewers consistently describe as the whole point of the place — attentive, friendly, not trying to upsell you. The food is straightforward and good; the service is what you remember. Cleveland Browns game-day parties are a regular thing, which gives you a sense of the crowd — loyal regulars who found something that works and keep coming back. A reliable first stop before the heavier SoHo spots or an end-of-night wind-down when the rest of the strip has been enough.$desc$
WHERE name = 'Corner Bar SoHo' AND city = 'tampa';


-- ═══════════════════════════════════════════════════════════════
-- F) KARSTON FOLLOW-UPS (NOT IN THIS MIGRATION)
-- ═══════════════════════════════════════════════════════════════
-- 1. SEED 10 MISSING TAMPA VENUES from PDF B descriptions:
--    Hattricks, The Cuban Sandwich Co, Franklin Manor, Park Tavern,
--    The Lodge, Bull & Bear, World of Beer, Whiskey Joe's,
--    Yard of Ale, The Library Bar
--    All need lat/lng + city='tampa' + is_active=true + descriptions
--    from PDF B before Tampa launch.
--
-- 2. SEED Easy Tiger in St. Pete:
--    fire_capacity=100, effective_capacity=75
--    Description from PDF B: "Dinner lounge, soundroom, luxurious vibes"
--
-- 3. AUDIT Tampa duplicates: The Grove vs Grove Soho,
--    MacDinton's Irish Pub vs Soho Saloon, Corner Bar vs
--    Corner Bar SoHo. Determine if the non-SoHo rows are legit
--    separate venues or stale test data — soft-delete if stale.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- G) Verification block
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_described  INTEGER;
  v_capacity   INTEGER;
  v_cover      INTEGER;
  v_notes      INTEGER;
  v_inactive   INTEGER;
  v_dup_killed INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_described FROM public.venues
    WHERE description IS NOT NULL AND length(description) > 200 AND is_active = true
      AND city IN ('knoxville','tampa','st_petersburg');

  SELECT COUNT(*) INTO v_capacity FROM public.venues
    WHERE effective_capacity IS NOT NULL AND is_active = true
      AND city IN ('knoxville','tampa','st_petersburg');

  SELECT COUNT(*) INTO v_cover FROM public.venues
    WHERE cover_policy IS NOT NULL AND is_active = true
      AND city IN ('knoxville','tampa','st_petersburg');

  SELECT COUNT(*) INTO v_notes FROM public.venues
    WHERE venue_notes IS NOT NULL AND is_active = true
      AND city IN ('knoxville','tampa','st_petersburg');

  SELECT COUNT(*) INTO v_inactive FROM public.venues
    WHERE is_active = false
      AND city IN ('knoxville','tampa','st_petersburg');

  SELECT COUNT(*) INTO v_dup_killed FROM public.venues
    WHERE name = '5 Bucks' AND city = 'st_petersburg' AND is_active = false;

  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'Launch Data Foundation Migration Results';
  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'Venues with rich descriptions (>200ch): %', v_described;
  RAISE NOTICE 'Venues with effective_capacity:         %', v_capacity;
  RAISE NOTICE 'Venues with cover_policy:               %', v_cover;
  RAISE NOTICE 'Venues with venue_notes:                %', v_notes;
  RAISE NOTICE 'Inactive (launch cities, all-time):     %', v_inactive;
  RAISE NOTICE '5 Bucks duplicate deactivated (=1?):    %', v_dup_killed;
  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'DOCTRINE READY: Venny has substance to work with';
  RAISE NOTICE '────────────────────────────────────────';
END $$;

COMMIT;

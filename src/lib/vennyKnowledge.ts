// src/lib/vennyKnowledge.ts
// City-specific knowledge for Venny AI assistant
// Knoxville data: Mike's field intel + Noah's local knowledge
// SEC cities: surface-level bar intel from public knowledge

import { CITIES, type CityKey } from './constants';

/* ── KNOXVILLE — DEEP LOCAL INTEL ────────────────────────── */

const KNOXVILLE_KNOWLEDGE = `
YOU ARE IN: Knoxville, TN (UTK — Vols) 🍊
You know Knoxville nightlife like a local. Give SPECIFIC bar names, not generic advice. Sound like a friend who goes out here, not a guidebook.

═══ CRITICAL RULES — NEVER VIOLATE ═══
- Half Barrel is an UPPERCLASSMEN bar. NEVER recommend it for freshmen or underclassmen.
- Cool Beans is an UPPERCLASSMEN bar. NEVER recommend it for freshmen or underclassmen.
- Hannas is an UPPERCLASSMEN bar.
- Old City Sports Bar is an UPPERCLASSMEN bar.
- Preservation Pub is an UPPERCLASSMEN bar.
- Radius Rooftop is an UPPERCLASSMEN bar.
- FRESHMEN bars ONLY: LiterBoard, The Bookstore, The Hill, Undeclared, Yacht Club.
- When asked about freshmen/underclassmen bars, ONLY recommend from the freshmen list above. NO EXCEPTIONS.
- When asked about upperclassmen bars, recommend from the upperclassmen list above.
- Sunspot and Taqueria Mares are for BOTH — anyone can go.

═══ UPPERCLASSMEN BARS (21+, older crowd) ═══

COOL BEANS — The Strip (Cumberland Ave area)
- Upperclassmen staple on the Strip. Packed on weekends. Chill vibes, not a freshman zoo.
- Cheap beers, pool tables, photo booth, games. Glass garage doors open in warm weather.
- Great food people sleep on — loaded tater tots, cheesesteak quesadilla. Kitchen closes ~9-10 PM.
- WHERE PEOPLE GO AFTER SUNSPOT on Wine Wednesdays.

HALF BARREL — The Strip, right next to Cool Beans
- Right next to Cool Beans on the Strip. Upperclassmen staple, cheap pitchers, great energy on weekends.
- Three sections: front bar with arcade games, second bar with garage doors, back patio.
- Berry Bombs are the signature drink. Parker's hot dogs outside at 3 AM.

HANNAS (Hanna's Cumberland) — The Strip
- Chill upperclassmen spot. Downstairs: main bar, pool tables, big patio.
- Sleeper hit: upstairs club opens 10-11 PM weekends — huge dance floor, DJ always right.

OLD CITY SPORTS BAR — Downtown / Old City
- Downtown, 5-10 min Uber from campus. Big TVs everywhere, balcony overlook, full food menu.
- Sports crowd, upperclassmen and post-grad. Solid game day spot.

PRESERVATION PUB — Downtown, Market Square
- THE upperclassmen hangout downtown. Three stories, rooftop, live music every night.
- Best on Thursday and Friday nights. Downtown comes alive around Pres Pub.

RADIUS ROOFTOP — Downtown
- Upscale rooftop vibes, older crowd, craft cocktails, great views.
- Date night spot. The "classy" option.

═══ FRESHMEN BARS (younger crowd, high energy) ═══

LITERBOARD — The Strip
- Newer spot, board game themed. THE freshmen landmark.
- Downstairs: chill. Upstairs: full nightclub energy. Animal Hour = drink specials. Karaoke nights.

THE BOOKSTORE — The Strip
- Freshmen favorite, always busy. Two rooms: casual bar + DJ dance floor. Lines out the door on weekends.

THE HILL BAR & GRILL — Near campus (Fort Sanders)
- Freshmen lean but BOTH classes go. THE game day bar — you walk in at 11 AM and don't leave til 1 AM.
- Two floors: dancing upstairs, screens everywhere downstairs. Wings are insane. Wing Wednesday packs the place.

UNDECLARED — The Strip
- Freshmen bar, high energy. Great wings. Lines stretch past Chipotle on weekends.
- Outdoor patio with cornhole, themed nights. Thu-Sat mostly.

YACHT CLUB — The Strip (tucked between Undeclared and Chipotle)
- Freshmen spot, fun atmosphere, hidden gem. Best staff on the Strip.
- Pro move: when Undeclared line is insane, slip into Yacht Club next door.
- Beer only — no liquor. Back patio, they let you play music on the aux.

═══ BOTH / ANYONE ═══

SUNSPOT — The Strip (Cumberland Ave)
- Wine Wednesday is LEGENDARY — an institution, everyone goes. Buzzing by 4 PM, shoulder to shoulder by 7.
- Downstairs: anyone can drink at the tables, actual nice restaurant. Upstairs area is 21+, rooftop with DJs.
- Both freshmen and upperclassmen go. Closes at 10 PM — starter not a closer.
- After Sunspot, crowd flows to Cool Beans or Half Barrel.

TAQUERIA MARES — The Strip
- Anyone can come here. Great food and massive margaritas. Not strictly a bar, more restaurant-bar hybrid.
- Packed on Wednesday and Friday nights. Perfect pregame food spot.

═══ THE STRIP (Cumberland Ave area) ═══
Where most Knoxville nightlife happens. Cool Beans, Half Barrel, LiterBoard, Undeclared, Yacht Club, Bookstore, Mares, Sunspot — all within walking distance on Cumberland Ave.

═══ DOWNTOWN / MARKET SQUARE / OLD CITY ═══
Older crowd, more polished. Preservation Pub, Old City Sports Bar, Radius Rooftop. Friday and Saturday are the biggest nights downtown.

═══ BEST NIGHTS ═══
- WEDNESDAY: Wine Wednesday at Sunspot — an institution, everyone goes. Then Cool Beans or Half Barrel after.
- THURSDAY: Biggest Strip night. Cool Beans and Half Barrel packed. Freshmen bars all busy — LiterBoard, Undeclared, Yacht Club. Pres Pub downtown starts popping.
- FRIDAY: Downtown comes alive — Preservation Pub, Old City Sports Bar, Radius Rooftop. Strip still busy too.
- SATURDAY: Everything busy, especially game day weekends. The Hill from 11 AM. Tailgates at 10:30 AM.
- SUNDAY-TUESDAY: Most bars slow or closed. Rest up.

═══ COMMON QUESTIONS — ANSWER WITH SPECIFICS ═══

"Where should freshmen go?"
→ The Strip is your home base. LiterBoard, Undeclared, Yacht Club, The Bookstore, The Hill. Start at LiterBoard or Undeclared, bounce between them. Hit Sunspot downstairs for Wine Wednesday (anyone can drink downstairs).

"Best upperclassmen bar?"
→ Preservation Pub is THE move — three floors, rooftop, live music. Also Cool Beans and Half Barrel on the Strip for a chill night, or Radius Rooftop if you want upscale vibes.

"What's good on Thursday?"
→ Thursday is THE Strip night. If you're 21+, Cool Beans and Half Barrel are packed. Freshmen hit Undeclared, Yacht Club, LiterBoard. Everything's walking distance.

"Wine Wednesday?"
→ Sunspot, no question. Buzzing by 4, packed by 7. Downstairs is open to everyone. After Sunspot closes at 10, everyone migrates to Cool Beans or Half Barrel.

"Game day bar?"
→ The Hill — walk in at 11 AM on game day and don't leave. Tailgates in the parking lot by 10:30. Also Old City Sports Bar downtown for big screens, Fieldhouse Social.

"Date night?"
→ Radius Rooftop for upscale views, Preservation Pub rooftop for live music, Sunspot for wine and sunset vibes.

"Best rooftop?"
→ Radius Rooftop (upscale, great views) or Preservation Pub rooftop (live music, downtown energy).

"Cheap drinks?"
→ Half Barrel pitchers, Cool Beans $2 beers, LiterBoard Animal Hour deals.

"Where's the move tonight?"
→ Check what day it is — Wednesday = Sunspot, Thursday = the Strip, Friday = downtown/Pres Pub, Saturday = everything. Then check the live map for headcounts.

"I'm a freshman where do I go?"
→ Start on the Strip — Undeclared, Yacht Club, Bookstore, LiterBoard. Hit Sunspot downstairs for Wine Wednesday (you don't have to be 21 for downstairs). The Hill is for everyone on game days.

"Late night food?"
→ Parker's hot dogs outside Half Barrel at 3 AM — Knoxville institution. Mares for tacos earlier in the night.
`;

const OXFORD_KNOWLEDGE = `
YOU ARE IN: Oxford, MS (Ole Miss — Rebels) 🔴🔵
THE SQUARE — Oxford's nightlife centers around the historic town Square. Everything walkable.

THE LYRIC OXFORD: Live music venue on the Square. Two levels, great sound. Concert venue energy.
ROOSTER'S BLUES HOUSE: Blues bar, live music nightly. Small, packed, loud. Mississippi blues heritage.
PROUD LARRY'S: Restaurant by day, live music by night. Southern food. Great patio.
THE LIBRARY SPORTS BAR: THE game day bar. TVs everywhere. Don't let the name fool you.
FUNKY'S PIZZA & DAIQUIRI BAR: Late night move. Pizza + frozen daiquiris. Open late, cheap.
THE BLIND PIG: Dive bar. Pool tables, cheap drinks, jukebox. Walk in alone, leave with 5 friends.
RAFTERS: Classic Oxford bar. Upper level overlooking Square. Good drink specials.
ROUND TABLE: Cocktail bar vibes. More upscale. Good for dates.
CITY GROCERY BAR: Upstairs from City Grocery restaurant. Craft cocktails, balcony over Square. Classy start.
AJAX DINER: Southern comfort food institution. Eat here BEFORE going out. Cash only.
BOURÉ: Cajun food + late night bar. Pool tables, cheap pitchers. Where you end up at 1 AM hungry.

NIGHT FLOW — OXFORD:
- Pre-game food: Ajax Diner or Proud Larry's
- Game day: The Library → Rafters → Rooster's
- Upperclassmen: City Grocery Bar → Round Table → Rooster's
- Late night: Funky's for pizza/daiquiris, Bouré for Cajun and pool
- The Square is so walkable you hit 4-5 spots easy
`;

const TUSCALOOSA_KNOWLEDGE = `
YOU ARE IN: Tuscaloosa, AL (Alabama — Crimson Tide) 🐘
THE STRIP — University Boulevard near campus. Everything walkable.

ROUNDERS: Classic Bama bar. Big, open, packed game days. Cheap drinks, good energy.
INNISFREE IRISH PUB: THE Tuscaloosa bar. Pub downstairs, club upstairs. Live music. Game day lines wrap building.
GALLETTES: Dive bar legend. Dark, loud, packed. Sticky floors, nobody cares. Pure rowdy.
RHYTHM & BREWS: Live music venue + bar. Good food, solid beer. More chill.
THE RED SHED: Country vibes. Line dancing, country music, boots welcome.
CATCH 22: Sports bar with rooftop. TVs everywhere, good food. Rooftop is the move in nice weather.
ALCOVE INTERNATIONAL TAVERN: Craft beer/cocktails. The nicer option. Date spot.
THE BOOTH: DJs, dancing, club energy.
EGAN'S BAR: THE dive. Cheap, dark, full of character. Jukebox, pool. Institution.

NIGHT FLOW — TUSCALOOSA:
- Game day: Innisfree all day → Rounders → Gallettes late
- Chill: Rhythm & Brews → Alcove cocktails
- Rowdy: Gallettes → Rounders → The Booth
- Country: The Red Shed
`;

const ATHENS_KNOWLEDGE = `
YOU ARE IN: Athens, GA (UGA — Bulldogs) 🐶
DOWNTOWN ATHENS — One of the best college bar scenes in America. All downtown, walkable.

BOURBON STREET: Big dance club. Multiple rooms, DJs, packed. THE dance spot. Upperclassmen heavy.
ALLGOOD LOUNGE: Rooftop bar, craft cocktails. Upscale play. Dates.
GEORGIA THEATRE: Legendary live music venue. Rooftop bar with incredible views. Burned down and rebuilt.
MAGNOLIA'S: Southern food and bar. Great patio. Eat then stay for drinks.
THE GLOBE: Cocktail bar. Intimate, craft drinks. When you want a real drink.
CUTTERS PUB: Classic college bar. Pool, darts, cheap. Underclassmen friendly.
GENERAL BEAUREGARD'S: Dive bar. Cheap drinks, fun crowd.
SILVER DOLLAR: Honky tonk / country. Live music, dancing.
FLANAGAN'S: Irish pub. Trivia nights, good food. Hang spot.
CLOUD BAR: Rooftop vibes. Great views, cocktails.

NIGHT FLOW — ATHENS:
- Pre-game: Magnolia's food → Georgia Theatre rooftop sunset
- Game day: Cutters and General Beauregard's fill first
- Dance: Bourbon Street
- Chill: Globe cocktails → Allgood rooftop
- Live music: Georgia Theatre, Silver Dollar for country
`;

const GAINESVILLE_KNOWLEDGE = `
YOU ARE IN: Gainesville, FL (UF — Gators) 🐊
MIDTOWN — Bar scene centered around Midtown, off University Ave.

MIDTOWN SOCIAL: Upscale-ish, rooftop, craft cocktails. Nicer option, dates.
FAT DADDY'S: THE Gator nightclub. Multiple floors, DJs. Dance and rage.
THE SWAMP RESTAURANT: Game day institution. Across from stadium. Electric on game day.
SALTY DOG SALOON: Dive classic. Cheap, pool tables, Gator memorabilia.
GROG HOUSE: Cocktail-focused. Better drinks, intimate vibe.
SOCIAL AT MIDTOWN: Big bar, outdoor space. Default "let's go out" spot.
THE WOOLY: Live music venue downtown. Touring indie acts.

NIGHT FLOW: Game day: Swamp pregame → everywhere. Dance: Fat Daddy's. Chill: Salty Dog. Date: Midtown Social.
`;

const BATON_ROUGE_KNOWLEDGE = `
YOU ARE IN: Baton Rouge, LA (LSU — Tigers) 🐯
TIGERLAND — LSU's bar district near campus. Its own world on game nights.

FRED'S BAR: THE LSU bar in Tigerland. Cheap, packed, unmatched game night energy. Get there early Saturdays.
REGGIE'S: Tigerland staple. Big outdoor area. Classic tailgate overflow.
THE CHIMES: Restaurant/bar at North Gate. INSTITUTION. Best food near campus. 200+ beers. Start here.
BOGEY'S: Sports bar, good food, multiple TVs. Chill watching spot.
BULLDOG BATON ROUGE: Big bar, multiple rooms. Middle ground.
TIN ROOF BATON ROUGE: Live music, good food. Hang spot.
CHELSEA'S CAFÉ: Live music venue. Great local/touring acts. Intimate.
BENGAL TAP ROOM: Craft beer. When you want good beer not just cheap beer.

NIGHT FLOW: Game day: Chimes food/pregame → Fred's and Reggie's in Tigerland. Chill: Bengal Tap Room. Music: Chelsea's or Tin Roof.
`;

const AUBURN_KNOWLEDGE = `
YOU ARE IN: Auburn, AL (Auburn — Tigers) 🦅
DOWNTOWN AUBURN — Compact, walkable around Toomer's Corner and Magnolia Ave.

SKY BAR: THE Auburn bar. Huge. Multiple levels, outdoor, rooftop. Game day is a must. One of biggest college bars in America.
QUIXOTE'S: Dive with live music. Cheap drinks. Gritty counterpart to Sky Bar.
THE VAULT: Cocktail bar. More upscale. Dates.
J&M BOOKSTORE: Not a bookstore. Classic Auburn bar with history. Cheap drinks.
BOURBON STREET AUBURN: New Orleans vibes. Frozen drinks, fun atmosphere.
HURRICANE HARRY'S: Country dance hall. Line dancing, country music.

NIGHT FLOW: Game day: Sky Bar non-negotiable → J&M and Bourbon Street. Chill: Vault → Quixote's. Country: Hurricane Harry's.
`;

const COLUMBIA_SC_KNOWLEDGE = `
YOU ARE IN: Columbia, SC (South Carolina — Gamecocks) 🐔
FIVE POINTS / VISTA — Five Points = student bars. Vista = more upscale.

PAVLOV'S: Five Points staple. Cheap, packed. Default USC bar.
JAKE'S BAR: Dive in Five Points. Cheap, pool, jukebox.
BIRD DOG: Sports bar, good food. Game day spot.
THE GRAND: Nightclub vibes. DJs, dancing, bottle service.
BAR NONE: Cocktail bar. Craft drinks, nicer atmosphere. Date night.
TIN ROOF COLUMBIA: Live music. Good food and drinks.

NIGHT FLOW: Game day: Five Points — Pavlov's, Bird Dog. Rage: Pavlov's → Grand. Chill: Bar None → Jake's.
`;

const COLLEGE_STATION_KNOWLEDGE = `
YOU ARE IN: College Station, TX (Texas A&M — Aggies) 👍
NORTHGATE — Bar district directly across from campus. This is where it all happens.

DIXIE CHICKEN: THE Aggie bar since 1974. Texas institution. Live music, cheap beer, pool. Snake in a glass case.
THE CORNER BAR: Classic Northgate spot. Good starting point.
O'BANNON'S: Irish pub. Good food and beer. More chill.
HURRICANE HARRY'S: Country dance hall. THE place for two-stepping. Texas dance hall experience.
HALO NIGHTCLUB: Club option. DJs, dancing, bottle service.
PADDOCK LANE: Cocktail bar. Nicer drinks, intimate. Upscale Northgate.
THE BACKYARD: Outdoor bar. Good for groups.

NIGHT FLOW: Game day: Dixie Chicken pilgrimage → Corner and O'Bannon's. Country: Hurricane Harry's. Club: Halo. Chill: Paddock Lane → Backyard.
`;

const STARKVILLE_KNOWLEDGE = `
YOU ARE IN: Starkville, MS (Mississippi State — Bulldogs) 🐶
COTTON DISTRICT / DOWNTOWN — Small but loyal bar scene.

RICK'S CAFÉ: THE State bar. Packed game days, outdoor area, cheap. Where Bulldogs go.
DAVE'S DARK HORSE TAVERN: Dive classic. Pool, darts, jukebox.
MUGSHOTS GRILL & BAR: Good food and drinks. More restaurant but fun at night.
THE GUEST ROOM: Cocktail bar. Nicer option for dates.
BIN 612: Wine and craft drinks. Sophisticated play.
HARVEY'S BAR: College bar energy. Cheap, fun.

NIGHT FLOW: Rick's anchor → Dave's dive → Guest Room cocktails.
`;

const LEXINGTON_KNOWLEDGE = `
YOU ARE IN: Lexington, KY (Kentucky — Wildcats) 🐱
DOWNTOWN — Great scene centered on Main St and Limestone.

TWO KEYS TAVERN: THE UK bar. Packed game days. Basketball is religion here.
TIN ROOF LEXINGTON: Live music, good food. Solid all-around.
THE BURL: Concert venue and bar. Great live shows.
CHEAPSIDE BAR & GRILL: Downtown classic. Good food and drinks.
WEST SIXTH BREWING: Craft brewery, huge outdoor space. Day-drinking spot.
COUNTRY BOY BREWING: Great local brewery.
ARCADIUM: Arcade bar. Games + drinks. Fun alternative.

NIGHT FLOW: West Sixth day drinks → Two Keys game energy → Tin Roof music → Cheapside late.
March Madness in Lexington is a DIFFERENT PLANET.
`;

const FAYETTEVILLE_KNOWLEDGE = `
YOU ARE IN: Fayetteville, AR (Arkansas — Razorbacks) 🐗
DICKSON STREET — THE bar street. Everything happens on Dickson.

GEORGE'S MAJESTIC LOUNGE: THE live music venue. Legendary. Acts from everywhere.
JJ'S GRILL: Multiple levels, good food. Dickson staple.
CANNIBAL & CRAFT: Craft cocktails and burgers. Nicer option.
SMOKE AND BARREL: Whiskey bar + BBQ.
KINGFISH: Classic college bar. Cheap, packed.
MAXINE'S TAP ROOM: Craft cocktails. Date night material.
PINPOINT: Bowling alley + bar. Something different.

NIGHT FLOW: JJ's food → Kingfish cheap drinks → George's music → Cannibal & Craft cocktails.
`;

const COLUMBIA_MO_KNOWLEDGE = `
YOU ARE IN: Columbia, MO (Mizzou — Tigers) 🐯
DOWNTOWN COMO — Bar scene on Broadway and 9th Street.

THE HEIDELBERG: THE Mizzou bar. Historic. Restaurant + multiple bars under one roof.
HARPO'S: Concert venue + bar. Great live music. Columbia institution.
FIELDHOUSE: Sports bar. TVs, game day energy.
BENGALS BAR & GRILL: Good food, good drinks. Chill.
LOGBOAT BREWING: Craft brewery, great taproom. Day-drink move.
THE BLUE NOTE: Concert venue. Touring acts.

NIGHT FLOW: Logboat day drinks → Heidelberg dinner → Harpo's music → Fieldhouse games.
`;

const NASHVILLE_KNOWLEDGE = `
YOU ARE IN: Nashville, TN 🎸
BROADWAY / MIDTOWN — Lower Broadway = famous tourist strip. Midtown = local/college scene.

TOOTSIE'S ORCHID LOUNGE: THE Broadway honky tonk. 3 floors live music. Iconic purple exterior.
KID ROCK'S BIG ASS HONKY TONK: Huge, multiple floors, rooftop.
LUKE BRYAN'S 32 BRIDGE: Four stories of bars, food, live music.
ROBERT'S WESTERN WORLD: The real deal honky tonk. Where locals actually go on Broadway.
ACME FEED & SEED: Multi-level on Broadway. Rooftop river views.
AJ'S GOOD TIME BAR: Alan Jackson's spot. Good music and drinks.
JASON ALDEAN'S KITCHEN: Big, flashy, multiple floors.
FGL HOUSE: Florida Georgia Line's bar. Rooftop is the move.
LOSERS BAR & GRILL: Midtown classic. MORE LOCAL, less tourist. Great live music.

IMPORTANT: Broadway is TOURIST HEAVY. Locals and Vandy students hit Midtown. Losers is the local play.

NIGHT FLOW: Broadway for the experience → migrate to Midtown for the real scene.
`;

/* ── CITY KNOWLEDGE MAP ──────────────────────────────────── */

const CITY_KNOWLEDGE: Partial<Record<CityKey, string>> = {
  knoxville: KNOXVILLE_KNOWLEDGE,
  oxford: OXFORD_KNOWLEDGE,
  tuscaloosa: TUSCALOOSA_KNOWLEDGE,
  athens: ATHENS_KNOWLEDGE,
  gainesville: GAINESVILLE_KNOWLEDGE,
  baton_rouge: BATON_ROUGE_KNOWLEDGE,
  auburn: AUBURN_KNOWLEDGE,
  columbia_sc: COLUMBIA_SC_KNOWLEDGE,
  college_station: COLLEGE_STATION_KNOWLEDGE,
  starkville: STARKVILLE_KNOWLEDGE,
  lexington: LEXINGTON_KNOWLEDGE,
  fayetteville: FAYETTEVILLE_KNOWLEDGE,
  columbia_mo: COLUMBIA_MO_KNOWLEDGE,
  nashville: NASHVILLE_KNOWLEDGE,
};

/* ── BUILD CITY KNOWLEDGE ────────────────────────────────── */

export function getCityKnowledge(city: CityKey, venueNames: string[]): string {
  const specific = CITY_KNOWLEDGE[city];
  if (specific) return specific;

  const config = CITIES[city];
  const venueList = venueNames.length > 0
    ? venueNames.map(n => `- ${n}`).join('\n')
    : '- No venues mapped yet.';

  return `
YOU ARE IN: ${config.name}, ${config.state}${config.school ? ` (${config.school} — ${config.mascot})` : ''}
VENUES ON THE MAP:\n${venueList}
You don't have deep intel on ${config.name} yet. Be honest. Tell users to check the map for live data.
`;
}

/* ── WELCOME MESSAGES ────────────────────────────────────── */

const KNOXVILLE_WELCOMES = [
  (name: string) => `Yo what's good ${name}! I'm Venny — I know every spot on the strip inside and out. What's the move tonight?`,
  (name: string) => `What's up ${name}! I'm Venny, your Knoxville nightlife plug. What are we working with tonight?`,
  (name: string) => `Ayy ${name}! Tell me the vibe — chill night or are we going off? I got you either way`,
  (name: string) => `Hey ${name}! I'm Venny. I've been to every bar on the strip more times than I can count. What's the plan tonight?`,
];

const CITY_WELCOMES: Partial<Record<CityKey, ((name: string) => string)[]>> = {
  oxford: [
    (name: string) => `What's good ${name}! I'm Venny — I know The Square like the back of my hand. Hotty Toddy! What's the move tonight?`,
    (name: string) => `Yo ${name}! Ready to hit The Square? I got the full Oxford playbook. What's the vibe?`,
  ],
  tuscaloosa: [
    (name: string) => `Roll Tide ${name}! I'm Venny — I know The Strip inside and out. What's the move tonight?`,
    (name: string) => `What's good ${name}! Ready for a Tuscaloosa night? Tell me the vibe and I'll build the plan.`,
  ],
  athens: [
    (name: string) => `Go Dawgs ${name}! I'm Venny — downtown Athens is my territory. What's the move tonight?`,
    (name: string) => `What's good ${name}! Athens has one of the best bar scenes in the country. What vibe we going for?`,
  ],
  baton_rouge: [
    (name: string) => `Geaux Tigers ${name}! I'm Venny — Tigerland is my zone. What's the move tonight?`,
    (name: string) => `What's good ${name}! Ready for a Baton Rouge night? I got Tigerland mapped out.`,
  ],
  auburn: [
    (name: string) => `War Eagle ${name}! I'm Venny — downtown Auburn is my turf. What's the move tonight?`,
  ],
  college_station: [
    (name: string) => `Gig 'em ${name}! I'm Venny — Northgate is where it's at. What's the move tonight?`,
  ],
  nashville: [
    (name: string) => `What's good ${name}! I'm Venny — I know Broadway AND the spots locals actually go. What's the move tonight?`,
    (name: string) => `Yo ${name}! Nashville's got layers — tourist Broadway and the real Midtown. What's your vibe?`,
  ],
};

const GENERIC_WELCOMES = [
  (name: string, cityName: string) => `Yo what's good ${name}! I'm Venny — I got the ${cityName} map lit up. What's the move tonight?`,
  (name: string, cityName: string) => `What's up ${name}! I'm Venny, your ${cityName} nightlife guide. What are we working with?`,
  (name: string, cityName: string) => `Hey ${name}! I'm Venny. I got ${cityName}'s bar scene mapped — what vibe tonight?`,
];

export function getWelcomeMessage(city: CityKey, username: string): string {
  if (city === 'knoxville') {
    return KNOXVILLE_WELCOMES[Math.floor(Math.random() * KNOXVILLE_WELCOMES.length)](username);
  }
  const cityWelcomes = CITY_WELCOMES[city];
  if (cityWelcomes) {
    return cityWelcomes[Math.floor(Math.random() * cityWelcomes.length)](username);
  }
  const config = CITIES[city];
  return GENERIC_WELCOMES[Math.floor(Math.random() * GENERIC_WELCOMES.length)](username, config.name);
}

/* ── SUGGESTIONS ─────────────────────────────────────────── */

const CITY_SUGGESTIONS: Partial<Record<CityKey, string[]>> = {
  knoxville: ["Where should freshmen go?", "Best upperclassmen bar?", "What's good on Thursday?", "Wine Wednesday plans?"],
  oxford: ["Best spot on The Square?", "Where's the game day bar?", "Plan my night", "Late night food?"],
  tuscaloosa: ["Best spot on The Strip?", "Where's the game day bar?", "Plan my night", "Dive bar vibes?"],
  athens: ["Best bar downtown?", "Where should we dance?", "Live music tonight?", "Plan my night"],
  baton_rouge: ["What's Tigerland like?", "Best food near campus?", "Game day plan?", "Live music?"],
  auburn: ["Is Sky Bar worth it?", "Game day plan?", "Chill spots?", "Plan my night"],
  college_station: ["Dixie Chicken vibes?", "Country dancing?", "Northgate plan?", "Plan my night"],
  nashville: ["Broadway or Midtown?", "Best honky tonk?", "Where do locals go?", "Plan my night"],
};

const GENERIC_SUGGESTIONS = ["What's popping right now?", "Where should we go tonight?", "Best spots for a group?", "Plan my night"];

export function getSuggestions(city: CityKey): string[] {
  return CITY_SUGGESTIONS[city] ?? GENERIC_SUGGESTIONS;
}

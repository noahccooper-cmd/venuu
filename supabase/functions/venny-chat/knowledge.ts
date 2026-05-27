// supabase/functions/venny-chat/knowledge.ts
// City-specific knowledge for Venny — Deno-compatible inline version.
// Source of truth: src/lib/vennyKnowledge.ts (sync manually for now, refactor
// to _shared/ in a future commit).

type CityKey = 'knoxville' | 'tampa' | 'st_petersburg';

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

/* ── CITY KNOWLEDGE MAP ──────────────────────────────────── */

const CITY_KNOWLEDGE: Partial<Record<CityKey, string>> = {
  knoxville: KNOXVILLE_KNOWLEDGE,
  // tampa: TAMPA_KNOWLEDGE — to be added once Karston's venue_brain is filled
  // st_petersburg: ST_PETE_KNOWLEDGE — to be added
};

/* ── BUILD CITY KNOWLEDGE FOR SYSTEM PROMPT ──────────────── */

/**
 * Returns the city-specific knowledge block to inject into Venny's
 * system prompt. Returns empty string if we have no deep intel on
 * the city yet (Venny falls back to whatever's in the candidate
 * venues from search_venues).
 */
export function getCityKnowledge(city: string, venueNames: string[] = []): string {
  const specific = CITY_KNOWLEDGE[city as CityKey];
  if (specific) return specific;

  // No deep intel for this city — return short honesty block instead
  // of fabricating venues Venny doesn't know.
  if (venueNames.length === 0) return '';

  return `
YOU ARE IN: ${city}
VENUES ON THE MAP:
${venueNames.map(n => `- ${n}`).join('\n')}
You don't have deep intel on ${city} yet. Be honest with the user. Use the candidate venues from search_venues as your guide.
`;
}

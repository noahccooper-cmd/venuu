# venuu — Venue Data Cleanup (Tampa + St. Pete)

Ground-truth rebuild of every venue card from Karston's verified addresses. All
coordinates pulled from live location data (not runtime geocoding), so placement
is now deterministic. **44 venues total — 18 Tampa, 26 St. Pete.**

## Files
- **`venuu_venues_master.csv`** — the full table. Import-ready: slug, name, kb_key, city, neighborhood, address, latitude, longitude, is_partner, one_liner.
- **`venuu_venues_master.json`** — same data + the rich `details` block (aesthetic/colors/interior/vibe/crowd/signature) nested per venue.
- **`venuu_venues_upsert.sql`** — Supabase/Postgres upsert keyed on `slug`. Adjust column names to your schema; comments at the bottom cover removals + dupes.
- **`venuu_barKnowledgeBase.js`** — drop-in additions for the `barKnowledgeBase` object in index.html, keyed in Karston's existing scheme (lowercase, spaces). End: `Object.assign(barKnowledgeBase, barKnowledgeBaseAdditions);`

## Coordinates are the fix
Every card now has a hardcoded lat/lng instead of an address that gets geocoded
at runtime and drifts. The big misplacements this corrects:
- **The Patio** — it's on **S MacDill Ave**, ~0.5 mi west of the SoHo strip, not on Howard.
- **511 Franklin** — pulled back to 513 N Franklin (downtown core), off its "too far east" spot.
- **Oak & Stone** — downtown St. Pete on Central, not wherever it was landing.
- **Meat Market** (Hyde Park / Snow Ave), **Blind Goat** (Henderson), **Red Dog** (Bay to Bay) all repinned.

## Decisions applied
- **Red Dog** — stored as `Red Dog` (Google lists it as "The Dog Saloon"). Same location, your name.
- **Lower Deck** — flagged `is_partner = true`, and its pin is nudged just **south of American Social** (27.93795, -82.45520). They're the same building (601 S Harbour Island Blvd); Lower Deck is the marina/water level, so "below AmSo" is both what you wanted and physically right. *Its true Google pin is 27.93889, -82.45511 (~50m NNW) if you ever want the exact one.*
- **M.Bird + Armature Works** — both kept at the same point (M.Bird is the rooftop atop Armature Works). Nightlife → M.Bird, events/food-hall → Armature Works, per your app's swap logic.
- **Dupes consolidated to one row each:**
  - `Grove Soho` = `The Grove` → kept as **the-grove**
  - `Corner Bar SoHo` = `Corner Bar` → kept as **corner-bar**
  - `5 Buck's Drinkery` = `Five Bucks Drinkery` → kept as **five-bucks-drinkery**
  - (Corner Bar and The Grove are *different* real bars, ~6m apart on Howard — both stay. They only looked like dupes because they're neighbors.)
- **Removed** (not in the verified list): **Waterstreet**, **The Saloon**.
- **Predalina** added (Water St). All of Karston's other venues are in.

## Overlapping pins (both should still render)
A few venues are genuinely on top of each other; coordinates keep them ~10–45m apart so your map's marker declutter can fan them out:
- **Five Bucks / Banana Hammock** — both 247 Central; Banana nudged ~15m north (it's the courtyard behind).
- **Jannus Live / The Landing** — both 200 1st Ave N; Landing offset ~45m east (it's the loft above).
- **Echo / Delta** — adjacent on N Franklin (912/914), ~12m apart.

## One thing still open
- **SoHo Saloon** — you said keep it, but it's not in Karston's list and I have no address for it, so it's **not** in these files. Send the address and I'll geocode it and add the row.

## Photos
Next step. Live location data returned photo URLs for every one of these venues — when you're ready I can pull a hero image per card and wire them in.

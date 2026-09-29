# Social tab — v3

Purpose: Venuu's events business. Run clubs, brand pop-ups and nightlife in one place, with brand partners presenting. Mike (cofounder) adds events from his phone in under a minute.

Nav: Tonight · Social · Community · You.

Screen 1 — World: still globe, 3 city buttons: Knoxville, Tampa, Pinellas (Pinellas = st_petersburg key; bounds cover St. Pete, Clearwater, Dunedin, beaches). Each shows a live count ("12 this week"). Demo theme: Sun Cruiser world with a "Presented by Sun Cruiser" lockup, behind a single theme flag. Never ship brand theming to the App Store without a signed deal.

Screen 2 — City: tap a city, globe flies down into:
- Top half: separate contained Mapbox map in a rounded box, only Social events, colored pins.
- Partner tabs row: Pinellas Run Club (green) · Sun Cruiser (blue, their official hex) · Nightlife (red). Tap one: its pins glow, others dim to ~25%, list filters, an About card slides in (logo, one line, schedule, Instagram). Tap again: back to All.
- Bottom half: scrolling list grouped Today / This Week / Upcoming. Card: date, time, place, category color bar, sponsor lockup.
- Linked: card tap flies map to pin and pulses it; pin tap scrolls to and highlights the card.
- City accents (header, box border, city button glow) never use green, blue or red. Knoxville = Venuu orange, Tampa = gold, Pinellas = purple.

Host "+ Add" (host/admin role only, enforced server-side): title, category (Run Club / Pop-Up / Nightlife), optional brand, date + time, "Repeats weekly" (creates next 8 occurrences linked by series_id), address search → pin drop (no venue required), optional photo, one-line description. Post → appears on map and list immediately.

Design rules: restrained and real. Real logos and photos. Color is signal, not decoration. No gradient soup, no sparkle emojis, no filler copy. Motion only to confirm something happened: fly-to, glow, highlight.
